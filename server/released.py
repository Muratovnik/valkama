"""Which open work items have attached commits that a release's range took in.

Closing a release is when finished work should stop reading as open, and the
tracker has no way to know: a hint is the most this can honestly give. Nothing
here writes, to the store or to the repository, and no state changes. A match
says a commit shipped, not that the item is finished, so partly released work
shows too and a person decides.

An exact hash is not enough. An item usually holds the hash from the branch the
work was done on, and integrating that branch rewrites it, so the case this
exists for is the one a hash comparison misses. An attached commit is therefore
compared in steps, and the answer names the step that found it:

1. `hash`: the commit is in the range.
2. `patch-id`: the commit is outside the range, and one in the range makes the
   same change.
3. `changed-patch`: the commit is outside the range and not already in the
   history the range starts from, its patch differs, and a commit in the range
   has its subject. An integration that resolved a conflict looks like this, and
   so does an unrelated commit with a common subject, which is why it is weak.
4. `subject`: the object is gone with its branch, and a commit in the range has
   the subject recorded for it. Also weak: two commits can share a subject.

Only the commits of the checkout's own registered project are compared, and the
ones attached with no repository, by their hash; a commit of another project
lives elsewhere, so a subject here would be a coincidence.

Before a release is prepared, the same command answers a second question: which
open bugs are bound to the version about to ship (`bound_bugs`). A bug is bound by
the label `<product>-<version>`, or by standing under an open goal or stage that
carries it, and a person moves it to a later version by changing that label. The
answer refuses while one is bound, because preparing the release first would
spend the whole check on a candidate the bug keeps from shipping.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
from dataclasses import dataclass

from . import git_worktrees, processes, store
from .planning import item_tree, model, states
from .planning import service as planning_service
from .projects import project_registry, scopes
from .store_identity.metadata import read_store_metadata

# A whole range's patches are read at once, so this is not the few seconds one
# lookup gets.
_GIT_TIMEOUT = 120
# The steps that rest on a subject, which two commits can share.
_WEAK_STEPS = frozenset({"changed-patch", "subject"})
# How much of a hash the answer for a person shows.
_SHOWN = 9


class ReleasedError(ValueError):
    """The repository or the range cannot be read as asked."""


def open_store() -> sqlite3.Connection:
    """The primary store, opened so that no statement can change it.

    Not `store.connect()`: that one brings a store up, which can migrate it.
    """

    conn = scopes.open_readonly({"name": scopes.PRIMARY_SCOPE, "path": store.db_path()})
    try:
        store.refuse_another_generation(conn)
    except BaseException:
        conn.close()
        raise
    return conn


def _git(repository: str, *args: str, stdin: bytes | None = None) -> str:
    """One git command's output, with every byte it wrote recoverable.

    `surrogateescape` because a patch goes back into `git patch-id` and has to
    arrive as it left: a file in a legacy encoding changes no hash then, and a
    subject holding such bytes cannot equal a recorded one, so it matches nothing.
    """

    try:
        done = processes.run_text(
            ["git", "-C", repository, *args],
            errors="surrogateescape",
            timeout=_GIT_TIMEOUT,
            stdin=stdin,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ReleasedError(f"git unavailable: {error}") from error
    if done.returncode != 0:
        raise ReleasedError(f"git {args[0]} failed in {repository}: {done.stderr.strip()}")
    return done.stdout


def _normalized(text: str) -> str:
    return " ".join(text.split()).casefold()


def _range_start(repository: str, revisions: str) -> list[str]:
    """What the range excludes, as hashes.

    The range must exclude something: a lone tag would read as the whole history
    and put every item that ever shipped on the list.
    """

    if revisions.startswith("-"):
        raise ReleasedError("a range cannot begin with '-'")
    parsed = _git(repository, "rev-parse", revisions).split()
    start = [line[1:] for line in parsed if line.startswith("^")]
    if not start:
        raise ReleasedError(f"{revisions!r} is not a range; name both ends, as in v1.0.0..v1.1.0")
    return start


def _subjects(repository: str, *selection: str, stdin: bytes | None = None) -> dict[str, str]:
    """Each selected commit, by full hash, with its normalized subject."""

    listed = _git(
        repository, "log", "--no-show-signature", "--format=%H%x00%s", *selection, stdin=stdin
    )
    subjects: dict[str, str] = {}
    # Not `splitlines`: it also breaks on characters a subject may hold.
    for line in listed.split("\n"):
        if line:
            commit, _, subject = line.partition("\0")
            subjects[commit] = _normalized(subject)
    return subjects


def _existing_commits(repository: str, hashes: set[str]) -> dict[str, str]:
    """The full hash of each recorded hash whose commit is in this repository."""

    # One process for all of them; the answer has one line per question, in order.
    ordered = sorted(hashes)
    question = "".join(f"{value}^{{commit}}\n" for value in ordered).encode("ascii")
    answer = _git(repository, "cat-file", "--batch-check", stdin=question).split("\n")
    found: dict[str, str] = {}
    for value, line in zip(ordered, answer, strict=False):
        fields = line.split()
        if len(fields) == 3 and fields[1] == "commit":
            found[value] = fields[0]
    return found


def _patch_ids(repository: str, *selection: str, stdin: bytes | None = None) -> dict[str, str]:
    """Each selected commit's patch-id; a merge or an empty commit has none."""

    patches = _git(
        repository,
        "log",
        "-p",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--no-show-signature",
        "--format=commit %H",
        *selection,
        stdin=stdin,
    )
    listed = _git(
        repository, "patch-id", "--stable", stdin=patches.encode("utf-8", "surrogateescape")
    )
    pairs = (line.split() for line in listed.split("\n") if line)
    return {commit: patch for patch, commit in pairs}


