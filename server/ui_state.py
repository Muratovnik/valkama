"""The envelope a Kernel-shaped read answers in, and the refusal that renders as one.

`valkama-ui-state` wraps what the web app shell and Planning's exact-scope
reads return: a status, and either the payload or the reason it is missing. A
refusal raised below the surface carries the status code and the state it
renders as, and `error_response` turns it -- or any other failure -- into that
envelope.

It is a leaf on purpose. The app shell, Planning's routing, the module gate and
the extension registry all raise and render it, and none of them may need
another of them to do so.
"""

from __future__ import annotations

UI_STATE_INTERFACE = "valkama-ui-state"


class PlatformHttpError(ValueError):
    def __init__(self, status: int, state: str, reason: str):
        self.status = status
        self.state = state
        self.reason = reason
        super().__init__(reason)


def envelope(status: str, **fields) -> dict:
    return {"interface_version": UI_STATE_INTERFACE, "status": status, **fields}


def error_response(error: Exception) -> tuple[int, dict]:
    """A refusal as itself, a malformed request as 400, anything else as 500."""

    if isinstance(error, PlatformHttpError):
        return error.status, envelope(error.state, reason=error.reason)
    if isinstance(error, (TypeError, ValueError)):
        return 400, envelope("error", reason="Platform request is invalid")
    return 500, envelope("error", reason="Platform operation failed")
