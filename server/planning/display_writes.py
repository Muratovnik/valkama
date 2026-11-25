"""The list under an agent's reply of the work items its session wrote to.

An agent's reply rarely names every item it touched, and the reader cannot see its
tool calls. So under the last batch of a message `display_links` adds a short list,
read from the calls the store recorded: per item, its number as a link, its title
and what was done. Only the screen changes, so the list costs the model nothing.

Whose writes: the calls of the payload's session made by its own conversation,
`agent_id` NULL; what a subagent wrote is not listed. Since when: the newest call
the last list covered, kept here in memory per session, because the listener opens
the store read-only. With nothing kept (the session's first message, or a listener
that restarted) the list starts after the session's latest prompt, and with no
prompt either it lists nothing and starts from there.

An item has a line when one of those calls acted on it, the item its row names. A
link's other end, an item a comment mentions and the duplicates a merge closed carry
an event of the call too, but none of them is what the call was made for, so none
gets a line for it. What was done to an item with a line is read from the rows the
calls that acted on it wrote there, each pointing at its call through `call_id`; a
row another item's call left on it, such as the other end of that item's link, adds
nothing. It is said in whole phrases, a verb with what it acted on: a bare "comment"
or "steps" leaves the reader asking what happened to it. The steps, links and labels
an item is created with are part of "created", and the move a claim makes by
starting an item is part of "claimed". A call that left no such row, one that only
edited fields or attached refs, still says the item changed. A deleted
item is left out, and so is one whose row cannot be read; nothing is guessed. A
number is a link only where a mention of it would be: an item in a space no project
binds is named without one, because its address leads to no card.
"""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from collections import Counter, OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field

from ..hooks import notify
from .acknowledgements import work_item_url

#: Sessions whose place is kept; past this the oldest goes, so a session that ended
#: without a last message leaves a bounded trace. It then starts again from a prompt.
MAX_SESSIONS = 256
#: Items named one line each; one more line counts the rest.
MOST_LINES = 12

#: What was done, in the order the phrases stand on a line.
_ORDER = (
    "created",
    "claimed",
    "moved",
    "steps_changed",
    "steps_ticked",
    "steps_reopened",
    "comment",
    "resolved",
    "question",
    "summary",
    "links",
    "labels",
)
_DONE_BY_ACTION = {
    "created": "created",
    "claimed": "claimed",
    "taken_over": "claimed",
    "transitioned": "moved",
    "request_created": "question",
    "checklist_replaced": "steps_changed",
    "checklist_completed": "steps_ticked",
    "checklist_reopened": "steps_reopened",
    "comment_resolved": "resolved",
    "summarized": "summary",
    "linked": "links",
    "unlinked": "links",
    "labels_changed": "labels",
}
#: What the call that creates an item writes along with it: "created" covers these.
_WITH_CREATION = frozenset({"steps_changed", "links", "labels"})
#: `{state}` is the state the item is in now, `{count}` how many rows said so; the
#: counted phrases keep the number after a colon, which needs no plural form.
_WORDS = {
    "ru": {
        "created": "создана",
        "claimed": "взята в работу",
        "moved": "переведена в {state}",
        "steps_changed": "изменён список шагов",
        "steps_ticked": "отмечено шагов: {count}",
        "steps_reopened": "возвращено шагов: {count}",
        "comment": "добавлен комментарий",
        "resolved": "закрыто обсуждение",
        "question": "задан вопрос владельцу",
        "summary": "записан итог",
        "links": "изменены связи",
        "labels": "изменены метки",
        "changed": "изменена",
        "caption": "Записи в Valkama",
        "rest": "и ещё {count} {items}",
    },
    "en": {
        "created": "created",
        "claimed": "claimed",
        "moved": "moved to {state}",
        "steps_changed": "steps changed",
        "steps_ticked": "steps ticked: {count}",
        "steps_reopened": "steps reopened: {count}",
        "comment": "comment added",
        "resolved": "discussion resolved",
        "question": "question put to the owner",
        "summary": "summary written",
        "links": "links changed",
        "labels": "labels changed",
        "changed": "changed",
        "caption": "Written to Valkama",
        "rest": "and {count} more {items}",
    },
}
#: The noun the last line counts in: for one, for a few, for many.
_ITEM_FORMS = {"ru": ("задача", "задачи", "задач"), "en": ("item", "items", "items")}
#: Every ASCII punctuation character, each of which Markdown takes literally after a
#: backslash: a title may hold `[`, `*`, a backtick, `<`, `|` or a leading `#`.
_MARKDOWN = re.compile(r"[!-/:-@\[-`{-~]")

