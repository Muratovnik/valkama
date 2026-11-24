"""The owner's space window: create, edit or remove a space of the main store in one write.

A space lives in the store and its projects in the registry, and no transaction holds
both, so each operation orders its two steps itself:

- Creating and renaming commit the store first, then write the registry once with
  the space's whole composition. A space with no project is lawful, so when the
  registry refuses, both sides stand lawful: the answer says the space was written
  and the projects were not, and the window offers to write them again.
- Changing the key, or removing an empty space, writes the registry first: a binding
  must never name a key or a space the store no longer has. The store's change is
  made and held uncommitted while the registry is written, so a refused registry
  leaves nothing changed; a commit that fails after it puts back the projects that
  write changed (`registry_owner.Restore`), and only those.

Before a creation or an edit commits, the registry's changes are tried without
writing (`registry_owner.preview`), so a folder that does not exist or a project
another space keeps as its default refuses the whole save. The window edits only the
main store: an attached store is opened read-only, and its spaces are bound by
`valkama projects bind --scope`.

The registry belongs to `registry_owner`; this module computes the changes and hands
them over, and writes no file of its own.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping, Sequence
from typing import Any

from ..projects import project_registry, registry_owner, space_binding
from ..store_identity.metadata import read_store_metadata
from ..store_identity.primitives import ContractError
from ..store_identity.refs import planning_space_ref
from . import calls, item_projects, model, read_model, service, store

WRITE_PATH = "/api/planning/space/save"
WRITE_PATHS = (WRITE_PATH,)

_FIELDS = frozenset({"space", "name", "key", "projects", "new_projects", "remove", "author"})
_NEW_PROJECT_FIELDS = frozenset({"project_id", "display_name", "canonical_root"})
#: How many projects one save may name: far above any space's, low enough to bound a write.
_MAX_PROJECTS = 500


class SpaceWindowError(Exception):
    """A refused save: nothing was changed, and `code` says why."""

    def __init__(self, status: int, code: str, message: str, **detail: object) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail


#: The refusals this module answers itself; Planning's own mapping answers the rest its
#: write raises, the owner-only refusal among them (`http_surface`).
REFUSALS = (SpaceWindowError, model.SpaceRefusedError, registry_owner.RegistryOwnerError)


def error_response(error: BaseException) -> tuple[int, dict]:
    """The status and body of one of the window's own refusals (`REFUSALS`)."""

    if isinstance(error, SpaceWindowError):
        return error.status, {
            "error": {"code": error.code, "message": error.message, **error.detail}
        }
    if isinstance(error, model.SpaceRefusedError):
        return 409, {"error": {"code": error.code, "message": str(error)}}
    if isinstance(error, registry_owner.RegistryOwnerError):
        return 409, _registry_error(error)
    raise error


def _registry_error(error: registry_owner.RegistryOwnerError) -> dict:
    return {"error": {"code": "registry", "message": str(error), "reason": error.code}}


# -- the request --------------------------------------------------------------


def _invalid(message: str) -> SpaceWindowError:
    return SpaceWindowError(400, "invalid_request", message)


def _members(payload: Mapping[str, object]) -> tuple[list[str], str | None]:
    """The projects the space is to have, in order, and its default project."""

    listed = payload.get("projects", [])
    if not isinstance(listed, list) or len(listed) > _MAX_PROJECTS:
        raise _invalid("projects must be a list of {project_id, default}")
    members: list[str] = []
    defaults: list[str] = []
    for value in listed:
        if (
            not isinstance(value, Mapping)
            or set(value) != {"project_id", "default"}
            or not isinstance(value["project_id"], str)
            or type(value["default"]) is not bool
        ):
            raise _invalid("each project must be {project_id, default}")
        if value["project_id"] in members:
            raise _invalid(f"project {value['project_id']} is named twice")
        members.append(value["project_id"])
        if value["default"]:
            defaults.append(value["project_id"])
    if members and len(defaults) != 1:
        raise _invalid("a space with projects has exactly one default project")
    return members, defaults[0] if defaults else None


