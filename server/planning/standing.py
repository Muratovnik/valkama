"""When an item came to stand where it is: the rule the triage stack and the Volumes reads share.

An item came to stand where it is at its last state entry, the last `created`,
`transitioned` or `opened` event of its history, or at its creation when the history
records none. "Last" is history order: the event written last, which has the highest id.
A stamp is not the order, since an import or a clock step can write a later event with
an earlier stamp. `ENTERED_AT` is that rule as one SQL expression over the items table
`i`, and both readers take it, so one item has one moment in every read.

Reads only: the module holds an expression and imports nothing of the product but the
vocabulary of `model`.
"""

from __future__ import annotations

from . import model

_ENTRIES = ", ".join(f"'{action}'" for action in model.STATE_ENTRY_ACTIONS)
#: When the item `i` came to stand where it is: the `created_at` of its last state entry in
#: history order, or its creation when the history holds none.
ENTERED_AT = (
    "COALESCE((SELECT e.created_at FROM work_item_events e"  # noqa: S608 - constant actions
    f" WHERE e.work_item_id = i.work_item_id AND e.action IN ({_ENTRIES})"
    " ORDER BY e.id DESC LIMIT 1), i.created_at)"
)
