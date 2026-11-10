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
model, the quality or what the work ran under (`organization`, `environment`, `effort`,
`advisor_model`) changes, after every hole, and at every write. `provisional` is
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

`usage_requests`: which run counts each request, by a hash of its id (`request_key`),
one row per request in the whole store since schema 15, so a resumed session writing
old records again, or a file copied into another session's folder, counts nothing twice.
`request_id` is the same hash of the client's own request id where a Claude record
carries one. Which run a request met in two runs belongs to is `usage_claims`' rule.

Schema 15 added, all empty or 0 in an upgraded store until its runs are read again:

- to a segment, what its work ran under, read from the transcript alone and NULL where
  the transcript says nothing, never a guess. Only ids and short labels are kept: no
  e-mail, name or path.

  - `organization`: the id of the organization the requests were made for, the only
    account identifier kept. At Claude it is the latest `credential_org` attachment
    before the row: the client writes one before a request whenever the organization
    changed, so a row before the first one is NULL and a row ends at each new one. At
    Codex it is the account that created the thread (`creator_account_id` in the
    rollout's first record), for the whole rollout.
  - `environment`: how the client ran, one of `ide` (an IDE extension), `terminal` (the
    CLI), `app` (a desktop application) and `headless` (the SDK, no window), from
    Claude's `entrypoint` or the `originator` a Codex rollout starts with. A transcript a client in WSL wrote, whose reported path is
    on the distribution's share (`\\\\wsl.localhost\\<distribution>\\...` or
    `\\\\wsl$\\<distribution>\\...`), adds `@wsl:<distribution>`: `terminal@wsl:Ubuntu`.
    NULL for a client outside the list, whatever the path.
  - `effort`: the effort the requests ran with, as the client names it (`low` to
    `max`): Claude's per-turn override where the turn has one, else the session's; at
    Codex the one each turn's `turn_context` names.
  - `advisor`: 1 on a row holding an advisor call's tokens. Such a row is its own, with
    no seconds and the adviser's `model`, even when that is the executor's model.
  - `advisor_model`: the adviser the turn had configured. On the executor's rows it is
    the one its requests named, NULL with none; on an advisor row, the adviser that
    ran. Within a run, the rows with one `advisor_model` are the executor's work with
    that adviser and the adviser's own calls, so what the advisor cost an executor is
    the cost of its run's rows with `advisor` 1, beside the executor's own rows.

- to a run, `launch_class`: the class a Claude subagent's launch declared in front of its
  description (`<class>: ...`), read from the client's metadata file beside the
  transcript (`agent-<id>.meta.json`) while it is there, else from the label the hooks
  recorded for the launch. NULL for a session's own run, a Codex thread and a description
  that declares none, and a class once read stays. Also to a run: `reading`, the reading its rows
  were written by (`READING`), and 0 for rows from before readings were counted or that
  a later input outside the transcript (a price) made stale; `reread_refused` with
  `refused_reading`, why re-reading it was refused and for which reading;
  `reread_at`, when its rows were last read again whole; `priced_with`, the price table
  it was last read or checked against; and `yielded`, how many requests it met that
  another run counts.

