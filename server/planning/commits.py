"""The commits Valkama knows, taken from the records the Git hook leaves.

A commit is the pair of a registry project and a hash: one row of `commits`, with
the session, agent and client of the hook that reported it. The Git hook writes
no store; it leaves a record beside it (`hooks.commit_records`), and the client
hook of the session that made the commit takes it here, in a transaction of its
own, after the shell call the commit was made in.

`take` records the commits of each record, strictly by the time it was written,
and attaches each new one to the task its agent works on. Taking a record twice
inserts nothing the second time: the pair is unique, and only a commit inserted
now is attached. A record that changes nothing is worked off, and whoever reads
it may delete its file, inside a transaction not yet committed as well: what
makes it worked off is either committed already or written in that same
transaction from a file nobody deletes before it commits.

A rewrite, an amend or a rebase, carries the links of each old commit Valkama
knows to its new one and marks the old one `rewritten_to` it (`_rewrite`); a
squash unites the links of its old commits. A commit that a rewrite in the same
batch replaces is not decided on its own, so `commit && commit --amend` in one
shell call ends with one decision. A leftover, a record no hook took within its
window, and the records the sweep takes after an hour (`sweep`), are decided by
their session, their agent not being known.

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

On no card. A session's commit that no item holds and no rewrite replaced waits
on the list `unattached` reads, by a project or by the projects the registry
binds to a space, until someone attaches it.

The net at a close. A move into review or completed reads, before it ends the
claim, when the work began (`window_start`); once the write commits, the surface
that committed it asks the card's repositories for the commits made since then
that no hook reported (`unreported`), and the answer names them. Nothing is
attached: a person's commit, or one of a client without a session, may be among
them, and the agent attaches the ones that belong with the `commits` group.
"""

from __future__ import annotations

import contextlib
import contextvars
import itertools
import json
import os
import re
import sqlite3
import subprocess
import time
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, TypeVar

from .. import git_worktrees
from ..hooks import commit_records, notify
from ..projects import project_registry
from . import calls, held, item_projects, leases, model, read_model, request_model, service

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


def take(conn: sqlite3.Connection, records: Iterable[tuple[str, dict, bool]], hook: Hook) -> Taken:
    """Take records inside the caller's transaction, strictly by the time each was written;
    the lines that tell the agent where each commit went.

    Each record comes with its file and whether it is a leftover, whose agent is
    not known, so its session decides. A commit a rewrite in this same batch
    replaces, the old commit known by then, is recorded without a decision of its
    own: the rewrite gives it the old one's links when its turn comes, so an amend
    reported twice is decided once.
    """

    taken = Taken()
    decision = _Decision(conn, hook)
    batch = sorted(records, key=lambda found: str(found[1]["occurred_at"]))
    replacing: dict[tuple[str, str], list[str]] = {}
    for _path, record, _leftover in batch:
        for pair in record["rewritten"]:
            replacing.setdefault((str(record["project_id"]), pair["to"]), []).append(pair["from"])
    for path, record, leftover in batch:
        if record["rewrite"] is None:
            agent = None if leftover else agent_of(hook, record)
            changed = _record(conn, decision, record, agent, replacing, taken.lines)
        else:
            changed = _rewrite(conn, record, hook, taken.lines)
        (taken.applied if changed else taken.worked_off).append(path)
    return taken


def _record(
    conn: sqlite3.Connection,
    decision: _Decision,
    record: dict,
    agent: str | None,
    replacing: dict[tuple[str, str], list[str]],
    lines: list[str],
) -> bool:
    """Record the commits a commit or a merge reported and place each new one; whether any
    was new."""

    hook = decision.hook
    project_id = str(record["project_id"])
    changed = False
    for commit in record["commits"]:
        made = _insert(conn, project_id, commit, (hook.session_id, agent, hook.client), hook.now)
        if made is None:
            continue
        changed = True
        olds = replacing.get((project_id, made.hash), [])
        if any(_known(conn, project_id, old) is not None for old in olds):
            continue  # the rewrite that replaces a known commit with it brings its links
        lines.append(_place(conn, decision, made, agent))
    return changed


