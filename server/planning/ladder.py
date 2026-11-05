"""The signals that place an agent's work on one item, strongest first.

One order for both readers of it: `telemetry.usage_clock` answers for a stretch of work
already done, and `live_work` for an agent running now.

| Signal | Who | What it means |
|---|---|---|
| `next_write` | any | the agent's next write in the same turn names the item |
| `last_write` | any | the last write in the same turn named it |
| `earlier_write` | any | a turn with no write: its last write before this turn named it |
| `held_step` | subagent | it holds an open step of the item |
| `packet_number` | subagent | the first number in its packet names the item |
| `label_number` | subagent | the first number in the label its launch gave it does |
| `single_hold` | any | it has no other sign, and the session holds this item and no other |

A subagent's packet names several numbers in a third of the cases that name any, and
the first is the one meant: among 108 subagents that wrote and whose packet names a
number, the first number was the item of their first write for 104, and for 34 of the
38 whose packet names several. A session holding many items says nothing about any of
them, which is why `single_hold` stands last and asks for exactly one.
"""

from __future__ import annotations

import json
import sqlite3

from ..hooks import normalize
from . import mentions
from .model import parse_human_id

NEXT_WRITE = "next_write"
LAST_WRITE = "last_write"
EARLIER_WRITE = "earlier_write"
HELD_STEP = "held_step"
PACKET_NUMBER = "packet_number"
LABEL_NUMBER = "label_number"
SINGLE_HOLD = "single_hold"

#: How many candidates one text may spend reads on. A packet quoting a whole space is
#: not a packet that means its thousandth number.
_MOST_CANDIDATES = 32


def named_references(text: str) -> list[str]:
    """The item numbers `text` names as prose, in order; one a cut ran through names none."""

    return [
        found.reference
        for found in mentions.scan(text, mentions.ScanState(), final=True)
        if text[found.end :] != normalize.LABEL_CUT
    ]


def _item_of(conn: sqlite3.Connection, reference: str) -> str | None:
    row = conn.execute(
        "SELECT w.work_item_id FROM work_items w"
        " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        " WHERE p.key = ? AND w.number = ?",
        parse_human_id(reference),
    ).fetchone()
    return str(row[0]) if row is not None else None


def first_named_item(conn: sqlite3.Connection, text: str) -> str | None:
    """The item the first real number in `text` names. `UTF-8` has the shape and names none."""

    for reference in named_references(text)[:_MOST_CANDIDATES]:
        item = _item_of(conn, reference)
        if item is not None:
            return item
    return None


def held_steps(conn: sqlite3.Connection) -> dict[str, str]:
    """Who holds an open step now, by holder label, and of which item.

    Closing an item ends its step claims, so only open items are asked.
    """

    held: dict[str, str] = {}
    for row in conn.execute(
        "SELECT w.work_item_id, w.checklist FROM work_items w"
        " JOIN workflow_states s ON s.state_id = w.state_id"
        " WHERE s.is_terminal = 0 AND w.checklist LIKE '%(session %'"
    ):
        for step in json.loads(row[1]):
            holder = step.get("claimed_by")
            if holder and not step.get("done"):
                held[str(holder)] = str(row[0])
    return held