A run is stale while `reading` is below `READING`, and the reader reads it again
(`usage_reread`); one refused for the current reading waits until it is stale anew.
"""

from __future__ import annotations

import sqlite3

#: The reading the current reader gives. Raise it with any change that makes rows an
#: earlier reader wrote incomplete or wrong: every run read before is then stale and is
#: read again. 1 is the first reading counted: it skips a subagent file's records of
#: another session, counts a request once in the whole store and fills `request_id`. 2
#: keeps an advisor's tokens apart from the executor's when both run one model, which 1
#: counted over again with every record of the request, and fills what a segment ran
#: under (`organization`, `environment`, `effort`, `advisor`, `advisor_model`) and a
#: run's `launch_class`.
READING = 2

#: The usage rows with tokens and no cost, by model, the most tokens first. A row's
#: tokens are its priced kinds; `reasoning_tokens` is part of `output_tokens`.
UNPRICED_BY_MODEL = (
    "SELECT model, COUNT(*), SUM(spent) FROM ("
    " SELECT model, COALESCE(input_tokens, 0) + COALESCE(cached_read_tokens, 0)"
    " + COALESCE(cache_write_5m_tokens, 0) + COALESCE(cache_write_1h_tokens, 0)"
    " + COALESCE(output_tokens, 0) AS spent"
    " FROM usage_segments WHERE estimated_api_cost_usd IS NULL"
    ") WHERE spent > 0 GROUP BY model ORDER BY 3 DESC, model"
)
#: The runs holding such rows, with the model of each.
UNPRICED_RUNS = (
    "SELECT DISTINCT run_id, model FROM ("
    " SELECT run_id, model, COALESCE(input_tokens, 0) + COALESCE(cached_read_tokens, 0)"
    " + COALESCE(cache_write_5m_tokens, 0) + COALESCE(cache_write_1h_tokens, 0)"
    " + COALESCE(output_tokens, 0) AS spent"
    " FROM usage_segments WHERE estimated_api_cost_usd IS NULL"
    ") WHERE spent > 0"
)

#: The one table schema 15 rebuilds rather than extends: its key became the request alone.
_REQUESTS_TABLE = """CREATE TABLE IF NOT EXISTS usage_requests(
    request INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL,
    request_id INTEGER
);"""
_REQUESTS_INDEX = "CREATE INDEX IF NOT EXISTS usage_requests_run ON usage_requests(run_id);"

#: Columns schema 15 appends, in the order the tables above declare them last.
_ADDED_COLUMNS = {
    "usage_runs": (
        ("launch_class", "TEXT"),
        ("reading", "INTEGER NOT NULL DEFAULT 0"),
        ("reread_refused", "TEXT"),
        ("refused_reading", "INTEGER"),
        ("reread_at", "TEXT"),
        ("priced_with", "TEXT"),
        ("yielded", "INTEGER NOT NULL DEFAULT 0"),
    ),
    "usage_segments": (
        ("organization", "TEXT"),
        ("environment", "TEXT"),
        ("effort", "TEXT"),
        ("advisor", "INTEGER NOT NULL DEFAULT 0"),
        ("advisor_model", "TEXT"),
    ),
}

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
    launch_class TEXT,
    reading INTEGER NOT NULL DEFAULT 0,
    reread_refused TEXT,
    refused_reading INTEGER,
    reread_at TEXT,
    priced_with TEXT,
    yielded INTEGER NOT NULL DEFAULT 0,
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
    provisional INTEGER NOT NULL DEFAULT 0,
    organization TEXT,
    environment TEXT,
    effort TEXT,
    advisor INTEGER NOT NULL DEFAULT 0,
    advisor_model TEXT
);
CREATE INDEX IF NOT EXISTS usage_segments_item
    ON usage_segments(work_item_id, started_at) WHERE work_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_segments_session
    ON usage_segments(session_id, agent_id, started_at);
CREATE INDEX IF NOT EXISTS usage_segments_provisional
    ON usage_segments(run_id) WHERE provisional = 1;
"""
SCHEMA += _REQUESTS_TABLE + "\n" + _REQUESTS_INDEX + "\n"

SCHEMA_TABLES = ("usage_runs", "usage_segments", "usage_requests")

#: The requests one run counts, where several runs counted it before schema 15: the row
#: of the run `usage_claims.Claimant.key` puts first. A main transcript's run before a
#: subagent's, then the earlier first record, a run with none last, then the lower id.
#: A row whose run is gone comes after every other.
_KEEP_ONE = """
INSERT INTO usage_requests(request, run_id)
SELECT request, run_id FROM (
    SELECT former.request, former.run_id, ROW_NUMBER() OVER (
        PARTITION BY former.request
        ORDER BY run.id IS NULL, run.agent_id != '', run.first_at IS NULL, run.first_at,
            former.run_id
    ) AS rank
    FROM usage_requests_former AS former LEFT JOIN usage_runs AS run ON run.id = former.run_id
) WHERE rank = 1
"""


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")]


def migrate(conn: sqlite3.Connection) -> None:
    """Schema 15, once, inside the caller's transaction and under its recovery point.

    The columns are appended, so every former value stays where it was, and every run is
    stale (`reading` 0). `usage_requests` is rebuilt with the request as its key, keeping
    one row of each request several runs counted; nothing else is rewritten, since reading
    the stale runs again settles their tokens.
    """

    for table, added in _ADDED_COLUMNS.items():
        present = set(_columns(conn, table))
        for name, declaration in added:
            if name not in present:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")
    if "request_id" in _columns(conn, "usage_requests"):
        return
    # The script made the index on the former table; it goes with it and comes back.
    conn.execute("DROP INDEX IF EXISTS usage_requests_run")
    conn.execute("ALTER TABLE usage_requests RENAME TO usage_requests_former")
    conn.execute(_REQUESTS_TABLE)
    conn.execute(_KEEP_ONE)
    conn.execute("DROP TABLE usage_requests_former")
    conn.execute(_REQUESTS_INDEX)


def assert_current(conn: sqlite3.Connection) -> None:
    """Refuse to stamp a store whose usage tables lack what schema 15 added."""

    for table, added in _ADDED_COLUMNS.items():
        present = set(_columns(conn, table))
        missing = [name for name, _ in added if name not in present]
        if missing:
            raise RuntimeError(f"post-migration {table} lacks {', '.join(missing)}")
    key = [str(row[1]) for row in conn.execute("PRAGMA table_info(usage_requests)") if row[5]]
    if key != ["request"]:
        raise RuntimeError("post-migration usage_requests is not keyed by the request alone")


__all__ = [
    "READING",
    "SCHEMA",
    "SCHEMA_TABLES",
    "UNPRICED_BY_MODEL",
    "UNPRICED_RUNS",
    "assert_current",
    "migrate",
]
