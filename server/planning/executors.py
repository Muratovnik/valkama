"""Who stands behind a claim, a step or an agent on a card, and in what state.

A card names three kinds of holder, each its own way: a claim by the call that
took it, a step by its holder's label, an agent by its own row. A finished item
names a fourth, by the label its last claim left. `attach` gives each the same
short `executor`, so the card never reads a label to find a session:

| Field | Says |
|---|---|
| `session` | the session a click on this holder opens; an agent's parent, because a subagent cannot be opened from outside |
| `agent` | the agent inside that session, as far as the holder names one |
| `opened_in`, `opened_host` | where that session was last opened, empty when unknown |
| `family` | whose settings cover that session: `claude`, `codex` or `other`, empty for `none` |
| `state` | `live`, `ended`, `gone`, `headless` or `none` |

| Checked in order | State |
|---|---|
| no confirmed session, or none with a row: a person, the browser, an id a label replaced with its digest | `none`, and every other field empty |
| the row says `active`, and the session has no window | `headless` |
| the row says `active` | `live` |
| ended, and the client no longer holds its transcript file | `gone` |
| ended | `ended` |

The state is what the record shows, as it is everywhere on a card. A client that
crashed leaves its session `active`, and only the moment of a click can do better.
A missing transcript means nothing while a session is active: a client may not
have written the file yet. Only the file's status is asked for, as `agents` asks
for its time, and a path that cannot be read says nothing about the file.

A session Valkama itself ran and no client placed has no window: the hook of an
execution cannot always tell, so the link to the attempt says so. A session a
person attached ran elsewhere, and a place recorded since wins over the link.

Every holder of a card is answered by one statement, however many there are.
"""

from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Iterable, Mapping

from .. import sessions
from ..hooks import place as places
from . import calls, leases

LIVE = "live"
ENDED = "ended"
GONE = "gone"
HEADLESS = "headless"
NONE = "none"

_HEADLESS_PLACE = "headless"

#: The one read of sessions. `s.*` because a store an earlier build wrote may
#: lack the place columns, and it is read as it is.
_SESSIONS = (
    "SELECT s.*, EXISTS(SELECT 1 FROM execution_sessions x WHERE x.session_id = s.id"
    " AND x.relation != 'attached') AS run_by_valkama"
    " FROM sessions s WHERE s.id IN (SELECT value FROM json_each(?))"
)

_Holder = tuple[str, str | None]


def _column(row: sqlite3.Row, name: str) -> str:
    columns = row.keys()  # `in row` would search a Row's values, not its names
    return str(row[name] or "") if name in columns else ""


def _transcript_lost(path: str) -> bool:
    """Whether a recorded transcript path names a file that is not there."""

    if not path:
        return False
    try:
        os.stat(path)
    except (FileNotFoundError, NotADirectoryError):
        return True
    except (OSError, ValueError):
        return False
    return False


def _place_of(row: sqlite3.Row, active: bool | None = None) -> dict[str, str]:
    """One session's place, family and state, every field of an executor but who it is."""

    recorded = _column(row, "opened_in")
    opened_in = recorded if recorded in places.OPENED_IN else ""
    if not opened_in and row["run_by_valkama"]:
        opened_in = _HEADLESS_PLACE
    if row["status"] == "active" if active is None else active:
        state = HEADLESS if opened_in == _HEADLESS_PLACE else LIVE
    else:
        state = GONE if _transcript_lost(_column(row, "transcript_path")) else ENDED
    return {
        "opened_in": opened_in,
        "opened_host": places.agreeing_host(opened_in, _column(row, "opened_host")),
        "family": sessions.client_family(row["client"]),
        "state": state,
    }


def session_place(
    conn: sqlite3.Connection, session_id: str, *, active: bool | None = None
) -> dict[str, str] | None:
    """One session's place and state, by the rules a card's holders are read with.

    `active` is the caller's own check of the process, for the moment of a click;
    without one the row says. A session with no row has no answer.
    """

    row = conn.execute(_SESSIONS, (json.dumps([session_id]),)).fetchone()
    return None if row is None else _place_of(row, active)


def _places(conn: sqlite3.Connection, holders: Iterable[_Holder | None]) -> dict[str, dict]:
    """The place of every session the holders name that has a row, by session id."""

    named = list({holder[0] for holder in holders if holder is not None})
    if not named:
        return {}
    return {str(row["id"]): _place_of(row) for row in conn.execute(_SESSIONS, (json.dumps(named),))}


def _claim_holder(claim: Mapping) -> _Holder | None:
    """The session that took a claim. A call nobody confirmed names one nobody verified."""

    if claim["state"] == leases.UNCONFIRMED or not claim["session_id"]:
        return None
    return str(claim["session_id"]), claim["agent_id"]


def _step_holder(step: Mapping) -> _Holder | None:
    """Who a step names: its holder while it is open, whoever did it once it is done."""

    return calls.holder_ids(str(step["done_by"] if step["done"] else step["claimed_by"]))


def _executor(holder: _Holder | None, known: Mapping[str, dict]) -> dict:
    place = known.get(holder[0]) if holder is not None else None
    if holder is None or place is None:
        return {
            "session": None,
            "agent": None,
            "opened_in": "",
            "opened_host": "",
            "family": "",
            "state": NONE,
        }
    return {"session": holder[0], "agent": holder[1], **place}


def attach(conn: sqlite3.Connection, record: dict, *, recorded: bool) -> None:
    """Add an `executor` to the record's claim, to each step and to each agent.

    The record itself takes `last_claim_executor`, for whoever `last_claim_ref`
    names: a close ends the claim, and its holder may be the one worth resuming.

    `recorded` is whether this store records agents at all. One an earlier build
    wrote may have no session table, so it is not asked, and every executor reads
    `none`.
    """

    claim, steps, agents = record["claim"], record["checklist"], record["agents"]
    claim_holder = _claim_holder(claim) if claim is not None else None
    step_holders = [_step_holder(step) for step in steps]
    agent_holders: list[_Holder] = [(agent["session_id"], agent["agent_id"]) for agent in agents]
    last_holder = calls.holder_ids(str(record["last_claim_ref"] or ""))
    named = [claim_holder, last_holder, *step_holders, *agent_holders]
    known = _places(conn, named) if recorded else {}
    record["last_claim_executor"] = _executor(last_holder, known)
    if claim is not None:
        claim["executor"] = _executor(claim_holder, known)
    for step, holder in zip(steps, step_holders, strict=True):
        step["executor"] = _executor(holder, known)
    for agent, holder in zip(agents, agent_holders, strict=True):
        agent["executor"] = _executor(holder, known)
