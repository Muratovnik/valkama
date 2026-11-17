"""`valkama git-hook run <event>`: what Git runs after a commit an agent's shell made.

Git runs three hooks from its configuration, `hook.valkama-commit`,
`hook.valkama-rewrite` and `hook.valkama-merge`, in addition to the hook directory's
own ones. Each command is `command(...)`: a guard in `sh`, which ends a commit made
outside any client session before Python starts, and then this command through the
launcher. Git appends the event's own arguments to the command.

What a run does, in order, and why it stops where it stops:

1. It reads the client sessions from the environment: `CLAUDE_CODE_SESSION_ID` for
   Claude Code, `CODEX_SESSION_ID` (else `CODEX_THREAD_ID`) for Codex, with
   `CODEX_THREAD_ID` and `CODEX_TOOL_CALL_ID`. A client started from another one's
   shell inherits that one's variables, so both may be there; which one is outside
   cannot be read from the environment, and the record carries both. None — a
   person's commit, a test's, a build's — and nothing is written.
2. It finds the repository with one `git rev-parse`: the parent of the common Git
   directory when that is called `.git`, which is the main checkout for a linked
   worktree as well, and otherwise the top level. While a rebase is under way, a
   `post-commit` stops here, in a main checkout before that `git rev-parse`: the
   rebase reports its old and new hashes together.
3. It looks the root up in the project registry, exactly, without case on Windows.
   A repository the registry does not name is not recorded.
4. It reads the commit with one `git log` and leaves the record
   (`commit_records`).

It prints nothing and always exits 0: a `post-*` event cannot change what Git did,
and anything printed would show in every commit. Its own Git calls share
`GIT_SECONDS`. This build records `post-commit`; the other two events end here.
"""

from __future__ import annotations

import os
import sys
import time

TYPE_CHECKING = False
if TYPE_CHECKING:
    from collections.abc import Mapping

#: Each hook's name in the Git configuration, by the event it is for. Three names,
#: not one with three events: Git does not tell a command which event ran it.
NAMES = {
    "post-commit": "valkama-commit",
    "post-rewrite": "valkama-rewrite",
    "post-merge": "valkama-merge",
}
#: The events this build records.
RECORDED = frozenset({"post-commit"})
#: Ends the command in the shell Git started when no client session is in the
#: environment, so a commit nobody's agent made never starts Python.
GUARD = '[ -n "${CLAUDE_CODE_SESSION_ID:-}${CODEX_SESSION_ID:-}${CODEX_THREAD_ID:-}" ] || exit 0'
#: The most the hook's own Git calls take together.
GIT_SECONDS = 5.0

_REV_PARSE = (
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
    "--show-toplevel",
    "--git-path",
    "rebase-merge",
    "--git-path",
    "rebase-apply",
)
_LOG_FORMAT = "--format=%H%x00%P%x00%cI%x00%s"
_REBASES = ("rebase-merge", "rebase-apply")


def _quoted(path: str) -> str:
    text = path.replace("\\", "/")
    return f'"{text}"' if any(ch in text for ch in " \t'\"$`") else text


def command(python: str, script: str, event: str) -> str:
    """The configuration's command for one event: the guard, then the launcher's run."""

    return f"{GUARD}; exec {_quoted(python)} -I -S {_quoted(script)} git-hook run {event}"


def main(argv: list[str] | None = None) -> int:
    """Run the hook for `argv` (the event and Git's arguments); always 0, never a word."""

    try:
        run(sys.argv[3:] if argv is None else argv)
    except Exception:  # noqa: BLE001, S110 -- a post-commit hook never speaks or fails
        pass
    return 0


def sessions(environ: Mapping[str, str]) -> tuple[dict | None, dict | None]:
    """The record's `claude` and `codex`, each None when the environment names no such session."""

    claude_session = environ.get("CLAUDE_CODE_SESSION_ID") or None
    thread = environ.get("CODEX_THREAD_ID") or None
    codex_session = environ.get("CODEX_SESSION_ID") or thread
    claude = {"session_id": claude_session} if claude_session else None
    codex = (
        {
            "session_id": codex_session,
            "thread_id": thread,
            "tool_call_id": environ.get("CODEX_TOOL_CALL_ID") or None,
        }
        if codex_session
        else None
    )
    return claude, codex


def run(
    arguments: list[str], environ: Mapping[str, str] | None = None, cwd: str = "."
) -> list[str]:
    """Record one hook event; the record files written, none when nothing is recorded."""

    source = os.environ if environ is None else environ
    if not arguments or arguments[0] not in RECORDED:
        return []
    event = arguments[0]
    claude, codex = sessions(source)
    if claude is None and codex is None:
        return []
    if _rebasing(os.path.join(cwd, source.get("GIT_DIR") or ".git")):
        return []  # each commit of a rebase, seen without starting Git
    deadline = time.monotonic() + GIT_SECONDS
    from .. import git_worktrees

    found = git_worktrees.git_text(cwd, *_REV_PARSE, timeout=GIT_SECONDS)
    lines = found.stdout.splitlines()
    if found.returncode != 0 or len(lines) != 4:
        return []
    common_dir, top_level, rebase_merge, rebase_apply = lines
    if os.path.isdir(rebase_merge) or os.path.isdir(rebase_apply):
        return []
    root = os.path.dirname(common_dir) if os.path.basename(common_dir) == ".git" else top_level
    from . import commit_records, notify

    project_id = commit_records.project_of(
        root, commit_records.registry_roots(notify.loads, source)
    )
    if project_id is None:
        return []
    store_path = notify.settings(source)[0]
    if store_path is None:
        return []  # the configuration protects this store from this environment
    logged = git_worktrees.git_text(
        cwd,
        "-c",
        "i18n.logOutputEncoding=UTF-8",
        "log",
        "--no-walk",
        _LOG_FORMAT,
        "HEAD",
        timeout=max(0.1, deadline - time.monotonic()),
        errors="replace",
    )
    if logged.returncode != 0:
        return []
    commits = [_commit(line) for line in logged.stdout.splitlines() if line]
    if not commits or None in commits:
        return []
    occurred = time.time_ns()
    record = {
        "format": commit_records.FORMAT,
        "version": commit_records.VERSION,
        "event": event,
        "rewrite": None,
        "root": root.replace("\\", "/"),
        "project_id": project_id,
        "commits": commits,
        "rewritten": [],
        "claude": claude,
        "codex": codex,
        "occurred_at": commit_records.timestamp(occurred),
    }
    content = commit_records.encode(record)
    keys = [own["session_id"] for own in (claude, codex) if own is not None]
    return commit_records.write(
        content, keys, commit_records.places(store_path, common_dir), occurred
    )


def _rebasing(git_dir: str) -> bool:
    """Whether the Git directory `git_dir` is in a rebase, seen without starting Git.

    Git runs a hook in the top level of the work tree, so `.git` there is a main
    checkout's Git directory, and a rebase of twenty commits runs the hook twenty
    times. A linked worktree's `.git` is a file; its rebase is seen once
    `git rev-parse` has named its own directories."""

    return any(os.path.isdir(os.path.join(git_dir, name)) for name in _REBASES)


def _commit(line: str) -> dict | None:
    """One `git log` line as a record's commit, or None for a line of another shape."""

    parts = line.split("\x00", 3)
    if len(parts) != 4:
        return None
    full, parents, committed_at, subject = parts
    return {
        "hash": full.lower(),
        "parents": [parent.lower() for parent in parents.split()],
        "subject": subject,
        "committed_at": committed_at or None,
    }
