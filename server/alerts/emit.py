"""Deciding that an alert is due, and delivering it after the write that raised it.

An alert is tied to a write, never to a read of the store. The process that wrote
is alive at that moment and knows what it did, so nothing has to keep running to
notice, and a restart replays nothing: at most once, by construction. A process
killed between the commit and the toast loses the toast and keeps the question,
which still waits in the owner's list.

What a call wrote is read from the history rows that carry its `call_id`, not
from the name of the tool. That covers a transition inside
`apply_work_item_changes` and a close by `merge_work_items` with no table of
tools to keep. Only an agent's write raises an alert: the owner does not need to
be told what they just did. Any write can take one back: an answered question
removes the toast that asked it, whoever answered.

Reading happens in the caller's thread, on the caller's connection, because a
SQLite connection belongs to its thread. `Emitter` holds finished messages only.

The window. Agents ask in parallel tool calls, a few milliseconds apart, and each
would be its own banner. Windows merges toasts of one item by their tag but has
nothing that merges different items, so the waiting has to be done here: the same
shape as Alertmanager's `group_wait`, a fixed wait counted from the first event,
after which everything collected goes out as one, and an event taken back before
the wait ends is never sent. Alertmanager's own notes name the trade: too short
misses the rest of the group, too long delays the first. The owner's limit is a
banner within three seconds of the question, and the helper and the presence
question take up to a few hundred milliseconds after the wait, so the wait is
2.5 seconds. The value is a choice inside that limit, not a measured optimum.

The thread. `threading.Timer` is the library's one-shot wait, but it can neither
be extended by a later event nor told to fire early, so this waits on an event
with a timeout. The thread exists only while something is due and is not a
daemon: a daemon thread is stopped abruptly at shutdown and would lose the
question asked just before a session ended. `atexit` cannot shorten the wait,
because the interpreter joins non-daemon threads before it runs `atexit`
callbacks, so the surface that owns the process calls `flush` when its client is
gone. Any other way out still delivers, at the end of the window.
"""

from __future__ import annotations

import http.client
import json
import sqlite3
import threading
import time
from collections.abc import Iterable
from dataclasses import dataclass
from urllib.parse import urlencode

from ..executions import results as execution_results
from ..ops import configuration, toast
from ..planning import calls, read_model, requests
from . import messages
from . import settings as alert_settings

#: How long events gather before they go out; see the module's note.
WINDOW = 2.5
#: How long the listener is given to say whether a page already shows the item.
PRESENCE_TIMEOUT = 0.15

_CLOSED_QUESTION = frozenset({"request_answered", "request_declined", "request_expired"})
_REVIEW = "review"


@dataclass(frozen=True)
class Show:
    """One toast the owner should see."""

    tag: str
    message: messages.Message
    work_item_id: str
    #: What a summary of this and other toasts is written with.
    settings: alert_settings.Settings
    #: A question is also shown by the panel of open questions, not only by its card.
    question: bool = False


@dataclass(frozen=True)
class TakeBack:
    """One toast that no longer says anything true."""

    tag: str


Due = Show | TakeBack


def _category_before(conn: sqlite3.Connection, item: sqlite3.Row, first_move: int) -> str | None:
    """The category an item stood in before this call moved it, from its history.

    Every state an item enters is written down as a `created` or `transitioned`
    row whose detail starts with the state's key. A key cannot hold a colon, and
    what follows one is the reason.
    """

    before = conn.execute(
        "SELECT detail FROM work_item_events WHERE work_item_id=? AND id<?"
        " AND action IN ('created','transitioned') ORDER BY id DESC LIMIT 1",
        (item["work_item_id"], first_move),
    ).fetchone()
    if before is None:
        return None
    state = conn.execute(
        "SELECT category FROM workflow_states WHERE workflow_id=? AND key=?",
        (item["workflow_id"], str(before["detail"]).partition(":")[0].strip()),
    ).fetchone()
    return None if state is None else str(state["category"])


def _deadline(rows: Iterable[sqlite3.Row]) -> str | None:
    """When an item's toast may leave the action centre: after its last open question."""

    deadlines = [row["expires_at"] for row in rows]
    return None if None in deadlines else max(deadlines, default=None)


