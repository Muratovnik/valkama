"""Which modules this store has enabled, and the gate work passes through.

`modules` declares what this build ships. This module reads what the store
persisted about it -- one row per module in `platform_modules` -- and answers
the question every surface asks before a module's work runs: is exactly one
registration for it present, valid and enabled.

It imports nothing from the extension registry, so Planning and the app shell
can be gated without loading the registry. The registry builds on it instead:
`RegistryError` is defined here because an inconsistent module row is the first
inconsistency a persisted registry can have, and the registry's own refusals
are refinements of it.
"""

from __future__ import annotations

import json
import sqlite3

from ..store_identity.primitives import ContractError
from ..ui_state import PlatformHttpError
from . import modules as platform_modules
from .module_manifest import MODULES_INTERFACE, validate_module_manifest


class RegistryError(ContractError):
    pass


def modules_payload(conn: sqlite3.Connection) -> dict:
    """Read and validate every registration from the canonical persisted rows."""

    registrations = []
    rows = conn.execute(
        "SELECT module_id,record_json,state,mutable,revision,updated_at"
        " FROM platform_modules ORDER BY module_id"
    ).fetchall()
    identities = [row["module_id"] for row in rows]
    if len(identities) != len(set(identities)):
        raise RegistryError("persisted module identity is duplicated")
    if "settings" not in identities:
        raise RegistryError("persisted Settings registration is missing")
    for row in rows:
        try:
            manifest = validate_module_manifest(json.loads(row["record_json"]))
        except (TypeError, json.JSONDecodeError, ContractError) as error:
            raise RegistryError("persisted module descriptor is malformed") from error
        if manifest["module_id"] != row["module_id"]:
            raise RegistryError("persisted module identity disagrees with its descriptor")
        if row["state"] not in {"enabled", "disabled"}:
            raise RegistryError("persisted module state is invalid")
        if row["mutable"] not in {0, 1}:
            raise RegistryError("persisted module mutability is invalid")
        mutable = bool(row["mutable"])
        if not isinstance(row["revision"], int) or row["revision"] <= 0:
            raise RegistryError("persisted module revision is invalid")
        if not isinstance(row["updated_at"], str) or not row["updated_at"]:
            raise RegistryError("persisted module update time is invalid")
        if manifest["module_id"] == "settings" and (mutable or row["state"] != "enabled"):
            raise RegistryError("persisted Settings module state is invalid")
        registrations.append(
            {
                "manifest": manifest,
                "state": row["state"],
                "mutable": mutable,
                "revision": int(row["revision"]),
                "updated_at": row["updated_at"],
            }
        )
    return {"interface_version": MODULES_INTERFACE, "modules": registrations}


def require_module_enabled(conn: sqlite3.Connection, module_id: str) -> None:
    """Refuse work unless one exact persisted registration is enabled."""

    registration = next(
        (
            item
            for item in modules_payload(conn)["modules"]
            if item["manifest"]["module_id"] == module_id
        ),
        None,
    )
    if registration is None or registration["state"] != "enabled":
        raise PlatformHttpError(409, "unavailable", f"Module {module_id} is disabled")


def is_module_enabled(conn: sqlite3.Connection, module_id: str) -> bool:
    try:
        require_module_enabled(conn, module_id)
    except PlatformHttpError:
        return False
    return True


def unseen_module_ids(conn: sqlite3.Connection) -> list[str]:
    """Modules this build declares that this store has never known.

    Two rules meet here and only one of them is obvious. A module added in a
    later build must appear in installations that already exist, or it stays in
    the registry source and invisible in the product. But a row that was removed
    stays removed: the persisted registry is the runtime authority, and a build
    that reseeded whatever it happened to declare would overwrite the operator
    rather than extend the product.

    Both hold because the audit answers a question the module table cannot: a
    registration writes an audit event and nothing erases it, so a module with
    history was known once and its absence is a removal, while a module with no
    history anywhere is new. Absence alone cannot tell those apart.
    """

    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_modules'"
        ).fetchone()
        is None
    ):
        return []
    present = {str(row[0]) for row in conn.execute("SELECT module_id FROM platform_modules")}
    remembered = {
        str(row[0])
        for row in conn.execute(
            "SELECT entity_id FROM platform_registry_audit WHERE entity_kind='module'"
        )
    }
    return [
        str(manifest["module_id"])
        for manifest in platform_modules.module_manifests()
        if str(manifest["module_id"]) not in present | remembered
    ]


__all__ = [
    "RegistryError",
    "is_module_enabled",
    "modules_payload",
    "require_module_enabled",
    "unseen_module_ids",
]
