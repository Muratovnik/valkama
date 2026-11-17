"""SQLite storage: the schema, the order a store is brought up in, and the connection.

Everything else in the package reads and writes through `connect()`, or reads a
store that bring-up already finished through `connect_for_read()`, and what
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

import contextlib
import datetime
import os
import platform
import sqlite3
import sys
import tempfile
from collections.abc import Iterator, Mapping
from typing import Any

from . import store_adoption, store_backups, store_lock, store_rename, store_steps
from .analytics import store as analytics_store
from .executions import store as execution_store
from .ops import configuration
from .planning import images as planning_images
from .planning import item_projects_map, work_model_migration
from .planning import store as planning_store
from .planning import words as planning_words
from .platform import core as platform_core
from .platform import migrations as platform_migrations
from .quota import store as quota_store
from .store_identity import metadata as store_metadata
from .telemetry import liveness, usage_store

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
    # How much was worked on what, added with schema 11. Additive and empty in an
    # upgraded store, so this script is the whole of its migration.
    + usage_store.SCHEMA
    # How often each analytics surface was opened, added with schema 16. Additive
    # and empty in an upgraded store, so this script is the whole of its migration.
    + analytics_store.SCHEMA
    # The quota accounts, samples and settings, added with schema 17. Additive and empty in an
    # upgraded store, so this script is the whole of its migration.
    + quota_store.SCHEMA
)


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
#
# 11 added the usage tables, and no existing row changed its meaning. It is raised
# so the upgrade takes a recovery point of its own, and because a build at 10 would
# run on while nothing keeps those tables current, which reads as work that stopped.
#
# 12 let a question stand on a root comment as the list of choices under it
# (`work_item_requests.comment_id`), added the `mentioned` event and a person's
# pins (`pinned_work_items`). A build at 11 would refuse a whole card over the
# event it does not know, raise an alert for a list as if it were a question
# waiting on the person, and carry a list away from its comment in a merge; the
# ratchet makes it refuse a store at 12 instead.
#
# 13 added what a session follows beside what it holds (`work_item_subscriptions`)
# and a comment that waits for a reply (`work_item_comments.awaits_reply`, 0 on
# every comment there was), with an index of the links by the item they point to.
# No existing row changed its meaning. It is raised so the upgrade takes a recovery
# point of its own, and because a build at 12 would leave a merged item's
# subscriptions on the closed duplicate and never let a lapsed one go, so a session
# would go on hearing an item it had left.
#
# 14 added the pictures pasted into an item's text (`work_item_images`), whose files
# live in `images/` beside the store. No existing row changed its meaning. It is
# raised so the upgrade takes a recovery point of its own, and because a build at
# 13 would delete an item and leave its pictures' files behind, and a screenshot
# that outlives the item it was pasted into is what deleting the item promised to
# take away. 14 also lets a summary and a description mention other items: a
# `mentioned` event's detail is then `description:` and the id of the item whose
# description named it, where every earlier one was a comment's id, which a build
# at 13 reads as a number and refuses the whole card over.
#
# 15 added the `labels_changed` event, the label set before and after an edit that
# changed it. The event table is rebuilt for its CHECK, so the upgrade takes a
# recovery point of its own, and a build at 14 would refuse a whole card over the
# event it does not know; the ratchet makes it refuse a store at 15 instead.
#
# 16 counts a request once in the whole store: `usage_requests` is keyed by the request
# alone, where every run kept its own rows, and the upgrade keeps one row of each request
# several runs counted. A build at 15 would take a request another run counts for one
# its own run never counted, add its tokens again, and lose its own row to the key
# without a word (`INSERT OR IGNORE`). 16 also gives a usage run the
# reading its rows came from (every run stale after the upgrade, so the reader reads it
# again), the requests each run left to another (`usage_yields`, empty until the runs are
# read again), a segment the columns its later dimensions fill, and Analytics the counts of
# how often each of its surfaces was opened (`analytics_surface_uses`, empty).
#
# 17 added the subscription quota's accounts, the owner's names for them, samples, the
# alerts given about them and the owner's settings for its sources (`quota_accounts`,
# `quota_account_names`, `quota_samples`, `quota_alerts`, `quota_settings`), empty in an
# upgraded store, and no existing row changed its meaning.
# It is raised so the upgrade takes a recovery point of its own, and because what opens
# a store without bringing it up -- a hook's `ingest.open_light`, the listener's reader,
# `open_read_only` -- takes the stamp for the catalog: a quota source of this build would
# write into a store at 16 that has no quota tables yet, where stamped 17 it waits for a
# full open, and a build at 16 would keep samples past their year.
#
# 18 is the work model: eight categories in place of `backlog` and `queued` with a
# service state beside them in every workflow, the `container` kind in place of
# `epic`, the `accepted`, `opened` and `child_left` events, and a trigger that keeps a
# container out of the states work is held in. Existing rows change their meaning, so
# no build before it may read a store at 18, and this one opens a store at 17 only
# once `migrate work-model` has carried it forward.
#
# 19 stores how a request on a closed item ended. A close writes every request still
# pending on its item `expired`, as `item_completed` or `item_cancelled`, where a
# build at 18 left the row pending and read it `task_closed` while the item stayed
# closed; a request also names its `purpose`. A build at 18 would read a request
# ended by a close as pending again once its item reopened, and refuse the whole
# request over a reason it does not know; the ratchet makes it refuse a store at 19.
#
# 20 keeps the owner's participation setting and the rules of the labels
# (`participation_settings`, `label_settings`), empty in a migrated store, which reads
# as the default set. The owner sets there where an agent's decision waits for them; a
# build at 19 would read none of it and let an agent go ahead where the owner chose to
# decide, so the ratchet makes it refuse a store at 20. The same schema marks the
# decisions an agent took on its own (`agent_decisions`), and holds the writes that wait
# for the owner's answer (`pending_actions`, named by their questions' `action_id`), both
# empty in a migrated store. The work-model migration carries a store at 17 straight to 20.
STORE_SCHEMA_VERSION = 20


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


#: The schema Valkama 2.9 leaves a store at. 2.8 left the same number without the
#: word index, so a store of 2.9 is told apart by that index.
RELEASE_2_9_SCHEMA_VERSION = 17


class StoreTooOldError(RuntimeError):
    """The store predates Valkama 2.9, so this build leaves it untouched.

    The steps that carried a store from an earlier generation are Valkama 2.9's, and
    that release keeps them: opened there first, the store reaches the shape the
    work-model migration starts from.
    """

    def __init__(self, stored: int) -> None:
        super().__init__(
            f"this store is at schema {stored} and only a store that Valkama 2.9 left,"
            f" at schema {RELEASE_2_9_SCHEMA_VERSION} with its word index, can be carried"
            " to this build: open it with Valkama 2.9 first."
        )
        self.stored = stored


class WorkModelMigrationRequiredError(RuntimeError):
    """A store Valkama 2.9 left, which this build opens only after the work-model migration.

    Its rows mean what the old model meant, so nothing of this build reads or writes
    them until the one explicit command has carried the store forward.
    """

    def __init__(self, stored: int) -> None:
        super().__init__(
            f"this store is at schema {stored}; run `valkama migrate work-model` once"
            " with every session stopped; it takes a verified recovery point first"
        )
        self.stored = stored


class WorkModelPreconditionError(RuntimeError):
    """A 2.9 store the work-model migration does not start on, and why.

    Raised before the recovery point and before any write, so the store is left as
    it was. `report` is the run's report, its status `refused`.
    """

    def __init__(self, message: str, report: dict[str, Any]) -> None:
        super().__init__(message)
        self.report = report


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


def backup_location(path: str | None = None) -> store_backups.BackupLocation:
    """Where recovery points go, which follows the store's own path, with its pictures.

    The configured store's, or the one at `path`.
    """

    path = path or db_path()
    return store_backups.BackupLocation(
        os.path.join(os.path.dirname(path), "backups"),
        DATA_PREFIX,
        planning_images.directory_beside(path),
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
    *usage_store.SCHEMA_TABLES,
    *analytics_store.SCHEMA_TABLES,
    *quota_store.SCHEMA_TABLES,
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
    planning_store.assert_links_postconditions(conn)
    usage_store.assert_current(conn)


def _read_stored_version_without_write(path: str) -> int:
    probe = sqlite3.connect(f"file:{os.path.abspath(path)}?mode=ro", uri=True)
    try:
        return int(probe.execute("PRAGMA user_version").fetchone()[0])
    finally:
        probe.close()


def refuse_another_generation(conn: sqlite3.Connection, *, first_store: bool = False) -> None:
    """Refuse a store of any schema but this build's, naming what brings it here.

    Newer is `StoreTooNewError`. A store Valkama 2.9 left, at its schema with the
    word index, is `WorkModelMigrationRequiredError`; anything older, a store of 2.8
    at the same number included, is `StoreTooOldError`. A file that holds no table
    yet is not a store of an earlier build: it is created as a fresh one, as a
    missing file is.
    """

    stored_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    if stored_version > STORE_SCHEMA_VERSION:
        raise StoreTooNewError(stored_version, STORE_SCHEMA_VERSION)
    if first_store or stored_version == STORE_SCHEMA_VERSION:
        return
    if conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone() is None:
        return
    indexed = (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (planning_words.ROWS,),
        ).fetchone()
        is not None
    )
    if stored_version == RELEASE_2_9_SCHEMA_VERSION and indexed:
        raise WorkModelMigrationRequiredError(stored_version)
    raise StoreTooOldError(stored_version)


def _probe_generation(path: str) -> None:
    """`refuse_another_generation` on an existing file, through a read-only connection."""

    probe = sqlite3.connect(f"file:{os.path.abspath(path)}?mode=ro", uri=True)
    try:
        refuse_another_generation(probe)
    finally:
        probe.close()


def open_read_only() -> sqlite3.Connection:
    """The store for one quick read: nothing is created, migrated, locked or written.

    A store this build did not bring to its own schema is refused rather than read,
    the same rule a hook's direct write keeps. A store that is not there is an
    `sqlite3.OperationalError` too, and the short timeout makes a busy one a refusal.
    """

    conn = sqlite3.connect(_uri(db_path(), "ro"), uri=True, timeout=0.25)
    try:
        stored_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        if stored_version != STORE_SCHEMA_VERSION:
            raise sqlite3.OperationalError("the store is not at this build's schema")
    except BaseException:
        conn.close()
        raise
    return conn


def _uri(path: str, mode: str) -> str:
    """The store's file as an SQLite URI that opens it in `mode` and never creates it."""

    absolute = os.path.abspath(path).replace(os.sep, "/")
    escaped = absolute.replace("%", "%25").replace("?", "%3f").replace("#", "%23")
    prefix = "file:" if escaped.startswith("/") else "file:/"
    return f"{prefix}{escaped}?mode={mode}"


