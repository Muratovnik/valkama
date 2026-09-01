"""Additive SQLite helpers for generic adapter links and relation read models.

Every helper accepts an explicitly supplied :class:`sqlite3.Connection` and
never opens a database itself.  Existing board ``refs`` rows are read-only
and are not rewritten or copied into the generic link table.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import UTC, datetime

from .contracts import (
    ContractError,
    planning_work_item_entity,
    validate_adapter_resource_ref,
    validate_relation,
    validate_work_item_ref,
)
from .scope import read_store_metadata


class RelationError(ContractError):
    pass


class RelationConflictError(RelationError):
    pass


class RelationRevisionConflictError(RelationConflictError):
    pass


class RelationMigrationError(RelationError):
    pass


_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS platform_adapter_links(
    id INTEGER PRIMARY KEY,
    data_scope_id TEXT NOT NULL,
    space_key TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
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
    FOREIGN KEY(work_item_id) REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    UNIQUE(data_scope_id, space_key, work_item_id, service_owner_id, service_id,
           adapter_lineage_id, connection_id, resource_type, external_id)
)
"""

_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS platform_adapter_links_item
  ON platform_adapter_links(data_scope_id, space_key, work_item_id)
"""

SCHEMA = _TABLE_SQL + ";" + _INDEX_SQL + ";"

_LINK_COLUMNS = (
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
)


def _now():
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _require_connection(conn):
    if not isinstance(conn, sqlite3.Connection):
        raise TypeError("an explicit sqlite3.Connection is required")
    return conn


def ensure_relation_schema(conn):
    """Create only additive Platform tables on the explicitly passed connection."""
    _require_connection(conn).executescript(SCHEMA)
    return conn


def links_need_work_items(conn) -> bool:
    """True while the link table still names a board and a card."""

    conn = _require_connection(conn)
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_adapter_links'"
        ).fetchone()
        is None
    ):
        return False
    columns = {row[1] for row in conn.execute("PRAGMA table_info(platform_adapter_links)")}
    return "card_id" in columns


def migrate_links_to_work_items(conn, mapping, space_keys) -> int:
    """Repoint every adapter link at the work item its card became.

    Called from the one-shot Planning migration, inside its transaction, because
    that is the only place the card-to-item mapping exists. A link whose card is
    absent from the mapping is never guessed: the migration fails before mutation
    rather than dropping somebody's evidence.

    `mapping` is card id to work item id; `space_keys` is card id to the key of
    the space its board became.
    """

    conn = _require_connection(conn)
    if not links_need_work_items(conn):
        return 0
    rows = conn.execute("SELECT * FROM platform_adapter_links ORDER BY id").fetchall()
    unmapped = [
        int(row["card_id"])
        for row in rows
        if int(row["card_id"]) not in mapping or int(row["card_id"]) not in space_keys
    ]
    if unmapped:
        raise RelationMigrationError(
            f"adapter links name cards the migration did not carry: {sorted(set(unmapped))[:5]}"
        )
    conn.execute("DROP INDEX IF EXISTS platform_adapter_links_card")
    conn.execute("DROP INDEX IF EXISTS platform_adapter_links_item")
    conn.execute("ALTER TABLE platform_adapter_links RENAME TO platform_adapter_links_legacy")
    conn.execute(_TABLE_SQL)
    conn.execute(_INDEX_SQL)
    for row in rows:
        card_id = int(row["card_id"])
        conn.execute(
            "INSERT INTO platform_adapter_links"
            "(data_scope_id, space_key, work_item_id, service_owner_id, service_id,"
            " adapter_lineage_id, connection_id, resource_type, external_id,"
            " fallback_label, provenance_json, state, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                row["data_scope_id"],
                space_keys[card_id],
                mapping[card_id],
                row["service_owner_id"],
                row["service_id"],
                row["adapter_lineage_id"],
                row["connection_id"],
                row["resource_type"],
                row["external_id"],
                row["fallback_label"],
                row["provenance_json"],
                row["state"],
                row["created_at"],
            ),
        )
    conn.execute("DROP TABLE platform_adapter_links_legacy")
    if conn.execute("PRAGMA foreign_key_check(platform_adapter_links)").fetchone():
        raise RelationMigrationError("adapter link foreign keys do not resolve after migration")
    return len(rows)


def _resource_ref(value):
    return validate_adapter_resource_ref(value)


def _item(value):
    return validate_work_item_ref(value)


def _reference_number(reference: str) -> int:
    """`VAL-142` is a space key and a number; the number is what a row carries."""

    return int(reference.split("-", 1)[1])


def _work_item_id(conn, item) -> str:
    """The stored identity behind a reference, which every link row keys on.

    A link stores the item id rather than the reference, because a reference is
    derived from a space key that an owner may re-key, while the id never moves.
    Reading a link back therefore joins for the number.
    """

    row = conn.execute(
        """SELECT w.work_item_id FROM work_items w
           JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id
           WHERE p.key = ? AND w.number = ?""",
        (item["space_ref"]["space_key"], _reference_number(item["reference"])),
    ).fetchone()
    if row is None:
        raise RelationError("WorkItemRef does not identify an existing item in its space")
    return str(row[0])


def _provenance(value):
    if value is None:
        return {"source_kind": "platform", "observed_at": _now()}
    if not isinstance(value, dict):
        raise RelationError("provenance must be an object")
    # The SQLite layer stores only bounded provenance metadata.  Relation
    # validation applies the full source_kind/observed_at shape later.
    if set(value) - {"source_kind", "observed_at", "author"}:
        raise RelationError("provenance has unknown fields")
    source_kind = value.get("source_kind")
    observed_at = value.get("observed_at", _now())
    if not isinstance(source_kind, str) or not source_kind or len(source_kind) > 128:
        raise RelationError("provenance.source_kind must be bounded")
    if not isinstance(observed_at, str) or len(observed_at) > 64:
        raise RelationError("provenance.observed_at must be bounded")
    result = {"source_kind": source_kind, "observed_at": observed_at}
    if "author" in value:
        author = value["author"]
        if not isinstance(author, str) or not author or len(author) > 128:
            raise RelationError("provenance.author must be bounded")
        result["author"] = author
    return result


def _label(value):
    if value is None:
        return ""
    if (
        not isinstance(value, str)
        or len(value) > 160
        or "\x00" in value
        or "\r" in value
        or "\n" in value
    ):
        raise RelationError("fallback_label must be bounded text")
    lowered = value.lower()
    if "<script" in lowered or "javascript:" in lowered or "file://" in lowered:
        raise RelationError("fallback_label contains executable or path content")
    return value


def _validate_pending_relation(item, resource, label, provenance, state):
    """Apply the public browser-safe relation contract before any write."""

    ref = resource["connection_ref"]
    validate_relation(
        {
            "interface_version": "valkama-relations",
            "relation_id": "pending",
            "source": planning_work_item_entity(item),
            "kind": "external-resource",
            "target": resource,
            "provider": {
                "service_ref": ref["service_ref"],
                "adapter_id": ref["adapter_lineage_id"],
                "adapter_lineage_id": ref["adapter_lineage_id"],
                "adapter_version": "0.0.0",
                "connection_id": ref["connection_id"],
            },
            "state": state,
            "provenance": provenance,
            "presentation": {"label": label or resource["external_id"]},
            "actions": [],
        }
    )


def _expected_revision(value):
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise RelationError("expected_revision must be a non-negative integer")
    return value


def _begin_exact_work_item_write(conn, item, expected_revision):
    expected = _expected_revision(expected_revision)
    conn.execute("BEGIN IMMEDIATE")
    metadata = read_store_metadata(conn)
    if not metadata["is_primary"] or not metadata["is_writable"]:
        raise RelationError("adapter links may be changed only in the primary writable data scope")
    if metadata["data_scope_id"] != item["space_ref"]["data_scope_id"]:
        raise RelationError("PlanningSpaceRef data scope is not the exact primary store identity")
    row = conn.execute(
        """SELECT w.work_item_id, w.revision FROM work_items w
           JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id
           WHERE p.key = ? AND w.number = ?""",
        (item["space_ref"]["space_key"], _reference_number(item["reference"])),
    ).fetchone()
    if row is None:
        raise RelationError("WorkItemRef does not identify an existing item in its space")
    actual = int(row[1] if not isinstance(row, sqlite3.Row) else row["revision"])
    if actual != expected:
        raise RelationRevisionConflictError(
            f"work item revision conflict: expected {expected}, actual {actual}"
        )
    identity = str(row[0] if not isinstance(row, sqlite3.Row) else row["work_item_id"])
    return identity, actual


def _finish_work_item_write(conn, work_item_id, action, detail, author):
    conn.execute(
        "UPDATE work_items SET revision = revision + 1,"
        " updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE work_item_id = ?",
        (work_item_id,),
    )
    conn.execute(
        "INSERT INTO work_item_events(work_item_id, author, action, detail) VALUES (?,?,?,?)",
        (work_item_id, author, action, detail),
    )


def add_adapter_link(
    conn,
    work_item_ref,
    resource_ref,
    *,
    expected_revision,
    fallback_label="",
    provenance=None,
    state="resolved",
    author="agent",
    before_commit=None,
):
    """Atomically insert a link, an item revision, and one activity event."""
    conn = ensure_relation_schema(conn)
    item = _item(work_item_ref)
    resource = _resource_ref(resource_ref)
    if state not in {"resolved", "unavailable", "missing", "ambiguous", "malformed"}:
        raise RelationError("invalid relation state")
    label = _label(fallback_label)
    provenance_obj = _provenance(provenance)
    _validate_pending_relation(item, resource, label, provenance_obj, state)
    if before_commit is not None and not callable(before_commit):
        raise TypeError("before_commit must be callable")
    ref = resource["connection_ref"]
    try:
        work_item_id, revision = _begin_exact_work_item_write(conn, item, expected_revision)
        cursor = conn.execute(
            """INSERT INTO platform_adapter_links
               (data_scope_id, space_key, work_item_id, service_owner_id, service_id,
                adapter_lineage_id, connection_id, resource_type, external_id,
                fallback_label, provenance_json, state, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                item["space_ref"]["data_scope_id"],
                item["space_ref"]["space_key"],
                work_item_id,
                ref["service_ref"]["owner_id"],
                ref["service_ref"]["service_id"],
                ref["adapter_lineage_id"],
                ref["connection_id"],
                resource["resource_type"],
                resource["external_id"],
                label,
                json.dumps(provenance_obj, sort_keys=True),
                state,
                _now(),
            ),
        )
        _finish_work_item_write(
            conn,
            work_item_id,
            "linked",
            f"adapter-resource {ref['adapter_lineage_id']}:{resource['resource_type']}:{resource['external_id']}",
            author,
        )
        if before_commit is not None:
            before_commit()
        conn.commit()
    except sqlite3.IntegrityError as error:
        conn.rollback()
        if "platform_adapter_links" in str(error) and "UNIQUE" in str(error).upper():
            raise RelationConflictError("generic adapter link already exists") from error
        raise
    except Exception:
        conn.rollback()
        raise
    select = conn.execute(
        "SELECT l.*, w.number AS work_item_number FROM platform_adapter_links l"
        " JOIN work_items w ON w.work_item_id = l.work_item_id WHERE l.id = ?",
        (cursor.lastrowid,),
    )
    row = _as_dict(select.fetchone(), select.description)
    return {**_row_to_link(row), "work_item_revision": revision + 1}