def _new_projects(payload: Mapping[str, object], members: Sequence[str]) -> list[dict]:
    """The projects to register before they join: each one of the space's projects."""

    listed = payload.get("new_projects", [])
    if not isinstance(listed, list) or len(listed) > _MAX_PROJECTS:
        raise _invalid("new_projects must be a list")
    entries = []
    for value in listed:
        if not isinstance(value, Mapping) or set(value) != _NEW_PROJECT_FIELDS:
            raise _invalid("each new project must be {project_id, display_name, canonical_root}")
        if value["project_id"] not in members:
            raise _invalid(f"new project {value['project_id']} is not one of the space's projects")
        entries.append({**value, "planning_binding": None})
    return entries


def _edited(conn: sqlite3.Connection, scope: str, value: object) -> sqlite3.Row | None:
    """The space the save edits, or None for a creation; one of the main store's spaces only."""

    if value is None:
        return None
    if not isinstance(value, Mapping) or set(value) != {"data_scope_id", "space_key"}:
        raise _invalid("space must be {data_scope_id, space_key}")
    if value["data_scope_id"] != scope:
        raise SpaceWindowError(
            409,
            "not_main_store",
            "only a space of the main store is edited here; an attached store is read-only",
        )
    row = conn.execute(
        "SELECT planning_space_id, name, key, next_number FROM planning_spaces WHERE key = ?",
        (value["space_key"],),
    ).fetchone()
    if row is None:
        raise SpaceWindowError(
            404, "space_missing", f"planning space {value['space_key']} does not exist"
        )
    return row


# -- the registry's changes ---------------------------------------------------


def _bound_to(projects: Sequence[Mapping[str, Any]], resource_id: str) -> list[Mapping[str, Any]]:
    return [
        entry
        for entry in projects
        if entry["planning_binding"] and entry["planning_binding"]["resource_id"] == resource_id
    ]


def _composition(
    projects: Sequence[Mapping[str, Any]],
    reference: Mapping[str, str],
    members: Sequence[str],
    default: str | None,
    *,
    held_as: str | None = None,
) -> list[registry_owner.Change]:
    """The changes that leave the space `reference` names with `members`, `default` its default.

    Ordered so that each one is lawful where it falls: the default is bound first, which
    takes the flag from every other project of the space, then the projects that join,
    then the ones that leave, a default last. `held_as` is the space's identity in
    `projects` when an earlier change of the same write gives it a new one.
    """

    resource_id = reference["resource_id"]
    current = _bound_to(projects, held_as or resource_id)
    current_ids = {str(entry["project_id"]) for entry in current}
    changes: list[registry_owner.Change] = []
    if default is not None:
        changes.append(registry_owner.Bind(default, reference, True))
    changes.extend(
        registry_owner.Bind(project_id, reference)
        for project_id in members
        if project_id != default and project_id not in current_ids
    )
    leaving = sorted(
        (entry for entry in current if entry["project_id"] not in members),
        key=lambda entry: bool(entry["planning_binding"]["default"]),
    )
    changes.extend(
        registry_owner.Unbind(str(entry["project_id"]), resource_id) for entry in leaving
    )
    return changes


def _registry() -> tuple[Any, Any]:
    return registry_owner.inventory_path(), registry_owner.projection_path()


def _registry_projects() -> list[dict[str, Any]]:
    inventory, _target = _registry()
    return registry_owner.read_inventory(inventory)


def _preview(changes: Sequence[registry_owner.Change]) -> None:
    if changes:
        registry_owner.preview(*_registry(), changes)


def _write(changes: Sequence[registry_owner.Change]) -> bool:
    return bool(changes) and registry_owner.update(*_registry(), changes)


def _touched(
    before: Sequence[Mapping[str, Any]], after: Sequence[Mapping[str, Any]]
) -> registry_owner.Restore:
    """The change that undoes a write which took the registry from `before` to `after`."""

    found = {entry["project_id"]: entry for entry in before}
    changed = [entry for entry in after if found.get(entry["project_id"]) != entry]
    ids = {entry["project_id"] for entry in changed}
    return registry_owner.Restore(
        after=changed, before=[entry for entry in before if entry["project_id"] in ids]
    )


# -- the save -----------------------------------------------------------------


