"""The answer to Claude Code's `MessageDisplay` hook: real work item numbers as links.

An agent writes a plain number and spends no output tokens on the address; the client
asks this module what to show in its place, and the transcript and the model keep
the original. Under the last batch of a message from a session's own conversation it
also shows the work items that conversation wrote to since the last such list
(`display_writes`). Every answer is either a replacement for this batch's text or
nothing at all, and nothing shows the batch as it was. So any doubt answers nothing:

- a batch of a message whose earlier batches this process did not see, because it
  restarted, the message was pushed out of the bound below or a call never arrived,
  stays as it was, and so does the rest of that message, since whether it starts
  inside a code block cannot be known;
- a message that ends inside a fenced code block gets no list, which then comes with
  the next message;
- a batch that is not the last and has no candidate costs no store access at all,
  and the candidates of a batch are read together.

The message text is never logged, kept or written anywhere. Between batches a message
leaves only `mentions.ScanState`, which holds counters.
"""

from __future__ import annotations

import sqlite3
import threading
from collections import OrderedDict
from collections.abc import Callable, Mapping

from . import display_writes
from .acknowledgements import work_item_url
from .interactions import existing_references
from .mentions import ScanState, scan, with_links

#: Where the listener answers the hook. Host Runtime registers this path, on the port
#: `valkama capabilities` names, so moving it is a change to that public contract.
HOOK_PATH = "/api/hooks/message-display"
#: The message of a client that can no longer finish it stays until pushed out by
#: newer ones, so this bounds what a crashed session can leave behind.
MAX_OPEN_MESSAGES = 256
#: A batch holding more distinct candidates than this is not a reply to link.
MAX_CANDIDATES = 1000
_MAX_MESSAGE_ID = 128
#: As long as a session id a planning call may carry.
_MAX_SESSION_ID = 200


class OpenMessages:
    """The scan state of each message still arriving, oldest first, safe across threads."""

    def __init__(self, limit: int = MAX_OPEN_MESSAGES) -> None:
        self._limit = limit
        self._lock = threading.Lock()
        self._states: OrderedDict[str, ScanState] = OrderedDict()

    def take(self, message_id: str, index: int) -> ScanState | None:
        """The state to scan batch *index* with, or None when an earlier batch went unseen."""

        with self._lock:
            state = self._states.pop(message_id, None)
        if index == 0:
            return ScanState()
        return state if state is not None and state.next_index == index else None

    def keep(self, message_id: str, state: ScanState) -> None:
        with self._lock:
            self._states[message_id] = state
            while len(self._states) > self._limit:
                self._states.popitem(last=False)

    def __len__(self) -> int:
        return len(self._states)


OPEN_MESSAGES = OpenMessages()


def _batch(payload: Mapping[str, object]) -> tuple[str, str, int, bool] | None:
    """The hook's own fields, or None when this is not a batch to act on."""

    message_id = payload.get("message_id")
    delta = payload.get("delta")
    index = payload.get("index")
    final = payload.get("final")
    if (
        payload.get("hook_event_name") != "MessageDisplay"
        or not isinstance(message_id, str)
        or not 0 < len(message_id) <= _MAX_MESSAGE_ID
        or not isinstance(delta, str)
        or not isinstance(index, int)
        or isinstance(index, bool)
        or index < 0
        or not isinstance(final, bool)
    ):
        return None
    return message_id, delta, index, final


def _orchestrator(payload: Mapping[str, object]) -> str | None:
    """The session whose own conversation wrote this message, or None for a subagent's."""

    session_id = payload.get("session_id")
    if payload.get("agent_id") is not None or not isinstance(session_id, str):
        return None
    return session_id if 0 < len(session_id) <= _MAX_SESSION_ID else None


def _under(text: str, footer: str) -> str:
    """*footer* after *text*, past a blank line so its rule cannot underline a heading.

    An empty last batch follows whole lines the client already showed.
    """

    if text.endswith("\n\n"):
        return text + footer
    return text + ("\n" if not text or text.endswith("\n") else "\n\n") + footer


def answer(
    payload: Mapping[str, object],
    open_store: Callable[[], sqlite3.Connection],
    primary_db: str,
    *,
    messages: OpenMessages = OPEN_MESSAGES,
    shown: display_writes.ShownCalls | None = None,
) -> dict[str, object]:
    """What the hook answers: the linked text and the list, or `{}` to show the batch as it was."""

    batch = _batch(payload)
    if batch is None:
        return {}
    message_id, delta, index, final = batch
    state = messages.take(message_id, index)
    if state is None:
        return {}
    found = scan(delta, state, final=final)
    if not final:
        state.next_index = index + 1
        messages.keep(message_id, state)
    candidates = {mention.reference for mention in found}
    if len(candidates) > MAX_CANDIDATES:
        candidates = set()
    # Inside an open fence the list would read as code, and a broken scan cannot say.
    ended = final and not state.broken and not state.fence_length
    session_id = _orchestrator(payload) if ended else None
    if not candidates and session_id is None:
        return {}
    shown = shown if shown is not None else display_writes.SHOWN
    store = open_store()
    try:
        real = existing_references(store, primary_db, candidates) if candidates else set()
        listing = (
            display_writes.listing(store, session_id, shown.since(session_id))
            if session_id is not None
            else None
        )
    finally:
        store.close()
    text = (
        with_links(delta, found, {reference: work_item_url(reference) for reference in real})
        if real
        else delta
    )
    if session_id is not None and listing is not None:
        shown.keep(session_id, listing.newest)
        if listing.text:
            text = _under(text, listing.text)
    if not real and (listing is None or not listing.text):
        return {}
    return {"hookSpecificOutput": {"hookEventName": "MessageDisplay", "displayContent": text}}