#: The session's rows are read through `execution_events_session`, an item's events
#: and comments through their item index, so no statement scans a table.
_LAST_PROMPT = (
    "SELECT id FROM execution_events WHERE session_id = ? AND kind = 'prompt'"
    " ORDER BY id DESC LIMIT 1"
)
_NEWEST = "SELECT id FROM execution_events WHERE session_id = ? ORDER BY id DESC LIMIT 1"
_CALLS = (
    "SELECT id, work_item_id FROM execution_events"
    " WHERE session_id = ? AND id > ? AND kind = 'planning_write' AND agent_id IS NULL"
    " ORDER BY id"
)
_ITEMS = (
    "SELECT w.work_item_id, p.key, w.number, w.title, s.name FROM work_items w"
    " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
    " JOIN workflow_states s ON s.state_id = w.state_id"
    " WHERE w.work_item_id IN (SELECT value FROM json_each(?))"
)
#: A question asked through a comment's list is the comment's, not one to the owner.
#: The move a claim makes, starting the item, records the claim as its reason.
_EVENTS = (
    "SELECT e.work_item_id, e.action, r.comment_id IS NULL, e.call_id,"
    " e.action = 'transitioned' AND e.detail LIKE '%: claimed' FROM work_item_events e"
    " LEFT JOIN work_item_requests r ON e.action = 'request_created' AND r.request_id = e.detail"
    " WHERE e.work_item_id IN (SELECT value FROM json_each(?))"
    " AND e.call_id IN (SELECT value FROM json_each(?))"
)
#: A comment holding a report is a summary, the current one or not.
_COMMENTS = (
    "SELECT work_item_id, report != '' FROM work_item_comments"
    " WHERE work_item_id IN (SELECT value FROM json_each(?))"
    " AND call_id IN (SELECT value FROM json_each(?))"
)


class ShownCalls:
    """The newest call each session's list covered, least recently kept first."""

    def __init__(self, limit: int = MAX_SESSIONS) -> None:
        self._limit = limit
        self._lock = threading.Lock()
        self._calls: OrderedDict[str, int] = OrderedDict()

    def since(self, session_id: str) -> int | None:
        with self._lock:
            return self._calls.get(session_id)

    def keep(self, session_id: str, call: int) -> None:
        with self._lock:
            self._calls[session_id] = call
            self._calls.move_to_end(session_id)
            while len(self._calls) > self._limit:
                self._calls.popitem(last=False)

    def __len__(self) -> int:
        return len(self._calls)


SHOWN = ShownCalls()


@dataclass(frozen=True)
class Listing:
    """The list to show, empty when there is nothing, and the call to keep once shown."""

    text: str
    newest: int


@dataclass
class _Item:
    reference: str
    title: str
    state: str
    #: What was done, and in how many rows.
    done: Counter[str] = field(default_factory=Counter)


def listing(
    conn: sqlite3.Connection,
    session_id: str,
    since: int | None,
    linkable: Callable[[set[str]], set[str]],
) -> Listing:
    """What *session_id*'s own calls after the call *since* wrote, and the newest of them.

    *linkable* answers which of the listed numbers lead to a card, as it does for a
    mention; the others are named without a link.
    """

    if since is None:
        prompt = conn.execute(_LAST_PROMPT, (session_id,)).fetchone()
        if prompt is None:
            newest = conn.execute(_NEWEST, (session_id,)).fetchone()
            return Listing("", int(newest[0]) if newest is not None else 0)
        since = int(prompt[0])
    written = conn.execute(_CALLS, (session_id, since)).fetchall()
    if not written:
        return Listing("", since)
    newest = int(written[-1][0])
    items = _items(conn, written)
    if not items:
        return Listing("", newest)
    return Listing(_render(items, notify.shown_language(conn), linkable), newest)


