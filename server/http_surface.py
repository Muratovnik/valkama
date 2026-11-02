"""The HTTP surface: the JSON API, event streams and the built web UI.

The handler owns routing, path validation and body streaming; every payload it
returns is built by a module above it.
"""

from __future__ import annotations

import contextlib
import enum
import json
import os
import queue
import re
import socket
import sqlite3
import sys
import threading
import time
from collections.abc import Callable, Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import NamedTuple
from urllib.parse import parse_qs, unquote, urlparse

from . import app_shell, housekeeping, http_security, runner, static_assets, ui_state, watchers
from .executions import api as execution_api
from .executions import lifecycle as execution_lifecycle
from .executions import service as execution_service
from .federation import federated_search, federated_spaces
from .memory import api as memory_api
from .ops import doctor
from .planning import agents as planning_agents
from .planning import api as planning_api
from .planning import calls as planning_calls
from .planning import exact_api as planning_exact_api
from .planning import interactions as planning_interactions
from .planning import model as planning_model
from .planning import service as planning_service
from .planning import views as planning_views
from .planning.routing import PlanningRouting
from .projects import scopes
from .refs import resolve_ref
from .sessions import op_ingest_session_event, session_context
from .static_assets import DIST_DIR, SOURCE_ROOT
from .store import connect, db_path
from .store_identity.primitives import ContractError

CLIENT_DISCONNECT_ERRORS = (
    BrokenPipeError,
    ConnectionAbortedError,
    ConnectionResetError,
    ValueError,
)


class EventFrames:
    """What an event stream writes for each rebuilt payload.

    ``data_version`` reports that the database changed, not that this view did:
    agents ingest session events continuously, so a board stream would
    otherwise repeat an identical frame several times a second and every
    consumer would believe the board itself was churning — the graph blanked
    and refetched on every tick. An unchanged payload writes nothing, except a
    comment frame once the connection has been quiet for long enough that
    silence and a dead client would look the same.
    """

    def __init__(
        self, clock: Callable[[], float] = time.monotonic, keepalive_seconds: float = 20.0
    ) -> None:
        self._clock = clock
        self._keepalive_seconds = keepalive_seconds
        self._last_payload: str | None = None
        self._last_write = clock()

    def frame(self, payload: str) -> bytes | None:
        if payload != self._last_payload:
            self._last_payload = payload
            self._last_write = self._clock()
            return f"data: {payload}\n\n".encode()
        if self._clock() - self._last_write >= self._keepalive_seconds:
            self._last_write = self._clock()
            return b": keep-alive\n\n"
        return None


# notifications (no id) are ignored on purpose


# --- web viewer: JSON API plus the built Vue app in web/dist -----------------

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
}

#: The views an event stream can carry, each Planning's own.
_SSE_VIEWS = frozenset({"planning", "spaces", "activity"})


def _require_sse_view(view: str) -> None:
    """Refuse an event-stream view nobody answers, before the stream opens."""

    if view not in _SSE_VIEWS:
        raise ui_state.PlatformHttpError(400, "error", f"Unknown event stream view: {view}")


def _first_value(parameters: Mapping[str, list[str]], key: str) -> str | None:
    """The first value a parsed query string gave for this key, if any.

    Deliberately not the rule the domain boundaries use: `query_params.first`
    refuses a repeated parameter, and these surface-owned reads accept one and
    take the first. Two behaviours are fine; two behaviours under one name were
    not, which is why this one says which it is.
    """
    values = parameters.get(key)
    return values[0] if values else None


# --- one boundary, declared once ---------------------------------------------
#
# Every module boundary this surface answers has the same shape: a handler that
# returns `(status, payload)` or None, an error mapper that turns a refusal into
# one, and a policy saying who owns the transaction. That scaffolding used to be
# copied per boundary — ten connect / try / handle / error_response / close
# blocks whose commit policy had already drifted apart — and is now one
# `_dispatch`. Adding a boundary is declaring a row below.


class _Raw(NamedTuple):
    """An answer a boundary rendered itself, byte for byte."""

    status: int
    body: bytes
    content_type: str


#: What a boundary answers: a JSON pair `_send_json` renders, or rendered bytes.
_Answer = _Raw | tuple[int, Mapping[str, object]]

_NOT_FOUND: _Answer = (
    404,
    {"error": {"code": "not_found", "message": "API endpoint was not found"}},
)


def _generic_failure(status: int = 400) -> _Answer:
    """The stable envelope a refusal gets when naming its reason would leak."""

    return status, {
        "error": {"code": "request_failed", "message": "request could not be completed"}
    }