def remove_adapter_link(
    conn,
    work_item_ref,
    resource_ref,
    *,
    expected_revision,
    author="agent",
    before_commit=None,
):
    conn = ensure_relation_schema(conn)
    item = _item(work_item_ref)
    resource = _resource_ref(resource_ref)
    if before_commit is not None and not callable(before_commit):
        raise TypeError("before_commit must be callable")
    ref = resource["connection_ref"]
    try:
        work_item_id, revision = _begin_exact_work_item_write(conn, item, expected_revision)
        cursor = conn.execute(
            """DELETE FROM platform_adapter_links
               WHERE data_scope_id = ? AND space_key = ? AND work_item_id = ?
                 AND service_owner_id = ? AND service_id = ? AND adapter_lineage_id = ?
                 AND connection_id = ? AND resource_type = ? AND external_id = ?""",
            (
                item["space_ref"]["data_scope_id"],
                item["space_ref"]["space_key"],
                work_item_id,
                ref["service_ref"]["owner_id"],
                ref["service_ref"]["service_id"],
                ref["adapter_lineage_id"],
                ref["connection_id"],
                resource["resource_type"],
                resource["external_id"],
            ),
        )
        if cursor.rowcount != 1:
            raise RelationError("exact generic adapter link does not exist")
        _finish_work_item_write(
            conn,
            work_item_id,
            "unlinked",
            f"adapter-resource {ref['adapter_lineage_id']}:{resource['resource_type']}:{resource['external_id']}",
            author,
        )
        if before_commit is not None:
            before_commit()
        conn.commit()
        return {"removed": True, "work_item_revision": revision + 1}
    except Exception:
        conn.rollback()
        raise


