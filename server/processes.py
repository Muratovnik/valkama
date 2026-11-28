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
import os
import signal
import subprocess
import sys
import threading
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

        self._ctypes = ctypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self._ntdll = ctypes.WinDLL("ntdll")
        handle, dword, boolean = wintypes.HANDLE, wintypes.DWORD, wintypes.BOOL
        kernel32.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
        kernel32.CreateJobObjectW.restype = handle
        kernel32.SetInformationJobObject.argtypes = (handle, ctypes.c_int, ctypes.c_void_p, dword)
        kernel32.SetInformationJobObject.restype = boolean
        kernel32.AssignProcessToJobObject.argtypes = (handle, handle)
        kernel32.AssignProcessToJobObject.restype = boolean
        kernel32.OpenProcess.argtypes = (dword, boolean, dword)
        kernel32.OpenProcess.restype = handle
        kernel32.TerminateProcess.argtypes = (handle, wintypes.UINT)
        kernel32.TerminateProcess.restype = boolean
        kernel32.CloseHandle.argtypes = (handle,)
        kernel32.CloseHandle.restype = boolean
        self._ntdll.NtResumeProcess.argtypes = (handle,)
        self._ntdll.NtResumeProcess.restype = ctypes.c_long
        self._kernel32 = kernel32
        self._handle = kernel32.CreateJobObjectW(None, None)
        if not self._handle:
            raise self._error("CreateJobObjectW")
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
            error = self._error("SetInformationJobObject")
            self.close()
            raise error

    def _error(self, call: str) -> OSError:
        code = self._ctypes.get_last_error()
        return OSError(code, f"{call} failed: {self._ctypes.FormatError(code).strip()}")

    def take(self, pid: int) -> None:
        """Put a process started suspended into the job, then let it run.

        On a failure the process is ended, still suspended, before the error is
        raised: it has run nothing, so nothing it would start is left behind.
        """

        kernel32 = self._kernel32
        rights = _PROCESS_SET_QUOTA | _PROCESS_TERMINATE | _PROCESS_SUSPEND_RESUME
        process = kernel32.OpenProcess(rights, False, pid)
        if not process:
            raise self._error(f"OpenProcess({pid})")
        try:
            if not kernel32.AssignProcessToJobObject(self._handle, process):
                error = self._error(f"AssignProcessToJobObject({pid})")
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
            job.take(started.pid)
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
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(process.pid, signal.SIGKILL)
        with contextlib.suppress(OSError, subprocess.SubprocessError):
            process.wait(timeout=5)


def stop_process_tree(process: Any, *, wait_timeout: float = 2.0) -> bool:
    """Stop a child and everything it started; report whether the tree went.

    An agent client spawns its own children, so `terminate()` leaves them
    running with the pipe still open. Windows needs `taskkill /T`, POSIX needs
    the process group, and both fall back to terminating the child alone. On
    POSIX the group is the child's tree only when the child was started in one
    of its own (`start_new_session=True`); a child left in the caller's group
    is stopped alone, because killing that group kills the caller too.

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
        with contextlib.suppress(OSError, subprocess.SubprocessError):
            killed = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                shell=False,
                timeout=5,
                check=False,
                creationflags=NO_WINDOW,
            )
            if killed.returncode == 0:
                with contextlib.suppress(OSError, subprocess.TimeoutExpired):
                    process.wait(timeout=wait_timeout)
                return True
    elif sys.platform != "win32" and pid:
        # Named rather than implied by the branch above: the process-group API
        # does not exist on Windows, and the platform check is what tells a
        # type checker this line is unreachable there.
        with contextlib.suppress(OSError, subprocess.SubprocessError):
            group = os.getpgid(pid)
            if group != os.getpgrp():
                os.killpg(group, signal.SIGKILL)
                process.wait(timeout=wait_timeout)
                return True
    try:
        process.terminate()
        process.wait(timeout=wait_timeout)
    except Exception:
        with contextlib.suppress(Exception):
            process.kill()
        with contextlib.suppress(Exception):
            process.wait(timeout=wait_timeout)
    return False


__all__ = ["TextResult", "contained", "run_text", "start_detached", "stop_process_tree"]
