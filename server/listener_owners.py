"""Which processes listen on a TCP port on Windows, asked of Windows directly.

This is the evidence the launcher's ownership proof rests on, and that proof is
what allows a process to be stopped. It used to come from `powershell.exe`
running `Get-NetTCPConnection` and a CIM query per owner: about 1.5 seconds a
call, three calls between a tray click and a window. The same three facts per
owner are available from the system libraries the interpreter already loads,
so this reads them there, in milliseconds, with the standard library's ctypes
(the server imports nothing outside the standard library).

What it reports is unchanged. A listener is a socket on the port with no remote
end; its state is not read, because some Windows builds report a live
listener's state as something other than Listen. For each owning process it
reports the executable path, the command line and the creation time, and a
process it cannot read -- gone since the table was taken, or not readable by
this user -- is reported with those fields empty, which the launcher classifies
as unverifiable and therefore foreign. A blank is never filled in with a guess.
"""

from __future__ import annotations

import ctypes
import socket
import struct
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta

AF_INET = 2
AF_INET6 = 23
_TCP_TABLE_OWNER_PID_ALL = 5
_ERROR_INSUFFICIENT_BUFFER = 122
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_PROCESS_COMMAND_LINE_INFORMATION = 60
_STATUS_INFO_LENGTH_MISMATCH = 0xC0000004
_STATUS_BUFFER_TOO_SMALL = 0xC0000023
_FILETIME_EPOCH = datetime(1601, 1, 1, tzinfo=UTC)

# MIB_TCPTABLE_OWNER_PID / MIB_TCP6TABLE_OWNER_PID: a DWORD count, then rows.
# The IPv4 row is six DWORDs: state, local address, local port, remote
# address, remote port, owning pid. The IPv6 row is local address (16 bytes),
# local scope, local port, remote address (16 bytes), remote scope, remote
# port, state, owning pid. Ports are in network byte order in the low 16 bits.
_ROW_FORMATS = {
    AF_INET: (struct.Struct("<6I"), 2, 4, 5),
    AF_INET6: (struct.Struct("<16sII16sIIII"), 2, 5, 7),
}


class ListenerQueryError(OSError):
    """Windows could not say who listens on the port."""


def _port(value: int) -> int:
    return socket.ntohs(value & 0xFFFF)


def table_rows(raw: bytes, family: int) -> Iterator[tuple[int, int, int]]:
    """(local port, remote port, pid) for every row of one owner-pid TCP table."""
    row, local_index, remote_index, pid_index = _ROW_FORMATS[family]
    if len(raw) < 4:
        raise ListenerQueryError("Windows returned a truncated TCP table")
    (count,) = struct.unpack_from("<I", raw, 0)
    # Rows start at the first offset aligned for their widest member, a DWORD.
    if 4 + count * row.size > len(raw):
        raise ListenerQueryError("Windows returned a truncated TCP table")
    for index in range(count):
        fields = row.unpack_from(raw, 4 + index * row.size)
        yield _port(fields[local_index]), _port(fields[remote_index]), fields[pid_index]


def listener_pids(port: int, tables: Callable[[int], bytes]) -> list[int]:
    """Owners of every socket on `port` with no remote end, in table order."""
    owners: list[int] = []
    for family in (AF_INET, AF_INET6):
        for local, remote, pid in table_rows(tables(family), family):
            if local == port and remote == 0 and pid not in owners:
                owners.append(pid)
    return owners


def _filetime_token(value: int) -> str:
    """A creation time as an ISO-8601 instant with its full 100 ns resolution."""
    instant = _FILETIME_EPOCH + timedelta(microseconds=value // 10)
    return f"{instant:%Y-%m-%dT%H:%M:%S}.{value % 10_000_000:07d}Z"


class _Windows:
    """The four system calls, bound once with their exact signatures."""

    def __init__(self) -> None:
        from ctypes import wintypes

        self.wintypes = wintypes
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self.iphlpapi = ctypes.WinDLL("iphlpapi")
        self.ntdll = ctypes.WinDLL("ntdll")
        dword = wintypes.DWORD
        handle = wintypes.HANDLE
        self.iphlpapi.GetExtendedTcpTable.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(dword),
            wintypes.BOOL,
            wintypes.ULONG,
            ctypes.c_int,
            wintypes.ULONG,
        ]
        self.iphlpapi.GetExtendedTcpTable.restype = dword
        self.kernel32.OpenProcess.argtypes = [dword, wintypes.BOOL, dword]
        self.kernel32.OpenProcess.restype = handle
        self.kernel32.CloseHandle.argtypes = [handle]
        self.kernel32.CloseHandle.restype = wintypes.BOOL
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

    def tcp_table(self, family: int) -> bytes:
        size = self.wintypes.DWORD(0)
        for _ in range(8):  # the table can grow between the size query and the read
            buffer = ctypes.create_string_buffer(max(size.value, 4))
            size = self.wintypes.DWORD(len(buffer))
            result = self.iphlpapi.GetExtendedTcpTable(
                buffer, ctypes.byref(size), False, family, _TCP_TABLE_OWNER_PID_ALL, 0
            )
            if result == 0:
                return buffer.raw[: size.value]
            if result != _ERROR_INSUFFICIENT_BUFFER:
                raise ListenerQueryError(f"GetExtendedTcpTable failed with error {result}")
        raise ListenerQueryError("the TCP table kept growing while it was read")

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


def listener_processes(port: int) -> list[dict[str, object]]:
    """Every process with a socket on `port` and no remote end, as the launcher reads it."""
    try:
        windows = _Windows()
        return [windows.process(pid) for pid in listener_pids(port, windows.tcp_table)]
    except ListenerQueryError:
        raise
    except (AttributeError, OSError) as error:  # no such library or entry point
        raise ListenerQueryError(f"could not read the TCP table: {error}") from error
