"""Which references a store here holds, read together for many at once.

A text that names references, such as a comment or a summary, is drawn with a link on each
reference that leads to a card. Asking the mapped routing once per reference would cost a
client waiting for the text one read per candidate, so the primary store answers every
candidate in one statement, and an attached store is opened only for what it does not hold.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Collection

from ..projects import project_registry, scopes
from ..store_identity.metadata import ScopeError


def _present_in(conn: sqlite3.Connection, pairs: list[tuple[str, int]]) -> set[str]:
    """Which (space key, number) pairs this store holds, in one indexed statement."""

    if not pairs:
        return set()
    values = ",".join("(?,?)" for _ in pairs)
    rows = conn.execute(
        f"""
        WITH wanted(space_key, number) AS (VALUES {values})
        SELECT wanted.space_key, wanted.number
        FROM wanted
        JOIN planning_spaces ON planning_spaces.key = wanted.space_key
        JOIN work_items
          ON work_items.planning_space_id = planning_spaces.planning_space_id
         AND work_items.number = wanted.number
        """,  # noqa: S608 - only placeholders are interpolated
        [value for pair in pairs for value in pair],
    )
    return {f"{row[0]}-{row[1]}" for row in rows}


def _attached_present(primary_db: str, pairs: list[tuple[str, int]]) -> set[str]:
    """What the attached stores hold of these pairs; one unreadable holds nothing."""

    try:
        attached = [item for item in scopes.load(primary_db) if not item.get("primary")]
    except scopes.ScopeError:
        return set()
    found: set[str] = set()
    for item in attached:
        try:
            store = scopes.open_readonly(item)
            try:
                found |= _present_in(store, pairs)
            finally:
                store.close()
        except (sqlite3.Error, scopes.ScopeError, ScopeError):
            continue
    return found


def existing_references(
    primary: sqlite3.Connection, primary_db: str, references: Collection[str]
) -> set[str]:
    """Which of these references lead to a card, as `interactions.work_item_location` finds
    one, read together.

    The same rule without its per-reference cost, for a caller holding many candidates
    and a client waiting: the registry is readable, and a store here holds the item.
    The primary store answers in one statement. An attached store is opened only for
    a candidate the primary store does not hold, so with every candidate at home no
    other file is touched.
    """

    if project_registry.read_registry()["status"] != "available":
        return set()
    pairs = [
        (key, int(number)) for key, number in (reference.rsplit("-", 1) for reference in references)
    ]
    if not pairs:
        return set()
    found = _present_in(primary, pairs)
    outstanding = [pair for pair in pairs if f"{pair[0]}-{pair[1]}" not in found]
    if outstanding:
        found |= _attached_present(primary_db, outstanding)
    return found
