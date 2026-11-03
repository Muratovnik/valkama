"""SQLite storage: the schema, the order a store is brought up in, and the connection.

Everything else in the package reads and writes through `connect()`, and what
this module owns above all is the *order* of that bring-up: which check refuses
before the first write, when the recovery point is taken, what runs inside the
one transaction, and that the generation stamp is the last statement in it.
That order is a single sequence with no seams, so it stays legible in one
place -- `connect()`, read top to bottom.

The mechanics each step needs live beside it rather than in it: `store_adoption`
moves a directory an earlier generation wrote, `store_backups` makes and
verifies the recovery point, `store_lock` serializes the processes doing any of
this, and `store_rename` carries a store off the former product name. This
module keeps what only it can own -- the schema, the ratchet, the store's own
path, and the sequence.

It depends on the platform schema owners and on those four, and on nothing else
in the server, which is what lets the rest of the package be split up around it.
"""

from __future__ import annotations

import os
import sqlite3
from typing import NamedTuple

from . import store_adoption, store_backups, store_lock, store_rename
from .executions import store as execution_store
from .ops import configuration
from .planning import migration as planning_migration
from .planning import store as planning_store
from .platform import core as platform_core
from .platform import migrations as platform_migrations
from .platform import relations as platform_relations
from .projects import project_registry
from .store_identity import metadata as store_metadata
from .store_identity.refs import planning_space_ref

# -- the legacy Board schema, kept only so a store can be migrated off it ----
#
# None of this is part of the current schema. An existing store still holds
# `boards`, `cards`, `links`, `comments`, `refs` and `events`, and it has to be
# brought up to the last Board-era shape before the cutover can read it: the
# cutover refuses a row it cannot express, and a column added in a later Board
# version is exactly such a row. Once `migrate_planning_cutover` has run, the
# tables are dropped and nothing here is reachable again.
_LEGACY_EVENT_ACTIONS = (
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
_LEGACY_EVENT_ACTION_SQL = ",".join(f"'{action}'" for action in _LEGACY_EVENT_ACTIONS)
_LEGACY_EVENTS_TABLE = (
    "CREATE TABLE IF NOT EXISTS events("
    " id INTEGER PRIMARY KEY,"
    " card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,"
    " author TEXT NOT NULL DEFAULT 'agent',"
    f" action TEXT NOT NULL CHECK(action IN ({_LEGACY_EVENT_ACTION_SQL})),"
    " detail TEXT NOT NULL DEFAULT '',"
    " created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))"
    ");"
)
_LEGACY_TABLES = ("events", "refs", "links", "comments", "cards", "boards")


def board_domain_present(conn: sqlite3.Connection) -> bool:
    """Whether this store still holds the Board tables at all."""

    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    return "cards" in tables and "boards" in tables


def drop_board_domain(conn: sqlite3.Connection) -> None:
    """Remove the Board tables, in foreign-key order, after the cutover."""

    for table in _LEGACY_TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table}")


