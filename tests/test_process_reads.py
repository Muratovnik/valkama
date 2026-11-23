"""What a running process is, read from the system: checked on processes this test starts.

The arguments of a child are compared with the list it was started with, unicode,
spaces and quotes included, because a reader that split a command line its own way
would still return a list -- of the wrong words.
"""

from __future__ import annotations

import os
import subprocess
import sys
import unittest

from server import process_reads

SLEEPER = "import sys, time; sys.stdin.read()"


class TimeTests(unittest.TestCase):
    def test_a_creation_time_keeps_its_full_resolution(self) -> None:
        self.assertEqual("1601-01-01T00:00:00.0000000Z", process_reads._filetime_token(0))
        # 2026-11-01T08:27:04.1234567Z, in 100 ns intervals since 1601.
        value = 134_379_952_241_234_567
        self.assertEqual("2026-11-01T08:27:04.1234567Z", process_reads._filetime_token(value))
        self.assertNotEqual(
            process_reads._filetime_token(value), process_reads._filetime_token(value + 1)
        )


@unittest.skipUnless(os.name == "nt" or os.path.isdir("/proc/self"), "no process table to read")
class ArgumentsTests(unittest.TestCase):
    def started(self, *words: str) -> subprocess.Popen:
        child = subprocess.Popen([sys.executable, "-c", SLEEPER, *words], stdin=subprocess.PIPE)

        def stop() -> None:
            assert child.stdin is not None
            child.stdin.close()
            child.wait(timeout=30)

        self.addCleanup(stop)
        return child

    def test_a_child_is_read_with_the_words_it_was_started_with(self) -> None:
        words = ("-p", "два слова", 'a "quoted" word', "trailing\\", "--input-format=text")
        child = self.started(*words)
        read = process_reads.arguments(child.pid)
        assert read is not None
        self.assertEqual(["-c", SLEEPER, *words], read[1:])

    def test_a_process_that_cannot_be_read_has_no_arguments(self) -> None:
        self.assertIsNone(process_reads.arguments(0x7FFFFFF0))  # a pid that does not exist


@unittest.skipUnless(os.name == "nt", "the process calls are Windows'")
class WindowsTests(unittest.TestCase):
    def test_a_process_that_cannot_be_read_is_reported_blank_not_guessed(self) -> None:
        reader = process_reads.Windows()
        for pid in (4, 0x7FFFFFF0):  # the System process; a pid that does not exist
            with self.subTest(pid=pid):
                self.assertEqual(
                    {"pid": pid, "command_line": "", "executable_path": "", "identity_token": ""},
                    reader.process(pid),
                )

    def test_a_command_line_splits_by_windows_rule(self) -> None:
        reader = process_reads.Windows()
        self.assertEqual(
            ["claude.exe", "-p", 'say "ok" now', "C:\\dir\\", "x"],
            reader.split('claude.exe -p "say \\"ok\\" now" "C:\\dir\\\\" x'),
        )


if __name__ == "__main__":
    unittest.main()