def _insert(
    conn: sqlite3.Connection,
    project_id: str,
    commit: dict,
    who: tuple[str | None, str | None, str | None],
    now: str,
) -> _Commit | None:
    """The commit's row, inserted now; None when the pair is recorded already."""

    session_id, agent_id, client = who
    cursor = conn.execute(
        "INSERT OR IGNORE INTO commits(project_id, hash, subject, committed_at,"
        " session_id, agent_id, client, reported_at) VALUES (?,?,?,?,?,?,?,?)",
        (
            project_id,
            commit["hash"],
            commit["subject"],
            commit["committed_at"],
            session_id,
            agent_id,
            client,
            now,
        ),
    )
    if cursor.rowcount <= 0 or cursor.lastrowid is None:
        return None
    return _Commit(cursor.lastrowid, project_id, str(commit["hash"]), str(commit["subject"]))


def _known(conn: sqlite3.Connection, project_id: str, commit_hash: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT commit_id, session_id, agent_id, client, rewritten_to FROM commits"
        " WHERE COALESCE(project_id, '') = ? AND hash = ?",
        (project_id, commit_hash),
    ).fetchone()


def _rewrite(conn: sqlite3.Connection, record: dict, hook: Hook, lines: list[str]) -> bool:
    """Carry each known old commit's links to its new one; whether anything changed.

    The new commit gets a row with the old one's session and agent unless it has
    one, the old one's attachments move to it (several old ones of a squash unite
    there), and the old one is marked `rewritten_to` it, once: a mark already set
    stays, so taking the record again changes nothing. A card's projects stay as
    they are, the repository being the same. An old commit Valkama does not know
    gives nothing: after an amend its new commit is the session's own and its
    `post-commit` decides it, and a rebase of commits nobody reported is no new work.
    """

    project_id = str(record["project_id"])
    details = {str(commit["hash"]): commit for commit in record["commits"]}
    changed = False
    for pair in record["rewritten"]:
        old = _known(conn, project_id, pair["from"])
        if old is None or pair["to"] not in details:
            continue
        new = _known(conn, project_id, pair["to"])
        if new is None:
            who = (old["session_id"], old["agent_id"], old["client"])
            made = _insert(conn, project_id, details[pair["to"]], who, hook.now)
            new_id = made.commit_id if made is not None else None
            changed = True
        else:
            new_id = int(new["commit_id"])
        if new_id is None or new_id == int(old["commit_id"]):
            continue
        moved = conn.execute(
            "UPDATE OR IGNORE work_item_commits SET commit_id = ? WHERE commit_id = ?",
            (new_id, old["commit_id"]),
        ).rowcount
        moved += conn.execute(
            "DELETE FROM work_item_commits WHERE commit_id = ?", (old["commit_id"],)
        ).rowcount
        if old["rewritten_to"] is None:
            conn.execute(
                "UPDATE commits SET rewritten_to = ? WHERE commit_id = ?",
                (new_id, old["commit_id"]),
            )
            changed = True
        if moved > 0:
            changed = True
            lines.append(
                f"Valkama moved the links of {project_id} {pair['from'][:SHORT_HASH]}"
                f" to the rewritten commit {pair['to'][:SHORT_HASH]}."
            )
    return changed


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


# -- the sweep's step ------------------------------------------------------------

#: How old a record no client hook took is when the planning sweep takes it.
SWEEP_AGE_NS = 60 * 60 * 1_000_000_000
#: How old a file that is no record is when the sweep sets it aside in `rejected/`.
REJECT_AGE_NS = 7 * 24 * 60 * 60 * 1_000_000_000


def _now_ns() -> int:
    now = leases.utc_now()
    return int(now.timestamp()) * 1_000_000_000 + now.microsecond * 1_000


def _due(
    conn: sqlite3.Connection, now_ns: int
) -> Iterator[tuple[str, dict, tuple[str, str]] | str]:
    """The records the sweep takes now, oldest first: each with its file and whose it is,
    or, for a file that is no record of anyone's and is past `REJECT_AGE_NS`, its path.

    One that cannot be read and is younger than that is neither: it waits.
    """

    for at, key, path in _files(conn):
        if at > now_ns - SWEEP_AGE_NS:
            break
        record = commit_records.read(path, notify.loads)
        owner = _owner(record, key) if record is not None else None
        if record is not None and owner is not None:
            yield path, record, owner
        elif at <= now_ns - REJECT_AGE_NS:
            yield path


