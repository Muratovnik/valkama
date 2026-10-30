"""The owning-store identity: one immutable row naming this store.

`platform_store_metadata` holds the `data_scope_id` every planning-space ref,
work-item ref, binding and relation points at, and the product that owns the
store. It is written once, read on every route that has to tell two stores
apart, and changed by exactly one sanctioned migration: a rename of this
product.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from uuid import uuid4

from .primitives import ContractError
from .refs import validate_data_scope_id


class ScopeError(ContractError):
    pass


class ScopeConflictError(ScopeError):
    pass


class UnknownStoreError(ScopeError):
    pass


# The owning-store identity this product writes, and the names it wrote before
# it was renamed. `owner_id` is immutable so that a second product cannot claim
# someone else's store; a rename is the one case where the same product turns up
# under a new name, so it is spent from this list and nowhere else.
PLATFORM_OWNER_ID = "valkama"
FORMER_OWNER_IDS = ("hub", "kanban")


STORE_METADATA_SCHEMA = """
CREATE TABLE IF NOT EXISTS platform_store_metadata(
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    data_scope_id TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL,
    is_primary INTEGER NOT NULL CHECK(is_primary IN (0, 1)),
    is_writable INTEGER NOT NULL CHECK(is_writable IN (0, 1)),
    created_at TEXT NOT NULL
);
"""


def _require_connection(conn):
    if not isinstance(conn, sqlite3.Connection):
        raise TypeError("an explicit sqlite3.Connection is required")
    return conn


def ensure_store_metadata(
    conn, *, owner_id, is_primary=True, is_writable=True, caller_owns_transaction=False
):
    """Create the immutable owning-store identity once on a supplied DB handle."""
    conn = _require_connection(conn)
    if not isinstance(owner_id, str) or not owner_id or owner_id != owner_id.strip():
        raise ScopeError("store metadata owner_id must be explicit bounded text")
    if not isinstance(is_primary, bool) or not isinstance(is_writable, bool):
        raise ScopeError("store metadata primary/writable flags must be boolean")
    conn.execute(STORE_METADATA_SCHEMA)
    row = conn.execute(
        "SELECT data_scope_id, owner_id, is_primary, is_writable, created_at FROM platform_store_metadata WHERE singleton = 1"
    ).fetchone()
    if row is None:
        created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        scope_id = str(uuid4())
        conn.execute(
            "INSERT INTO platform_store_metadata(singleton,data_scope_id,owner_id,is_primary,is_writable,created_at) VALUES (1,?,?,?,?,?)",
            (scope_id, owner_id, int(is_primary), int(is_writable), created_at),
        )
    else:
        current = _metadata_dict(row)
        if current["owner_id"] != owner_id:
            raise ScopeConflictError("store metadata owner_id is immutable")
        if current["is_primary"] != is_primary or current["is_writable"] != is_writable:
            raise ScopeConflictError("store metadata primary/writable state is immutable")
    result = read_store_metadata(conn)
    if not caller_owns_transaction:
        conn.commit()
    return result


def read_store_metadata(conn):
    conn = _require_connection(conn)
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_store_metadata'"
        ).fetchone()
        is None
    ):
        raise UnknownStoreError("store metadata is not initialized")
    row = conn.execute(
        "SELECT data_scope_id, owner_id, is_primary, is_writable, created_at FROM platform_store_metadata WHERE singleton = 1"
    ).fetchone()
    if row is None:
        raise UnknownStoreError("store metadata is not initialized")
    result = _metadata_dict(row)
    validate_data_scope_id(result["data_scope_id"])
    return result


def _metadata_dict(row):
    values = tuple(row)
    return {
        "data_scope_id": values[0],
        "owner_id": values[1],
        "is_primary": bool(values[2]),
        "is_writable": bool(values[3]),
        "created_at": values[4],
    }


def get_or_create_data_scope_id(conn, *, owner_id, is_primary=True, is_writable=True):
    return ensure_store_metadata(
        conn, owner_id=owner_id, is_primary=is_primary, is_writable=is_writable
    )["data_scope_id"]


def store_owner_migration_needed(conn):
    """True when this store is ours but still carries a former product name."""
    conn = _require_connection(conn)
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_store_metadata'"
        ).fetchone()
        is None
    ):
        return False
    row = conn.execute(
        "SELECT owner_id FROM platform_store_metadata WHERE singleton = 1"
    ).fetchone()
    return row is not None and row[0] in FORMER_OWNER_IDS


def migrate_store_owner(conn):
    """Carry a store written under a former product name over to this one.

    `data_scope_id` is deliberately untouched. It is the identity every board
    ref, binding and relation already points at, so rewriting it would orphan
    them; only the human-readable owner changes, which is all the rename is.
    """
    conn = _require_connection(conn)
    if not store_owner_migration_needed(conn):
        return None
    current = conn.execute(
        "SELECT owner_id FROM platform_store_metadata WHERE singleton = 1"
    ).fetchone()[0]
    # Bounded by the exact name that was read rather than by the whole list, so
    # the statement stays static and still cannot rewrite anything but the one
    # former identity this call decided about.
    conn.execute(
        "UPDATE platform_store_metadata SET owner_id = ? WHERE singleton = 1 AND owner_id = ?",
        (PLATFORM_OWNER_ID, current),
    )
    return read_store_metadata(conn)


__all__ = [
    "FORMER_OWNER_IDS",
    "PLATFORM_OWNER_ID",
    "STORE_METADATA_SCHEMA",
    "ScopeConflictError",
    "ScopeError",
    "UnknownStoreError",
    "ensure_store_metadata",
    "get_or_create_data_scope_id",
    "migrate_store_owner",
    "read_store_metadata",
    "store_owner_migration_needed",
]
