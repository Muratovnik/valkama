"""Run a child process, then decode what it wrote — in that order.

`subprocess.run(..., text=True)` cannot honour clause 3 of the workspace
Unicode contract on Windows, which requires a decode failure to propagate. The
read happens in a reader thread, so a `UnicodeDecodeError` kills that thread
instead of reaching the caller: `communicate()` hands back the stream as `None`
and the exit code arrives intact, so nothing raises and nothing is noticed.
Decoding here, in the caller's own thread, is what makes the failure travel.

The codec is named rather than inherited for the same reason. `text=True`
follows the locale unless `PYTHONUTF8` is set, so one line of code decodes two
different ways depending on how the process was started — strict UTF-8 under
the gate, CP1251 under a plain shell on a Russian Windows.

`errors` is a parameter and not a constant because clause 4 allows a legacy or
lossy boundary when its owner declares it. Strict is the default; a caller that
relaxes it says which peer and why at the call site.
"""

from __future__ import annotations

import contextlib
import functools
import os
import signal
import subprocess
import sys
import threading
import time
from collections.abc import Iterator, Mapping
from typing import Any, NamedTuple

#: What every child of the server is started with. A listener started at login runs
#: under `pythonw.exe`, which has no console for a child to share, so Windows would open
#: one on the owner's screen for each `git` this module runs. Elsewhere it changes nothing.
NO_WINDOW: int = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class TextResult(NamedTuple):
    """A finished child process whose streams were decoded, not guessed.

    The three field names match `subprocess.CompletedProcess` so a call site
    reads the same after moving here. A named tuple rather than a dataclass:
    `dataclasses` costs the Git commit hook, which runs Git through here after
    every commit an agent makes, a tenth of its time.
    """

    returncode: int
    stdout: str
    stderr: str


def run_text(
    argv: list[str],
    *,
    encoding: str = "utf-8",
    errors: str = "strict",
    timeout: float | None = None,
    stdin: bytes | None = None,
) -> TextResult:
    """Capture both streams as bytes and decode them with a named codec.

    `stdin`, when given, is written to the child as bytes and then closed.
    """
    completed = subprocess.run(
        argv,
        input=stdin,
        capture_output=True,
        shell=False,
        check=False,
        timeout=timeout,
        creationflags=NO_WINDOW,
    )
    return TextResult(
        returncode=completed.returncode,
        stdout=completed.stdout.decode(encoding, errors),
        stderr=completed.stderr.decode(encoding, errors),
    )


def start_detached(
    argv: list[str],
    *,
    cwd: str | os.PathLike[str],
    env: Mapping[str, str] | None = None,
) -> int:
    """Start a process that outlives this one, with no window and no inherited pipes.

    A thread stays with the handle until the child ends, so a long-lived caller keeps
    no finished child behind and nothing here ever makes that caller wait.
    """

    process = subprocess.Popen(
        argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        shell=False,
        cwd=cwd,
        env=env,
        creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
    )
    threading.Thread(target=process.wait, daemon=True).start()
    return process.pid


_CREATE_SUSPENDED = 0x00000004
_PROCESS_TERMINATE = 0x0001
_PROCESS_SET_QUOTA = 0x0100
_PROCESS_SUSPEND_RESUME = 0x0800
_JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x00000800
_JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
_JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_SYNCHRONIZE = 0x00100000
_ERROR_INVALID_PARAMETER = 87
_SNAPSHOT_PROCESSES = 0x00000002


