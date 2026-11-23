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
reports the executable path, the command line and the creation time, as
`process_reads` reads them, and a process it cannot read -- gone since the table was taken, or not readable by
this user -- is reported with those fields empty, which the launcher classifies
as unverifiable and therefore foreign. A blank is never filled in with a guess.
"""

from __future__ import annotations

import ctypes
import socket
import struct
from collections.abc import Callable, Iterator

from . import process_reads

AF_INET = 2
AF_INET6 = 23
_TCP_TABLE_OWNER_PID_ALL = 5
_ERROR_INSUFFICIENT_BUFFER = 122

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


class _Windows:
    """The TCP table call, bound once with its exact signature."""

    def __init__(self) -> None:
        from ctypes import wintypes

        self.wintypes = wintypes
        self.iphlpapi = ctypes.WinDLL("iphlpapi")
        dword = wintypes.DWORD
        self.iphlpapi.GetExtendedTcpTable.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(dword),
            wintypes.BOOL,
            wintypes.ULONG,
            ctypes.c_int,
            wintypes.ULONG,
        ]
        self.iphlpapi.GetExtendedTcpTable.restype = dword

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


def listener_processes(port: int) -> list[dict[str, object]]:
    """Every process with a socket on `port` and no remote end, as the launcher reads it."""
    try:
        windows = _Windows()
        processes = process_reads.Windows()
        return [processes.process(pid) for pid in listener_pids(port, windows.tcp_table)]
    except ListenerQueryError:
        raise
    except (AttributeError, OSError) as error:  # no such library or entry point
        raise ListenerQueryError(f"could not read the TCP table: {error}") from error
