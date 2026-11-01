"""Every attached scope's planning spaces and work, read as one answer.

Read-time union only: each scope is opened read-only and separately, so an
unplugged drive costs that scope's row and nothing else. Nothing is copied
between stores, and a hit always says which scope it came from.
"""

from __future__ import annotations

import sqlite3

from .documents import search_documents
from .planning import model as planning_model
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
    """One query across every attached scope, each hit labelled with its source.

    A scope that cannot be opened or searched costs its own hits and nothing
    else: an attached store is read as it is, never migrated, so one an earlier
    or later build wrote may not answer the way this build asks. It is named in
    `skipped` with the reason, so a missing hit is never silent.
    """

    text = query.strip()
    if not text:
        return {"query": "", "work_items": [], "documents": [], "skipped": []}
    work_items: list[dict] = []
    skipped: list[dict] = []
    for scope in scopes.load(db_path()):
        try:
            connection = connect() if scope.get("primary") else scopes.open_readonly(scope)
        except (scopes.ScopeError, sqlite3.Error) as error:
            skipped.append({"scope": scope["name"], "detail": str(error)})
            continue
        found: list[dict] = []
        try:
            # One search per store rather than one per space: the reference
            # already carries the space, so asking space by space would only
            # repeat the same scan.
            for item in planning_service.search_work_items(connection, text):
                found.append(
                    {
                        **item,
                        "scope": scope["name"],
                        "qualified_reference": scopes.qualified(scope["name"], item["reference"]),
                    }
                )
        except Exception as error:  # noqa: BLE001 -- one scope's failure is that scope's alone
            detail = (
                str(error)
                if isinstance(error, sqlite3.Error)
                else (f"{type(error).__name__}: {error}")
            )
            skipped.append({"scope": scope["name"], "detail": detail})
            continue
        finally:
            connection.close()
        work_items.extend(found)
    # Each scope already puts the item a reference names first; across scopes
    # it leads as well, the primary's ahead of an attached one's, because
    # `scopes.load` lists the primary first and the sort keeps that order. A
    # number alone names each space's item of that number, which lead the same way.
    work_items.sort(key=lambda item: not planning_model.names_exactly(text, item["reference"]))
    return {
        "query": text,
        "work_items": work_items,
        "documents": search_documents(text),
        "skipped": skipped,
    }


__all__ = ["federated_search", "federated_spaces"]
