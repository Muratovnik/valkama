"""The commits Valkama knows, taken from the records the Git hook leaves.

A commit is the pair of a registry project and a hash: one row of `commits`, with
the session, agent and client of the hook that reported it. The Git hook writes
no store; it leaves a record beside it (`hooks.commit_records`), and the client
hook of the session that made the commit takes it here, in a transaction of its
own, after the shell call the commit was made in.

`take` records the commits of each record, oldest first, and attaches each new
one to the task its agent works on. Taking a record twice inserts nothing the
second time: the pair is unique, and only a commit inserted now is attached. A
record that changes nothing is worked off, and whoever reads it may delete its
file, inside a transaction not yet committed as well: what makes it worked off is
either committed already or written in that same transaction from a file nobody
deletes before it commits.

Which task. The holds count by the rule of `held`, for one holder at a time,
in two levels: first the agent that made the commit, then, for a subagent, the
session's own holder, and for the session's own holder its subagents. The first
level that holds anything decides:

- one task: the commit goes to it;
- several: to the one whose projects hold the commit's project, a task naming
  none holding its space's default one; with several such, or none, the commit
  goes nowhere and the answer names them, or every task held when none fits;
- none at either level: to the task the session closed last, into review or
  completed, within `RECENT_CLOSE`, the same two levels deciding, when its
  projects hold the commit's; otherwise nowhere, and the answer recalls the rule.

An attachment gives the task the commit's project with the source `commits`
(`item_projects.put_from_commit`) and one `commit_attached` event, both signed
`valkama`: Valkama attaches it, whoever made the commit, whose session and agent
the commit's row carries.

By hand. `attach` and `detach` are the `commits` group of a batch: whoever calls
attaches a commit to any item, a goal or stage too, signed `manual`. A hash
prefix is expanded by the project's own repository; a commit Valkama did not
know is recorded without a session. A goal or stage holds no projects, so a
commit gives one only to a task, and detaching the last commit of a project a
task holds by its commits takes that project away (the projects rule).
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from .. import git_worktrees
from ..projects import project_registry
from . import calls, held, item_projects, model, read_model

#: The tool a client hook's own call is bound under (`calls.bind`): what it writes is
#: Valkama's, and the session and agent of the commit live on the commit's row.
HOOK_TOOL = "commit-hook"
#: Who an attachment the server makes is signed by, in its row and its event.
AUTHOR = calls.VALKAMA
#: How long after the session closed a task a commit holding nothing still goes to it.
RECENT_CLOSE = 30 * 60
#: The categories a close moves into: review, since entering it ends the claim, and
#: completed. Cancelled work takes no commit.
CLOSED_CATEGORIES = ("review", "completed")
#: How many commit lines one answer gives before the one that counts the rest.
MOST_LINES = 5
#: The digits a line shows of a hash, and the characters of a subject.
SHORT_HASH = 9
SUBJECT_LIMIT = 72

#: The newest move of a session's confirmed call, or of one holder of it, into a state
#: of `CLOSED_CATEGORIES` on a task, since a time; and how many whole minutes ago. A
#: move logs the key of the state it reached, before `: ` and a note when there is one.
_RECENT = (
    "SELECT w.work_item_id, p.key, w.number,"
    " CAST((julianday(:now) - julianday(e.created_at)) * 1440 AS INTEGER)"
    " FROM execution_events c"
    " JOIN work_item_events e ON e.work_item_id = c.work_item_id AND e.call_id = c.id"
    " JOIN work_items w ON w.work_item_id = e.work_item_id"
    " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
    " JOIN workflow_states st ON st.workflow_id = w.workflow_id AND st.key ="
    " CASE WHEN instr(e.detail, ': ') > 0 THEN substr(e.detail, 1, instr(e.detail, ': ') - 1)"
    " ELSE e.detail END"
    " WHERE c.session_id = :session AND c.kind = :kind AND c.identity_state = :confirmed"
    " AND {agent} AND e.action = 'transitioned'"
    " AND st.category IN (SELECT value FROM json_each(:categories))"
    " AND w.kind IN (SELECT value FROM json_each(:kinds))"
    " AND julianday(e.created_at) >= julianday(:now) - :window / 86400.0"
    " AND julianday(e.created_at) <= julianday(:now)"
    " ORDER BY e.id DESC LIMIT 1"
)
_AGENT_CLAUSES = {
    "own": "c.agent_id IS NULL",
    "agent": "c.agent_id = :agent",
    "agents": "c.agent_id IS NOT NULL",
}


@dataclass(frozen=True)
class Hook:
    """The client hook taking records: its client, its session and, inside a subagent,
    the agent; `now` is when it reported the commits."""

    client: str
    session_id: str
    agent_id: str | None
    now: str


@dataclass
class Taken:
    """What one `take` did: the lines that answer the agent, the files of the records that
    changed the store, and those that changed nothing (worked off)."""

    lines: list[str] = field(default_factory=list)
    applied: list[str] = field(default_factory=list)
    worked_off: list[str] = field(default_factory=list)

    @property
    def done(self) -> list[str]:
        """Every file `take` is through with, to delete once the transaction commits."""

        return [*self.applied, *self.worked_off]

    @property
    def answer(self) -> str:
        """The lines for the agent, at most `MOST_LINES` and one that counts the rest."""

        shown = self.lines[:MOST_LINES]
        rest = len(self.lines) - len(shown)
        if rest:
            shown.append(f"And {rest} more commits: see the cards.")
        return "\n".join(shown)


@dataclass(frozen=True)
class _Commit:
    commit_id: int
    project_id: str
    hash: str
    subject: str

    def named(self) -> str:
        subject = self.subject
        if len(subject) > SUBJECT_LIMIT:
            subject = subject[: SUBJECT_LIMIT - 1] + "…"
        return f'{self.project_id} {self.hash[:SHORT_HASH]} "{subject}"'


@dataclass(frozen=True)
class _Task:
    work_item_id: str
    reference: str
    key: tuple[str, int]


@dataclass(frozen=True)
class _Level:
    """One holder level: the agent's own holds, or the session's other ones."""

    holder: str  # "agent", "own" or "agents"
    agent: str | None
    first: bool


class _Decision:
    """The holds and the registry one `take` reads, each once, for every commit in it."""

    def __init__(self, conn: sqlite3.Connection, hook: Hook) -> None:
        self.conn = conn
        self.hook = hook
        self._holds: dict[tuple[str, str | None], list[_Task]] = {}
        self._listing: project_registry.RegistryResult | None = None

    def levels(self, agent: str | None) -> list[_Level]:
        if agent:
            return [_Level("agent", agent, True), _Level("own", None, False)]
        return [_Level("own", None, True), _Level("agents", None, False)]

    def holds(self, level: _Level) -> list[_Task]:
        key = (level.holder, level.agent)
        if key not in self._holds:
            session = self.hook.session_id
            rows = (
                held.held_by_agents(self.conn, session)
                if level.holder == "agents"
                else held.held_by_holder(self.conn, session, level.agent)
            )
            tasks = [
                _Task(
                    str(row["work_item_id"]),
                    model.human_id(str(row["space_key"]), int(row["number"])),
                    (str(row["space_key"]), int(row["number"])),
                )
                for row in rows
                if str(row["kind"]) in model.TASK_KINDS
            ]
            self._holds[key] = sorted(tasks, key=lambda task: task.key)
        return self._holds[key]

    def fits(self, task: _Task, project_id: str) -> bool:
        """Whether the task's projects hold this one: its space's default when it names none."""

        if self._listing is None:
            self._listing = project_registry.read_registry()
        roots = item_projects.project_roots(self.conn, task.work_item_id, listing=self._listing)
        return any(root["project_id"] == project_id for root in roots)

    def recent(self, level: _Level) -> tuple[_Task, int] | None:
        """The task this level closed last within `RECENT_CLOSE`, and how many minutes ago."""

        found = self.conn.execute(
            _RECENT.format(agent=_AGENT_CLAUSES[level.holder]),
            {
                "now": self.hook.now,
                "session": self.hook.session_id,
                "kind": calls.KIND,
                "confirmed": calls.CONFIRMED,
                "agent": level.agent,
                "categories": json.dumps(CLOSED_CATEGORIES),
                "kinds": json.dumps(sorted(model.TASK_KINDS)),
                "window": RECENT_CLOSE,
            },
        ).fetchone()
        if found is None:
            return None
        task = _Task(
            str(found[0]), model.human_id(str(found[1]), int(found[2])), (found[1], found[2])
        )
        return task, max(int(found[3]), 0)


def agent_of(hook: Hook, record: dict) -> str | None:
    """Which agent made the record's commits.

    The hook input's `agent_id` when it has one. Codex gives a subagent born of a
    thread its own thread id, which the shell's `CODEX_THREAD_ID` carries, while its
    hooks carry the parent's session: a record whose thread is not the session is
    that agent's.
    """

    if hook.agent_id:
        return hook.agent_id
    codex = record.get("codex")
    if hook.client == "codex" and isinstance(codex, dict):
        thread = codex.get("thread_id")
        if isinstance(thread, str) and thread and thread != hook.session_id:
            return thread
    return None


def take(conn: sqlite3.Connection, records: Iterable[tuple[str, dict]], hook: Hook) -> Taken:
    """Record the commits of each record inside the caller's transaction, oldest first,
    and attach each new one; the lines that tell the agent where each went."""

    taken = Taken()
    decision = _Decision(conn, hook)
    for path, record in records:
        agent = agent_of(hook, record)
        changed = False
        for commit in record["commits"]:
            cursor = conn.execute(
                "INSERT OR IGNORE INTO commits(project_id, hash, subject, committed_at,"
                " session_id, agent_id, client, reported_at) VALUES (?,?,?,?,?,?,?,?)",
                (
                    record["project_id"],
                    commit["hash"],
                    commit["subject"],
                    commit["committed_at"],
                    hook.session_id,
                    agent,
                    hook.client,
                    hook.now,
                ),
            )
            if cursor.rowcount > 0 and cursor.lastrowid is not None:
                changed = True
                made = _Commit(
                    cursor.lastrowid,
                    str(record["project_id"]),
                    str(commit["hash"]),
                    str(commit["subject"]),
                )
                taken.lines.append(_place(conn, decision, made, agent))
        (taken.applied if changed else taken.worked_off).append(path)
    return taken


def _place(
    conn: sqlite3.Connection, decision: _Decision, commit: _Commit, agent: str | None
) -> str:
    """Attach one new commit where its holder's work is, and the line that says so."""

    levels = decision.levels(agent)
    for level in levels:
        tasks = decision.holds(level)
        if not tasks:
            continue
        if len(tasks) == 1:
            return _attached(conn, commit, tasks[0], level)
        fitting = [task for task in tasks if decision.fits(task, commit.project_id)]
        if len(fitting) == 1:
            return _attached(conn, commit, fitting[0], level)
        named = fitting or tasks
        return (
            f"Your commit {commit.named()} fits {_listed([task.reference for task in named])},"
            " which you hold. Attach it to the right one: apply_work_item_changes"
            f' {{"id": "<REF>", "commits": [{{"repository": "{commit.project_id}",'
            f' "hash": "{commit.hash[:SHORT_HASH]}"}}]}}.'
        )
    for level in levels:
        found = decision.recent(level)
        if found is None:
            continue
        task, minutes = found
        if decision.fits(task, commit.project_id):
            _attach(conn, commit, task)
            return (
                f"Valkama attached your commit {commit.named()} to {task.reference}, which you"
                f" closed {minutes} min ago. If it belongs elsewhere, move it with the commits"
                " group of apply_work_item_changes."
            )
        break
    return (
        f"Your commit {commit.named()} is on no card: you hold no task it fits. Claim the task"
        " before the work; to attach this commit, use the commits group of"
        " apply_work_item_changes on its card."
    )


