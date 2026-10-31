"""The stdio front: the client's pipe, held while the release behind it changes.

A client spawns its MCP server once per session and keeps that process for the
session's life; stdin and stdout are the transport. The launcher pins one
release, and `launcher install` pins another, so a server that is the release
cannot follow the pin. The front can. It holds the client's pipes and the
protocol state that lives on them -- the handshake the client sent, the streams
it subscribed to, the tool list it was given -- and runs the server itself as a
backend: a child process of the release the launcher names now.

Front and backend speak plain MCP over stdio, which is what lets a front drive
any release, including one written before the front existed. A client line
reaches the backend as the bytes the client wrote, so `_meta`, `_identity` and
the request id arrive untouched. The front rewrites three answers and nothing
else: it declares `tools.listChanged` in an `initialize` and a `server/discover`
result, because it is the part that can keep that promise, and it appends a
warning to a tool result when a switch has failed.

A switch happens between requests: one lock covers a request's round trip and a
switch, so an in-flight request finishes on the backend that received it. The
old backend is stopped before the new one starts, because a backend migrates
the store before it answers anything and an old one must never write a store a
newer one has moved on.

The backend never sends a request of its own: the 2026-07-28 revision forbids a
server request on stdio, and this server sent none under the handshake
revisions either. The front relays one if it arrives, but it does not read the
client while it waits for an answer, so an answer to such a request would wait
behind the call that prompted it.
"""

from __future__ import annotations

import collections
import contextlib
import itertools
import json
import os
import queue
import subprocess
import sys
import threading
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
from typing import IO, BinaryIO, NamedTuple

from . import launcher, processes
from .ops import tray

PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion"
SUBSCRIPTION_ID_KEY = "io.modelcontextprotocol/subscriptionId"
# Reserved by the specification for a request naming a version not served.
UNSUPPORTED_PROTOCOL_VERSION = -32022
INTERNAL_ERROR = -32603

#: How long a release may take to answer its first request. A release that
#: raises the store schema migrates it before answering, behind a verified
#: backup, so this is generous rather than tight.
START_TIMEOUT = 120.0
#: How long `capabilities`, which reads no user data, may take.
PREFLIGHT_TIMEOUT = 60.0
#: How long a backend may take to exit once its stdin is closed.
STOP_TIMEOUT = 5.0
#: How often an idle session looks at the launcher manifest.
POLL_SECONDS = 2.0

# Without a console window: a client may start this front with none, and a
# console child of such a process gets a window of its own.
_CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

# Appended once to a tool result after a switch failed. Written for the agent
# that receives it: what happened, what it means for the answer it got, and who
# can fix it.
SWITCH_FAILED_WARNING = (
    "WARNING: the Valkama launcher now pins release {revision}, and this session"
    " could not switch to it: {reason}. This session keeps answering from the"
    " release it had, and a session opened now would fail the same way, so tell"
    " the owner: the fix is `launcher install` with a release that starts."
)


class Pin(NamedTuple):
    """One release as the launcher names it: the interpreter and the entry point."""

    python: str
    script: str
    revision: str | None = None

    @property
    def label(self) -> str:
        return (self.revision or Path(self.script).parent.name)[:12]


class BackendFailedError(RuntimeError):
    """A release did not start: it would not run, or it exited before answering."""


class BackendExitedError(RuntimeError):
    """A backend closed its stdout, or its stdin refused a write."""


class SessionLostError(RuntimeError):
    """No release can serve this session any more."""


def _report(line: str) -> None:
    """One diagnostic line on stderr: stdout is the protocol."""

    sys.stderr.write(f"valkama: {line}\n")
    sys.stderr.flush()


def _echo(line: bytes) -> None:
    """A backend's stderr line, passed on as the bytes it wrote."""

    sys.stderr.buffer.write(line)
    sys.stderr.buffer.flush()


def _frame(raw: bytes) -> dict | None:
    """A line as a JSON-RPC message, or None when it is not one.

    Read the way the server reads a line: bytes, decoded by the JSON parser, and
    a frame that is not an object is not a message.
    """

    if not raw.strip():
        return None
    try:
        message = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return message if isinstance(message, dict) else None


