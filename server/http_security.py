"""Loopback HTTP authority, credentials, and bounded JSON framing.

This module owns the complete pre-dispatch security boundary for the browser
surface.  Domain code never sees a request until these checks have succeeded.
"""

from __future__ import annotations

import hmac
import json
import os
import re
import secrets
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

INSTALLATION_TOKEN_PATH = Path.home() / ".valkama" / "installation-token"
GLOBAL_JSON_LIMIT = 1_048_576
_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{64}")


class Headers(Protocol):
    def get_all(self, name: str, _failobj: list[str], /) -> list[str]: ...


class ByteStream(Protocol):
    def read(self, size: int, /) -> bytes: ...


class Connection(Protocol):
    def gettimeout(self) -> float | None: ...

    def settimeout(self, value: float | None) -> None: ...


class RequestRefusedError(Exception):
    """A bounded public refusal raised before application dispatch."""

    def __init__(self, status: int, code: str, message: str, *, close: bool = False) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.close = close


def _header_values(headers: Headers, name: str) -> list[str]:
    return list(headers.get_all(name, []) or [])


def _valid_token(value: str) -> bool:
    return _TOKEN_PATTERN.fullmatch(value) is not None


def _restrict(path: Path, mode: int) -> None:
    try:
        os.chmod(path, mode)
    except OSError:
        # Windows supports only its stdlib read-only bit here.  Native ACLs are
        # intentionally outside this stdlib-only server's threat boundary.
        pass