def _attached(conn: sqlite3.Connection, commit: _Commit, task: _Task, level: _Level) -> str:
    _attach(conn, commit, task)
    whose = "" if level.first else ", which your session holds"
    return f"Valkama attached your commit {commit.named()} to {task.reference}{whose}."


def _attach(conn: sqlite3.Connection, commit: _Commit, task: _Task) -> None:
    """The attachment, the task's project from it and its event, once per pair."""

    call = calls.call_id(conn, task.work_item_id)
    cursor = conn.execute(
        "INSERT OR IGNORE INTO work_item_commits(work_item_id, commit_id, attached_by, author,"
        " call_id) VALUES (?,?,'server',?,?)",
        (task.work_item_id, commit.commit_id, AUTHOR, call),
    )
    if cursor.rowcount <= 0:
        return
    item_projects.put_from_commit(conn, task.work_item_id, commit.project_id)
    pair = {"repository": commit.project_id, "hash": commit.hash}
    _commit_event(conn, task.work_item_id, "commit_attached", pair, AUTHOR, call)


def _listed(references: Sequence[str]) -> str:
    if len(references) == 1:
        return references[0]
    return ", ".join(references[:-1]) + " and " + references[-1]


# -- by hand -------------------------------------------------------------------

#: A hash or its start: at least seven hex digits, as a commit row holds one.
_HASH = re.compile(r"[0-9a-f]{7,64}")
#: The lengths of a whole SHA-1 and SHA-256 hash.
_WHOLE = (40, 64)
#: How long the project's repository may take to answer one question.
_GIT_SECONDS = 10.0
#: What one entry of the group did, as `applied.commits` lists it.
ATTACHED = "attached"
REMOVED = "removed"
UNCHANGED = "unchanged"


