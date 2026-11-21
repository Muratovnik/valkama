"""The gate the heavy test runs of every Valkama checkout on this machine go through.

    python tests/machine_lock.py run --run WHAT [--cpus N] [--pid PID] [--path FILE] -- COMMAND ...
    python tests/machine_lock.py holder [--path FILE]

A development tool beside the tests, as `tests/isolated.py` is. Heavy runs that
together want more CPUs than the machine has — the whole unittest suite under
coverage, the Vitest suite, the whole browser suite — fail timing-sensitive tests
that pass alone, so each declares the logical CPUs it needs and goes in only when
both hold:

- the needs of the heavy runs going plus its own fit the CPUs the gate hands out,
  the machine's logical CPUs unless `CPUS_VARIABLE` names another count; and
- the CPUs free now, measured system-wide over `MEASURE_SECONDS` and less the
  needs of runs that went in within `RAMP_SECONDS`, are at least its need, a need
  above `ROOM_FRACTION` of the machine held to that fraction. This is what sees
  load that never declares itself here: targeted runs, builds, an antivirus.

The second rule only delays a run. One that it alone keeps out — the first rule
holds, no waiter is ahead of it and no earlier version's run holds the lock —
waits for that room `ROOM_WAIT_SECONDS` at most, counted from the first round
that refused it for that alone, then goes in without it and says so, and the run
record carries that: before the gate a run started once the lock was free,
whatever the load, and load nothing here declares must not hold the head of the
queue for ever. A wait for the first rule or for an earlier version's run starts
no such count.

A run that declares nothing asks for every CPU the gate hands out, so it goes
alone and nothing joins it; the browser suite does, because it takes whatever
the machine has. Where the load cannot be measured only the first rule decides.
At a count of 1 every run asks for the whole machine and the load is not read:
one heavy run at a time, which is what this tool did before and the rollback.

One run decides at a time, and waiters go in the order they came: a later run
waits behind an earlier waiter even where it would fit, so a run that needs the
whole machine is not passed for ever by smaller ones. An earlier version's waiter
is outside that order, so runs sharing the machine can pass it again and again;
that lasts until no branch uses the earlier version any more. A waiter says why it waits
when it starts and every minute; the run says on going in how long it waited,
how busy the machine was and which runs it goes beside.

The commands go through it themselves: the `tests` package's `load_tests` for a
run of the whole suite, and `web/tests/unitRun.ts` and
`web/tests/browser/allowedRun.ts` through the command above, so there is one
implementation and one protocol. A targeted run goes through none, and when it
fails it names the heavy runs going as it ends, the `tests` package for unittest
and `holder` for Vitest, so the failure reads as load.

A run started by a holder is covered by its hold: whatever holds a place marks
the environment of what it starts with `HELD_BY_ANCESTOR`, and a run that finds
the lock it wants marked there goes in without waiting, because waiting would be
waiting for itself. `tests/isolated.py gates` holds a place in-process for its
`unittest` step and marks that step's environment.

The lock file is in the system's temporary directory, whatever TEMP or profile a
run was given: outside every checkout and worktree, so all of them meet at it,
and outside `~/.valkama` and the installed product. Beside it:

- The file itself: the operating system's lock on its first byte is the one an
  earlier version of this tool took exclusively for every run, through
  `server.store_lock`, and a long-lived branch still does. A run that needs the
  whole machine takes it the same way; any other holds it shared, so either
  version's runs keep out the other's. After that byte is what an earlier
  version's waiter reads: the run holding the machine, or how many share it.
- `<file>.admission`: its first byte is locked for each decision.
- `<file>.runs/`: one file for each run going and each waiter, its first byte
  locked by its own process for as long as it runs or waits, its record after it.

Every lock is the operating system's, so it goes with its process however that
ends. A file in `.runs` whose byte nobody holds is a process that has gone: no
rule counts it and the next decision deletes it. The record after the first byte
is rewritten by the next run that goes in or ends. Nothing waits for a timeout,
and nothing needs removing by hand.
"""

from __future__ import annotations

import argparse
import atexit
import contextlib
import ctypes
import getpass
import json
import os
import secrets
import subprocess
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

