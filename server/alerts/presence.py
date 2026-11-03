"""Which pages of Valkama are in focus, and what they show.

The process about to alert asks the listener whether the owner is already looking
at the item, because an alert for what is on screen is noise. Each page reports
itself every few seconds and on every change, and a report lives for 30 seconds,
so a page that closed without a word stops counting by itself.

This stays in memory. A row in the store would move `PRAGMA data_version` on every
report and wake every event stream for nothing, and a listener that restarts loses
nothing a page does not say again within seconds.

The singleton is read through this module, `presence.PRESENCE`, so a test that
swaps it reaches every reader.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass

#: How long a report counts without another one.
TTL = 30.0
_KEYS = frozenset({"page_id", "focused", "work_item_id", "hub_open"})
_ID_LIMIT = 128
#: More windows than a person has. Reports come from anything holding the browser's
#: credential, so what they can make this hold is bounded too.
_MOST_PAGES = 64


class PresenceError(ValueError):
    """A report this build does not accept, with the reason."""


@dataclass(frozen=True)
class _Page:
    focused: bool
    work_item_id: str | None
    hub_open: bool
    until: float


def _flag(payload: Mapping[str, object], name: str) -> bool:
    value = payload[name]
    if not isinstance(value, bool):
        raise PresenceError(f"{name} must be true or false")
    return value


def _identifier(value: object, name: str) -> str:
    if not isinstance(value, str) or not 0 < len(value) <= _ID_LIMIT:
        raise PresenceError(f"{name} must be a string of 1 to {_ID_LIMIT} characters")
    return value


class Presence:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._pages: dict[str, _Page] = {}

    def report(self, payload: Mapping[str, object]) -> None:
        """Take one page's report: `{page_id, focused, work_item_id or null, hub_open}`."""

        if set(payload) != _KEYS:
            raise PresenceError(f"a presence report has exactly: {', '.join(sorted(_KEYS))}")
        page_id = _identifier(payload["page_id"], "page_id")
        shown = payload["work_item_id"]
        page = _Page(
            focused=_flag(payload, "focused"),
            work_item_id=None if shown is None else _identifier(shown, "work_item_id"),
            hub_open=_flag(payload, "hub_open"),
            until=self._clock() + TTL,
        )
        with self._lock:
            self._pages.pop(page_id, None)
            self._pages[page_id] = page
            self._forget()

    def visible(self, work_item_id: str, *, hub: bool = False) -> bool:
        """Whether a page in focus shows this card, or with `hub` the panel of questions."""

        now = self._clock()
        with self._lock:
            pages = list(self._pages.values())
        return any(
            page.focused
            and now < page.until
            and (page.work_item_id == work_item_id or (hub and page.hub_open))
            for page in pages
        )

    def _forget(self) -> None:
        now = self._clock()
        self._pages = {key: page for key, page in self._pages.items() if now < page.until}
        while len(self._pages) > _MOST_PAGES:
            del self._pages[next(iter(self._pages))]


PRESENCE = Presence()