def _answer(
    conn: sqlite3.Connection,
    scope: str,
    operation: str,
    space_id: str | None,
    registry: Mapping[str, object],
) -> dict:
    shown = None
    if space_id is not None:
        (shown,) = item_projects.spaces_shown(conn, [service.get_planning_space(conn, space_id)])
    return {
        "operation": operation,
        "space": shown,
        "space_ref": None if shown is None else {"data_scope_id": scope, "space_key": shown["key"]},
        "registry": dict(registry),
    }


def _registry_after_commit(changes: Sequence[registry_owner.Change]) -> dict:
    """The registry's step once the store's is committed: written, unchanged or refused."""

    try:
        written = _write(changes)
    except registry_owner.RegistryOwnerError as error:
        return {"status": "refused", "reason": error.code, "message": str(error)}
    return {"status": "written" if written else "unchanged"}


def _create_or_rename(
    conn: sqlite3.Connection,
    scope: str,
    edited: sqlite3.Row | None,
    name: str,
    key: str | None,
    members: Sequence[str],
    default: str | None,
    new_projects: Sequence[Mapping[str, Any]],
) -> dict:
    conn.execute("BEGIN IMMEDIATE")
    try:
        if edited is None:
            space_id = store.create_space(conn, name=name, key=key)["planning_space_id"]
        else:
            space_id = str(edited["planning_space_id"])
            store.rename_space(conn, space_id, name)
        calls.call_id(conn, None)
        space_key = read_model.space_row(conn, space_id)["key"]
        projects = _registry_projects()
        changes = [
            *(registry_owner.Add(entry) for entry in new_projects),
            *_composition(projects, space_binding.for_key(scope, space_key), members, default),
        ]
        _preview(changes)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return _answer(
        conn,
        scope,
        "created" if edited is None else "edited",
        space_id,
        _registry_after_commit(changes),
    )


def _commit(conn: sqlite3.Connection) -> None:
    """Commit the store's change a registry write has already followed."""

    conn.commit()


def _registry_first(
    conn: sqlite3.Connection,
    scope: str,
    edited: sqlite3.Row,
    operation: str,
    stage: Any,
    changes_for: Any,
) -> dict:
    """Stage the store's change, write the registry, then commit; undo the registry on failure."""

    space_id = str(edited["planning_space_id"])
    conn.execute("BEGIN IMMEDIATE")
    try:
        stage(space_id)
        calls.call_id(conn, None)
        before = _registry_projects()
        changes = changes_for(before)
        try:
            written = _write(changes)
        except registry_owner.RegistryOwnerError as error:
            raise SpaceWindowError(409, "registry", str(error), reason=error.code) from error
        after = _registry_projects() if written else before
        try:
            _commit(conn)
        except sqlite3.Error as error:
            if written:
                try:
                    registry_owner.update(*_registry(), [_touched(before, after)])
                except registry_owner.RegistryOwnerError as undo:
                    raise SpaceWindowError(
                        500,
                        "registry_diverged",
                        f"the store refused the change ({error}) and the registry could not"
                        f" be put back ({undo}): run valkama projects check",
                    ) from error
            raise SpaceWindowError(
                500, "store_refused", f"the store refused the change: {error}"
            ) from error
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    return _answer(
        conn,
        scope,
        operation,
        None if operation == "removed" else space_id,
        {"status": "written" if written else "unchanged"},
    )