class _Commit(enum.Enum):
    """Who owns the transaction behind one boundary, stated rather than implied.

    The copied blocks left this to whichever one was copied last, so a new
    boundary picked its policy by accident. These five are what the boundaries
    below actually do, and a row has to name one:

    ``NO_STORE``
        The boundary reaches its own store by path; this surface opens no
        connection at all.
    ``READ_ONLY``
        A connection is opened and never written, so there is nothing to commit
        or roll back.
    ``SURFACE``
        The domain leaves the commit to its caller: this surface commits on
        success and rolls back on failure. Planning's writers are written that
        way on purpose.
    ``DOMAIN``
        The domain commits its own writes and owns a failed one; the surface
        neither commits nor rolls back.
    ``DOMAIN_ROLLED_BACK_HERE``
        The domain commits its own writes, but a failure the surface sees is
        rolled back here too, because an Executions writer commits part way
        through a multi-step write.

    A new write boundary should choose ``DOMAIN``: the module that knows what a
    write means is the one that can say when it is complete.
    """

    NO_STORE = "no-store"
    READ_ONLY = "read-only"
    SURFACE = "surface"
    DOMAIN = "domain"
    DOMAIN_ROLLED_BACK_HERE = "domain-rolled-back-here"


#: The policies under which the surface rolls back what it did not commit.
_ROLLED_BACK_AT_SURFACE = frozenset({_Commit.SURFACE, _Commit.DOMAIN_ROLLED_BACK_HERE})


class _Notify(NamedTuple):
    """When a boundary's success wakes the event-stream watchers."""

    #: The paths that publish; None means every path this boundary answers.
    paths: frozenset[str] | None = None
    #: Publish once the response is written rather than before it.
    after_answer: bool = False


class _Call(NamedTuple):
    """One request, as the boundary table sees it."""

    conn: sqlite3.Connection | None
    path: str
    query: str
    parameters: Mapping[str, list[str]]
    payload: dict

    def store(self) -> sqlite3.Connection:
        """This request's connection, for a boundary whose policy declares one."""

        if self.conn is None:
            raise RuntimeError("a NO_STORE boundary asked for a connection")
        return self.conn


class _Boundary(NamedTuple):
    """One row: which paths, which handler, which error mapper, which policy."""

    handler: Callable[[_Call], _Answer | None]
    errors: Callable[[Exception], _Answer]
    commit: _Commit
    exact: frozenset[str] = frozenset()
    prefix: str | None = None
    notify: _Notify | None = None


#: Only an extensionless canonical Platform route shape receives `index.html`.
#: Which shapes those are is the Kernel's word; whether a path that matches one
#: gets the shell is this surface's, which is why the decision lives here and
#: the pattern reads like the routes above it.
_SPA_ROUTE = re.compile(r"^/modules/[a-z][a-z0-9-]{0,63}/(?:global|project/[a-z][a-z0-9-]{0,159})$")


def _is_spa_route(path: str) -> bool:
    return isinstance(path, str) and _SPA_ROUTE.fullmatch(path) is not None


#: The short address of one work item, as an agent writes it to the owner.
_WORK_ITEM_LINK = "/open"
#: All a work item link may redirect to: one card, on this origin. Spelled whole
#: rather than parsed, because a URL parser quietly drops the line breaks a
#: response header must never carry.
_CARD_ROUTE = re.compile(r"/modules/planning/project/[a-z][a-z0-9-]{0,159}\?entity=[A-Za-z0-9_-]+")


def _is_page_path(path: str) -> bool:
    """A path a person types or follows, rather than one the built page fetches.

    The build names every file it ships with an extension and serves them from
    `/assets/` or the root, so an extensionless path outside `/assets/` and
    `/api/` can only be an address of the app. When it names no page, the app
    shell answers it -- with 404, because the address names nothing -- and says
    so with a way back, instead of a bare plain-text "not found" a person
    cannot leave. A file the page fetches keeps its plain 404: a script or a
    stylesheet that came back as HTML would fail far from its cause.
    """

    last = path.rsplit("/", 1)[-1]
    return not path.startswith(("/api/", "/assets/")) and "." not in last


def _boundary(table: tuple[_Boundary, ...], path: str) -> _Boundary | None:
    """The first row that claims this path, in declaration order."""

    for row in table:
        if path in row.exact or (row.prefix is not None and path.startswith(row.prefix)):
            return row
    return None


def _publishes(notify: _Notify | None, path: str) -> bool:
    return notify is not None and (notify.paths is None or path in notify.paths)


# The handlers. Each names the one call its boundary makes; everything around
# it belongs to `_dispatch`.


def _planning_read(call: _Call) -> _Answer | None:
    if {"data_scope_id", "space_key"} & call.parameters.keys():
        if call.path != "/api/planning":
            raise planning_api.PlanningHttpError(
                400, "invalid_request", "Exact scope is supported by the Planning model read"
            )
        routing = PlanningRouting(call.store(), db_path())
        return 200, routing.planning_read_model(
            call.parameters,
            lambda conn, key: planning_views.planning_payload(conn, space=key),
        )
    return planning_api.handle_get(call.store(), call.path, call.parameters)


