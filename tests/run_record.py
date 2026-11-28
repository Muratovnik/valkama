"""The record a run of checks leaves, and the check of one against a tree.

    python tests/run_record.py run --out DIR [--name NAME] [--cwd DIR] [--allow-dirty] -- COMMAND ...
    python tests/run_record.py check RECORD [RECORD ...] [--tree DIR] [--require NAME ...]

A report that says which checks passed is a claim; a record is what the runner
wrote while it ran them. Each `gates` run writes `record.json` into its result
directory, beside `gates.txt` and the step logs, and `run` writes one for checks
no gate step is, such as a targeted test run, a command at a time: the working
tree it ran in, the commit and the uncommitted changes it ran on, each step's
command and exit code, the tests each test step ran, how long its heavy runs
waited at the heavy-process gate, at what load and beside which runs, and the
versions of the tools. A report cites the record instead of retelling it. `check` accepts a
record made in DIR, by default this checkout, at the state DIR is in now, and
refuses one made in another working tree, at another commit or on other
uncommitted changes, naming each difference, and with `--require NAME` one with no
step of that name, naming it. Its exit code tells an accepted
record of a run that passed from one of a run that failed and from a refusal;
`check --help` lists the codes. Given several records, `check` takes them as a
chain: one made at the state DIR is in now, and earlier ones whose steps still
hold because nothing they read changed since, as `tests/record_chain.py` says.

A record lives where the run's results live, so the result directory must be
outside the tree or ignored by it, as `tmp/` is: one the tree's status sees
changes the tree the record describes, and no record of it can match. `gates`
says so before its first step, and `run` before its step. A record is evidence for a reader and not an
input to anything, so it is never tracked.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import platform
import re
import shutil
import sys
import time
from collections.abc import Collection, Iterator, Mapping, Sequence
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import git_worktrees, processes, store_lock
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


#: What a run says as the heavy-process gate admits it, the gate's stable admission
#: line, in any step: the lease's project and kind, how long it waited, its share K,
#: the profile it was counted by, how busy the machine was, the leases it went beside,
#: and whether it came in past the lone run's CPU limit or in serial mode.
ADMISSION = re.compile(
    rb"^heavy-gate: admitted (\S+) after (?:(\d+) min )?(\d+) s: (?:K=(\d+), )?"
    rb"(?:profile ([\d.]+) cores ([\d.]+) GB|no profile yet),"
    rb" machine ([\d.]+) of (\d+) busy,"
    rb" (?:alone|beside \d+ leases? \(([^\n]*?)\))"
    rb"(, past the CPU limit)?(, serial mode)?\r?$",
    re.MULTILINE,
)
#: What a run under a lease says once it also holds its place at the earlier branches'
#: lock, `tests/legacy_lock.py`'s `admission_line`: how long it waited there.
EARLIER_ADMISSION = re.compile(
    rb"^took the earlier branches' heavy-test lock [^\n]* after (?:(\d+) min )?(\d+) s:"
    rb" shared, counting (\d+) CPUs?\r?$",
    re.MULTILINE,
)


def admissions(log: Path) -> list[dict[str, object]]:
    """Each admission a step's runs had, by its log, in the order the log says them.

    For the gate: the lease's name, the seconds it waited, K, the profile's cores and
    memory, the busy fraction of the machine it went in at, the leases it went beside
    and the two marks. For the earlier branches' lock: the seconds it waited there and
    the CPUs it counted.
    """

    text = log.read_bytes()
    found: list[tuple[int, dict[str, object]]] = []
    for match in ADMISSION.finditer(text):
        name, minutes, seconds, k, cores, memory, busy, machine, beside, past, serial = (
            match.groups()
        )
        # Names for a reader of the record; nothing decides on them.
        leases = (beside or b"").decode("utf-8", errors="replace")
        found.append(
            (
                match.start(),
                {
                    "gate": "heavy-gate",
                    "lease": name.decode("utf-8", errors="replace"),
                    "waited": int(minutes or 0) * 60 + int(seconds),
                    "k": int(k) if k else None,
                    "profile_cores": float(cores) if cores else None,
                    "profile_memory_gb": float(memory) if memory else None,
                    "busy": round(float(busy) / int(machine), 3) if int(machine) else None,
                    "beside": leases.split(", ") if leases else [],
                    "past_cpu_limit": past is not None,
                    "serial": serial is not None,
                },
            )
        )
    for match in EARLIER_ADMISSION.finditer(text):
        minutes, seconds, cpus = match.groups()
        found.append(
            (
                match.start(),
                {
                    "gate": "earlier branches' lock",
                    "waited": int(minutes or 0) * 60 + int(seconds),
                    "cpus": int(cpus),
                },
            )
        )
    return [entry for _start, entry in sorted(found, key=lambda pair: pair[0])]


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


def on_disk(top: Path, names: Collection[bytes]) -> dict[bytes, bytes]:
    """The blob each path's content on disk would be, `gone` or `directory` where it has none.

    Hashed as `git add` would store it, line-ending conversion included, and not written.
    """

    files = sorted(name for name in names if _path(top, name).is_file())
    hashed = _git_bytes(
        top, "hash-object", "--stdin-paths", stdin=b"".join(f + b"\n" for f in files)
    )
    blobs = dict(zip(files, hashed.split(), strict=True))
    # No blob: gone from disk, or a nested repository listed as its directory.
    return {
        name: blobs.get(name) or (b"directory" if _path(top, name).exists() else b"gone")
        for name in names
    }


def _changes(top: Path) -> tuple[str | None, dict[str, str]]:
    """A digest of every file that differs from the commit, None when none does, and their blobs.

    Judged by what is on disk: each path whose content is not the commit's, with
    the blob that content would be, so staging it or not, and whether Git's status
    shows untracked files, changes nothing. Git only proposes the paths: those the
    diff with the commit names, renames split, and every untracked one.
    """

    proposed = _names(_git_bytes(top, "diff", "HEAD", "--name-only", "-z", "--no-renames"))
    proposed |= _names(_git_bytes(top, "ls-files", "-z", "--others", "--exclude-standard"))
    if not proposed:
        return None, {}
    committed = {}
    for entry in _names(_git_bytes(top, "ls-tree", "-r", "-z", "--full-tree", "HEAD")):
        meta, name = entry.split(b"\t", 1)
        committed[name] = meta.split()[2]
    blobs = on_disk(top, proposed)
    digest = hashlib.sha256()
    differing = {}
    for name in sorted(proposed):
        now = blobs[name]
        if now != committed.get(name):
            differing[name.decode("utf-8", "surrogateescape")] = now.decode("ascii")
            digest.update(name + b"\0" + now + b"\0")
    return (digest.hexdigest() if differing else None), differing


def tree_state(root: Path) -> dict[str, object]:
    """Which working tree `root` is, its commit, and whether and how its files differ from it."""

    found = artifacts.baseline(str(root))
    if found["quality"] != "observed":
        return {"worktree": git_worktrees.canonical(root), "head": "", "dirty": None}
    changes, paths = _changes(Path(found["repository"]))
    state: dict[str, object] = {
        "worktree": found["repository"],
        "head": found["head"],
        "branch": found["branch"],
        "dirty": changes is not None,
        "changes": changes,
    }
    if paths:
        # Each changed file's blob, so a chain can tell whether its content is still that.
        state["paths"] = paths
    return state


def _version(command: Sequence[str]) -> str | None:
    try:
        found = processes.run_text(list(command))
    except OSError:
        return None
    return (found.stdout.strip() or None) if found.returncode == 0 else None


def tool_versions(interpreter: release.Interpreter, *, npm: bool) -> dict[str, str | None]:
    """The Python tools `gates` starts, as installed, and node and npm when an npm step runs.

    A tool with an environment of its own is read there, where `gates` runs it.
    """

    versions: dict[str, str | None] = {"python": platform.python_version()}
    for name, tool in release.TOOLS.items():
        source = (
            interpreter
            if tool.environment is None
            else release.environment_interpreter(tool.environment.directory)
        )
        versions[name] = source.version_of(tool.distribution)
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


def begin(
    root: Path, tools: Mapping[str, str | None], tree: Mapping[str, object] | None = None
) -> dict[str, object]:
    """What a record says before its first step: when, where and with what.

    `tree` is `root`'s state as `tree_state` read it, when the caller read it already.
    """

    return {
        "format": FORMAT,
        "started": datetime.now().astimezone().isoformat(timespec="seconds"),
        "tree": dict(tree) if tree is not None else tree_state(root),
        "tools": dict(tools),
    }


def tests_run(name: str, log: Path) -> int | None:
    """How many tests the step `name` ran, by its log, or None when it does not say."""

    found = TEST_COUNTS[name].findall(log.read_bytes())
    return int(found[-1]) if found else None


def tests_said(log: Path) -> int | None:
    """How many tests a command no gate step names ran, by the first runner its log speaks as."""

    return next(
        (found for name in TEST_COUNTS if (found := tests_run(name, log)) is not None), None
    )


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
    if code is not None and (gate := admissions(log)):
        entry["admitted"] = gate
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
    tree = record.get("tree")
    if isinstance(tree, Mapping) and tree.get("head"):
        # A step that rewrites tracked files, as `web-build` does `web/dist`, leaves a tree
        # no check accepts this record for, and this is what then says why.
        finished["changed_by_run"] = differences(tree, tree_state(Path(str(tree["worktree"]))))
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
RUN_HELP = f"""Run COMMAND as a step of the record in DIR and exit with its exit code.

