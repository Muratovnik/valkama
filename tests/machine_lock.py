"""One lock for the heavy test runs of every Valkama checkout on this machine.

    python tests/machine_lock.py run --run WHAT [--pid PID] [--path FILE] -- COMMAND ...

A development tool beside the tests, as `tests/isolated.py` is. Two heavy runs
at once — the whole unittest suite under coverage, the whole browser suite —
fail timing-sensitive tests that pass alone, so the second waits for the first
instead of running beside it. `tests/isolated.py gates` takes it in-process for
its `unittest` step, and `web/tests/browser/allowedRun.ts` runs Playwright
through the command above, so there is one implementation and one protocol.

The lock is a file in the user's temporary directory: outside every checkout
and worktree, so all of them meet at it, and outside `~/.valkama` and the
installed product, which no test run has any business locking. It is the
operating system's lock on the file's first byte, taken through
`server.store_lock`, so it goes with its holder however that process ends and
a dead holder needs no detecting. The rest of the file is the holder's record:
the checkout, the process, the run and since when, which is what a waiter says
when it starts to wait and again every minute while it does.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import subprocess
import sys
import tempfile
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


def lock_path() -> Path:
    """The machine's lock for this user; `/tmp` is shared between users, so the name holds one."""

    return Path(tempfile.gettempdir()) / f"valkama-heavy-tests-{getpass.getuser()}.lock"


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
    started this process to hold the lock for it.
    """

    path = path or lock_path()
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


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a command holding the heavy-test lock.")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="wait for the lock, run COMMAND, give the lock back")
    run.add_argument("--run", required=True, help="what the run is, as a waiter will read it")
    run.add_argument("--pid", type=int, help="the process the run belongs to; by default this one")
    run.add_argument("--path", type=Path, help="another lock file than the machine's")
    run.add_argument("argv", nargs=argparse.REMAINDER, metavar="-- COMMAND ...")
    options = parser.parse_args(argv)
    command = options.argv[1:] if options.argv[:1] == ["--"] else options.argv
    if not command:
        parser.error("name the command to run after --")
    with held(options.run, path=options.path, pid=options.pid):
        try:
            return subprocess.run(command, check=False).returncode
        except OSError as error:
            _say(f"could not start {command[0]}: {error}")
            return 127


if __name__ == "__main__":
    sys.exit(main())