SCHEMA = (
    planning_store.SCHEMA
    + """
CREATE TABLE IF NOT EXISTS sessions(
    id TEXT PRIMARY KEY,
    client TEXT NOT NULL,
    cwd TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    work_item_id TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended','failed')),
    attention TEXT NOT NULL DEFAULT '',
    attention_seen INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    ended_at TEXT,
    parent_session_id TEXT NOT NULL DEFAULT '',
    agent_id TEXT NOT NULL DEFAULT '',
    transcript_path TEXT NOT NULL DEFAULT '',
    client_version TEXT NOT NULL DEFAULT '',
    opened_in TEXT NOT NULL DEFAULT '',
    opened_host TEXT NOT NULL DEFAULT '',
    opened_folder TEXT NOT NULL DEFAULT '',
    host_session_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS session_events(
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    klass TEXT NOT NULL CHECK(klass IN ('analytics','stream')),
    kind TEXT NOT NULL,
    tool TEXT NOT NULL DEFAULT '',
    server TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS session_events_session ON session_events(session_id, id);
CREATE INDEX IF NOT EXISTS session_events_klass ON session_events(klass, id);
"""
    # The execution tree: what clients reported through their hooks, and every
    # Planning write call with the identity it carried. Appended to and never
    # edited, which the two triggers hold. Nothing here points out: history
    # outlives a deleted work item, and a replayed event must not fail on a
    # session row that has not been written yet. Planning rows point in.
    + """
CREATE TABLE IF NOT EXISTS execution_events(
    id INTEGER PRIMARY KEY,
    event_uid TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    identity_state TEXT NOT NULL,
    identity_source TEXT NOT NULL,
    delivery TEXT NOT NULL DEFAULT 'direct',
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    occurred_at TEXT,
    spooled_at TEXT,
    client TEXT,
    client_version TEXT,
    hook_event TEXT,
    tool TEXT,
    session_id TEXT,
    agent_id TEXT,
    agent_type TEXT,
    parent_session_id TEXT,
    turn_id TEXT,
    tool_use_id TEXT,
    permission_mode TEXT,
    model TEXT,
    source TEXT,
    reason TEXT,
    cwd TEXT,
    transcript_path TEXT,
    archive_path TEXT,
    archive_sha256 TEXT,
    work_item_id TEXT
);
CREATE INDEX IF NOT EXISTS execution_events_session
    ON execution_events(session_id, id) WHERE session_id IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS execution_events_append_only_update
BEFORE UPDATE ON execution_events
BEGIN
    SELECT RAISE(ABORT, 'execution_events is append-only');
END;
CREATE TRIGGER IF NOT EXISTS execution_events_append_only_delete
BEFORE DELETE ON execution_events
BEGIN
    SELECT RAISE(ABORT, 'execution_events is append-only');
END;
"""
    # After both of the tables it points at: an execution names a work item and
    # the sessions that carried it, and a foreign key wants its target to exist.
    + execution_store.SCHEMA
    + platform_core.SCHEMA
    # The owner's Windows alert settings, added with schema 10: one row, and no
    # row means the defaults `alerts.settings` keeps. Additive and empty in an
    # upgraded store, so this script is the whole of its migration.
    + """
CREATE TABLE IF NOT EXISTS owner_alert_settings(
    key TEXT PRIMARY KEY CHECK(key='settings'),
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""
)


# Columns added after the first release. A database built by an older version
# keeps its rows; the base schema above already carries them for new ones.
MIGRATIONS = {
    "source": "ALTER TABLE cards ADD COLUMN source TEXT NOT NULL DEFAULT ''",
    "parent_id": "ALTER TABLE cards ADD COLUMN parent_id INTEGER REFERENCES cards(id)",
    "claimed_by": "ALTER TABLE cards ADD COLUMN claimed_by TEXT NOT NULL DEFAULT ''",
    "checklist": "ALTER TABLE cards ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]'",
    "revision": "ALTER TABLE cards ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
    "summary": "ALTER TABLE cards ADD COLUMN summary TEXT NOT NULL DEFAULT ''",
    "launch": "ALTER TABLE cards ADD COLUMN launch TEXT NOT NULL DEFAULT ''",
}
# The store's own schema generation, stamped into `PRAGMA user_version`. The
# lifecycle and registry meanings share this ratchet. Raise it in the same
# commit that changes what an existing row means,
# and a build made before that change refuses the store instead of reading it
# wrongly. Migrations here are forward-only and idempotent, which is why an
# older build gets away with so much: it is the change of meaning, not the added
# column, that this number exists to stop.
#
# Note what it cannot do. It is read when a process opens the store, so it
# governs a server that is spawned old -- a checkout moved back, an installed
# copy left behind. A server that was current when it started and went stale
# while it ran already holds its connection; `static_assets.SourceWatch` is what
# notices that one.
#
# 9 dropped the extension registry's tables, the module rows with their audit,
# and `integration_settings`. A build at 8 would create them again, empty, and
# stamp the store back to 8; the ratchet makes it refuse a store at 9 instead.
#
# 10 made a comment either the root of a thread or a reply under one, put a
# person's own option and per-field notes into an answer beside its `_note`, and
# let an answer be replaced. A build at 9 would show a reply as a root of its
# own, read the new answer keys as fields its own interface then refuses, carry
# replies away from their root in a merge, and accept a note in place of a
# required field; the ratchet makes it refuse a store at 10 instead.
STORE_SCHEMA_VERSION = 10


class StoreTooNewError(RuntimeError):
    """This build is older than the store it was pointed at."""

    def __init__(self, stored: int, supported: int) -> None:
        super().__init__(
            f"this store is at schema {stored} and this build understands {supported}."
            " It was written by a newer Valkama, so opening it here could misread"
            " rows a later version defined. Restart the client so it spawns the"
            " release the launcher now pins; if that release is the one refusing,"
            " pin a newer one with `launcher install`."
        )
        self.stored = stored
        self.supported = supported


LINK_KINDS = ("blocks", "blocked_by", "discovered_from")
REF_KINDS = ("session", "commit", "memory", "url")


DATA_ROOT = ".valkama"
DATA_PREFIX = "valkama"

# Every store layout this product has written, newest first. Two renames have
# now happened, and a workstation that sat out the middle one still has a real
# board under the oldest name, so adoption walks the chain rather than assuming
# whatever it finds is exactly one rename behind.


def data_root() -> str:
    return os.path.join(os.path.expanduser("~"), DATA_ROOT)


#: One exact path a suite run must never resolve to, written by
#: `tests/__init__.py` and by nothing else.
#:
#: It holds a path rather than a flag because the adoption tests legitimately go
#: through the default: they point the home directory at a temporary one and then
#: check that a store there is adopted. What must be unreachable is the owner's
#: real file, and only comparing against it distinguishes the two.
#:
#: Why at all: thirty tests clear `VALKAMA_DB` in their cleanup, and each clear
#: handed whatever ran next the real database. One of them converted it.
PROTECTED_PATH_ENV = "VALKAMA_PROTECTED_STORE"


def db_path() -> str:
    # Through the one resolution, so an owner may set this in the file as well
    # as in the environment. The default below is unchanged and stays here: it
    # is this module's to know, and moving it would put the store's own path in
    # a module the store imports.
    configured = configuration.configured("store")
    if configured:
        return configured
    resolved = os.path.join(data_root(), f"{DATA_PREFIX}.sqlite3")
    protected = os.environ.get(PROTECTED_PATH_ENV, "")
    if protected and os.path.abspath(protected).lower() == os.path.abspath(resolved).lower():
        raise RuntimeError(
            "this process may not open the canonical store; point VALKAMA_DB at a"
            f" temporary file. Refused {resolved}."
        )
    return resolved


def _backups() -> store_backups.BackupLocation:
    """Where recovery points go, which follows the store's own path."""

    return store_backups.BackupLocation(
        os.path.join(os.path.dirname(db_path()), "backups"), DATA_PREFIX
    )


def _refuse_a_store_from_the_future(path: str) -> None:
    """The ratchet, applied to a store this build has not opened yet."""

    stored_version = _read_stored_version_without_write(path)
    if stored_version > STORE_SCHEMA_VERSION:
        raise StoreTooNewError(stored_version, STORE_SCHEMA_VERSION)


def adopt_legacy_store() -> str | None:
    """Adopt a store an earlier generation of this product wrote, once.

    The mechanics are `store_adoption`'s; the three things it needs are this
    module's to know -- where the store lives now, what its files are called,
    and which stored version this build refuses to touch.
    """

    return store_adoption.adopt(
        current_root=data_root(),
        current_prefix=DATA_PREFIX,
        refuse_a_store_from_the_future=_refuse_a_store_from_the_future,
    )


def _execute_script(conn: sqlite3.Connection, script: str) -> None:
    """Execute a schema script without sqlite3.executescript's implicit commit."""

    statement = ""
    for character in script:
        statement += character
        if character == ";" and sqlite3.complete_statement(statement):
            sql = statement.strip()
            statement = ""
            if sql:
                conn.execute(sql)
    if statement.strip():
        raise RuntimeError("incomplete SQL statement in schema")


SCHEMA_TABLES = (
    *planning_store.SCHEMA_TABLES,
    "sessions",
    "session_events",
    "execution_events",
    *execution_store.SCHEMA_TABLES,
    *platform_core.SCHEMA_TABLES,
    "owner_alert_settings",
)

#: What a session row learned to say about itself when session identity
#: arrived: the session a subagent row belongs to (or the one a resumed session
#: continues), the subagent's own id, the transcript the client reported and its
#: version. Appended to an existing table, declared last in the base schema.
_SESSION_IDENTITY_COLUMNS = (
    "parent_session_id",
    "agent_id",
    "transcript_path",
    "client_version",
)


def _identity_migration_needed(conn: sqlite3.Connection) -> bool:
    """Whether an existing store predates session identity.

    Asked before the first write, like every other gate on a recovery point:
    the answer decides whether a verified snapshot is taken first.
    """

    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "sessions" not in tables:
        return False
    columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
    return (
        "execution_events" not in tables
        or not set(_SESSION_IDENTITY_COLUMNS) <= columns
        or planning_store.identity_migration_needed(conn)
    )


def _migrate_session_identity(conn: sqlite3.Connection) -> None:
    """Give an existing `sessions` table the identity columns, once.

    Additive: every column is text with an empty default, the table's own
    style, so an older build's insert still lands and no row changes meaning.
    """

    columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
    for column in _SESSION_IDENTITY_COLUMNS:
        if column not in columns:
            conn.execute(f"ALTER TABLE sessions ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
    # Here rather than in the base schema: that runs before this, against a
    # table that does not have the column yet.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS sessions_parent ON sessions(parent_session_id)"
        " WHERE parent_session_id != ''"
    )


#: Where a session was last opened, added with schema 10: how (`opened_in`), in
#: what (`opened_host`), the folder of the last session start, and the id the
#: host application gives the session. Appended after the identity columns and
#: declared last in the base schema in the same order.
_SESSION_PLACE_COLUMNS = ("opened_in", "opened_host", "opened_folder", "host_session_id")


def _migrate_session_place(conn: sqlite3.Connection) -> None:
    """Give an existing `sessions` table the place columns, once.

    Additive and empty, like the identity columns: an empty value reads as "not
    known", which is true of every session recorded before them.
    """

    columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
    for column in _SESSION_PLACE_COLUMNS:
        if column not in columns:
            conn.execute(f"ALTER TABLE sessions ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")


def _assert_current_catalog(conn: sqlite3.Connection) -> None:
    """Refuse to stamp a store missing a table or column this build declares.

    Every table in `SCHEMA_TABLES` is checked, so a table added to the base
    schema is checked here without a line of its own.
    """

    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    missing = sorted(set(SCHEMA_TABLES) - tables)
    if missing:
        raise RuntimeError(f"post-migration store lacks {', '.join(missing)}")
    columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
    absent = [column for column in _SESSION_PLACE_COLUMNS if column not in columns]
    if absent:
        raise RuntimeError(f"post-migration sessions lacks {', '.join(absent)}")
    planning_store.assert_threads_postconditions(conn)


def _snapshot_before_new_tables(conn: sqlite3.Connection) -> str | None:
    """Back up a populated store that is about to gain a table.

    A brand new database has nothing to lose, so it is skipped: the point is the
    existing board, not the file.
    """
    existing = {
        row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    if "cards" not in existing:
        return None  # a fresh store, or one already past the cutover
    if set(SCHEMA_TABLES) <= existing:
        return None
    return store_backups.snapshot(conn, _backups(), "pretables")


class _LegacyMigrationStatus(NamedTuple):
    """What a Board-era store with `cards` and `events` still needs.

    `_migrate` (the writer) and `_store_data_migration_needs_snapshot` (the
    backup gate that must run before it) used to recompute this independently
    from the same PRAGMA and `sqlite_master` reads, in different shapes -- a
    list here, a bare `any()` there. A future column added to `MIGRATIONS`, a
    new `_LEGACY_EVENT_ACTIONS` entry, or a renamed index landing in one of
    them and not the other could let the destructive rewrite run without the
    backup gated by the other. One reading, shared by both, removes the
    chance of the two disagreeing.
    """

    pending_columns: tuple[str, ...]
    event_actions_pending: bool
    index_pending: bool

    @property
    def any_pending(self) -> bool:
        return bool(self.pending_columns) or self.event_actions_pending or self.index_pending


def _legacy_migration_status(conn: sqlite3.Connection) -> _LegacyMigrationStatus:
    """Read what a Board-era store still needs, once.

    The caller is responsible for having already established that `cards` and
    `events` exist -- `_migrate` through `board_domain_present`, the snapshot
    gate through its own table check -- exactly as each did before they shared
    this reading.
    """
    present = {row[1] for row in conn.execute("PRAGMA table_info(cards)")}
    pending_columns = tuple(
        statement for column, statement in MIGRATIONS.items() if column not in present
    )
    event_sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'"
    ).fetchone()[0]
    event_actions_pending = any(f"'{action}'" not in event_sql for action in _LEGACY_EVENT_ACTIONS)
    index_pending = (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='index'"
            " AND name='planning_improvement_source_unique'"
        ).fetchone()
        is None
    )
    return _LegacyMigrationStatus(pending_columns, event_actions_pending, index_pending)