def _planning_read_error(error: Exception) -> _Answer:
    if isinstance(error, (ui_state.PlatformHttpError, ContractError)):
        return ui_state.error_response(error)
    return planning_api.error_response(error)


def _memory_read(call: _Call) -> _Answer | None:
    return memory_api.handle_get(call.store(), call.path, call.parameters)


def _execution_read(call: _Call) -> _Answer | None:
    return execution_api.handle_get(call.store(), call.path, call.parameters)


def _card_record(conn: sqlite3.Connection, reference: str) -> dict:
    """What the card draws: the item and the agents on it, which no tool answer carries."""

    return planning_service.get_work_item(conn, reference, agents=True)


def _planning_exact_read(call: _Call) -> _Answer | None:
    return planning_exact_api.handle_get(
        call.store(),
        db_path(),
        call.path,
        call.parameters,
        item_loader=_card_record,
    )


def _shell_read(call: _Call) -> _Answer | None:
    return app_shell.handle_get(call.store(), db_path(), call.path, call.parameters)


def _execution_write(call: _Call) -> _Answer | None:
    return execution_api.handle_post(call.store(), call.path, call.payload)


def _planning_write(call: _Call) -> _Answer | None:
    return planning_api.handle_post(call.store(), call.path, call.payload)


def _planning_exact_write(call: _Call) -> _Answer | None:
    return planning_exact_api.handle_post(call.store(), db_path(), call.path, call.payload)


def _shell_write(call: _Call) -> _Answer | None:
    return app_shell.handle_post(call.store(), call.path, call.payload)


def _ingest_write(call: _Call) -> _Answer | None:
    result = op_ingest_session_event(call.store(), call.payload)
    return _Raw(200, json.dumps(result).encode("utf-8"), "application/json")


def _execution_lifecycle_write(call: _Call) -> _Answer | None:
    conn = call.store()
    if call.path == "/api/execution/launch":
        result = execution_lifecycle.launch_work_item(conn, call.payload)
    else:
        result = execution_lifecycle.stop_work_item(conn, str(call.payload.get("work_item") or ""))
    return _Raw(200, json.dumps(result, ensure_ascii=False).encode("utf-8"), "application/json")


# The error mappers. A boundary that already publishes one lists it directly;
# these are the ones this surface owns.


def _kernel_answer(error: Exception, render: Callable[[Exception], tuple[int, dict]]) -> _Answer:
    if isinstance(error, (planning_model.PlanningError, planning_api.PlanningHttpError)):
        return planning_api.error_response(error)
    response = render(error)
    # A Kernel 500 says only that; whatever produced it stays in the process.
    return _generic_failure(500) if response[0] == 500 else response


def _exact_error(error: Exception) -> _Answer:
    """Planning's exact-scope routes and the app shell: the `ui_state` envelope."""

    return _kernel_answer(error, ui_state.error_response)


def _ingest_error(error: Exception) -> _Answer:
    if isinstance(error, ValueError):
        # The one route that names its reason, because the contract in
        # `docs/session-event-contract.md` promises a rejected event carries one
        # and an adapter author has nothing else to read. Only the domain's own
        # bounded validation messages get here: they name a field and its rule,
        # the endpoint is loopback and bearer-only, and anything else keeps the
        # generic envelope.
        return 400, {"error": {"code": "ingest_rejected", "message": str(error)}}
    return _generic_failure()