def save(conn: sqlite3.Connection, payload: Mapping[str, object]) -> dict:
    """Create, edit or remove one space of the main store, with its projects in the registry."""

    if not calls.by_person():
        raise model.OwnerOnlyError("only the owner's interface edits a space here")
    if not isinstance(payload, Mapping) or not set(payload) <= _FIELDS:
        raise _invalid("the save takes space, name, key, projects, new_projects and remove")
    scope = str(read_store_metadata(conn)["data_scope_id"])
    edited = _edited(conn, scope, payload.get("space"))
    remove = payload.get("remove", False)
    if type(remove) is not bool:
        raise _invalid("remove must be true or false")
    if remove:
        if edited is None:
            raise _invalid("name the space to remove")
        reference = space_binding.for_key(scope, str(edited["key"]))
        return _registry_first(
            conn,
            scope,
            edited,
            "removed",
            lambda space_id: store.remove_space(conn, space_id),
            lambda projects: _composition(projects, reference, [], None),
        )
    name = payload.get("name")
    if not isinstance(name, str):
        raise _invalid("name must be a string")
    key = payload.get("key")
    if key is not None and not isinstance(key, str):
        raise _invalid("key must be a string")
    members, default = _members(payload)
    new_projects = _new_projects(payload, members)
    if edited is None or key is None or key == edited["key"]:
        return _create_or_rename(conn, scope, edited, name, key, members, default, new_projects)
    was = space_binding.for_key(scope, str(edited["key"]))
    reference = space_binding.for_key(scope, model.space_key(key))

    def stage(space_id: str) -> None:
        store.rekey_space(conn, space_id, key)
        store.rename_space(conn, space_id, name)

    def changes_for(projects: Sequence[Mapping[str, Any]]) -> list[registry_owner.Change]:
        return [
            *(registry_owner.Add(entry) for entry in new_projects),
            registry_owner.Rekey(was["resource_id"], reference["resource_id"]),
            *_composition(projects, reference, members, default, held_as=was["resource_id"]),
        ]

    return _registry_first(conn, scope, edited, "edited", stage, changes_for)


# -- the reads ----------------------------------------------------------------


def _bound_space(binding: Mapping[str, Any] | None) -> dict | None:
    if binding is None:
        return None
    try:
        ref = planning_space_ref({"kind": "planning-space", "resource_id": binding["resource_id"]})
    except ContractError:
        return None
    return {"data_scope_id": ref["data_scope_id"], "space_key": ref["space_key"]}


def projects_read(_conn: sqlite3.Connection, _parameters: Mapping[str, list[str]]) -> dict:
    """Every registered project and the space it is in, those in none included."""

    listing = project_registry.read_registry()
    known = listing["status"] in {"available", "absent"}
    return {
        "registry": {"status": listing["status"], "reason": listing["reason"]},
        "projects": [
            {
                "project_id": str(entry["project_id"]),
                "display_name": str(entry["display_name"]),
                "root": str(entry["canonical_root"]),
                "space": _bound_space(entry["planning_binding"]),
                "default": bool(entry["planning_binding"] and entry["planning_binding"]["default"]),
            }
            for entry in (listing["projects"] if known else [])
        ],
    }


def _parameter(parameters: Mapping[str, list[str]], name: str) -> str | None:
    values = parameters.get(name) or []
    return values[0] if values else None


def key_read(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """The key the server would give a new space of this name, or why it gives none."""

    name = (_parameter(parameters, "name") or "").strip()
    taken = frozenset(str(row[0]) for row in conn.execute("SELECT key FROM planning_spaces"))
    try:
        return {"key": model.derive_space_key(name, taken), "refusal": None}
    except model.SpaceRefusedError as error:
        return {"key": None, "refusal": {"code": error.code, "message": str(error)}}


def form_read(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """What the window shows of a space besides its projects: whether its key and the space
    itself may still change, and its workflow. Without `space`, a new space's workflow."""

    workflow = {"name": model.DEFAULT_WORKFLOW_NAME, "states": len(model.DEFAULT_STATES)}
    space = _parameter(parameters, "space")
    if space is None:
        return {"space": None, "workflow": workflow}
    row = read_model.space_row(conn, space)
    identity = str(row["planning_space_id"])
    found = store.workflow_for_space(conn, identity)
    items = conn.execute(
        "SELECT COUNT(*) FROM work_items WHERE planning_space_id = ?", (identity,)
    ).fetchone()[0]
    return {
        "space": {
            "name": str(row["name"]),
            "key": str(row["key"]),
            "key_locked": int(row["next_number"]) != 1,
            "work_items": int(items),
        },
        "workflow": {
            "name": str(found["name"]),
            "states": len(store.states_for_workflow(conn, str(found["workflow_id"]))),
        },
    }


READS = {
    "/api/planning/projects": projects_read,
    "/api/planning/space/key": key_read,
    "/api/planning/space/form": form_read,
}