def _project(repository: str, listing: project_registry.RegistryResult) -> dict | None:
    """The registered project whose root is this checkout, or the checkout it is linked to.

    A linked worktree is the repository of its checkout: the directory it happens
    to be in says nothing about which project it is. Nothing is guessed from a name.
    """

    top = _git(repository, "rev-parse", "--show-toplevel").strip()
    common = _git(repository, "rev-parse", "--git-common-dir").strip()
    checkout = os.path.dirname(os.path.normpath(os.path.join(repository, common)))
    projects = {
        git_worktrees.canonical(str(project["canonical_root"])): project
        for project in listing["projects"]
    }
    roots = (git_worktrees.canonical(root) for root in (top, checkout))
    return next((projects[root] for root in roots if root in projects), None)


def _open_commits(conn: sqlite3.Connection, space_id: str) -> list[sqlite3.Row]:
    """The commits attached to the open items of one space, as their cards show them."""

    return conn.execute(
        "SELECT i.work_item_id, i.number, i.title, s.key, s.name, s.category, s.is_terminal,"
        " c.project_id, c.hash, c.subject"
        " FROM work_items i"
        " JOIN workflow_states s ON s.state_id = i.state_id"
        " JOIN work_item_commits a ON a.work_item_id = i.work_item_id"
        " JOIN commits c ON c.commit_id = a.commit_id AND c.rewritten_to IS NULL"
        " WHERE i.planning_space_id = ? AND s.is_terminal = 0"
        " ORDER BY i.number, c.commit_id",
        (space_id,),
    ).fetchall()