def _files(conn: sqlite3.Connection) -> list[tuple[int, str, str]]:
    """Every record file, oldest first: its time, session key and path.

    Records wait beside the store this connection is open on and in the Git
    directory of each registered project, as a client hook looks for them.
    """

    databases = conn.execute("PRAGMA database_list").fetchall()
    store_path = next((str(row[2]) for row in databases if row[1] == "main" and row[2]), None)
    if store_path is None:
        return []
    return commit_records.every(commit_records.record_directories(store_path, notify.loads))


def sweep_pending(conn: sqlite3.Connection) -> bool:
    """Whether a record has waited past `SWEEP_AGE_NS`; read without the write lock."""

    return next(_due(conn, _now_ns()), None) is not None


def sweep(conn: sqlite3.Connection, *, limit: int) -> int:
    """The planning sweep's step: take the oldest `limit` records nobody took for an hour.

    Each is decided by the session its file is named for, as a leftover is: which
    agent made it is not known. The step answers nobody. It runs inside the pass's
    transaction and has no moment after it commits, so it deletes only the records
    that changed nothing, which whatever made them so has committed already or
    writes in this transaction: a record it applied stays until the next pass or
    its session's hook finds it worked off. A file that is no record goes to
    `rejected/` once it is a week old. How many records changed the store.
    """

    now_ns = _now_ns()
    batches: dict[tuple[str, str], list[tuple[str, dict, bool]]] = {}
    for due in itertools.islice(_due(conn, now_ns), limit):
        if isinstance(due, str):
            commit_records.reject(due)
            continue
        path, record, owner = due
        batches.setdefault(owner, []).append((path, record, True))
    changed = 0
    for (client, session), records in batches.items():
        hook = Hook(client, session, None, commit_records.timestamp(now_ns))
        taken = take(conn, records, hook)
        changed += len(taken.applied)
        for path in taken.worked_off:
            commit_records.remove(path)
    return changed


def _owner(record: dict, key: str) -> tuple[str, str] | None:
    """The client and session whose file this record is, by the key of its name."""

    for client in ("claude", "codex"):
        own = record.get(client)
        if isinstance(own, dict) and commit_records.file_key(str(own["session_id"])) == key:
            return client, str(own["session_id"])
    return None


# -- the net at a close ------------------------------------------------------------

#: How many commits one close names at most; `unreported_total` counts them all past it.
UNREPORTED_MOST = 20
#: How long one root's repository may take to say what was made in it.
NET_SECONDS = 5.0
#: What the net reads of each commit: its hash, committer time and address, and subject.
_NET_FORMAT = "--format=%H%x00%cI%x00%ce%x00%s"
#: When the call that took the item's claim was received: the lease's `acquired_at`.
_CLAIM_RECEIVED = "SELECT received_at FROM execution_events WHERE id = ?"
#: The newest claim or takeover of a step, by its text, or of the item, by a confirmed
#: call of one session.
_STEP_TAKEN = (
    "SELECT MAX(e.created_at) FROM work_item_events e JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.work_item_id = ? AND e.detail = ?"
    " AND e.action IN ('checklist_claimed', 'checklist_taken_over')"
    " AND c.session_id = ? AND c.identity_state = ?"
)
_ITEM_TAKEN = (
    "SELECT MAX(e.created_at) FROM work_item_events e JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.work_item_id = ? AND e.action IN ('claimed', 'taken_over')"
    " AND c.session_id = ? AND c.identity_state = ?"
)


@dataclass(frozen=True)
class Window:
    """A close the net looks behind: the item, the second its work began, and the session
    that closed it, None for a call no session proved."""

    work_item_id: str
    since: int
    session: str | None


@dataclass(frozen=True)
class Before:
    """The item as a transition found it: its state, and where its window would start."""

    work_item_id: str
    state_id: str
    since: int | None
    session: str | None


_WINDOWS: contextvars.ContextVar[list[Window] | None] = contextvars.ContextVar(
    "valkama_commit_net", default=None
)
_T = TypeVar("_T")


@contextlib.contextmanager
def closes() -> Iterator[list[Window]]:
    """Collect the windows of the closes written inside, for `with_unreported` once the
    write commits.

    A surface opens it around one write it commits itself; a transition outside it
    leaves nothing, so a write whose caller commits later never looks for commits.
    A write that fails leaves the block with its windows unread.
    """

    found: list[Window] = []
    token = _WINDOWS.set(found)
    try:
        yield found
    finally:
        _WINDOWS.reset(token)


