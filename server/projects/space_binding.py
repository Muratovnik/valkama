"""The binding a project takes to join a planning space: one reading of it for every writer.

`valkama projects bind` and the server's space window both bind through
`registry_owner`, and both build the binding here, so the bytes they write for
one space are the same. A binding is the space's opaque identity, the store's
`data_scope_id` beside the space's key: nothing else of the space's row is read,
so a binding is made before the store is migrated as well.
"""

from __future__ import annotations

import os
import sqlite3

from ..store_identity import metadata as store_metadata
from ..store_identity.refs import planning_space_entity
from . import scopes
from .registry_owner import RegistryOwnerError


def for_key(data_scope_id: str, space_key: str) -> dict[str, str]:
    """The binding to the space `space_key` of the store `data_scope_id`."""

    return planning_space_entity({"data_scope_id": data_scope_id, "space_key": space_key})


def of_space(conn: sqlite3.Connection, space: str) -> dict[str, str]:
    """The binding to the space `conn`'s store holds under that id, key or name."""

    row = conn.execute(
        "SELECT planning_space_id, key, name FROM planning_spaces"
        " WHERE planning_space_id = ? OR key = ? OR name = ?",
        (space, space, space),
    ).fetchone()
    if row is None:
        raise RegistryOwnerError(f"no planning space named {space}")
    metadata = store_metadata.read_store_metadata(conn)
    return for_key(str(metadata["data_scope_id"]), str(row[1]))


def store_path(primary_db: str, scope: str) -> str:
    """The store file of the data scope `scope`, refused when this machine does not hold it.

    The caller opens it read-only (`store.read_only`) and reads the binding with `of_space`.
    """

    selected = next((entry for entry in scopes.load(primary_db) if entry["name"] == scope), None)
    if selected is None or (not selected["primary"] and not os.path.isfile(selected["path"])):
        raise RegistryOwnerError(f"data scope is unavailable: {scope}")
    return str(selected["path"])
