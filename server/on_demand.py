"""`serve --on-demand`: hold the port from login, and become the server when someone calls.

A work item address is followed from a chat at any hour, so something has to answer
it even when nobody started Valkama today. A full server costs tens of megabytes
all day for the few clicks that need it, so this process holds the port and nothing
else until the first connection the server has to answer. Then it loads the server
into itself and serves that same socket. Nothing is handed between processes: the
connection that woke it goes to the server as accepted, the rest sit in the socket's
own queue and are accepted like any other, so a browser only waits. To everyone else
this is the managed listener `serve` is: same process, same port, same `/api/runtime`,
stopped the same way.

One read never wakes it. Before showing a toast, whichever process wrote asks this port
whether a page in focus already shows the item (`alerts.emit.listener_sees`). A page
exists only once the server is loaded, so here the answer can only be no, and loading
tens of megabytes for each toast to learn that would undo what this process is for.

What it imports decides what it costs, which is why `valkama.py` sends this command
here before it imports the command line, and why this module names the standard
library alone at its top: the rest arrives with the first connection, or never.
"""

from __future__ import annotations

import os
import select
import socket
import sys
import time
from collections.abc import Callable, Sequence

#: `configuration.DEFAULT_LISTENER_PORT`, spelled here because importing that module
#: is what this one avoids; `test_on_demand` holds the two to one value.
DEFAULT_PORT = 8642
#: How often a taken port is tried again, which is how this process picks the port
#: up once the desktop app closes the server it started.
BIND_RETRY_SECONDS = 30.0
#: After a load failed, how long a new connection is told so without another load.
#: One caller's reloads must not become a loop of full server starts.
RELOAD_AFTER_SECONDS = 5.0
#: Waking this rarely costs nothing and still lets Ctrl+C through on a console.
_WAKE_SECONDS = 2.0
_MAX_LOG_BYTES = 1024 * 1024
#: How long a new connection has to say what it wants before it counts as one for the
#: server: a browser's preconnect may say nothing until it is used. Under the sender's
#: `alerts.emit.PRESENCE_TIMEOUT`, and a sender slower than this only wakes the server.
_REQUEST_WAIT_SECONDS = 0.1
#: More than the head of the one request answered here; anything longer is not it.
_MOST_REQUEST_BYTES = 8192
#: `launcher.LAUNCHER_ENV` and `launcher.MANIFEST_NAME`, for the same reason.
_LAUNCHER_ENV = "VALKAMA_LAUNCHER_DIR"
_MANIFEST_NAME = "valkama-launcher.json"
_OWN_ENTRY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "valkama.py")
#: Where `log_path` is, as a person looks for it: the answer to a failed load names no
#: path of this machine, for the reason it names no failure.
_LOG_HINT = (
    "%LOCALAPPDATA%\\Valkama\\on-demand.log"
    if os.name == "nt"
    else "~/.local/share/valkama/on-demand.log"
)

#: The answer to a connection the server could not be loaded for. It names no reason:
#: this socket has no `Host` check yet, and the reason can hold a path. The log has it.
_LOAD_FAILED_BODY = (
    '<!doctype html><html><head><meta charset="utf-8"><title>Valkama</title></head>'
    '<body style="margin:0;padding:48px 24px;background:#030405;color:#e8e8e8;'
    'font:15px/1.5 system-ui,sans-serif">'
    '<h1 style="font-size:20px">Valkama не запустилась · Valkama did not start</h1>'
    f"<p>Сервер не загрузился, причина записана в журнал {_LOG_HINT}."
    " Обновите страницу, чтобы попробовать снова.</p>"
    f"<p>The server could not be loaded, and the reason is in the log {_LOG_HINT}."
    " Reload this page to try again.</p>"
    "</body></html>"
).encode()
_LOAD_FAILED = (
    b"HTTP/1.1 503 Service Unavailable\r\n"
    b"Content-Type: text/html; charset=utf-8\r\n"
    b"Content-Length: " + str(len(_LOAD_FAILED_BODY)).encode() + b"\r\n"
    b"Retry-After: 5\r\nCache-Control: no-store\r\n"
    # `http_surface._NOT_FRAMED`, which this module may not import; a test compares them.
    b"Content-Security-Policy: frame-ancestors 'none'\r\nX-Frame-Options: DENY\r\n"
    b"Connection: close\r\n\r\n" + _LOAD_FAILED_BODY
)

_PRESENCE_PATH = b"/api/alerts/presence"
#: `_alert_presence_read` in `http_surface` once the server is loaded; `test_on_demand`
#: compares the two answers.
_PRESENCE_BODY = b'{"visible":false}'
_PRESENCE_ANSWER = (
    b"HTTP/1.1 200 OK\r\n"
    b"Content-Type: application/json\r\n"
    b"Content-Length: " + str(len(_PRESENCE_BODY)).encode() + b"\r\n"
    b"Cache-Control: no-store\r\nConnection: close\r\n\r\n" + _PRESENCE_BODY
)

