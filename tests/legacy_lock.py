"""The heavy-test lock of earlier Valkama branches, held beside the machine's heavy-process gate.

Before the gate (`tests/heavy_gate.py`), every Valkama checkout's heavy runs went
through a lock file of their own in the system's temporary directory, each
declaring the CPUs it needed. A branch made before the gate still does until it
is merged, and its runs see the gate's leases no more than the gate sees theirs,
except as load. So a run this tree starts through the gate also takes its place
at that lock, as one more run of its protocol, and keeps it for as long as it
runs:

- It holds the first byte of the lock file in shared mode. An earlier run that
  takes the whole machine holds that byte exclusively, as the first version of
  the lock did for every run, so either keeps the other out.
- It writes itself into `<file>.runs/` as a run going, counting the cores of the
  profile the gate admitted it by, or the whole machine where the gate gave
  none. An earlier run that shares the machine adds those up with its own need,
  as it does for its own kind, so it waits for this run where the sum would not
  fit.
- It writes the record after the first byte, which an earlier version's waiter
  reads to say whom it waits for.

The place is taken after the gate's lease, never before: the cores it counts are
the lease's, and a run waiting at the gate holds nothing an earlier run would
wait for. Taking the byte and writing the run's file happen in one decision, under
the lock's `.admission` lock, so an earlier run's decision sees both or neither.
The runs of earlier branches waiting in `.runs/` are not a queue this run joins:
it goes in once nothing holds the byte exclusively.

Every lock is the operating system's, so it goes with its process however that
ends, and a file in `.runs/` whose byte nobody holds is a process that has gone:
the next decision deletes it. Nothing waits for a timeout, and nothing needs
removing by hand. This file goes once no worktree on the machine runs a branch
that predates the gate.
"""

from __future__ import annotations

import contextlib
import ctypes
import getpass
import json
import os
import secrets
import sys
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import BinaryIO, NamedTuple

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import store_lock

#: How often a run that waits for the lock says again why it waits.
REPORT_SECONDS = 60.0
POLL_SECONDS = 0.25
#: Set in the environment of what a holder starts, to the lock file it holds; a run
#: that finds its own lock file named there is the holder's and takes no place.
HELD_BY_ANCESTOR = "VALKAMA_HEAVY_TEST_LOCK_HELD"


class BusyError(Exception):
    """The lock is held exclusively by an earlier run and the caller does not wait; why."""