def _encode(message: Mapping[str, object]) -> bytes:
    # bytes, not text: Windows text stdout would turn \n into \r\n
    return (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")


def _canonical(tools: list) -> str:
    """A tool list as one string two equal lists share, whatever their key order."""

    return json.dumps(tools, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _key(request_id: object) -> str:
    """A request id as a dictionary key: ids may be strings or numbers."""

    return json.dumps(request_id)


def backend_environment(base: Mapping[str, str]) -> dict[str, str]:
    """What a backend is started with: the front's environment, minus two powers.

    Without `VALKAMA_LAUNCHER_DIR` a backend is not the pinned release as far as
    it can tell, so it serves instead of becoming a front of its own, and it does
    not warn about a pin the front is following for it. With `VALKAMA_NO_TRAY`
    the icon stays with the front, so a switch does not make it flicker.
    """

    environment = {name: value for name, value in base.items() if name != launcher.LAUNCHER_ENV}
    environment["VALKAMA_NO_TRAY"] = "1"
    return environment


class Backend:
    """One release's server, as a child process the front owns.

    Its stdout is read by a thread into a queue, so the front can wait for an
    answer with a deadline; its stderr is passed on to the front's stderr and
    the last lines are kept, because they are what says why a release failed.
    """

    def __init__(self, pin: Pin, *, echo: Callable[[bytes], None] = _echo) -> None:
        self.pin = pin
        self._echo = echo
        self._lines: queue.Queue[bytes | None] = queue.Queue()
        self._stderr: collections.deque[str] = collections.deque(maxlen=20)
        self.process = subprocess.Popen(
            [pin.python, pin.script, "mcp"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=backend_environment(os.environ),
            creationflags=_CREATE_NO_WINDOW,
        )
        stdin, stdout, stderr = self.process.stdin, self.process.stdout, self.process.stderr
        if stdin is None or stdout is None or stderr is None:  # pragma: no cover - PIPE gives all
            raise OSError("the backend was started without its pipes")
        self._stdin = stdin
        self._pumps = (
            threading.Thread(target=self._pump_stdout, args=(stdout,), daemon=True),
            threading.Thread(target=self._pump_stderr, args=(stderr,), daemon=True),
        )
        for pump in self._pumps:
            pump.start()

    def _pump_stdout(self, stream: IO[bytes]) -> None:
        with contextlib.suppress(OSError, ValueError):
            for line in stream:
                self._lines.put(line)
        self._lines.put(None)

    def _pump_stderr(self, stream: IO[bytes]) -> None:
        with contextlib.suppress(OSError, ValueError):
            for line in stream:
                self._echo(line)
                # Kept for a person reading a warning, never for a decision, so
                # a byte that is not UTF-8 is replaced rather than fatal.
                self._stderr.append(line.decode("utf-8", "replace").strip())

    def send(self, raw: bytes) -> None:
        try:
            self._stdin.write(raw if raw.endswith(b"\n") else raw + b"\n")
            self._stdin.flush()
        except (OSError, ValueError) as error:
            raise BackendExitedError(f"its stdin is closed: {error}") from error

    def receive(self, timeout: float | None) -> bytes:
        try:
            line = self._lines.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError(f"no answer within {timeout:g} seconds") from None
        if line is None:
            self._lines.put(None)  # every later read sees the end too
            raise BackendExitedError(self.tail() or "it closed its stdout")
        return line

    def tail(self) -> str:
        """Why it went, as far as its stderr says, or how it exited."""

        lines = [line for line in self._stderr if line]
        if lines:
            return lines[-1]
        code = self.process.poll()
        return f"it exited with status {code}" if code is not None else ""

    def stop(self, timeout: float) -> None:
        """Close stdin, which is how a server is asked to exit, then insist.

        Its streams are read to the end afterwards, so `tail` then holds the
        last thing it said: a release that exits writes its reason to stderr,
        and that line can arrive after its stdout has already closed.
        """

        with contextlib.suppress(OSError, ValueError):
            self._stdin.close()
        try:
            self.process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            processes.stop_process_tree(self.process)
        for pump in self._pumps:
            pump.join(timeout=timeout)
        for stream in (self.process.stdout, self.process.stderr):
            if stream is not None:
                with contextlib.suppress(OSError, ValueError):
                    stream.close()


def preflight(pin: Pin, *, timeout: float = PREFLIGHT_TIMEOUT) -> str | None:
    """Whether a release runs at all, asked without touching the store.

    `capabilities` imports every surface and reads no user data, so a release
    that cannot import, or an interpreter that is gone, is found before the
    backend that works is stopped. None when it ran; otherwise why not.
    """

    try:
        completed = subprocess.run(
            [pin.python, pin.script, "capabilities"],
            capture_output=True,
            timeout=timeout,
            check=False,
            env=backend_environment(os.environ),
            creationflags=_CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return f"it could not be run: {error}"
    if completed.returncode == 0:
        return None
    # For the person the warning reaches, never for a decision.
    lines = completed.stderr.decode("utf-8", "replace").strip().splitlines()
    detail = lines[-1] if lines else f"exit status {completed.returncode}"
    return f"`capabilities` failed: {detail}"


class ManifestPins:
    """The release the launcher names now, read again only when its manifest moves.

    A stat on every request is cheap; the hashes `launcher.status` checks are
    read only when the stat changed. A launcher that is not `installed` names no
    release to follow, and the session keeps the one it has.
    """

    def __init__(self, directory: str | os.PathLike[str]) -> None:
        self._directory = Path(directory)
        self._manifest = self._directory / launcher.MANIFEST_NAME
        self._stamp: tuple[int, int] | None = None
        self._pin: Pin | None = None
        self._read = False

    def __call__(self) -> Pin | None:
        try:
            info = self._manifest.stat()
            stamp: tuple[int, int] | None = (info.st_mtime_ns, info.st_size)
        except OSError:
            stamp = None
        if self._read and stamp == self._stamp:
            return self._pin
        self._read, self._stamp, self._pin = True, stamp, self._current()
        return self._pin

    def _current(self) -> Pin | None:
        try:
            current = launcher.status(self._directory)
        except (launcher.LauncherError, OSError):
            return None
        python, script = current.get("python"), current.get("source_script")
        if (
            current.get("state") != "installed"
            or not current.get("source_available")
            or not isinstance(python, str)
            or not isinstance(script, str)
        ):
            return None
        revision = current.get("revision")
        return Pin(python, script, revision if isinstance(revision, str) else None)


class Front:
    """The protocol state of one client session, and the backend that serves it."""

    def __init__(
        self,
        out: BinaryIO,
        *,
        read_pin: Callable[[], Pin | None],
        start_timeout: float = START_TIMEOUT,
        stop_timeout: float = STOP_TIMEOUT,
        echo: Callable[[bytes], None] = _echo,
        report: Callable[[str], None] = _report,
    ) -> None:
        self._out = out
        self._read_pin = read_pin
        self._start_timeout = start_timeout
        self._stop_timeout = stop_timeout
        self._echo = echo
        self._report = report
        # One lock for a request's round trip and for a switch: holding it is
        # what "between requests" means.
        self._lock = threading.Lock()
        self._out_lock = threading.Lock()
        self._ids = itertools.count(1)
        self._backend: Backend | None = None
        self._pin: Pin | None = None
        # The release a switch failed on. It is tried again only once the
        # launcher has named another one, not on every request.
        self._refused: Pin | None = None
        self._lost: str | None = None
        self._warning: str | None = None
        # What the client established: its handshake, if it made one, and
        # whether it said the handshake was done.
        self._handshake: dict | None = None
        self._initialized = False
        self._versions: list[str] = []
        self._version: str | None = None
        # Open `subscriptions/listen` streams, keyed by request id, with
        # whether each one asked for tool-list changes.
        self._subscriptions: dict[str, tuple[object, bool]] = {}
        # The tool list the client was last given, so a switch can tell
        # whether it changed for this client.
        self._client_tools: str | None = None

    # --- lifecycle ------------------------------------------------------------

    def start(self, pin: Pin) -> None:
        """Start the release a session opens on. Raises if it does not start."""

        with self._lock:
            self._backend = self._launch(pin)
            self._pin = pin

    def serve(self, lines: Iterable[bytes]) -> int:
        """Relay a client's lines until it closes stdin; the exit status after."""

        try:
            for raw in lines:
                if not self.handle(raw):
                    return 1
            return 0
        finally:
            self.close()

    def close(self) -> None:
        """End every stream the way the specification asks, then the backend."""

        with self._lock:
            for request_id, _ in self._subscriptions.values():
                self._write(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "result": {
                            "resultType": "complete",
                            "_meta": {SUBSCRIPTION_ID_KEY: request_id},
                        },
                    }
                )
            self._subscriptions.clear()
            self._stop_backend()

    def watch(self, stop: threading.Event, interval: float = POLL_SECONDS) -> None:
        """Follow the pin while the client is idle, until `stop` is set.

        Without it a session would switch only when it next called a tool, and
        a tool a release added could not be discovered by a session that had no
        reason to call one.
        """

        while not stop.wait(interval):
            with self._lock:
                if self._backend is not None:
                    self.follow_pin()

    # --- one client line ------------------------------------------------------

    def handle(self, raw: bytes) -> bool:
        """Answer or relay one client line. False once the session is lost."""

        message = _frame(raw)
        if message is None:
            return True  # skipped, as the server skips it
        method = message.get("method")
        sent = message.get("params")
        params = sent if isinstance(sent, dict) else {}
        with self._lock:
            if method == "subscriptions/listen" and self._handshake is None:
                if message.get("id") is not None:  # a notification opens nothing
                    self._listen(message["id"], params)
                return True
            if method == "notifications/cancelled" and self._cancel(params):
                return True
            try:
                if self._backend is not None:
                    self.follow_pin()
                if self._backend is None:
                    raise SessionLostError(self._lost or "no release is running")
                self._relay(self._backend, raw, message, method, params)
            except (SessionLostError, BackendExitedError) as error:
                return self._lose(message, str(error))
            return True

    def _relay(
        self, backend: Backend, raw: bytes, message: dict, method: object, params: dict
    ) -> None:
        self._observe(method, params)
        backend.send(raw)
        if "method" not in message or message.get("id") is None:
            return  # a notification, or a client's answer: nothing comes back
        line, answer = self._await(backend, message["id"], timeout=None, deliver=True)
        self._write(self._edit(method, params, line, answer))

    def _lose(self, message: dict, reason: str) -> bool:
        """Answer the request that met a lost backend, and give the session up.

        The request is answered rather than resent: the backend may have acted
        on it before it went, and sending it twice could write twice.
        """

        self._report(f"this session's release is gone: {reason}")
        if "method" in message and message.get("id") is not None:
            self._write(
                {
                    "jsonrpc": "2.0",
                    "id": message["id"],
                    "error": {
                        "code": INTERNAL_ERROR,
                        "message": f"Valkama's server for this session stopped: {reason}",
                    },
                }
            )
        return False

    def _observe(self, method: object, params: dict) -> None:
        """Keep what a later backend must be told for the client to stay valid."""

        if method == "initialize":
            self._handshake = dict(params)
        elif method == "notifications/initialized":
            self._initialized = True
        elif self._handshake is None:
            meta = params.get("_meta")
            version = meta.get(PROTOCOL_VERSION_KEY) if isinstance(meta, dict) else None
            if isinstance(version, str) and version in self._versions:
                self._version = version

    def _edit(self, method: object, params: dict, line: bytes, answer: dict) -> bytes:
        """The answer the client gets: the backend's, rewritten only where due."""

        result = answer.get("result")
        if not isinstance(result, dict):
            return line
        if method in ("initialize", "server/discover"):
            if method == "server/discover":
                self._learn_versions(result)
            capabilities = result.get("capabilities")
            tools = capabilities.get("tools") if isinstance(capabilities, dict) else None
            if isinstance(tools, dict):
                # The front, not the backend, is what can tell this client
                # that the list changed, so it is the front that says so.
                tools["listChanged"] = True
                return _encode(answer)
        elif method == "tools/list":
            tools_listed = result.get("tools")
            if (
                isinstance(tools_listed, list)
                and "cursor" not in params
                and result.get("nextCursor") is None
            ):
                self._client_tools = _canonical(tools_listed)
        elif method == "tools/call" and self._warning is not None:
            content = result.get("content")
            if isinstance(content, list):
                # Appended, never prepended: content[0] is the payload.
                content.append({"type": "text", "text": self._warning})
                self._warning = None
                return _encode(answer)
        return line

    def _learn_versions(self, result: dict) -> None:
        versions = result.get("supportedVersions")
        if isinstance(versions, list):
            self._versions = [version for version in versions if isinstance(version, str)]

    def _await(
        self, backend: Backend, wanted: object, *, timeout: float | None, deliver: bool
    ) -> tuple[bytes, dict]:
        """Read the backend until it answers `wanted`, relaying what comes before.

        A notification belongs to the request in flight, so it reaches the
        client when the request is the client's and is dropped when it is the
        front's own. A line that is not a JSON-RPC frame never reaches stdout.
        """

        while True:
            line = backend.receive(timeout)
            frame = _frame(line)
            if frame is None or frame.get("jsonrpc") != "2.0":
                self._report(f"dropped {len(line)} bytes the backend wrote that are not MCP")
                continue
            if "method" in frame:
                if deliver:
                    self._write(line)
                continue
            if frame.get("id") == wanted:
                return line, frame
            self._report("dropped an answer the backend sent to no request in flight")

    def _ask(self, backend: Backend, method: str, params: dict) -> dict:
        """A request of the front's own, under an id no client sends."""

        request_id = f"valkama-front-{next(self._ids)}"
        backend.send(
            _encode({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        )
        return self._await(backend, request_id, timeout=self._start_timeout, deliver=False)[1]

    # --- subscriptions --------------------------------------------------------

    def _listen(self, request_id: object, params: dict) -> None:
        """Open a stream for the one notification this server can send.

        The stream is the request: it stays unanswered until the client cancels
        it or the session ends. The acknowledgment comes first and names the
        request id exactly, because on stdio that id is how a client tells its
        streams apart.
        """

        meta = params.get("_meta")
        version = meta.get(PROTOCOL_VERSION_KEY) if isinstance(meta, dict) else None
        if version not in self._versions:
            self._write(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {
                        "code": UNSUPPORTED_PROTOCOL_VERSION,
                        "message": "Unsupported protocol version",
                        "data": {"supported": list(self._versions), "requested": version},
                    },
                }
            )
            return
        self._version = version
        asked = params.get("notifications")
        tools = isinstance(asked, dict) and asked.get("toolsListChanged") is True
        self._subscriptions[_key(request_id)] = (request_id, tools)
        self._write(
            {
                "jsonrpc": "2.0",
                "method": "notifications/subscriptions/acknowledged",
                "params": {
                    "_meta": {SUBSCRIPTION_ID_KEY: request_id},
                    "notifications": {"toolsListChanged": True} if tools else {},
                },
            }
        )

    def _cancel(self, params: dict) -> bool:
        """Close the stream a cancellation names; False when it names no stream."""

        return self._subscriptions.pop(_key(params.get("requestId")), None) is not None

    def _listeners(self) -> list[object]:
        return [request_id for request_id, tools in self._subscriptions.values() if tools]

    # --- switching ------------------------------------------------------------

    def follow_pin(self) -> None:
        """Switch to the release the launcher names, if it names another one.

        Called with the lock held, so no request is in flight.
        """

        pin = self._read_pin()
        if pin is None or pin == self._refused:
            return
        if pin == self._pin:
            self._refused = None
            return
        self._switch(pin)

    def _switch(self, pin: Pin) -> None:
        problem = preflight(pin)
        if problem is not None:
            self._refuse(pin, problem)
            return
        previous = self._pin
        # Stopped before the next one starts: the next one may migrate the store
        # as it opens it, and the old one must not write after that.
        self._stop_backend()
        try:
            self._backend = self._launch(pin)
        except BackendFailedError as failure:
            self._refuse(pin, str(failure))
            if previous is None:
                self._lost = str(failure)
                return
            try:
                self._backend = self._launch(previous)
            except BackendFailedError as again:
                self._lost = f"{previous.label} could not start again either: {again}"
            return
        self._pin = pin
        self._refused = None
        self._report(f"this session now runs release {pin.label}")
        self._announce()

    def _refuse(self, pin: Pin, reason: str) -> None:
        self._refused = pin
        self._warning = SWITCH_FAILED_WARNING.format(revision=pin.label, reason=reason)
        self._report(f"stayed on {self._pin.label if self._pin else 'nothing'}: {reason}")

    def _launch(self, pin: Pin) -> Backend:
        """Start a release and bring it to where the client already is."""

        try:
            backend = Backend(pin, echo=self._echo)
        except OSError as error:
            raise BackendFailedError(f"it could not be run: {error}") from error
        try:
            # Answered whatever the era, so it is the probe that the release
            # started, and it says which versions a stream may name.
            self._learn_versions(self._ask(backend, "server/discover", {}).get("result") or {})
            if self._handshake is not None:
                self._ask(backend, "initialize", self._handshake)
                if self._initialized:
                    backend.send(_encode({"jsonrpc": "2.0", "method": "notifications/initialized"}))
        except (BackendExitedError, TimeoutError) as error:
            backend.stop(self._stop_timeout)
            raise BackendFailedError(backend.tail() or str(error)) from error
        return backend

    def _stop_backend(self) -> None:
        backend, self._backend = self._backend, None
        if backend is not None:
            backend.stop(self._stop_timeout)

    def _announce(self) -> None:
        """Tell the client its tool list changed, when it did and the client can hear it."""

        backend = self._backend
        legacy = self._handshake is not None
        listening = self._initialized if legacy else bool(self._listeners())
        if backend is None or self._client_tools is None or not listening:
            return
        params: dict = {}
        if not legacy:
            version = self._version or (self._versions[0] if self._versions else None)
            params = {"_meta": {PROTOCOL_VERSION_KEY: version}}
        try:
            result = self._ask(backend, "tools/list", params).get("result")
        except (BackendExitedError, TimeoutError):
            return  # the next request finds the backend gone and says so
        tools = result.get("tools") if isinstance(result, dict) else None
        if not isinstance(tools, list) or _canonical(tools) == self._client_tools:
            return
        if legacy:
            self._write({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"})
            return
        for request_id in self._listeners():
            self._write(
                {
                    "jsonrpc": "2.0",
                    "method": "notifications/tools/list_changed",
                    "params": {"_meta": {SUBSCRIPTION_ID_KEY: request_id}},
                }
            )

    # --- output ---------------------------------------------------------------

    def _write(self, frame: bytes | Mapping[str, object]) -> None:
        data = frame if isinstance(frame, bytes) else _encode(frame)
        with self._out_lock, contextlib.suppress(OSError, ValueError):
            # A client that has gone cannot be told; its stdin closing ends
            # the session through `serve`.
            self._out.write(data)
            self._out.flush()


def main() -> int | None:
    """Be the front for this process's stdio, or say this process is not the one.

    None means serve in-process, as `valkama.py mcp` always did: the process was
    not started by the launcher, or the launcher no longer names this release.
    Otherwise the session's exit status.
    """

    directory = os.environ.get(launcher.LAUNCHER_ENV)
    if not directory or launcher.pinned_source_reader() is None:
        return None
    pins = ManifestPins(directory)
    pin = pins()
    if pin is None:
        return None
    front = Front(sys.stdout.buffer, read_pin=pins)
    try:
        front.start(pin)
    except BackendFailedError as failure:
        _report(f"release {pin.label} did not start: {failure}")
        return 1
    # The icon lives as long as the session, which is the front's life now.
    tray.start()
    stop = threading.Event()
    threading.Thread(target=front.watch, args=(stop,), daemon=True).start()
    try:
        return front.serve(sys.stdin.buffer)
    finally:
        stop.set()


__all__ = ["Front", "ManifestPins", "Pin", "backend_environment", "main", "preflight"]