def before_transition(
    conn: sqlite3.Connection, reference: str, author: str | None
) -> Before | None:
    """What the net needs of an item before a transition ends its claim and steps.

    Read under the write's own lock, so nothing lands between it and the move.
    None outside `closes`, which reads nothing.
    """

    if _WINDOWS.get() is None:
        return None
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    row = read_model.item_row(conn, reference)
    return Before(
        str(row["work_item_id"]),
        str(row["state_id"]),
        window_start(conn, row, author),
        calls.confirmed_session(),
    )


def after_transition(before: Before | None, answer: Mapping[str, Any]) -> None:
    """Note the window of a move into review or completed that `before` found one for."""

    found = _WINDOWS.get()
    state = answer.get("state")
    if found is None or before is None or before.since is None or not isinstance(state, dict):
        return
    if state["category"] in CLOSED_CATEGORIES and state["state_id"] != before.state_id:
        found.append(Window(before.work_item_id, before.since, before.session))


def window_start(conn: sqlite3.Connection, row: sqlite3.Row, author: str | None) -> int | None:
    """The second the work a close ends began, by the first rule that holds; None for none.

    1. The item's claim: when the call that took it was received.
    2. Else the caller's holder holds a step: the newest claim or takeover of that
       step by a call of its session; the earliest such start when it holds several.
    3. Else the newest claim or takeover of the item by a call of the closing
       session, as at a close from review, whose entry ended the claim.
    4. Else no window: a session that never held the item made nothing for it.
    """

    # A store an earlier build wrote, read as it is, has no `claim_call_id` (`leases`);
    # `in row` would search a Row's values, not its names.
    columns = row.keys()
    if row["claim_ref"] and "claim_call_id" in columns and row["claim_call_id"] is not None:
        received = conn.execute(_CLAIM_RECEIVED, (int(row["claim_call_id"]),)).fetchone()
        claimed = leases.moment(received[0]) if received is not None else None
        if claimed is not None:
            return int(claimed.timestamp())
    session = calls.confirmed_session()
    if session is None:
        return None
    holder = calls.holder(author)
    taken = [
        conn.execute(
            _STEP_TAKEN, (row["work_item_id"], step["text"][:120], session, calls.CONFIRMED)
        ).fetchone()[0]
        for step in model.checklist(row["checklist"])
        if not step["done"] and step["claimed_by"] == holder
    ]
    starts = [moment for moment in map(leases.moment, taken) if moment is not None]
    if not row["claim_ref"] and starts:
        return int(min(starts).timestamp())
    last = conn.execute(_ITEM_TAKEN, (row["work_item_id"], session, calls.CONFIRMED)).fetchone()
    found = leases.moment(last[0]) if last is not None else None
    return int(found.timestamp()) if found is not None else None


def with_unreported(conn: sqlite3.Connection, windows: Sequence[Window], answer: _T) -> _T:
    """A committed write's answer, a dict, with what `unreported` found behind its closes
    added to it; the line goes among its `warnings`."""

    if not windows or not isinstance(answer, dict):
        return answer
    found = unreported(conn, windows)
    line = found.pop("line", None)
    if line is not None:
        answer["warnings"] = [*answer.get("warnings", []), line]
    answer.update(found)
    return answer


def unreported(conn: sqlite3.Connection, windows: Sequence[Window]) -> dict[str, Any]:
    """The commits made behind these closes that no hook reported, read after they commit.

    First the records still waiting for a closing session or for a commit in a
    closed card's projects are taken, in a transaction of their own, so a commit a
    hook did report is known before anything is named. Then each mapped root of
    the card's projects with a repository of its own is asked, outside any
    transaction, for the commits its branches, tags and HEAD gained since the
    window began whose committer address is the one Git commits with there: not
    `refs/stash`, not a remote's branches, not somebody else's commits a pull
    brought. A commit `commits` does not hold for its project is named, at most
    `UNREPORTED_MOST`, with `unreported_total` past that; a root that did not
    answer is named in `unreported_unread`. Each field is there only when it is
    not empty, and `line` says the names to the agent. Nothing is attached.
    """

    listing = project_registry.read_registry()
    roots = {
        window: item_projects.project_roots(conn, window.work_item_id, listing=listing)
        for window in windows
    }
    _take_waiting(conn, windows, roots)
    named: dict[tuple[str, str], dict] = {}
    unread: list[str] = []
    for window in windows:
        for root in roots[window]:
            project_id = str(root["project_id"])
            if root["status"] != "mapped" or not rooted(root):
                continue
            made = _made_since(str(root["root"]), window.since)
            if made is None:
                unread.append(project_id)
                continue
            known = _recorded(conn, project_id, [commit["hash"] for commit in made])
            for commit in made:
                if commit["hash"] not in known:
                    named.setdefault(
                        (project_id, commit["hash"]), {"repository": project_id, **commit}
                    )
    return _unreported_fields(list(named.values()), unread)