def connect_for_read() -> sqlite3.Connection:
    """The store for a request that commits nothing: `connect()` without a bring-up it
    does not need.

    `connect()` holds the migration lock across the whole bring-up, which on a store
    already at this build's schema still runs every check and the picture sweep, tens
    of milliseconds of statements. Reads that arrived together therefore went one at a
    time, each waiting out the lock for all the ones before it. A store at this build's
    schema is opened here as `connect()` leaves it -- rows by name, foreign keys on, the
    same busy timeout -- with no lock and no write. Any other store, or none, goes
    through `connect()`, which adopts, creates, migrates or refuses it as it always has.

    Nothing is lost by the skip: once `connect()` has returned, its connection holds no
    lock either, so a migration by another process could already commit between any two
    statements of a read.
    """

    try:
        conn = sqlite3.connect(_uri(db_path(), "rw"), uri=True, timeout=5)
    except sqlite3.OperationalError:
        return connect()
    try:
        current = int(conn.execute("PRAGMA user_version").fetchone()[0]) == STORE_SCHEMA_VERSION
        if current:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys=ON")
            return conn
    except BaseException:
        conn.close()
        raise
    conn.close()
    return connect()


def connect(path: str | None = None) -> sqlite3.Connection:
    """The configured store brought up to this build, or the one at `path`.

    A store at `path` is the caller's own -- a fresh one to compare another with --
    so no earlier generation's directory is adopted for it.
    """

    if path is None:
        adopt_legacy_store()
        path = db_path()
    located = path

    def locate() -> store_backups.BackupLocation:
        return backup_location(located)

    # Refuse a store of another generation, newer or older, before even the
    # migration lock/directory can be created. The in-lock probes below repeat
    # this check against a concurrent replacement of the file.
    if os.path.exists(path):
        _probe_generation(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with store_lock.migration_lock(path):
        first_store = not os.path.exists(path)
        if not first_store:
            # A read-only probe is deliberately first. A stale binary therefore
            # refuses without creating or changing the database file. Beside a
            # store in WAL mode SQLite may still leave empty `-wal` and `-shm`
            # files, which hold nothing and are rebuilt on the next open.
            _probe_generation(path)
        conn = sqlite3.connect(path, timeout=5)
        conn.row_factory = sqlite3.Row
        try:
            refuse_another_generation(conn, first_store=first_store)
            stored_version = int(conn.execute("PRAGMA user_version").fetchone()[0])

            # Classify and snapshot before the first persistent pragma or schema
            # write. Every upgrade of an existing store takes one named, reusable
            # recovery point, labelled for the oldest step it covers. A store
            # older than 8 still goes through the classification and the
            # historical row migrations, under the label those have always used;
            # a store at 8 needs the step that drops the retired tables and is
            # labelled for it; a store at 9 needs only schema 10's steps, one at
            # 10 only schema 11's to 17's, one at 11 only schema 12's to 17's, one
            # at 12 only schema 13's to 17's, one at 13 only schema 14's to 17's, one
            # at 14 only schema 15's to 17's, one at 15 only schema 16's and 17's, and
            # one at 16 only schema 17's.
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
            recovery_point = None
            if historical:
                source_generation = platform_migrations.classify_product_model_source(
                    conn, stored_version
                )
                recovery_point, source_identity = store_backups.verified_snapshot(
                    conn, "preproductmodel", locate=locate
                )
            elif before_schema9:
                recovery_point, source_identity = store_backups.verified_snapshot(
                    conn, "preschema9", locate=locate
                )
            elif upgrade:
                recovery_point, source_identity = store_backups.verified_snapshot(
                    conn, f"preschema{stored_version + 1}", locate=locate
                )
            if recovery_point is not None:
                # From schema 16 on the upgrade leaves every usage run to be read again,
                # and what a reading makes of time depends on the liveness file, which
                # no snapshot of the store holds: its verified copy goes beside it.
                liveness.copy_beside(path, recovery_point, DATA_PREFIX)
            elif store_rename.predates_rename(conn):
                pretable_backup = store_backups.snapshot(conn, locate(), "prerename")

            if planning_store.interactions_migration_needed(conn) and source_identity is None:
                _, source_identity = store_backups.verified_snapshot(
                    conn, "preinteractions", locate=locate
                )
            # A `relates-to` link stored from both ends loses its later record, which
            # only a recovery point keeps; an upgrade's covers it, and a store already
            # at this schema takes its own. The step raises no schema: a build before
            # it reads the one record as it read any link, and the index turns its
            # `INSERT OR IGNORE` of a mirror into nothing.
            if (
                planning_store.symmetric_mirrors_present(conn)
                and source_identity is None
                and pretable_backup is None
            ):
                _, source_identity = store_backups.verified_snapshot(
                    conn, "prerelatesonce", locate=locate
                )
            # Session identity is additive, so it takes its own recovery point
            # only when nothing above took one already for this same open.
            if (
                source_identity is None
                and pretable_backup is None
                and _identity_migration_needed(conn)
            ):
                _, source_identity = store_backups.verified_snapshot(
                    conn, "preidentity", locate=locate
                )
            # The word index adds tables and triggers and changes no row, so it takes
            # its own recovery point only when nothing above took one for this open.
            if (
                source_identity is None
                and pretable_backup is None
                and planning_words.migration_needed(conn)
            ):
                _, source_identity = store_backups.verified_snapshot(
                    conn, "prewords", locate=locate
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
            planning_store.migrate_identity(conn)
            _migrate_session_identity(conn)
            # Schema 10: columns cannot come from the script, which leaves an
            # existing table alone, so they are appended here.
            planning_store.migrate_threads(conn)
            # A mirror written between the read above and this transaction would be
            # deleted with no recovery point holding it: refused, the next open takes one.
            if (
                planning_store.symmetric_mirrors_present(conn)
                and source_identity is None
                and pretable_backup is None
            ):
                raise RuntimeError("merging mirrored links requires a pre-mutation snapshot")
            planning_store.migrate_symmetric_links(conn)
            _migrate_session_place(conn)
            # Schema 16: the usage columns, and one row per request in the whole store.
            usage_store.migrate(conn)
            # The word index, after every step that adds a column its triggers name.
            planning_words.migrate(conn)
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
            # Under this open's write lock, so no upload stands between its file and
            # its row: a picture file no row names is nobody's and goes.
            planning_images.sweep(conn)
            # The schema ratchet is the final statement in the same transaction.
            if stored_version != STORE_SCHEMA_VERSION:
                conn.execute(f"PRAGMA user_version={STORE_SCHEMA_VERSION}")
            conn.commit()
            return conn
        except BaseException:
            conn.rollback()
            conn.close()
            raise


# -- the work-model migration ----------------------------------------------------

#: The label of the recovery point `migrate_work_model` takes before its first write.
WORK_MODEL_LABEL = "pre3.0"
_ALREADY = "the work-model migration has already run"


def store_generation(path: str) -> str:
    """`current` for a store of this build, `2.9` for one Valkama 2.9 left.

    Any other store is refused as `refuse_another_generation` refuses it, and a file
    that holds no table as a store older than 2.9 would be: none of them is one the
    work-model migration carries. Read through a read-only connection, so a refused
    store is left as it was.
    """

    if not os.path.isfile(path):
        raise FileNotFoundError(f"there is no store at {path}")
    probe = sqlite3.connect(_uri(path, "ro"), uri=True)
    try:
        try:
            refuse_another_generation(probe)
        except WorkModelMigrationRequiredError:
            return "2.9"
        stored = int(probe.execute("PRAGMA user_version").fetchone()[0])
        if stored != STORE_SCHEMA_VERSION:
            raise StoreTooOldError(stored)
        return "current"
    finally:
        probe.close()


def copy_store(source: str, directory: str) -> str:
    """A copy of the store at `source` in `directory`, with its pictures beside it.

    `VACUUM INTO` through a read-only connection: a store in WAL mode keeps its latest
    commits in its journal, which a copy of the file alone would miss, and the source
    is never opened for writing. `directory` must not hold a store already.
    """

    os.makedirs(directory, exist_ok=True)
    destination = os.path.join(directory, f"{DATA_PREFIX}.sqlite3")
    if os.path.exists(destination):
        raise FileExistsError(f"{destination} already exists")
    conn = sqlite3.connect(_uri(source, "ro"), uri=True)
    try:
        conn.execute("VACUUM INTO ?", (destination,))
    finally:
        conn.close()
    store_backups.copy_pictures(
        planning_images.directory_beside(source), planning_images.directory_beside(destination)
    )
    return destination


def _environment(path: str) -> dict[str, Any]:
    """What the timing of a run depends on: the machine, the SQLite and the store's size."""

    probe = sqlite3.connect(_uri(path, "ro"), uri=True)
    try:
        pages = int(probe.execute("PRAGMA page_count").fetchone()[0])
        page_size = int(probe.execute("PRAGMA page_size").fetchone()[0])
    finally:
        probe.close()
    memory = sqlite3.connect(":memory:")
    try:
        memory.execute("CREATE VIRTUAL TABLE probe USING fts5(text)")
        fts5 = True
    except sqlite3.OperationalError:
        fts5 = False
    finally:
        memory.close()
    journal = path + "-wal"
    return {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "cpus": os.cpu_count(),
        "python": sys.version.split()[0],
        "sqlite": sqlite3.sqlite_version,
        "fts5": fts5,
        "pages": pages,
        "page_size": page_size,
        "store_bytes": os.path.getsize(path),
        "journal_bytes": os.path.getsize(journal) if os.path.exists(journal) else 0,
    }


@contextlib.contextmanager
def _fresh_store() -> Iterator[sqlite3.Connection]:
    """A store as this build creates one, in a directory of its own that goes after it."""

    with tempfile.TemporaryDirectory(prefix="valkama-fresh-", ignore_cleanup_errors=True) as tmp:
        conn = connect(os.path.join(tmp, f"{DATA_PREFIX}.sqlite3"))
        try:
            yield conn
        finally:
            conn.close()


def _recovery_point_holds(
    conn: sqlite3.Connection, context: store_steps.Context
) -> Mapping[str, Any]:
    """`recovery-point`: the recovery point holds the store exactly as the migration found it.

    Its logical identity is the source's, read when it was taken and again inside the
    migration's transaction before the first write, and every picture is beside it.
    Restoring it is copying it into the store's place, as `README.md` describes.
    """

    del conn
    held = store_backups.snapshot_identity(context.recovery_point)
    if held != context.source_identity:
        raise store_steps.UnmetError("the recovery point does not hold the source store")
    if context.identity_before != context.source_identity:
        raise store_steps.UnmetError(
            "the store changed between its recovery point and the migration"
        )
    try:
        store_backups.verify_pictures(context.recovery_point, context.images)
    except RuntimeError as error:
        raise store_steps.UnmetError(str(error)) from error
    return {"recovery_point": context.recovery_point, "identity": held}


RECOVERY_POINT = store_steps.Postcondition(
    "recovery-point", "the recovery point holds the store as it was", _recovery_point_holds
)


def migrate_work_model(
    path: str | None = None, *, item_projects: str | None = None
) -> dict[str, Any]:
    """Carry a store Valkama 2.9 left to the work model, once, and report the run.

    The only way a store at Valkama 2.9's schema reaches this build: `connect()`
    refuses one with `WorkModelMigrationRequiredError`, which names this. A store of
    this build is left alone and reported `current`; any other is refused as
    `store_generation` refuses it, untouched.

    Under the store's migration lock the conditions to start are read first, from
    the store, the project registry and the file `item_projects` names, which
    `valkama projects map-items` wrote (`planning.item_projects_map`); one that does
    not hold raises `WorkModelPreconditionError`, the report `refused`, before any
    write. Then a verified recovery point labelled `WORK_MODEL_LABEL` is taken,
    with the pictures beside it. Then, with
    foreign keys off -- set before the transaction, since SQLite ignores the pragma
    inside one -- the steps of `planning.work_model_migration` run in one
    transaction, the schema is stamped and every postcondition is checked; a failed
    step or postcondition rolls all of it back and raises `store_steps.RunFailedError`
    carrying the report. After the commit the word index is brought current.

    Every phase is timed in the report, which also says what the run ran on.
    """

    path = os.path.abspath(path or db_path())
    report = store_steps.new_report("work-model")
    report.update(store=path, schema={"from": STORE_SCHEMA_VERSION, "to": STORE_SCHEMA_VERSION})
    with store_steps.phase(report, "total"):
        try:
            _migrate_work_model(path, report, item_projects)
        except store_steps.RunFailedError:
            report["status"] = "failed"
            raise
    return report


def _preconditions(
    conn: sqlite3.Connection, item_projects: str | None, report: dict[str, Any]
) -> dict[str, Any]:
    """The conditions to start, read through `conn` before any write; the memo they leave."""

    with store_steps.phase(report, "preconditions"):
        try:
            raw = None
            if item_projects is not None:
                with open(item_projects, "rb") as handle:
                    raw = handle.read()
            return item_projects_map.preconditions(conn, raw)
        except (OSError, item_projects_map.RefusedError) as error:
            report.update(status="refused", message=str(error))
            raise WorkModelPreconditionError(str(error), report) from error


def _migrate_work_model(path: str, report: dict[str, Any], item_projects: str | None) -> None:
    if store_generation(path) == "current":
        report.update(status="current", message=_ALREADY)
        return
    report["schema"]["from"] = RELEASE_2_9_SCHEMA_VERSION
    report["environment"] = _environment(path)
    with store_lock.migration_lock(path):
        # Again under the lock: another process may have run it meanwhile.
        if store_generation(path) == "current":
            report.update(status="current", message=_ALREADY)
            return
        conn = sqlite3.connect(path, timeout=5)
        conn.row_factory = sqlite3.Row
        try:
            memo = _preconditions(conn, item_projects, report)
            timings: dict[str, float] = {}
            with store_steps.phase(report, "recovery_point"):
                recovery_point, source_identity = store_backups.verified_snapshot(
                    conn,
                    WORK_MODEL_LABEL,
                    locate=lambda: backup_location(path),
                    timings=timings,
                )
            report["phases"] += [
                {"name": f"recovery_point.{name}", "seconds": seconds}
                for name, seconds in timings.items()
            ]
            report["recovery_point"] = recovery_point
            conn.execute("PRAGMA foreign_keys=OFF")
            conn.execute("BEGIN IMMEDIATE")
            try:
                with store_steps.phase(report, "identity_in_transaction"):
                    before = store_backups.logical_identity(conn)
                context = store_steps.Context(
                    now=datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    recovery_point=recovery_point,
                    source_identity=source_identity,
                    identity_before=before,
                    images=backup_location(path).images,
                    reference=_fresh_store,
                    memo=memo,
                )
                store_steps.run(
                    conn,
                    steps=work_model_migration.STEPS,
                    postconditions=(*work_model_migration.POSTCONDITIONS, RECOVERY_POINT),
                    context=context,
                    report=report,
                    schema=STORE_SCHEMA_VERSION,
                )
                with store_steps.phase(report, "commit"):
                    conn.commit()
            except BaseException:
                conn.rollback()
                raise
            conn.execute("PRAGMA foreign_keys=ON")
            with store_steps.phase(report, "bring_current"):
                conn.execute("BEGIN IMMEDIATE")
                planning_words.bring_current(conn)
                conn.commit()
        finally:
            conn.close()
    report["status"] = "migrated"