def _migrate(conn: sqlite3.Connection) -> None:
    """Bring a Board-era store up to the last Board shape, before the cutover."""

    if not board_domain_present(conn):
        return
    status = _legacy_migration_status(conn)
    if not status.any_pending:
        return
    for statement in status.pending_columns:
        conn.execute(statement)
    if status.event_actions_pending:
        # SQLite cannot widen a CHECK constraint in place, so the table is
        # rebuilt with the current action set and every row carried over.
        _execute_script(
            conn,
            "ALTER TABLE events RENAME TO events_legacy;"
            + _LEGACY_EVENTS_TABLE.replace("IF NOT EXISTS ", "")
            + "INSERT INTO events(id,card_id,author,action,detail,created_at)"
            " SELECT id,card_id,author,action,detail,created_at FROM events_legacy;"
            "DROP TABLE events_legacy;"
            "CREATE INDEX IF NOT EXISTS events_card ON events(card_id,id);",
        )
    if status.index_pending:
        conn.execute(
            "CREATE UNIQUE INDEX planning_improvement_source_unique ON cards(source)"
            " WHERE source LIKE 'improvement://%'"
        )


def _store_data_migration_needs_snapshot(conn: sqlite3.Connection) -> bool:
    """Whether the legacy board schema will be mutated and carries durable data."""

    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "cards" not in tables or "events" not in tables:
        return False
    status = _legacy_migration_status(conn)
    if not status.any_pending:
        return False
    return bool(
        status.pending_columns
        or status.event_actions_pending
        or conn.execute("SELECT 1 FROM cards LIMIT 1").fetchone()
    )


