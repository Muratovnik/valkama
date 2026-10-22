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
import sqlite3
import sys
import threading
import time
from collections.abc import Callable, Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import NamedTuple
from urllib.parse import parse_qs, urlparse

from . import http_security, runner, static_assets, watchers
from .executions import api as execution_api
from .executions import lifecycle as execution_lifecycle
from .executions import service as execution_service
from .federation import federated_search, federated_spaces
from .memory import api as memory_api
from .ops import doctor
from .planning import api as planning_api
from .planning import model as planning_model
from .planning import service as planning_service
from .planning import views as planning_views
from .platform import core as platform_core
from .platform.contracts import ContractError
from .projects import scopes
from .refs import resolve_ref
from .sessions import op_ingest_session_event, session_context
from .static_assets import DIST_DIR, SOURCE_ROOT
from .store import connect, db_path

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
}

#: The Kernel route that reads one work item plus the relations attached to it.
#: Named because three places have to agree on it: the module gate, the GET
#: dispatch, and `platform.core`, which has always accepted it.
PLANNING_WORK_ITEM_PATH = "/api/modules/planning/work-item"

#: The Kernel's own write routes, named once because two places need the same
#: list: the framing limit `do_POST` picks before reading a body, and the
#: dispatch row that answers them.
_PLATFORM_WRITE_PATHS = frozenset(
    {
        "/api/modules/state",
        "/api/platform/relations",
        "/api/platform/actions/invoke",
        "/api/platform/ui-prefs",
        "/api/platform/assignments/activation",
        "/api/platform/assignments/selection",
        "/api/platform/grants/revoke",
    }
)

_HTTP_ROUTE_MODULES = {
    # The neutral boundary. Its paths are declared here rather than derived, so
    # the module gate refuses one nobody wrote down.
    **{("GET", path): "planning" for path in planning_api.READ_PATHS},
    **{("POST", path): "planning" for path in planning_api.WRITE_PATHS},
    ("GET", "/api/search"): "planning",
    ("GET", "/api/scopes"): "planning",
    # The installation's own health belongs to the module that shows the
    # registry: Settings is where an operator already goes to see what is
    # connected and why something is not.
    ("GET", "/api/doctor"): "settings",
    ("GET", "/api/session"): "planning",
    ("POST", "/api/ingest"): "planning",
    # Planning owns attempts and their essential session lifecycle.
    ("POST", "/api/execution/launch"): "planning",
    ("POST", "/api/execution/stop"): "planning",
    **{("GET", path): "planning" for path in execution_api.READ_PATHS},
    # Knowledge belongs to Memory wherever it is read from. The work item
    # inspector shows some of it, but the module that owns a capability is the
    # module that gates it: disabling Memory has to take the knowledge out of
    # the inspector too, or "disabled" means one thing on its own page and
    # another everywhere else.
    **{("GET", path): "memory" for path in memory_api.READ_PATHS},
    **{("POST", path): "planning" for path in execution_api.WRITE_PATHS},
    # One work item and the Kernel relations attached to it. Planning's own
    # loader supplies the record and the Kernel owns the scope, the binding and
    # the relation read, so the route is the Kernel's and the module is
    # Planning's.
    ("GET", PLANNING_WORK_ITEM_PATH): "planning",
}
_SSE_VIEW_MODULES = {
    "planning": "planning",
    "spaces": "planning",
    "activity": "planning",
}


def _sse_view_owner(view: str) -> str:
    """The one module that owns an event-stream view, or a refusal."""

    owner = _SSE_VIEW_MODULES.get(view)
    if owner is None:
        raise platform_core.PlatformHttpError(400, "error", f"Unknown event stream view: {view}")
    return owner


def _http_module_owner(
    method: str, path: str, parameters: Mapping[str, list[str]] | None = None
) -> str | None:
    if method == "GET" and path == "/api/events":
        return _sse_view_owner(_first_value(parameters or {}, "view") or "planning")
    return _HTTP_ROUTE_MODULES.get((method, path))


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
#
# The module gate is deliberately *not* a row. `_module_gate` runs exactly once
# per request in `do_GET`, `do_POST` and `do_PUT`, before any row is looked up,
# and `_HTTP_ROUTE_MODULES` / `_http_module_owner` is the single place a path
# names its owning module. Skills and Improvements used to re-run
# `require_module_enabled` inside their own handlers on a second connection;
# because the gate had already refused a disabled module, that second check
# could only ever disagree with the first — a gate one future path would get on
# one side only. A boundary that needs gating declares its path in
# `_HTTP_ROUTE_MODULES` and nowhere else.


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
_PLAIN_NOT_FOUND: _Answer = _Raw(404, b"not found", "text/plain")


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
    #: The answer when the handler says the path is not its own.
    missing: _Answer = _NOT_FOUND
    notify: _Notify | None = None


