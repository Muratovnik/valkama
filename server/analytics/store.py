"""Analytics' own table: how often each of its surfaces was opened, counted by day and kind.

Added with schema 16, and additive: `store.connect()` runs this script against an
upgraded store exactly as against a fresh one, and an upgraded store holds no count
until a surface is opened. It imports nothing, because the store's bring-up reads it.

`analytics_surface_uses` holds one row per day and kind, and a row is only those and a
count: no text, no item, no session and no time finer than the day, which is the
caller's own, at the offset from UTC it states. The kinds are a closed vocabulary that
the table holds as well as its writer (`uses`), so no other kind can be written:
`page_open`, `panel_open` and `mini_open` count an opening of that analytics surface,
the page, a panel or a miniature, and `task_open` a task opened from any of them.
"""

from __future__ import annotations

#: Every kind of use a count may be of, in the order a reader lists them.
KINDS = ("page_open", "panel_open", "mini_open", "task_open")

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS analytics_surface_uses(
    day TEXT NOT NULL CHECK(day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    kind TEXT NOT NULL CHECK(kind IN ({", ".join(f"'{kind}'" for kind in KINDS)})),
    count INTEGER NOT NULL CHECK(typeof(count) = 'integer' AND count > 0),
    PRIMARY KEY(day, kind)
) WITHOUT ROWID;
"""

SCHEMA_TABLES = ("analytics_surface_uses",)

__all__ = ["KINDS", "SCHEMA", "SCHEMA_TABLES"]
