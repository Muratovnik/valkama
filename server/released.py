"""Which open work items name commits that a release's range took in.

Closing a release is when finished work should stop reading as open, and the
tracker has no way to know: a hint is the most this can honestly give. Nothing
here writes, to the store or to the repository, and no state changes. A match
says a commit shipped, not that the item is finished, so partly released work
shows too and a person decides.

An exact hash is not enough. A ref usually holds the hash from the branch the
work was done on, and integrating that branch rewrites it, so the case this
exists for is the one a hash comparison misses. A ref is therefore compared in
steps, and the answer names the step that found it:

1. `hash`: the commit is in the range.
2. `patch-id`: the commit is outside the range, and one in the range makes the
   same change.
3. `changed-patch`: the commit is outside the range and not already in the
   history the range starts from, its patch differs, and a commit in the range
   has its subject. An integration that resolved a conflict looks like this, and
   so does an unrelated commit with a common subject, which is why it is weak.
4. `subject`: the object is gone with its branch, and the subject of a commit in
   the range appears in the ref's label. Also weak: two commits can share a
   subject.
"""

from __future__ import annotations

import os
import re
import sqlite3
import subprocess
from dataclasses import dataclass

from . import processes, store
from .planning import service as planning_service
from .projects import project_registry, scopes
from .refs import resolve_ref, split_commit_value
from .store_identity.metadata import read_store_metadata
from .store_identity.refs import planning_space_entity

# A whole range's patches are read at once, so this is not the few seconds one
# ref lookup gets.
_GIT_TIMEOUT = 120
# A recorded hash, full or abbreviated. A branch name or `HEAD` moves, and the
# other forms found on real items (a range, a url, `repo:hash`) are no commit
# this could compare, so none of them reaches git.
_HASH = re.compile(r"[0-9a-fA-F]{4,64}")
# The steps that rest on a subject, which two commits can share.
_WEAK_STEPS = frozenset({"changed-patch", "subject"})


class ReleasedError(ValueError):
    """The repository or the range cannot be read as asked."""


def open_store() -> sqlite3.Connection:
    """The primary store, opened so that no statement can change it.

    Not `store.connect()`: that one brings a store up, which can migrate it.
    """

    conn = scopes.open_readonly({"name": scopes.PRIMARY_SCOPE, "path": store.db_path()})
    version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    if version > store.STORE_SCHEMA_VERSION:
        conn.close()
        raise store.StoreTooNewError(version, store.STORE_SCHEMA_VERSION)
    return conn


def _git(repository: str, *args: str, stdin: bytes | None = None) -> str:
    """One git command's output, with every byte it wrote recoverable.

    `surrogateescape` because a patch goes back into `git patch-id` and has to
    arrive as it left: a file in a legacy encoding changes no hash then, and a
    subject holding such bytes cannot equal a label, so it matches nothing.
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


def _own_names(repository: str) -> set[str]:
    """What a ref may call this repository, read the way `resolve_ref` reads a name.

    A linked worktree keeps its checkout's name too: the directory it happens to
    be in says nothing about which repository it is.
    """

    top = _git(repository, "rev-parse", "--show-toplevel").strip()
    common = _git(repository, "rev-parse", "--git-common-dir").strip()
    checkout = os.path.dirname(os.path.normpath(os.path.join(repository, common)))
    roots = {os.path.normcase(os.path.abspath(root)) for root in (top, checkout)}
    names = {os.path.basename(root) for root in roots}
    for project in project_registry.read_registry()["projects"]:
        if os.path.normcase(os.path.abspath(str(project["canonical_root"]))) in roots:
            names.add(str(project["project_id"]))
    return {name.lower() for name in names}


def _open_commit_refs(conn: sqlite3.Connection, space_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT i.number, i.title, s.name AS state, r.value, r.label"
        " FROM work_items i"
        " JOIN workflow_states s ON s.state_id = i.state_id"
        " JOIN work_item_refs r ON r.work_item_id = i.work_item_id AND r.kind = 'commit'"
        " WHERE i.planning_space_id = ? AND s.is_terminal = 0"
        " ORDER BY i.number, r.id",
        (space_id,),
    ).fetchall()


@dataclass(frozen=True)
class _Release:
    """What the repository says about the range, read once for every ref."""

    space_identity: str
    own_names: set[str]
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

    def compare(self, value: str, label: str) -> tuple[str, str] | None:
        """The step that finds this ref and the range's commit it finds, if any."""

        name, revision = split_commit_value(value)
        if not _HASH.fullmatch(revision):
            return None
        commit = self.existing.get(revision)
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
        # The object is not here. A name that is not this repository's says the
        # commit lives elsewhere, so a label's subject here would be a coincidence.
        if name is not None and name.lower() not in self.own_names:
            return None
        twin = self._subject_in_label(label)
        if twin is None:
            return None
        # Asked last and only for a candidate, since it runs git once per
        # registered repository. A commit found in another one belongs to it.
        if resolve_ref("commit", value, space=self.space_identity)["resolved"]:
            return None
        return "subject", twin

    def _subject_in_label(self, label: str) -> str | None:
        """The commit whose whole subject the label carries, if any.

        A label is free text, and real ones put the subject after a `repo branch: `
        prefix or before a ` (note)`. Only those positions count, so a short
        subject does not match inside a longer sentence.
        """

        text = _normalized(label)
        starts = [0, *(found.end() for found in re.finditer(": ", text))]
        ends = [len(text), *(found.start() for found in re.finditer(r" \(", text))]
        for start in starts:
            for end in ends:
                if start < end and text[start:end] in self.by_subject:
                    return self.by_subject[text[start:end]]
        return None


