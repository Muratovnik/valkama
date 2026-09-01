"""The Board-era tables, for tests that have to migrate off them.

`server/board.py` is gone, so the only honest way to exercise the conversion is
to write the shape it left behind. This is a fixture and not a second schema:
nothing in the product creates these tables, and `store.connect()` drops them
the moment the conversion runs.

The columns are exactly the ones `server/planning/migration.py` reads. A column
the migration ignores is deliberately absent — carrying it would suggest the
conversion looked at it.
"""

from __future__ import annotations

import base64
import json
import sqlite3

#: One scope id, so a fixture ref is reproducible.
_SCOPE = "7abbec45-3557-4066-a2a5-608960ac66e4"

SCHEMA = """
CREATE TABLE IF NOT EXISTS boards(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS cards(
    id INTEGER PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    lane TEXT NOT NULL DEFAULT 'backlog',
    parent_id INTEGER REFERENCES cards(id),
    priority TEXT NOT NULL DEFAULT 'medium',
    claimed_by TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    labels TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT '',
    checklist TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    launch TEXT NOT NULL DEFAULT '',
    position REAL NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS links(
    id INTEGER PRIMARY KEY,
    from_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    to_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('blocks','discovered_from')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(from_id, to_id, kind)
);
CREATE TABLE IF NOT EXISTS comments(
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    author TEXT NOT NULL DEFAULT 'agent',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS refs(
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('session','commit','memory','url')),
    value TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT 'agent',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(card_id, kind, value)
);
CREATE TABLE IF NOT EXISTS events(
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    author TEXT NOT NULL DEFAULT 'agent',
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS events_card ON events(card_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS planning_improvement_source_unique
  ON cards(source) WHERE source LIKE 'improvement://%';
"""


#: Every action the Board-era event log could record. The migration maps each
#: one onto a Planning action, and `test_planning_migration` asserts that every
#: entry here has a home.
EVENT_ACTIONS = (
    "created",
    "moved",
    "claimed",
    "taken_over",
    "released",
    "linked",
    "unlinked",
    "checklist_claimed",
    "checklist_taken_over",
    "checklist_released",
    "checklist_completed",
    "checklist_reopened",
    "checklist_replaced",
    "summarized",
    "overridden",
)


def space_ref(board_name: str, data_scope_id: str = _SCOPE) -> dict:
    """A planning-space `resource_ref` as the Board era encoded one.

    Built by hand on purpose: the current contract refuses this shape, and a
    test that produced it through the contract would be asserting the answer
    instead of the input.
    """

    payload = json.dumps(
        {"board_name": board_name, "data_scope_id": data_scope_id},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return {
        "kind": "planning-space",
        "resource_id": base64.urlsafe_b64encode(payload).decode("ascii").rstrip("="),
    }


def seed(conn: sqlite3.Connection, board: str = "Legacy") -> int:
    """Create the Board tables and one board, returning its id."""

    conn.executescript(SCHEMA)
    conn.execute("INSERT OR IGNORE INTO boards(name) VALUES (?)", (board,))
    return int(conn.execute("SELECT id FROM boards WHERE name = ?", (board,)).fetchone()[0])


def add_card(conn: sqlite3.Connection, board_id: int, title: str, **fields: object) -> int:
    """One card, with only the columns a caller cares to name."""

    columns = {"board_id": board_id, "title": title, **fields}
    names = ",".join(columns)
    marks = ",".join("?" for _ in columns)
    cursor = conn.execute(
        f"INSERT INTO cards({names}) VALUES({marks})",
        tuple(columns.values()),
    )
    return int(cursor.lastrowid or 0)