def _question(
    conn: sqlite3.Connection,
    item: sqlite3.Row,
    reference: str,
    request_id: str,
    open_rows: list[sqlite3.Row],
    settings: alert_settings.Settings,
) -> Show:
    request = conn.execute(
        "SELECT kind,prompt FROM work_item_requests WHERE request_id=?", (request_id,)
    ).fetchone()
    return Show(
        tag=reference,
        message=messages.build(
            "question",
            reference=reference,
            title=str(item["title"]),
            settings=settings,
            kind=str(request["kind"]),
            open_questions=len(open_rows),
            prompt=str(request["prompt"]),
            expires_at=_deadline(open_rows),
            logo=toast.logo_uri(),
        ),
        work_item_id=str(item["work_item_id"]),
        question=True,
        settings=settings,
    )


def _plain(
    event: str,
    item: sqlite3.Row,
    reference: str,
    settings: alert_settings.Settings,
) -> Show:
    return Show(
        tag=reference,
        message=messages.build(
            event,
            reference=reference,
            title=str(item["title"]),
            settings=settings,
            logo=toast.logo_uri(),
        ),
        work_item_id=str(item["work_item_id"]),
        settings=settings,
    )


def _item_dues(
    conn: sqlite3.Connection,
    work_item_id: str,
    events: list[sqlite3.Row],
    settings: alert_settings.Settings | None,
) -> list[Due]:
    item = read_model.item_by_id(conn, work_item_id)
    reference = read_model.reference(conn, item)
    state = read_model.state_by_id(conn, str(item["state_id"]))
    moves = [int(event["id"]) for event in events if event["action"] == "transitioned"]
    created = [str(event["detail"]) for event in events if event["action"] == "request_created"]
    open_rows = requests.open_rows(conn, work_item_id)
    dues: list[Due] = []
    closing = (moves and state["is_terminal"]) or any(
        event["action"] in _CLOSED_QUESTION for event in events
    )
    if closing and not open_rows:
        dues.append(TakeBack(reference))
    if settings is None:
        return dues
    if created and open_rows:
        if alert_settings.wants(settings, "question"):
            dues.append(_question(conn, item, reference, created[-1], open_rows, settings))
    elif (
        moves
        and state["category"] == _REVIEW
        and alert_settings.wants(settings, _REVIEW)
        and _category_before(conn, item, moves[0]) != _REVIEW
    ):
        dues.append(_plain(_REVIEW, item, reference, settings))
    return dues


def _write_dues(conn: sqlite3.Connection) -> list[Due]:
    written = calls.written(conn)
    if written is None:
        return []
    # A list on a comment waits for nobody, so neither writing one nor ticking it is
    # news for the owner's alert: left in, a list beside a real question would raise
    # or take back that question's toast.
    events = conn.execute(
        "SELECT e.id,e.work_item_id,e.action,e.detail FROM work_item_events e WHERE e.call_id=?"
        " AND e.action IN"
        " ('request_created','request_answered','request_declined','request_expired','transitioned')"
        " AND NOT EXISTS (SELECT 1 FROM work_item_requests r"
        " WHERE r.request_id = e.detail AND r.comment_id IS NOT NULL)"
        " ORDER BY e.id",
        (written[0],),
    ).fetchall()
    if not events:
        return []
    by_item: dict[str, list[sqlite3.Row]] = {}
    for event in events:
        by_item.setdefault(str(event["work_item_id"]), []).append(event)
    settings = alert_settings.read(conn) if calls.from_agent() else None
    dues = [
        due
        for work_item_id, written_events in by_item.items()
        for due in _item_dues(conn, work_item_id, written_events, settings)
    ]
    # A summary names several items under its own tag, so no item's removal reaches
    # it. It says answers are waiting, which stops being true only here.
    if any(isinstance(due, TakeBack) for due in dues) and not requests.open_rows(conn):
        dues.append(TakeBack(messages.SUMMARY_TAG))
    return dues


def due_after_write(conn: sqlite3.Connection) -> list[Due]:
    """What the call in progress owes the owner. Reads only, and never raises.

    To be called while the call is still bound. A failure here is a line in the log:
    an alert is never worth a failed write. Where toasts are switched off nothing is
    read, gathered or asked, so no thread starts and no listener is called.
    """

    if not toast.active():
        return []
    try:
        return _write_dues(conn)
    except Exception as error:  # noqa: BLE001 -- nothing about an alert may break a write
        toast.log(f"alert not decided: {type(error).__name__}: {error}")
        return []


def _reap_dues(conn: sqlite3.Connection, ended: list[dict]) -> list[Due]:
    settings = alert_settings.read(conn)
    dues: list[Due] = []
    for launch in ended:
        if launch.get("moved_to_review"):
            event = _REVIEW
        elif launch["result"]["outcome"] in execution_results.FAILED_OUTCOMES:
            event = "launchFailed"
        else:
            continue
        if alert_settings.wants(settings, event):
            reference = str(launch["reference"])
            dues.append(_plain(event, read_model.item_row(conn, reference), reference, settings))
    return dues


