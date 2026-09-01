"""Every store shape this product has written, and the way forward from each.

`store.connect()` is the only caller. It reads a store, classifies which
generation wrote it, and runs the migrations below in the order that module
states; nothing here touches the `Platform` runtime class, and nothing here
decides when it runs. What lives here is the knowledge that outlives a release:
the exact column tuples and `CREATE TABLE` text of shapes no build writes any
more, the catalog signature that proves a store is exactly one of them, the
normalizers that carry a legacy row into the current record, the seven forward
migrations themselves, and the postconditions that prove the result before the
schema stamp is written.

It is kept apart from `core` because it grows differently. A migration is
written once, is never edited again, and is deleted only when the shape it
carries can no longer exist on a real disk -- so this file accumulates while
the runtime beside it stays the size of what the product does today. `core`
owns the current schema, the current records and the Kernel; this owns their
history, and the dependency runs that way only.

The catalogue of source shapes is deliberately literal. A signature comparison
that described a table instead of replaying it would drift from the store it
claims to recognise, which is how two column orders of the same six columns
came to exist in the field at once.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import sqlite3
from collections.abc import Callable, Mapping

from . import modules as platform_modules
from .capabilities import CAPABILITY_DEFINITIONS
from .contracts import (
    ContractError,
    planning_space_entity,
    validate_action_input_descriptor,
    validate_adapter_manifest,
    validate_assignment,
    validate_connection,
    validate_entity_ref,
    validate_module_manifest,
    validate_operating_scope,
)

# The current shape, borrowed rather than restated. A migration's last act is to
# produce exactly what a fresh store declares, so the schema text, the table
# list and the reader that proves a module row are `core`'s answers and this
# module is their second reader. The underscored primitives below travel with
# them for the same reason: a second copy of the canonical JSON encoding or
# the timestamp format would be a second answer to what a row looks like, and a
# migration whose output disagreed with the runtime by one separator is exactly
# the failure the postconditions exist to catch.
from .core import (
    AUTHORIZATION_OWNER_MODEL,
    REGISTRY_SCHEMA,
    SCHEMA,
    SCHEMA_TABLES,
    _connection_key,
    _execute_schema,
    _json,
    _now,
    _planning_resources,
    _table_present,
    modules_payload,
)
from .registry import RegistryError

_RELEASED_SCHEMA2_MODULE_MANIFEST_HASHES = {
    "planning": "b008651d89d43c08d6986fa52b7b1bf486f93908d30cfdd78ff4d24cafe96a1a",
    "sessions": "79c2a25cc83499336cf4bfe450811d1e590e691a0ba6a237d566a6aa78f0927c",
    "analytics": "014136c6c7cf8a6a60e558daa66fd082f4d09e678236e1f573476f298a055c7e",
    "improvements": "eaad9b163eab87ddf2c575db72035cf015d46e493368a4a35675e0688a6d92fa",
    "skills": "9fb8823e5874f56838ba3381638f53dfb07079ada3933772460c4b9f20c6c284",
    "settings": "77b7fde917d933f290208eb69dbe665f5a28fa5f91616726bac3dcba1ba4c959",
}

_RELEASED_SKILLS_ROUTE_STATE_KEYS = ["query", "source_scope", "activation"]
_CURRENT_SKILLS_ROUTE_STATE_KEYS = ["query", "status", "view"]


def _skills_route_state_manifest(conn: sqlite3.Connection) -> dict | None:
    """Read the one built-in Skills descriptor a pre-ratchet store may hold."""

    if not _table_present(conn, "platform_modules"):
        return None
    row = conn.execute(
        "SELECT record_json FROM platform_modules WHERE module_id='skills'"
    ).fetchone()
    if row is None:
        return None
    try:
        manifest = validate_module_manifest(json.loads(row["record_json"]))
    except (TypeError, json.JSONDecodeError, ContractError) as error:
        raise RegistryError("persisted Skills module descriptor is malformed") from error
    if manifest["module_id"] != "skills":
        raise RegistryError("persisted Skills module identity is malformed")
    return manifest


def skills_route_state_migration_needed(conn: sqlite3.Connection) -> bool:
    """Whether Skills still carries the one released pre-schema-6 route shape.

    The two accepted answers are deliberately exact. An unknown list is not
    treated as another spelling of either generation, and the current reader
    never accepts the former keys once this transaction has stamped the store.
    """

    manifest = _skills_route_state_manifest(conn)
    if manifest is None:
        return False
    allowed_keys = manifest["state_schema"]["allowed_keys"]
    if allowed_keys == _CURRENT_SKILLS_ROUTE_STATE_KEYS:
        return False
    if allowed_keys != _RELEASED_SKILLS_ROUTE_STATE_KEYS:
        raise RegistryError("persisted Skills route state generation is unrecognized")
    return True


def migrate_skills_route_state(conn: sqlite3.Connection) -> bool:
    """Write the schema-6 Skills route vocabulary once, preserving row state."""

    if not skills_route_state_migration_needed(conn):
        return False
    manifest = _skills_route_state_manifest(conn)
    if manifest is None:  # pragma: no cover - fenced by the predicate above
        return False
    manifest["state_schema"]["allowed_keys"] = list(_CURRENT_SKILLS_ROUTE_STATE_KEYS)
    conn.execute(
        "UPDATE platform_modules SET record_json=? WHERE module_id='skills'",
        (_json(manifest),),
    )
    return True


def _legacy_board_names(values) -> None:
    """Every entry in a schema-3 known-store inventory is a board name."""

    for value in values:
        if not isinstance(value, str) or not value.strip() or value != value.strip():
            raise ContractError("known_stores.boards_json[] must be trimmed text")
        if len(value) > 120:
            raise ContractError("known_stores.boards_json[] exceeds its bound")


def module_registry_migration_needed(conn: sqlite3.Connection) -> bool:
    """Whether the existing module table still uses registration lifecycle state."""

    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_modules'"
        ).fetchone()
        is None
    ):
        return False
    columns = {row[1] for row in conn.execute("PRAGMA table_info(platform_modules)")}
    return not {"mutable", "revision"} <= columns


def _normalize_schema2_module_manifest(module_id: str, value: object) -> dict:
    current_manifests = {item["module_id"]: item for item in platform_modules.module_manifests()}
    if module_id not in current_manifests:
        raise RegistryError("persisted module has no current manifest")
    try:
        normalized = validate_module_manifest(value)
    except ContractError as error:
        validation_error: ContractError | None = error
    else:
        if normalized == current_manifests[module_id]:
            return normalized
        validation_error = None
    digest = hashlib.sha256(_json(value).encode("utf-8")).hexdigest()
    if _RELEASED_SCHEMA2_MODULE_MANIFEST_HASHES.get(module_id) != digest:
        raise RegistryError("persisted module descriptor is malformed") from validation_error
    return current_manifests[module_id]


def migrate_planning_pointers(conn: sqlite3.Connection, space_keys: dict) -> dict:
    """Re-encode every Kernel pointer that spelled a planning space as a board.

    Two things outside Planning name a space: a project's resource binding and
    the known-store inventory. Both encoded `{data_scope_id, board_name}`, and
    both must come out of the migration's transaction encoding
    `{data_scope_id, space_key}` — a binding left behind would leave its project
    pointing at an identity nothing answers to, which reads as "unbound" rather
    than as a failure.

    `space_keys` maps the old board name to the key of the space it became; the
    name is the only join the old encoding carried.
    """

    rebound = {"project_resource_bindings": 0, "known_stores": 0}
    # There is no bindings table: a project's bindings live in the workspace
    # registry file, which `project_registry` normalises on read. Only the store's
    # own inventory is rewritten here.
    if _table_present(conn, "platform_known_stores"):
        # The inventory column depends on how far this store had come: schema 3
        # held board *names*, the current shape holds encoded resource refs. A
        # migration reads whichever it is handed.
        columns = {row[1] for row in conn.execute("PRAGMA table_info(platform_known_stores)")}
        legacy = "boards_json" in columns
        column = "boards_json" if legacy else "resources_json"
        rows = conn.execute(
            f"SELECT data_scope_id, {column} AS payload FROM platform_known_stores"
            " ORDER BY data_scope_id"
        ).fetchall()
        for row in rows:
            try:
                values = json.loads(str(row["payload"]))
            except json.JSONDecodeError:
                continue
            if not isinstance(values, list):
                continue
            converted: list = []
            changed = False
            for value in values:
                if legacy:
                    key = space_keys.get(str(value))
                    converted.append(key if key is not None else value)
                    changed = changed or key is not None
                    continue
                encoded = _rebound_resource(_json(value), space_keys)
                converted.append(value if encoded is None else json.loads(encoded))
                changed = changed or encoded is not None
            if not changed:
                continue
            conn.execute(
                f"UPDATE platform_known_stores SET {column} = ? WHERE data_scope_id = ?",
                (_json(converted), str(row["data_scope_id"])),
            )
            rebound["known_stores"] += 1
    return rebound


def _rebound_resource(encoded: str, space_keys: dict) -> str | None:
    """One stored resource ref, re-encoded, or nothing when it is not a space."""

    try:
        record = json.loads(encoded)
    except json.JSONDecodeError:
        return None
    if not isinstance(record, dict) or record.get("kind") != "planning-space":
        return None
    resource_id = str(record.get("resource_id", ""))
    padded = resource_id + "=" * (-len(resource_id) % 4)
    try:
        decoded = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as error:
        raise RegistryError("a planning-space binding is not readable") from error
    if not isinstance(decoded, dict) or "board_name" not in decoded:
        return None
    name = str(decoded["board_name"])
    if name not in space_keys:
        raise RegistryError(f"a project binds board {name!r}, which no planning space replaces")
    return _json(
        planning_space_entity(
            {"data_scope_id": str(decoded["data_scope_id"]), "space_key": space_keys[name]}
        )
    )


def migrate_module_registry(
    conn: sqlite3.Connection, *, after_rewrite: Callable[[], None] | None = None
) -> bool:
    """Rewrite the canonical table in place; the caller owns the verified snapshot."""

    if not module_registry_migration_needed(conn):
        return False
    rows = conn.execute(
        "SELECT module_id,record_json,state,updated_at FROM platform_modules ORDER BY module_id"
    ).fetchall()
    normalized = []
    for row in rows:
        if row["state"] != "registered":
            raise RegistryError("persisted module lifecycle cannot be mapped to enablement")
        try:
            stored_manifest = json.loads(row["record_json"])
            manifest = _normalize_schema2_module_manifest(row["module_id"], stored_manifest)
        except (TypeError, json.JSONDecodeError, RegistryError) as error:
            raise RegistryError("persisted module descriptor is malformed") from error
        if manifest["module_id"] != row["module_id"]:
            raise RegistryError("persisted module identity disagrees with its descriptor")
        normalized.append((row, manifest))
    conn.execute(
        """CREATE TABLE platform_modules_product_model(
                   module_id TEXT PRIMARY KEY,
                   record_json TEXT NOT NULL,
                   state TEXT NOT NULL CHECK(state IN ('enabled','disabled')),
                   mutable INTEGER NOT NULL CHECK(mutable IN (0,1)),
                   revision INTEGER NOT NULL CHECK(revision > 0),
                   updated_at TEXT NOT NULL
               )"""
    )
    for row, manifest in normalized:
        conn.execute(
            "INSERT INTO platform_modules_product_model"
            "(module_id,record_json,state,mutable,revision,updated_at) VALUES(?,?,?,?,?,?)",
            (
                row["module_id"],
                _json(manifest),
                "enabled",
                int(manifest["module_id"] != "settings"),
                1,
                row["updated_at"],
            ),
        )
    if after_rewrite is not None:
        after_rewrite()
    conn.execute("DROP TABLE platform_modules")
    conn.execute("ALTER TABLE platform_modules_product_model RENAME TO platform_modules")
    return True


def schema_migration_needed(conn: sqlite3.Connection) -> bool:
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_registry_audit'"
        ).fetchone()
        is None
    ):
        return False
    return "detail_json" not in {
        tuple(row)[1] for row in conn.execute("PRAGMA table_info(platform_registry_audit)")
    }


def migrate_schema(conn: sqlite3.Connection) -> bool:
    """Add bounded audit details; caller owns the pre-migration snapshot."""

    if not schema_migration_needed(conn):
        return False
    conn.execute(_AUDIT_DETAIL_COLUMN_SQL)
    return True


def registry_audit_order_migration_needed(conn: sqlite3.Connection) -> bool:
    """Detect an audit table whose `detail_json` was appended by ALTER TABLE."""

    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_registry_audit'"
        ).fetchone()
        is None
    ):
        return False
    return _table_columns(conn, "platform_registry_audit") == _APPENDED_DETAIL_AUDIT_COLUMNS


def migrate_registry_audit_order(conn: sqlite3.Connection) -> bool:
    """Give the audit table the column order a fresh store declares.

    Nothing reads differently either way: the same six columns hold the same
    values. What differs is the catalog signature, and schema 4 proves that
    signature exactly, so leaving two orders in the field would leave two
    shapes. The rows move by name, and the table's own indexes come back from
    the schema rather than from a second copy of their definitions here.
    """

    if not registry_audit_order_migration_needed(conn):
        return False
    columns = ",".join(_CURRENT_PLATFORM_COLUMNS["platform_registry_audit"])
    for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index'"
        " AND tbl_name='platform_registry_audit' AND sql IS NOT NULL"
    ).fetchall():
        conn.execute('DROP INDEX "' + str(row[0]) + '"')
    conn.execute("ALTER TABLE platform_registry_audit RENAME TO platform_registry_audit_legacy")
    _execute_schema(conn, REGISTRY_SCHEMA)
    conn.execute(
        f"INSERT INTO platform_registry_audit({columns})"
        f" SELECT {columns} FROM platform_registry_audit_legacy"
    )
    conn.execute("DROP TABLE platform_registry_audit_legacy")
    return True


def authorization_owner_migration_needed(conn: sqlite3.Connection) -> bool:
    """Detect stores initialized by the former binding-derived auth seed."""

    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_registry_meta'"
        ).fetchone()
        is None
    ):
        return False
    marker = conn.execute(
        "SELECT value FROM platform_registry_meta WHERE key='authorization_owner_model'"
    ).fetchone()
    if marker is not None:
        if str(marker[0]) != AUTHORIZATION_OWNER_MODEL:
            raise RegistryError("unknown persisted authorization owner model")
        return False
    return any(
        conn.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone() is not None
        for table in ("platform_connections", "platform_assignments", "platform_grants")
    )


def migrate_authorization_owner_model(conn: sqlite3.Connection) -> bool:
    """One-time cutover from implicit binding grants to explicit owner state."""

    marker = conn.execute(
        "SELECT value FROM platform_registry_meta WHERE key='authorization_owner_model'"
    ).fetchone()
    if marker is not None:
        if str(marker[0]) != AUTHORIZATION_OWNER_MODEL:
            raise RegistryError("unknown persisted authorization owner model")
        return False
    changed = False
    for table, id_column, owner_field, implicit_owner in (
        ("platform_grants", "grant_id", "granted_by", "project-registry"),
    ):
        for row in conn.execute(f"SELECT {id_column},record_json FROM {table}").fetchall():
            record = json.loads(row["record_json"])
            if record.get(owner_field) == implicit_owner:
                conn.execute(f"DELETE FROM {table} WHERE {id_column}=?", (row[id_column],))
                changed = True
    for row in conn.execute(
        "SELECT connection_key,record_json FROM platform_connections"
    ).fetchall():
        record = json.loads(row["record_json"])
        if record.get("trust") == "unknown":
            continue
        record["trust"] = "unknown"
        conn.execute(
            "UPDATE platform_connections SET record_json=?,updated_at=? WHERE connection_key=?",
            (_json(validate_connection(record)), _now(), row["connection_key"]),
        )
        changed = True
    conn.execute(
        "INSERT INTO platform_registry_meta(key,value) VALUES ('authorization_owner_model',?)",
        (AUTHORIZATION_OWNER_MODEL,),
    )
    return changed


def _table_columns(conn: sqlite3.Connection, table: str) -> tuple[str, ...]:
    return tuple(str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})"))


_CURRENT_PLATFORM_COLUMNS = {
    "platform_store_metadata": (
        "singleton",
        "data_scope_id",
        "owner_id",
        "is_primary",
        "is_writable",
        "created_at",
    ),
    "platform_adapter_links": (
        "id",
        "data_scope_id",
        "space_key",
        "work_item_id",
        "service_owner_id",
        "service_id",
        "adapter_lineage_id",
        "connection_id",
        "resource_type",
        "external_id",
        "fallback_label",
        "provenance_json",
        "state",
        "created_at",
    ),
    "platform_modules": ("module_id", "record_json", "state", "mutable", "revision", "updated_at"),
    "platform_services": ("service_key", "record_json", "state", "updated_at"),
    "platform_adapters": ("adapter_lineage_id", "adapter_id", "record_json", "state", "updated_at"),
    "platform_connections": ("connection_key", "record_json", "state", "updated_at"),
    "platform_assignments": ("assignment_id", "record_json", "state", "revision", "updated_at"),
    "platform_grants": ("grant_id", "record_json", "state", "updated_at"),
    "platform_actions": ("action_id", "record_json", "state", "updated_at"),
    "platform_action_inputs": ("action_id", "record_json", "updated_at"),
    "platform_core_ref_bindings": ("core_ref_kind", "record_json", "state", "updated_at"),
    "platform_packages": ("package_key", "record_json", "state", "updated_at"),
    "platform_known_stores": (
        "data_scope_id",
        "alias",
        "resources_json",
        "registry_revision",
        "is_primary",
        "is_attached",
        "is_writable",
        "updated_at",
    ),
    "platform_registry_meta": ("key", "value"),
    "platform_registry_audit": (
        "sequence",
        "event_kind",
        "entity_kind",
        "entity_id",
        "detail_json",
        "at",
    ),
    "platform_ui_prefs": ("key", "record_json", "updated_at"),
}
_SCHEMA3_ASSIGNMENT_COLUMNS = ("assignment_id", "record_json", "state", "updated_at")
# `detail_json` reached existing stores through ALTER TABLE ADD COLUMN, which
# appends. A store created after it went into the schema declares it before
# `at`. Same six columns, two orders, and schema 4 proves its catalog by exact
# signature — so the older order is a known source shape that migrates forward.
# What `platform_adapter_links` looked like while it pointed at cards. It is a
# source shape only: the cutover rebuilds the table, so nothing writes it again.
_BOARD_ERA_LINK_COLUMNS = (
    "id",
    "data_scope_id",
    "board_name",
    "card_id",
    "service_owner_id",
    "service_id",
    "adapter_lineage_id",
    "connection_id",
    "resource_type",
    "external_id",
    "fallback_label",
    "provenance_json",
    "state",
    "created_at",
)
_BOARD_ERA_LINK_SCHEMA = """
CREATE TABLE IF NOT EXISTS platform_adapter_links(
    id INTEGER PRIMARY KEY,
    data_scope_id TEXT NOT NULL,
    board_name TEXT NOT NULL,
    card_id INTEGER NOT NULL,
    service_owner_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    adapter_lineage_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    external_id TEXT NOT NULL,
    fallback_label TEXT NOT NULL DEFAULT '',
    provenance_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'resolved' CHECK(state IN ('resolved','unavailable','missing','ambiguous','malformed')),
    created_at TEXT NOT NULL,
    FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
    UNIQUE(data_scope_id, board_name, card_id, service_owner_id, service_id,
           adapter_lineage_id, connection_id, resource_type, external_id)
);
CREATE INDEX IF NOT EXISTS platform_adapter_links_card
  ON platform_adapter_links(data_scope_id, board_name, card_id);