def attach(
    conn: sqlite3.Connection,
    reference: str,
    repository: str,
    hash_text: str,
    *,
    label: str = "",
    author: str | None = None,
) -> tuple[str, dict]:
    """Attach one commit to an item by hand: `attached`, or `unchanged` when it was there.

    `repository` is a registered project's id and `hash_text` a whole hash or a
    start of at least seven digits, which the project's root expands. A commit
    Valkama did not know is recorded here, with no session.
    """

    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    row = read_model.item_row(conn, reference)
    identity = str(row["work_item_id"])
    project = _registered(repository)
    whole = _resolved(project, _hash(hash_text, repository))
    commit_id = _commit_id(conn, project, whole)
    call = calls.call_id(conn, identity)
    actor = model.actor(author)
    cursor = conn.execute(
        "INSERT OR IGNORE INTO work_item_commits(work_item_id, commit_id, attached_by, label,"
        " author, call_id) VALUES (?,?,'manual',?,?,?)",
        (
            identity,
            commit_id,
            model.text_field(label, "commits.label", limit=200, required=False),
            actor,
            call,
        ),
    )
    pair = {"repository": repository, "hash": whole}
    if cursor.rowcount <= 0:
        return UNCHANGED, pair
    if str(row["kind"]) != model.CONTAINER_KIND:
        item_projects.put_from_commit(conn, identity, repository)
    _commit_event(conn, identity, "commit_attached", pair, actor, call)
    return ATTACHED, pair


