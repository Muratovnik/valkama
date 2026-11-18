"""What a question to the owner is, when a request has lapsed, and the two writes of one.

A request asks either the owner or an agent session (its `addressee`). A list on a
comment asks nobody: nobody waits for it. Only a question to the owner raises the
owner's alert, holds an item up in the take-next queue, stops the count of a
lease's silence and stands in an item's `withheld`; a request asked of a session
waits for that session alone, and the session hears it. Every reader must agree,
so the rule is stated once here, as the one condition a request row meets to be
a question to the owner, `OWNER_QUESTION`, and the one test of whether a request
has lapsed although nothing wrote that down, `lapse`. A read of many items asks
`asked` once for all of them.

A request row is written in two places only: `ask` inserts one with its
`request_created`, and `end` ends every one still pending on an item: one still
waiting with `request_expired`, one that has lapsed with the reason it lapsed for.
A move that closes an item calls `end` in its own write, so a question there says
whether its item was done or cancelled, the asker hears it, a question its deadline
or its execution had already ended keeps saying so, and reopening the item brings
none back.

The conditions read a request row named `r`. The module sits below the read model,
the leases and the service, which call it inside their writes, so it reads and
writes the store itself and imports none of them; it imports `calls` for the call a
write records.

Whose call closed a request is read here as well, for the same reason: the request
reads and the Volumes reads below the service both ask it (`with_by_person`), so
the rule that a decision is the owner's when the call came through the interface
is stated once.
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections.abc import Iterable

from . import calls, model, request_model, store

#: A request row `r` that asks the owner, open or closed: neither a list on a
#: comment nor a request asked of an agent session.
OWNER_ASKED = "r.comment_id IS NULL AND r.addressee IS NULL"
#: A request row `r` that is a question to the owner while nobody has answered it.
#: A row can still have lapsed although nothing wrote that down (`lapse`).
OWNER_QUESTION = "r.status = 'pending' AND " + OWNER_ASKED
#: The columns `OWNER_QUESTION` reads. A store an earlier build wrote, read as it
#: is, may lack one, and its rows read it as null: that build wrote nothing it
#: would have set.
_NAMED = tuple(dict.fromkeys(re.findall(r"\br\.(\w+)", OWNER_QUESTION)))

#: A request row with what its lapse depends on: how its execution, if it names one,
#: stands. `{requests}` is the table, or what stands in for it in a store an earlier
#: build wrote (`_read`).
_FACTS = (
    "SELECT r.*, x.execution_id IS NOT NULL AS execution_found,"
    " x.ended_at AS execution_ended_at, x.status AS execution_status"
    " FROM {requests} r"
    " JOIN work_items i ON i.work_item_id = r.work_item_id"
    " LEFT JOIN executions x ON x.execution_id = r.execution_id"
)
#: One request, by its id.
_ONE = _FACTS + " WHERE r.request_id = ?"
#: The questions to the owner still pending, as far as a row says.
_PENDING = _FACTS + " WHERE " + OWNER_QUESTION
#: Those of the spaces named and of the items named, each as one JSON array.
_ASKED = (
    _PENDING + " AND (i.planning_space_id IN (SELECT value FROM json_each(?))"  # noqa: S608 - constant text
    " OR r.work_item_id IN (SELECT value FROM json_each(?)))"
)
_LIVE_EXECUTION = frozenset({"starting", "running"})


def lapse(facts: sqlite3.Row, at: str) -> str | None:
    """Why a request no longer waits for an answer, or None while it still does.

    `facts` is a row `_FACTS` reads. A request that is not pending says what
    closed it, a close of its item among them (`end`). A pending one has lapsed
    past its deadline, or on an execution that finished or is gone, although
    nothing wrote that down.
    """

    if facts["status"] != "pending":
        reason: str | None = facts["expired_reason"]
        return reason
    if facts["expires_at"] and facts["expires_at"] <= at:
        return "deadline"
    if facts["execution_id"] and (
        not facts["execution_found"]
        or facts["execution_ended_at"]
        or facts["execution_status"] not in _LIVE_EXECUTION
    ):
        return "execution_closed"
    return None


def expired(conn: sqlite3.Connection, request_id: str, at: str) -> str | None:
    """`lapse` of one request, by its id."""

    found = _read(conn, _ONE, (request_id,))
    facts = found[0] if found else None
    if facts is None:
        raise model.PlanningError("work item disappeared mid-write")
    return lapse(facts, at)


def open_rows(conn: sqlite3.Connection, work_item_id: str | None = None) -> list[sqlite3.Row]:
    """The questions still open for the owner to answer, on one item or everywhere in this store."""

    query = _PENDING
    parameters: tuple[str, ...] = ()
    if work_item_id is not None:
        query += " AND r.work_item_id = ?"
        parameters = (work_item_id,)
    at = request_model.now()
    return [row for row in _read(conn, query, parameters) if lapse(row, at) is None]


def asked(
    conn: sqlite3.Connection,
    *,
    spaces: Iterable[str] = (),
    items: Iterable[str] = (),
    at: str | None = None,
) -> frozenset[str]:
    """The items with an open question to the owner, of these spaces and these items, in one read.

    A question is open while its deadline is after `at` (now, when not given).
    """

    at = request_model.now() if at is None else at
    rows = _read(conn, _ASKED, (json.dumps(sorted(set(spaces))), json.dumps(sorted(set(items)))))
    return frozenset(str(row["work_item_id"]) for row in rows if lapse(row, at) is None)


def _read(conn: sqlite3.Connection, query: str, parameters: tuple[str, ...]) -> list[sqlite3.Row]:
    """The rows of a query over `_FACTS`, from the store as this build writes it or an earlier one.

    The store this build writes is asked first, so its read costs one statement;
    only a store that refuses a column `OWNER_QUESTION` reads is asked which ones
    it has, and its rows read the others as null. A store with no questions at all
    has none open.
    """

    try:
        return conn.execute(query.format(requests="work_item_requests"), parameters).fetchall()
    except sqlite3.OperationalError as error:
        if str(error) == "no such table: work_item_requests":
            return []
        if not str(error).startswith("no such column"):
            raise
        have = {str(row[1]) for row in conn.execute("PRAGMA table_info(work_item_requests)")}
        missing = [name for name in _NAMED if name not in have]
        if not missing:
            raise
    standing = ", ".join(f"NULL AS {name}" for name in missing)
    source = f"(SELECT *, {standing} FROM work_item_requests)"  # noqa: S608 - column names from OWNER_QUESTION
    return conn.execute(query.format(requests=source), parameters).fetchall()


def with_by_person(conn: sqlite3.Connection, records: list[dict]) -> list[dict]:
    """Requests with whether the latest call that closed or changed each came through the interface.

    True for a browser write, false for any other call that answered, changed,
    declined or withdrew it, and null while no call has: still open, run out by
    itself, or written with no call, as on a comment. The latest such event
    decides, so a changed answer is the changer's. The `author` beside it is text
    the caller wrote and says nothing here; the fact stays once, on the call row.
    One statement for every request of a read.
    """

    closed = [record["request_id"] for record in records if record["resolved_at"] is not None]
    sources: dict[str, object] = {}
    # One from before calls were recorded has no such row to read: nothing there
    # came through a call anyone proved.
    if closed and store.has_table(conn, "execution_events"):
        # By the request rather than its item: a merge moves a request and leaves
        # its history where it was written. A call row that is there always has a
        # source, so a join that found none means no call.
        sources = {
            str(row["detail"]): row["identity_source"]
            for row in conn.execute(
                "SELECT e.detail, c.identity_source FROM work_item_events e"
                " LEFT JOIN execution_events c ON c.id = e.call_id"
                " WHERE e.id IN (SELECT MAX(id) FROM work_item_events"
                " WHERE action IN"
                " ('request_answered','request_changed','request_declined','request_expired')"
                " AND detail IN (SELECT value FROM json_each(?)) GROUP BY detail)",
                (json.dumps(closed),),
            )
        }
    return [
        {**record, "by_person": _through_interface(sources.get(record["request_id"]))}
        for record in records
    ]


def _through_interface(source: object) -> bool | None:
    """Whether a call of this source came through the interface; null with no call."""

    return None if source is None else source == calls.BROWSER


def closed_reason(category: str) -> str:
    """The reason `end` writes when a move closes an item into a state of `category`:
    cancelled, or else done, as every other state that closes an item reads."""

    return "item_cancelled" if category == "cancelled" else "item_completed"


def ask(
    conn: sqlite3.Connection,
    work_item_id: str,
    *,
    kind: str,
    prompt: str,
    fields: list[dict],
    author: str | None,
    purpose: str | None = None,
    execution_id: str | None = None,
    session_id: str | None = None,
    expires_at: str | None = None,
    addressee: str | None = None,
    comment_id: int | None = None,
) -> str:
    """Insert one request on an item and its `request_created`; answer its id.

    The one insert of a request row. Its caller has checked and parsed what it
    passes, and checks after the insert what it must of the row; `purpose` names
    one of `request_model.PURPOSES`, or nothing.
    """

    if purpose is not None:
        model.enum_field(purpose, frozenset(request_model.PURPOSES), "purpose")
    identity = model.new_id()
    conn.execute(
        "INSERT INTO work_item_requests(request_id,work_item_id,comment_id,kind,prompt,"
        "fields_json,author,execution_id,session_id,expires_at,created_at,addressee,purpose)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            identity,
            work_item_id,
            comment_id,
            kind,
            prompt,
            model.dumps(fields),
            model.actor(author),
            execution_id,
            session_id,
            expires_at,
            request_model.now(),
            addressee,
            purpose,
        ),
    )
    log_event(conn, work_item_id, "request_created", identity, author)
    return identity


def end(
    conn: sqlite3.Connection,
    work_item_id: str,
    reason: str,
    author: str | None,
    *,
    purpose: str | None = None,
) -> list[str]:
    """End every request still pending on an item, or those of one `purpose`, unanswered.

    One still waiting becomes `expired` with `reason`, one of
    `request_model.EXPIRED_REASONS`, and gets its `request_expired`, whoever it
    asks: a question, a decision or a list, of the owner or of a session. The event
    names the request, as every event of one does, and the reason is read from its
    row. One that has lapsed (`lapse`) is written as it lapsed, `deadline` or
    `execution_closed`, resolved when it lapsed where that is known, and gets no
    event: nothing happened to it now. Either way no request is left pending.
    Answers the ids `reason` ended.
    """

    model.enum_field(reason, frozenset(request_model.EXPIRED_REASONS), "expired_reason")
    query = _FACTS + " WHERE r.work_item_id = ? AND r.status = 'pending'"
    parameters: tuple[str, ...] = (work_item_id,)
    if purpose is not None:
        query += " AND r.purpose = ?"
        parameters += (purpose,)
    rows = _read(conn, query + " ORDER BY r.created_at, r.request_id", parameters)
    at = request_model.now()
    ended = []
    for row in rows:
        identity = str(row["request_id"])
        lapsed = lapse(row, at)
        if lapsed is None:
            conn.execute(
                "UPDATE work_item_requests SET status='expired',expired_reason=?,answered_by=?,"
                "resolved_at=?,revision=revision+1 WHERE request_id=?",
                (reason, model.actor(author), at, identity),
            )
            log_event(conn, work_item_id, "request_expired", identity, author)
            ended.append(identity)
            continue
        when = row["expires_at"] if lapsed == "deadline" else row["execution_ended_at"]
        conn.execute(
            "UPDATE work_item_requests SET status='expired',expired_reason=?,"
            "resolved_at=?,revision=revision+1 WHERE request_id=?",
            (lapsed, when or at, identity),
        )
    return ended


def log_event(
    conn: sqlite3.Connection, work_item_id: str, action: str, request_id: str, author: str | None
) -> None:
    """Record one event of a request on its item, by the call in progress."""

    conn.execute(
        "INSERT INTO work_item_events(work_item_id,action,detail,author,call_id) VALUES(?,?,?,?,?)",
        (
            work_item_id,
            model.event_action(action),
            request_id,
            model.actor(author),
            calls.call_id(conn, work_item_id),
        ),
    )
