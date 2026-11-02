"""Run the gates, or a server, inside a throwaway profile.

    python tests/isolated.py gates --out DIR [--only NAME ...] [--owner]
    python tests/isolated.py serve --out DIR [--store-copy [SOURCE]]
    python tests/isolated.py stop --out DIR

A development tool and not part of the product: `valkama` has no such command,
and nothing under `server/` imports this file. It stands on its own beside the
tests because everything it runs is what a change is checked with. Run it with
the interpreter of the environment built from `requirements-dev.txt`.

Each rule here is a way a hand-written wrapper went wrong:

- The redirect goes to the child and never to the caller's shell. A redirected
  shell loses its Git identity, and a browser started from it no longer finds
  the browsers under the real `LOCALAPPDATA`.
- Every location a child could write to moves together. The store and the
  project registry take their roots from different variables, so a run that
  moved only `HOME` and `USERPROFILE` wrote test projects into the real registry.
- `TEMP` stays where it is. Inside a working tree, renames in the suite fail
  now and then with `PermissionError`, which reads as a defect in the code.
- A child gets no pipe of the caller's. A server that inherits one keeps a
  pipeline or `execFileSync` waiting for as long as it runs.
- A failed step decides the result whatever ran after it, and a run in which
  nothing ran is a failure.
- The result directory has no default, so a script cannot keep writing into the
  directory of the task it was first written for.

A served store copy holds whatever the live store holds, so it lives inside the
throwaway profile, together with any backup a migration writes beside it, and
the whole profile goes when the server stops or fails. One process owns that:
`serve` starts a supervisor and returns; the supervisor holds the server's
process handle, so it cannot stop a process that merely reused the number, and
it cleans up when the server dies with nobody watching.
"""

from __future__ import annotations

import argparse
import contextlib
import dataclasses
import json
import os
import re
import shlex
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import processes, store
from windows import release

HOME = "home"
LOGS = "logs"
STATE = "serve.json"
STOP = "serve.stop"
SUMMARY = "gates.txt"
SUPERVISE = "supervise"

#: Long enough for a large store copy to migrate before the listener opens.
START_SECONDS = 180.0
STOP_SECONDS = 30.0
#: A killed process's file handles outlast it for a moment on Windows.
REMOVE_SECONDS = 10.0
POLL_SECONDS = 0.1

#: What the server says once it holds its port. It binds port 0 and names the
#: one it got, so no other process can take the port between a check and the bind.
_LISTENING = re.compile(rb"Valkama on http://127\.0\.0\.1:(\d+)/")
# Without a console window: a console child of a process with none gets its own.
_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
_NEW_GROUP = 0x00000200 if sys.platform == "win32" else 0
_STILL_ACTIVE = 259


class ServeError(RuntimeError):
    """The server did not come up; the message says what to read."""


@dataclass(frozen=True)
class Step:
    """One gate, spelled as the repository instructions spell it."""

    name: str
    group: str
    command: str
    directory: str = "."


#: The list in `AGENTS.md`, in its order; `tests/test_isolated.py` compares them.
GATE_STEPS = (
    Step("ruff", "python", "python -m ruff check ."),
    Step("format", "python", "python -m ruff format --check ."),
    Step("relkit", "python", "python .github/relkit.pyz audit --history"),
    Step("typos", "python", "typos"),
    Step(
        "vulture",
        "python",
        "vulture server tests valkama.py vulture_whitelist.py --min-confidence 60",
    ),
    Step("mypy", "python", "mypy"),
    Step("lint-imports", "python", "lint-imports --cache-dir .cache/import-linter"),
    Step(
        "semgrep",
        "python",
        "semgrep scan --config p/python --config p/security-audit --metrics off --error"
        " server valkama.py",
    ),
    Step(
        "unittest",
        "python",
        'python -m coverage run -m unittest discover -s . -p "test_*.py"',
    ),
    Step("coverage", "python", "python -m coverage report"),
    Step("web-test", "web", "npm test", "web"),
    Step("web-typecheck", "web", "npm run typecheck", "web"),
    Step("web-build", "web", "npm run build", "web"),
    Step("desktop-test", "desktop", "npm test", "desktop"),
)