The step joins the record in DIR while this checkout is as that record says, and
a new record replaces it otherwise, so the checks one state of the tree needs,
run one after another or at the same time, make one record. A report cites
DIR/record.json:

  python tests/run_record.py run --out tmp/rec -- python -m unittest tests.test_x
  python tests/run_record.py run --out tmp/rec --cwd web -- npm run lint

A tree with uncommitted changes, untracked files among them, is refused before
the command starts, naming the files, with exit code {REFUSED}: its record would hold
only while the tree has those same changes. --allow-dirty runs it all the same.
  python tests/run_record.py check tmp/rec/record.json"""
CHECK_CODES = f"""exit codes:
  {PASSED}  accepted, and the run it records passed
  {FAILED}  accepted, and the run it records failed; the failed steps are named
  {REFUSED}  refused: not a readable record of this format, not of this tree as it is now,
      or with no step of a name --require gives; of a chain, also a record at a commit
      HEAD does not descend from, or a step a change since its record touched that no
      record has untouched"""


def read(path: Path) -> tuple[dict | None, str]:
    """The record at `path` when it is a readable record of this format, or None and why not."""

    try:
        record = json.loads(path.read_text(encoding="utf-8"))
        record["tree"], record["steps"], record["result"]
    except (OSError, ValueError, KeyError, TypeError) as error:
        return None, f"{path} is not a readable run record: {error}"
    if record.get("format") != FORMAT:
        return None, (
            f"{path} is a run record of format {record.get('format')},"
            f" and this check compares a tree as format {FORMAT} records it"
        )
    return record, ""


def _describing(
    path: Path, tree: Path, state: Mapping[str, object] | None = None
) -> tuple[dict | None, str]:
    """The record at `path` when it describes `tree` as it is now, or None and why it does not.

    `state` is `tree` as `tree_state` read it, when that is the state to compare with.
    """

    record, why = read(path)
    if record is None:
        return None, why
    found = differences(record["tree"], tree_state(tree) if state is None else state)
    if found:
        changed = record.get("changed_by_run")
        left = (
            f"; the run it records changed the tree itself: {'; '.join(changed)}" if changed else ""
        )
        return None, f"{path} does not describe {tree} as it is now: " + "; ".join(found) + left
    return record, ""


def check_records(
    paths: Sequence[Path], tree: Path, required: Collection[str] = ()
) -> tuple[int, str]:
    """`check` of one record, or of a chain of several, which `tests/record_chain.py` judges."""

    if len(paths) == 1:
        return check(paths[0], tree, required)
    # Imported here: the chain reads the import graph, which a single record never needs.
    from tests import record_chain

    return record_chain.check(paths, tree, list(required))


def check(path: Path, tree: Path, required: Collection[str] = ()) -> tuple[int, str]:
    """Whether the record at `path` was made in `tree` as it is now and passed, and what to say.

    `path` is the record or the directory `run --out` wrote it in: given the directory, opening
    it as the record answered Windows' «Permission denied» instead of reading the record there.
    A record with no step of a name in `required` is refused: it attests nothing about that
    check. A step is matched by its exact name, which the first run of a command takes.
    """

    if path.is_dir():
        path = path / NAME
    record, why = _describing(path, tree)
    if record is None:
        return REFUSED, f"refused: {why}"
    recorded, steps = record["tree"], record["steps"]
    ran = ", ".join(
        f"{entry['name']} exit={entry['exit']}"
        + (f" tests={entry['tests']}" if "tests" in entry else "")
        for entry in steps
    )
    names = {entry["name"] for entry in steps}
    missing = [name for name in dict.fromkeys(required) if name not in names]
    if missing:
        return REFUSED, (
            f"refused: {path} has no step {', '.join(missing)}, which this check requires;"
            f" ran: {ran}"
        )
    said = f"accepted: {path} was made in {recorded['worktree']} at {recorded['head']}"
    if record["result"] == 0:
        return PASSED, f"{said}; passed: {ran}"
    failed = [
        entry["name"] + (" (required)" if entry["name"] in required else "")
        for entry in steps
        if entry["exit"] != 0
    ] or ["no step ran"]
    return FAILED, f"{said}; failed: {', '.join(failed)}; ran: {ran}"


def _resolved(command: Sequence[str]) -> list[str]:
    """`command` with its program found, as `gates` finds it: `python` is this interpreter."""

    program, *arguments = command
    if program == "python":
        return [sys.executable, *arguments]
    # On Windows `npm` is `npm.cmd`, which a process can start only by its whole name.
    return [shutil.which(program) or program, *arguments]


def _step_name(words: str, taken: Collection[str]) -> str:
    """A name for a step and its log, from `words`, that no step of the record has yet."""

    name = re.sub(r"[^A-Za-z0-9._-]+", "-", words).strip("-.")[:60] or "command"
    count = 1
    found = name
    while found in taken:
        count += 1
        found = f"{name}-{count}"
    return found


def run(
    out: Path,
    command: Sequence[str],
    *,
    cwd: Path,
    name: str | None,
    environment: Mapping[str, str],
    root: Path = ROOT,
    allow_dirty: bool = False,
) -> int:
    """Run `command` in `cwd` as `gates` runs a step, record it in `out`, and return its exit code.

    A tree with uncommitted changes, untracked files among them, is refused before the
    command starts, with `REFUSED` and the files named, unless `allow_dirty`: `check`
    accepts a record of such a tree only while the tree has those same changes, so a
    long run there ends in a record its clean tree refuses.

    The step joins the record in `out` when the command ends, if that record says
    `root` as it was when the command started; otherwise a new record replaces it,
    and this says why. The record is read again and written under `out`'s lock once
    the command has ended, so runs into one `out` at the same time each add their
    step. Each command writes its log under a name of its own while it runs, and the
    log takes the step's name only then. The command gets `environment` as it is: no
    throwaway profile and no lock, so a targeted test run stays a targeted run, and a
    failed one says which heavy runs were going. `REFUSED` is the exit code when the
    lock stays held for `LOCK_WAIT_SECONDS` and the step is not recorded.
    """

    # Imported here, not at the top, for the reason `tests/isolated.py` gives `_refusal`.
    from tests import heavy_gate, isolated

    warning = placement_warning(root, out)
    if warning is not None:
        _say(warning)
    tree = tree_state(root)
    if not allow_dirty and (found := unrecordable(tree)):
        _say(f"refused before the first step: {'; '.join(found)}")
        return REFUSED
    words = name or " ".join([Path(command[0]).stem, *command[1:]])
    logs = out / isolated.LOGS
    logs.mkdir(parents=True, exist_ok=True)
    # A step's name never starts with a dot, so no step's log has this name.
    running = logs / f".{_step_name(words, ())}.{os.getpid()}.log"
    argv = _resolved(command)
    code = isolated._run_step(isolated.Run(words, argv, cwd), running, environment)
    try:
        with _locked(out / LOCK):
            label, written = _add_step(out, root, tree, words, argv, cwd, running, code)
    except LockTimeoutError as error:
        _say(f"not recorded: {error}; the log is {running}")
        return REFUSED
    log = logs / f"{label}.log"
    _say(f"{label:<14} exit={code}  {isolated._tail(log)}")
    note = heavy_gate.load_note() if code != 0 else None
    if note is not None:
        _say(note)
    _say(f"record: {written}")
    return code


def unrecordable(tree: Mapping[str, object]) -> list[str]:
    """Why `check` refuses a record made on `tree` once that tree is clean at its commit, one reason a line.

    The comparison is `check`'s own, `differences`, of `tree` with the same tree with
    no uncommitted changes, and `tree_state` is what says which files differ, so an
    untracked file counts here exactly as it counts there.
    """

    found = differences(tree, {**tree, "dirty": False, "changes": None})
    paths = tree.get("paths")
    if found and isinstance(paths, Mapping) and paths:
        found.append(
            f"the files that differ from {tree.get('head')}: {', '.join(sorted(paths))};"
            " commit or remove them, or give --allow-dirty to record a run on them"
        )
    return found


#: The file in a result directory that `run` holds while it reads and writes the record there.
LOCK = "record.lock"
#: How long `run` waits for another run's hold on that lock: a read, a merge and a write.
#: The lock is the operating system's, so a run that died holding it holds it no longer.
LOCK_WAIT_SECONDS = 60.0


class LockTimeoutError(RuntimeError):
    """Another live process held a result directory's lock for longer than `run` waits."""


