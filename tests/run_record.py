"""The record a run of `tests/isolated.py gates` leaves, and the check of one against a tree.

    python tests/run_record.py check RECORD [--tree DIR]

A report that says which checks passed is a claim; a record is what the runner
wrote while it ran them. Each `gates` run writes `record.json` into its result
directory, beside `gates.txt` and the step logs: the working tree it ran in, the
commit and the uncommitted changes it ran on, each step's command and exit code,
the tests each test step ran, and the versions of the tools. `check` accepts a
record made in DIR, by default this checkout, at the state DIR is in now, and
refuses one made in another working tree, at another commit or on other
uncommitted changes, naming each difference.

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
FORMAT = 1

#: How each test step says how many tests it ran, by step name: unittest's closing
#: line, Vitest's `Tests` line, and the `tests` count of `node --test`, in its spec
#: reporter and in TAP. The last match counts, since a log may quote an earlier one.
TEST_COUNTS: dict[str, re.Pattern[bytes]] = {
    "unittest": re.compile(rb"^Ran (\d+) tests? in ", re.MULTILINE),
    "web-test": re.compile(rb"^ *Tests +[^\n]*\((\d+)\)\s*$", re.MULTILINE),
    "desktop-test": re.compile(rb"^(?:#|\xe2\x84\xb9) tests (\d+)\s*$", re.MULTILINE),
}


def _git_bytes(root: Path, *arguments: str) -> bytes:
    # A digest needs the exact bytes, whatever encoding a changed file is in, and
    # surrogateescape gives back every byte strict UTF-8 would refuse, unchanged.
    found = processes.run_text(
        ["git", "-C", str(root), *arguments], encoding="utf-8", errors="surrogateescape"
    )
    if found.returncode != 0:
        raise OSError(f"git {' '.join(arguments)} failed in {root}: {found.stderr.strip()}")
    return found.stdout.encode("utf-8", "surrogateescape")


def _changes(root: Path) -> str:
    """One digest of every uncommitted change: the status, the diff and each untracked file."""

    digest = hashlib.sha256()
    digest.update(_git_bytes(root, "status", "--porcelain=v1", "-z", "--untracked-files=all"))
    digest.update(_git_bytes(root, "diff", "HEAD", "--binary", "--no-ext-diff", "--no-textconv"))
    untracked = _git_bytes(root, "ls-files", "-z", "--others", "--exclude-standard")
    for name in sorted(part for part in untracked.split(b"\0") if part):
        digest.update(name + b"\0")
        try:
            content = (root / name.decode("utf-8", "surrogateescape")).read_bytes()
        except OSError:
            # A nested repository is listed as its directory; its name is all there is.
            content = b""
        digest.update(hashlib.sha256(content).digest())
    return digest.hexdigest()


def tree_state(root: Path) -> dict[str, object]:
    """Which working tree `root` is, its commit, and whether and how it differs from it."""

    found = artifacts.baseline(str(root))
    if found["quality"] != "observed":
        return {"worktree": git_worktrees.canonical(root), "head": "", "dirty": None}
    return {
        "worktree": found["repository"],
        "head": found["head"],
        "branch": found["branch"],
        "dirty": found["dirty"],
        "changes": _changes(root) if found["dirty"] else None,
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


def check(path: Path, tree: Path) -> tuple[bool, str]:
    """Whether the record at `path` was made in `tree` as it is now, and what to say."""

    try:
        record = json.loads(path.read_text(encoding="utf-8"))
        recorded, steps, result = record["tree"], record["steps"], record["result"]
    except (OSError, ValueError, KeyError, TypeError) as error:
        return False, f"refused: {path} is not a readable run record: {error}"
    found = differences(recorded, tree_state(tree))
    if found:
        return False, f"refused: {path} does not describe {tree} as it is now: " + "; ".join(found)
    ran = ", ".join(
        f"{entry['name']} exit={entry['exit']}"
        + (f" tests={entry['tests']}" if "tests" in entry else "")
        for entry in steps
    )
    verdict = "passed" if result == 0 else "failed"
    return (
        True,
        f"accepted: {path} was made in {recorded['worktree']} at {recorded['head']}; {verdict}: {ran}",
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check a gates run record against a tree.")
    commands = parser.add_subparsers(dest="command", required=True)
    checking = commands.add_parser("check", help="accept a record made in this tree as it is now")
    checking.add_argument("record", type=Path)
    checking.add_argument(
        "--tree", type=Path, default=ROOT, help="the tree; by default this checkout"
    )
    options = parser.parse_args(argv)
    accepted, said = check(options.record, options.tree)
    sys.stdout.write(f"{said}\n")
    return 0 if accepted else 1


if __name__ == "__main__":
    sys.exit(main())
