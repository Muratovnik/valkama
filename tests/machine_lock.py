"""One lock for the heavy test runs of every Valkama checkout on this machine.

    python tests/machine_lock.py run --run WHAT [--pid PID] [--path FILE] -- COMMAND ...
    python tests/machine_lock.py holder [--path FILE]

A development tool beside the tests, as `tests/isolated.py` is. Two heavy runs
at once — the whole unittest suite under coverage, the whole browser suite, the
Vitest suite — fail timing-sensitive tests that pass alone, so the second waits
for the first instead of running beside it. The commands take it themselves:
the `tests` package's `load_tests` for a run of the whole suite, and
`web/tests/unitRun.ts` and `web/tests/browser/allowedRun.ts` through the command
above, so there is one implementation and one protocol. A targeted run takes
none, and when it fails it says who holds the lock as it ends, the `tests`
package for unittest and `holder` for Vitest, so the failure reads as load.

A run started by a holder is covered by its hold: whatever holds the lock marks
the environment of what it starts with `HELD_BY_ANCESTOR`, and a run that finds
the lock it wants marked there goes in without waiting, because waiting would be
waiting for itself. `tests/isolated.py gates` holds it in-process for its
`unittest` step and marks that step's environment.

The lock is a file in the system's temporary directory, whatever TEMP or profile
a run was given: outside every checkout and worktree, so all of them meet at it,
and outside `~/.valkama` and the installed product, which no test run has any
business locking. It is the operating system's lock on the file's first byte,
taken through `server.store_lock`, so it goes with its holder however that
process ends and a dead holder needs no detecting. The rest of the file is the
holder's record: the checkout, the process, the run and since when, which is
what a waiter says when it starts to wait and again every minute while it does.
"""

from __future__ import annotations

import argparse
import atexit
import contextlib
import getpass
import json
import os
import subprocess
import sys
import time
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import store_lock

#: How often a waiter says again who it is waiting for.
REPORT_SECONDS = 60.0
POLL_SECONDS = 0.25
#: Set in the environment of what a holder starts, to the lock file it holds.
HELD_BY_ANCESTOR = "VALKAMA_HEAVY_TEST_LOCK_HELD"


def logon_local_app_data() -> str | None:
    """The user's LOCALAPPDATA as Windows set it at logon, or None where it set none.

    Not the variable: `tests/isolated.py gates` and the release check move it into a
    throwaway profile for the processes they start, and a lock found through the
    moved one would hold only the runs given that profile. A session with no
    interactive logon, such as a service, may have no such value.
    """

    if sys.platform != "win32":
        return None
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Volatile Environment") as key:
            value, _kind = winreg.QueryValueEx(key, "LOCALAPPDATA")
    except OSError:
        return None
    return str(value) or None


def lock_path() -> Path:
    """The machine's lock for this user, in the system's temporary directory.

    Not in the TEMP a run was given: a release coordinator gives its checks a TEMP
    inside the checkout, and a lock there would hold only the runs that share it.
    On Windows that directory is the user's `%LOCALAPPDATA%/Temp`, read as Windows
    set it at logon and from the caller's variable only where it set none;
    elsewhere it is `/tmp`, which users share, so the name holds the user.
    """

    if sys.platform == "win32":
        directory = Path(logon_local_app_data() or caller_local_app_data()) / "Temp"
    else:
        directory = Path("/tmp")
    return directory / f"valkama-heavy-tests-{getpass.getuser()}.lock"


def caller_local_app_data() -> str:
    """`LOCALAPPDATA` as the caller of this process set it.

    Importing the `tests` package moves the variable into the suite's directory
    and keeps the caller's value, and `tests/isolated.py gates` imports this file
    through the package; a lock in the suite's directory would hold nobody else's
    run. Run as a script, this file imports no package, so the command it runs
    keeps the caller's variable and finds the browsers under it.
    """

    package = sys.modules.get("tests")
    caller = getattr(package, "CALLER_LOCAL_APP_DATA", None)
    return caller or os.environ["LOCALAPPDATA"]


def marker(path: Path | None = None) -> dict[str, str]:
    """What a holder of the lock at `path`, the machine's by default, adds to a child's environment."""

    return {HELD_BY_ANCESTOR: os.path.normcase(os.path.realpath(path or lock_path()))}


def _say(line: str) -> None:
    sys.stdout.write(f"{line}\n")
    sys.stdout.flush()


def _duration(seconds: float) -> str:
    minutes, rest = divmod(max(0, round(seconds)), 60)
    return f"{minutes} min {rest} s" if minutes else f"{rest} s"