def _row_to_link(row, *, state=None, reason=None):
    if row is None:
        return None
    resource = {
        "connection_ref": {
            "service_ref": {"owner_id": row["service_owner_id"], "service_id": row["service_id"]},
            "adapter_lineage_id": row["adapter_lineage_id"],
            "connection_id": row["connection_id"],
        },
        "resource_type": row["resource_type"],
        "external_id": row["external_id"],
    }
    result = {
        "relation_id": f"adapter-link:{row['id']}",
        "work_item_ref": {
            "space_ref": {
                "data_scope_id": row["data_scope_id"],
                "space_key": row["space_key"],
            },
            "reference": f"{row['space_key']}-{row['work_item_number']}",
        },
        "target": resource,
        "provider": {
            "service_ref": resource["connection_ref"]["service_ref"],
            "adapter_id": row["adapter_lineage_id"],
            "adapter_lineage_id": row["adapter_lineage_id"],
            "adapter_version": "unknown",
            "connection_id": row["connection_id"],
        },
        "state": state or row["state"],
        "fallback_label": row["fallback_label"],
        "provenance": json.loads(row["provenance_json"]),
    }
    if reason:
        result["reason"] = reason
    return result


def _as_dict(row, description):
    if row is None:
        return None
    if isinstance(row, (dict, sqlite3.Row)):
        return dict(row)
    return {item[0]: value for item, value in zip(description or (), row, strict=False)}


