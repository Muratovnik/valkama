"""What a running process is, asked of the system: its image, command line and start.

Three readers rest on it. The launcher's ownership proof reads the owner of a
listener -- its executable path, command line and creation time -- and that proof
is what allows a process to be stopped. The hook watcher reads the arguments of
the client that started it, to learn whether that client prints one turn and
exits. A heavy run waiting at `tests/heavy_gate.py` reads who started it, and when,
to leave once that process is gone. All read with the standard library's ctypes (the server imports nothing
outside the standard library), in milliseconds.

A process that cannot be read -- gone, or not readable by this user -- is reported
with its fields empty, or with no arguments at all. A blank is never filled in
with a guess.
"""

from __future__ import annotations

import ctypes
import os
from datetime import UTC, datetime, timedelta

_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_PROCESS_BASIC_INFORMATION = 0
_PROCESS_COMMAND_LINE_INFORMATION = 60
_STATUS_INFO_LENGTH_MISMATCH = 0xC0000004
_STATUS_BUFFER_TOO_SMALL = 0xC0000023
_FILETIME_EPOCH = datetime(1601, 1, 1, tzinfo=UTC)


def _filetime_token(value: int) -> str:
    """A creation time as an ISO-8601 instant with its full 100 ns resolution."""
    instant = _FILETIME_EPOCH + timedelta(microseconds=value // 10)
    return f"{instant:%Y-%m-%dT%H:%M:%S}.{value % 10_000_000:07d}Z"


class Windows:
    """The process calls of Windows, bound once with their exact signatures."""

    def __init__(self) -> None:
        from ctypes import wintypes

        self.wintypes = wintypes
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self.ntdll = ctypes.WinDLL("ntdll")
        self.shell32 = ctypes.WinDLL("shell32", use_last_error=True)
        dword = wintypes.DWORD
        handle = wintypes.HANDLE
        self.kernel32.OpenProcess.argtypes = [dword, wintypes.BOOL, dword]
        self.kernel32.OpenProcess.restype = handle
        self.kernel32.CloseHandle.argtypes = [handle]
        self.kernel32.CloseHandle.restype = wintypes.BOOL
        self.kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        self.kernel32.LocalFree.restype = ctypes.c_void_p
        self.kernel32.QueryFullProcessImageNameW.argtypes = [
            handle,
            dword,
            wintypes.LPWSTR,
            ctypes.POINTER(dword),
        ]
        self.kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
        self.kernel32.GetProcessTimes.argtypes = [handle, *[ctypes.POINTER(wintypes.FILETIME)] * 4]
        self.kernel32.GetProcessTimes.restype = wintypes.BOOL
        self.ntdll.NtQueryInformationProcess.argtypes = [
            handle,
            ctypes.c_int,
            ctypes.c_void_p,
            wintypes.ULONG,
            ctypes.POINTER(wintypes.ULONG),
        ]
        self.ntdll.NtQueryInformationProcess.restype = ctypes.c_ulong
        self.shell32.CommandLineToArgvW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
        self.shell32.CommandLineToArgvW.restype = ctypes.POINTER(wintypes.LPWSTR)

    def _image(self, process: int) -> str:
        buffer = ctypes.create_unicode_buffer(32768)
        size = self.wintypes.DWORD(len(buffer))
        if not self.kernel32.QueryFullProcessImageNameW(process, 0, buffer, ctypes.byref(size)):
            return ""
        return buffer.value

    def _command_line(self, process: int) -> str:
        needed = self.wintypes.ULONG(0)
        size = 4096
        for _ in range(4):
            buffer = ctypes.create_string_buffer(size)
            status = self.ntdll.NtQueryInformationProcess(
                process,
                _PROCESS_COMMAND_LINE_INFORMATION,
                buffer,
                size,
                ctypes.byref(needed),
            )
            if status in (_STATUS_INFO_LENGTH_MISMATCH, _STATUS_BUFFER_TOO_SMALL):
                size = max(needed.value, size * 2)
                continue
            if status != 0:
                return ""
            # A UNICODE_STRING: Length and MaximumLength (bytes), then a pointer
            # to the characters, which this call places inside the same buffer.
            length = ctypes.c_ushort.from_buffer(buffer).value
            address = ctypes.c_void_p.from_buffer(buffer, ctypes.sizeof(ctypes.c_void_p)).value
            if not length or not address:
                return ""
            return ctypes.wstring_at(address, length // 2)
        return ""

    def _created(self, process: int) -> str:
        times = [self.wintypes.FILETIME() for _ in range(4)]
        if not self.kernel32.GetProcessTimes(process, *[ctypes.byref(t) for t in times]):
            return ""
        created = times[0]
        return _filetime_token((created.dwHighDateTime << 32) | created.dwLowDateTime)

    def process(self, pid: int) -> dict[str, object]:
        row: dict[str, object] = {
            "pid": pid,
            "command_line": "",
            "executable_path": "",
            "identity_token": "",
        }
        process = self.kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not process:
            return row
        try:
            row["executable_path"] = self._image(process)
            row["command_line"] = self._command_line(process)
            row["identity_token"] = self._created(process)
        finally:
            self.kernel32.CloseHandle(process)
        return row

    def parent(self, pid: int) -> int | None:
        """The id of the process that started `pid`, or None when `pid` cannot be read.

        That process may have exited since, and its id passed to another one: a
        caller tells the two apart by the start times `process` reads.
        """
        wintypes = self.wintypes

        class BasicInformation(ctypes.Structure):
            # PROCESS_BASIC_INFORMATION, field for field.
            _fields_ = (
                ("ExitStatus", wintypes.LONG),
                ("PebBaseAddress", ctypes.c_void_p),
                ("AffinityMask", ctypes.c_size_t),
                ("BasePriority", wintypes.LONG),
                ("UniqueProcessId", ctypes.c_size_t),
                ("InheritedFromUniqueProcessId", ctypes.c_size_t),
            )

        process = self.kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not process:
            return None
        try:
            found = BasicInformation()
            status = self.ntdll.NtQueryInformationProcess(
                process,
                _PROCESS_BASIC_INFORMATION,
                ctypes.addressof(found),
                ctypes.sizeof(found),
                None,
            )
        finally:
            self.kernel32.CloseHandle(process)
        return int(found.InheritedFromUniqueProcessId) if status == 0 else None

    def split(self, command_line: str) -> list[str]:
        """The arguments a command line holds, split by Windows' own rule for them."""
        count = ctypes.c_int(0)
        words = self.shell32.CommandLineToArgvW(command_line, ctypes.byref(count))
        if not words:
            return []
        try:
            return [words[index] for index in range(count.value)]
        finally:
            self.kernel32.LocalFree(words)


def arguments(pid: int) -> list[str] | None:
    """The arguments process `pid` was started with, its program first; None when unread.

    Windows gives them as one command line, split here by Windows' own rule; Linux
    as `/proc/<pid>/cmdline`. Elsewhere, and for a process that cannot be read, the
    answer is None.
    """

    if os.name == "nt":
        try:
            windows = Windows()
            line = windows.process(pid)["command_line"]
            return windows.split(str(line)) if line else None
        except (AttributeError, OSError):  # no such library or entry point
            return None
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as source:
            raw = source.read()
    except OSError:
        return None
    if not raw:
        return None  # a zombie, or a kernel thread
    return [os.fsdecode(word) for word in raw.rstrip(b"\0").split(b"\0")]