"""

_APPENDED_DETAIL_AUDIT_COLUMNS = (
    "sequence",
    "event_kind",
    "entity_kind",
    "entity_id",
    "at",
    "detail_json",
)
_SCHEMA2_MODULE_COLUMNS = ("module_id", "record_json", "state", "updated_at")
_SCHEMA3_KNOWN_STORE_COLUMNS = (
    "data_scope_id",
    "alias",
    "boards_json",
    "registry_revision",
    "is_primary",
    "is_attached",
    "is_writable",
    "updated_at",
)
_FORMER_PLATFORM_TABLES = {
    name.replace("platform_", "hub_", 1) for name in _CURRENT_PLATFORM_COLUMNS
}
_LEGACY_ADAPTER_CAPABILITIES = {
    "agentmemory-reference-v1": ["memory.open", "memory.health"],
    "notes-reference-v1": ["memory.open"],
}
_LEGACY_REFERENCE_CAPABILITY_SET = {
    "stable-pointer",
    "allowlisted-open",
    "generic-relation",
}
_SCHEMA3_ASSIGNMENT_SQL = """CREATE TABLE platform_assignments(
    assignment_id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('enabled','disabled','tombstoned')),
    updated_at TEXT NOT NULL
)"""
_SCHEMA3_KNOWN_STORE_SQL = """CREATE TABLE platform_known_stores(
    data_scope_id TEXT PRIMARY KEY,
    alias TEXT NOT NULL,
    boards_json TEXT NOT NULL,
    registry_revision INTEGER NOT NULL,
    is_primary INTEGER NOT NULL CHECK(is_primary IN (0,1)),
    is_attached INTEGER NOT NULL CHECK(is_attached IN (0,1)),
    is_writable INTEGER NOT NULL CHECK(is_writable IN (0,1)),
    updated_at TEXT NOT NULL
)"""
_SCHEMA2_MODULE_SQL = """CREATE TABLE platform_modules(
    module_id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','tombstoned')),
    updated_at TEXT NOT NULL
)"""
_PRE_DETAIL_AUDIT_SQL = """CREATE TABLE platform_registry_audit(
    sequence INTEGER PRIMARY KEY,
    event_kind TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    at TEXT NOT NULL
)"""
_AUDIT_DETAIL_COLUMN_SQL = (
    "ALTER TABLE platform_registry_audit ADD COLUMN detail_json TEXT NOT NULL DEFAULT '{}'"
)


def _normalize_catalog_sql(sql: str, *, prefix: str) -> str:
    canonical = sql.replace(prefix, "platform_") if prefix != "platform_" else sql
    return re.sub(r'[\s"`\[\]]+', "", canonical).lower()


def _catalog_signature(conn: sqlite3.Connection, *, prefix: str) -> tuple:
    actual_tables = {
        canonical.replace("platform_", prefix, 1): canonical for canonical in SCHEMA_TABLES
    }
    tables = []
    indexes: list[tuple[str, str, int, int, tuple[tuple[str, int, str], ...], str | None]] = []
    for actual, canonical in sorted(actual_tables.items(), key=lambda item: item[1]):
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (actual,)
        ).fetchone()
        if row is None or row[0] is None:
            raise RegistryError(f"{actual} source table definition is missing")
        tables.append((canonical, _normalize_catalog_sql(str(row[0]), prefix=prefix)))
        for index in conn.execute(f'PRAGMA index_list("{actual}")'):
            index_name = str(index[1])
            columns = tuple(
                (str(item[2]), int(item[3]), str(item[4]))
                for item in conn.execute(f'PRAGMA index_xinfo("{index_name}")')
                if int(item[5])
            )
            if str(index[3]) == "c":
                definition = conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type='index' AND name=?", (index_name,)
                ).fetchone()
                indexes.append(
                    (
                        index_name.replace(prefix, "platform_", 1),
                        canonical,
                        int(index[2]),
                        int(index[4]),
                        columns,
                        _normalize_catalog_sql(str(definition[0]), prefix=prefix),
                    )
                )
            else:
                indexes.append(
                    (f"<{index[3]}>", canonical, int(index[2]), int(index[4]), columns, None)
                )
    owned_names = set(actual_tables)
    for row in conn.execute(
        "SELECT name,tbl_name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
    ):
        name, table = str(row[0]), str(row[1])
        if name.startswith(("platform_", "hub_")) and table not in owned_names:
            indexes.append((name.replace(prefix, "platform_", 1), table, -1, -1, (), "<extra>"))
    return tuple(tables), tuple(sorted(indexes))


def _reference_catalog_signature(
    generation: str, *, appended_audit_detail: bool = False, board_era_links: bool = False
) -> tuple:
    reference = sqlite3.connect(":memory:")
    try:
        _execute_schema(reference, SCHEMA)
        if board_era_links:
            # Replay the shape rather than describing it, for the same reason as
            # the audit column below: the table's index travels with it.
            reference.execute("DROP TABLE platform_adapter_links")
            _execute_schema(reference, _BOARD_ERA_LINK_SCHEMA)
        if appended_audit_detail:
            # Replay how the column arrived rather than describing the result:
            # dropping the table takes its indexes with it, re-running the
            # schema brings them back, and the ALTER appends exactly as it did
            # on the store being classified.
            reference.execute("DROP TABLE platform_registry_audit")
            reference.execute(_PRE_DETAIL_AUDIT_SQL)
            _execute_schema(reference, REGISTRY_SCHEMA)
            reference.execute(_AUDIT_DETAIL_COLUMN_SQL)
        if generation in {"schema-2", "schema-3"}:
            reference.execute("DROP TABLE platform_assignments")
            reference.execute(_SCHEMA3_ASSIGNMENT_SQL)
            reference.execute("DROP TABLE platform_known_stores")
            reference.execute(_SCHEMA3_KNOWN_STORE_SQL)
        if generation == "schema-2":
            reference.execute("DROP TABLE platform_modules")
            reference.execute(_SCHEMA2_MODULE_SQL)
        return _catalog_signature(reference, prefix="platform_")
    finally:
        reference.close()


def _assert_exact_catalog(
    conn: sqlite3.Connection,
    *,
    generation: str,
    prefix: str,
    appended_audit_detail: bool = False,
    board_era_links: bool = False,
) -> None:
    reference = _reference_catalog_signature(
        generation,
        appended_audit_detail=appended_audit_detail,
        board_era_links=board_era_links,
    )
    if _catalog_signature(conn, prefix=prefix) != reference:
        raise RegistryError(f"{prefix} source catalog signature is not exact")


def _neutral_adapter_record(row: Mapping[str, object]) -> dict:
    try:
        adapter = json.loads(str(row["record_json"]))
    except (TypeError, json.JSONDecodeError) as error:
        raise RegistryError("persisted adapter descriptor is malformed") from error
    adapter["consumes"] = [
        "work-item" if item == "card" else item for item in adapter.get("consumes", ())
    ]
    capabilities = adapter.get("capabilities")
    if (
        capabilities is None
        or capabilities == []
        or (
            isinstance(capabilities, list)
            and len(capabilities) == 3
            and set(capabilities) == _LEGACY_REFERENCE_CAPABILITY_SET
        )
    ):
        try:
            capabilities = _LEGACY_ADAPTER_CAPABILITIES[str(row["adapter_lineage_id"])]
        except KeyError as error:
            raise RegistryError("legacy adapter capability lineage is unmapped") from error
    elif (
        not isinstance(capabilities, list)
        or not capabilities
        or any(item not in CAPABILITY_DEFINITIONS for item in capabilities)
        or len(capabilities) != len(set(capabilities))
    ):
        raise RegistryError("legacy adapter capability values are unmapped")
    adapter["capabilities"] = capabilities
    for contribution in adapter.get("contributions", ()):
        contribution["entity_kinds"] = [
            "work-item" if item == "card" else item for item in contribution.get("entity_kinds", ())
        ]
    stored_lineage = adapter.pop("adapter_lineage_id", row["adapter_lineage_id"])
    stored_state = adapter.pop("state", row["state"])
    try:
        adapter = validate_adapter_manifest(adapter)
    except ContractError as error:
        raise RegistryError("persisted adapter cannot be cut over to the neutral model") from error
    if (
        stored_lineage != row["adapter_lineage_id"]
        or stored_state != row["state"]
        or adapter["adapter_id"] != row["adapter_id"]
        or row["state"] not in {"registered", "tombstoned"}
        or not isinstance(row["updated_at"], str)
        or not row["updated_at"]
    ):
        raise RegistryError("persisted adapter identity or lifecycle is malformed")
    return {
        **adapter,
        "adapter_lineage_id": row["adapter_lineage_id"],
        "state": row["state"],
    }


def _merge_assignments_by_capability_and_scope(
    converted: list[tuple[dict, int, str]],
) -> list[tuple[dict, int, str]]:
    """Reduce history's per-adapter assignments to one per capability and scope.

    A legacy assignment named one adapter, so one scope could hold several of
    them for the same capability. The neutral record names the capability and
    holds the Connections chosen for it, and the registry allows exactly one per
    scope — a store carrying two would refuse to load at all, which is how this
    was found, on a real one.

    Merging chooses nothing. A single-source capability that ends up holding
    more than one Connection resolves to its typed unavailable state, so the
    owner sees both candidates and picks; picking here would be the silent
    selection the Kernel exists to prevent.
    """

    merged: dict[tuple[str, str], tuple[dict, int, str]] = {}
    for record, revision, updated_at in sorted(
        converted, key=lambda item: item[0]["assignment_id"]
    ):
        scope = record["scope"]
        key = (
            record["capability_id"],
            "installation" if scope["kind"] == "installation" else f"project:{scope['project_id']}",
        )
        held = merged.get(key)
        if held is None:
            merged[key] = (record, revision, updated_at)
            continue
        first, first_revision, first_updated = held
        connection_ids = list(first["connection_ids"])
        for connection_id in record["connection_ids"]:
            if connection_id not in connection_ids:
                connection_ids.append(connection_id)
        combined = validate_assignment(
            {
                **first,
                "connection_ids": connection_ids,
                # Enabled if history had it enabled anywhere: the owner turned
                # this capability on, and the conflict is what needs saying, not
                # a state they never chose.
                "state": "enabled"
                if "enabled" in {first["state"], record["state"]}
                else first["state"],
            }
        )
        merged[key] = (
            combined,
            max(first_revision, revision),
            max(first_updated, updated_at),
        )
    return list(merged.values())


def _neutral_assignment_record(row: Mapping[str, object]) -> tuple[dict, int]:
    capability_by_lineage = {
        "agentmemory-reference-v1": "memory.open",
        "notes-reference-v1": "memory.open",
    }
    try:
        record = json.loads(str(row["record_json"]))
        if set(record) != {
            "assignment_id",
            "adapter_lineage_id",
            "applicability",
            "connection_refs",
            "activation",
            "revision",
            "changed_by",
            "default_connection_ref",
        }:
            raise TypeError("legacy assignment fields are not exact")
        if record["assignment_id"] != row["assignment_id"]:
            raise TypeError("legacy assignment identity disagrees")
        if row["state"] not in {"enabled", "disabled"} or record["activation"] != row["state"]:
            raise TypeError("legacy assignment lifecycle disagrees")
        revision = record["revision"]
        if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
            raise TypeError("legacy assignment revision is invalid")
        capability_id = capability_by_lineage[record["adapter_lineage_id"]]
        applicability = record["applicability"]
        if applicability == {"kind": "global"}:
            scope = {"kind": "installation"}
        elif (
            isinstance(applicability, dict)
            and set(applicability) == {"kind", "project_ref"}
            and applicability["kind"] == "project"
            and isinstance(applicability["project_ref"], dict)
            and set(applicability["project_ref"]) == {"project_id"}
        ):
            scope = {
                "kind": "project",
                "project_id": applicability["project_ref"]["project_id"],
            }
        else:
            raise TypeError("legacy assignment applicability is invalid")
        connection_ids = [_connection_key(item) for item in record["connection_refs"]]
        default_id = _connection_key(record["default_connection_ref"])
        if default_id not in connection_ids:
            raise TypeError("legacy assignment default connection is not assigned")
        converted = validate_assignment(
            {
                "assignment_id": row["assignment_id"],
                "capability_id": capability_id,
                "scope": scope,
                "connection_ids": connection_ids,
                "state": row["state"],
                "changed_by": record["changed_by"],
            }
        )
    except (KeyError, TypeError, json.JSONDecodeError, ContractError) as error:
        raise RegistryError("legacy assignment cannot be mapped without guessing") from error
    return converted, revision


def _neutral_ui_prefs_record(row: Mapping[str, object], *, legacy: bool) -> dict:
    try:
        record = json.loads(str(row["record_json"]))
        if not isinstance(record, dict):
            raise TypeError("UI preference must be an object")
        # `board_ref` is what a legacy record on disk is called. Renaming it
        # here would refuse every stored preference: the field is history, and
        # the conversion below is what makes it current.
        allowed = {"module_id", "scope", "board_ref" if legacy else "resource_ref"}
        if not {"module_id", "scope"} <= set(record) or set(record) - allowed:
            raise TypeError("UI preference fields are not exact")
        if row["key"] != "last-route" or record["module_id"] not in platform_modules.module_ids():
            raise TypeError("UI preference identity is invalid")
        result = {
            "module_id": record["module_id"],
            "scope": validate_operating_scope(record["scope"]),
        }
        if legacy and "board_ref" in record:
            result["resource_ref"] = _space_entity_from_board_ref(record["board_ref"])
        elif not legacy and "resource_ref" in record:
            result["resource_ref"] = validate_entity_ref(record["resource_ref"])
        if not isinstance(row["updated_at"], str) or not row["updated_at"]:
            raise TypeError("UI preference timestamp is invalid")
        return result
    except (KeyError, TypeError, json.JSONDecodeError, ContractError) as error:
        raise RegistryError("persisted UI preference cannot be mapped without guessing") from error


def _space_entity_from_board_ref(value: object) -> dict:
    """One legacy `board_ref` as the planning-space entity it now names.

    The board name is the join; the space it became carries the key. A name no
    space answers to is refused rather than guessed, which is the whole point of
    reading a stored preference at all.
    """

    if not isinstance(value, dict) or set(value) != {"data_scope_id", "board_name"}:
        raise TypeError("legacy board_ref fields are not exact")
    return planning_space_entity(
        {
            "data_scope_id": str(value["data_scope_id"]),
            "space_key": _derive_space_key(str(value["board_name"])),
        }
    )


def _derive_space_key(board_name: str) -> str:
    """The key the migration derives from a board name, restated for a read.

    Planning owns the rule; the Kernel may not import Planning, so this states
    the same three-letter derivation for the one case that has to read a stored
    preference written before the conversion.
    """

    letters = [character for character in board_name.upper() if character.isalnum()]
    if not letters:
        raise TypeError("legacy board_ref names no derivable space key")
    return "".join(letters[:3])


def _neutral_action_input_record(row: Mapping[str, object], *, legacy: bool) -> dict:
    try:
        record = json.loads(str(row["record_json"]))
        if not isinstance(record, dict):
            raise TypeError("action input descriptor must be an object")
        fields = record.get("fields")
        if not isinstance(fields, list):
            raise TypeError("action input descriptor fields must be a list")
        translated = []
        for field in fields:
            if not isinstance(field, dict):
                raise TypeError("action input descriptor field must be an object")
            # `card_ref` is what a legacy descriptor on disk calls its subject.
            # The field name is history; translating it is the conversion.
            if field.get("key") == "card_ref":
                if not legacy:
                    raise TypeError("current action input descriptor names card_ref")
                field = {**field, "key": "entity_ref"}
            translated.append(field)
        normalized = validate_action_input_descriptor({**record, "fields": translated})
        if normalized["action_id"] != row["action_id"]:
            raise TypeError("action input descriptor identity disagrees")
        if not isinstance(row["updated_at"], str) or not row["updated_at"]:
            raise TypeError("action input descriptor timestamp is invalid")
        return normalized
    except (KeyError, TypeError, json.JSONDecodeError, ContractError) as error:
        raise RegistryError("persisted action input descriptor cannot be mapped") from error


def _validate_product_model_source_rows(
    conn: sqlite3.Connection,
    *,
    prefix: str,
    modules: tuple[str, ...],
    assignments: tuple[str, ...],
    known_stores: tuple[str, ...],
) -> None:
    module_rows = conn.execute(f"SELECT * FROM {prefix}modules").fetchall()
    identities = set()
    known_modules = platform_modules.module_ids()
    for row in module_rows:
        try:
            manifest = json.loads(row["record_json"])
        except (TypeError, json.JSONDecodeError) as error:
            raise RegistryError("persisted module descriptor is malformed") from error
        if (
            not isinstance(manifest, dict)
            or manifest.get("module_id") != row["module_id"]
            or row["module_id"] not in known_modules
            or row["module_id"] in identities
        ):
            raise RegistryError("persisted module identity is malformed")
        identities.add(row["module_id"])
        if modules == _SCHEMA2_MODULE_COLUMNS:
            try:
                _normalize_schema2_module_manifest(row["module_id"], manifest)
            except RegistryError as error:
                raise RegistryError("persisted module descriptor is malformed") from error
        allowed_states = (
            {"registered"} if modules == _SCHEMA2_MODULE_COLUMNS else {"enabled", "disabled"}
        )
        if row["state"] not in allowed_states:
            raise RegistryError("persisted module lifecycle cannot be mapped")
    if "settings" not in identities:
        raise RegistryError("persisted Settings registration is missing")

    for row in conn.execute(f"SELECT * FROM {prefix}adapters"):
        _neutral_adapter_record(row)
    for row in conn.execute(f"SELECT * FROM {prefix}assignments"):
        if assignments == _SCHEMA3_ASSIGNMENT_COLUMNS:
            _neutral_assignment_record(row)
        else:
            try:
                assignment = validate_assignment(json.loads(row["record_json"]))
            except (TypeError, json.JSONDecodeError, ContractError) as error:
                raise RegistryError("persisted assignment is malformed") from error
            if (
                assignment["assignment_id"] != row["assignment_id"]
                or assignment["state"] != row["state"]
                or not isinstance(row["revision"], int)
                or row["revision"] < 1
            ):
                raise RegistryError("persisted assignment identity or lifecycle is malformed")
    legacy_payloads = known_stores == _SCHEMA3_KNOWN_STORE_COLUMNS
    for row in conn.execute(f"SELECT * FROM {prefix}ui_prefs"):
        _neutral_ui_prefs_record(row, legacy=legacy_payloads)
    for row in conn.execute(f"SELECT * FROM {prefix}action_inputs"):
        _neutral_action_input_record(row, legacy=legacy_payloads)
    payload_column = (
        "boards_json" if known_stores == _SCHEMA3_KNOWN_STORE_COLUMNS else "resources_json"
    )
    for row in conn.execute(f"SELECT * FROM {prefix}known_stores"):
        try:
            values = json.loads(row[payload_column])
            if not isinstance(values, list):
                raise TypeError("known-store inventory must be a list")
            if payload_column == "boards_json":
                # The legacy column holds board *names*, not space keys, so it
                # is checked as what it is. Building a current resource ref from
                # one would refuse every real row: no board was ever named the
                # way a space key looks.
                _legacy_board_names(values)
            else:
                for value in values:
                    validate_entity_ref(value)
        except (TypeError, json.JSONDecodeError, ContractError) as error:
            raise RegistryError("persisted known-store inventory is malformed") from error


def classify_product_model_source(conn: sqlite3.Connection, stored_version: int = 3) -> str:
    """Classify one exact supported pre-4 generation before any snapshot/write."""

    tables = {
        str(row[0])
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        if not str(row[0]).startswith("sqlite_")
    }
    scratch = sorted(name for name in tables if name.endswith(("_legacy", "_product_model")))
    if scratch:
        raise RegistryError("pre-4 store contains migration scratch tables: " + ", ".join(scratch))
    for current in _CURRENT_PLATFORM_COLUMNS:
        former_name = current.replace("platform_", "hub_", 1)
        if current in tables and former_name in tables:
            raise RegistryError(f"pre-4 store mixes former and current table {current}")
    owned = (set(_CURRENT_PLATFORM_COLUMNS) | _FORMER_PLATFORM_TABLES) & tables
    unknown_owned = sorted(
        name
        for name in tables
        if name.startswith(("platform_", "hub_"))
        and name not in set(_CURRENT_PLATFORM_COLUMNS)
        and name not in _FORMER_PLATFORM_TABLES
    )
    if unknown_owned:
        raise RegistryError(
            "pre-4 store contains unknown migration-owned tables: " + ", ".join(unknown_owned)
        )
    if not owned:
        if stored_version not in {0, 1, 2}:
            raise RegistryError("schema-3 store is missing its platform catalog")
        return "planning-only"

    former = bool(owned & _FORMER_PLATFORM_TABLES)
    expected_names = _FORMER_PLATFORM_TABLES if former else set(_CURRENT_PLATFORM_COLUMNS)
    if owned != expected_names:
        raise RegistryError("pre-4 platform catalog is incomplete or mixed")
    prefix = "hub_" if former else "platform_"
    for canonical, current_columns in _CURRENT_PLATFORM_COLUMNS.items():
        table = canonical.replace("platform_", prefix, 1)
        actual = _table_columns(conn, table)
        allowed = {current_columns}
        if canonical == "platform_modules" and stored_version == 2:
            allowed.add(_SCHEMA2_MODULE_COLUMNS)
        if canonical == "platform_assignments":
            allowed.add(_SCHEMA3_ASSIGNMENT_COLUMNS)
        if canonical == "platform_known_stores":
            allowed.add(_SCHEMA3_KNOWN_STORE_COLUMNS)
        if canonical == "platform_registry_audit":
            allowed.add(_APPENDED_DETAIL_AUDIT_COLUMNS)
        if canonical == "platform_adapter_links":
            allowed.add(_BOARD_ERA_LINK_COLUMNS)
        if actual not in allowed:
            raise RegistryError(f"{table} source shape is not exact")
        triggers = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?", (table,)
        ).fetchall()
        if triggers:
            raise RegistryError(f"{table} has unsupported migration-owned triggers")
    assignments = _table_columns(conn, prefix + "assignments")
    known_stores = _table_columns(conn, prefix + "known_stores")
    modules = _table_columns(conn, prefix + "modules")
    signature_generation = "schema-2" if modules == _SCHEMA2_MODULE_COLUMNS else "schema-3"
    if (
        assignments == _CURRENT_PLATFORM_COLUMNS["platform_assignments"]
        and known_stores == _CURRENT_PLATFORM_COLUMNS["platform_known_stores"]
    ):
        signature_generation = "current"
    appended_audit_detail = (
        _table_columns(conn, "platform_registry_audit".replace("platform_", prefix, 1))
        == _APPENDED_DETAIL_AUDIT_COLUMNS
    )
    _assert_exact_catalog(
        conn,
        generation=signature_generation,
        prefix=prefix,
        appended_audit_detail=appended_audit_detail,
        board_era_links=_table_columns(
            conn, "platform_adapter_links".replace("platform_", prefix, 1)
        )
        == _BOARD_ERA_LINK_COLUMNS,
    )
    _validate_product_model_source_rows(
        conn,
        prefix=prefix,
        modules=modules,
        assignments=assignments,
        known_stores=known_stores,
    )
    if modules == _SCHEMA2_MODULE_COLUMNS:
        if former or stored_version != 2:
            raise RegistryError("legacy module registry is only supported as exact schema 2")
        return "schema-2"
    if (
        assignments == _CURRENT_PLATFORM_COLUMNS["platform_assignments"]
        and known_stores == _CURRENT_PLATFORM_COLUMNS["platform_known_stores"]
    ):
        if former:
            raise RegistryError("former-name store cannot carry the current neutral catalog")
        return "current-unstamped"
    if stored_version != 3:
        raise RegistryError("only schema 3 may carry the former product model")
    return "schema-3-former" if former else "schema-3"


def migrate_product_model(
    conn: sqlite3.Connection,
    *,
    after_rename: Callable[[], None] | None = None,
) -> bool:
    """One-shot schema-4 rewrite of Kernel-owned row meanings."""

    module_columns = _table_columns(conn, "platform_modules")
    expected_modules = (
        "module_id",
        "record_json",
        "state",
        "mutable",
        "revision",
        "updated_at",
    )
    if module_columns != expected_modules:
        raise RegistryError("platform_modules has an unrecognized source shape")
    assignment_columns = _table_columns(conn, "platform_assignments")
    legacy_assignments = ("assignment_id", "record_json", "state", "updated_at")
    current_assignments = (*legacy_assignments[:3], "revision", legacy_assignments[3])
    if assignment_columns not in {legacy_assignments, current_assignments}:
        raise RegistryError("platform_assignments has an unrecognized source shape")

    known_store_columns = _table_columns(conn, "platform_known_stores")
    legacy_payloads = known_store_columns == _SCHEMA3_KNOWN_STORE_COLUMNS
    if legacy_payloads:
        rows = conn.execute(
            "SELECT data_scope_id,alias,boards_json,registry_revision,is_primary,is_attached,"
            "is_writable,updated_at FROM platform_known_stores"
        ).fetchall()
        converted_stores = []
        for row in rows:
            try:
                names = json.loads(row["boards_json"])
                if not isinstance(names, list):
                    raise TypeError("boards_json must be a list")
                resources = _planning_resources(row["data_scope_id"], names)
            except (TypeError, json.JSONDecodeError, ContractError) as error:
                raise RegistryError("legacy known-store resources cannot be mapped") from error
            converted_stores.append((row, resources))
        conn.execute("ALTER TABLE platform_known_stores RENAME TO platform_known_stores_legacy")
        conn.execute(
            """CREATE TABLE platform_known_stores(
                data_scope_id TEXT PRIMARY KEY, alias TEXT NOT NULL, resources_json TEXT NOT NULL,
                registry_revision INTEGER NOT NULL, is_primary INTEGER NOT NULL CHECK(is_primary IN (0,1)),
                is_attached INTEGER NOT NULL CHECK(is_attached IN (0,1)),
                is_writable INTEGER NOT NULL CHECK(is_writable IN (0,1)), updated_at TEXT NOT NULL
            )"""
        )
        for row, resources in converted_stores:
            conn.execute(
                "INSERT INTO platform_known_stores VALUES(?,?,?,?,?,?,?,?)",
                (
                    row["data_scope_id"],
                    row["alias"],
                    _json(resources),
                    row["registry_revision"],
                    row["is_primary"],
                    row["is_attached"],
                    row["is_writable"],
                    row["updated_at"],
                ),
            )
        conn.execute("DROP TABLE platform_known_stores_legacy")
    elif known_store_columns != _CURRENT_PLATFORM_COLUMNS["platform_known_stores"]:
        raise RegistryError("platform_known_stores has an unrecognized source shape")

    manifests = {item["module_id"]: item for item in platform_modules.module_manifests()}
    module_rows = conn.execute(
        "SELECT module_id,record_json,state,mutable,revision,updated_at FROM platform_modules"
    ).fetchall()
    if {row["module_id"] for row in module_rows} - set(manifests):
        raise RegistryError("persisted module has no neutral manifest")
    for row in module_rows:
        if (
            row["state"] not in {"enabled", "disabled"}
            or row["mutable"] not in {0, 1}
            or not isinstance(row["revision"], int)
            or row["revision"] < 1
            or not isinstance(row["updated_at"], str)
            or not row["updated_at"]
        ):
            raise RegistryError("persisted module row is malformed")
        conn.execute(
            "UPDATE platform_modules SET record_json=? WHERE module_id=?",
            (_json(manifests[row["module_id"]]), row["module_id"]),
        )

    for row in conn.execute(
        "SELECT adapter_lineage_id,adapter_id,record_json,state,updated_at FROM platform_adapters"
    ).fetchall():
        adapter = _neutral_adapter_record(row)
        conn.execute(
            "UPDATE platform_adapters SET record_json=? WHERE adapter_lineage_id=?",
            (_json(adapter), row["adapter_lineage_id"]),
        )

    for row in conn.execute("SELECT key,record_json,updated_at FROM platform_ui_prefs"):
        prefs = _neutral_ui_prefs_record(row, legacy=legacy_payloads)
        conn.execute(
            "UPDATE platform_ui_prefs SET record_json=? WHERE key=?", (_json(prefs), row["key"])
        )
    for row in conn.execute("SELECT action_id,record_json,updated_at FROM platform_action_inputs"):
        descriptor = _neutral_action_input_record(row, legacy=legacy_payloads)
        conn.execute(
            "UPDATE platform_action_inputs SET record_json=? WHERE action_id=?",
            (_json(descriptor), row["action_id"]),
        )

    if assignment_columns == current_assignments:
        for row in conn.execute("SELECT record_json FROM platform_assignments"):
            validate_assignment(json.loads(row[0]))
        return True

    legacy_rows = conn.execute(
        "SELECT assignment_id,record_json,state,updated_at FROM platform_assignments"
    ).fetchall()
    converted = []
    for row in legacy_rows:
        converted_record, revision = _neutral_assignment_record(row)
        converted.append((converted_record, revision, row["updated_at"]))
    converted = _merge_assignments_by_capability_and_scope(converted)

    conn.execute("ALTER TABLE platform_assignments RENAME TO platform_assignments_legacy")
    if after_rename is not None:
        after_rename()
    conn.execute(
        """CREATE TABLE platform_assignments(
               assignment_id TEXT PRIMARY KEY,
               record_json TEXT NOT NULL,
               state TEXT NOT NULL CHECK(state IN ('enabled','disabled')),
               revision INTEGER NOT NULL CHECK(revision > 0),
               updated_at TEXT NOT NULL
           )"""
    )
    for record, revision, updated_at in converted:
        conn.execute(
            "INSERT INTO platform_assignments VALUES(?,?,?,?,?)",
            (record["assignment_id"], _json(record), record["state"], revision, updated_at),
        )
    conn.execute("DROP TABLE platform_assignments_legacy")
    return True


def assert_product_model_postconditions(conn: sqlite3.Connection) -> None:
    """Prove the sole current catalog immediately before the schema stamp."""

    tables = {
        str(row[0])
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        if not str(row[0]).startswith("sqlite_")
    }
    forbidden = sorted(
        name
        for name in tables
        if name.startswith("hub_") or name.endswith(("_legacy", "_product_model"))
    )
    if forbidden:
        raise RegistryError(
            "post-migration catalog retains former/scratch tables: " + ", ".join(forbidden)
        )
    for table, expected in _CURRENT_PLATFORM_COLUMNS.items():
        if table not in tables or _table_columns(conn, table) != expected:
            raise RegistryError(f"post-migration {table} shape is not exact")
    _assert_exact_catalog(conn, generation="current", prefix="platform_")
    modules_payload(conn)
    for row in conn.execute("SELECT record_json FROM platform_assignments"):
        validate_assignment(json.loads(row[0]))
    for row in conn.execute("SELECT key,record_json,updated_at FROM platform_ui_prefs"):
        _neutral_ui_prefs_record(row, legacy=False)
    for row in conn.execute("SELECT action_id,record_json,updated_at FROM platform_action_inputs"):
        _neutral_action_input_record(row, legacy=False)
    for row in conn.execute(
        "SELECT adapter_lineage_id,adapter_id,record_json,state FROM platform_adapters"
    ):
        stored = json.loads(row["record_json"])
        if stored.get("adapter_lineage_id") != row["adapter_lineage_id"]:
            raise RegistryError("post-migration adapter lineage is inconsistent")
        if stored.get("state") != row["state"]:
            raise RegistryError("post-migration adapter state is inconsistent")
        manifest = {
            key: value
            for key, value in stored.items()
            if key not in {"adapter_lineage_id", "state"}
        }
        if validate_adapter_manifest(manifest)["adapter_id"] != row["adapter_id"]:
            raise RegistryError("post-migration adapter identity is inconsistent")
    for row in conn.execute("SELECT resources_json FROM platform_known_stores"):
        resources = json.loads(row[0])
        if not isinstance(resources, list):
            raise RegistryError("post-migration known-store resources are malformed")
        for resource in resources:
            entity = validate_entity_ref(resource)
            if set(entity) != {"kind", "resource_id"}:
                raise RegistryError("post-migration known-store resource is not neutral")
    foreign_keys = conn.execute("PRAGMA foreign_key_check").fetchall()
    if foreign_keys:
        raise RegistryError("post-migration foreign-key check failed")