#: The environment variable that permits the one-way conversion.
#:
#: It exists because the alternative was tried and did the damage it was warned
#: about. With the cutover unconditional inside `connect()`, *any* process that
#: opened the store performed it — and an MCP client respawns its session
#: automatically, so a single test that forgot to point `VALKAMA_DB` at a
#: temporary file converted the owner's live store, and every respawned session
#: converted it again. A one-way destructive operation is the owner's decision,
#: so it needs the owner's word: `valkama migrate planning-model` sets this.
CUTOVER_ENV = "VALKAMA_CUTOVER"


class CutoverRequiredError(RuntimeError):
    """The store still holds the Board domain and no one has authorised the move."""


def cutover_permitted() -> bool:
    return os.environ.get(CUTOVER_ENV, "") == "1"


def migrate_planning_cutover(conn: sqlite3.Connection) -> dict | None:
    """Convert the Board domain into Planning, once, inside the caller's transaction.

    Everything moves together on purpose. The card rows become work items, the
    Kernel's adapter links and resource bindings are repointed at the identities
    those items now carry, and only then are the old tables dropped. Splitting
    any of it out would leave a window where a project's binding names a space
    that does not exist yet, which reads as "unbound" rather than as a failure.

    The caller owns the verified snapshot; this function only reads the old
    tables and writes the new ones, so a refusal anywhere leaves the store
    exactly as it was.
    """

    if not board_domain_present(conn):
        return None
    metadata = store_metadata.read_store_metadata(conn)
    result = planning_migration.migrate_board_domain(
        conn,
        project_for_space=_project_for_space(str(metadata["data_scope_id"])),
    )
    mapping = result.pop("card_to_work_item")
    adapter_links = platform_relations.migrate_links_to_work_items(
        conn, mapping, result.pop("card_space_keys")
    )
    rebound = platform_migrations.migrate_planning_pointers(conn, result.pop("board_space_keys"))
    sessions_moved = _migrate_session_work_items(conn, mapping)
    drop_board_domain(conn)
    result["sessions"] = sessions_moved
    return {**result, "adapter_links": adapter_links, "rebound": rebound}


