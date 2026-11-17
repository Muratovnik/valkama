# Windows notifications

When an agent asks you a question or asks for a decision, or moves work to review,
Valkama shows a Windows notification, so you need not watch the board or the chats. It
works with Valkama's window closed, because the process that wrote the event shows it.
A launch from Valkama that fails can notify you too; that one is off until you turn it on.

## Quota warnings

Valkama also warns before a subscription quota window runs out: a week, and a model's own
week, at 75 % and again at 90 % spent, and the five-hour window when its forecast says it
runs out before its reset. That warning comes from the listener, after each pass of its
usage reader, so it needs the listener running, which `launcher autostart` keeps; the
window may be closed. Each level is given once per window, a restart included, and a new
reset starts the levels again. A reading older than fifteen minutes, or one whose session
the reader has not yet tied to an organization, warns of nothing until a fresh one comes.
The notification names the level, the reset, how old its data is and what to do, and a
click on it opens nothing.

## What it needs

- **The desktop app.** Its installer puts the Valkama shortcut in the Start menu, whose
  identity the notifications are shown under, and registers the `valkama:` scheme a click
  opens. Without the shortcut Windows drops a notification and reports no error, so
  without the app there are no notifications.
- **.NET Framework 4,** which Windows includes. A notification is shown by a small C#
  program, `windows/toast.cs`, compiled on first use into
  `%LOCALAPPDATA%\Valkama\toast`. The repository holds no binary and you need no SDK.
- **Notifications on in Windows,** under Settings → System → Notifications, for the system
  and for Valkama. Do Not Disturb is respected: there is no banner and the notification
  waits in the notification centre, unless you make Valkama a priority app.

A click starts the app if it is closed, and the app starts the server, so nothing has to
hold the port and `launcher autostart` is not needed for this. With autostart on, the
listener answers a notification's one question without loading the server.

## What it does

- A click opens the item; a click on a notification about a question goes on to that
  question, with the keyboard on its first field. Several items within a few seconds become
  one notification,
  and a click on that one opens the panel «Needs my answer» when any of them is a question.
- A question already on your screen, in a focused Valkama page, shows nothing. Another
  screen in the same window does not count as showing it.
- A newer notification about an item replaces the older one. It is taken away when the
  item has no open question left or is closed.
- A notification is shown at most once. A process killed before showing one loses it, and
  the question still waits in the panel.

## Settings and diagnostics

Settings → Windows notifications chooses the events and how much the text reveals, and
sends a trial notification. The lock screen shows the same text unless you turn on
Windows' "Hide content when notifications are on lock screen" for Valkama. `doctor`
reports the shortcut, the helper and autostart in one line, without compiling anything or
showing a notification; it cannot see whether Windows has blocked Valkama, which the
settings screen asks Windows directly. `VALKAMA_NO_ALERTS=1` turns notifications off for
a process, for tests and for machines with no desktop.
