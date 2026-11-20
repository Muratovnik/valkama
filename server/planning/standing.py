"""When an item came to stand where it is: the rule the triage stack and the Volumes reads share.

An item came to stand where it is at its last state entry, the last `created`,
`transitioned` or `opened` event of its history, or at its creation when the history
records none. "Last" is history order: the event written last, which has the highest id.
A stamp is not the order, since an import or a clock step can write a later event with
an earlier stamp. `ENTERED_AT` is that rule as one SQL expression over the items table
`i`, and both readers take it, so one item has one moment in every read. A finished
item's record carries it as `entered_at` (`entered`), so the Work filter's «Closed in a period»
keeps exactly the cards the Volumes read counts as closed in it.

Reads only: the module holds an expression and a read of it, and imports nothing of the
product but the vocabulary of `model`.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Sequence

from . import model

_ENTRIES = ", ".join(f"'{action}'" for action in model.STATE_ENTRY_ACTIONS)
#: When the item `i` came to stand where it is: the `created_at` of its last state entry in
#: history order, or its creation when the history holds none.
ENTERED_AT = (
    "COALESCE((SELECT e.created_at FROM work_item_events e"  # noqa: S608 - constant actions
    f" WHERE e.work_item_id = i.work_item_id AND e.action IN ({_ENTRIES})"
    " ORDER BY e.id DESC LIMIT 1), i.created_at)"
)


#: `ENTERED_AT` for each of a JSON array of item ids, in one statement whatever their number.
_ENTERED_OF = (
    f"SELECT i.work_item_id, {ENTERED_AT} FROM work_items i"  # noqa: S608 - constant text
    " WHERE i.work_item_id IN (SELECT value FROM json_each(?))"
)


def entered(conn: sqlite3.Connection, rows: Sequence[sqlite3.Row]) -> dict[str, str]:
    """When each item of `rows` came to stand where it is (`ENTERED_AT`), by item id."""

    identities = json.dumps([str(row["work_item_id"]) for row in rows])
    return {
        str(identity): str(moment) for identity, moment in conn.execute(_ENTERED_OF, (identities,))
    }
