"""Refuse a commit subject outside the Conventional Commit set the instructions state.

    python tests/commit_subjects.py [ROOT]

Reads the subject of every commit reachable from `HEAD` in ROOT, by default this
checkout, merge commits included, and names each one that does not match. A
development gate like `tests/isolated.py`, which runs it as a step of its own.

It exists because twice an integration branch reached the point of merging into
`main` carrying `merge: …` and Git's default `Merge branch 'x' into y`, the
release audit passed both times, and the history had to be rewritten.

A directory without its own Git history, such as a source snapshot, has no
subjects to read. The check then says it was skipped and why, and exits with
`SKIPPED` rather than 0, so that no caller can take it for a pass.
"""

from __future__ import annotations

import re
import sys
from collections.abc import Sequence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import processes

#: The type set of `AGENTS.md`; `tests/test_commit_subjects.py` compares them.
TYPES = (
    "build",
    "chore",
    "ci",
    "docs",
    "feat",
    "fix",
    "perf",
    "refactor",
    "revert",
    "style",
    "test",
)
#: A type, an optional lowercase scope, `!` for a break, and a description.
SUBJECT = re.compile(rf"(?:{'|'.join(TYPES)})(?:\([a-z0-9][a-z0-9._/-]*\))?!?: \S")
SKIPPED = 3


def _git(root: Path, *arguments: str) -> processes.TextResult:
    # A subject is only matched and shown, so bytes Git cannot render as UTF-8
    # are replaced rather than allowed to stop the check of every other subject.
    return processes.run_text(["git", "-C", str(root), *arguments], errors="replace")


def history_refusal(root: Path) -> str | None:
    """Why `root` has no commit history of its own to read, or None when it has one.

    A directory inside another repository is refused too: the history Git would
    find there is that repository's, not this checkout's.
    """

    try:
        top = _git(root, "rev-parse", "--show-toplevel")
    except OSError as error:
        return f"git could not be started: {error}"
    if top.returncode != 0:
        said = top.stderr.strip().splitlines()
        return f"{root} is not a Git repository" + (f" ({said[0]})" if said else "")
    if Path(top.stdout.strip()).resolve() != root.resolve():
        return f"{root} has no repository of its own; the one around it is {top.stdout.strip()}"
    if _git(root, "rev-parse", "--verify", "--quiet", "HEAD^{commit}").returncode != 0:
        return f"{root} has no commit yet"
    return None


def nonconforming(root: Path) -> tuple[int, list[str]]:
    """How many commits `HEAD` reaches, and `<hash> <subject>` for each that does not match."""

    found = _git(root, "log", "-z", "--format=%h %s", "HEAD")
    if found.returncode != 0:
        raise RuntimeError(f"git log failed in {root}: {found.stderr.strip()}")
    commits = [record for record in found.stdout.split("\0") if record]
    return len(commits), [
        record for record in commits if not SUBJECT.match(record.partition(" ")[2])
    ]


def check(root: Path) -> int:
    """Say what was read and what does not match; 0 only when every subject was read and matches."""

    refusal = history_refusal(root)
    if refusal is not None:
        sys.stdout.write(f"commit subjects skipped, none was read: {refusal}\n")
        return SKIPPED
    read, wrong = nonconforming(root)
    if not wrong:
        sys.stdout.write(f"commit subjects: all {read} commits reachable from HEAD conform\n")
        return 0
    sys.stdout.write(
        f"commit subjects: {len(wrong)} of {read} commits reachable from HEAD are not"
        f" `type(scope)!: description` with a type of {', '.join(TYPES)}, a lowercase"
        " scope and `!` both optional:\n"
    )
    sys.stdout.writelines(f"  {record}\n" for record in wrong)
    return 1


def main(argv: Sequence[str] | None = None) -> int:
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8")
    arguments = sys.argv[1:] if argv is None else list(argv)
    return check(Path(arguments[0]) if arguments else ROOT)


if __name__ == "__main__":
    sys.exit(main())