def _require_registry(registry):
    required = (
        "get_adapter",
        "get_connection",
        "get_service",
        "resolve_core_ref",
        "list_actions",
        "list_contributions",
        "operation_for_action",
        "authorize",
    )
    if registry is None or any(not callable(getattr(registry, name, None)) for name in required):
        raise TypeError("a non-null PlatformRegistry protocol is required")
    return registry


def _explicit_unavailability(registry, row):
    lineage = row["adapter_lineage_id"]
    connection_id = row["connection_id"]
    adapter = registry.get_adapter(lineage)
    if adapter is None or adapter.get("state") == "tombstoned":
        return "adapter_unavailable"
    service_ref = {"owner_id": row["service_owner_id"], "service_id": row["service_id"]}
    service = registry.get_service(service_ref)
    if service is None or service.get("state") != "registered":
        return "service_unavailable"
    connection_ref = {
        "service_ref": service_ref,
        "adapter_lineage_id": lineage,
        "connection_id": connection_id,
    }
    connection = registry.get_connection(connection_ref)
    if connection is None or connection.get("state") != "registered":
        return "connection_unavailable"
    if connection.get("trust") != "trusted":
        return "connection_untrusted"
    if connection.get("health") != "ready":
        return "connection_unhealthy"
    return None


def read_adapter_links(conn, work_item_ref=None, *, registry):
    conn = _require_connection(conn)
    registry = _require_registry(registry)
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_adapter_links'"
        ).fetchone()
        is None
    ):
        return []
    params: list[object] = []
    query = (
        "SELECT l.*, w.number AS work_item_number FROM platform_adapter_links l"
        " JOIN work_items w ON w.work_item_id = l.work_item_id"
    )
    if work_item_ref is not None:
        item = _item(work_item_ref)
        query += " WHERE l.data_scope_id = ? AND l.space_key = ? AND l.work_item_id = ?"
        params.extend(
            (
                item["space_ref"]["data_scope_id"],
                item["space_ref"]["space_key"],
                _work_item_id(conn, item),
            )
        )
    query += " ORDER BY l.id"
    cursor = conn.execute(query, params)
    rows = [_as_dict(row, cursor.description) for row in cursor.fetchall()]
    result = []
    for row in rows:
        reason = _explicit_unavailability(registry, row)
        link = (
            _row_to_link(row, state="unavailable", reason=reason) if reason else _row_to_link(row)
        )
        adapter = registry.get_adapter(row["adapter_lineage_id"])
        if adapter:
            link["provider"]["adapter_id"] = adapter["adapter_id"]
            link["provider"]["adapter_version"] = adapter.get(
                "version", adapter.get("adapter_version")
            )
        result.append(link)
    return result