def _unreported_fields(named: list[dict], unread: list[str]) -> dict[str, Any]:
    """The answer's fields, each only when it is not empty, and the line that names them."""

    found: dict[str, Any] = {}
    if named:
        shown = named[:UNREPORTED_MOST]
        found["unreported_commits"] = shown
        if len(named) > len(shown):
            found["unreported_total"] = len(named)
        names = [f"{commit['repository']} {commit['hash'][:SHORT_HASH]}" for commit in shown]
        if len(named) > len(shown):
            names.append(f"{len(named) - len(shown)} more")
        found["line"] = (
            "These commits in the card's repositories were made while you held it and no hook"
            f" reported them: {_listed(names)}. Attach the ones that belong here with the"
            " commits group."
        )
    if unread:
        found["unreported_unread"] = sorted(set(unread))
    return found


def _take_waiting(
    conn: sqlite3.Connection, windows: Sequence[Window], roots: Mapping[Window, list[dict]]
) -> None:
    """Take the records waiting for a closing session or for a commit in a closed card's
    projects, in a transaction of their own, and delete the files it is through with
    once it commits. Each is decided by the session its file is named for, as a
    leftover is. A busy store leaves them all for their session's hook or the sweep.
    """

    sessions = {window.session for window in windows if window.session is not None}
    projects = {str(root["project_id"]) for found in roots.values() for root in found}
    batches: dict[tuple[str, str], list[tuple[str, dict, bool]]] = {}
    for _at, key, path in _files(conn):
        record = commit_records.read(path, notify.loads)
        owner = _owner(record, key) if record is not None else None
        if record is None or owner is None:
            continue
        if owner[1] in sessions or str(record["project_id"]) in projects:
            batches.setdefault(owner, []).append((path, record, True))
    if not batches:
        return
    now = commit_records.timestamp(_now_ns())
    done: list[str] = []
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            with calls.bind(calls.valkama(), HOOK_TOOL):
                for (client, session), records in batches.items():
                    done += take(conn, records, Hook(client, session, None, now)).done
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    except sqlite3.Error:
        return  # busy past the connection's wait: the records wait too
    for path in done:
        commit_records.remove(path)