@dataclass(frozen=True)
class _Release:
    """What the repository says about the range, read once for every commit."""

    # Each commit of the range by its subject, and by its patch-id.
    by_subject: dict[str, str]
    by_patch: dict[str, str]
    in_range: set[str]
    # The full hash of each recorded hash whose object is here.
    existing: dict[str, str]
    # The patch-id and the subject of each such commit that is outside the range.
    patch_of: dict[str, str]
    subject_of: dict[str, str]
    # Everything reachable from the range's start: it shipped in an earlier release.
    before_range: set[str]

    def compare(self, recorded: str, subject: str) -> tuple[str, str] | None:
        """The step that finds this commit and the range's commit it finds, if any."""

        commit = self.existing.get(recorded)
        if commit in self.in_range:
            return "hash", str(commit)
        if commit is not None:
            twin = self.by_patch.get(self.patch_of.get(commit, ""))
            if twin is not None:
                return "patch-id", twin
            # The same words in an earlier release are not this release's change:
            # a rebuild commit has the same subject every time.
            if commit in self.before_range:
                return None
            twin = self.by_subject.get(self.subject_of.get(commit, ""))
            return None if twin is None else ("changed-patch", twin)
        # The object is gone with its branch: the subject recorded while it was
        # known is all that is left of it.
        twin = self.by_subject.get(_normalized(subject))
        return None if twin is None else ("subject", twin)


def _read_release(repository: str, revisions: str, hashes: set[str]) -> _Release:
    start = _range_start(repository, revisions)
    subjects = _subjects(repository, "--end-of-options", revisions)
    existing = _existing_commits(repository, hashes)
    outside = sorted(set(existing.values()) - set(subjects))
    # Reading every patch of a range is the expensive part, and a commit in the
    # range or gone altogether does not need it.
    patch_of: dict[str, str] = {}
    by_patch: dict[str, str] = {}
    subject_of: dict[str, str] = {}
    before_range: set[str] = set()
    if outside:
        chosen = ("--no-walk=unsorted", "--stdin")
        listed = "\n".join(outside).encode("ascii")
        patch_of = _patch_ids(repository, *chosen, stdin=listed)
        subject_of = _subjects(repository, *chosen, stdin=listed)
        ranged = _patch_ids(repository, "--end-of-options", revisions)
        by_patch = {patch: commit for commit, patch in ranged.items()}
        before_range = set(_git(repository, "rev-list", *start).split())
    return _Release(
        by_subject={subject: commit for commit, subject in subjects.items() if subject},
        by_patch=by_patch,
        in_range=set(subjects),
        existing=existing,
        patch_of=patch_of,
        subject_of=subject_of,
        before_range=before_range,
    )


def released_items(
    conn: sqlite3.Connection, *, space: str, repository: str, revisions: str
) -> dict:
    """The open items of one space with an attached commit of `revisions` in `repository`.

    `repository` is a checkout, and `project` in the answer the registered project
    whose root it is, or null. Each item carries its matching commits with the step
    that found them and the commits that did not match, which is what tells whole
    work from partly released work. Whole work is listed first.
    """

    planning_space = planning_service.get_planning_space(conn, space)
    key = str(planning_space["key"])
    rows = _open_commits(conn, str(planning_space["planning_space_id"]))
    holder = _project(repository, project_registry.read_registry())
    project = None if holder is None else str(holder["project_id"])
    own = [row for row in rows if row["project_id"] in (None, project)]
    release = _read_release(repository, revisions, {str(row["hash"]) for row in own})
    # An accepted open goal or stage is named by what it derives, not by its service state.
    derived = item_tree.below(
        conn, [str(row["work_item_id"]) for row in rows if states.public_state(row) is None]
    )
    items: dict[int, dict] = {}
    for row in rows:
        public = states.public_state(row)
        item = items.setdefault(
            int(row["number"]),
            {
                "reference": f"{key}-{row['number']}",
                "title": row["title"],
                "state": public["name"]
                if public is not None
                else derived.container_state(str(row["work_item_id"])),
                "matched": [],
                "not_matched": [],
            },
        )
        pair = {"repository": row["project_id"], "hash": str(row["hash"])}
        found = (
            release.compare(pair["hash"], str(row["subject"]))
            if row["project_id"] in (None, project)
            else None
        )
        if found is None:
            item["not_matched"].append(pair)
        else:
            step, commit = found
            item["matched"].append(
                {**pair, "step": step, "weak": step in _WEAK_STEPS, "release_commit": commit}
            )
    shown = [item for item in items.values() if item["matched"]]
    return {
        "space": key,
        "repository": repository,
        "project": project,
        "range": revisions,
        "commits": len(release.in_range),
        # `sorted` is stable, so items keep their number order inside each group.
        "items": sorted(shown, key=lambda item: bool(item["not_matched"])),
    }