class Run(NamedTuple):
    """A step with its program resolved."""

    name: str
    argv: list[str]
    cwd: Path


def _say(line: str) -> None:
    sys.stdout.write(f"{line}\n")
    sys.stdout.flush()


# --- the profile -------------------------------------------------------------


def store_path(home: Path) -> Path:
    """Where the store goes in a throwaway profile: where the default would put it."""

    return home / store.DATA_ROOT / f"{store.DATA_PREFIX}.sqlite3"


def isolated_environment(home: Path) -> dict[str, str]:
    """The caller's environment with every user location moved into `home`.

    `TEMP` is left alone on purpose. Nothing of the caller's `VALKAMA_*` comes
    through, because those are the variables that point a child back at real
    state. `VALKAMA_PROTECTED_STORE` is the store's own guard for the one path
    it must refuse, named from the caller's profile before the move.
    """

    real_store = Path(store.data_root()) / f"{store.DATA_PREFIX}.sqlite3"
    environment = {
        name: value
        for name, value in os.environ.items()
        if not name.upper().startswith("VALKAMA_") and name.upper() != "GIT_CONFIG_GLOBAL"
    }
    environment.update(
        {
            "HOME": str(home),
            "USERPROFILE": str(home),
            "LOCALAPPDATA": str(home / "AppData" / "Local"),
            "APPDATA": str(home / "AppData" / "Roaming"),
            "VALKAMA_DB": str(store_path(home)),
            "VALKAMA_NO_TRAY": "1",
            "VALKAMA_PROTECTED_STORE": str(real_store),
            "PYTHONUTF8": "1",
        }
    )
    return environment


def _git_settings() -> dict[str, str]:
    """What a child's Git needs from the caller's setup, and nothing else of it.

    Only these, written into the throwaway profile, rather than the caller's
    whole configuration: that file carries hooks and credential helpers no gate
    should run, and a child's `git config --global` would write into it.
    """

    settings = {"safe.directory": ROOT.as_posix()}
    for key in ("user.name", "user.email"):
        found = processes.run_text(["git", "-C", str(ROOT), "config", "--get", key])
        if found.returncode == 0 and found.stdout.strip():
            settings[key] = found.stdout.strip()
    return settings


def prepare_home(home: Path) -> None:
    """A new, empty profile, so nothing from an earlier run reads as state."""

    if not remove_tree(home):
        raise ServeError(f"could not clear {home}")
    for directory in (
        home / store.DATA_ROOT,
        home / "AppData" / "Local",
        home / "AppData" / "Roaming",
    ):
        directory.mkdir(parents=True)
    for key, value in _git_settings().items():
        processes.run_text(["git", "config", "--file", str(home / ".gitconfig"), key, value])


def remove_tree(path: Path) -> bool:
    """Remove `path`, waiting out a dead process's handles; report whether it went."""

    deadline = time.monotonic() + REMOVE_SECONDS
    while True:
        try:
            shutil.rmtree(path)
        except FileNotFoundError:
            return True
        except OSError:
            if time.monotonic() >= deadline:
                return not path.exists()
            time.sleep(POLL_SECONDS)
        else:
            return True


# --- gates -------------------------------------------------------------------


def _tail(log: Path) -> str:
    with log.open("rb") as handle:
        handle.seek(max(0, log.stat().st_size - 4096))
        # For a person reading a summary and for nothing else, so a lossy decode
        # costs nothing; the log keeps the bytes the tool wrote.
        text = handle.read().decode("utf-8", errors="replace")
    return " | ".join(line.strip() for line in text.splitlines()[-3:])


def _run_step(run: Run, log: Path, environment: Mapping[str, str]) -> int:
    with log.open("wb") as output:
        try:
            return subprocess.run(
                run.argv,
                cwd=run.cwd,
                env=dict(environment),
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                creationflags=_NO_WINDOW,
                check=False,
            ).returncode
        except OSError as error:
            output.write(f"could not start {run.argv[0]}: {error}\n".encode())
            return 127


