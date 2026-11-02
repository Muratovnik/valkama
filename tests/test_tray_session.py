"""The icon's life inside one session: which release it comes from, and when it moves.

`test_tray_contract.py` drives what the script decides on a click. This is the
other half: the session process that starts the script and holds the handle it
watches. A session outlives the release it started on, so an icon that stays with
that release keeps running its old script until the client restarts.
"""

from __future__ import annotations

import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.ops import tray


class FakeTray:
    def __init__(self, *, exited: bool = False) -> None:
        self.exited = exited

    def poll(self) -> int | None:
        return 0 if self.exited else None


class TrayFollowTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.old = self.release(directory.name, "old")
        self.new = self.release(directory.name, "new")
        self.events: list[tuple[str, str]] = []
        self.tray = FakeTray()
        self.handles = iter(range(1, 100))
        for name, value in (("_SLOT", None), ("_ICON", None), ("_ROOT", None)):
            patch = mock.patch.object(tray, name, value)
            patch.start()
            self.addCleanup(patch.stop)
        for name, replacement in (
            ("_spawn", self.spawn),
            ("_new_session_mutex", self.new_session),
            ("_close_mutex", self.close),
        ):
            patch = mock.patch.object(tray, name, replacement)
            patch.start()
            self.addCleanup(patch.stop)

    @staticmethod
    def release(root: str, name: str) -> str:
        directory = os.path.join(root, name)
        os.makedirs(os.path.join(directory, "windows"))
        for asset in ("tray.ps1", "valkama.ico"):
            Path(directory, "windows", asset).write_text("x", encoding="utf-8")
        return directory

    def spawn(self, script: str, icon: str, session_mutex: str) -> FakeTray:
        self.assertEqual(os.path.dirname(script), os.path.dirname(icon))
        self.events.append(("spawn", os.path.relpath(script, os.path.dirname(self.old))))
        self.spawned_mutex = session_mutex
        return FakeTray()

    def new_session(self) -> tuple[object, str]:
        handle = next(self.handles)
        return f"handle-{handle}", f"name-{handle}"

    def close(self, handle: object) -> None:
        self.events.append(("close", str(handle)))

    def icon_up(self) -> None:
        tray._ICON = tray._Icon("old-handle", self.tray)  # type: ignore[arg-type]
        tray._SLOT = "shared-handle"

    def test_the_icon_moves_to_the_new_release_and_the_old_one_is_told_to_go(self) -> None:
        self.icon_up()

        tray.follow(self.new)

        script = os.path.join("new", "windows", "tray.ps1")
        self.assertEqual([("spawn", script), ("close", "old-handle")], self.events)
        self.assertEqual("name-1", self.spawned_mutex, "the new tray watches its own mutex")
        self.assertEqual("handle-1", tray._ICON.session)
        self.assertEqual("shared-handle", tray._SLOT, "the slot never leaves this session")

    def test_a_release_whose_tray_will_not_start_leaves_the_working_icon_up(self) -> None:
        self.icon_up()

        with mock.patch.object(tray, "_spawn", side_effect=OSError("no pwsh")):
            tray.follow(self.new)

        self.assertEqual([("close", "handle-1")], self.events, "only the unused handle closes")
        self.assertEqual("old-handle", tray._ICON.session)

    def test_a_release_with_no_tray_script_leaves_the_working_icon_up(self) -> None:
        self.icon_up()
        os.remove(os.path.join(self.new, "windows", "tray.ps1"))

        tray.follow(self.new)

        self.assertEqual([("close", "handle-1")], self.events)
        self.assertEqual("old-handle", tray._ICON.session)

    def test_an_icon_the_operator_hid_stays_hidden(self) -> None:
        self.tray.exited = True
        self.icon_up()

        tray.follow(self.new)

        self.assertEqual([], self.events)
        self.assertEqual("old-handle", tray._ICON.session)

    def test_a_session_without_the_icon_starts_nothing(self) -> None:
        tray.follow(self.new)

        self.assertEqual([], self.events)
        self.assertIsNone(tray._ICON)

    def test_an_icon_taken_over_after_a_switch_comes_from_the_new_release(self) -> None:
        """The owner of the slot ended, and this session has moved on since it started."""

        tray.follow(self.new)

        tray._show("shared-handle", "handle", "name")

        self.assertEqual([("spawn", os.path.join("new", "windows", "tray.ps1"))], self.events)

    def test_a_session_waiting_for_the_slot_takes_it_when_the_owner_goes(self) -> None:
        spawned = threading.Event()
        taken: list[str] = []

        def spawn(script: str, _icon: str, _session_mutex: str) -> FakeTray:
            taken.append(script)
            spawned.set()
            return FakeTray()

        with (
            mock.patch.dict(os.environ, {}, clear=False),
            mock.patch.object(sys, "platform", "win32"),
            mock.patch.object(tray, "_spawn", spawn),
            mock.patch.object(tray, "_claim_slot", side_effect=[None, ("s", "h", "n")]),
            mock.patch("time.sleep"),
        ):
            os.environ.pop("VALKAMA_NO_TRAY", None)
            tray.start()
            self.assertTrue(spawned.wait(10), "the waiting session never took the icon")

        self.assertEqual(1, len(taken))
        self.assertEqual("h", tray._ICON.session)


@unittest.skipUnless(sys.platform == "win32", "Win32 mutexes")
class SessionMutexTests(unittest.TestCase):
    """What `tray.ps1` looks for, against the real kernel object."""

    @staticmethod
    def exists(name: str) -> bool:
        import ctypes

        kernel32 = ctypes.WinDLL("kernel32")
        handle = kernel32.OpenMutexW(0x00100000, False, name)  # SYNCHRONIZE
        if not handle:
            return False
        kernel32.CloseHandle(handle)
        return True

    def test_closing_the_handle_on_another_thread_is_what_the_tray_sees(self) -> None:
        """A thread that owns a mutex still owns it after its handle is closed, so
        the tray could not wait on it from here. It looks for the name instead, and
        a session closes the handle on whichever thread followed the switch."""

        made: list[tuple[object, str]] = []
        keep_owner_alive = threading.Event()
        created = threading.Event()

        def owner() -> None:
            session = tray._new_session_mutex()
            assert session is not None
            made.append(session)
            created.set()
            keep_owner_alive.wait(10)

        thread = threading.Thread(target=owner, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 10)
        self.addCleanup(keep_owner_alive.set)
        self.assertTrue(created.wait(10))
        handle, name = made[0]
        self.assertTrue(self.exists(name))

        tray._close_mutex(handle)

        self.assertFalse(self.exists(name))


if __name__ == "__main__":
    unittest.main()
