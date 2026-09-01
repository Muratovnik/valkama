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

INTERFACE_VERSION = "kernel-security-2026-08-20"
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


def require_bootstrap_origin(headers: Headers, context: SecurityContext) -> None:
    values = _header_values(headers, "Origin")
    if not values:
        return
    if len(values) != 1 or values[0] not in context.allowed_origins:
        raise RequestRefusedError(403, "origin_refused", "request Origin is not allowed")


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


def read_json_object(headers: Headers, stream: ByteStream, *, max_bytes: int) -> dict:
    """Parse one bounded JSON object from an unambiguous HTTP/1 body frame."""

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
    limit = min(GLOBAL_JSON_LIMIT, max_bytes)
    if length > limit:
        raise RequestRefusedError(413, "request_too_large", "request body is too large", close=True)
    _require_json_content_type(headers)
    body = stream.read(length)
    if len(body) != length:
        raise RequestRefusedError(400, "truncated_body", "request body is truncated", close=True)
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