def _core_ref_relations(conn, item, *, registry, invocation_scope=None):
    # Existing refs are an old system-of-record.  We only read pointer metadata
    # and never copy or rewrite rows.  A missing refs table is a valid empty
    # projection for a fresh throwaway store.
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='work_item_refs'"
        ).fetchone()
        is None
    ):
        return []
    cursor = conn.execute(
        "SELECT id, kind, value, label, author, created_at FROM work_item_refs"
        " WHERE work_item_id = ? ORDER BY id",
        (_work_item_id(conn, item),),
    )
    rows = [_as_dict(row, cursor.description) for row in cursor.fetchall()]
    relations = []
    for row in rows:
        pointer = str(row["value"])
        binding = registry.resolve_core_ref(row["kind"])
        adapter = registry.get_adapter(binding["adapter_lineage_id"]) if binding else None
        service = registry.get_service(binding["service_ref"]) if binding else None
        connection = None
        if binding:
            connection = registry.get_connection(
                {
                    "service_ref": binding["service_ref"],
                    "adapter_lineage_id": binding["adapter_lineage_id"],
                    "connection_id": binding["connection_id"],
                }
            )
        usable = bool(
            binding
            and binding.get("direct_read") is False
            and adapter
            and adapter.get("state") != "tombstoned"
            and adapter.get("direct_read") is False
            and service
            and service.get("state") == "registered"
            and service.get("direct_read") is False
            and connection
            and connection.get("state") == "registered"
            and connection.get("trust") == "trusted"
            and connection.get("health") == "ready"
        )
        if binding:
            target = {
                "connection_ref": {
                    "service_ref": binding["service_ref"],
                    "adapter_lineage_id": binding["adapter_lineage_id"],
                    "connection_id": binding["connection_id"],
                },
                "resource_type": row["kind"],
                "external_id": pointer,
            }
        else:
            digest = hashlib.sha256(pointer.encode("utf-8", "replace")).hexdigest()[:32]
            target = {"kind": "registry", "registry_id": f"{row['kind']}-{digest}"}
        relation = {
            "interface_version": "valkama-relations",
            "relation_id": f"core-ref:{row['id']}",
            "source": planning_work_item_entity(item),
            "kind": "reference",
            "target": target,
            "provider": {
                "service_ref": (binding or {}).get(
                    "service_ref", {"owner_id": "platform", "service_id": "core-ref"}
                ),
                "adapter_id": (adapter or {}).get("adapter_id", "core-ref"),
                "adapter_lineage_id": (binding or {}).get("adapter_lineage_id", "unresolved"),
                "adapter_version": (adapter or {}).get(
                    "version", (adapter or {}).get("adapter_version", "0.0.0")
                ),
                "connection_id": (binding or {}).get("connection_id", "unresolved"),
            },
            "state": "resolved" if usable else "unavailable",
            "provenance": {
                "source_kind": f"valkama-ref-{row['kind']}",
                "observed_at": row["created_at"],
                **({"author": row["author"]} if row["author"] else {}),
            },
            "presentation": {"label": row["label"] or row["kind"]},
            "actions": (
                _resource_actions(
                    registry,
                    binding["adapter_lineage_id"],
                    {"open"},
                    resource=target,
                    item=item,
                    invocation_scope=invocation_scope,
                )
                if binding
                else []
            ),
        }
        if not relation["actions"]:
            relation["state"] = "unavailable"
        relations.append(validate_relation(relation))
    return relations