_STEP_WORDS = {
    "hash": "in the range",
    "patch-id": "same change as {commit} in the range",
    "changed-patch": "WEAK MATCH: {commit} in the range has its subject, with another patch",
    "subject": "WEAK MATCH: the object is gone; its recorded subject is that of {commit}",
}


def _shown(pair: dict) -> str:
    """One attached commit as a person reads it: its project and the start of its hash."""

    start = pair["hash"][:_SHOWN]
    return start if pair["repository"] is None else f"{pair['repository']}@{start}"


def render(report: dict) -> str:
    """The answer for a person: what to check, and how much each line is worth."""

    scope = f"{report['range']} ({report['commits']} commits)"
    unregistered = (
        []
        if report["project"] is not None
        else [
            f"{report['repository']} is no registered project's root: only commits attached"
            " with no repository were compared."
        ]
    )
    if not report["items"]:
        return "\n".join(
            [
                f"No open work item of {report['space']} has an attached commit of {scope}."
                " An item with no attached commit cannot show here; check those by hand.",
                *unregistered,
            ]
        )
    lines = [
        f"Check these open work items of {report['space']} against {scope}. This is a hint:"
        " a match says a commit shipped, not that the item is finished, so partly released"
        " work shows too.",
        "Nothing was changed. An item with no attached commit cannot show here.",
        *unregistered,
    ]
    for item in report["items"]:
        lines += ["", f"{item['reference']} [{item['state']}] {item['title']}"]
        matched, others = item["matched"], item["not_matched"]
        partly = "partly released? " if others else ""
        total = len(matched) + len(others)
        lines.append(f"  check: {partly}{len(matched)} of {total} attached commits match")
        for match in matched:
            words = _STEP_WORDS[match["step"]].format(commit=match["release_commit"][:7])
            lines.append(f"  {_shown(match)}  {match['step']}: {words}")
        if others:
            lines.append(f"  no match: {', '.join(_shown(pair) for pair in others)}")
    return "\n".join(lines)


# -- before prepare: the open bugs a release is bound to ---------------------------

#: A release version: its numeric core, then an optional pre-release or build suffix.
_VERSION = re.compile(r"(\d+(?:\.\d+)*)(?:[-+][0-9A-Za-z.+-]*)?")

#: The open bugs of one space bound to a release label: by carrying it, or by standing
#: at any depth under an open goal or stage that carries it. A bug under several such
#: containers names the one with the lowest number. `UNION` keeps the descent finite
#: in a damaged store whose parents form a cycle.
_BOUND = (
    "WITH RECURSIVE under(id, container) AS ("
    " SELECT g.work_item_id, g.number FROM work_items g"
    " JOIN workflow_states gs ON gs.state_id = g.state_id"
    " WHERE g.planning_space_id = ? AND g.kind = ?"
    " AND gs.category NOT IN ('completed', 'cancelled')"
    " AND EXISTS (SELECT 1 FROM json_each(g.labels) WHERE value = ?)"
    " UNION SELECT w.work_item_id, u.container FROM under u"
    " JOIN work_items w ON w.parent_id = u.id)"
    " SELECT i.number, i.title, i.labels, s.key, s.name, s.category, s.is_terminal,"
    " (SELECT MIN(u.container) FROM under u WHERE u.id = i.work_item_id) AS container"
    " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
    " WHERE i.planning_space_id = ? AND i.kind = 'bug'"
    " AND s.category NOT IN ('completed', 'cancelled')"
    " AND (EXISTS (SELECT 1 FROM json_each(i.labels) WHERE value = ?)"
    " OR i.work_item_id IN (SELECT id FROM under))"
    " ORDER BY i.number"
)


