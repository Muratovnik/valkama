from __future__ import annotations

import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from server import atomic_files


def _windows_error(error: OSError, winerror: int) -> OSError:
    """What a rename raises on Windows, on any platform these tests run on."""

    error.winerror = winerror  # type: ignore[attr-defined]
    return error


class _Reader:
    """A thread that opens the file and reads it, over and over, as a status reader does."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.done = threading.Event()
        self.thread = threading.Thread(target=self._read, daemon=True)

    def _read(self) -> None:
        while not self.done.is_set():
            try:
                with open(self.path, "rb") as handle:
                    handle.read()
            except OSError:
                pass

    def __enter__(self) -> _Reader:
        self.thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.done.set()
        self.thread.join(5)


class ReaderTests(unittest.TestCase):
    """Every write lands while another thread keeps the file open for reading."""

    @unittest.skipUnless(
        os.name == "nt", "POSIX renames over an open file, so a reader cannot refuse it there"
    )
    def test_every_write_lands_while_a_reader_keeps_reading(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "status.json"
            path.write_bytes(b"0")
            with _Reader(path):
                # Without refusals this test would prove nothing: a plain replace must be
                # refused here, as it is on Windows while the file is open.
                refused = 0
                for n in range(200):
                    scratch = Path(root) / f"plain-{n}"
                    scratch.write_bytes(b"plain")
                    try:
                        os.replace(scratch, path)
                    except PermissionError:
                        refused += 1
                        scratch.unlink()
                self.assertGreater(refused, 0, "the reader never held the file open")
                for n in range(200):
                    atomic_files.write(path, str(n).encode())
                atomic_files.write(path, b"last")
            self.assertEqual(b"last", path.read_bytes())
            self.assertEqual(["status.json"], os.listdir(root))


class RefusalTests(unittest.TestCase):
    """Only the refusal a holder lifts by itself is waited out, and never past the bound."""

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(self._clean)
        self.path = self.root / "file.json"
        self.path.write_bytes(b"before")

    def _clean(self) -> None:
        for name in os.listdir(self.root):
            os.remove(self.root / name)
        os.rmdir(self.root)

    def write_with(self, *errors: OSError) -> mock.MagicMock:
        """Write once while `os.replace` raises these first; the mock that stood for it."""

        real = os.replace
        queued = list(errors)

        def replace(source: str, target: str) -> None:
            if queued:
                raise queued.pop(0)
            real(source, target)

        with (
            mock.patch("os.replace", side_effect=replace) as patched,
            mock.patch("time.sleep") as slept,
        ):
            self.slept = slept
            atomic_files.write(self.path, b"after")
        return patched

    def test_a_reader_that_lets_go_is_waited_out(self) -> None:
        refusals = [_windows_error(PermissionError(13, "Access is denied"), 5) for _ in range(3)]
        refusals.append(_windows_error(PermissionError(13, "sharing violation"), 32))
        replace = self.write_with(*refusals)
        self.assertEqual(5, replace.call_count)
        self.assertEqual(4, self.slept.call_count)
        self.assertEqual(b"after", self.path.read_bytes())
        self.assertEqual(["file.json"], os.listdir(self.root))

    def test_a_reader_that_stays_is_raised_after_the_bound_and_the_file_is_kept(self) -> None:
        refusal = _windows_error(PermissionError(13, "Access is denied"), 5)
        with (
            mock.patch("os.replace", side_effect=refusal) as replace,
            mock.patch("time.sleep") as slept,
            self.assertRaises(PermissionError),
        ):
            atomic_files.write(self.path, b"after")
        self.assertEqual(200, replace.call_count)
        self.assertAlmostEqual(2.0, sum(call.args[0] for call in slept.call_args_list), delta=0.05)
        self.assertEqual(b"before", self.path.read_bytes())
        self.assertEqual(["file.json"], os.listdir(self.root))

    def test_any_other_failure_is_raised_at_once(self) -> None:
        failures = {
            "a missing directory": _windows_error(FileNotFoundError(2, "not found"), 3),
            # POSIX sets no `winerror`: its permission refusal is a real one.
            "a POSIX permission refusal": PermissionError(13, "Permission denied"),
            "a full disk": _windows_error(OSError(28, "no space"), 112),
        }
        for case, failure in failures.items():
            with self.subTest(case):
                with (
                    mock.patch("os.replace", side_effect=failure) as replace,
                    mock.patch("time.sleep") as slept,
                    self.assertRaises(type(failure)),
                ):
                    atomic_files.write(self.path, b"after")
                self.assertEqual(1, replace.call_count)
                slept.assert_not_called()
                self.assertEqual(b"before", self.path.read_bytes())
                self.assertEqual(["file.json"], os.listdir(self.root))

    def test_the_mode_is_given_before_the_file_takes_its_name(self) -> None:
        seen: list[int] = []
        real = os.replace

        def replace(source: str, target: str) -> None:
            seen.append(os.stat(source).st_mode & 0o200)
            real(source, target)

        with mock.patch("os.replace", side_effect=replace):
            atomic_files.write(self.path, b"after", mode=0o400)
        self.assertEqual([0], seen)
        os.chmod(self.path, 0o600)


if __name__ == "__main__":
    unittest.main()
