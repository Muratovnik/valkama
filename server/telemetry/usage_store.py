"""The tables that say how much was worked on what, and what it would cost at API prices.

Added with schema 11, and additive: `store.connect()` runs this script against an
upgraded store under its recovery point, exactly as against a fresh one. Everything
here is derived from the clients' transcripts and can be read again from them; no
message or command text is stored, only ids, times, counters and one work item id.

`usage_runs`: one row for each transcript being read, a session's own or a subagent's.
It holds where reading stopped, the state of the reader as JSON of ids, times and
counters, the time left out by class, and the item its packet named.

`usage_segments`: one row per stretch of work with no hole in it, so a reader can take
the union of rows from any number of agents. A new row starts when the item, the
model or the quality changes, after every hole, and at every write. `provisional` is
1 while a later write in the same turn can still move the row to its own item; such a
row already names the item the rule gives it so far, so a reader takes it as it is.

A token column holds what that row's requests reported, and NULL when none reported
that kind. `input_tokens` excludes the cache at both clients, so the kinds do not
overlap and add up to what was sent. `reasoning_tokens` is the part of `output_tokens`
spent on reasoning and is not priced apart. `cache_write_5m_tokens` holds the shorter
retention a client offers, thirty minutes at OpenAI, and `cache_write_1h_tokens` the
longer. `estimated_api_cost_usd` is an estimate at public API prices (`usage_prices`,
named by `price_book`), not a bill: a subscription pays differently. It is NULL for
a row with no request and for a model no price is known for.

`usage_requests`: which requests of a run were counted, by a hash of their id, so a
resumed session writing old records again counts nothing twice.
"""

from __future__ import annotations

SCHEMA = """
CREATE TABLE IF NOT EXISTS usage_runs(
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL DEFAULT '',
    client TEXT NOT NULL,
    path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'reading'
        CHECK(status IN ('reading','missing','truncated','unreadable')),
    read_offset INTEGER NOT NULL DEFAULT 0,
    events_after INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT '{}',
    packet_item TEXT,
    human_seconds REAL NOT NULL DEFAULT 0,
    subagent_seconds REAL NOT NULL DEFAULT 0,
    external_seconds REAL NOT NULL DEFAULT 0,
    gap_seconds REAL NOT NULL DEFAULT 0,
    first_at TEXT,
    last_at TEXT,
    read_at TEXT,
    UNIQUE(session_id, agent_id)
);
CREATE TABLE IF NOT EXISTS usage_segments(
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES usage_runs(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL DEFAULT '',
    model TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    seconds REAL NOT NULL,
    work_item_id TEXT,
    signal TEXT,
    input_tokens INTEGER,
    cached_read_tokens INTEGER,
    cache_write_5m_tokens INTEGER,
    cache_write_1h_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER,
    estimated_api_cost_usd REAL,
    price_book TEXT,
    quality TEXT NOT NULL CHECK(quality IN ('observed','estimated')),
    provisional INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usage_segments_item
    ON usage_segments(work_item_id, started_at) WHERE work_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_segments_session
    ON usage_segments(session_id, agent_id, started_at);
CREATE INDEX IF NOT EXISTS usage_segments_provisional
    ON usage_segments(run_id) WHERE provisional = 1;
CREATE TABLE IF NOT EXISTS usage_requests(
    run_id INTEGER NOT NULL,
    request INTEGER NOT NULL,
    PRIMARY KEY(run_id, request)
) WITHOUT ROWID;
"""

SCHEMA_TABLES = ("usage_runs", "usage_segments", "usage_requests")

__all__ = ["SCHEMA", "SCHEMA_TABLES"]
