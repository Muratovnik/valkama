"""The installation as one file somebody can keep, minus everything secret.

OPS-006. What leaves is the record a person would be sorry to lose and could
not reconstruct: the planning trail, what the Kernel links to what, which
modules are on, and the decisions Improvements reached. What does not leave is
anything a store should not have held in the first place.

The secret rule is absolute and cheap to state: no connection configuration
crosses this boundary. Not redacted, not starred out — absent. A redacted secret
in an export is still a claim that the export contains secrets, and the first
person to see one treats the whole file as sensitive; a file that never carries
them can be attached to an issue.

Telemetry is not here either, and that is the layer's own rule rather than an
omission: raw observations belong to whichever backend stores them, and a
product that exported a copy would be the second copy §16.6 and §2.2 both
forbid.
"""

from __future__ import annotations

import json
import sqlite3

from ..improvements import improvements
from ..planning import service as planning_service

#: What one export may carry, so a caller asks for what it wants rather than
#: getting everything and filtering afterwards.
SECTIONS = ("planning", "relations", "settings", "improvements")

#: How many rows one section will carry. An export is a record, not a database
#: dump, and a file nobody can open is a file nobody keeps.
MAX_ROWS = 5000


def export_installation(
    conn: sqlite3.Connection,
    *,
    sections: tuple[str, ...] = SECTIONS,
    db_path: str = "",
) -> dict:
    """Everything named, in one JSON-shaped record with its own version."""

    unknown = [name for name in sections if name not in SECTIONS]
    if unknown:
        raise ValueError(f"unknown export section(s): {', '.join(unknown)}")
    payload: dict = {
        "interface_version": "valkama-export",
        "restorable": False,
        "recovery_format": "valkama-recovery-v1",
        "sections": list(sections),
        # Said in the file rather than in a README: whoever opens this needs to
        # know what it does not contain without being told separately.
        "excluded": [
            "connection configuration and any secret reference",
            "raw telemetry, which belongs to the backend that stores it",
            "session event streams, which are a purgeable tail",
            "execution records and execution-session links",
            "most Improvements sidecar state; this is a decision export, not a backup",
        ],
    }
    if "planning" in sections:
        payload["planning"] = _planning(conn)
    if "relations" in sections:
        payload["relations"] = _rows(conn, "platform_adapter_links")
    if "settings" in sections:
        payload["settings"] = _settings(conn)
    if "improvements" in sections:
        payload["improvements"] = _improvements(db_path)
    return payload


def _planning(conn: sqlite3.Connection) -> dict:
    """Spaces and their work, read through the service that owns the shape.

    Through `planning_service` rather than by selecting from the tables: the
    presented record is what every other reader sees, and an export assembled
    from raw rows would be a second description of a work item that drifts from
    the first.
    """

    spaces = planning_service.list_planning_spaces(conn)
    items = []
    for space in spaces:
        for brief in planning_service.list_work_items(
            conn, space=str(space["planning_space_id"]), limit=MAX_ROWS
        ):
            items.append(planning_service.get_work_item(conn, str(brief["reference"])))
    return {"planning_spaces": spaces, "work_items": items}


def _settings(conn: sqlite3.Connection) -> dict:
    """Which modules are on, and which integrations the owner switched off.

    `platform_connections` is deliberately not read. It is where a
    configuration — and therefore a secret reference — would live, and the way
    to guarantee an export cannot leak one is to never open the table.
    """

    return {
        "modules": _rows(conn, "platform_modules"),
        "integrations": _rows(conn, "integration_settings"),
    }


def _improvements(db_path: str) -> dict:
    """The decisions Improvements reached, from its own sidecar store.

    Its own database on purpose, so an absent one is an empty section rather
    than an error: an installation that never enabled Improvements has nothing
    to export and is not broken.
    """

    if not db_path:
        return {"cases": [], "reason": "no store path was given"}
    try:
        store = improvements.ImprovementStore(db_path, "personal")
        return {"cases": store.cases(limit=100)}
    except Exception as failure:  # noqa: BLE001 -- an absent sidecar is a normal answer
        return {"cases": [], "reason": str(failure)}


def _rows(conn: sqlite3.Connection, table: str) -> list[dict]:
    """One table as records, or nothing when this store does not have it.

    The table name is a literal from `SECTIONS`' own code path and never from a
    caller; an absent table is an empty list because an older store is a thing
    an export should survive rather than refuse.
    """

    if table not in ("platform_adapter_links", "platform_modules", "integration_settings"):
        raise ValueError(f"refusing to export an unnamed table: {table}")
    try:
        cursor = conn.execute(f"SELECT * FROM {table} LIMIT {MAX_ROWS}")  # noqa: S608
    except sqlite3.Error:
        return []
    columns = [description[0] for description in cursor.description]
    return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]


def render(payload: dict) -> str:
    """The export as text: indented, so a diff of two of them is readable."""

    return json.dumps(payload, ensure_ascii=False, indent=1, sort_keys=True)


__all__ = ["MAX_ROWS", "SECTIONS", "export_installation", "render"]