def _execution_lifecycle_error(error: Exception) -> _Answer:
    if isinstance(error, runner.LaunchError):
        # A refusal is an answer: the caller learns the packet was not
        # startable, and the item is exactly as it was.
        return _Raw(
            422,
            json.dumps(
                {
                    "error": "launch_refused",
                    "outcome": "launch_failed",
                    "message": str(error),
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            "application/json",
        )
    if isinstance(error, planning_model.PlanningError):
        return planning_api.error_response(error)
    return _generic_failure()


_GET_BOUNDARIES: tuple[_Boundary, ...] = (
    _Boundary(
        prefix="/api/planning",
        handler=_planning_read,
        errors=_planning_read_error,
        commit=_Commit.READ_ONLY,
    ),
    _Boundary(
        exact=frozenset(memory_api.READ_PATHS),
        handler=_memory_read,
        errors=memory_api.error_response,
        commit=_Commit.READ_ONLY,
    ),
    _Boundary(
        exact=frozenset(execution_api.READ_PATHS),
        handler=_execution_read,
        errors=execution_api.error_response,
        commit=_Commit.READ_ONLY,
    ),
    # The two rows below answer under `/api/platform/` and `/api/modules`.
    # Nothing else does: any other path there falls through to a plain 404.
    _Boundary(
        exact=planning_exact_api.READ_PATHS,
        handler=_planning_exact_read,
        errors=_exact_error,
        commit=_Commit.READ_ONLY,
    ),
    _Boundary(
        exact=app_shell.READ_PATHS,
        handler=_shell_read,
        errors=_exact_error,
        commit=_Commit.READ_ONLY,
    ),
)

_POST_BOUNDARIES: tuple[_Boundary, ...] = (
    _Boundary(
        exact=frozenset(execution_api.WRITE_PATHS),
        handler=_execution_write,
        errors=execution_api.error_response,
        commit=_Commit.DOMAIN_ROLLED_BACK_HERE,
        notify=_Notify(after_answer=True),
    ),
    _Boundary(
        prefix="/api/planning",
        handler=_planning_write,
        errors=planning_api.error_response,
        commit=_Commit.SURFACE,
    ),
    _Boundary(
        exact=planning_exact_api.WRITE_PATHS,
        handler=_planning_exact_write,
        errors=_exact_error,
        commit=_Commit.DOMAIN,
        notify=_Notify(),
    ),
    _Boundary(
        exact=app_shell.WRITE_PATHS,
        handler=_shell_write,
        errors=_exact_error,
        commit=_Commit.DOMAIN,
    ),
    _Boundary(
        exact=frozenset({"/api/ingest"}),
        handler=_ingest_write,
        errors=_ingest_error,
        # Same-process writes bump no `data_version`, so this publishes itself.
        commit=_Commit.DOMAIN,
        notify=_Notify(),
    ),
    _Boundary(
        exact=frozenset({"/api/execution/launch", "/api/execution/stop"}),
        handler=_execution_lifecycle_write,
        errors=_execution_lifecycle_error,
        commit=_Commit.DOMAIN,
        notify=_Notify(),
    ),
)

_PUT_BOUNDARIES: tuple[_Boundary, ...] = ()


class PlatformHTTPServer(ThreadingHTTPServer):
    """The listener, carrying the immutable startup capture handlers read."""

    runtime_snapshot: static_assets.RuntimeSnapshot
    security_context: http_security.SecurityContext

    # `HTTPServer` sets SO_REUSEADDR, which on Windows does not mean "rebind
    # over TIME_WAIT" as it does elsewhere: it lets a second socket bind a port
    # another one is listening on. Two servers then answered on one port, and
    # whoever started the second -- the desktop app, the tray -- read the other
    # one's identity as its own child's. Without the option Windows refuses the
    # second bind, so a server that cannot own the port exits instead of
    # sharing it, and a listener that closed can still be rebound at once.
    allow_reuse_address = os.name != "nt"

    def __init__(
        self,
        server_address: tuple[str, int],
        request_handler: type[BaseHTTPRequestHandler],
        *,
        token_path: Path = http_security.INSTALLATION_TOKEN_PATH,
        development_origin: str | None = None,
        adopted: socket.socket | None = None,
    ) -> None:
        """`adopted` is a socket already bound and listening, which stays its caller's
        until this returns: a failure here leaves it open for the caller to answer on."""

        if server_address[0] != "127.0.0.1":
            raise ValueError("Valkama HTTP must bind exactly 127.0.0.1")
        super().__init__(server_address, request_handler, bind_and_activate=adopted is None)
        if adopted is not None:
            self.socket.close()
            self.socket = adopted
            host, bound_port = adopted.getsockname()[:2]
            self.server_address = (host, bound_port)
            self.server_name, self.server_port = host, bound_port
        try:
            self.security_context = http_security.SecurityContext.create(
                self.server_port,
                token_path=token_path,
                development_origin=development_origin,
            )
        except Exception:
            if adopted is None:
                self.server_close()
            raise


class Handler(BaseHTTPRequestHandler):
    server: PlatformHTTPServer

    def handle(self) -> None:
        with contextlib.suppress(*CLIENT_DISCONNECT_ERRORS):
            super().handle()

    def parse_request(self) -> bool:
        """Validate loopback authority before BaseHTTPRequestHandler dispatches a verb."""

        if not super().parse_request():
            return False
        if not self._require_host():
            return False
        self._host_validated = True
        return True

    def log_message(self, *args):  # keep stdio quiet
        pass

    def _send(
        self,
        code: int,
        body: bytes,
        content_type: str,
        *,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_json(
        self,
        code: int,
        payload: Mapping[str, object],
        *,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        self._send(
            code,
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
            "application/json",
            headers=headers,
        )

    def _refuse(self, error: http_security.RequestRefusedError) -> None:
        self._send_json(
            error.status,
            {"error": {"code": error.code, "message": error.message}},
            headers={"Connection": "close"} if error.close else None,
        )
        if error.close:
            self.wfile.flush()
            http_security.drain_rejected_body(self.headers, self.rfile, self.connection)
            self.close_connection = True

    def _require_host(self) -> bool:
        try:
            http_security.require_host(self.headers, self.server.security_context)
        except http_security.RequestRefusedError as error:
            self._refuse(error)
            return False
        return True

    def _require_validated_host(self) -> bool:
        # Direct-handler unit harnesses do not execute parse_request.  They keep
        # the same security seam while real HTTP requests validate only once.
        return bool(getattr(self, "_host_validated", False)) or self._require_host()

    def _open_store(self) -> sqlite3.Connection | None:
        """The store, or None once its failure has been answered.

        Every route that reads the store opens it here, so a store that cannot
        open -- too new, mid-cutover, unreadable -- gets the same envelope
        everywhere. Without it the error escaped the handler: a `ValueError`
        subclass was swallowed as a client disconnect and the connection
        dropped with no answer, which an event stream retries forever.
        """

        try:
            return connect()
        except Exception as error:  # rendered as the stable envelope below
            status, body = ui_state.error_response(error)
            if self.command in {"POST", "PUT"} and status == 500:
                self._send_generic_failure(500)
            else:
                self._send_json(status, body)
            return None

    def _answer(self, answer: _Answer) -> None:
        """Write whichever of the two answer shapes a boundary produced."""

        if isinstance(answer, _Raw):
            self._send(answer.status, answer.body, answer.content_type)
        else:
            self._send_json(*answer)

    def _send_not_found(self) -> None:
        self._answer(_NOT_FOUND)

    def _send_generic_failure(self, status: int = 400) -> None:
        self._answer(_generic_failure(status))

    def _dispatch(
        self,
        boundary: _Boundary,
        path: str,
        *,
        query: str = "",
        parameters: Mapping[str, list[str]] | None = None,
        payload: dict | None = None,
    ) -> None:
        """Run one boundary under its own commit, notify and error policy.

        A store that cannot be opened is refused here, before the boundary
        runs, in the same envelope any other failure gets: a write's 500 says
        nothing about why, because the reason can name a path or a secret.
        """

        conn = None
        if boundary.commit is not _Commit.NO_STORE:
            conn = self._open_store()
            if conn is None:
                return
        try:
            call = _Call(
                conn, path, query, parameters or {}, payload if payload is not None else {}
            )
            try:
                answer = boundary.handler(call)
                if answer is None:
                    self._answer(_NOT_FOUND)
                    return
                if boundary.commit is _Commit.SURFACE and conn is not None:
                    conn.commit()
                publishes = _publishes(boundary.notify, path)
                after_answer = boundary.notify is not None and boundary.notify.after_answer
                if publishes and not after_answer:
                    watchers.WATCHERS.publish("changed")
                self._answer(answer)
                if publishes and after_answer:
                    watchers.WATCHERS.publish("changed")
            except Exception as error:  # the boundary's own normalized contract
                if boundary.commit in _ROLLED_BACK_AT_SURFACE and conn is not None:
                    conn.rollback()
                self._answer(boundary.errors(error))
        finally:
            if conn is not None:
                conn.close()

    def _read_json(self, max_bytes: int | None = None) -> dict:
        return http_security.read_json_object(
            self.headers,
            self.rfile,
            max_bytes=max_bytes or 64 * 1024,
        )

    def _has_asset(self, relative: str) -> bool:
        normalized = relative.lstrip("/").replace("\\", "/")
        snapshot = getattr(getattr(self, "server", None), "runtime_snapshot", None)
        if snapshot is not None:
            return normalized in snapshot.assets
        return os.path.isfile(os.path.join(DIST_DIR, normalized))

    def _send_asset(self, relative: str, status: int = 200) -> None:
        """Serve one startup-captured asset, refusing anything that escapes it."""
        dist = os.path.abspath(DIST_DIR)
        normalized_relative = relative.lstrip("/").replace("\\", "/")
        target = os.path.abspath(os.path.normpath(os.path.join(dist, normalized_relative)))
        try:
            contained = os.path.commonpath((dist, target)) == dist
        except ValueError:
            contained = False
        if not contained:
            self._send(404, b"not found", "text/plain")
            return
        snapshot = getattr(getattr(self, "server", None), "runtime_snapshot", None)
        startup_asset = snapshot.assets.get(normalized_relative) if snapshot is not None else None
        if snapshot is not None:
            if startup_asset is None:
                self._send(404, b"not found", "text/plain")
                return
            # The body and stat belong to the same startup capture. A later
            # Vite rebuild cannot replace bytes in this process.
            target = startup_asset.path
            body = startup_asset.body
            file_stat = startup_asset.stat
        else:
            if not os.path.isfile(target):
                self._send(404, b"not found", "text/plain")
                return
            with open(target, "rb") as file:
                body = file.read()
            file_stat = os.stat(target)
        policy = None
        if normalized_relative.startswith("assets/"):
            policy = static_assets.hashed_asset_policy(
                target,
                file_stat=file_stat,
                if_none_match=self.headers.get("If-None-Match"),
                representation=body,
            )
            if policy["not_modified"]:
                self.send_response(304)
                self.send_header("Cache-Control", str(policy["cache_control"]))
                self.send_header("ETag", str(policy["etag"]))
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        extension = os.path.splitext(target)[1]
        self.send_response(status)
        self.send_header("Content-Type", CONTENT_TYPES.get(extension, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        if policy is not None:
            self.send_header("Cache-Control", str(policy["cache_control"]))
            self.send_header("ETag", str(policy["etag"]))
        self.end_headers()
        self.wfile.write(body)

    def _send_index(self, status: int = 200) -> None:
        snapshot = getattr(getattr(self, "server", None), "runtime_snapshot", None)
        has_index = (
            "index.html" in snapshot.assets
            if snapshot is not None
            else os.path.isfile(os.path.join(DIST_DIR, "index.html"))
        )
        if not has_index:
            self._send(
                503,
                b"the board UI is not built: run 'npm ci && npm run build' in web",
                "text/plain",
            )
            return
        self._send_asset("index.html", status)

    def _follow_work_item_link(self, path: str) -> None:
        """Redirect to the card a link names, or let the app say why it cannot.

        The address is one a person follows, so every failure is answered by the
        app shell rather than by a JSON envelope: the shell reads the same address
        and explains it in the operator's language, with a next step. A store that
        cannot open is such a failure too, which is why this does not go through
        `_open_store`. The answer is never cached, because an item that is missing
        now may be filed a minute later and a binding can move.
        """

        text = unquote(path[len(_WORK_ITEM_LINK) + 1 :])
        try:
            conn = connect()
            try:
                location = planning_interactions.work_item_location(
                    PlanningRouting(conn, db_path()), text
                )
            finally:
                conn.close()
        except Exception:  # the shell's own read reports what went wrong
            self._send_index(503)
            return
        if location is None or _CARD_ROUTE.fullmatch(location) is None:
            self._send_index(404)
            return
        self._send(
            302,
            b"",
            "text/plain",
            headers={"Location": location, "Cache-Control": "no-store"},
        )

    def do_GET(self) -> None:
        url = urlparse(self.path)
        if not self._require_validated_host():
            return
        if url.path == _WORK_ITEM_LINK or url.path.startswith(f"{_WORK_ITEM_LINK}/"):
            self._follow_work_item_link(url.path)
            return
        if url.path == "/api/security/bootstrap":
            try:
                http_security.require_bootstrap_origin(self.headers, self.server.security_context)
            except http_security.RequestRefusedError as error:
                self._refuse(error)
                return
            body = json.dumps(
                {"session_token": self.server.security_context.browser_session_token},
                separators=(",", ":"),
            )
            self._send(
                200,
                body.encode("utf-8"),
                "application/json",
                headers={"Cache-Control": "no-store"},
            )
            return
        parameters = parse_qs(url.query, keep_blank_values=True)
        boundary = _boundary(_GET_BOUNDARIES, url.path)
        if boundary is not None:
            self._dispatch(boundary, url.path, query=url.query, parameters=parameters)
            return
        if url.path in ("/", "/index.html") or _is_spa_route(url.path):
            self._send_index()
        elif _is_page_path(url.path) and not self._has_asset(url.path):
            self._send_index(404)
        elif not url.path.startswith("/api/"):
            self._send_asset(url.path)
        elif url.path == "/api/runtime":
            snapshot = getattr(getattr(self, "server", None), "runtime_snapshot", None)
            if snapshot is None:
                self._send(503, b"runtime identity unavailable", "text/plain")
            else:
                self._send(
                    200,
                    static_assets.canonical_json(snapshot.identity).encode("utf-8"),
                    "application/json",
                )
        elif url.path == "/api/doctor":
            # The probe is off here on purpose: this request *is* a listener,
            # so asking the port would be the server checking itself and
            # reporting a match it cannot fail. `valkama doctor` runs it from
            # outside, where the answer means something.
            body = json.dumps(doctor.diagnose(probe=False), ensure_ascii=False)
            self._send(200, body.encode("utf-8"), "application/json")
        elif url.path == "/api/scopes":
            # The federated readers open the primary store themselves and catch
            # only what an attached store can do wrong; the primary is opened
            # here first so its failure is answered like any other route's.
            probe = self._open_store()
            if probe is None:
                return
            probe.close()
            try:
                body = json.dumps(federated_spaces(), ensure_ascii=False)
                self._send(200, body.encode("utf-8"), "application/json")
            except scopes.ScopeError as error:
                self._send(400, str(error).encode("utf-8"), "text/plain")
        elif url.path == "/api/search":
            parameters = parse_qs(url.query)
            text = _first_value(parameters, "q") or ""
            if (_first_value(parameters, "scope") or "") == "all":
                probe = self._open_store()
                if probe is None:
                    return
                probe.close()
                try:
                    body = json.dumps(federated_search(text), ensure_ascii=False)
                    self._send(200, body.encode("utf-8"), "application/json")
                except (ValueError, scopes.ScopeError) as error:
                    self._send(400, str(error).encode("utf-8"), "text/plain")
                return
            # A single-store search is `/api/planning/search`; this route
            # exists for the cross-scope answer, which no module can give.
            self._send(400, b"search requires scope=all", "text/plain")
        elif url.path == "/api/ref":
            parameters = parse_qs(url.query)
            try:
                kind = _first_value(parameters, "kind") or ""
                value = _first_value(parameters, "value") or ""
                # The card's planning space, by its exact identity: a commit is
                # looked for in the repository the registry binds it to as well.
                space = _first_value(parameters, "space")
                conn = connect()
                try:
                    # Keep the same connection-aware resolver used by MCP and
                    # retain its bounded Claude transcript fallback.
                    answer = resolve_ref(kind, value, conn=conn, space=space)
                finally:
                    conn.close()
                body = json.dumps(answer, ensure_ascii=False)
                self._send(200, body.encode("utf-8"), "application/json")
            except ValueError as error:
                self._send(400, str(error).encode("utf-8"), "text/plain")
        elif url.path == "/api/session":
            parameters = parse_qs(url.query)
            session_id = _first_value(parameters, "id") or ""
            session_store = self._open_store()
            if session_store is None:
                return
            try:
                body = json.dumps(session_context(session_store, session_id), ensure_ascii=False)
                self._send(200, body.encode("utf-8"), "application/json")
            except (ValueError, TypeError) as error:
                self._send(404, str(error).encode("utf-8"), "text/plain")
            finally:
                session_store.close()
        elif url.path == "/api/events":
            parameters = parse_qs(url.query, keep_blank_values=True)
            view = (parameters.get("view") or ["planning"])[0]
            try:
                _require_sse_view(view)
            except ui_state.PlatformHttpError as error:
                self._answer(ui_state.error_response(error))
                return
            exact = bool({"project", "data_scope_id", "space_key"} & parameters.keys())
            if exact and (view != "planning" or len(parameters.get("view", [view])) != 1):
                self._send_json(400, {"error": "Exact scope requires one Planning view"})
                return
            scoped = {key: value for key, value in parameters.items() if key != "view"}
            self._stream_events(
                _first_value(parameters, "space"),
                view=view,
                exact_parameters=scoped if exact else None,
            )
        else:
            self._send(404, b"not found", "text/plain")

    def _stream_events(
        self,
        board: str | None,
        view: str = "planning",
        exact_parameters: Mapping[str, list[str]] | None = None,
    ) -> None:
        """Push one live read model on every database change; clients never poll."""
        with contextlib.ExitStack() as cleanup:
            conn = self._open_store()
            if conn is None:
                return
            cleanup.callback(conn.close)
            source = conn
            try:
                if exact_parameters is not None:
                    source, _key = cleanup.enter_context(
                        PlanningRouting(conn, db_path()).planning_store(exact_parameters)
                    )
            except (ui_state.PlatformHttpError, ContractError) as error:
                self._answer(ui_state.error_response(error))
                return

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            stream = watchers.WATCHERS.subscribe()
            cleanup.callback(watchers.WATCHERS.unsubscribe, stream)
            frames = EventFrames()
            observed_version = source.execute("PRAGMA data_version").fetchone()[0]
            agents_seen = planning_agents.signal(source)

            def push() -> None:
                current: object
                if exact_parameters is not None:
                    # A fresh routing on every push: a binding moved while the
                    # stream is open refuses here and closes the stream.
                    current = PlanningRouting(conn, db_path()).planning_read_model(
                        exact_parameters,
                        lambda selected, key: planning_views.planning_payload(selected, space=key),
                    )
                elif view == "activity":
                    current = planning_views.activity_feed(conn)
                elif view == "spaces":
                    current = {"planning_spaces": planning_service.list_planning_spaces(conn)}
                else:
                    current = planning_views.planning_payload(conn, space=board)
                frame = frames.frame(json.dumps(current, ensure_ascii=False))
                if frame is not None:
                    self.wfile.write(frame)
                    self.wfile.flush()
                if view != "planning":
                    return
                # Its own short event, not a field of the frame above: it reloads
                # an open card and leaves the board and the graph as they are.
                nonlocal agents_seen
                seen = planning_agents.signal(source)
                if seen != agents_seen:
                    agents_seen = seen
                    self.wfile.write(f"event: agents\ndata: {seen}\n\n".encode())
                    self.wfile.flush()

            try:
                push()
                while True:
                    changed = False
                    try:
                        stream.get(timeout=0.4)
                        changed = True
                    except queue.Empty:
                        pass
                    current_version = source.execute("PRAGMA data_version").fetchone()[0]
                    if changed or current_version != observed_version:
                        observed_version = current_version
                        push()
                    else:
                        self.wfile.write(b": keep-alive\n\n")
                        self.wfile.flush()
            except ui_state.PlatformHttpError:
                self.close_connection = True
            except CLIENT_DISCONNECT_ERRORS:
                pass

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if not self._require_validated_host():
            return
        try:
            http_security.require_write_authorization(
                self.headers,
                self.server.security_context,
                adapter_endpoint=path == "/api/ingest",
            )
            body_limit = 64 * 1024
            payload = self._read_json(body_limit)
        except http_security.RequestRefusedError as error:
            self._refuse(error)
            return
        boundary = _boundary(_POST_BOUNDARIES, path)
        if boundary is not None:
            if path == "/api/ingest":
                self._dispatch(boundary, path, payload=payload)
                return
            # Past the browser credential, the write is the owner's own UI: the
            # one writer this server can verify without a client's help. Every
            # Planning row it writes, including one an execution launch writes
            # on its behalf, points at a call that says so.
            with planning_calls.bind(planning_calls.browser(), path):
                self._dispatch(boundary, path, payload=payload)
            return
        # Every write this surface still owns has a row above. A transition, a
        # claim, a checklist tick and a summary are Planning's own boundary
        # (`/api/planning/...`), which is why nothing falls through here.
        self._send_not_found()

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        if not self._require_validated_host():
            return
        try:
            http_security.require_write_authorization(
                self.headers, self.server.security_context, adapter_endpoint=False
            )
            payload = self._read_json()
        except http_security.RequestRefusedError as error:
            self._refuse(error)
            return
        boundary = _boundary(_PUT_BOUNDARIES, path)
        if boundary is None:
            self._send_not_found()
            return
        self._dispatch(boundary, path, payload=payload)

    def do_OPTIONS(self) -> None:
        if not self._require_validated_host():
            return
        self._send(405, b"method not allowed", "text/plain", headers={"Allow": "GET, POST, PUT"})


def serve_main(
    port: int,
    *,
    development_origin: str | None = None,
    adopted: socket.socket | None = None,
) -> None:
    runtime_snapshot = static_assets.capture_runtime_snapshot(SOURCE_ROOT, DIST_DIR)
    if "index.html" not in runtime_snapshot.assets:
        # This process has no logger and no caller to return to: it is the
        # console surface, and stderr is where a server says what it found.
        print(  # noqa: T201
            f"warning: {DIST_DIR} has no build; run 'npm ci && npm run build' in web",
            file=sys.stderr,
        )
    # A launch lives in the process that spawned it, so a previous listener's
    # attempts are unreachable to this one: it cannot poll them, stop them, or
    # ever reap them. Left open they would make the newest attempt on an item
    # look live forever. This is the only process that owns a runner, which is
    # why the sweep belongs here and not in `connect()`, where every MCP session
    # would run it and cancel the live attempts of the listener that owns them.
    startup = connect()
    try:
        closed = execution_service.close_open_executions(startup, "the platform restarted")
        startup.commit()
        maintenance = housekeeping.start_up(startup)
        # Unbounded, so beside the listener rather than before it.
        housekeeping.start_sweep(startup, lambda line: print(line, file=sys.stderr))  # noqa: T201
    finally:
        startup.close()
    for line in maintenance:
        print(line, file=sys.stderr)  # noqa: T201
    if closed:
        print(  # noqa: T201
            f"closed {closed} execution(s) left open by a previous process", file=sys.stderr
        )
    server = PlatformHTTPServer(
        ("127.0.0.1", port), Handler, development_origin=development_origin, adopted=adopted
    )
    threading.Thread(target=watchers.WATCHERS.run, daemon=True).start()
    # Handler reads only this immutable startup capture. The mutable dist tree
    # can be rebuilt for the next process without changing this listener.
    server.runtime_snapshot = runtime_snapshot
    print(  # noqa: T201
        f"Valkama on http://127.0.0.1:{server.server_port}/", file=sys.stderr
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()
