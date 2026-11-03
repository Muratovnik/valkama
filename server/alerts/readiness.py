"""Whether alerts can reach the owner on this machine, and a toast to prove it.

Both answer the settings screen. `status` reads what is true now without showing
anything; `send_trial` shows a toast, and says why when Windows would not.
"""

from __future__ import annotations

import sqlite3
from typing import TypedDict

from .. import launcher
from ..ops import toast
from . import messages
from . import settings as alert_settings


class Status(TypedDict):
    #: The Start menu shortcut with Valkama's identity is there. Without it Windows
    #: drops every toast without a word, so this is the first thing to name.
    shortcut: bool
    #: The toast helper is built or can be, without building it here.
    helper: bool
    #: `launcher.autostart_status`'s state, or `unknown` when it cannot be read.
    autostart: str
    #: What Windows answers about showing Valkama's toasts.
    windows: toast.Check


class Trial(toast.Check):
    #: Whether the helper was started on a toast Windows said it would show.
    shown: bool


def status() -> Status:
    try:
        autostart = str(launcher.autostart_status()["state"])
    except launcher.LauncherError:
        autostart = "unknown"
    return {
        "shortcut": toast.shortcut_found(),
        "helper": toast.buildable(),
        "autostart": autostart,
        "windows": toast.check(),
    }


def send_trial(conn: sqlite3.Connection) -> Trial:
    """A toast now, in the owner's language: no window and no check for what is on screen."""

    answer = toast.check()
    if answer["state"] != "enabled":
        return {**answer, "shown": False}
    if not toast.shortcut_found():
        return {
            "state": "no-shortcut",
            "setting": answer["setting"],
            "reason": "the Start menu has no Valkama shortcut, so Windows would drop the toast",
            "shown": False,
        }
    settings = alert_settings.read(conn)
    return {**answer, "shown": toast.show(messages.trial(settings, logo=toast.logo_uri()))}
