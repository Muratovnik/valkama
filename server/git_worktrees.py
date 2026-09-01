"""Reading a repository's worktree registrations, and the path checks that go with it.

The launch runner and the evaluation sandbox both create worktrees, and both
had their own copy of this: the same porcelain parser, the same canonical-path
helper, and two versions of the junction check that did not agree — one
consulted `os.path.isjunction` and fell back to `islink`, the other did not.
That check decides whether a path is a redirection to somewhere else, so the
two copies were two different answers to a question about where a delete lands.

Git speaks UTF-8 for its own output, so that is the declared codec here and a
breach of it raises: what comes back is paths, refs and worktree registrations,
values that route work rather than inform a reader.
"""

from __future__ import annotations

import os
import re
import stat
import tempfile

from . import processes

#: A ref is one token with no whitespace and no control characters.
_REF = re.compile(r"^[^\x00\r\n\t ]+$")


class WorktreeListError(RuntimeError):
    """Git refused to list the worktrees; the caller says what that means."""


class PathSafetyError(RuntimeError):
    """A path or a ref this module will not act on, and the reason it will not.

    Raised rather than returned because every caller here is about to create or
    delete something: the evaluation sandbox adds a disposable worktree and
    removes it recursively afterwards. A caller that wants its own vocabulary
    translates this once at its boundary; what it must not do is re-derive the
    checks, which is how the junction check came to have two answers.
    """


def canonical(path: str | os.PathLike[str]) -> str:
    """One spelling of a path: absolute, symlinks resolved, case normalized."""
    return os.path.normcase(os.path.realpath(os.path.abspath(os.fspath(path))))


def git_text(repo: str, *args: str) -> processes.TextResult:
    """Run git in `repo` and decode its output as the UTF-8 it declares."""
    return processes.run_text(["git", "-C", repo, *args])


def is_reparse_point(path: str) -> bool:
    """Whether a path redirects elsewhere. Windows junctions are not always
    reported by `os.path.islink`, so the attribute bit is consulted too."""
    if not os.path.lexists(path):
        return False
    if os.path.islink(path):
        return True
    is_junction = getattr(os.path, "isjunction", None)
    if is_junction is not None and is_junction(path):
        return True
    try:
        attributes = os.lstat(path).st_file_attributes
    except (AttributeError, OSError):
        return False
    return bool(attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def registered_worktrees(repo: str) -> dict[str, dict[str, str]]:
    """Every worktree git has registered for `repo`, keyed by canonical path.

    `git worktree list --porcelain` writes one `key value` line per attribute
    and a blank line between records; the trailing empty string closes the last
    one so it is not dropped.
    """
    listed = git_text(repo, "worktree", "list", "--porcelain")
    if listed.returncode:
        raise WorktreeListError(listed.stderr.strip())
    found: dict[str, dict[str, str]] = {}
    current: dict[str, str] = {}
    for raw in [*listed.stdout.splitlines(), ""]:
        line = raw.strip()
        if not line:
            if current.get("worktree"):
                found[canonical(current["worktree"])] = dict(current)
            current = {}
            continue
        key, _, value = line.partition(" ")
        current[key] = value
    return found


def contains(path: str, root: str, *, equal: bool = False) -> bool:
    """Whether `path` lies inside `root`, comparing canonical spellings."""

    try:
        common = canonical(os.path.commonpath([path, root]))
    except (ValueError, OSError):
        return False
    return common == canonical(root) and (equal or canonical(path) != canonical(root))


def lexical_path(path: str | os.PathLike[str]) -> str:
    """An absolute path whose every existing ancestor is a real directory.

    Checked ancestor by ancestor before anything is canonicalized, because a
    redirection halfway up is what decides where a later recursive delete lands.
    """

    raw = os.path.abspath(os.fspath(path))
    current = raw
    while True:
        if os.path.lexists(current) and is_reparse_point(current):
            raise PathSafetyError("path contains a symlink or reparse point")
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return raw


def safe_temp_root(path: str | os.PathLike[str], *, require_empty: bool) -> tuple[str, str]:
    """A temporary root safe to create disposable checkouts under, and its canonical spelling.

    The four paths refused outright are the ones a recursive delete must never
    be pointed at: the system temp directory itself, the working directory, the
    home directory and the filesystem root. Each is a plausible value of an
    empty or defaulted setting.
    """

    raw = lexical_path(path)
    normalized = os.path.normcase(os.path.normpath(raw))
    broad = {
        os.path.normcase(os.path.normpath(os.path.abspath(tempfile.gettempdir()))),
        os.path.normcase(os.path.normpath(os.path.abspath(os.getcwd()))),
        os.path.normcase(os.path.normpath(os.path.abspath(os.path.expanduser("~")))),
        os.path.normcase(os.path.normpath(os.path.abspath(os.sep))),
    }
    if normalized in broad:
        raise PathSafetyError("temporary root is too broad")
    if not os.path.isdir(raw) or is_reparse_point(raw):
        raise PathSafetyError("temporary root is not a normal directory")
    if require_empty:
        try:
            if next(os.scandir(raw), None) is not None:
                raise PathSafetyError("fresh temporary root is not empty")
        except OSError as error:
            raise PathSafetyError("cannot inspect temporary root") from error
    return raw, canonical(raw)


def safe_ref(value: str) -> str:
    """One exact ref that cannot be read as an option."""

    if not isinstance(value, str) or not value or value.startswith("-") or not _REF.match(value):
        raise PathSafetyError("git_ref must be one exact non-option ref")
    return value


__all__ = [
    "PathSafetyError",
    "WorktreeListError",
    "canonical",
    "contains",
    "git_text",
    "is_reparse_point",
    "lexical_path",
    "registered_worktrees",
    "safe_ref",
    "safe_temp_root",
]