def _made_since(root: str, since: int) -> list[dict] | None:
    """The commits of the root's branches, tags and HEAD its own committer made since a
    second, newest first; None when the repository did not answer in `NET_SECONDS`."""

    deadline = time.monotonic() + NET_SECONDS
    try:
        own = git_worktrees.committer_address(root, timeout=NET_SECONDS)
        if own is None:
            return None
        logged = git_worktrees.git_text(
            root,
            "-c",
            "i18n.logOutputEncoding=UTF-8",
            "log",
            "--branches",
            "--tags",
            "HEAD",
            f"--since=@{since}",
            _NET_FORMAT,
            timeout=max(0.1, deadline - time.monotonic()),
            # Shown to the agent: which commits these are was read from their hashes.
            errors="replace",
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if logged.returncode != 0:
        return None
    made = []
    for line in logged.stdout.splitlines():
        whole, committed_at, address, subject = [*line.split("\x00", 3), "", "", ""][:4]
        if _HASH.fullmatch(whole) and address.lower() == own.lower():
            made.append({"hash": whole, "subject": subject, "committed_at": committed_at})
    return made


def _recorded(conn: sqlite3.Connection, project_id: str, hashes: list[str]) -> set[str]:
    """Which of these hashes `commits` holds for the project."""

    return {
        str(row[0])
        for row in conn.execute(
            "SELECT hash FROM commits WHERE project_id = ?"
            " AND hash IN (SELECT value FROM json_each(?))",
            (project_id, json.dumps(hashes)),
        )
    }


# -- on no card ----------------------------------------------------------------

#: How many commits one read of those on no card lists at most, and unasked.
UNATTACHED_MOST = 500
UNATTACHED_LIMIT = 100

#: A commit on no card: a session's, attached to no item, and not one a rewrite replaced.
#: A commit no session reported, migrated or attached by hand, is never on the list.
_ON_NO_CARD = (
    "c.session_id IS NOT NULL AND c.rewritten_to IS NULL"
    " AND NOT EXISTS (SELECT 1 FROM work_item_commits a WHERE a.commit_id = c.commit_id)"
    " AND c.project_id IN (SELECT value FROM json_each(:projects))"
)
#: When the commit was made, by its committer time, which Git gives with its offset;
#: the time Valkama learned of it when Git gave none.
_MADE = "julianday(COALESCE(c.committed_at, c.reported_at))"


def unattached(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    project: str | None = None,
    since: str | None = None,
    limit: int = UNATTACHED_LIMIT,
) -> dict[str, Any]:
    """The commits on no card of a project, or of a space's projects: `total` and `items`.

    A space's projects are those the registry binds to it. `since` keeps the commits
    made at or after a time with its offset; `total` counts every commit the scope
    and `since` keep, and `items` the newest `limit` of them, newest first.
    """

    if (space is None) == (project is None):
        raise model.PlanningError(
            "[commit] the commits on no card are read by a space or by a project: name one"
        )
    if not 0 <= limit <= UNATTACHED_MOST:
        raise model.PlanningError(f"limit must be between 0 and {UNATTACHED_MOST}")
    after = request_model.timestamp(since, "since")
    listing = _readable(project_registry.read_registry())
    if project is not None:
        projects = [registered(project, listing)["project_id"]]
    else:
        identity = service.space_identity(conn, space)
        key = conn.execute(
            "SELECT key FROM planning_spaces WHERE planning_space_id = ?", (identity,)
        ).fetchone()[0]
        projects = item_projects.space_project_ids(conn, str(key), listing=listing)
    names = {str(entry["project_id"]): str(entry["display_name"]) for entry in listing["projects"]}
    scope = f"{_ON_NO_CARD} AND (:since IS NULL OR {_MADE} >= julianday(:since))"
    parameters = {"projects": json.dumps(projects), "since": after, "limit": limit}
    counted = f"SELECT COUNT(*) FROM commits c WHERE {scope}"  # noqa: S608 - fixed clauses
    total = conn.execute(counted, parameters).fetchone()[0]
    columns = "c.project_id, c.hash, c.subject, c.committed_at, c.session_id, c.agent_id"
    newest = f"SELECT {columns}, c.client, c.reported_at FROM commits c WHERE {scope}"  # noqa: S608 - fixed clauses
    rows = conn.execute(
        f"{newest} ORDER BY {_MADE} DESC, c.commit_id DESC LIMIT :limit", parameters
    ).fetchall()
    return {
        "total": int(total),
        "items": [
            {
                "repository": row[0],
                "display_name": names.get(str(row[0])),
                "hash": row[1],
                "subject": row[2],
                "committed_at": row[3],
                "session": row[4],
                "agent": row[5],
                "client": row[6],
                "reported_at": row[7],
            }
            for row in rows
        ],
    }


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
    project = registered(repository)
    whole = _resolved(project, stored_hash(hash_text, repository))
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
    wanted = stored_hash(hash_text, repository)
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


def stored_hash(text: str, repository: str) -> str:
    """The hash as a row holds it, in lower case; refused when it cannot be one."""

    value = text.strip().lower()
    if not _HASH.fullmatch(value):
        raise model.PlanningError(f"[commit] {text} is not a commit in {repository}")
    return value


def registered(
    repository: str, listing: project_registry.RegistryResult | None = None
) -> dict[str, str]:
    """The project's id and root from the registry, refused with the ids when it has none."""

    found = _readable(project_registry.read_registry() if listing is None else listing)
    roots = {str(entry["project_id"]): str(entry["canonical_root"]) for entry in found["projects"]}
    if repository not in roots:
        raise model.PlanningError(
            f"[commit] {repository} is not a registered project: {', '.join(sorted(roots))}"
        )
    return {"project_id": repository, "root": roots[repository]}


def _readable(listing: project_registry.RegistryResult) -> project_registry.RegistryResult:
    """The registry as read, refused when it could not be: no project is known then."""

    if listing["status"] != "available":
        raise model.PlanningError(item_projects.REGISTRY_UNREADABLE)
    return listing


def rooted(project: dict[str, str]) -> bool:
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
    if not rooted(project):
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

    if not rooted(project):
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