#: A connection this process accepted for the server: the socket and the peer's address.
Waiting = tuple[socket.socket, tuple[str, int]]
#: What becomes the server: `load(listener, port, development_origin, waiting)`. It
#: returns when the server stops, and a failure before that leaves both sockets with
#: the caller.
Load = Callable[[socket.socket, int, str | None, Waiting], None]


def log_path() -> str:
    """Beside the launcher's own files, and never in the store's home.

    `store_adoption` reads an existing `~/.valkama` as a store already adopted, so a
    directory made here before the first connection would leave a store under an
    earlier name behind and open an empty board. `launcher.default_releases` spells
    the same folder; `test_on_demand` holds the two to one place.
    """

    local = os.environ.get("LOCALAPPDATA") if os.name == "nt" else None
    if local:
        return os.path.join(local, "Valkama", "on-demand.log")
    data = os.environ.get("XDG_DATA_HOME") or os.path.join(
        os.path.expanduser("~"), ".local", "share"
    )
    return os.path.join(data, "valkama", "on-demand.log")


def _rotate(path: str) -> None:
    """Move a long log aside. The server's stderr can hold the file open, and on Windows
    that refuses the move, so it then grows until the next login rather than lose a line."""

    try:
        if os.path.exists(path) and os.path.getsize(path) > _MAX_LOG_BYTES:
            os.replace(path, f"{path}.1")
    except OSError:
        pass


def _log(line: str) -> None:
    """Write one line where it can be read later; a failure here must not cost the listener.

    At login there is no console and no caller, so the file is the only witness.
    """

    path = log_path()
    _rotate(path)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as stream:
            stream.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} pid {os.getpid()} {line}\n")
    except OSError:
        pass


def _give_output_a_home() -> None:
    """Under `pythonw.exe` there is no stdout or stderr, and the server prints to stderr."""

    if sys.stderr is not None and sys.stdout is not None:
        return
    _rotate(log_path())
    try:
        os.makedirs(os.path.dirname(log_path()), exist_ok=True)
        stream = open(log_path(), "a", encoding="utf-8", buffering=1)
    except OSError:
        stream = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = stream
    if sys.stdout is None:
        sys.stdout = stream


def _bind(port: int) -> socket.socket:
    """The listening socket, on the terms `PlatformHTTPServer` binds its own."""

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if os.name != "nt":
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", port))
        listener.listen(128)
    except OSError:
        listener.close()
        raise
    return listener


def _named_release() -> str | None:
    """The entry point the launcher names now, when a launcher started this process."""

    directory = os.environ.get(_LAUNCHER_ENV)
    if not directory:
        return None
    import json

    try:
        with open(os.path.join(directory, _MANIFEST_NAME), encoding="utf-8") as stream:
            named = json.load(stream).get("source_script")
    except (OSError, ValueError, AttributeError):
        return None
    return named if isinstance(named, str) else None


def _follow_release(port: int, listener: socket.socket | None = None) -> bool:
    """Hand over to the pinned release if it is no longer this one, and say so.

    `launcher install` restarts a listener it can prove is this one. What it cannot
    reach is a process still waiting for a taken port, or a stop that was refused,
    and neither may go on to serve the old release's code to the next caller.
    """

    named = _named_release()
    if named is None or os.path.normcase(os.path.abspath(named)) == os.path.normcase(_OWN_ENTRY):
        return False
    from . import launcher

    if listener is not None:
        listener.close()
    _log(f"the launcher now names {named}; starting that release")
    try:
        launcher.start_on_demand_listener(os.environ.get(_LAUNCHER_ENV), port)
    except (OSError, launcher.LauncherError) as error:
        _log(f"could not start that release: {error}")
    return True


def _bind_when_free(port: int, retry_seconds: float) -> socket.socket | None:
    """Wait for the port, touching nobody; None once a newer release has taken over."""

    told = False
    while True:
        try:
            return _bind(port)
        except OSError as error:
            if not told:
                _log(f"port {port} is taken ({error}); trying every {retry_seconds:g} s")
                told = True
        time.sleep(retry_seconds)
        if _follow_release(port):
            return None


def _refuse(connection: socket.socket) -> None:
    """Answer one connection that a failed load left without a server."""

    with connection:
        try:
            connection.settimeout(1.0)
            connection.recv(65536)
            connection.sendall(_LOAD_FAILED)
        except OSError:
            pass


def _refuse_waiting(listener: socket.socket) -> None:
    """Answer every connection in the queue, so none of them ends in a dropped socket."""

    while select.select([listener], [], [], 0)[0]:
        _refuse(listener.accept()[0])


