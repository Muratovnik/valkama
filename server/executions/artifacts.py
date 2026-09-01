"""What the checkout looked like when an attempt began, and what it looks like after.

This is the evidence half of a result. A client can report `complete` and have
changed nothing, and a client can report `partial` on top of thirty committed
files; neither claim is checkable from the client's own words. Two observations
of the repository make it checkable, and they cost two `git` calls each.

It is an `ArtifactSummary`, not a diff viewer. Nothing here reads file contents:
the counts come from `--numstat`, which reports per-file line totals, and the
commit list is bounded. A layer that wants to show the change itself opens the
repository; this exists so an attempt with no delivery is visibly one.

Every value carries how it was obtained, because a repository that is not a Git
checkout is a normal answer here — a launch may run anywhere — and a zero that
means "nothing changed" must never be confused with a zero that means "nobody
looked". `quality` is the field that separates them.
"""

from __future__ import annotations

from .. import git_worktrees

#: A bounded list: an attempt that produced two hundred commits is a fact worth
#: recording, and the first fifty of them are enough to say so.
MAX_COMMITS = 50


def _text(repo: str, *args: str) -> str:
    """One Git answer, or an empty string when Git could not give one."""

    result = git_worktrees.git_text(repo, *args)
    return result.stdout.strip() if result.returncode == 0 else ""


def baseline(repo: str) -> dict:
    """What the checkout is, right before an attempt starts running in it.

    A launch must not fail because a directory is not a repository, so an
    unobservable baseline is an answer rather than an error.
    """

    top = _text(repo, "rev-parse", "--show-toplevel")
    if not top:
        return {
            "repository": "",
            "head": "",
            "branch": "",
            "dirty": None,
            "worktree": repo,
            "quality": "unknown",
        }
    status = git_worktrees.git_text(repo, "status", "--porcelain")
    return {
        "repository": git_worktrees.canonical(top),
        "head": _text(repo, "rev-parse", "HEAD"),
        # A detached HEAD names no branch, and `--abbrev-ref` says `HEAD`; an
        # empty string is the honest form of "none".
        "branch": _branch(_text(repo, "rev-parse", "--abbrev-ref", "HEAD")),
        "dirty": bool(status.stdout.strip()) if status.returncode == 0 else None,
        "worktree": git_worktrees.canonical(repo),
        "quality": "observed",
    }


def _branch(name: str) -> str:
    return "" if name in ("", "HEAD") else name


def outcome(repo: str, base: dict) -> dict:
    """What the attempt left behind, measured against the baseline it started from.

    Measured against the recorded base commit rather than against the previous
    reading, so a second attempt in the same checkout reports its own change
    and not the sum of both.
    """

    if not isinstance(base, dict) or base.get("quality") != "observed":
        return {
            "head": "",
            "branch": "",
            "dirty": None,
            "changed_files": None,
            "insertions": None,
            "deletions": None,
            "commits": [],
            "quality": "unknown",
        }
    head = _text(repo, "rev-parse", "HEAD")
    status = git_worktrees.git_text(repo, "status", "--porcelain")
    base_head = str(base.get("head") or "")
    changed, insertions, deletions = _numstat(repo, base_head)
    commits = []
    if base_head and head and base_head != head:
        listing = _text(repo, "rev-list", f"--max-count={MAX_COMMITS}", f"{base_head}..{head}")
        commits = [line.strip() for line in listing.splitlines() if line.strip()]
    return {
        "head": head,
        "branch": _branch(_text(repo, "rev-parse", "--abbrev-ref", "HEAD")),
        "dirty": bool(status.stdout.strip()) if status.returncode == 0 else None,
        "changed_files": changed,
        "insertions": insertions,
        "deletions": deletions,
        "commits": commits,
        "quality": "observed",
    }


def _numstat(repo: str, base_head: str) -> tuple[int | None, int | None, int | None]:
    """Files, insertions and deletions between the baseline and now.

    `--numstat` rather than `--shortstat`: the short form is a translated
    sentence, so parsing it reads differently under a localised Git, while the
    numeric form is three tab-separated columns in every locale. A binary file
    reports `-` for both counts and still counts as one changed file.
    """

    if not base_head:
        return None, None, None
    # Working tree included on purpose: an attempt that edited without
    # committing has still changed the checkout, and reporting zero there is
    # the failure this whole module exists to prevent.
    result = git_worktrees.git_text(repo, "diff", "--numstat", base_head)
    if result.returncode != 0:
        return None, None, None
    files = insertions = deletions = 0
    for line in result.stdout.splitlines():
        columns = line.split("\t")
        if len(columns) < 3:
            continue
        files += 1
        if columns[0].isdigit():
            insertions += int(columns[0])
        if columns[1].isdigit():
            deletions += int(columns[1])
    return files, insertions, deletions


__all__ = ["MAX_COMMITS", "baseline", "outcome"]
