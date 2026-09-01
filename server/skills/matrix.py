"""What every skill's state is, per project and per client, and what that costs.

A matrix is a cross-product, so it is the one read here that can grow without
anyone asking it to: projects times skills times clients. `MAX_MATRIX_CELLS` is
what keeps a request from turning a large workstation into a long answer, and it
is enforced by refusing rather than by truncating — a partial matrix looks
exactly like a matrix.

Whether a client can even hold a different answer per project is declared by
`skill_activation.CLIENT_PROJECT_SCOPE`, never inferred here: a column that
offered a per-project toggle for a client without one would be a control that
appears to decide something and silently decides it everywhere.
"""

from __future__ import annotations

from pathlib import Path

from ..projects import project_registry
from . import manifests, skill_activation, skills_inventory

MAX_MATRIX_CELLS = 2000


def activation_matrix(
    *,
    registry_reader: project_registry.RegistryReader | None = None,
    user_home: str | None = None,
    observed_at: str | None = None,
) -> dict:
    """Skill x Project x Client, with each client's real reach stated.

    The inventory answers what exists and whether it is on for the owner. This
    answers the question one axis further out, and the axis is where the honesty
    lives: a client that cannot hold a per-project answer says so in every cell
    rather than presenting a toggle that decides something else.
    """

    timestamp = manifests.observed_at(observed_at)
    home = Path(user_home).expanduser() if user_home else Path.home()
    registry = project_registry.read_registry(reader=registry_reader)
    registered = registry["projects"][: skills_inventory.MAX_PROJECTS]
    inventory = skills_inventory.inventory_payload(
        registry_reader=registry_reader, user_home=user_home, observed_at=timestamp
    )
    skills = inventory["skills"]

    roots = {
        str(project["project_id"]): Path(str(project["canonical_root"])).expanduser()
        for project in registered
        if project.get("canonical_root")
    }
    projects = [
        {"project_id": row["id"], "project_title": row["project_title"]}
        for row in inventory["projects"]
        if row["id"] in roots
    ]

    budget = MAX_MATRIX_CELLS
    rows = []
    truncated = False
    for skill in skills:
        if budget < len(projects):
            truncated = True
            break
        budget -= len(projects)
        rows.append(
            {
                "key": skill["key"],
                "name": skill["name"],
                "scope": skill["scope"],
                "owner_project_id": skill.get("owner_project_id"),
                "skill_ref": skill["skill_ref"],
                "cells": [
                    {
                        "project_id": project["project_id"],
                        "clients": _cells(skill, roots[project["project_id"]], home),
                    }
                    for project in projects
                ],
            }
        )

    return {
        "interface_version": skills_inventory.INTERFACE_VERSION,
        "as_of": timestamp,
        "clients": [
            {
                "id": client["id"],
                # Declared by the adapter, not guessed from a cell. A reader has
                # to be able to tell "off here" from "this client has no here".
                "project_scope": bool(
                    skill_activation.CLIENT_PROJECT_SCOPE.get(client["id"], False)
                ),
            }
            for client in skills_inventory.CLIENTS
        ],
        "projects": projects,
        "skills": rows,
        "truncated": truncated,
    }


def _cells(skill: dict, project_root: Path, home: Path) -> dict:
    """One skill's state in one project, per client.

    Claude is re-read against this project's settings chain, because that is
    where its answer for this project lives. Codex is the catalogue's single
    value carried across unchanged and marked as not project-scoped: repeating
    it is honest, and recomputing it per project would invent a difference the
    client cannot have.
    """

    catalogue = skill.get("clients", {})
    codex = dict(catalogue.get("codex", skills_inventory.MISSING_CELL))
    codex["project_scope"] = False
    codex["can_toggle"] = False
    codex["reason"] = codex.get("reason") or "codex_activation_is_not_project_scoped"

    claude = dict(catalogue.get("claude", skills_inventory.MISSING_CELL))
    # Only re-read when the catalogue found the skill usable at all: a skill
    # that is invalid, duplicated or unprojected is unusable in every project,
    # and asking a settings file about it would replace a real reason with a
    # state that looks fine.
    if claude.get("can_toggle"):
        claude = skill_activation.claude_skill_state(
            skill["name"], home=home, project_root=project_root
        )
    claude["project_scope"] = True
    return {"claude": claude, "codex": codex}
