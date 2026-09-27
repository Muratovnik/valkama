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
from .platform import scope as platform_scope
from .platform.contracts import planning_space_ref
from .projects import project_registry

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
    ended_at TEXT
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
CREATE TABLE IF NOT EXISTS integration_settings(
    integration_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
"""
    # After both of the tables it points at: an execution names a work item and
    # the sessions that carried it, and a foreign key wants its target to exist.
    + execution_store.SCHEMA
    + platform_core.SCHEMA
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
# improvements database keeps its own version in its own file, so the two never
# meet. Raise this in the same commit that changes what an existing row means,
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
STORE_SCHEMA_VERSION = 6


class StoreTooNewError(RuntimeError):
    """This build is older than the store it was pointed at."""

    def __init__(self, stored: int, supported: int) -> None:
        super().__init__(
            f"this store is at schema {stored} and this build understands {supported}."
            " It was written by a newer Valkama, so opening it here could misread"
            " rows a later version defined. Restart the client so it spawns the"
            " server that matches this checkout."
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
    "integration_settings",
    *execution_store.SCHEMA_TABLES,
    *platform_core.SCHEMA_TABLES,
)


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
    metadata = platform_scope.read_store_metadata(conn)
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
            # refuses without creating or changing the database, WAL, or SHM.
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
            # write. Schema 3 -> 4 has one named, reusable recovery point.
            product_model_migration = not first_store and stored_version < STORE_SCHEMA_VERSION
            source_identity = None
            source_generation = None
            skills_route_state_migration = False
            pretable_backup = None
            if product_model_migration:
                source_generation = platform_migrations.classify_product_model_source(
                    conn, stored_version
                )
                # The current-shape pre-ratchet store needs one narrow descriptor
                # rewrite, not a reader alias. Schema 2/3 descriptors are instead
                # replaced by the broad product-model migrations below.
                if source_generation == "current-unstamped":
                    skills_route_state_migration = (
                        platform_migrations.skills_route_state_migration_needed(conn)
                    )
                _, source_identity = store_backups.verified_snapshot(
                    conn, "preproductmodel", locate=_backups
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
            _execute_script(conn, SCHEMA)
            audit_migration = platform_migrations.schema_migration_needed(conn)
            audit_order_migration = platform_migrations.registry_audit_order_migration_needed(conn)
            authorization_migration = platform_migrations.authorization_owner_migration_needed(conn)
            owner_migration = platform_scope.store_owner_migration_needed(conn)
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
                platform_scope.migrate_store_owner(conn)
            if authorization_migration:
                platform_migrations.migrate_authorization_owner_model(conn)
            if product_model_migration and source_generation not in {
                "planning-only",
                "current-unstamped",
            }:
                platform_migrations.migrate_product_model(conn)
            if skills_route_state_migration:
                platform_migrations.migrate_skills_route_state(conn)
            # No "is this a new store" flag: the Kernel writes whichever
            # module rows are missing, which is the same answer for a store
            # being created and one that predates a module.
            platform_core.initialize(conn, path, caller_owns_transaction=True)
            platform_migrations.assert_product_model_postconditions(conn)
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