def _migrate_session_work_items(conn: sqlite3.Connection, mapping: dict[int, str]) -> int:
    """Point every observed session at the work item its card became.

    An existing `sessions` table keeps the column the Board era gave it, because
    `CREATE TABLE IF NOT EXISTS` leaves a present table alone. A session naming a
    card that the migration did not carry keeps no pointer at all rather than an
    integer nothing resolves: the session itself is still observed evidence.
    """

    columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
    if "card_id" not in columns:
        return 0
    rows = conn.execute("SELECT id, card_id FROM sessions WHERE card_id IS NOT NULL").fetchall()
    conn.execute("ALTER TABLE sessions RENAME COLUMN card_id TO work_item_id")
    conn.execute("UPDATE sessions SET work_item_id = NULL")
    moved = 0
    for row in rows:
        item = mapping.get(int(row["card_id"]))
        if item is None:
            continue
        conn.execute("UPDATE sessions SET work_item_id = ? WHERE id = ?", (item, str(row["id"])))
        moved += 1
    return moved


def _project_for_space(data_scope_id: str) -> dict[str, str]:
    """Map canonical space keys to Projects through exact owner bindings."""

    mapping: dict[str, str] = {}
    listing = project_registry.read_registry()
    if listing["status"] != "available":
        return mapping
    for project in listing["projects"]:
        resource_ref = project["planning_binding"]
        if resource_ref is None:
            continue
        space_ref = planning_space_ref(resource_ref)
        if space_ref["data_scope_id"] != data_scope_id:
            continue
        space_key = str(space_ref["space_key"])
        if space_key in mapping:
            raise RuntimeError("planning space has competing exact Project bindings")
        mapping[space_key] = str(project["project_id"])
    return mapping