@contextlib.contextmanager
def _locked(path: Path) -> Iterator[None]:
    """Hold the lock on `path` while the block runs, waiting `LOCK_WAIT_SECONDS` for it."""

    deadline = time.monotonic() + LOCK_WAIT_SECONDS
    with path.open("a+b") as handle:
        while not store_lock.try_lock(handle):
            if time.monotonic() >= deadline:
                raise LockTimeoutError(f"{path} stayed locked for {LOCK_WAIT_SECONDS:g} s")
            time.sleep(0.05)
        try:
            yield
        finally:
            store_lock.unlock(handle)


def _add_step(
    out: Path,
    root: Path,
    tree: Mapping[str, object],
    words: str,
    argv: Sequence[str],
    cwd: Path,
    running: Path,
    code: int,
) -> tuple[str, Path]:
    """Add the step that ran on `tree` to the record in `out` as it is now: its name and the record.

    Called under `out`'s lock, so the record read here is the one written here.
    """

    path = out / NAME
    record, why = _describing(path, root, tree)
    steps: list[Mapping[str, object]] = []
    if record is None:
        if path.is_file():
            _say(f"a new record replaces {why}")
        tools = tool_versions(release.running_interpreter(), npm=True)
        record = begin(root, tools, tree)
    else:
        steps = list(record["steps"])
    label = _step_name(words, {str(entry["name"]) for entry in steps})
    log = running.with_name(f"{label}.log")
    os.replace(running, log)
    entry = step(label, argv, cwd, log, code)
    if "tests" not in entry and (counted := tests_said(log)) is not None:
        entry["tests"] = counted
    if lists := named_lists(argv, cwd):
        entry["lists"] = lists
    steps.append(entry)
    result = 0 if all(entry["exit"] == 0 for entry in steps) else 1
    return label, write(out, record, steps, result)