#: Only an extensionless canonical Platform route shape receives `index.html`.
#: Which shapes those are is the Kernel's word; whether a path that matches one
#: gets the shell is this surface's, which is why the decision lives here and
#: the pattern reads like the routes above it.
_SPA_ROUTE = re.compile(r"^/modules/[a-z][a-z0-9-]{0,63}/(?:global|project/[a-z][a-z0-9-]{0,159})$")


def _is_spa_route(path: str) -> bool:
    return isinstance(path, str) and _SPA_ROUTE.fullmatch(path) is not None


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
        platform = platform_core.Platform(call.store(), db_path())
        return 200, platform.planning_read_model(
            call.parameters,
            lambda conn, key: planning_views.planning_payload(conn, space=key),
        )
    return planning_api.handle_get(call.store(), call.path, call.parameters)


def _planning_read_error(error: Exception) -> _Answer:
    if isinstance(error, (platform_core.PlatformHttpError, ContractError)):
        return platform_core.error_response(error)
    return planning_api.error_response(error)


def _memory_read(call: _Call) -> _Answer | None:
    return memory_api.handle_get(call.store(), call.path, call.parameters)


def _execution_read(call: _Call) -> _Answer | None:
    return execution_api.handle_get(call.store(), call.path, call.parameters)


def _platform_read(call: _Call) -> _Answer | None:
    return platform_core.handle_get(
        call.store(),
        db_path(),
        call.path,
        call.parameters,
        item_loader=planning_service.get_work_item,
    )


def _execution_write(call: _Call) -> _Answer | None:
    return execution_api.handle_post(call.store(), call.path, call.payload)


def _planning_write(call: _Call) -> _Answer | None:
    return planning_api.handle_post(call.store(), call.path, call.payload)


def _platform_write(call: _Call) -> _Answer | None:
    return platform_core.handle_post(call.store(), db_path(), call.path, call.payload)


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