def _items(conn: sqlite3.Connection, written: list[sqlite3.Row]) -> list[_Item]:
    """Each item a call acted on that still exists, in the order the calls first did."""

    acted_on = list(dict.fromkeys(str(item) for _call, item in written if item is not None))
    if not acted_on:
        return []
    ids = json.dumps(acted_on)
    found = {
        str(row[0]): _Item(f"{row[1]}-{row[2]}", str(row[3]), str(row[4]))
        for row in conn.execute(_ITEMS, (ids,))
    }
    listed = json.dumps([int(row[0]) for row in written])
    acting = {(int(call), str(item)) for call, item in written}
    events = [
        (str(item), _DONE_BY_ACTION.get(str(action)), bool(asked), int(call), bool(by_claim))
        for item, action, asked, call, by_claim in conn.execute(_EVENTS, (ids, listed))
        if (int(call), str(item)) in acting
    ]
    creating = {(call, item) for item, done, _asked, call, _by_claim in events if done == "created"}
    claiming = {(call, item) for item, done, _asked, call, _by_claim in events if done == "claimed"}
    for item, done, asked, call, by_claim in events:
        entry = found.get(item)
        if entry is None or done is None or (done == "question" and not asked):
            continue
        if done in _WITH_CREATION and (call, item) in creating:
            continue
        if done == "moved" and by_claim and (call, item) in claiming:
            continue
        entry.done[done] += 1
    for item, report in conn.execute(_COMMENTS, (ids, listed)):
        entry = found.get(str(item))
        if entry is not None:
            entry.done["summary" if report else "comment"] += 1
    return [found[item] for item in acted_on if item in found]


def literal(text: str) -> str:
    """*text* on one line, cut as a title is, and shown by Markdown exactly as written."""

    one_line = notify.title_line(notify.printable(text))
    return _MARKDOWN.sub(lambda found: "\\" + found.group(), one_line)


def _render(items: list[_Item], language: str, linkable: Callable[[set[str]], set[str]]) -> str:
    """A rule, a caption, then a line per item: its number, its title, a dash and what was done.

    The caption says whose list this is: without it the list reads as the end of the
    agent's own text, most of all under a reply that closes with a list of items.
    Each thing done is a phrase of its own, and an item none of them fits is "changed".
    """

    language = language if language in _WORDS else "en"
    words = _WORDS[language]
    named = items[:MOST_LINES]
    linked = linkable({item.reference for item in named})
    lines = ["---", f"*{words['caption']}*", ""]
    for item in named:
        state = literal(item.state)
        said = [
            words[done].format(state=state, count=item.done[done])
            for done in _ORDER
            if done in item.done
        ] or [words["changed"]]
        number = item.reference
        if number in linked:
            number = f"[{number}]({work_item_url(number)})"
        lines.append(f"- {number} {notify.quote(literal(item.title))} — {', '.join(said)}")
    rest = len(items) - MOST_LINES
    if rest > 0:
        noun = _plural(_ITEM_FORMS[language], rest, language)
        lines.append("- " + words["rest"].format(count=rest, items=noun))
    return "\n".join(lines)


def _plural(forms: tuple[str, str, str], count: int, language: str) -> str:
    """The form *count* takes; Russian has one for 1, 21, 31, one for 2 to 4, 22 to 24."""

    if language != "ru":
        return forms[0] if count == 1 else forms[2]
    if count % 10 == 1 and count % 100 != 11:
        return forms[0]
    if 2 <= count % 10 <= 4 and not 12 <= count % 100 <= 14:
        return forms[1]
    return forms[2]