def run_gates(runs: Sequence[Run], out: Path, environment: Mapping[str, str]) -> int:
    """Run every step; the result is 0 only when at least one ran and none failed."""

    logs = out / LOGS
    logs.mkdir(parents=True, exist_ok=True)
    failed = []
    with (out / SUMMARY).open("w", encoding="utf-8", newline="\n") as summary:

        def report(line: str) -> None:
            _say(line)
            summary.write(f"{line}\n")
            summary.flush()

        for run in runs:
            log = logs / f"{run.name}.log"
            code = _run_step(run, log, environment)
            if code != 0:
                failed.append(run.name)
            report(f"{run.name:<14} exit={code}  {_tail(log)}")
        if not runs:
            report("no gate step ran")
            return 1
        if failed:
            report(f"failed: {', '.join(failed)}")
            return 1
        report(f"all {len(runs)} steps passed")
    return 0


def select_steps(only: Sequence[str] | None, *, owner: bool) -> list[Step]:
    """The steps named, by step or by group, in the order of the instructions."""

    wanted = set(only) if only is not None else None
    chosen = [
        step for step in GATE_STEPS if wanted is None or step.name in wanted or step.group in wanted
    ]
    if owner:
        chosen = [
            dataclasses.replace(step, command=f"{step.command} --owner")
            if step.name == "relkit"
            else step
            for step in chosen
        ]
    return chosen


def _argv(command: str, tools: Mapping[str, tuple[str, ...]]) -> list[str]:
    program, *arguments = shlex.split(command)
    if program == "python":
        return [sys.executable, *arguments]
    if program == "npm":
        return [release.NPM, *arguments]
    return [*tools[program], *arguments]