def _platform_write_error(error: Exception) -> _Answer:
    response = platform_core.error_response(error)
    # A Kernel 500 says only that; whatever produced it stays in the process.
    return _generic_failure(500) if response[0] == 500 else response


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
    _Boundary(
        exact=frozenset({"/api/modules", PLANNING_WORK_ITEM_PATH}),
        prefix="/api/platform/",
        handler=_platform_read,
        errors=platform_core.error_response,
        commit=_Commit.READ_ONLY,
        missing=_PLAIN_NOT_FOUND,
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
        exact=_PLATFORM_WRITE_PATHS,
        handler=_platform_write,
        errors=_platform_write_error,
        commit=_Commit.DOMAIN,
        notify=_Notify(frozenset({"/api/platform/relations"})),
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

    def __init__(
        self,
        server_address: tuple[str, int],
        request_handler: type[BaseHTTPRequestHandler],
        *,
        token_path: Path = http_security.INSTALLATION_TOKEN_PATH,
        development_origin: str | None = None,
    ) -> None:
        if server_address[0] != "127.0.0.1":
            raise ValueError("Valkama HTTP must bind exactly 127.0.0.1")
        super().__init__(server_address, request_handler)
        try:
            self.security_context = http_security.SecurityContext.create(
                self.server_port,
                token_path=token_path,
                development_origin=development_origin,
            )
        except Exception:
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

    def _module_gate(
        self, method: str, path: str, parameters: Mapping[str, list[str]] | None = None
    ) -> bool:
        try:
            module_id = _http_module_owner(method, path, parameters)
            if module_id is None:
                return True
            conn = connect()
            try:
                platform_core.require_module_enabled(conn, module_id)
                return True
            finally:
                conn.close()
        except Exception as error:
            response = platform_core.error_response(error)
            if method in {"POST", "PUT"} and response[0] == 500:
                self._send_generic_failure(500)
            else:
                self._send_json(*response)
            return False

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

        The module gate has already run for this request; a row never gates
        again.
        """

        conn = None if boundary.commit is _Commit.NO_STORE else connect()
        try:
            call = _Call(
                conn, path, query, parameters or {}, payload if payload is not None else {}
            )
            try:
                answer = boundary.handler(call)
                if answer is None:
                    self._answer(boundary.missing)
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

    def _send_asset(self, relative: str) -> None:
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
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(extension, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        if policy is not None:
            self.send_header("Cache-Control", str(policy["cache_control"]))
            self.send_header("ETag", str(policy["etag"]))
        self.end_headers()
        self.wfile.write(body)

    def _send_index(self) -> None:
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
        self._send_asset("index.html")

    def do_GET(self) -> None:
        url = urlparse(self.path)
        if not self._require_validated_host():
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
        if not self._module_gate("GET", url.path, parameters):
            return
        boundary = _boundary(_GET_BOUNDARIES, url.path)
        if boundary is not None:
            self._dispatch(boundary, url.path, query=url.query, parameters=parameters)
            return
        if url.path in ("/", "/index.html") or _is_spa_route(url.path):
            self._send_index()
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
            try:
                body = json.dumps(federated_spaces(), ensure_ascii=False)
                self._send(200, body.encode("utf-8"), "application/json")
            except scopes.ScopeError as error:
                self._send(400, str(error).encode("utf-8"), "text/plain")
        elif url.path == "/api/search":
            parameters = parse_qs(url.query)
            text = _first_value(parameters, "q") or ""
            if (_first_value(parameters, "scope") or "") == "all":
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
                conn = connect()
                try:
                    # Keep the same connection-aware resolver used by MCP and
                    # retain its bounded Claude transcript fallback.
                    answer = resolve_ref(kind, value, conn=conn)
                finally:
                    conn.close()
                body = json.dumps(answer, ensure_ascii=False)
                self._send(200, body.encode("utf-8"), "application/json")
            except ValueError as error:
                self._send(400, str(error).encode("utf-8"), "text/plain")
        elif url.path == "/api/session":
            parameters = parse_qs(url.query)
            session_id = _first_value(parameters, "id") or ""
            conn = connect()
            try:
                body = json.dumps(session_context(conn, session_id), ensure_ascii=False)
                self._send(200, body.encode("utf-8"), "application/json")
            except (ValueError, TypeError) as error:
                self._send(404, str(error).encode("utf-8"), "text/plain")
            finally:
                conn.close()
        elif url.path == "/api/events":
            parameters = parse_qs(url.query)
            view = (parameters.get("view") or ["planning"])[0]
            self._stream_events(
                _first_value(parameters, "space"),
                view=view,
            )
        else:
            self._send(404, b"not found", "text/plain")

    def _stream_events(
        self,
        board: str | None,
        view: str = "planning",
    ) -> None:
        """Push one live read model on every database change; clients never poll."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        stream = watchers.WATCHERS.subscribe()
        conn = connect()
        frames = EventFrames()
        owner = _sse_view_owner(view)

        def push() -> None:
            platform_core.require_module_enabled(conn, owner)
            current: object
            if view == "activity":
                current = planning_views.activity_feed(conn)
            elif view == "spaces":
                current = {"planning_spaces": planning_service.list_planning_spaces(conn)}
            else:
                current = planning_views.planning_payload(conn, space=board)
            frame = frames.frame(json.dumps(current, ensure_ascii=False))
            if frame is not None:
                self.wfile.write(frame)
                self.wfile.flush()

        try:
            push()  # the current board first, so the client never renders empty
            while True:
                try:
                    stream.get(timeout=0.4)
                    push()
                except queue.Empty:
                    platform_core.require_module_enabled(conn, owner)
                    # A comment frame keeps the connection from idling out and
                    # tells us at once when the browser has gone away.
                    platform_core.require_module_enabled(conn, owner)
                    self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
        except platform_core.PlatformHttpError:
            # Authority changed after the stream opened.  The response already
            # advertised keep-alive, so explicitly close it without another frame.
            self.close_connection = True
        except CLIENT_DISCONNECT_ERRORS:
            pass  # the page was closed or the board vanished; nothing to report
        finally:
            watchers.WATCHERS.unsubscribe(stream)
            conn.close()

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
        if not self._module_gate("POST", path):
            return
        boundary = _boundary(_POST_BOUNDARIES, path)
        if boundary is not None:
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
        if not self._module_gate("PUT", path):
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


def serve_main(port: int, *, development_origin: str | None = None) -> None:
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
    finally:
        startup.close()
    if closed:
        print(  # noqa: T201
            f"closed {closed} execution(s) left open by a previous process", file=sys.stderr
        )
    server = PlatformHTTPServer(("127.0.0.1", port), Handler, development_origin=development_origin)
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