def _peek_request(connection: socket.socket) -> bytes:
    """What a connection has sent so far, left in the socket for whoever reads it next."""

    deadline = time.monotonic() + _REQUEST_WAIT_SECONDS
    seen = b""
    while b"\r\n\r\n" not in seen and len(seen) < _MOST_REQUEST_BYTES:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        connection.settimeout(remaining)
        try:
            sent = connection.recv(_MOST_REQUEST_BYTES, socket.MSG_PEEK)
        except OSError:
            break
        if not sent:
            break
        if sent == seen:
            time.sleep(0.002)  # a peek never drains, so waiting for more is a poll
        seen = sent
    return seen


def _asks_presence(request: bytes, port: int) -> bool:
    """Whether this is the read of a sender, spelled as the loaded server would accept it.

    Anything else goes to the server, which owns every refusal: a wrong `Host`, a read
    that names no work item, a request cut short.
    """

    head, ended, _rest = request.partition(b"\r\n\r\n")
    if not ended:
        return False
    line, *headers = head.split(b"\r\n")
    parts = line.split(b" ")
    if len(parts) != 3 or parts[0] != b"GET" or parts[2] != b"HTTP/1.1":
        return False
    path, _mark, query = parts[1].partition(b"?")
    if path != _PRESENCE_PATH or not any(
        pair.startswith(b"work_item=") and len(pair) > len(b"work_item=")
        for pair in query.split(b"&")
    ):
        return False
    hosts = [
        value.strip()
        for name, _colon, value in (header.partition(b":") for header in headers)
        if name.lower() == b"host"
    ]
    return hosts == [f"127.0.0.1:{port}".encode()]


def _answer_presence(connection: socket.socket, request: bytes) -> None:
    """No page can be connected before the server is loaded, so nothing is visible.

    The request is read off first: closing a socket with unread data resets the
    connection, and on Windows that can lose the answer on its way to the reader.
    """

    with connection:
        try:
            connection.settimeout(1.0)
            connection.recv(len(request))
            connection.sendall(_PRESENCE_ANSWER)
            connection.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def _take_connection(listener: socket.socket, port: int) -> Waiting | None:
    """Accept one connection, and return it if the server has to answer it."""

    try:
        connection, address = listener.accept()
    except OSError:
        return None
    request = _peek_request(connection)
    if _asks_presence(request, port):
        _answer_presence(connection, request)
        return None
    connection.settimeout(None)
    return connection, address


def _load_server(
    listener: socket.socket, port: int, development_origin: str | None, waiting: Waiting
) -> None:
    begun = time.monotonic()
    from .http_surface import serve_main

    serve_main(
        port,
        development_origin=development_origin,
        adopted=listener,
        waiting=waiting,
        ready=lambda: _log(f"serving after {time.monotonic() - begun:.2f} s"),
    )


def run(
    port: int,
    *,
    development_origin: str | None = None,
    load: Load | None = None,
    retry_seconds: float = BIND_RETRY_SECONDS,
) -> int:
    """Hold `port` until the server is needed, then serve it until the process ends."""

    if not 1 <= port <= 65535:
        raise SystemExit(f"invalid listener port {port}")
    _give_output_a_home()
    become_server = load or _load_server
    listener = _bind_when_free(port, retry_seconds)
    if listener is None:
        return 0
    _log(f"holding port {port} until the first connection")
    failed_at: float | None = None
    while True:
        if not select.select([listener], [], [], _WAKE_SECONDS)[0]:
            continue
        if failed_at is not None and time.monotonic() - failed_at < RELOAD_AFTER_SECONDS:
            _refuse_waiting(listener)
            continue
        waiting = _take_connection(listener, port)
        if waiting is None:
            continue
        if _follow_release(port, listener):
            waiting[0].close()
            return 0
        try:
            become_server(listener, port, development_origin, waiting)
            return 0
        except KeyboardInterrupt:
            raise
        except BaseException as error:  # noqa: BLE001 - `SystemExit` is a failed load here too
            import traceback

            _log(f"the server could not be loaded:\n{traceback.format_exc()}")
            if listener.fileno() == -1:  # it was already serving: this is its end
                print(f"the server stopped: {error}", file=sys.stderr)  # noqa: T201
                return 1
            failed_at = time.monotonic()
            _refuse(waiting[0])
            _refuse_waiting(listener)


def main(arguments: Sequence[str]) -> int | None:
    """Run the exact command line this module answers, or None to leave it to `cli`.

    Anything else, a mistyped port included, goes to the argument parser, so the
    wording of a refusal has one owner.
    """

    port = DEFAULT_PORT
    rest = [argument for argument in arguments if argument != "--on-demand"]
    if len(arguments) - len(rest) != 1:
        return None
    if rest:
        spelled = rest[0].split("=", 1) + rest[1:]
        if len(spelled) != 2 or spelled[0] != "--port" or not spelled[1].isdecimal():
            return None
        port = int(spelled[1])
    return run(port)
