"""The answer to Claude Code's `MessageDisplay` hook: real work item numbers as links.

An agent writes a plain number and spends no output tokens on the address; the client
asks this module what to show in its place, and the transcript and the model keep
the original. Every answer is either a replacement for this batch's text or nothing
at all, and nothing shows the batch as it was. So any doubt answers nothing:

- a batch of a message whose earlier batches this process did not see, because it
  restarted, the message was pushed out of the bound below or a call never arrived,
  stays as it was, and so does the rest of that message, since whether it starts
  inside a code block cannot be known;
- a text with no candidate costs no store access at all, and the candidates of a
  batch are read together.

The message text is never logged, kept or written anywhere. Between batches a message
leaves only `mentions.ScanState`, which holds counters.
"""

from __future__ import annotations

import sqlite3
import threading
from collections import OrderedDict
from collections.abc import Callable, Mapping

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


def answer(
    payload: Mapping[str, object],
    open_store: Callable[[], sqlite3.Connection],
    primary_db: str,
    *,
    messages: OpenMessages = OPEN_MESSAGES,
) -> dict[str, object]:
    """What the hook answers: the linked text, or `{}` to show the batch as it was."""

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
    if not candidates or len(candidates) > MAX_CANDIDATES:
        return {}
    store = open_store()
    try:
        real = existing_references(store, primary_db, candidates)
    finally:
        store.close()
    if not real:
        return {}
    return {
        "hookSpecificOutput": {
            "hookEventName": "MessageDisplay",
            "displayContent": with_links(
                delta, found, {reference: work_item_url(reference) for reference in real}
            ),
        }
    }
