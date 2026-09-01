"""Routing a memory question to whichever provider answers for this project.

The module's whole job is that a work item's knowledge can come from more than
one place and the interface does not need to know which. AgentMemory answers
with records it owns; a Markdown root answers with files already on disk; a
third provider will answer with something else again. What crosses back is a
pointer and a label, never a copy (§16.6).

Providers are asked, not assumed. A project with no knowledge root gets an
honest empty answer with a reason, rather than a search that silently looks
somewhere else — which is the same rule the launch form follows about a
repository, and for the same reason: a wrong source is worse than none.
"""

from __future__ import annotations

import os
import sqlite3

from ..projects import project_registry
from . import contracts
from .markdown import MarkdownKnowledgeProvider

#: Where a project keeps authored knowledge, unless it says otherwise. Chosen
#: rather than configured because every repository here already has one, and a
#: setting nobody sets is a setting that hides an empty screen.
DEFAULT_KNOWLEDGE_DIRECTORY = "docs"

#: The connection the Markdown provider answers as. One per project root, which
#: is what makes a pointer resolvable: the same relative path under two roots is
#: two different documents.
MARKDOWN_CONNECTION = "markdown-knowledge"


def knowledge_root(
    project_id: str, *, registry_reader: project_registry.RegistryReader | None = None
) -> dict:
    """Where this project's Markdown knowledge lives, or why nowhere.

    Resolved through the registry that maps a project to a directory, never from
    the platform's own working directory: a search that answers from the wrong
    repository is a worse failure than one that answers nothing.
    """

    listing = project_registry.read_registry(reader=registry_reader)
    return _knowledge_root(project_id, listing)


def _knowledge_root(project_id: str, listing: project_registry.RegistryResult) -> dict:
    """Resolve from the caller's one already-validated registry snapshot."""

    for project in listing.get("projects", []):
        if str(project.get("project_id")) != str(project_id):
            continue
        root = str(project.get("canonical_root") or "")
        if not root:
            return _located("", "unavailable", "project_unmapped", "project has no mapped root")
        candidate = os.path.join(root, DEFAULT_KNOWLEDGE_DIRECTORY)
        if not os.path.isdir(candidate):
            return _located(
                "",
                "missing",
                "knowledge_root_absent",
                f"{DEFAULT_KNOWLEDGE_DIRECTORY}/ does not exist in this project",
            )
        return _located(candidate, "mapped", "", "")
    return _located("", "missing", "project_unregistered", "no such registered project")


def _located(root: str, status: str, code: str, message: str) -> dict:
    """Where the knowledge is, and why nowhere in the shape a provider uses.

    The code travels with the sentence because the interface needs both: one to
    decide what to offer and one to show. This used to be plain text, and the
    view read `reason.message` off it, found nothing, and printed a generic
    line instead of the specific one — in the only case where the specific one
    was the answer.
    """

    return {
        "root": root,
        "status": status,
        "reason": None if status == "mapped" else {"code": code, "message": message},
    }


def search(
    project_id: str,
    query: str,
    *,
    limit: int = 20,
    registry_reader: project_registry.RegistryReader | None = None,
) -> dict:
    """Ask this project's knowledge provider, and say which one answered."""

    located = knowledge_root(project_id, registry_reader=registry_reader)
    if located["status"] != "mapped":
        return {
            "provider_id": MARKDOWN_CONNECTION,
            "capabilities": list(MarkdownKnowledgeProvider.CAPABILITIES),
            "results": [],
            "truncated": False,
            "health": "unavailable",
            "reason": located["reason"],
            "root": "",
        }
    provider = MarkdownKnowledgeProvider(located["root"])
    answer = provider.search(query, limit=limit)
    return {
        "provider_id": MARKDOWN_CONNECTION,
        # Sent with every answer so an interface can offer exactly what this
        # provider does. A read-only source that renders an attach button is a
        # source pretending to be another one.
        "capabilities": list(MarkdownKnowledgeProvider.CAPABILITIES),
        # Named so a reader can tell which folder answered. Two projects both
        # searching "docs" is the ordinary case, and the result is unreadable
        # without saying whose.
        "root": located["root"],
        **answer,
    }


