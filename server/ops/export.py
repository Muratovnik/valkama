"""The installation as one file somebody can keep, minus everything secret.

OPS-006. What leaves is the record a person would be sorry to lose and could
not reconstruct: the planning trail. What does not leave is anything a store
should not have held in the first place, nor what the build itself declares:
the module list is code, so an export of it would describe the build that
wrote the file rather than the installation.

There used to be two more sections. `relations` carried the extension
registry's adapter links and `settings` the integration switches; schema 9
dropped both tables, and a section that always answered empty would claim an
installation had nothing there rather than that the product no longer keeps it.

The secret rule is absolute and cheap to state: no connection configuration
crosses this boundary. Not redacted, not starred out — absent. A redacted secret
in an export is still a claim that the export contains secrets, and the first
person to see one treats the whole file as sensitive; a file that never carries
them can be attached to an issue.

Session transcripts never leave either. The archive beside the store holds
whatever a session saw, secrets and personal data included, so this module never
reads it, and nothing the export presents carries an archive's path or hash.

Telemetry is not here either, and that is the layer's own rule rather than an
omission: raw observations belong to whichever backend stores them, and a
product that exported a copy would be the second copy §16.6 and §2.2 both
forbid.
"""

from __future__ import annotations

import json
import sqlite3

from ..planning import service as planning_service

#: What one export may carry, so a caller asks for what it wants rather than
#: getting everything and filtering afterwards.
SECTIONS = ("planning",)

#: How many rows one section will carry. An export is a record, not a database
#: dump, and a file nobody can open is a file nobody keeps.
MAX_ROWS = 5000


def export_installation(
    conn: sqlite3.Connection,
    *,
    sections: tuple[str, ...] = SECTIONS,
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
            "historical session event records",
            "execution records and execution-session links",
            "transcript archive",
        ],
    }
    if "planning" in sections:
        payload["planning"] = _planning(conn)
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


def render(payload: dict) -> str:
    """The export as text: indented, so a diff of two of them is readable."""

    return json.dumps(payload, ensure_ascii=False, indent=1, sort_keys=True)


__all__ = ["MAX_ROWS", "SECTIONS", "export_installation", "render"]