def gates(steps: Sequence[Step], out: Path) -> int:
    if _read_state(out) is not None:
        _say(f"a server is recorded in {out}; run stop first")
        return 1
    interpreter = release.running_interpreter()
    requirements = (ROOT / "requirements-dev.txt").read_text(encoding="utf-8")
    try:
        tools = release.require_toolchain(interpreter, release.pins(requirements))
    except release.ToolchainError as error:
        _say(str(error))
        _say("no gate step ran")
        return 1
    home = out / HOME
    prepare_home(home)
    environment = release.tool_environment(interpreter, isolated_environment(home))
    head = processes.run_text(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"])
    _say(f"root: {ROOT}  head: {head.stdout.strip()}")
    runs = [Run(step.name, _argv(step.command, tools), ROOT / step.directory) for step in steps]
    return run_gates(runs, out, environment)


# --- serve -------------------------------------------------------------------


def copy_store(source: Path, target: Path) -> None:
    """Back `source` up into `target` through a connection that cannot write to it."""

    uri = f"{source.resolve().as_uri()}?mode=ro"
    with contextlib.closing(sqlite3.connect(uri, uri=True)) as reader:
        with contextlib.closing(sqlite3.connect(target)) as writer:
            reader.backup(writer)


def _write_state(out: Path, state: Mapping[str, object]) -> None:
    # Not through a rename: a reader holding the file open would fail it on
    # Windows, and `_read_state` already treats a half-written file as not yet.
    (out / STATE).write_text(json.dumps(state), encoding="utf-8", newline="\n")


def _read_state(out: Path) -> dict | None:
    for _ in range(50):
        try:
            return json.loads((out / STATE).read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            time.sleep(POLL_SECONDS)
    return None


def _wait_for_port(server: subprocess.Popen, log: Path) -> int:
    deadline = time.monotonic() + START_SECONDS
    while time.monotonic() < deadline:
        found = _LISTENING.search(log.read_bytes())
        if found:
            return int(found.group(1))
        code = server.poll()
        if code is not None:
            raise ServeError(f"the server exited with code {code} before listening; see {log}")
        time.sleep(POLL_SECONDS)
    raise ServeError(f"the server did not start listening in {START_SECONDS:.0f}s; see {log}")


def supervise(out: Path, source: Path | None, command: Sequence[str] | None = None) -> None:
    """Own one server from start to cleanup; the last thing written says how it went."""

    home, stop_file = out / HOME, out / STOP
    stop_file.unlink(missing_ok=True)
    (out / LOGS).mkdir(parents=True, exist_ok=True)
    log = out / LOGS / "serve.log"
    supervisor = os.getpid()
    _write_state(out, {"state": "starting", "supervisor": supervisor})
    server: subprocess.Popen | None = None
    problems = []
    try:
        prepare_home(home)
        if source is not None:
            copy_store(source, store_path(home))
        argv = command or [sys.executable, "valkama.py", "serve", "--port", "0"]
        with log.open("wb") as output:
            server = subprocess.Popen(
                argv,
                cwd=ROOT,
                env=isolated_environment(home),
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                creationflags=_NO_WINDOW,
                # The process group `stop_process_tree` kills on POSIX.
                start_new_session=sys.platform != "win32",
            )
        port = _wait_for_port(server, log)
        _write_state(
            out,
            {
                "state": "ready",
                "supervisor": supervisor,
                "pid": server.pid,
                "port": port,
                "url": f"http://127.0.0.1:{port}/",
                "log": str(log),
            },
        )
        while server.poll() is None and not stop_file.exists():
            time.sleep(POLL_SECONDS)
        if not stop_file.exists():
            problems.append(f"the server exited with code {server.returncode}; see {log}")
    except (OSError, sqlite3.Error, ServeError) as error:
        problems.append(str(error))
    finally:
        if server is not None and server.poll() is None:
            if not processes.stop_process_tree(server):
                problems.append(f"the process tree of {server.pid} was not confirmed stopped")
        if not remove_tree(home):
            problems.append(f"{home} is still on disk; it may hold a store copy")
        if problems:
            _write_state(out, {"state": "failed", "error": "; ".join(problems)})
        else:
            _write_state(out, {"state": "stopped"})


def alive(pid: int) -> bool:
    """Whether a process is still running, asked without signalling it."""

    if sys.platform == "win32":
        import _winapi

        try:
            handle = _winapi.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
        except OSError:
            return False
        try:
            return _winapi.GetExitCodeProcess(handle) == _STILL_ACTIVE
        finally:
            _winapi.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _clear_state(out: Path) -> None:
    (out / STATE).unlink(missing_ok=True)
    (out / STOP).unlink(missing_ok=True)


def start(out: Path, source: Path | None) -> int:
    """Start a supervisor, wait until it says how the start went, and return."""

    if _read_state(out) is not None:
        _say(f"a server is recorded in {out}; run stop first")
        return 1
    (out / LOGS).mkdir(parents=True, exist_ok=True)
    argv = [sys.executable, __file__, SUPERVISE, "--out", str(out)]
    if source is not None:
        argv += ["--store-copy", str(source)]
    supervisor_log = out / LOGS / "supervisor.log"
    with supervisor_log.open("wb") as output:
        supervisor = subprocess.Popen(
            argv,
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=subprocess.STDOUT,
            creationflags=_NO_WINDOW | _NEW_GROUP,
            start_new_session=sys.platform != "win32",
        )
    deadline = time.monotonic() + START_SECONDS + STOP_SECONDS
    while time.monotonic() < deadline:
        state = _read_state(out)
        if state is not None and state["state"] == "ready":
            _say(
                f"serving url={state['url']} port={state['port']} pid={state['pid']}"
                f" supervisor={state['supervisor']} log={state['log']}"
            )
            return 0
        if state is not None and state["state"] == "failed":
            _say(f"serve failed: {state['error']}")
            _clear_state(out)
            return 1
        if supervisor.poll() is not None:
            _say(f"the supervisor exited with code {supervisor.returncode}; see {supervisor_log}")
            remove_tree(out / HOME)
            _clear_state(out)
            return 1
        time.sleep(POLL_SECONDS)
    _say(f"serve did not report back in time; see {supervisor_log}")
    stop(out)
    return 1


class _RecordedProcess:
    """A process known only by a recorded number, for `stop_process_tree`."""

    def __init__(self, pid: int) -> None:
        self.pid = pid

    def wait(self, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while alive(self.pid):
            if time.monotonic() >= deadline:
                raise subprocess.TimeoutExpired(str(self.pid), timeout)
            time.sleep(POLL_SECONDS)

    def terminate(self) -> None:
        os.kill(self.pid, signal.SIGTERM)

    def kill(self) -> None:
        self.terminate()


def _answers(port: int) -> bool:
    try:
        socket.create_connection(("127.0.0.1", port), timeout=1).close()
    except OSError:
        return False
    return True


def _stop_orphan(state: Mapping[str, object]) -> list[str]:
    """Stop a server whose supervisor died: the one case with only a number to go on.

    The number is trusted only together with the port the server was recorded
    on. Both matching by chance is not a real risk; either alone would be.
    """

    pid, port = state["pid"], state["port"]
    if not isinstance(pid, int) or not isinstance(port, int):
        return ["the recorded server is unreadable"]
    if alive(pid) and _answers(port):
        if not processes.stop_process_tree(_RecordedProcess(pid)):
            return [f"the process tree of {pid} was not confirmed stopped"]
    elif _answers(port):
        return [f"port {port} still answers but process {pid} is gone; nothing was stopped"]
    return []


def _wait_for_end(out: Path, supervisor: int) -> dict | None:
    deadline = time.monotonic() + STOP_SECONDS
    while time.monotonic() < deadline:
        state = _read_state(out)
        if state is None or state["state"] in ("stopped", "failed"):
            return state
        if not alive(supervisor):
            return state
        time.sleep(POLL_SECONDS)
    return _read_state(out)


def stop(out: Path) -> int:
    """Stop what `serve` started in `out` and remove its profile; say what went wrong."""

    home = out / HOME
    state = _read_state(out)
    if state is None:
        remove_tree(home)
        _say(f"no server is recorded in {out}")
        return 1
    problems = []
    if state["state"] in ("starting", "ready") and alive(state["supervisor"]):
        (out / STOP).touch()
        state = _wait_for_end(out, state["supervisor"]) or {"state": "stopped"}
    if state["state"] == "failed":
        problems.append(state["error"])
    elif state["state"] == "ready":
        if alive(state["supervisor"]):
            problems.append(f"the supervisor {state['supervisor']} did not stop in time")
        else:
            _say(f"the supervisor {state['supervisor']} had died; stopping its server")
            problems += _stop_orphan(state)
    if not remove_tree(home):
        problems.append(f"{home} is still on disk; it may hold a store copy")
    elif not problems or state["state"] == "failed":
        _clear_state(out)
    if problems:
        _say(f"stop failed: {'; '.join(problems)}")
        return 1
    _say("stopped")
    return 0


# --- the command line --------------------------------------------------------


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Gates and a server in a throwaway profile.")
    commands = parser.add_subparsers(dest="command", required=True, metavar="{gates,serve,stop}")
    names = sorted({step.name for step in GATE_STEPS} | {step.group for step in GATE_STEPS})

    gates_command = commands.add_parser("gates", help="run the gates of the repository")
    gates_command.add_argument(
        "--only", nargs="+", choices=names, metavar="NAME", help=f"any of: {', '.join(names)}"
    )
    gates_command.add_argument(
        "--owner", action="store_true", help="have the release audit enforce the owner policy"
    )
    serve_command = commands.add_parser("serve", help="start a server on a free port and return")
    serve_command.add_argument(
        "--store-copy",
        nargs="?",
        const="",
        metavar="SOURCE",
        help="serve a read-only copy of SOURCE, by default the store this user runs on",
    )
    commands.add_parser("stop", help="stop that server and remove its profile")
    supervise_command = commands.add_parser(SUPERVISE)
    supervise_command.add_argument("--store-copy")
    for command in commands.choices.values():
        command.add_argument("--out", type=Path, required=True, help="where everything is written")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8")
    options = _parser().parse_args(argv)
    out = options.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if options.command == "gates":
        return gates(select_steps(options.only, owner=options.owner), out)
    if options.command == "stop":
        return stop(out)
    copy = options.store_copy
    # The one resolution of where the store is, asked here, in the caller's own
    # environment. Nothing else in this file names the live store.
    source = None if copy is None else Path(copy or store.db_path())
    if options.command == SUPERVISE:
        supervise(out, source)
        return 0
    return start(out, source)


if __name__ == "__main__":
    sys.exit(main())