#: How often a waiter says again why it waits.
REPORT_SECONDS = 60.0
POLL_SECONDS = 0.25
#: Set in the environment of what a holder starts, to the lock file it holds.
HELD_BY_ANCESTOR = "VALKAMA_HEAVY_TEST_LOCK_HELD"
#: How many CPUs the gate hands out; the machine's logical CPUs when unset, and 1
#: for one heavy run at a time.
CPUS_VARIABLE = "VALKAMA_HEAVY_TEST_CPUS"
#: The window the machine's load is measured over. On a 32-CPU machine the busy
#: fraction of 3-second windows varied by 0.05 (about 1.6 CPUs) from one to the
#: next, against 0.07 for 1-second ones: steady beside needs of 2 and 8 CPUs, and a
#: waiter measures again on its next round.
MEASURE_SECONDS = 3.0
#: The share of the machine the measured room is held to, so that a run that needs
#: the whole machine can start where only light background work goes on.
ROOM_FRACTION = 0.7
#: How long a run that went in counts against the measured room by its need: it
#: has not loaded the machine yet when it starts, so the load does not show it.
RAMP_SECONDS = 60.0
#: How long a run nothing here keeps out waits for the measured room, from the first
#: round that refused it for that alone; then it goes in without it and says so.
#: Before the gate a run started once the lock was free, whatever the machine's load.
ROOM_WAIT_SECONDS = 180.0


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
            f" ({_duration((datetime.now().astimezone() - since).total_seconds())} ago)"
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


def _unlock(handle: BinaryIO, *, shared: bool) -> None:
    if shared and sys.platform == "win32":
        import msvcrt

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        osfhandle = msvcrt.get_osfhandle(handle.fileno())
        kernel32.UnlockFileEx(osfhandle, 0, 1, 0, ctypes.byref(_overlapped()))
        return
    store_lock.unlock(handle)


def _try_lock(handle: BinaryIO, *, shared: bool) -> bool:
    return _try_shared(handle) if shared else store_lock.try_lock(handle)


def _held_exclusively(path: Path) -> bool:
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
    #: What it counts against the CPUs the gate hands out.
    cpus: int
    #: Its place in the queue, for a waiter.
    seq: int
    file: Path

    def named(self) -> str:
        since = datetime.fromtimestamp(self.since).astimezone()
        ago = _duration((datetime.now().astimezone() - since).total_seconds())
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
        return Entry(
            str(record["run"]),
            str(record["checkout"]),
            int(record["pid"]),
            float(record["since"]),
            int(record["cpus"]),
            int(record.get("seq", 0)),
            file,
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
        if not _held_exclusively(file):
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
        if not store_lock.try_lock(handle):
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


def busy_fraction(seconds: float = MEASURE_SECONDS) -> float | None:
    """How busy the machine's CPUs were over the last `seconds`, from 0 to 1, or None.

    `GetSystemTimes` on Windows and `/proc/stat` on Linux, read twice; elsewhere the
    one-minute load average over the CPU count. None where none of them answers.
    """

    def ticks() -> tuple[int, int]:
        """Idle and total time of every CPU so far."""

        if sys.platform == "win32":
            from ctypes import wintypes

            idle, kernel, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            if not kernel32.GetSystemTimes(
                ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)
            ):
                raise OSError(ctypes.get_last_error(), "GetSystemTimes refused")
            idle_time, kernel_time, user_time = (
                (stamp.dwHighDateTime << 32) | stamp.dwLowDateTime for stamp in (idle, kernel, user)
            )
            # Kernel time includes the idle time.
            return idle_time, kernel_time + user_time
        # user nice system idle iowait irq softirq steal
        fields = [
            int(field) for field in Path("/proc/stat").read_text().split("\n")[0].split()[1:9]
        ]
        return fields[3] + fields[4], sum(fields)

    try:
        if sys.platform != "win32" and not Path("/proc/stat").is_file():
            return min(1.0, os.getloadavg()[0] / (os.cpu_count() or 1))
        idle_before, total_before = ticks()
        time.sleep(seconds)
        idle_after, total_after = ticks()
    except (OSError, ValueError, IndexError, AttributeError):
        return None
    total = total_after - total_before
    if total <= 0:
        return None
    return min(1.0, max(0.0, 1 - (idle_after - idle_before) / total))


def handed_out(cpus: int, environment: Mapping[str, str] = os.environ) -> int:
    """How many CPUs the gate hands out on a machine of `cpus`: `CPUS_VARIABLE`, or all of them."""

    value = environment.get(CPUS_VARIABLE, "").strip()
    if not value:
        return cpus
    if not value.isdigit() or int(value) < 1:
        raise ValueError(f"{CPUS_VARIABLE} is a whole number of CPUs from 1, not {value!r}")
    return int(value)


def need_of(declared: int | None, capacity: int) -> int:
    """What a run that declared `declared` CPUs counts: all `capacity` when it declared none."""

    return max(1, min(capacity, capacity if declared is None else declared))


def arithmetic_refusal(need: int, going: Sequence[Entry], capacity: int) -> str | None:
    """Why `need` does not fit beside the runs `going`, or None when it does."""

    held = sum(entry.cpus for entry in going)
    if held + need <= capacity:
        return None
    return (
        f"it is held by {'; '.join(entry.named() for entry in going)}:"
        f" {held} of {_cpus(capacity)} the gate hands out, and this run needs {need}"
    )