def _read_stored_version_without_write(path: str) -> int:
    probe = sqlite3.connect(f"file:{os.path.abspath(path)}?mode=ro", uri=True)
    try:
        return int(probe.execute("PRAGMA user_version").fetchone()[0])
    finally:
        probe.close()


def connect() -> sqlite3.Connection:
    adopt_legacy_store()
    path = db_path()
    # Refuse a future schema before even the migration lock/directory can be
    # created. The in-lock probe below repeats this check against a concurrent
    # replacement of the file.
    if os.path.exists(path):
        stored_version = _read_stored_version_without_write(path)
        if stored_version > STORE_SCHEMA_VERSION:
            raise StoreTooNewError(stored_version, STORE_SCHEMA_VERSION)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with store_lock.migration_lock(path):
        first_store = not os.path.exists(path)
        if not first_store:
            # A read-only probe is deliberately first. A stale binary therefore
            # refuses without creating or changing the database file. Beside a
            # store in WAL mode SQLite may still leave empty `-wal` and `-shm`
            # files, which hold nothing and are rebuilt on the next open.
            stored_version = _read_stored_version_without_write(path)
            if stored_version > STORE_SCHEMA_VERSION:
                raise StoreTooNewError(stored_version, STORE_SCHEMA_VERSION)
        conn = sqlite3.connect(path, timeout=5)
        conn.row_factory = sqlite3.Row
        try:
            stored_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
            if stored_version > STORE_SCHEMA_VERSION:
                raise StoreTooNewError(stored_version, STORE_SCHEMA_VERSION)

            # Classify and snapshot before the first persistent pragma or schema
            # write. Every upgrade of an existing store takes one named, reusable
            # recovery point, labelled for the oldest step it covers. A store
            # older than 8 still goes through the classification and the
            # historical row migrations, under the label those have always used;
            # a store at 8 needs the step that drops the retired tables and is
            # labelled for it; a store at 9 needs only schema 10's steps.
            #
            # The schema-9 steps are bound to `stored_version < 9`, not to
            # "older than this build": bound to the ratchet, they would give a
            # store at 9 a recovery point named for a step it does not take and
            # the schema-8 catalog to drop again.
            upgrade = not first_store and stored_version < STORE_SCHEMA_VERSION
            historical = upgrade and stored_version < 8
            before_schema9 = upgrade and stored_version < 9
            source_identity = None
            source_generation = None
            pretable_backup = None
            if historical:
                source_generation = platform_migrations.classify_product_model_source(
                    conn, stored_version
                )
                _, source_identity = store_backups.verified_snapshot(
                    conn, "preproductmodel", locate=_backups
                )
            elif before_schema9:
                _, source_identity = store_backups.verified_snapshot(
                    conn, "preschema9", locate=_backups
                )
            elif upgrade:
                _, source_identity = store_backups.verified_snapshot(
                    conn, "preschema10", locate=_backups
                )
            else:
                pretable_backup = _snapshot_before_new_tables(conn)
                if store_rename.predates_rename(conn) and pretable_backup is None:
                    pretable_backup = store_backups.snapshot(conn, _backups(), "prerename")
            if (
                _store_data_migration_needs_snapshot(conn)
                and pretable_backup is None
                and source_identity is None
            ):
                pretable_backup = store_backups.snapshot(conn, _backups(), "preupgrade")

            if planning_store.interactions_migration_needed(conn) and source_identity is None:
                _, source_identity = store_backups.verified_snapshot(
                    conn, "preinteractions", locate=_backups
                )
            # Session identity is additive, so it takes its own recovery point
            # only when nothing above took one already for this same open.
            if (
                source_identity is None
                and pretable_backup is None
                and _identity_migration_needed(conn)
            ):
                _, source_identity = store_backups.verified_snapshot(
                    conn, "preidentity", locate=_backups
                )

            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("BEGIN IMMEDIATE")
            if source_identity is not None:
                store_backups.integrity_check(conn, source="source store")
                if store_backups.logical_identity(conn) != source_identity:
                    raise RuntimeError("source store drifted after its migration snapshot")

            if store_rename.predates_rename(conn):
                store_rename.migrate_off_former_name(conn)
            if platform_migrations.module_registry_migration_needed(conn):
                platform_migrations.migrate_module_registry(conn)
            # The Planning tables come first and alone, because the cutover has
            # to read the Board tables and write the new ones before the rest of
            # the schema can be applied: the adapter-link index names columns
            # that only exist once the cutover has rebuilt that table.
            if board_domain_present(conn):
                if not cutover_permitted():
                    raise CutoverRequiredError(
                        "this store still holds the Board domain. Run"
                        " `valkama migrate planning-model` once to convert it;"
                        " the conversion is one-way and takes a verified snapshot first."
                    )
                _execute_script(conn, planning_store.SCHEMA)
                _migrate(conn)
                migrate_planning_cutover(conn)
            # A table this build adds, schema 10's included, is declared in
            # `SCHEMA` alone, with its name in `SCHEMA_TABLES`: run against an
            # upgraded store inside this transaction and under its recovery
            # point, the script creates it exactly as in a fresh store, and
            # `_assert_current_catalog` checks it by that name.
            _execute_script(conn, SCHEMA)
            if before_schema9:
                # The steps below were written against schema 8's catalog, which
                # this build no longer declares; the last step drops it again.
                platform_migrations.ensure_schema8_catalog(conn)
            planning_store.migrate_discussion(conn)
            planning_store.migrate_interactions(conn)
            planning_store.migrate_cancelled_state(conn)
            planning_store.migrate_identity(conn)
            _migrate_session_identity(conn)
            # Schema 10: columns cannot come from the script, which leaves an
            # existing table alone, so they are appended here.
            planning_store.migrate_threads(conn)
            _migrate_session_place(conn)
            audit_migration = platform_migrations.schema_migration_needed(conn)
            audit_order_migration = platform_migrations.registry_audit_order_migration_needed(conn)
            authorization_migration = platform_migrations.authorization_owner_migration_needed(conn)
            owner_migration = store_metadata.store_owner_migration_needed(conn)
            if (
                (
                    audit_migration
                    or audit_order_migration
                    or authorization_migration
                    or owner_migration
                )
                and pretable_backup is None
                and source_identity is None
            ):
                # This branch is retained for additive pre-ratchet stores. The
                # schema-4 cutover always used the verified snapshot above.
                raise RuntimeError("platform migration requires a pre-mutation snapshot")
            if audit_migration:
                platform_migrations.migrate_schema(conn)
            if audit_migration or audit_order_migration:
                # `migrate_schema` appends the column, so a store that has just
                # gained it needs the same normalization as one that gained it
                # long ago.
                platform_migrations.migrate_registry_audit_order(conn)
            if owner_migration:
                store_metadata.migrate_store_owner(conn)
            if authorization_migration:
                platform_migrations.migrate_authorization_owner_model(conn)
            if historical and source_generation not in {
                "planning-only",
                "neutral-catalog",
            }:
                platform_migrations.migrate_product_model(conn)
            if historical:
                platform_migrations.retire_work_support_modules(conn)
            if before_schema9:
                # Schema 9: the registry's tables, the module rows with their
                # audit, and the integration switches nothing has written since
                # the registry replaced them. The recovery point holds them.
                platform_migrations.drop_retired_tables(conn)
                conn.execute("DROP TABLE IF EXISTS integration_settings")
            # No "is this a new store" flag: bring-up writes the store's
            # identity only when it is missing, which is the same answer for a
            # store being created and one being upgraded.
            platform_core.initialize(conn, path, caller_owns_transaction=True)
            platform_migrations.assert_product_model_postconditions(conn)
            _assert_current_catalog(conn)
            # The full check reads every page, so it runs where something was
            # migrated -- a recovery point was taken or the stamp moves -- and
            # not on every open of a store that is already current.
            if (
                stored_version != STORE_SCHEMA_VERSION
                or source_identity is not None
                or pretable_backup is not None
            ):
                store_backups.integrity_check(conn, source="post-migration store")
            # The schema ratchet is the final statement in the same transaction.
            if stored_version != STORE_SCHEMA_VERSION:
                conn.execute(f"PRAGMA user_version={STORE_SCHEMA_VERSION}")
            conn.commit()
            return conn
        except BaseException:
            conn.rollback()
            conn.close()
            raise