def _read_release(
    conn: sqlite3.Connection, space_key: str, repository: str, revisions: str, values: list[str]
) -> _Release:
    start = _range_start(repository, revisions)
    subjects = _subjects(repository, "--end-of-options", revisions)
    hashes = {split_commit_value(value)[1] for value in values}
    existing = _existing_commits(repository, {found for found in hashes if _HASH.fullmatch(found)})
    outside = sorted(set(existing.values()) - set(subjects))
    # Reading every patch of a range is the expensive part, and a ref in the
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
    identity = planning_space_entity(
        {"data_scope_id": read_store_metadata(conn)["data_scope_id"], "space_key": space_key}
    )
    return _Release(
        space_identity=str(identity["resource_id"]),
        own_names=_own_names(repository),
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
    """The open items of one space that name a commit of `revisions` in `repository`.

    Each item carries its matching refs with the step that found them and the
    refs that did not match, which is what tells whole work from partly released
    work. Whole work is listed first.
    """

    planning_space = planning_service.get_planning_space(conn, space)
    key = str(planning_space["key"])
    refs = _open_commit_refs(conn, str(planning_space["planning_space_id"]))
    values = [str(ref["value"]).strip() for ref in refs]
    release = _read_release(conn, key, repository, revisions, values)
    items: dict[int, dict] = {}
    for ref, value in zip(refs, values, strict=True):
        item = items.setdefault(
            int(ref["number"]),
            {
                "reference": f"{key}-{ref['number']}",
                "title": ref["title"],
                "state": ref["state"],
                "matched": [],
                "not_matched": [],
            },
        )
        found = release.compare(value, str(ref["label"]))
        if found is None:
            item["not_matched"].append(value)
        else:
            step, commit = found
            item["matched"].append(
                {"ref": value, "step": step, "weak": step in _WEAK_STEPS, "release_commit": commit}
            )
    shown = [item for item in items.values() if item["matched"]]
    return {
        "space": key,
        "repository": repository,
        "range": revisions,
        "commits": len(release.in_range),
        # `sorted` is stable, so items keep their number order inside each group.
        "items": sorted(shown, key=lambda item: bool(item["not_matched"])),
    }


_STEP_WORDS = {
    "hash": "in the range",
    "patch-id": "same change as {commit} in the range",
    "changed-patch": "WEAK MATCH: {commit} in the range has its subject, with another patch",
    "subject": "WEAK MATCH: the object is gone; the ref's label has the subject of {commit}",
}


def render(report: dict) -> str:
    """The answer for a person: what to check, and how much each line is worth."""

    scope = f"{report['range']} ({report['commits']} commits)"
    if not report["items"]:
        return (
            f"No open work item of {report['space']} names a commit of {scope}. An item with"
            " no commit ref cannot show here; check those by hand."
        )
    lines = [
        f"Check these open work items of {report['space']} against {scope}. This is a hint:"
        " a match says a commit shipped, not that the item is finished, so partly released"
        " work shows too.",
        "Nothing was changed. An item with no commit ref cannot show here.",
    ]
    for item in report["items"]:
        lines += ["", f"{item['reference']} [{item['state']}] {item['title']}"]
        matched, others = item["matched"], item["not_matched"]
        partly = "partly released? " if others else ""
        total = len(matched) + len(others)
        lines.append(f"  check: {partly}{len(matched)} of {total} commit refs match")
        for match in matched:
            words = _STEP_WORDS[match["step"]].format(commit=match["release_commit"][:7])
            lines.append(f"  {match['ref']}  {match['step']}: {words}")
        if others:
            lines.append(f"  no match: {', '.join(others)}")
    return "\n".join(lines)
