"""Who listens on a port, read from Windows' own tables.

The parsing is checked on synthetic tables on every platform, because a wrong
offset or byte order would still return a list -- of the wrong processes. The
live half runs on Windows against sockets and processes this test owns: the
owner of a real listener is this process or the child it started, with the
same executable, command line and creation time a stop would re-verify.
"""

from __future__ import annotations

import os
import socket
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from server import listener_owners

LISTEN, ESTABLISHED, NO_STATE = 2, 5, 0
# The image Windows runs for this interpreter. A virtual environment's
# python.exe on Windows is a redirector that starts the base interpreter as a
# child, so the listening process is that child and its image is the base one.
INTERPRETER = getattr(sys, "_base_executable", sys.executable)


def net_port(port: int) -> int:
    return socket.htons(port)


def table_v4(*rows: tuple[int, int, int, int]) -> bytes:
    """(state, local port, remote port, pid) rows as MIB_TCPTABLE_OWNER_PID bytes."""
    body = b"".join(
        struct.pack("<6I", state, 0x0100007F, net_port(local), 0, net_port(remote), pid)
        for state, local, remote, pid in rows
    )
    return struct.pack("<I", len(rows)) + body


def table_v6(*rows: tuple[int, int, int, int]) -> bytes:
    body = b"".join(
        struct.pack(
            "<16sII16sIIII",
            b"\0" * 15 + b"\1",
            0,
            net_port(local),
            b"\0" * 16,
            0,
            net_port(remote),
            state,
            pid,
        )
        for state, local, remote, pid in rows
    )
    return struct.pack("<I", len(rows)) + body


class TableTests(unittest.TestCase):
    def test_a_listener_is_a_socket_on_the_port_with_no_remote_end_whatever_its_state(
        self,
    ) -> None:
        tables = {
            listener_owners.AF_INET: table_v4(
                (NO_STATE, 8642, 0, 100),  # a live listener this Windows build gives no state
                (ESTABLISHED, 8642, 51000, 200),  # a client connection to it
                (LISTEN, 8643, 0, 300),  # another port
                (ESTABLISHED, 51001, 8642, 400),  # an outgoing connection to 8642
            ),
            listener_owners.AF_INET6: table_v6(
                (LISTEN, 8642, 0, 100),  # the same process on ::1 counts once
                (LISTEN, 8642, 0, 500),
            ),
        }
        self.assertEqual([100, 500], listener_owners.listener_pids(8642, tables.__getitem__))

    def test_ports_are_read_in_network_byte_order(self) -> None:
        # 8642 is 0x21C2; read in host order it would be 0xC221, port 49697.
        rows = list(listener_owners.table_rows(table_v4((LISTEN, 8642, 0, 7)), 2))
        self.assertEqual([(8642, 0, 7)], rows)
        rows = list(listener_owners.table_rows(table_v6((LISTEN, 49697, 0, 9)), 23))
        self.assertEqual([(49697, 0, 9)], rows)

    def test_a_truncated_table_is_refused_rather_than_read_short(self) -> None:
        whole = table_v4((LISTEN, 8642, 0, 7), (LISTEN, 8642, 0, 8))
        for raw in (b"", b"\x01\x00", whole[:-4]):
            with self.subTest(size=len(raw)), self.assertRaises(listener_owners.ListenerQueryError):
                list(listener_owners.table_rows(raw, listener_owners.AF_INET))

    def test_a_creation_time_keeps_its_full_resolution(self) -> None:
        self.assertEqual("1601-01-01T00:00:00.0000000Z", listener_owners._filetime_token(0))
        # 2026-11-01T08:27:04.1234567Z, in 100 ns intervals since 1601.
        value = 134_379_952_241_234_567
        self.assertEqual("2026-11-01T08:27:04.1234567Z", listener_owners._filetime_token(value))
        self.assertNotEqual(
            listener_owners._filetime_token(value), listener_owners._filetime_token(value + 1)
        )


@unittest.skipUnless(os.name == "nt", "the owner tables are Windows'")
class LiveTests(unittest.TestCase):
    def test_this_process_owns_its_ipv4_and_ipv6_listeners(self) -> None:
        for family, address in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
            with self.subTest(family=family.name), socket.socket(family) as listener:
                listener.bind((address, 0))
                listener.listen()
                port = listener.getsockname()[1]
                first = listener_owners.listener_processes(port)
                second = listener_owners.listener_processes(port)
                self.assertEqual([os.getpid()], [row["pid"] for row in first])
                [row] = first
                self.assertEqual(
                    os.path.normcase(INTERPRETER), os.path.normcase(str(row["executable_path"]))
                )
                self.assertIn("python", str(row["command_line"]).lower())
                self.assertTrue(row["identity_token"])
                self.assertEqual(first, second, "the same process must read the same both times")

    def test_a_child_listener_is_read_with_its_exact_unicode_command_line(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            script = Path(temporary) / "Слушатель порта.py"
            script.write_text(
                "import socket, sys\n"
                "s = socket.socket()\n"
                "s.bind(('127.0.0.1', 0))\n"
                "s.listen()\n"
                "print(s.getsockname()[1], flush=True)\n"
                "sys.stdin.read()\n",
                encoding="utf-8",
            )
            command = [INTERPRETER, str(script), "--port", "тест"]
            child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
            try:
                assert child.stdout is not None
                port = int(child.stdout.readline())
                [row] = listener_owners.listener_processes(port)
            finally:
                assert child.stdin is not None
                child.stdin.close()
                child.wait(timeout=30)
            self.assertEqual(child.pid, row["pid"])
            self.assertEqual(subprocess.list2cmdline(command), row["command_line"])
            self.assertTrue(row["identity_token"])

    def test_a_port_nobody_listens_on_has_no_owner(self) -> None:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]  # bound, never listening, then released
        self.assertEqual([], listener_owners.listener_processes(port))

    def test_a_process_that_cannot_be_read_is_reported_blank_not_guessed(self) -> None:
        reader = listener_owners._Windows()
        for pid in (4, 0x7FFFFFF0):  # the System process; a pid that does not exist
            with self.subTest(pid=pid):
                self.assertEqual(
                    {"pid": pid, "command_line": "", "executable_path": "", "identity_token": ""},
                    reader.process(pid),
                )


if __name__ == "__main__":
    unittest.main()
