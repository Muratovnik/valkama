"""What an open question to the owner is, and when a request has lapsed.

Three readers ask it and must agree: the alert that tells a person a question
waits, the take-next queue that gives no task a question holds up, and the
record of an item, whose `withheld` names that question. The rule is stated once
here, as the one condition a request row meets to be a question to the owner,
`OWNER_QUESTION`, and the one test of whether it has lapsed although nothing
wrote that down, `lapse`. A read of many items asks `asked` once for all of them.

The module sits below the read model and the leases, so it reads the store
itself and imports neither: `requests` imports the service, which imports both.
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections.abc import Iterable

from . import model, request_model

#: A request row `r` that is a question to the owner while nobody has answered it.
#: A list on a comment is never one: nobody waits for it, so it raises no alert
#: and holds nothing up.
OWNER_QUESTION = "r.status = 'pending' AND r.comment_id IS NULL"
#: The columns `OWNER_QUESTION` reads. A store an earlier build wrote, read as it
#: is, may lack one, and its rows read it as null: that build wrote nothing it
#: would have set.
_NAMED = tuple(dict.fromkeys(re.findall(r"\br\.(\w+)", OWNER_QUESTION)))

#: A request row with what its lapse depends on: whether its item is closed and
#: how its execution, if it names one, stands. `{requests}` is the table, or what
#: stands in for it in a store an earlier build wrote (`_read`).
_FACTS = (
    "SELECT r.*, s.is_terminal AS item_terminal,"
    " x.execution_id IS NOT NULL AS execution_found,"
    " x.ended_at AS execution_ended_at, x.status AS execution_status"
    " FROM {requests} r"
    " JOIN work_items i ON i.work_item_id = r.work_item_id"
    " JOIN workflow_states s ON s.state_id = i.state_id"
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
    closed it. A pending one has lapsed past its deadline, on a closed item, or
    on an execution that finished or is gone, although nothing wrote that down.
    """

    if facts["status"] != "pending":
        reason: str | None = facts["expired_reason"]
        return reason
    if facts["expires_at"] and facts["expires_at"] <= at:
        return "deadline"
    if facts["item_terminal"]:
        return "task_closed"
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
) -> frozenset[str]:
    """The items with an open question to the owner, of these spaces and these items, in one read."""

    at = request_model.now()
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