def named_lists(argv: Sequence[str], cwd: Path) -> dict[str, list[str] | None]:
    """The lines of each list file a `--specs=FILE` argument names, None for one it cannot read.

    The file is the run's selection and lives outside the tree, so the record keeps
    what it said: two runs of the same words over other lists are not the same step.
    """

    found: dict[str, list[str] | None] = {}
    for word in argv:
        if word.startswith("--specs="):
            name = word.removeprefix("--specs=")
            try:
                text = (cwd / name).read_text(encoding="utf-8")
            except (OSError, ValueError):
                found[name] = None
                continue
            found[name] = sorted({line.strip() for line in text.splitlines() if line.strip()})
    return found


def _say(line: str) -> None:
    sys.stdout.write(f"{line}\n")
    sys.stdout.flush()


def main(argv: Sequence[str] | None = None) -> int:
    # Read before anything imports the `tests` package, which changes it for the suite.
    environment = dict(os.environ)
    parser = argparse.ArgumentParser(
        description="Run a check under a record, or check a record against a tree."
    )
    commands = parser.add_subparsers(dest="command", required=True)
    running = commands.add_parser(
        "run",
        help="run COMMAND and add it to the record in DIR, or start one there",
        description=RUN_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    running.add_argument("--out", type=Path, required=True, help="where the record and logs go")
    running.add_argument("--name", help="the step's name in the record; by default its words")
    running.add_argument(
        "--cwd", type=Path, default=Path.cwd(), help="where COMMAND runs; by default here"
    )
    running.add_argument(
        "--allow-dirty",
        action="store_true",
        help="run in a tree with uncommitted changes, whose record holds only for those changes",
    )
    running.add_argument("argv", nargs=argparse.REMAINDER, metavar="-- COMMAND ...")
    checking = commands.add_parser(
        "check",
        help="accept a record made in this tree as it is now",
        epilog=CHECK_CODES,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    checking.add_argument(
        "record",
        type=Path,
        nargs="+",
        help=f"the {NAME}, or the directory `run --out` wrote it in; several make a chain",
    )
    checking.add_argument(
        "--tree", type=Path, default=ROOT, help="the tree; by default this checkout"
    )
    checking.add_argument(
        "--require",
        action="append",
        default=[],
        metavar="NAME",
        help="refuse a record with no step of this name; repeat it for each step required",
    )
    options = parser.parse_args(argv)
    if options.command == "run":
        command = options.argv[1:] if options.argv[:1] == ["--"] else options.argv
        if not command:
            parser.error("name the command to run after --")
        return run(
            options.out.resolve(),
            command,
            cwd=options.cwd.resolve(),
            name=options.name,
            environment=environment,
            allow_dirty=options.allow_dirty,
        )
    code, said = check_records(options.record, options.tree, options.require)
    _say(said)
    return code


if __name__ == "__main__":
    sys.exit(main())