def detach(
    conn: sqlite3.Connection,
    reference: str,
    repository: str,
    hash_text: str,
    *,
    author: str | None = None,
) -> tuple[str, dict]:
    """Take one commit off an item: `removed`. The commit stays, and a session's commit
    attached nowhere else is on no card again.

    The hash, whole or a start, names one of the commits attached to the item, so
    no repository is asked. The task loses the commit's project when it held it
    by its commits alone and no other attached commit is of that project.
    """

    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    row = read_model.item_row(conn, reference)
    identity = str(row["work_item_id"])
    wanted = _hash(hash_text, repository)
    found = conn.execute(
        "SELECT c.commit_id, c.hash FROM work_item_commits a"
        " JOIN commits c ON c.commit_id = a.commit_id"
        " WHERE a.work_item_id = ? AND c.project_id = ? AND substr(c.hash, 1, ?) = ?",
        (identity, repository, len(wanted), wanted),
    ).fetchall()
    if not found:
        raise model.PlanningError(
            f"[commit] {repository} {wanted} is not attached to {read_model.reference(conn, row)}"
        )
    if len(found) > 1:
        raise model.PlanningError(
            f"[commit] {wanted} is ambiguous in {repository}: send more digits"
        )
    commit_id, whole = int(found[0][0]), str(found[0][1])
    conn.execute(
        "DELETE FROM work_item_commits WHERE work_item_id = ? AND commit_id = ?",
        (identity, commit_id),
    )
    if str(row["kind"]) != model.CONTAINER_KIND:
        _drop_project(conn, identity, repository)
    pair = {"repository": repository, "hash": whole}
    _commit_event(
        conn, identity, "commit_detached", pair, model.actor(author), calls.call_id(conn, identity)
    )
    return REMOVED, pair


def tally(done: dict[str, Any] | None, outcome: str, pair: dict) -> dict[str, Any]:
    """What the group's entries did so far, with one more: `applied.commits`."""

    found: dict[str, Any] = done if done is not None else {ATTACHED: [], REMOVED: [], UNCHANGED: 0}
    if outcome == UNCHANGED:
        found[UNCHANGED] += 1
    else:
        found[outcome].append(pair)
    return found


def _hash(text: str, repository: str) -> str:
    """The hash as a row holds it, in lower case; refused when it cannot be one."""

    value = text.strip().lower()
    if not _HASH.fullmatch(value):
        raise model.PlanningError(f"[commit] {text} is not a commit in {repository}")
    return value


