"""Strict project-registry fixtures shared by consumer tests."""

from __future__ import annotations

import json
from collections.abc import Callable
from copy import deepcopy
from pathlib import Path

SOURCE_HASH = "a" * 64


def project_binding(
    project_id: str,
    resource_ref: dict,
    *,
    source_hash: str = SOURCE_HASH,
) -> dict:
    """Return one canonical owner binding for a strict project fixture."""

    return {
        "project_id": project_id,
        "resource_ref": deepcopy(resource_ref),
        "registry_revision": 1,
        "source_owner": project_id,
        "source_hash": source_hash,
    }


def project_entry(
    project_id: str,
    root: str | Path,
    *,
    board: str | None = None,
    bindings: list[dict] | None = None,
    source_hash: str = SOURCE_HASH,
) -> dict:
    """Return one complete registry entry; `registry_bytes` writes its binding as schema v4."""

    _ = source_hash  # accepted while legacy migration fixtures still pass it
    canonical_root = str(root)
    planning = next(
        (
            deepcopy(binding["resource_ref"])
            for binding in bindings or []
            if binding.get("resource_ref", {}).get("kind") == "planning-space"
        ),
        None,
    )
    return {
        "project_id": project_id,
        "display_name": board or project_id,
        "canonical_root": canonical_root,
        "planning_binding": planning,
    }


def registry_bytes(projects: list[dict]) -> bytes:
    """A schema-v4 projection of these entries.

    A binding given as a bare planning-space entity, as most tests write it, is
    its space's only project and so its default; one that names `default` is
    written as given.
    """

    written = []
    for project in projects:
        binding = project.get("planning_binding")
        if isinstance(binding, dict) and "default" not in binding:
            project = dict(project, planning_binding={**binding, "default": True})
        written.append(project)
    return json.dumps({"schema_version": 4, "projects": written}, sort_keys=True).encode("utf-8")


def registry_reader(path: str | Path) -> Callable[[], bytes]:
    """Bind a test byte reader without adding a path seam to production code."""

    return Path(path).read_bytes