def holder(path: Path) -> str:
    """Who holds the lock at `path`, as a waiter says it."""

    try:
        # From the second byte: on Windows the first is locked, and reading it fails.
        with path.open("rb") as handle:
            handle.seek(1)
            record = json.loads(handle.read())
        since = datetime.fromisoformat(record["since"])
        return (
            f"{record['run']} in {record['checkout']}, process {record['pid']},"
            f" since {since:%Y-%m-%d %H:%M:%S}"
            f" ({_duration((datetime.now().astimezone() - since).total_seconds())} ago)"
        )
    except (OSError, ValueError, KeyError, TypeError):
        # Between taking the lock and writing its record, or a record cut off by a crash.
        return "a run that has not recorded itself yet"


def load_note(path: Path | None = None) -> str | None:
    """What a failed run that took no lock says: who holds the lock now, or None.

    None too when this process runs under the holder, since its load is then the
    run's own. Asking takes a free lock for an instant, so a run that starts in
    that instant waits once for a holder that has not recorded itself.
    """

    path = path or lock_path()
    if os.environ.get(HELD_BY_ANCESTOR) == marker(path)[HELD_BY_ANCESTOR] or not path.is_file():
        return None
    with path.open("a+b") as handle:
        if store_lock.try_lock(handle):
            store_lock.unlock(handle)
            return None
    return (
        f"the heavy-test lock {path} was held as this run ended, by {holder(path)}:"
        " a failure here may come from that load rather than from a defect"
    )


@contextmanager
def held(
    run: str,
    *,
    path: Path | None = None,
    pid: int | None = None,
    say: Callable[[str], None] = _say,
    report_every: float = REPORT_SECONDS,
) -> Iterator[None]:
    """Hold the machine's heavy-test lock for `run`, waiting as long as another run holds it.

    `pid` is the process the run belongs to, which is this one unless a caller
    started this process to hold the lock for it. A run whose environment marks
    this very lock as held by an ancestor holds nothing and goes in at once.
    """

    path = path or lock_path()
    if os.environ.get(HELD_BY_ANCESTOR) == marker(path)[HELD_BY_ANCESTOR]:
        yield
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        if not store_lock.try_lock(handle):
            started = time.monotonic()
            say(f"waiting for the heavy-test lock {path}: it is held by {holder(path)}")
            next_report = started + report_every
            while not store_lock.try_lock(handle):
                time.sleep(min(POLL_SECONDS, report_every))
                if time.monotonic() >= next_report:
                    waited = _duration(time.monotonic() - started)
                    say(f"still waiting after {waited}: the lock is held by {holder(path)}")
                    next_report += report_every
            say(f"took the heavy-test lock after {_duration(time.monotonic() - started)}")
        try:
            record = {
                "checkout": ROOT.as_posix(),
                "pid": pid or os.getpid(),
                "run": run,
                "since": datetime.now().astimezone().isoformat(timespec="seconds"),
            }
            # Append mode writes at the end, so the record goes after the locked byte.
            handle.truncate(1)
            handle.write(json.dumps(record).encode())
            handle.flush()
            yield
        finally:
            handle.truncate(1)
            store_lock.unlock(handle)


def hold_until_exit(
    run: str, *, path: Path | None = None, say: Callable[[str], None] = _say
) -> None:
    """Hold the lock from now until this process ends, and mark this process's environment.

    For a run whose end no caller brackets, such as a test suite that is loaded here
    and run later. The mark covers every process the run starts, and a second call
    in the same process, which finds it.
    """

    hold = contextlib.ExitStack()
    hold.enter_context(held(run, path=path, say=say))
    atexit.register(hold.close)
    os.environ.update(marker(path))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a command holding the heavy-test lock.")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="wait for the lock, run COMMAND, give the lock back")
    run.add_argument("--run", required=True, help="what the run is, as a waiter will read it")
    run.add_argument("--pid", type=int, help="the process the run belongs to; by default this one")
    run.add_argument("--path", type=Path, help="another lock file than the machine's")
    run.add_argument("argv", nargs=argparse.REMAINDER, metavar="-- COMMAND ...")
    asked = commands.add_parser(
        "holder", help="say who holds the lock, for a failed run; or nothing"
    )
    asked.add_argument("--path", type=Path, help="another lock file than the machine's")
    options = parser.parse_args(argv)
    if options.command == "holder":
        note = load_note(options.path)
        if note is not None:
            _say(note)
        return 0
    command = options.argv[1:] if options.argv[:1] == ["--"] else options.argv
    if not command:
        parser.error("name the command to run after --")
    with held(options.run, path=options.path, pid=options.pid):
        environment = {**os.environ, **marker(options.path)}
        try:
            return subprocess.run(command, env=environment, check=False).returncode
        except OSError as error:
            _say(f"could not start {command[0]}: {error}")
            return 127


if __name__ == "__main__":
    sys.exit(main())