def document(
    project_id: str,
    external_id: str,
    *,
    registry_reader: project_registry.RegistryReader | None = None,
) -> dict:
    """One document's bounded text, refusing a pointer outside the root."""

    located = knowledge_root(project_id, registry_reader=registry_reader)
    if located["status"] != "mapped":
        raise contracts.KnowledgeError(
            str((located["reason"] or {}).get("message") or "this project has no knowledge root")
        )
    return {
        "provider_id": MARKDOWN_CONNECTION,
        **MarkdownKnowledgeProvider(located["root"]).read(external_id),
    }


def providers(*, registry_reader: project_registry.RegistryReader | None = None) -> dict:
    """Which provider answers for each registered project, and whether it can.

    The plan calls this a provider selector, and a selector is what it must not
    be. A project's knowledge root is resolved from the registry rather than
    chosen, so a menu would be a control that decides nothing; what a reader
    needs is the mapping itself and its health, with the projects that cannot
    answer stated rather than omitted. An absent project reads as a project
    without knowledge, and those are different facts.
    """

    listing = project_registry.read_registry(reader=registry_reader)
    entries = []
    for project in listing.get("projects", []):
        project_id = str(project.get("project_id") or "")
        if not project_id:
            continue
        located = _knowledge_root(project_id, listing)
        entries.append(
            {
                "project_id": project_id,
                "title": str(project.get("display_name") or project_id),
                "provider_id": MARKDOWN_CONNECTION,
                "capabilities": list(MarkdownKnowledgeProvider.CAPABILITIES),
                "root": located["root"],
                "health": "ready" if located["status"] == "mapped" else "unavailable",
                "reason": located["reason"],
            }
        )
    entries.sort(key=lambda entry: (entry["health"] != "ready", entry["title"].lower()))
    return {"providers": entries}


#: How many attached pointers one project answers with. A page is a page.
MAX_LINKED = 100


def linked(conn: sqlite3.Connection, project_id: str) -> dict:
    """The memory pointers attached to this project's work, newest first.

    This is the half of the module that does not need a provider. An attached
    pointer is Valkama's own record with its own stored label, so it still reads
    when the source behind it is unreachable — which is the whole reason MEM-001
    stores the label instead of resolving one.

    Joined through the planning space rather than through a binding: a space
    names its project directly, and a second resolution path for the same fact
    is a second answer waiting to disagree with the first.
    """

    rows = conn.execute(
        """SELECT ref.value AS value,
                  ref.label AS label,
                  ref.author AS author,
                  ref.created_at AS created_at,
                  item.work_item_id AS work_item_id,
                  item.title AS work_item_title,
                  space.key AS space_key,
                  item.number AS number
             FROM work_item_refs AS ref
             JOIN work_items AS item ON item.work_item_id = ref.work_item_id
             JOIN planning_spaces AS space
               ON space.planning_space_id = item.planning_space_id
            WHERE ref.kind = 'memory' AND space.project_id = ?
            ORDER BY ref.created_at DESC, ref.id DESC
            LIMIT ?""",
        (str(project_id), MAX_LINKED + 1),
    ).fetchall()
    truncated = len(rows) > MAX_LINKED
    return {
        "links": [
            {
                "value": str(row["value"]),
                # Stored at attach time and never re-derived: the point of
                # keeping it is that the row still reads when nothing can
                # resolve the pointer.
                "label": str(row["label"]),
                "author": str(row["author"]),
                "attached_at": str(row["created_at"]),
                "work_item_id": str(row["work_item_id"]),
                "work_item_title": str(row["work_item_title"]),
                # Both, because they answer different questions: the key is
                # what a reader recognises, and the space is what the shell
                # needs to find the item again.
                "work_item_key": f"{row['space_key']}-{row['number']}",
                "space_key": str(row["space_key"]),
            }
            for row in rows[:MAX_LINKED]
        ],
        "truncated": truncated,
    }


__all__ = [
    "DEFAULT_KNOWLEDGE_DIRECTORY",
    "MARKDOWN_CONNECTION",
    "MAX_LINKED",
    "document",
    "knowledge_root",
    "linked",
    "providers",
    "search",
]