def read_relations(conn, work_item_ref, *, registry, invocation_scope=None):
    """Return one bounded relation read model for an exact WorkItemRef."""
    conn = _require_connection(conn)
    registry = _require_registry(registry)
    item = _item(work_item_ref)
    result = []
    for link in read_adapter_links(conn, item, registry=registry):
        actions = []
        if link["state"] != "unavailable":
            actions = _resource_actions(
                registry,
                link["provider"]["adapter_lineage_id"],
                {"open", "remove"},
                resource=link["target"],
                item=item,
                invocation_scope=invocation_scope,
            )
        relation = {
            "interface_version": "valkama-relations",
            "relation_id": link["relation_id"],
            "source": planning_work_item_entity(item),
            "kind": "external-resource",
            "target": link["target"],
            "provider": link["provider"],
            "state": ("unavailable" if not actions else link["state"]),
            "provenance": link["provenance"],
            "presentation": {"label": link["fallback_label"] or link["target"]["external_id"]},
            "actions": actions,
        }
        result.append(validate_relation(relation))
    result.extend(
        _core_ref_relations(conn, item, registry=registry, invocation_scope=invocation_scope)
    )
    return result


def read_relation_read_model(conn, work_item_ref, *, registry, invocation_scope=None):
    return read_relations(conn, work_item_ref, registry=registry, invocation_scope=invocation_scope)


def _resource_actions(
    registry,
    adapter_lineage_id,
    operations,
    *,
    resource=None,
    item=None,
    invocation_scope=None,
):
    candidates = [
        action
        for action in registry.list_actions()
        if action["owner_kind"] == "adapter"
        and action["owner_id"] == adapter_lineage_id
        and registry.operation_for_action(action["action_id"]) in operations
        and action["target_kind"] == "adapter-resource"
    ]
    if invocation_scope is None or resource is None or item is None:
        return []
    allowed = []
    permissions = {"open": "resource.open", "remove": "relation.remove"}
    context = {
        "view_scope": invocation_scope,
        "invocation_scope": invocation_scope,
        "target": resource,
    }
    for action in candidates:
        operation = registry.operation_for_action(action["action_id"])
        permission = permissions.get(operation)
        if permission is None:
            continue
        try:
            grant = registry.authorize(
                context,
                permission,
                connection_ref=resource["connection_ref"],
                adapter_lineage_id=adapter_lineage_id,
            )
        except ContractError:
            continue
        if item["space_ref"]["data_scope_id"] in grant["data_scope_ids"]:
            allowed.append(action)
    return allowed


# Explicit names make the write/read boundary easy to discover without adding
# a second storage implementation.
create_adapter_link = add_adapter_link
delete_adapter_link = remove_adapter_link
ensure_platform_relation_schema = ensure_relation_schema


__all__ = [
    "RelationConflictError",
    "RelationError",
    "RelationMigrationError",
    "RelationRevisionConflictError",
    "add_adapter_link",
    "create_adapter_link",
    "delete_adapter_link",
    "ensure_platform_relation_schema",
    "ensure_relation_schema",
    "links_need_work_items",
    "migrate_links_to_work_items",
    "read_adapter_links",
    "read_relation_read_model",
    "read_relations",
    "remove_adapter_link",
]