def load_installation_token(token_path: Path = INSTALLATION_TOKEN_PATH) -> str:
    """Read or atomically create the fixed installation bearer token."""

    path = Path(token_path)
    try:
        value = path.read_text(encoding="ascii").strip()
    except FileNotFoundError:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        _restrict(path.parent, stat.S_IRWXU)
        value = secrets.token_urlsafe(48)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=".installation-token-", dir=path.parent
        )
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "w", encoding="ascii", newline="\n") as handle:
                handle.write(value + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            _restrict(temporary, stat.S_IRUSR | stat.S_IWUSR)
            try:
                os.link(temporary, path)
            except FileExistsError:
                value = path.read_text(encoding="ascii").strip()
        finally:
            temporary.unlink(missing_ok=True)
    except OSError as error:
        raise RuntimeError(f"installation token is unavailable at {path}") from error
    if not _valid_token(value):
        raise RuntimeError(f"installation token is invalid at {path}")
    _restrict(path, stat.S_IRUSR | stat.S_IWUSR)
    return value


@dataclass(frozen=True)
class SecurityContext:
    authority: str
    allowed_origins: frozenset[str]
    installation_token: str
    browser_session_token: str

    @classmethod
    def create(
        cls,
        port: int,
        *,
        token_path: Path = INSTALLATION_TOKEN_PATH,
        development_origin: str | None = None,
    ) -> SecurityContext:
        authority = f"127.0.0.1:{port}"
        production_origin = f"http://{authority}"
        origins = {production_origin}
        if development_origin is not None:
            if development_origin != "http://127.0.0.1:5173":
                raise ValueError("development origin must be http://127.0.0.1:5173")
            origins.add(development_origin)
        return cls(
            authority=authority,
            allowed_origins=frozenset(origins),
            installation_token=load_installation_token(Path(token_path)),
            browser_session_token=secrets.token_urlsafe(48),
        )


def require_host(headers: Headers, context: SecurityContext) -> None:
    values = _header_values(headers, "Host")
    if len(values) != 1 or values[0] != context.authority:
        raise RequestRefusedError(
            400,
            "invalid_host",
            "request Host is not the bound loopback authority",
            close=True,
        )


def _require_browser_fetch(headers: Headers, *, close: bool = False) -> None:
    """Refuse a request that does not carry the fetch metadata a browser sets itself.

    A browser adds `Sec-Fetch-Site` to every request it makes to a potentially
    trustworthy origin, which 127.0.0.1 is, and a page script cannot set or
    change it. `same-origin` is what the web client's own fetches carry, in a
    browser tab and in the desktop app alike. An HTTP client a local process
    runs -- curl, a script -- sends none unless it forges one on purpose, and a
    process that does that could edit the store file directly; that is outside
    what this boundary can tell apart. `Sec-Fetch-Mode` and `Sec-Fetch-Dest`
    are not checked: a process that forges one header forges all of them, and
    against another site in the browser `Sec-Fetch-Site` already decides.
    """

    values = _header_values(headers, "Sec-Fetch-Site")
    if len(values) != 1 or values[0] != "same-origin":
        raise RequestRefusedError(
            403,
            "fetch_metadata_refused",
            "browser credentials are given only to a same-origin browser fetch",
            close=close,
        )


def is_person_navigation(headers: Headers) -> bool:
    """Whether this is a top-level navigation started outside any page.

    A link clicked in another application, an address typed or a bookmark arrives as
    `none`, `document`, `navigate`, and no page can produce `none`: whatever a page
    loads, frames or opens carries that page's own site. All three are read here,
    unlike in `_require_browser_fetch`, because what is decided is not whom to answer
    but whether something happens on the owner's screen, and a request a browser sends
    for any other reason must not get that far. A local process can forge them, and
    could start the same application itself. A redirect keeps the values, so another
    site's address opened from outside the browser can send its navigation here: the
    most that site gets is the app on a card it names, with nothing written.

    `Sec-Purpose` and the older `Purpose` mark a request nobody has navigated yet: a
    browser prerenders an address being typed with exactly these three values.
    """

    expected = (
        ("Sec-Fetch-Site", "none"),
        ("Sec-Fetch-Dest", "document"),
        ("Sec-Fetch-Mode", "navigate"),
    )
    if any(_header_values(headers, name) != [value] for name, value in expected):
        return False
    return not (_header_values(headers, "Sec-Purpose") or _header_values(headers, "Purpose"))


def require_same_origin_fetch(headers: Headers, context: SecurityContext) -> None:
    """Only the web client's own same-origin fetch gets the session token or a project's files.

    A same-origin GET carries no `Origin`, so an absent one is allowed; one
    that is present must be an allowed origin.
    """

    values = _header_values(headers, "Origin")
    if values and (len(values) != 1 or values[0] not in context.allowed_origins):
        raise RequestRefusedError(403, "origin_refused", "request Origin is not allowed")
    _require_browser_fetch(headers)


def require_local_process(headers: Headers) -> None:
    """Admit a local process that is not a browser, for a route that writes nothing.

    A browser puts `Origin` on every POST, whatever the page does, and `Sec-Fetch-Site`
    on every request to 127.0.0.1, so a page of any site is refused here before its
    body is read. It could not read the answer anyway, since nothing here answers with
    CORS headers, and a preflight is refused. No credential is asked: a hook could carry
    one only by keeping it in the client's settings file, and a process running as the
    owner can read the store itself, which is the boundary `_require_browser_fetch`
    states too.
    """

    if _header_values(headers, "Origin") or _header_values(headers, "Sec-Fetch-Site"):
        raise RequestRefusedError(
            403, "origin_refused", "this route answers only a local process", close=True
        )


def _exact_secret(headers: Headers, name: str, expected: str) -> bool:
    values = _header_values(headers, name)
    return len(values) == 1 and hmac.compare_digest(values[0], expected)


def require_write_authorization(
    headers: Headers, context: SecurityContext, *, adapter_endpoint: bool
) -> None:
    origins = _header_values(headers, "Origin")
    if adapter_endpoint:
        if origins:
            raise RequestRefusedError(
                403, "origin_refused", "adapter requests must be originless", close=True
            )
        if _header_values(headers, "X-Valkama-Session"):
            raise RequestRefusedError(
                401, "invalid_credentials", "adapter credentials are required", close=True
            )
        authorization = _header_values(headers, "Authorization")
        if len(authorization) != 1 or not authorization[0].startswith("Bearer "):
            raise RequestRefusedError(
                401, "authentication_required", "adapter credentials are required", close=True
            )
        supplied = authorization[0][len("Bearer ") :]
        if not hmac.compare_digest(supplied, context.installation_token):
            raise RequestRefusedError(
                401, "invalid_credentials", "adapter credentials are invalid", close=True
            )
        return

    if len(origins) != 1 or origins[0] not in context.allowed_origins:
        raise RequestRefusedError(
            403, "origin_refused", "request Origin is not allowed", close=True
        )
    _require_browser_fetch(headers, close=True)
    if _header_values(headers, "Authorization"):
        raise RequestRefusedError(
            401, "invalid_credentials", "browser credentials are required", close=True
        )
    if not _exact_secret(headers, "X-Valkama-Session", context.browser_session_token):
        raise RequestRefusedError(
            401, "authentication_required", "browser credentials are required", close=True
        )


def drain_rejected_body(headers: Headers, stream: ByteStream, connection: Connection) -> None:
    """Bound transport cleanup so a close does not erase the refusal response.

    Windows resets a TCP connection closed with unread inbound bytes.  A reset
    can race the already-written HTTP response, so rejected requests discard at
    most one globally bounded body with a short deadline before closing.  This
    is deliberately not JSON parsing and can never reach application dispatch.
    """

    lengths = _header_values(headers, "Content-Length")
    remaining = GLOBAL_JSON_LIMIT + 1
    if len(lengths) == 1 and lengths[0].isascii() and lengths[0].isdigit():
        if len(lengths[0]) <= 20:
            remaining = min(int(lengths[0], 10), remaining)
    if remaining == 0:
        return

    previous_timeout = connection.gettimeout()
    connection.settimeout(0.05)
    read_once = getattr(stream, "read1", stream.read)
    try:
        while remaining:
            chunk = read_once(min(remaining, 65_536))
            if not chunk:
                break
            remaining -= len(chunk)
    except (OSError, TimeoutError):
        pass
    finally:
        connection.settimeout(previous_timeout)


def _require_json_content_type(headers: Headers) -> None:
    values = _header_values(headers, "Content-Type")
    if len(values) != 1:
        raise RequestRefusedError(
            415, "unsupported_media_type", "Content-Type must be application/json", close=True
        )
    parts = [part.strip() for part in values[0].split(";")]
    if not parts or parts[0].casefold() != "application/json":
        raise RequestRefusedError(
            415, "unsupported_media_type", "Content-Type must be application/json", close=True
        )
    if len(parts) > 2:
        raise RequestRefusedError(
            415, "unsupported_media_type", "JSON accepts one UTF-8 charset parameter", close=True
        )
    for parameter in parts[1:]:
        if "=" not in parameter:
            raise RequestRefusedError(
                415, "unsupported_media_type", "JSON parameters must declare UTF-8", close=True
            )
        name, value = (item.strip() for item in parameter.split("=", 1))
        if name.casefold() != "charset" or value.strip('"').casefold() not in {"utf-8", "utf8"}:
            raise RequestRefusedError(
                415, "unsupported_media_type", "JSON parameters must declare UTF-8", close=True
            )


def _framed_length(headers: Headers, limit: int) -> int:
    """The length of one unambiguous HTTP/1 body frame, refused past `limit`."""

    if _header_values(headers, "Transfer-Encoding"):
        raise RequestRefusedError(
            400, "invalid_framing", "Transfer-Encoding is not accepted", close=True
        )
    lengths = _header_values(headers, "Content-Length")
    if not lengths:
        raise RequestRefusedError(411, "length_required", "Content-Length is required", close=True)
    if len(lengths) != 1:
        raise RequestRefusedError(
            400, "invalid_framing", "Content-Length must appear exactly once", close=True
        )
    if not lengths[0].isascii() or not lengths[0].isdigit():
        raise RequestRefusedError(
            400, "invalid_framing", "Content-Length must be a non-negative integer", close=True
        )
    if len(lengths[0]) > 20:
        raise RequestRefusedError(413, "request_too_large", "request body is too large", close=True)
    length = int(lengths[0], 10)
    if length > limit:
        raise RequestRefusedError(413, "request_too_large", "request body is too large", close=True)
    return length


def _read_exactly(stream: ByteStream, length: int) -> bytes:
    body = stream.read(length)
    if len(body) != length:
        raise RequestRefusedError(400, "truncated_body", "request body is truncated", close=True)
    return body


def read_bytes(headers: Headers, stream: ByteStream, *, max_bytes: int) -> bytes:
    """One bounded body as it was sent, framed as strictly as a JSON one.

    What the bytes are is the caller's to decide from the bytes: the declared
    type says nothing a sender could not have chosen.
    """

    return _read_exactly(stream, _framed_length(headers, max_bytes))


def read_json_object(headers: Headers, stream: ByteStream, *, max_bytes: int) -> dict:
    """Parse one bounded JSON object from an unambiguous HTTP/1 body frame."""

    length = _framed_length(headers, min(GLOBAL_JSON_LIMIT, max_bytes))
    _require_json_content_type(headers)
    body = _read_exactly(stream, length)
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RequestRefusedError(
            400, "malformed_json", "request body must be a JSON object", close=True
        ) from error
    if not isinstance(payload, dict):
        raise RequestRefusedError(
            400, "malformed_json", "request body must be a JSON object", close=True
        )
    return payload