def _room(
    need: int, going: Sequence[Entry], cpus: int, busy: float, now: float
) -> tuple[float, float, int]:
    """The CPUs free for `need`, the room it asks for, and the needs of runs still starting."""

    ramping = sum(entry.cpus for entry in going if now - entry.since < RAMP_SECONDS)
    return cpus * (1 - busy) - ramping, min(float(need), ROOM_FRACTION * cpus), ramping


def room_refusal(
    need: int, going: Sequence[Entry], cpus: int, busy: float | None, now: float
) -> str | None:
    """Why the machine has no room for `need` now, or None when it has or its load is unknown."""

    if busy is None:
        return None
    free, wanted, ramping = _room(need, going, cpus, busy, now)
    if free >= wanted:
        return None
    starting = f", less {_cpus(ramping)} of runs still starting" if ramping else ""
    return (
        f"{max(0.0, free):.1f} of {_cpus(cpus)} are free (the machine {busy:.0%} busy{starting}),"
        f" and this run needs {wanted:g}"
    )


def queue_refusal(ahead: Sequence[Entry]) -> str | None:
    """Why a run waits behind the waiters `ahead` of it, or None when there are none."""

    if not ahead:
        return None
    waiters = "1 earlier waiter" if len(ahead) == 1 else f"{len(ahead)} earlier waiters"
    return f"it is behind {waiters}, the first {ahead[0].named()}"


def admission_line(
    waited: float,
    need: int,
    capacity: int,
    busy: float | None,
    beside: Sequence[Entry],
    without_room: tuple[float, float] | None = None,
) -> str:
    """What a run says as it goes in; `tests/run_record.py` reads its facts back.

    `without_room` is the CPUs that were free and the room the run asked for, when
    it went in after waiting `ROOM_WAIT_SECONDS` for that room.
    """

    short = (
        ""
        if without_room is None
        else f" without the room it asked for, {max(0.0, without_room[0]):.1f} CPUs"
        f" free where it needs {without_room[1]:g}"
    )
    load = "the load not measured" if busy is None else f"the machine {busy:.0%} busy"
    runs = (
        "alone"
        if not beside
        else f"beside {len(beside)} run{'s' if len(beside) > 1 else ''}:"
        f" {'; '.join(entry.named() for entry in beside)}"
    )
    return (
        f"took the heavy-test lock after {_duration(waited)}{short}:"
        f" {need} of {_cpus(capacity)}, {load}, {runs}"
    )


def load_note(path: Path | None = None) -> str | None:
    """What a failed run that took no place says: the heavy runs going now, or None.

    None too when this process runs under a holder, since its load is then the run's
    own. Asking takes no lock: an earlier version's holder is seen on Windows by a
    read of the locked byte, elsewhere by a shared lock given back at once.
    """

    path = path or lock_path()
    if os.environ.get(HELD_BY_ANCESTOR) == marker(path)[HELD_BY_ANCESTOR] or not path.is_file():
        return None
    going, _waiting = entries(path)
    if going:
        named = "; ".join(entry.named() for entry in going)
    elif _held_exclusively(path):
        named = holder(path)
    else:
        return None
    return (
        f"the heavy-test lock {path} was held as this run ended, by {named}:"
        " a failure here may come from that load rather than from a defect"
    )


