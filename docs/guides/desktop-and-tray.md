# The desktop app and the tray

On Windows, Valkama runs as an application: a desktop window with its own taskbar
entry, and a tray icon that shows while an agent is working. Installing the app
is described in [Installation and setup](installation.md#the-desktop-app-windows);
building it from source is in [Building and development](development.md#the-desktop-app).

## The desktop window

`desktop/` is a thin Electron shell. Its window opens at once, on a starting
page in the workspace's palette and language; behind it the app verifies the
managed launcher, reuses the managed server or starts one, and then shows
Valkama in that window with its own process, taskbar entry and icon. When it
cannot, the same window says why and offers the remedy: a stale managed server
is offered a restart there, and only a listener the launcher proves its own is
ever stopped. It runs `runtime` and `serve` through the stable shim, whose
manifest selects the release pinned from this repository; there is no second
desktop source record or checkout-path fallback. Each step of opening the
window is logged, with its time, to `%TEMP%\valkama-desktop.log`.

With the app installed on Windows, a link to a work item followed from outside a
browser page opens the card in this window, at first start or on top of a running
window, and the browser tab closes itself where the browser allows it. The window
comes up above what is in use; while you are working elsewhere, Windows keeps the
keyboard there until you click it. The page in the tab offers to open the item in
the browser instead;
[the address of a work item](../connection-contract.md#the-address-of-a-work-item)
states when this happens.

## The tray icon

The tray icon appears while an agent holds an MCP session and disappears when
the last one ends, so it answers "is anybody working here right now?". Clicking
it always does something visible. With the desktop app installed it starts the
app and nothing else, and the app decides the rest in its own window. Without
the app it opens a browser, starts the server, offers a restart, or explains the
refusal in a dialog, deciding off the icon's thread. When a listener owned by
the managed shim is older than the launcher's current source, the dialog says
which half drifted and offers to restart it. A listener whose managed process
ownership cannot be verified is refused and left untouched — holding the port
or returning Valkama-shaped JSON is not stop authority. Clicks, the steps they
took and how they ended are logged to `%TEMP%\valkama-tray.log`.

`launcher install` moves the icon along with the session that holds it: its script
restarts from the new release, so two icons can stand side by side for up to two
seconds. An icon hidden from its menu stays hidden.

Set `VALKAMA_NO_TRAY=1` to turn it off.