class AbandonedError(Exception):
    """The run that waited for the lock is no longer wanted, and holds nothing."""


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
    set it at logon and from the variable only where it set none; elsewhere it is
    `/tmp`, which users share, so the name holds the user.
    """

    if sys.platform == "win32":
        directory = Path(logon_local_app_data() or os.environ["LOCALAPPDATA"]) / "Temp"
    else:
        directory = Path("/tmp")
    return directory / f"valkama-heavy-tests-{getpass.getuser()}.lock"


def marker(path: Path | None = None) -> dict[str, str]:
    """What a holder of the lock at `path`, the machine's by default, adds to a child's environment."""

    return {HELD_BY_ANCESTOR: os.path.normcase(os.path.realpath(path or lock_path()))}


def under_holder(path: Path | None = None, environment: Mapping[str, str] = os.environ) -> bool:
    """Whether `environment` marks the lock at `path` as held by an ancestor of this process."""

    return environment.get(HELD_BY_ANCESTOR) == marker(path)[HELD_BY_ANCESTOR]


def _say(line: str) -> None:
    sys.stdout.write(f"{line}\n")
    sys.stdout.flush()


def duration(seconds: float) -> str:
    minutes, rest = divmod(max(0, round(seconds)), 60)
    return f"{minutes} min {rest} s" if minutes else f"{rest} s"


def _cpus(count: float) -> str:
    return f"{count:g} CPU" if count == 1 else f"{count:g} CPUs"


def holder(path: Path) -> str:
    """Who holds the lock at `path` by the record after its first byte, as a waiter says it.

    The record an earlier version of this tool writes and its waiters read, which
    this one keeps writing for them.
    """

    try:
        # From the second byte: on Windows the first is locked, and reading it fails.
        with path.open("rb") as handle:
            handle.seek(1)
            record = json.loads(handle.read())
        since = datetime.fromisoformat(record["since"])
        return (
            f"{record['run']} in {record['checkout']}, process {record['pid']},"
            f" since {since:%Y-%m-%d %H:%M:%S}"
            f" ({duration((datetime.now().astimezone() - since).total_seconds())} ago)"
        )
    except (OSError, ValueError, KeyError, TypeError):
        # Between taking the lock and writing its record, or a record cut off by a crash.
        return "a run that has not recorded itself yet"


# The operating system's lock on a file's first byte. Exclusive is `server.store_lock`'s,
# the one an earlier version of this tool takes; shared is LockFileEx without its
# exclusive flag on Windows, which that exclusive lock and a shared one refuse each
# other, and flock elsewhere. `msvcrt`, `fcntl` and the Windows types are each imported
# where they are used, since none is importable on every platform.


def _overlapped() -> ctypes.Structure:
    from ctypes import wintypes

    class Overlapped(ctypes.Structure):
        # OVERLAPPED, field for field; zero, so the range starts at byte 0.
        _fields_ = (
            ("Internal", ctypes.c_void_p),
            ("InternalHigh", ctypes.c_void_p),
            ("Offset", wintypes.DWORD),
            ("OffsetHigh", wintypes.DWORD),
            ("hEvent", wintypes.HANDLE),
        )

    return Overlapped()


def _try_shared(handle: BinaryIO) -> bool:
    if sys.platform == "win32":
        import msvcrt

        try:
            if os.fstat(handle.fileno()).st_size == 0:
                handle.write(b"0")
                handle.flush()
        except OSError:
            return False
        fail_immediately = 0x1
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        osfhandle = msvcrt.get_osfhandle(handle.fileno())
        range_start = ctypes.byref(_overlapped())
        return bool(kernel32.LockFileEx(osfhandle, fail_immediately, 0, 1, 0, range_start))
    import fcntl

    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
    except OSError:
        return False
    return True


def _unlock_shared(handle: BinaryIO) -> None:
    if sys.platform == "win32":
        import msvcrt

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        osfhandle = msvcrt.get_osfhandle(handle.fileno())
        kernel32.UnlockFileEx(osfhandle, 0, 1, 0, ctypes.byref(_overlapped()))
        return
    store_lock.unlock(handle)


def held_exclusively(path: Path) -> bool:
    """Whether a handle holds the first byte of `path` exclusively, asked without locking.

    On Windows by reading that byte, which an exclusive lock refuses and a shared one
    allows; elsewhere by a shared flock taken and given back at once.
    """

    try:
        with path.open("rb") as handle:
            if sys.platform == "win32":
                try:
                    handle.read(1)
                except PermissionError:
                    return True
                return False
            import fcntl

            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
            except OSError:
                return True
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            return False
    except OSError:
        # Gone, or on its way out: no process holds it any more.
        return False


@contextmanager
def _deciding(path: Path) -> Iterator[None]:
    """The one decision of the machine at a time: the lock on `path` while this block runs."""

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        while not store_lock.try_lock(handle):
            time.sleep(0.05)
        try:
            yield
        finally:
            store_lock.unlock(handle)


class Entry(NamedTuple):
    """A heavy run going, or one waiting to go, as its file in `.runs` records it."""

    run: str
    checkout: str
    pid: int
    #: When it went in, or began to wait, in seconds since the epoch.
    since: float
    #: What it counts against the CPUs an earlier run's gate hands out.
    cpus: int
    #: Its place in an earlier version's queue, for a waiter.
    seq: int
    file: Path
    #: The gate's lease of a run of this tree; None for an earlier branch's run.
    lease: str | None = None

    def named(self) -> str:
        since = datetime.fromtimestamp(self.since).astimezone()
        ago = duration((datetime.now().astimezone() - since).total_seconds())
        return (
            f"{self.run} in {self.checkout}, process {self.pid},"
            f" since {since:%Y-%m-%d %H:%M:%S} ({ago} ago), with {_cpus(self.cpus)}"
        )


def _runs_directory(path: Path) -> Path:
    return path.with_name(f"{path.name}.runs")


def _read_entry(file: Path) -> Entry | None:
    try:
        with file.open("rb") as handle:
            handle.seek(1)
            record = json.loads(handle.read())
        lease = record.get("lease")
        return Entry(
            str(record["run"]),
            str(record["checkout"]),
            int(record["pid"]),
            float(record["since"]),
            int(record["cpus"]),
            int(record.get("seq", 0)),
            file,
            str(lease) if lease else None,
        )
    except (OSError, ValueError, KeyError, TypeError):
        return None


def entries(path: Path, *, reclaim: bool = False) -> tuple[list[Entry], list[Entry]]:
    """The runs going at the lock `path` and its waiters in their order.

    Only a file whose owner still holds it counts; with `reclaim`, which only a
    decision passes, the files of processes that have gone are deleted as well.
    """

    directory = _runs_directory(path)
    going: list[Entry] = []
    waiting: list[Entry] = []
    for file in sorted(directory.glob("*.json")) if directory.is_dir() else ():
        if not held_exclusively(file):
            if reclaim:
                # A reader may have it open for an instant; the next decision tries again.
                with contextlib.suppress(OSError):
                    file.unlink()
            continue
        entry = _read_entry(file)
        if entry is not None:
            (going if file.name.startswith("run-") else waiting).append(entry)
    waiting.sort(key=lambda entry: entry.seq)
    return going, waiting


def _place(directory: Path, prefix: str, record: Mapping[str, object]) -> tuple[BinaryIO, Path]:
    """A file of this process in `.runs`, held for as long as the handle this returns is open."""

    directory.mkdir(parents=True, exist_ok=True)
    file = directory / f"{prefix}-{os.getpid()}-{secrets.token_hex(4)}.json"
    handle = file.open("x+b")
    try:
        handle.write(b"0" + json.dumps(record).encode())
        handle.flush()
        if sys.platform != "win32":
            import fcntl

            # Waited for, not tried: a file made a moment ago under a name of its own is
            # held by nothing but a reader asking whether it is held, which `load_note`
            # does outside the decision by a shared lock it gives back at once.
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        elif not store_lock.try_lock(handle):
            raise OSError(f"could not hold {file}")
    except BaseException:
        handle.close()
        file.unlink(missing_ok=True)
        raise
    return handle, file


def _leave(handle: BinaryIO, file: Path) -> None:
    store_lock.unlock(handle)
    handle.close()
    with contextlib.suppress(OSError):
        file.unlink()


def _write_tail(handle: BinaryIO, going: Sequence[Entry]) -> None:
    """The record after the first byte, through a handle that holds that byte.

    Holding it, shared or exclusive, is what keeps an earlier version's holder,
    which writes its own record there, from holding it at the same time.
    """

    handle.truncate(1)
    if going:
        first = min(going, key=lambda entry: entry.since)
        run = (
            first.run
            if len(going) == 1
            else f"{len(going)} heavy runs sharing the machine, the earliest {first.run}"
        )
        since = datetime.fromtimestamp(first.since).astimezone()
        record = {
            "checkout": first.checkout,
            "pid": first.pid,
            "run": run,
            "since": since.isoformat(timespec="seconds"),
        }
        # Append mode writes at the end, so the record goes after the locked byte.
        handle.write(json.dumps(record).encode())
    handle.flush()


def earlier_runs(path: Path | None = None) -> list[str]:
    """The earlier branches' heavy runs going at the lock `path`, the machine's by default.

    Each as a waiter names it; a run of this tree is left out, since the gate names it.
    Asking takes no lock: an earlier version's holder is seen on Windows by a read of
    the locked byte, elsewhere by a shared lock given back at once.
    """

    path = path or lock_path()
    if not path.is_file():
        return []
    going, _waiting = entries(path)
    named = [entry.named() for entry in going if entry.lease is None]
    if not going and held_exclusively(path):
        named.append(holder(path))
    return named


def admission_line(waited: float, cpus: int, path: Path) -> str:
    """What a run says once it holds its place; `tests/run_record.py` reads the wait back."""

    return (
        f"took the earlier branches' heavy-test lock {path} after {duration(waited)}:"
        f" shared, counting {_cpus(cpus)}"
    )


@contextmanager
def shared(
    run: str,
    cpus: int,
    *,
    lease: str | None,
    path: Path | None = None,
    pid: int | None = None,
    wait: bool = True,
    say: Callable[[str], None] = _say,
    report_every: float = REPORT_SECONDS,
    abandoned: Callable[[], bool] | None = None,
) -> Iterator[None]:
    """Hold a place at the earlier branches' lock for `run`, counting `cpus`, while the block runs.

    `lease` is the gate's lease the run goes under, which marks its file as this
    tree's. A run whose environment marks this very lock as held by an ancestor holds
    nothing. While an earlier run holds the lock exclusively, the run waits, saying
    why at once and every `report_every` seconds, or with `wait` false raises `BusyError`
    with the reason and holds nothing. Before each try, a run that `abandoned` says is
    no longer wanted raises `AbandonedError` and holds nothing.
    """

    path = path or lock_path()
    if under_holder(path):
        yield
        return
    record = {
        "run": run,
        "checkout": ROOT.as_posix(),
        "pid": pid or os.getpid(),
        "cpus": cpus,
        **({"lease": lease} if lease else {}),
    }
    admission = path.with_name(f"{path.name}.admission")
    started = time.monotonic()
    next_report = started
    gate: BinaryIO | None = None
    place: tuple[BinaryIO, Path] | None = None
    try:
        while True:
            if abandoned is not None and abandoned():
                raise AbandonedError(f"{run} is no longer wanted")
            reason: str | None = None
            with _deciding(admission):
                if held_exclusively(path):
                    reason = f"it is held by {holder(path)}"
                else:
                    gate = path.open("a+b")
                    if _try_shared(gate):
                        going, _waiting = entries(path, reclaim=True)
                        place = _place(
                            _runs_directory(path), "run", {**record, "since": time.time()}
                        )
                        mine = _read_entry(place[1])
                        _write_tail(gate, [*going, *([mine] if mine else [])])
                    else:
                        # Taken exclusively since it was found free.
                        gate.close()
                        gate = None
                        reason = f"it is held by {holder(path)}"
            if reason is None:
                break
            if not wait:
                raise BusyError(f"the earlier branches' heavy-test lock {path}: {reason}")
            if time.monotonic() >= next_report:
                if next_report == started:
                    say(f"waiting for the earlier branches' heavy-test lock {path}: {reason}")
                else:
                    say(f"still waiting after {duration(time.monotonic() - started)}: {reason}")
                next_report += report_every
            time.sleep(min(POLL_SECONDS, report_every))
        say(admission_line(time.monotonic() - started, cpus, path))
        yield
    finally:
        if place is not None and gate is not None:
            with _deciding(admission):
                going, _waiting = entries(path, reclaim=True)
                _write_tail(gate, [entry for entry in going if entry.file != place[1]])
                _unlock_shared(gate)
                gate.close()
                _leave(*place)
        elif gate is not None:
            _unlock_shared(gate)
            gate.close()