@contextmanager
def held(
    run: str,
    *,
    path: Path | None = None,
    pid: int | None = None,
    cpus: int | None = None,
    say: Callable[[str], None] = _say,
    report_every: float = REPORT_SECONDS,
    measure: Callable[[], float | None] = busy_fraction,
    clock: Callable[[], float] = time.time,
    machine_cpus: int | None = None,
) -> Iterator[None]:
    """Hold a place at the gate for `run`, needing `cpus`, and wait as long as it takes.

    `pid` is the process the run belongs to, which is this one unless a caller
    started this process to hold the place for it. `cpus` declared as None asks for
    the whole machine. A run whose environment marks this very lock as held by an
    ancestor holds nothing and goes in at once. `measure`, `clock` and
    `machine_cpus` stand in for the machine's load, time and CPU count in a test.
    """

    path = path or lock_path()
    if os.environ.get(HELD_BY_ANCESTOR) == marker(path)[HELD_BY_ANCESTOR]:
        yield
        return
    machine = machine_cpus or os.cpu_count() or 1
    capacity = handed_out(machine)
    need = need_of(cpus, capacity)
    shared = need < capacity
    directory = _runs_directory(path)
    own = {"run": run, "checkout": ROOT.as_posix(), "pid": pid or os.getpid(), "cpus": need}
    started = time.monotonic()
    next_report = started
    ticket: tuple[BinaryIO, Path] | None = None
    ticket_seq = 0
    place: tuple[BinaryIO, Path] | None = None
    gate: BinaryIO | None = None
    # When the measured room alone first kept this run out: nothing a run here declared.
    room_since: float | None = None
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        while place is None:
            with _deciding(path.with_name(f"{path.name}.admission")):
                now = clock()
                going, waiting = entries(path, reclaim=True)
                ahead = [entry for entry in waiting if ticket is None or entry.seq < ticket_seq]
                busy: float | None = None
                without_room: tuple[float, float] | None = None
                reason = queue_refusal(ahead) or arithmetic_refusal(need, going, capacity)
                # Asked before the load is measured, and the lock taken after: a run that is
                # only measuring holds nothing an earlier version's run would wait for.
                if reason is None and _held_exclusively(path):
                    # Nothing here holds it, so a run of an earlier version does.
                    reason = f"it is held by {holder(path)}"
                if reason is None:
                    busy = measure() if capacity > 1 else None
                    measured = clock()
                    reason = room_refusal(need, going, machine, busy, measured)
                    if reason is not None and busy is not None:
                        room_since = measured if room_since is None else room_since
                        if measured - room_since >= ROOM_WAIT_SECONDS:
                            free, wanted, _ramping = _room(need, going, machine, busy, measured)
                            without_room = (free, wanted)
                            reason = None
                if reason is None:
                    gate = path.open("a+b")
                    if not _try_lock(gate, shared=shared):
                        # Taken by an earlier version's run while the load was measured.
                        gate.close()
                        gate = None
                        reason = f"it is held by {holder(path)}"
                if reason is None and gate is not None:
                    place = _place(directory, "run", {**own, "since": clock()})
                    mine = _read_entry(place[1])
                    _write_tail(gate, [*going, *([mine] if mine else [])])
                    if ticket is not None:
                        _leave(*ticket)
                        ticket = None
                    waited = time.monotonic() - started
                    say(admission_line(waited, need, capacity, busy, going, without_room))
                    break
                if ticket is None:
                    ticket_seq = max((entry.seq for entry in waiting), default=0) + 1
                    record = {**own, "since": now, "seq": ticket_seq}
                    ticket = _place(directory, f"wait-{ticket_seq:09d}", record)
            if time.monotonic() >= next_report:
                if next_report == started:
                    say(f"waiting for the heavy-test lock {path}: {reason}")
                else:
                    say(f"still waiting after {_duration(time.monotonic() - started)}: {reason}")
                next_report += report_every
            time.sleep(min(POLL_SECONDS, report_every))
        yield
    finally:
        if ticket is not None:
            _leave(*ticket)
        if place is not None and gate is not None:
            with _deciding(path.with_name(f"{path.name}.admission")):
                going, _waiting = entries(path, reclaim=True)
                _write_tail(gate, [entry for entry in going if entry.file != place[1]])
                _unlock(gate, shared=shared)
                gate.close()
                _leave(*place)
        elif gate is not None:
            # Taken, but the run never recorded itself.
            _unlock(gate, shared=shared)
            gate.close()


def hold_until_exit(
    run: str,
    *,
    path: Path | None = None,
    cpus: int | None = None,
    say: Callable[[str], None] = _say,
) -> None:
    """Hold a place from now until this process ends, and mark this process's environment.

    For a run whose end no caller brackets, such as a test suite that is loaded here
    and run later. The mark covers every process the run starts, and a second call
    in the same process, which finds it.
    """

    hold = contextlib.ExitStack()
    hold.enter_context(held(run, path=path, cpus=cpus, say=say))
    atexit.register(hold.close)
    os.environ.update(marker(path))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run a command holding a place at the heavy-test gate."
    )
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="wait for a place, run COMMAND, give the place back")
    run.add_argument("--run", required=True, help="what the run is, as a waiter will read it")
    run.add_argument(
        "--cpus",
        type=int,
        help="the logical CPUs the run needs; by default all of them, so it goes alone",
    )
    run.add_argument("--pid", type=int, help="the process the run belongs to; by default this one")
    run.add_argument("--path", type=Path, help="another lock file than the machine's")
    run.add_argument("argv", nargs=argparse.REMAINDER, metavar="-- COMMAND ...")
    asked = commands.add_parser(
        "holder", help="say which heavy runs are going, for a failed run; or nothing"
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
    if options.cpus is not None and options.cpus < 1:
        parser.error("--cpus is a whole number from 1")
    with held(options.run, path=options.path, pid=options.pid, cpus=options.cpus):
        environment = {**os.environ, **marker(options.path)}
        try:
            return subprocess.run(command, env=environment, check=False).returncode
        except OSError as error:
            _say(f"could not start {command[0]}: {error}")
            return 127


if __name__ == "__main__":
    sys.exit(main())
