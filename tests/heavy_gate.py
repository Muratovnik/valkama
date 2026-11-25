"""Valkama's heavy test runs at the machine's heavy-process gate.

    python tests/heavy_gate.py run --kind KIND [--size N] [--want W] [--wait | --no-wait]
                                   [--pid P] -- COMMAND ...
    python tests/heavy_gate.py holder

A development tool beside the tests, as `tests/isolated.py` is. Heavy runs that
together want more of the machine than it has fail timing-sensitive tests that
pass alone, so the whole browser suite, the Vitest suite and the whole unittest
suite each take a lease at the machine's heavy-process gate, `heavy-gate`, which
Host Runtime installs for the agents of every project on the machine. The gate
admits a run by measuring the machine and by what earlier runs of its kind used,
not by a number the run declares; `.heavy-gate.toml` at the repository root
names Valkama's kinds and their first figures. A run that does not fit is told
so at once with the reason and an estimate of the wait, or, with `--wait`, waits
and says why every minute. The gate's README, "Heavy-process gate", is its
contract: the commands, the answers and the exit codes used here.

- `run` starts COMMAND under a lease of KIND: the gate's `run`, which starts it
  in a Job Object and keeps the lease until it exits. A KIND whose worker count
  can change gets its share K: every `{k}` in COMMAND becomes K, and
  `HEAVY_GATE_K` holds it. Its exit code is COMMAND's, 75 for no room, 64 for
  bad arguments. A run still waiting for room leaves the queue, with 75, once the
  process that started it is gone. A program that is an npm shim, such as `npx`,
  starts as the program and script it names, so cmd.exe never reads an argument
  such as `--grep=a|b`; any other batch file is refused an argument it would read.
- `hold_until_exit` takes a lease for this process until it ends, through the
  gate's `hold`: the whole unittest suite takes one from the `tests` package's
  `load_tests`, since it is loaded here and run later.
- `holder` says, for a failed run that took no lease, which heavy runs were
  going as it ended, so the failure reads as load.

Where the gate is not installed (CI, a fresh clone, another machine) the command
runs directly, with K the run's want. The gate is found on `PATH` by its
`heavy-gate.json`, which names its interpreter, script and state directory, and
then in the profile Windows set at logon, never through `USERPROFILE`, which
`tests/isolated.py gates` moves for what it starts. `VALKAMA_HEAVY_GATE`, for tests
only, names another `heavy-gate.json` to use.

An agent's session does not wait by default, as the gate's own commands do not:
a run that finds no room exits 75 at once. `--wait` or `HEAVY_GATE_WAIT=1` waits;
`--no-wait` or `HEAVY_GATE_WAIT=0` does not.

While branches made before the gate remain, a run under a lease also takes its
place at their lock, `tests/legacy_lock.py`, which says how and in which order.
A run started by a holder of a lease or of that place takes neither again: the
gate sees `HEAVY_GATE_LEASE`, and the earlier lock its own mark.
"""

from __future__ import annotations

import argparse
import atexit
import contextlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import tomllib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import IO, TYPE_CHECKING, Any

HERE = Path(__file__).resolve()
ROOT = HERE.parents[1]

if TYPE_CHECKING or __package__:
    from server import process_reads, processes
    from tests import legacy_lock
else:
    # Run as a script, this file imports nothing through the `tests` package: importing
    # it moves the environment, and COMMAND must inherit the caller's.
    import legacy_lock

    # `legacy_lock` put the repository root on the path.
    from server import process_reads, processes