@functools.cache
def _kernel32() -> Any:
    """kernel32 with the signatures this module calls it by, bound once. Windows only."""

    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle, dword, boolean, pointer = (
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.BOOL,
        ctypes.c_void_p,
    )
    signatures: dict[str, tuple[tuple[Any, ...], Any]] = {
        "CreateJobObjectW": ((pointer, wintypes.LPCWSTR), handle),
        "SetInformationJobObject": ((handle, ctypes.c_int, pointer, dword), boolean),
        "AssignProcessToJobObject": ((handle, handle), boolean),
        "OpenProcess": ((dword, boolean, dword), handle),
        "TerminateProcess": ((handle, wintypes.UINT), boolean),
        "WaitForSingleObject": ((handle, dword), dword),
        "GetSystemTimeAsFileTime": ((pointer,), None),
        "GetProcessTimes": ((handle, pointer, pointer, pointer, pointer), boolean),
        "GetProcessId": ((handle,), dword),
        "CloseHandle": ((handle,), boolean),
        "CreateToolhelp32Snapshot": ((dword, dword), handle),
        "Process32FirstW": ((handle, pointer), boolean),
        "Process32NextW": ((handle, pointer), boolean),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(kernel32, name)
        function.argtypes, function.restype = arguments, result
    return kernel32


def _windows_error(call: str) -> OSError:
    import ctypes

    code = ctypes.get_last_error()
    return OSError(code, f"{call} failed: {ctypes.FormatError(code).strip()}")


def _system_time() -> int:
    """The system time in FILETIME units, those of a process's creation time. Windows only."""

    import ctypes

    now = ctypes.c_ulonglong()
    _kernel32().GetSystemTimeAsFileTime(ctypes.addressof(now))
    return int(now.value)


def process_table() -> dict[int, tuple[int, str]]:
    """Every process as `{pid: (parent pid, executable name)}`, from one Toolhelp snapshot.

    Windows only. A parent number outlives its process and may since name another.
    """

    import ctypes
    from ctypes import wintypes

    class ProcessEntry(ctypes.Structure):
        # PROCESSENTRY32W, field for field.
        _fields_ = (
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        )

    kernel32 = _kernel32()
    handle = kernel32.CreateToolhelp32Snapshot(_SNAPSHOT_PROCESSES, 0)
    if handle is None or handle == wintypes.HANDLE(-1).value:
        raise OSError(ctypes.get_last_error(), "process snapshot refused")
    table: dict[int, tuple[int, str]] = {}
    try:
        entry = ProcessEntry(dwSize=ctypes.sizeof(ProcessEntry))
        more = kernel32.Process32FirstW(handle, ctypes.addressof(entry))
        while more:
            table[int(entry.th32ProcessID)] = (int(entry.th32ParentProcessID), entry.szExeFile)
            more = kernel32.Process32NextW(handle, ctypes.addressof(entry))
    finally:
        kernel32.CloseHandle(handle)
    return table


class _Tree:
    """A process and what it started, each held by a handle taken before a stop. Windows only.

    A held process keeps its number, so what is waited on and ended here is what
    was seen, and never a process that took a number over. A process counts as a
    child only when it started after its parent: the parent number a process
    records outlives that parent, and may since name a newer process. What a
    member starts after the snapshot is not held; `taskkill /T` reads its own.
    """

    def __init__(self) -> None:
        self._kernel32 = _kernel32()
        self.pids: list[int] = []
        self._handles: list[int] = []
        #: A member that exists but would not open, or whose start cannot be read,
        #: so its end cannot be seen.
        self.unseen = False
        #: The root number names no process now, so it is never given to `taskkill`.
        self.absent = False

    @classmethod
    def seen(cls, pid: int) -> _Tree | None:
        """The tree under `pid` as it is now, or None when it cannot be read."""

        tree = cls()
        started = tree._hold(pid)
        if started is None:
            if tree.unseen:
                tree.close()
                return None
            tree.absent = True
            return tree
        if not started:
            # The root's start is unreadable, so no child can be told from a reused number.
            tree.unseen = True
            return tree
        try:
            # Read before the snapshot: a process the snapshot lists was created before
            # the snapshot ended, and `_hold` refuses one created at or after this time.
            cutoff = _system_time()
            table = process_table()
        except OSError:
            tree.close()
            return None
        children: dict[int, list[int]] = {}
        for child, (parent, _) in table.items():
            children.setdefault(parent, []).append(child)
        waiting = [(pid, started)]
        while waiting:
            parent, parent_started = waiting.pop()
            for child in children.get(parent, ()):
                if child in tree.pids:
                    continue
                child_started = tree._hold(child, after=parent_started, cutoff=cutoff)
                if child_started is not None:
                    waiting.append((child, child_started))
        return tree

    def _hold(self, pid: int, *, after: int = 0, cutoff: int | None = None) -> int | None:
        """Hold `pid` when it started at `after` or later and before `cutoff`.

        Returns its start, or None when not held. A number the snapshot listed names a process created before the snapshot ended,
        so a process created at or after `cutoff` took its number over since. Equal is
        refused too: a clock tick can give both the same time. A refusal costs a child
        that is not held, which `taskkill /T` has already had the chance to end.
        """

        import ctypes

        rights = _SYNCHRONIZE | _PROCESS_TERMINATE | _PROCESS_QUERY_LIMITED_INFORMATION
        handle = self._kernel32.OpenProcess(rights, False, pid)
        if not handle:
            # Gone is the one refusal that says the process has ended.
            self.unseen |= ctypes.get_last_error() != _ERROR_INVALID_PARAMETER
            return None
        times = (ctypes.c_ulonglong * 4)()
        address = ctypes.addressof(times)
        size = ctypes.sizeof(ctypes.c_ulonglong)
        started = 0
        if self._kernel32.GetProcessTimes(handle, *(address + size * n for n in range(4))):
            started = int(times[0])
        else:
            # Without a start the process cannot be told from a reused number.
            self.unseen = True
        # Windows ignores a number's two low bits when it opens one, so 4242 opens
        # process 4240: a number no process has is not taken for its neighbour's.
        too_late = cutoff is not None and started >= cutoff
        if self._kernel32.GetProcessId(handle) != pid or started < after or too_late:
            self._kernel32.CloseHandle(handle)
            return None
        self.pids.append(pid)
        self._handles.append(handle)
        return started

    def ended(self, seconds: float) -> bool:
        """Whether every held process ends within `seconds`, waited for together."""

        deadline = time.monotonic() + seconds
        for handle in self._handles:
            remaining = max(0, int((deadline - time.monotonic()) * 1000))
            if self._kernel32.WaitForSingleObject(handle, remaining) != 0:
                return False
        return True

    def end(self) -> None:
        """End every held process; one that has ended already is left as it is."""

        for handle in self._handles:
            if self._kernel32.WaitForSingleObject(handle, 0) != 0:
                self._kernel32.TerminateProcess(handle, 1)

    def close(self) -> None:
        for handle in self._handles:
            self._kernel32.CloseHandle(handle)
        self._handles = []


class _Job:
    """A Windows Job Object that kills what is in it when its one handle closes.

    The handle is not inheritable, so no child can keep the job open: it closes
    when `close` is called or when the system closes this process's handles,
    which it does however the process ends.
    """

    def __init__(self) -> None:
        import ctypes
        from ctypes import wintypes

        class BasicLimit(ctypes.Structure):
            # JOBOBJECT_BASIC_LIMIT_INFORMATION, field for field.
            _fields_ = (
                ("PerProcessUserTimeLimit", ctypes.c_longlong),
                ("PerJobUserTimeLimit", ctypes.c_longlong),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            )

        class ExtendedLimit(ctypes.Structure):
            # JOBOBJECT_EXTENDED_LIMIT_INFORMATION, with IO_COUNTERS as six counters.
            _fields_ = (
                ("BasicLimitInformation", BasicLimit),
                ("IoInfo", ctypes.c_ulonglong * 6),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            )

        self._kernel32 = kernel32 = _kernel32()
        self._ntdll = ctypes.WinDLL("ntdll")
        self._ntdll.NtResumeProcess.argtypes = (wintypes.HANDLE,)
        self._ntdll.NtResumeProcess.restype = ctypes.c_long
        self._handle = kernel32.CreateJobObjectW(None, None)
        if not self._handle:
            raise _windows_error("CreateJobObjectW")
        limits = ExtendedLimit(
            BasicLimitInformation=BasicLimit(
                LimitFlags=_JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | _JOB_OBJECT_LIMIT_BREAKAWAY_OK
            )
        )
        if not kernel32.SetInformationJobObject(
            self._handle,
            _JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
            ctypes.byref(limits),
            ctypes.sizeof(limits),
        ):
            error = _windows_error("SetInformationJobObject")
            self.close()
            raise error

    def take(self, pid: int) -> None:
        """Put a process started suspended into the job, then let it run.

        On a failure the process is ended, still suspended, before the error is
        raised: it has run nothing, so nothing it would start is left behind.
        """

        kernel32 = self._kernel32
        rights = _PROCESS_SET_QUOTA | _PROCESS_TERMINATE | _PROCESS_SUSPEND_RESUME
        process = kernel32.OpenProcess(rights, False, pid)
        if not process:
            raise _windows_error(f"OpenProcess({pid})")
        try:
            if not kernel32.AssignProcessToJobObject(self._handle, process):
                error = _windows_error(f"AssignProcessToJobObject({pid})")
                kernel32.TerminateProcess(process, 1)
                raise error
            status = self._ntdll.NtResumeProcess(process)
            if status != 0:
                kernel32.TerminateProcess(process, 1)
                raise OSError(status, f"NtResumeProcess({pid}) failed: 0x{status & 0xFFFFFFFF:08X}")
        finally:
            kernel32.CloseHandle(process)

    def close(self) -> None:
        """Close the handle, which ends every process still in the job."""

        if self._handle:
            self._kernel32.CloseHandle(self._handle)
            self._handle = None


@contextlib.contextmanager
def contained(argv: list[str], **options: Any) -> Iterator[subprocess.Popen[bytes]]:
    """Start `argv` as `subprocess.Popen` does, in a tree that ends with this block.

    Whatever the child started and left running is stopped when the block ends,
    and on Windows also when this process dies however it dies, killed from Task
    Manager or by its client included. A child that outlived its caller once kept
    writing into a result directory the next run in it read.

    Windows: the child runs in a Job Object that kills on close, whose only handle
    this process holds, and it starts suspended and runs only once it is in the
    job, so nothing it starts can leave before. A job in a job needs Windows 8. The
    job allows breakaway: without that a program that starts a child with
    `CREATE_BREAKAWAY_FROM_JOB` fails with access denied, and such a child is
    outside the job at its own request. POSIX: the child gets a session of its own
    and its process group is killed at the block's end; a caller killed with
    `SIGKILL` runs no code, so there the tree outlives it.
    """

    if sys.platform == "win32":
        job = _Job()
        started: subprocess.Popen[bytes] | None = None
        try:
            flags = int(options.pop("creationflags", 0)) | _CREATE_SUSPENDED
            started = subprocess.Popen(argv, creationflags=flags, **options)
            try:
                job.take(started.pid)
            except BaseException:
                # Still suspended and outside the job: nothing will end it but this.
                with contextlib.suppress(OSError):
                    started.kill()
                raise
            yield started
        finally:
            # Closed before the wait: the wait is for a tree the close ends.
            job.close()
            if started is not None:
                with contextlib.suppress(OSError, subprocess.SubprocessError):
                    started.wait(timeout=5)
        return
    process = subprocess.Popen(argv, start_new_session=True, **options)
    try:
        yield process
    finally:
        # The group outlives its leader while a member runs; its number is the leader's.
        # Once the leader is reaped (the block may have waited for it), that number can
        # be taken by a new process leading a group of its own, and this kill would reach
        # it. The window is the time from that reap to this line, and it is accepted: it
        # needs a reused number inside it, and closing it means holding the number past
        # the reap, which `Popen` does not do.
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(process.pid, signal.SIGKILL)
        with contextlib.suppress(OSError, subprocess.SubprocessError):
            process.wait(timeout=5)


def stop_process_tree(process: Any, *, wait_timeout: float = 2.0) -> bool:
    """Stop a child and everything it started; say whether the tree was seen to end.

    An agent client spawns its own children, so `terminate()` leaves them
    running with the pipe still open. Windows needs `taskkill /T`, POSIX needs
    the process group, and both fall back to terminating the child alone. On
    POSIX the group is the child's tree only when the child was started in one
    of its own (`start_new_session=True`); a child left in the caller's group
    is stopped alone, because killing that group kills the caller too.

    The answer is what is left, not what the tool said: `taskkill` fails when a
    member ends on its own while it walks the tree, as a venv launcher does once
    the interpreter it started is killed, so it failed now and then with the whole
    tree gone, and a caller took that for a live tree. On Windows the tree is held
    by handle before the kill, and True means each process held has ended within
    `wait_timeout`; what `taskkill` leaves running, after a timeout or a failure,
    this ends through those handles rather than leaving all but the child. On
    POSIX True means the group is empty. Where the tree cannot be seen, the child
    alone stopped is False, and so is a member that exists but cannot be opened.

    This lived in three places — the launch runner, the evaluation sandbox and
    the job supervisor — and the copies had already drifted apart: only two of
    them killed the POSIX process group, and only two bounded `taskkill` with a
    timeout. That is the cost of a copy, on the path that stops a runaway agent.

    `taskkill` output is captured as bytes and never decoded: it writes its
    diagnostics in the console OEM code page, which is not UTF-8 on a localized
    Windows, and only the exit code is read here.
    """
    pid = getattr(process, "pid", None)
    if sys.platform == "win32" and pid:
        tree = _Tree.seen(pid)
        said: int | None = None
        # A number that names no process now may be taken over by an unrelated one, and
        # `taskkill /PID` would end that one with its tree: it is not asked for that number.
        if tree is None or not tree.absent:
            with contextlib.suppress(OSError, subprocess.SubprocessError):
                said = subprocess.run(
                    ["taskkill", "/PID", str(pid), "/T", "/F"],
                    capture_output=True,
                    shell=False,
                    timeout=5,
                    check=False,
                    creationflags=NO_WINDOW,
                ).returncode
        if tree is not None:
            try:
                gone = tree.ended(wait_timeout)
                if not gone:
                    tree.end()
                    gone = tree.ended(wait_timeout)
                gone = gone and not tree.unseen
            finally:
                tree.close()
            with contextlib.suppress(OSError, subprocess.SubprocessError):
                process.wait(timeout=wait_timeout)
            return gone
        if said == 0:
            with contextlib.suppress(OSError, subprocess.TimeoutExpired):
                process.wait(timeout=wait_timeout)
            return True
    elif sys.platform != "win32" and pid:
        # Named rather than implied by the branch above: the process-group API
        # does not exist on Windows, and the platform check is what tells a
        # type checker this line is unreachable there.
        group: int | None = None
        with contextlib.suppress(OSError):
            group = os.getpgid(pid)
        if group is not None and group != os.getpgrp():
            with contextlib.suppress(OSError):
                os.killpg(group, signal.SIGKILL)
            with contextlib.suppress(OSError, subprocess.SubprocessError):
                process.wait(timeout=wait_timeout)
            return _group_ended(group, wait_timeout)
    try:
        process.terminate()
        process.wait(timeout=wait_timeout)
    except Exception:
        with contextlib.suppress(Exception):
            process.kill()
        with contextlib.suppress(Exception):
            process.wait(timeout=wait_timeout)
    return False


def _group_ended(group: int, seconds: float) -> bool:
    """Whether POSIX process group `group` has no member left within `seconds`."""

    if sys.platform == "win32":  # no process groups there; said for the type checker
        return False
    deadline = time.monotonic() + seconds
    while True:
        try:
            os.killpg(group, 0)  # signal 0 asks; it delivers nothing
        except ProcessLookupError:
            return True
        except OSError:
            pass  # a member this user may not signal still counts
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.02)


__all__ = [
    "TextResult",
    "contained",
    "process_table",
    "run_text",
    "start_detached",
    "stop_process_tree",
]