def _version_core(text: str) -> tuple[int, ...] | None:
    """The numbers of a version, compared as numbers, or None when it is not one."""

    matched = _VERSION.fullmatch(text)
    return None if matched is None else tuple(int(part) for part in matched[1].split("."))


def checkout_space(conn: sqlite3.Connection, repository: str) -> tuple[str, str]:
    """The project whose root is this checkout and the key of its space in this store.

    The space is the one the project registry binds the project to; nothing is
    guessed from a name. Each thing that is not there is a refusal naming it.
    """

    listing = project_registry.read_registry()
    if listing["status"] != "available":
        raise ReleasedError(f"{listing['reason']}: the checkout's planning space cannot be found")
    found = _project(repository, listing)
    if found is None:
        raise ReleasedError(
            f"{repository} is no registered project's root: register it with"
            " `valkama projects add`, or name the space with --space"
        )
    project = str(found["project_id"])
    data_scope_id = str(read_store_metadata(conn)["data_scope_id"])
    space = project_registry.home_space(found, data_scope_id)
    if space is None:
        raise ReleasedError(
            f"project {project} is bound to no planning space of this store: bind it with"
            f" `valkama projects bind {project} --space KEY`, or name the space with --space"
        )
    return project, space


def bound_bugs(
    conn: sqlite3.Connection,
    *,
    repository: str,
    product: str,
    version: str,
    space: str | None = None,
) -> dict:
    """The open bugs bound to the release `version` of `product`, which keep it from prepare.

    A bug is bound by the label `<product>-<version>`, or by standing at any depth
    under an open goal or stage that carries it. One under such a goal that carries
    the label of a later version of the product has been moved there, and is
    listed apart; one that keeps the release's own label is bound whatever else it
    carries. A task or an improvement is never bound. `space` defaults to the one
    the checkout's project is bound to (`checkout_space`).
    """

    release = _version_core(version)
    if release is None:
        raise ReleasedError(f"{version!r} is not a version; name one such as 1.2.0")
    project = None
    if space is None:
        project, space = checkout_space(conn, repository)
    planning_space = planning_service.get_planning_space(conn, space)
    key = str(planning_space["key"])
    label = f"{product}-{version}"
    space_id = str(planning_space["planning_space_id"])
    rows = conn.execute(_BOUND, (space_id, model.CONTAINER_KIND, label, space_id, label)).fetchall()
    bound: list[dict] = []
    moved: list[dict] = []
    for row in rows:
        labels = [str(value) for value in json.loads(row["labels"])]
        later = [
            value
            for value in labels
            if value.startswith(f"{product}-")
            and (core := _version_core(value[len(product) + 1 :])) is not None
            and core > release
        ]
        public = states.public_state(row)
        item = {
            "reference": model.human_id(key, int(row["number"])),
            "title": row["title"],
            "state": None if public is None else public["name"],
            "under": None
            if row["container"] is None
            else model.human_id(key, int(row["container"])),
        }
        if label not in labels and later:
            moved.append({**item, "labels": later})
        else:
            bound.append(item)
    return {
        "space": key,
        "project": project,
        "product": product,
        "label": label,
        "bound": bound,
        "moved": moved,
    }


def render_bound(report: dict) -> str:
    """The answer for a person: what keeps the release from prepare, or that nothing does."""

    label, space = report["label"], report["space"]
    lines = [f"No open bug of {space} is bound to {label}."]
    if report["bound"]:
        lines = [
            f"{len(report['bound'])} open bug(s) of {space} are bound to {label}, so the"
            " release is not prepared. Fix and close each, or move it to a later version by"
            f" giving it that version's label, {report['product']}-<version>.",
        ]
    for bug in report["bound"]:
        why = f"label {label}" if bug["under"] is None else f"under {bug['under']}"
        lines.append(f"  {bug['reference']} [{bug['state']}] {bug['title']} ({why})")
    if report["moved"]:
        lines.append("Moved to a later version by their label:")
    for bug in report["moved"]:
        lines.append(f"  {bug['reference']} {bug['title']} ({', '.join(bug['labels'])})")
    return "\n".join(lines)
