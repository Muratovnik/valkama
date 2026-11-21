"""The record a run of `tests/isolated.py gates` leaves, and the check of one against a tree.

    python tests/run_record.py check RECORD [--tree DIR]

A report that says which checks passed is a claim; a record is what the runner
wrote while it ran them. Each `gates` run writes `record.json` into its result
directory, beside `gates.txt` and the step logs: the working tree it ran in, the
commit and the uncommitted changes it ran on, each step's command and exit code,
the tests each test step ran, and the versions of the tools. `check` accepts a
record made in DIR, by default this checkout, at the state DIR is in now, and
refuses one made in another working tree, at another commit or on other
uncommitted changes, naming each difference. Its exit code tells an accepted
record of a run that passed from one of a run that failed and from a refusal;
`check --help` lists the codes.

A record lives where the run's results live, so the result directory must be
outside the tree or ignored by it, as `tmp/` is: one the tree's status sees
changes the tree the record describes, and no record of it can match. `gates`
says so before its first step. A record is evidence for a reader and not an
input to anything, so it is never tracked.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import re
import sys
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import git_worktrees, processes
from server.executions import artifacts
from windows import release

NAME = "record.json"
#: 2 judges uncommitted changes by the files' content, which 1 did by Git's status.
FORMAT = 2

#: How each test step says how many tests it ran, by step name: unittest's closing
#: line, Vitest's `Tests` line, and the `tests` count of `node --test`, in its spec
#: reporter and in TAP. The last match counts, since a log may quote an earlier one.
TEST_COUNTS: dict[str, re.Pattern[bytes]] = {
    "unittest": re.compile(rb"^Ran (\d+) tests? in ", re.MULTILINE),
    "web-test": re.compile(rb"^ *Tests +[^\n]*\((\d+)\)\s*$", re.MULTILINE),
    "desktop-test": re.compile(rb"^(?:#|\xe2\x84\xb9) tests (\d+)\s*$", re.MULTILINE),
}


def _git_bytes(root: Path, *arguments: str, stdin: bytes | None = None) -> bytes:
    # A digest needs the exact bytes, whatever encoding a changed file is in, and
    # surrogateescape gives back every byte strict UTF-8 would refuse, unchanged.
    found = processes.run_text(
        ["git", "-C", str(root), *arguments],
        encoding="utf-8",
        errors="surrogateescape",
        stdin=stdin,
    )
    if found.returncode != 0:
        raise OSError(f"git {' '.join(arguments)} failed in {root}: {found.stderr.strip()}")
    return found.stdout.encode("utf-8", "surrogateescape")


def _names(listed: bytes) -> set[bytes]:
    return {name for name in listed.split(b"\0") if name}


def _path(top: Path, name: bytes) -> Path:
    return top / name.decode("utf-8", "surrogateescape")


def _changes(top: Path) -> str | None:
    """One digest of every file that differs from the commit, or None when none does.

    Judged by what is on disk: each path whose content is not the commit's, with
    the blob that content would be, so staging it or not, and whether Git's status
    shows untracked files, changes nothing. Git only proposes the paths: those the
    diff with the commit names, renames split, and every untracked one.
    """

    proposed = _names(_git_bytes(top, "diff", "HEAD", "--name-only", "-z", "--no-renames"))
    proposed |= _names(_git_bytes(top, "ls-files", "-z", "--others", "--exclude-standard"))
    if not proposed:
        return None
    committed = {}
    for entry in _names(_git_bytes(top, "ls-tree", "-r", "-z", "--full-tree", "HEAD")):
        meta, name = entry.split(b"\t", 1)
        committed[name] = meta.split()[2]
    files = sorted(name for name in proposed if _path(top, name).is_file())
    # Hashed as `git add` would store it, line-ending conversion included, and not written.
    hashed = _git_bytes(
        top, "hash-object", "--stdin-paths", stdin=b"".join(f + b"\n" for f in files)
    )
    blobs = dict(zip(files, hashed.split(), strict=True))
    digest = hashlib.sha256()
    differs = False
    for name in sorted(proposed):
        # No blob: gone from disk, or a nested repository listed as its directory.
        now = blobs.get(name) or (b"directory" if _path(top, name).exists() else b"gone")
        if now != committed.get(name):
            differs = True
            digest.update(name + b"\0" + now + b"\0")
    return digest.hexdigest() if differs else None


def tree_state(root: Path) -> dict[str, object]:
    """Which working tree `root` is, its commit, and whether and how its files differ from it."""

    found = artifacts.baseline(str(root))
    if found["quality"] != "observed":
        return {"worktree": git_worktrees.canonical(root), "head": "", "dirty": None}
    changes = _changes(Path(found["repository"]))
    return {
        "worktree": found["repository"],
        "head": found["head"],
        "branch": found["branch"],
        "dirty": changes is not None,
        "changes": changes,
    }


def _version(command: Sequence[str]) -> str | None:
    try:
        found = processes.run_text(list(command))
    except OSError:
        return None
    return (found.stdout.strip() or None) if found.returncode == 0 else None


def tool_versions(interpreter: release.Interpreter, *, npm: bool) -> dict[str, str | None]:
    """The Python tools `gates` starts, as installed, and node and npm when an npm step runs."""

    versions: dict[str, str | None] = {"python": platform.python_version()}
    versions |= {
        name: interpreter.version_of(tool.distribution) for name, tool in release.TOOLS.items()
    }
    if npm:
        versions["node"] = _version(["node", "--version"])
        versions["npm"] = _version([release.NPM, "--version"])
    return versions


def placement_warning(root: Path, out: Path) -> str | None:
    """Why a record written into `out` cannot match `root`, or None when it can."""

    if not out.is_relative_to(root):
        return None
    ignored = processes.run_text(["git", "-C", str(root), "check-ignore", "-q", str(out)])
    if ignored.returncode == 0:
        return None
    return (
        f"warning: {out} is inside {root} and not ignored, so this run changes the tree"
        f" its {NAME} describes and no check of that record can accept it"
    )


def begin(root: Path, tools: Mapping[str, str | None]) -> dict[str, object]:
    """What a record says before its first step: when, where and with what."""

    return {
        "format": FORMAT,
        "started": datetime.now().astimezone().isoformat(timespec="seconds"),
        "tree": tree_state(root),
        "tools": dict(tools),
    }


def tests_run(name: str, log: Path) -> int | None:
    """How many tests the step `name` ran, by its log, or None when it does not say."""

    found = TEST_COUNTS[name].findall(log.read_bytes())
    return int(found[-1]) if found else None


def step(
    name: str, argv: Sequence[str], cwd: Path, log: Path, code: int | None
) -> dict[str, object]:
    """One step as the record keeps it; `code` is None for a step that was refused."""

    entry: dict[str, object] = {
        "name": name,
        "argv": list(argv),
        "cwd": str(cwd),
        "log": log.name,
        "exit": code,
    }
    if name in TEST_COUNTS:
        entry["tests"] = None if code is None else tests_run(name, log)
    return entry


def write(
    out: Path, record: Mapping[str, object], steps: Sequence[Mapping[str, object]], result: int
) -> Path:
    path = out / NAME
    finished = {
        **record,
        "finished": datetime.now().astimezone().isoformat(timespec="seconds"),
        "steps": list(steps),
        "result": result,
    }
    path.write_text(json.dumps(finished, indent=2) + "\n", encoding="utf-8", newline="\n")
    return path


def differences(recorded: Mapping[str, object], current: Mapping[str, object]) -> list[str]:
    """How the tree a record was made in differs from `current`, one reason a line."""

    if not current["head"]:
        return [f"{current['worktree']} is not a Git working tree"]
    found = []
    if recorded.get("worktree") != current["worktree"]:
        found.append(f"it was made in {recorded.get('worktree')}, not in {current['worktree']}")
    if recorded.get("head") != current["head"]:
        found.append(
            f"it was made at commit {recorded.get('head')}, and this tree is at {current['head']}"
        )
    if recorded.get("dirty") != current["dirty"]:
        made = "with uncommitted changes" if recorded.get("dirty") else "in a clean tree"
        now = "has uncommitted changes" if current["dirty"] else "has none"
        found.append(f"it was made {made}, and this tree {now}")
    elif recorded.get("changes") != current.get("changes"):
        found.append("it was made on other uncommitted changes than this tree has")
    return found


#: What `check` exits with: the record is of this tree and its run passed, it is of this
#: tree and its run failed, or it is not a record of this tree as it is now. 2 is left to
#: argparse, which exits with it on a command line it cannot read.
PASSED, FAILED, REFUSED = 0, 1, 3
CHECK_CODES = f"""exit codes:
  {PASSED}  accepted, and the run it records passed
  {FAILED}  accepted, and the run it records failed; the failed steps are named
  {REFUSED}  refused: not a readable record of this format, or not of this tree as it is now"""


def check(path: Path, tree: Path) -> tuple[int, str]:
    """Whether the record at `path` was made in `tree` as it is now and passed, and what to say."""

    try:
        record = json.loads(path.read_text(encoding="utf-8"))
        recorded, steps, result = record["tree"], record["steps"], record["result"]
    except (OSError, ValueError, KeyError, TypeError) as error:
        return REFUSED, f"refused: {path} is not a readable run record: {error}"
    if record.get("format") != FORMAT:
        return REFUSED, (
            f"refused: {path} is a run record of format {record.get('format')},"
            f" and this check compares a tree as format {FORMAT} records it"
        )
    found = differences(recorded, tree_state(tree))
    if found:
        return REFUSED, f"refused: {path} does not describe {tree} as it is now: " + "; ".join(
            found
        )
    ran = ", ".join(
        f"{entry['name']} exit={entry['exit']}"
        + (f" tests={entry['tests']}" if "tests" in entry else "")
        for entry in steps
    )
    said = f"accepted: {path} was made in {recorded['worktree']} at {recorded['head']}"
    if result == 0:
        return PASSED, f"{said}; passed: {ran}"
    failed = [entry["name"] for entry in steps if entry["exit"] != 0] or ["no step ran"]
    return FAILED, f"{said}; failed: {', '.join(failed)}; ran: {ran}"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check a gates run record against a tree.")
    commands = parser.add_subparsers(dest="command", required=True)
    checking = commands.add_parser(
        "check",
        help="accept a record made in this tree as it is now",
        epilog=CHECK_CODES,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    checking.add_argument("record", type=Path)
    checking.add_argument(
        "--tree", type=Path, default=ROOT, help="the tree; by default this checkout"
    )
    options = parser.parse_args(argv)
    code, said = check(options.record, options.tree)
    sys.stdout.write(f"{said}\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
