"""Every attached scope's planning spaces and work, read as one answer.

Read-time union only: each scope is opened read-only and separately, so an
unplugged drive costs that scope's row and nothing else. Nothing is copied
between stores, and a hit always says which scope it came from.
"""

from __future__ import annotations

import sqlite3

from .documents import search_documents
from .planning import service as planning_service
from .projects import scopes
from .store import connect, db_path


def federated_spaces() -> dict:
    """Every planning space in every attached scope, labelled by where it lives."""

    result: dict[str, list[dict]] = {"scopes": [], "planning_spaces": []}
    for scope in scopes.load(db_path()):
        entry = {
            "name": scope["name"],
            "label": scope.get("label", scope["name"]),
            "primary": bool(scope.get("primary")),
            "path": scope["path"],
            "available": True,
            "detail": "",
        }
        try:
            connection = connect() if scope.get("primary") else scopes.open_readonly(scope)
        except (scopes.ScopeError, sqlite3.Error) as error:
            entry["available"] = False
            entry["detail"] = str(error)
            result["scopes"].append(entry)
            continue
        try:
            for space in planning_service.list_planning_spaces(connection):
                result["planning_spaces"].append({**space, "scope": scope["name"]})
        except sqlite3.Error as error:
            entry["available"] = False
            entry["detail"] = str(error)
        finally:
            connection.close()
        result["scopes"].append(entry)
    return result


def federated_search(query: str) -> dict:
    """One query across every attached scope, each hit labelled with its source."""

    text = query.strip()
    if not text:
        return {"query": "", "work_items": [], "documents": []}
    work_items: list[dict] = []
    for scope in scopes.load(db_path()):
        try:
            connection = connect() if scope.get("primary") else scopes.open_readonly(scope)
        except (scopes.ScopeError, sqlite3.Error):
            continue  # an unavailable scope is reported by /api/scopes
        try:
            # One search per store rather than one per space: the reference
            # already carries the space, so asking space by space would only
            # repeat the same scan.
            for item in planning_service.search_work_items(connection, text):
                work_items.append(
                    {
                        **item,
                        "scope": scope["name"],
                        "qualified_reference": scopes.qualified(scope["name"], item["reference"]),
                    }
                )
        except (sqlite3.Error, ValueError):
            continue
        finally:
            connection.close()
    return {"query": text, "work_items": work_items, "documents": search_documents(text)}


__all__ = ["federated_search", "federated_spaces"]