def after_reap(conn: sqlite3.Connection, ended: list[dict]) -> None:
    """Tell the owner what the launches that just ended owe them. Never raises.

    The reaper writes outside any bound call, and hands over each launch once, so a
    later pass has nothing to repeat.
    """

    if not toast.active() or not ended:
        return
    try:
        dues = _reap_dues(conn, ended)
    except Exception as error:  # noqa: BLE001 -- nothing about an alert may stop the reaper
        toast.log(f"alert not decided after a launch: {type(error).__name__}: {error}")
        return
    send(dues)


def listener_sees(work_item_id: str, *, question: bool) -> bool:
    """Whether a page in focus already shows this. No answer is a no: then no page is open."""

    query = {"work_item": work_item_id, **({"hub": "1"} if question else {})}
    connection = http.client.HTTPConnection(
        "127.0.0.1", configuration.listener_port(), timeout=PRESENCE_TIMEOUT
    )
    try:
        connection.request("GET", f"/api/alerts/presence?{urlencode(query)}")
        response = connection.getresponse()
        answer = json.loads(response.read(256)) if response.status == 200 else None
    except (OSError, http.client.HTTPException, ValueError):
        return False
    finally:
        connection.close()
    return isinstance(answer, dict) and answer.get("visible") is True


class Emitter:
    """Gathers dues for a window and delivers them from a thread of its own."""

    def __init__(self, *, window: float = WINDOW) -> None:
        self._window = window
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._pending: dict[str, Show] = {}
        self._removals: list[str] = []
        self._deadline: float | None = None
        self._flushing = False
        self._thread: threading.Thread | None = None

    def submit(self, dues: Iterable[Due]) -> None:
        """Take dues and return at once; the thread does everything that can wait."""

        with self._lock:
            for due in dues:
                current = self._pending.pop(due.tag, None)
                if isinstance(due, TakeBack):
                    self._removals.append(due.tag)
                elif current is not None and current.question and not due.question:
                    # The open question is what the owner still has to act on.
                    self._pending[due.tag] = current
                else:
                    self._pending[due.tag] = due
            if not self._pending:
                self._deadline = None
            elif self._deadline is None:
                self._deadline = time.monotonic() + self._window
            if not self._pending and not self._removals:
                return
            self._wake.set()
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, name="valkama-alerts")
                self._thread.start()

    def flush(self, wait: float = 0.0) -> None:
        """End the window now, waiting up to `wait` seconds for the delivery."""

        with self._lock:
            thread = self._thread
            if thread is None:
                return
            self._flushing = True
            self._wake.set()
        if wait:
            thread.join(wait)

    def _run(self) -> None:
        while True:
            self._wake.clear()
            with self._lock:
                removals, self._removals = self._removals, []
                now = time.monotonic()
                ready = self._deadline is not None and (self._flushing or now >= self._deadline)
                shows = list(self._pending.values()) if ready else []
                if ready:
                    self._pending.clear()
                    self._deadline = None
                delay = None if self._deadline is None else self._deadline - now
                if not removals and not shows and delay is None:
                    self._flushing = False
                    self._thread = None
                    return
            if removals or shows:
                self._deliver(removals, shows)
            else:
                self._wake.wait(delay)

    def _deliver(self, removals: list[str], shows: list[Show]) -> None:
        try:
            for tag in removals:
                toast.remove(tag, messages.GROUP)
            unseen = [
                due for due in shows if not listener_sees(due.work_item_id, question=due.question)
            ]
            if len(unseen) == 1:
                toast.show(unseen[0].message)
            elif unseen:
                toast.show(
                    messages.summary(
                        [due.tag for due in unseen],
                        questions=sum(due.question for due in unseen),
                        settings=unseen[-1].settings,
                        logo=toast.logo_uri(),
                    )
                )
        except Exception as error:  # noqa: BLE001 -- this thread has no caller to raise to
            toast.log(f"alert not delivered: {type(error).__name__}: {error}")


#: The one this process delivers through; read it through this module, so a test
#: that swaps it reaches every caller.
EMITTER = Emitter()


def send(dues: Iterable[Due]) -> None:
    EMITTER.submit(dues)


def flush() -> None:
    EMITTER.flush()


def after_write(conn: sqlite3.Connection) -> None:
    """For a surface whose write is already committed, with the call still bound."""

    send(due_after_write(conn))