#: The gate's protocol this file speaks, as its entry points and answers name it.
PROTOCOL = 1
#: The file beside the gate's entry points that names how to start it without a shell.
ENTRY_POINT = "heavy-gate.json"
#: Where Host Runtime installs the entry points, under the logon profile.
INSTALLED = Path(".agent-host-runtime") / "bin" / ENTRY_POINT
#: For tests only: the `heavy-gate.json` to use instead of the installed one.
GATE_VARIABLE = "VALKAMA_HEAVY_GATE"
#: The gate's exit codes and variables, from its contract.
EXIT_NO_ROOM = 75
EXIT_USAGE = 64
EXIT_NOT_FOUND = 127
LEASE_VARIABLE = "HEAVY_GATE_LEASE"
K_VARIABLE = "HEAVY_GATE_K"
WAIT_VARIABLE = "HEAVY_GATE_WAIT"
#: What marks a process as an agent's: Claude Code sets the first three in its shell
#: tools, Codex the last in its own. Inherited, as the gate reads them too.
AGENT_VARIABLES = ("CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "AI_AGENT", "CODEX_THREAD_ID")
#: Valkama's name in the gate's leases, as `.heavy-gate.toml` declares it.
PROJECT = "valkama"
RULES = ROOT / ".heavy-gate.toml"
PLACEHOLDER = "{k}"
#: How long `holder` waits for the gate's status.
STATUS_SECONDS = 30.0


class GateError(Exception):
    """The gate's entry point is there but cannot be used; why."""


@dataclass(frozen=True)
class Gate:
    """How to start the installed gate: its command line before the verb, and its state."""

    argv: tuple[str, ...]
    state: Path


def _say(line: str) -> None:
    sys.stderr.write(f"{line}\n")
    sys.stderr.flush()


def logon_profile() -> str | None:
    """The user's profile directory as Windows set it at logon, or None where it set none."""

    if sys.platform != "win32":
        return None
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Volatile Environment") as key:
            value, _kind = winreg.QueryValueEx(key, "USERPROFILE")
    except OSError:
        return None
    return str(value) or None


def _candidates(environment: Mapping[str, str]) -> list[Path]:
    named = environment.get(GATE_VARIABLE)
    if named:
        return [Path(named)]
    found = [
        Path(directory) / ENTRY_POINT
        for directory in environment.get("PATH", "").split(os.pathsep)
        if directory.strip()
    ]
    profile = logon_profile()
    if profile:
        found.append(Path(profile) / INSTALLED)
    return found


def read_gate(path: Path) -> Gate:
    """The gate `path`, a `heavy-gate.json`, names; `GateError` when it names none this speaks to."""

    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise GateError(f"{path} cannot be read: {error}") from error
    argv = document.get("argv") if isinstance(document, dict) else None
    state = document.get("state") if isinstance(document, dict) else None
    if document.get("protocol") != PROTOCOL if isinstance(document, dict) else True:
        raise GateError(f"{path} is not of the gate's protocol {PROTOCOL}")
    if (
        not isinstance(argv, list)
        or not argv
        or not all(isinstance(word, str) and word for word in argv)
        or not isinstance(state, str)
        or not state
    ):
        raise GateError(f"{path} names no command line and state directory")
    return Gate(tuple(argv), Path(state))


def find_gate(environment: Mapping[str, str] = os.environ) -> Gate | None:
    """The installed gate, or None where none is installed; `GateError` for one that is unusable."""

    for candidate in _candidates(environment):
        if candidate.is_file():
            return read_gate(candidate)
    return None


def waits(choice: bool | None, environment: Mapping[str, str] = os.environ) -> bool:
    """Whether a run that finds no room waits for it: as asked, else as the gate decides."""

    if choice is not None:
        return choice
    if environment.get(WAIT_VARIABLE) in ("0", "1"):
        return environment[WAIT_VARIABLE] == "1"
    return not any(environment.get(name) for name in AGENT_VARIABLES)


def rules_want(kind: str, rules: Path = RULES) -> int | None:
    """The worker count `kind` wants by default in the rules file, or None for a kind with none."""

    try:
        document = tomllib.loads(rules.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    for table in document.get("kind", []):
        if isinstance(table, dict) and table.get("name") == kind:
            workers = table.get("workers")
            if isinstance(workers, dict):
                value = workers.get("want", workers.get("min", 1))
                return value if isinstance(value, int) else None
    return None


class UnsafeCommandError(Exception):
    """COMMAND's program is a batch file that cmd.exe would read an argument of; why."""


#: What cmd.exe acts on in the command line of a batch file, quoted or not: `a|b` there
#: is a pipe and `%PATH%` the variable's value (CVE-2024-24576 and its kind).
CMD_SPECIAL = frozenset('"%&<>^|()!\r\n')
#: How long `npx.cmd`'s question of npm's global prefix may take, as the shim asks it.
PREFIX_SECONDS = 30.0
#: The last line of a shim npm's cmd-shim writes, in `node_modules/.bin` or npm's
#: global prefix: the program found as the lines above say, then the script it names.
_CMD_SHIM = re.compile(r'"%_prog%"\s+"%dp0%\\(?P<script>[^"%]+)"\s+%\*$')
_CMD_SHIM_BESIDE = re.compile(r'IF EXIST "%dp0%\\(?P<program>[^"%\\]+)"')
_CMD_SHIM_ON_PATH = re.compile(r'SET "_prog=(?P<program>[^"%\\]+)"')
#: The last line of `npm.cmd` and `npx.cmd` as npm writes them beside node.exe.
_NPM_SHIM = re.compile(r'"%NODE_EXE%"\s+"%(?P<name>\w+)%"\s+%\*$')


def _set_beside(name: str, text: str) -> str | None:
    """The path below `%~dp0` the shim `text` sets `name` to, or None."""

    found = re.search(rf'SET "{re.escape(name)}=%~dp0\\(?P<path>[^"%]+)"', text)
    return found["path"] if found else None


def _program(directory: Path, beside: str | None, on_path: str | None) -> str | None:
    """A shim's program: `beside` it when that file is there, else `on_path`, else None."""

    if beside and (directory / beside).is_file():
        return str(directory / beside)
    found = shutil.which(on_path) if on_path else None
    # Never a script that PATHEXT would open: cmd-shim takes `.JS` out of it for this.
    return found if found and Path(found).suffix.lower() in (".exe", ".com") else None


def _npm_prefix_cli(node: str, prefix_script: str, below: str) -> str | None:
    """The CLI under npm's global prefix that `npx.cmd` prefers, when one is installed there."""

    try:
        answer = processes.run_text([node, prefix_script], timeout=PREFIX_SECONDS)
    except (OSError, subprocess.TimeoutExpired):
        return None
    # The shim's `FOR /F` keeps the last line that is not empty.
    lines = [line for line in answer.stdout.splitlines() if line.strip()]
    if not lines:
        return None
    cli = Path(lines[-1]) / below
    return str(cli) if cli.is_file() else None


def npm_shim(path: Path) -> list[str] | None:
    """The program and script the npm shim at `path` starts, or None when it is no shim of npm's.

    npm starts a package's command on Windows through a batch file it writes, which
    hands its arguments to cmd.exe as text. Read as npm wrote it, the shim names what
    it starts, and that starts with the arguments as they are.
    """

    try:
        text = path.read_bytes().decode("utf-8", "strict")
    except (OSError, UnicodeDecodeError):
        return None  # a shim of no shape this knows starts as the batch file it is
    lines = text.strip().splitlines()
    last = lines[-1].strip() if lines else ""
    directory = path.parent
    found = _CMD_SHIM.search(last)
    if found:
        beside = _CMD_SHIM_BESIDE.search(text)
        on_path = _CMD_SHIM_ON_PATH.search(text)
        program = _program(
            directory,
            beside["program"] if beside else None,
            on_path["program"] if on_path else None,
        )
        script = os.path.normpath(directory / found["script"])
        return [program, script] if program and Path(script).is_file() else None
    found = _NPM_SHIM.search(last)
    cli = _set_beside(found["name"], text) if found else None
    if found is None or cli is None:
        return None
    node = _program(directory, _set_beside("NODE_EXE", text), "node")
    if node is None:
        return None
    script = os.path.normpath(directory / cli)
    prefix_script = _set_beside("NPM_PREFIX_JS", text)
    under_prefix = re.search(
        rf'SET "NPM_PREFIX_{re.escape(found["name"])}=%%F\\(?P<path>[^"%]+)"', text
    )
    if prefix_script and under_prefix:
        prefixed = _npm_prefix_cli(
            node, os.path.normpath(directory / prefix_script), under_prefix["path"]
        )
        script = prefixed or script
    return [node, script] if Path(script).is_file() else None


def _resolved(command: Sequence[str]) -> list[str] | None:
    """COMMAND with its program found; None when there is none.

    `UnsafeCommandError` for a batch file that cmd.exe would read an argument of.
    Windows runs a batch file through cmd.exe, which reads the arguments as a command
    line of its own, whatever quoting a caller gives them. So `npx`, `npm` and a
    package's `.bin` entry start as the program and script their npm shim names, and
    any other batch file starts only while no argument holds a character cmd.exe acts on.
    """

    program = shutil.which(command[0])
    if program is None:
        return None
    if Path(program).suffix.lower() not in (".cmd", ".bat"):
        return [program, *command[1:]]
    shim = npm_shim(Path(program))
    if shim is not None:
        return [*shim, *command[1:]]
    # cmd.exe reads the batch file's own path as a word of its command line too.
    if CMD_SPECIAL.intersection(program):
        raise UnsafeCommandError(
            f"{program} is a batch file, and cmd.exe would act on a character of its path"
            " instead of starting it: start the program it runs instead"
        )
    for word in command[1:]:
        if CMD_SPECIAL.intersection(word):
            raise UnsafeCommandError(
                f"{program} is a batch file, and cmd.exe would read the argument {word!r}"
                " instead of handing it on: start the program it runs instead"
            )
    return [program, *command[1:]]


def run_direct(
    kind: str,
    command: Sequence[str],
    want: int | None,
    environment: Mapping[str, str] = os.environ,
    say: Callable[[str], None] = _say,
) -> int:
    """COMMAND as a run without the gate: every `{k}` is the run's want, or the kind's."""

    words = list(command)
    if any(PLACEHOLDER in word for word in words):
        k = want or rules_want(kind)
        if k is None:
            say(f"COMMAND names {PLACEHOLDER}, but kind {kind!r} gives no worker count")
            return EXIT_USAGE
        words = [word.replace(PLACEHOLDER, str(k)) for word in words]
    try:
        resolved = _resolved(words)
    except UnsafeCommandError as unsafe:
        say(str(unsafe))
        return EXIT_USAGE
    if resolved is None:
        say(f"cannot find the program {words[0]!r}")
        return EXIT_NOT_FOUND
    return subprocess.call(resolved, env=dict(environment))


def _located(gate: str | None, say: Callable[[str], None]) -> Gate | None:
    """The gate to use, or None to run directly, saying why when one is there but unusable."""

    environment = dict(os.environ)
    if gate is not None:
        environment[GATE_VARIABLE] = gate
    try:
        return find_gate(environment)
    except GateError as error:
        say(f"the heavy-process gate cannot be used ({error}): running without it")
        return None


def lease_cpus(state: Path, lease: str | None) -> int:
    """What a run under `lease` counts at the earlier branches' lock: its profile's cores, rounded up.

    The whole machine for a run the gate counts as the whole machine, one it gave no
    lease or one whose lease cannot be read: an earlier run then waits for it.
    """

    machine = os.cpu_count() or 1
    if not lease or not all(character.isalnum() or character == "-" for character in lease):
        return machine
    try:
        record = json.loads((state / "leases" / f"{lease}.json").read_text(encoding="utf-8"))
        profile = record["profile"]
        cores = profile.get("cores_total")
        if profile.get("whole_machine") or not isinstance(cores, int | float):
            return machine
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return machine
    return max(1, min(machine, math.ceil(cores)))


def _no_room(kind: str, why: object, say: Callable[[str], None]) -> int:
    say(
        f"no room for {PROJECT}:{kind}: {why}; run it again with --wait or HEAVY_GATE_WAIT=1"
        " to wait for room, for example in the background"
    )
    return EXIT_NO_ROOM


#: How often a run waiting for room asks whether the process it waits for is there.
WATCH_SECONDS = 0.25
#: What `OpenProcess` needs to wait on a process and to read its start.
_SYNCHRONIZE_AND_QUERY = 0x00100000 | 0x1000
_ACCESS_DENIED = 5
#: The launchers that start Python as their child and wait for it.
_LAUNCHERS = ("py.exe", "pyw.exe")


def _started(pid: int) -> str:
    """When process `pid` started, as `process_reads` reads it; empty when it cannot say."""

    if sys.platform != "win32":
        return ""
    return str(process_reads.Windows().process(pid)["identity_token"])


class Watched(contextlib.AbstractContextManager["Watched"]):
    """A process a waiting run belongs to, held open so that its id cannot pass to another.

    It is gone once it exits, and from the start when it had gone already: when it
    started at another time than `started` or not before `before`, its id was reused.
    A process this user may not open is never gone, since nothing can be known of it.
    """

    def __init__(self, pid: int, *, started: str = "", before: str = "") -> None:
        self.pid = pid
        self._handle: int | None = None
        self._gone = False
        if sys.platform != "win32":
            return
        import _winapi

        try:
            self._handle = _winapi.OpenProcess(_SYNCHRONIZE_AND_QUERY, False, pid)
        except OSError as error:
            self._gone = getattr(error, "winerror", None) != _ACCESS_DENIED
            return
        # The handle holds the id, so this reads the start of the process it holds.
        start = _started(pid)
        self._gone = bool(start) and (
            (bool(started) and start != started) or (bool(before) and start >= before)
        )

    def gone(self) -> bool:
        if self._gone:
            return True
        if self._handle is not None:
            import _winapi

            self._gone = _winapi.WaitForSingleObject(self._handle, 0) == _winapi.WAIT_OBJECT_0
        elif sys.platform != "win32":
            try:
                os.kill(self.pid, 0)
            except PermissionError:
                pass
            except OSError:
                self._gone = True
        return self._gone

    def close(self) -> None:
        if self._handle is not None:
            import _winapi

            _winapi.CloseHandle(self._handle)
            self._handle = None

    def __exit__(self, *_exc: object) -> None:
        self.close()


def caller(pid: int | None = None) -> int:
    """The process a run belongs to: `pid`, else the one that started this process.

    A virtual environment's `python.exe`, like `py.exe`, starts the interpreter as its
    child and waits for it, so it ends with the interpreter and outlives its own
    caller: the process that started a launcher is the caller.
    """

    if pid:
        return pid
    parent = os.getppid()
    if sys.platform != "win32":
        return parent
    reads = process_reads.Windows()
    image = os.path.normcase(str(reads.process(parent)["executable_path"]))
    own = os.path.normcase(str(reads.process(os.getpid())["executable_path"]))
    venv = os.path.normcase(os.path.abspath(sys.executable))
    if image and (image == venv != own or Path(image).name in _LAUNCHERS):
        return reads.parent(parent) or parent
    return parent


def _until_gone(argv: Sequence[str], asked: Watched, kind: str, say: Callable[[str], None]) -> int:
    """`argv`'s exit code, or 75 once the process that asked for the run is gone first.

    The gate's waiter and the bridge each wait for the process above them, so this
    process ending is what lets a run still waiting for room leave the queue; a run
    already going goes on under its lease.
    """

    child = subprocess.Popen(argv)
    try:
        while True:
            try:
                return child.wait(timeout=WATCH_SECONDS)
            except subprocess.TimeoutExpired:
                if asked.gone():
                    say(
                        f"the process that asked for {PROJECT}:{kind} has exited:"
                        " a run still waiting for room leaves the queue"
                    )
                    return EXIT_NO_ROOM
    except BaseException:
        # As `subprocess.call` does: an interrupt or a failure here ends the gate too.
        child.kill()
        raise


def gated_command(
    kind: str,
    command: Sequence[str],
    *,
    want: int | None = None,
    lock: Path | None = None,
    gate: str | None = None,
) -> list[str]:
    """`command` as this file's `run` starts it under a lease of `kind`, for a caller's process."""

    return [
        *(sys.executable, str(HERE), "run", "--kind", kind),
        *(("--want", str(want)) if want is not None else ()),
        *(("--lock", str(lock)) if lock is not None else ()),
        *(("--gate", gate) if gate is not None else ()),
        *("--", *command),
    ]


def run(
    kind: str,
    command: Sequence[str],
    *,
    size: int | None = None,
    want: int | None = None,
    wait: bool | None = None,
    pid: int | None = None,
    lock: Path | None = None,
    gate: str | None = None,
    say: Callable[[str], None] = _say,
) -> int:
    """COMMAND under a lease of `kind`, or directly where there is no gate; its exit code.

    `lock` stands in for the earlier branches' lock and `gate` for the installed
    gate's `heavy-gate.json`, in a test.
    """

    found = _located(gate, say)
    if found is None:
        return run_direct(kind, command, want, say=say)
    # Asked before the queue as well, so a command that cannot start waits for no lease;
    # the bridge finds it again where it starts it, about 0.1 s for an npm shim.
    try:
        if _resolved(command) is None:
            say(f"cannot find the program {command[0]!r}")
            return EXIT_NOT_FOUND
    except UnsafeCommandError as unsafe:
        say(str(unsafe))
        return EXIT_USAGE
    lock = Path(os.path.abspath(lock or legacy_lock.lock_path()))
    waiting = waits(wait)
    if not waiting and not legacy_lock.under_holder(lock) and legacy_lock.held_exclusively(lock):
        # Asked before the lease, so a run that would only wait for this byte takes none.
        return _no_room(
            kind,
            f"the earlier branches' heavy-test lock is held by {legacy_lock.holder(lock)}",
            say,
        )
    flag = "--wait" if waiting else "--no-wait"
    started = _started(os.getpid())
    argv = [
        *found.argv,
        *("run", "--kind", kind, flag),
        *(("--size", str(size)) if size is not None else ()),
        *(("--want", str(want)) if want is not None else ()),
        *(("--pid", str(pid)) if pid is not None else ()),
        *("--", sys.executable, str(HERE), "bridge", "--kind", kind, flag),
        *("--owner", f"{os.getpid()}@{started}"),
        *("--state", str(found.state), "--lock", str(lock), "--", *command),
    ]
    try:
        with Watched(caller(pid), before=started) as asked:
            return _until_gone(argv, asked, kind, say)
    except OSError as error:
        say(f"the heavy-process gate cannot be started ({error}): running without it")
        return run_direct(kind, command, want, say=say)


def bridge(
    kind: str,
    command: Sequence[str],
    *,
    state: Path,
    lock: Path,
    wait: bool,
    owners: Sequence[tuple[int, str]] = (),
    say: Callable[[str], None] = _say,
) -> int:
    """COMMAND inside the gate's lease, holding its place at the earlier branches' lock too.

    `owners` are the processes the run is for, each with when it started: once one
    of them is gone, a run still waiting at that lock leaves it, and its lease with it.
    """

    lease = os.environ.get(LEASE_VARIABLE) or None
    try:
        resolved = _resolved(command)
    except UnsafeCommandError as unsafe:
        say(str(unsafe))
        return EXIT_USAGE
    if resolved is None:
        say(f"cannot find the program {command[0]!r}")
        return EXIT_NOT_FOUND
    run_name = f"{PROJECT}:{kind} under the heavy-process gate"
    with contextlib.ExitStack() as held:
        watched = [held.enter_context(Watched(pid, started=start)) for pid, start in owners]
        try:
            with legacy_lock.shared(
                run_name,
                lease_cpus(state, lease),
                lease=lease,
                path=lock,
                wait=wait,
                say=say,
                abandoned=lambda: any(owner.gone() for owner in watched),
            ):
                held.close()
                environment = {**os.environ, **legacy_lock.marker(lock)}
                return subprocess.call(resolved, env=environment)
        except legacy_lock.BusyError as busy:
            return _no_room(kind, busy, say)
        except legacy_lock.AbandonedError:
            say(
                f"the process that asked for {PROJECT}:{kind} has exited:"
                " leaving the queue and the lease"
            )
            return EXIT_NO_ROOM


#: The hold processes of this process's leases, kept for as long as it runs.
_HOLDS: list[subprocess.Popen[bytes]] = []


def hold_until_exit(
    kind: str,
    *,
    lock: Path | None = None,
    gate: str | None = None,
    say: Callable[[str], None] = _say,
) -> None:
    """Hold a lease of `kind` for this process from now until it ends, and mark its environment.

    For a run whose end no caller brackets, such as a test suite that is loaded here
    and run later. The gate's `hold` puts this process into the lease's job, so what
    it starts from now on is counted with it, and stays until this process exits.
    With no room and no wait it exits 75, saying why; where the gate fails, the run
    goes on without a lease, as the gate's contract says. The mark covers every
    process the run starts, and a second call in the same process, which finds it.
    While it waits, for the gate or for the earlier branches' lock, it exits 75 once
    the process that started it is gone.
    """

    lock = lock or legacy_lock.lock_path()
    if legacy_lock.under_holder(lock):
        return
    found = _located(gate, say)
    if found is None:
        return
    waiting = waits(None)
    if not waiting and legacy_lock.held_exclusively(lock):
        raise SystemExit(
            _no_room(
                kind,
                f"the earlier branches' heavy-test lock is held by {legacy_lock.holder(lock)}",
                say,
            )
        )
    with Watched(caller(), before=_started(os.getpid())) as asked:
        _hold(kind, found, lock, waiting, asked, say)
    os.environ.update(legacy_lock.marker(lock))


def _left(kind: str, say: Callable[[str], None]) -> SystemExit:
    say(
        f"the process that asked for {PROJECT}:{kind} has exited:"
        " a run still waiting for room leaves the queue"
    )
    return SystemExit(EXIT_NO_ROOM)


def _line_unless_gone(stream: IO[bytes], asked: Watched) -> bytes | None:
    """The next line of `stream`, or None once the process that asked is gone first.

    A pipe on Windows has no read that gives up after a while, so a thread reads it.
    The gate's waiter waits for this process alone, and it leaves once this one ends.
    """

    lines: list[bytes] = []
    reader = threading.Thread(target=lambda: lines.append(stream.readline()), daemon=True)
    reader.start()
    while True:
        reader.join(WATCH_SECONDS)
        if not reader.is_alive():
            return lines[0] if lines else b""
        if asked.gone():
            return None


def _hold(
    kind: str,
    found: Gate,
    lock: Path,
    waiting: bool,
    asked: Watched,
    say: Callable[[str], None],
) -> None:
    """Take the lease and the place at the earlier lock for `hold_until_exit`, while `asked` is."""

    flag = "--wait" if waiting else "--no-wait"
    argv = [*found.argv, "hold", "--kind", kind, "--pid", str(os.getpid()), flag]
    lease: str | None = None
    try:
        holding = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE)
    except OSError as error:
        say(f"the heavy-process gate cannot be started ({error}): running without a lease")
    else:
        assert holding.stdout is not None
        line = _line_unless_gone(holding.stdout, asked)
        if line is None:
            raise _left(kind, say)
        answer = _answer(line)
        if answer is None:
            say(f"the heavy-process gate failed (exit {holding.wait()}): running without a lease")
        elif not answer.get("admitted"):
            holding.wait()
            raise SystemExit(_no_room(kind, answer.get("detail"), say))
        else:
            _HOLDS.append(holding)
            lease = str(answer["lease"]) if answer.get("lease") else None
            if lease:
                os.environ[LEASE_VARIABLE] = lease
            if isinstance(answer.get("k"), int):
                os.environ[K_VARIABLE] = str(answer["k"])
    hold = contextlib.ExitStack()
    try:
        hold.enter_context(
            legacy_lock.shared(
                f"{PROJECT}:{kind} under the heavy-process gate",
                lease_cpus(found.state, lease),
                lease=lease,
                path=lock,
                wait=waiting,
                say=say,
                abandoned=asked.gone,
            )
        )
    except legacy_lock.BusyError as busy:
        raise SystemExit(_no_room(kind, busy, say)) from None
    except legacy_lock.AbandonedError:
        raise _left(kind, say) from None
    atexit.register(hold.close)


def _answer(line: bytes) -> dict[str, Any] | None:
    try:
        document = json.loads(line)
    except ValueError:
        return None
    return document if isinstance(document, dict) else None


def _gate_leases(found: Gate) -> list[str]:
    """The gate's leases going now, as a waiter would name them; none when it cannot say."""

    try:
        status = subprocess.run(
            [*found.argv, "status", "--json"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=STATUS_SECONDS,
            check=False,
        )
        document = json.loads(status.stdout)
        leases = document["leases"]
        return [
            f"{lease['name']}, process {lease['holder_pid']},"
            f" since {datetime.fromtimestamp(float(lease['since']), tz=UTC).astimezone():%Y-%m-%d %H:%M:%S}"
            for lease in leases
        ]
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
        return []


def load_note(lock: Path | None = None, gate: str | None = None) -> str | None:
    """What a failed run that took no lease says: the heavy runs going now, or None.

    None too when this process runs under a lease or a holder, since its load is then
    the run's own.
    """

    lock = lock or legacy_lock.lock_path()
    if legacy_lock.under_holder(lock) or os.environ.get(LEASE_VARIABLE):
        return None
    found = _located(gate, lambda _line: None)
    named = [*(_gate_leases(found) if found else []), *legacy_lock.earlier_runs(lock)]
    if not named:
        return None
    return (
        f"heavy runs were going as this run ended: {'; '.join(named)}:"
        " a failure here may come from that load rather than from a defect"
    )


def _owner(word: str) -> tuple[int, str]:
    """`PID@STARTED`, as `run` names itself to its bridge."""

    pid, _at, started = word.partition("@")
    return int(pid), started


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python tests/heavy_gate.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    commands = parser.add_subparsers(dest="command", required=True)
    running = commands.add_parser("run", help="run COMMAND under a lease at the gate")
    running.add_argument("--kind", required=True, help="the kind of run, from .heavy-gate.toml")
    running.add_argument("--size", type=int, help="the size of the selection, such as its specs")
    running.add_argument("--want", type=int, help="the worker count the run would like")
    choice = running.add_mutually_exclusive_group()
    choice.add_argument("--wait", action="store_true", default=None, help="wait for room")
    choice.add_argument("--no-wait", dest="wait", action="store_false", help="never wait")
    running.add_argument("--pid", type=int, help="the process the run belongs to")
    running.add_argument("argv", nargs=argparse.REMAINDER, metavar="-- COMMAND ...")
    asked = commands.add_parser("holder", help="say which heavy runs are going, or nothing")
    inner = commands.add_parser("bridge", help=argparse.SUPPRESS)
    inner.add_argument("--kind", required=True)
    inner.add_argument("--state", type=Path, required=True)
    inner.add_argument("--wait", action="store_true")
    inner.add_argument("--no-wait", dest="wait", action="store_false")
    inner.add_argument("--owner", type=_owner, action="append", default=[])
    inner.add_argument("argv", nargs=argparse.REMAINDER)
    for sub in (running, asked, inner):
        # Stand-ins for a test: the earlier branches' lock and the gate's entry point.
        sub.add_argument("--lock", type=Path, help=argparse.SUPPRESS)
        sub.add_argument("--gate", help=argparse.SUPPRESS)
    options = parser.parse_args(argv)
    if options.command == "holder":
        note = load_note(options.lock, options.gate)
        if note is not None:
            sys.stdout.write(f"{note}\n")
        return 0
    command = options.argv[1:] if options.argv[:1] == ["--"] else options.argv
    if not command:
        parser.error("name the command to run after --")
    if options.command == "bridge":
        lock = options.lock or legacy_lock.lock_path()
        return bridge(
            options.kind,
            command,
            state=options.state,
            lock=lock,
            wait=options.wait,
            owners=options.owner,
        )
    if options.want is not None and options.want < 1:
        parser.error("--want is a whole number from 1")
    return run(
        options.kind,
        command,
        size=options.size,
        want=options.want,
        wait=options.wait,
        pid=options.pid,
        lock=options.lock,
        gate=options.gate,
    )


if __name__ == "__main__":
    sys.exit(main())
