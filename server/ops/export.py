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
import os
import sqlite3
import tempfile
from pathlib import Path

from ..planning import requests as planning_requests
from ..planning import service as planning_service

#: What one export may carry, so a caller asks for what it wants rather than
#: getting everything and filtering afterwards.
SECTIONS = ("planning",)


class ExportIncompleteError(RuntimeError):
    """The items read for a space do not add up to the items the space holds.

    An export is a record somebody keeps instead of the store. One that is short
    and says nothing is worse than none, so the export stops rather than return it.
    """


def export_installation(
    conn: sqlite3.Connection,
    *,
    sections: tuple[str, ...] = SECTIONS,
    spaces: tuple[str, ...] | None = None,
) -> dict:
    """Everything named, in one JSON-shaped record with its own version.

    `spaces` narrows the planning section to those spaces, each by key, name or
    id; an unknown one is refused before any item is read.
    """

    unknown = [name for name in sections if name not in SECTIONS]
    if unknown:
        raise ValueError(f"unknown export section(s): {', '.join(unknown)}")
    if spaces is not None and "planning" not in sections:
        raise ValueError("a space filter needs the planning section")
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
        planning = _planning(conn, spaces)
        payload["planning"] = planning
        if spaces is not None:
            # A narrowed file says so itself, so nobody takes it for the whole.
            payload["space_filter"] = [str(space["key"]) for space in planning["planning_spaces"]]
    return payload


def _planning(conn: sqlite3.Connection, chosen: tuple[str, ...] | None) -> dict:
    """Spaces and their work, read through the service that owns the shape.

    Through `planning_service` rather than by selecting from the tables: the
    presented record is what every other reader sees, and an export assembled
    from raw rows would be a second description of a work item that drifts from
    the first.

    One read transaction holds the whole section, so the count a space is
    checked against and the pages that must add up to it see the same store
    even while agents keep writing.
    """

    began = not conn.in_transaction
    if began:
        conn.execute("BEGIN")
    try:
        spaces = planning_service.list_planning_spaces(conn)
        if chosen is not None:
            wanted = {
                str(planning_service.get_planning_space(conn, reference)["planning_space_id"])
                for reference in chosen
            }
            spaces = [space for space in spaces if str(space["planning_space_id"]) in wanted]
        items: list[dict] = []
        questions: list[dict] = []
        for space in spaces:
            identities = _every_item(conn, space)
            items.extend(planning_service.get_work_item(conn, identity) for identity in identities)
            for identity in identities:
                questions.extend(planning_requests.of_item(conn, identity))
    finally:
        if began:
            conn.rollback()
    return {"planning_spaces": spaces, "work_items": items, "requests": questions}


def _every_item(conn: sqlite3.Connection, space: dict) -> list[str]:
    """The id of every item in one space, checked against the space's own count.

    Read page by page until the service says nothing follows. The count comes
    from a separate query, so a page that came back short, or one that repeated
    an item, is caught here instead of in the file.
    """

    identities: list[str] = []
    offset = 0
    while True:
        page = planning_service.list_work_items_page(
            conn,
            space=str(space["planning_space_id"]),
            limit=planning_service.MAX_LIST_PAGE,
            offset=offset,
        )
        identities.extend(str(item["work_item_id"]) for item in page["work_items"])
        if page["next_offset"] is None:
            break
        offset = page["next_offset"]
    expected = space["work_items"]
    if len(identities) != expected or len(set(identities)) != expected:
        raise ExportIncompleteError(
            f"planning space {space['key']} holds {expected} work items, but the export"
            f" read {len(identities)} ({len(set(identities))} distinct); nothing was written"
        )
    return identities


def render(payload: dict) -> str:
    """The export as text: indented, so a diff of two of them is readable."""

    return json.dumps(payload, ensure_ascii=False, indent=1, sort_keys=True)


def write(payload: dict, path: str | os.PathLike[str]) -> Path:
    """Write the export to a file whole or not at all.

    The text goes to a temporary file beside the target and replaces it in one
    rename, so an interrupted export leaves the previous file, or none, and
    never half of one.
    """

    target = Path(path).absolute()
    data = (render(payload) + "\n").encode("utf-8")
    descriptor, name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def summary(payload: dict, path: Path) -> str:
    """One line for the terminal: where the file went and what it holds."""

    planning = payload.get("planning", {})
    keys = [str(space["key"]) for space in planning.get("planning_spaces", [])]
    listed = ", ".join(keys) if keys else "none"
    return (
        f"wrote {path}: {len(keys)} planning space(s) ({listed}),"
        f" {len(planning.get('work_items', []))} work item(s)"
    )


__all__ = [
    "SECTIONS",
    "ExportIncompleteError",
    "export_installation",
    "render",
    "summary",
    "write",
]