def _registered(repository: str) -> dict[str, str]:
    """The project's id and root from the registry, refused with the ids when it has none."""

    listing = project_registry.read_registry()
    if listing["status"] != "available":
        raise model.PlanningError(item_projects.REGISTRY_UNREADABLE)
    roots = {
        str(entry["project_id"]): str(entry["canonical_root"]) for entry in listing["projects"]
    }
    if repository not in roots:
        raise model.PlanningError(
            f"[commit] {repository} is not a registered project: {', '.join(sorted(roots))}"
        )
    return {"project_id": repository, "root": roots[repository]}


def _rooted(project: dict[str, str]) -> bool:
    """Whether the project's root is a repository on this machine.

    A root without a `.git` of its own is not: Git would answer from the
    repository around it. A linked worktree's `.git` is a file, and it is one.
    """

    return os.path.exists(os.path.join(project["root"], ".git"))


def _resolved(project: dict[str, str], wanted: str) -> str:
    """The whole hash of the commit `wanted` starts, as the project's repository has it.

    A project whose root this machine lacks takes a whole hash as it is and
    cannot expand a start of one.
    """

    repository, root = project["project_id"], project["root"]
    if not _rooted(project):
        if len(wanted) in _WHOLE:
            return wanted
        raise model.PlanningError(
            f"[commit] {repository} has no root on this machine, so the short hash {wanted}"
            " cannot be resolved: send the full hash"
        )
    found = git_worktrees.git_text(
        root, "rev-parse", "--verify", "--quiet", f"{wanted}^{{commit}}", timeout=_GIT_SECONDS
    )
    whole = found.stdout.strip()
    # A branch or a tag named like a hash resolves too, to a commit its digits do not name.
    if found.returncode == 0 and whole.startswith(wanted):
        return whole
    candidates = git_worktrees.git_text(
        root, "rev-parse", f"--disambiguate={wanted}", timeout=_GIT_SECONDS
    )
    if candidates.returncode == 0 and len(candidates.stdout.split()) > 1:
        raise model.PlanningError(
            f"[commit] {wanted} is ambiguous in {repository}: send more digits"
        )
    raise model.PlanningError(f"[commit] {wanted} is not a commit in {repository}")


def _described(project: dict[str, str], whole: str) -> tuple[str, str | None]:
    """The commit's subject and committer time, or nothing known without its root."""

    if not _rooted(project):
        return "", None
    logged = git_worktrees.git_text(
        project["root"],
        "-c",
        "i18n.logOutputEncoding=UTF-8",
        "log",
        "--no-walk",
        "--format=%cI%x00%s",
        whole,
        timeout=_GIT_SECONDS,
        # Shown to a person: the hash that decides where the commit goes was read strictly.
        errors="replace",
    )
    committed_at, _, subject = logged.stdout.rstrip("\n").partition("\x00")
    if logged.returncode != 0 or not committed_at:
        return "", None
    return subject, committed_at


def _commit_id(conn: sqlite3.Connection, project: dict[str, str], whole: str) -> int:
    """The row of the pair, recorded now without a session when Valkama did not know it."""

    found = conn.execute(
        "SELECT commit_id FROM commits WHERE COALESCE(project_id, '') = ? AND hash = ?",
        (project["project_id"], whole),
    ).fetchone()
    if found is not None:
        return int(found[0])
    subject, committed_at = _described(project, whole)
    cursor = conn.execute(
        "INSERT INTO commits(project_id, hash, subject, committed_at, reported_at)"
        " VALUES (?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        (project["project_id"], whole, subject, committed_at),
    )
    if cursor.lastrowid is None:
        raise model.PlanningError("the commit could not be recorded")
    return int(cursor.lastrowid)


def _drop_project(conn: sqlite3.Connection, identity: str, project_id: str) -> None:
    """Take off a project the task holds by its commits alone once none attached is of it."""

    conn.execute(
        "DELETE FROM work_item_projects WHERE work_item_id = :item AND project_id = :project"
        " AND source = :source AND NOT EXISTS (SELECT 1 FROM work_item_commits a"
        " JOIN commits c ON c.commit_id = a.commit_id WHERE a.work_item_id = :item"
        " AND c.project_id = :project AND c.rewritten_to IS NULL)",
        {"item": identity, "project": project_id, "source": item_projects.COMMITS},
    )


def _commit_event(
    conn: sqlite3.Connection,
    identity: str,
    action: str,
    pair: dict,
    author: str,
    call: int | None,
) -> None:
    conn.execute(
        "INSERT INTO work_item_events(work_item_id, action, detail, author, call_id)"
        " VALUES (?,?,?,?,?)",
        (
            identity,
            model.event_action(action),
            f"{pair['repository']} {pair['hash']}",
            author,
            call,
        ),
    )
