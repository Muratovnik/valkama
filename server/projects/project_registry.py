r"""Strict, read-only consumption of Valkama's project registry projection.

Valkama owns the inventory, writer and recovery path. Consumers read the fixed
``%LOCALAPPDATA%\Valkama\projects.json`` projection and accept the whole
schema-v4 snapshot or none of it. The registry carries project identity and one
optional opaque Planning binding; hook configuration, index commands, memory
namespaces and source-manifest provenance are deliberately not part of it.

A planning space may hold several projects. Each binding says whether its
project is the space's default one, and every bound space has exactly one: the
space's root is the root of that project. A projection of another format is
malformed here, as a schema-v4 one is to a reader of schema 3.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable, Iterable, Mapping
from typing import Any, Literal, TypedDict

from ..store_identity.primitives import ContractError
from ..store_identity.refs import planning_space_entity, planning_space_ref

RegistryReader = Callable[[], bytes | None]
RegistryStatus = Literal["available", "absent", "malformed", "unavailable"]


class RegistryResult(TypedDict):
    status: RegistryStatus
    projects: list[dict[str, Any]]
    reason: str


class RegistryError(ValueError):
    """The registry bytes do not satisfy the canonical schema."""


_DOCUMENT_KEYS = {"schema_version", "projects"}
_ENTRY_KEYS = {"project_id", "display_name", "canonical_root", "planning_binding"}
_BINDING_KEYS = {"kind", "resource_id", "default"}
SCHEMA_VERSION = 4
_PROJECT_ID = re.compile(r"^[a-z][a-z0-9-]{0,159}$")
_MAX_NAME = 200
_MAX_RESOURCE_ID = 512


def registry_path() -> str:
    """Return the only production registry path without creating it."""

    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return os.path.join(local_app_data, "Valkama", "projects.json")
    return os.path.join(os.path.expanduser("~"), "AppData", "Local", "Valkama", "projects.json")


def _read_registry_bytes() -> bytes:
    with open(registry_path(), "rb") as handle:
        return handle.read()


def _result(
    status: RegistryStatus, *, projects: list[dict[str, Any]] | None = None, reason: str = ""
) -> RegistryResult:
    return {
        "status": status,
        "projects": [] if projects is None else projects,
        "reason": reason,
    }


def read_registry(*, reader: RegistryReader | None = None) -> RegistryResult:
    """Read one immutable snapshot through the fixed production path."""

    try:
        raw = (reader or _read_registry_bytes)()
    except FileNotFoundError:
        return _result("absent", reason="Valkama project registry is absent")
    except OSError as error:
        return _result("unavailable", reason=f"Valkama project registry cannot be read: {error}")
    return parse_registry(raw)


def parse_registry(raw: bytes | None) -> RegistryResult:
    """Validate exact schema-v4 bytes and return the complete set or no projects."""

    if raw is None:
        return _result("absent", reason="Valkama project registry is absent")
    if not isinstance(raw, bytes):
        return _result("malformed", reason="project registry reader must return bytes")
    try:
        document = json.loads(raw.decode("utf-8"))
        document = _exact_mapping(document, _DOCUMENT_KEYS, "registry")
        version = document["schema_version"]
        if type(version) is not int or version != SCHEMA_VERSION:
            raise RegistryError(f"registry.schema_version must be {SCHEMA_VERSION}")
        projects = document["projects"]
        if not isinstance(projects, list):
            raise RegistryError("registry.projects must be an array")
        validated = _validate_projects(projects)
    except (UnicodeDecodeError, json.JSONDecodeError, RegistryError) as error:
        return _result("malformed", reason=f"Valkama project registry is malformed: {error}")
    return _result("available", projects=validated)


def _exact_mapping(value: object, keys: set[str], label: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise RegistryError(f"{label} must be an object")
    actual = set(value)
    if actual != keys:
        missing = sorted(keys - actual)
        unknown = sorted(actual - keys)
        details = []
        if missing:
            details.append("missing " + ", ".join(missing))
        if unknown:
            details.append("unknown " + ", ".join(unknown))
        raise RegistryError(f"{label} has {'; '.join(details)}")
    return value


def _bounded_text(value: object, label: str, *, maximum: int) -> str:
    if not isinstance(value, str) or not value or value != value.strip() or len(value) > maximum:
        raise RegistryError(f"{label} must be bounded trimmed text")
    return value


def _validate_binding(value: object, label: str) -> dict[str, Any] | None:
    if value is None:
        return None
    binding = _exact_mapping(value, _BINDING_KEYS, label)
    if binding["kind"] != "planning-space":
        raise RegistryError(f"{label}.kind must be planning-space")
    if type(binding["default"]) is not bool:
        raise RegistryError(f"{label}.default must be true or false")
    return {
        "default": binding["default"],
        "kind": "planning-space",
        "resource_id": _bounded_text(
            binding["resource_id"], f"{label}.resource_id", maximum=_MAX_RESOURCE_ID
        ),
    }


def _validate_project(value: object, index: int) -> dict[str, Any]:
    label = f"registry.projects[{index}]"
    entry = _exact_mapping(value, _ENTRY_KEYS, label)
    project_id = _bounded_text(entry["project_id"], f"{label}.project_id", maximum=160)
    if not _PROJECT_ID.fullmatch(project_id):
        raise RegistryError(f"{label}.project_id must be a lowercase project slug")
    canonical_root = _bounded_text(
        entry["canonical_root"], f"{label}.canonical_root", maximum=32767
    )
    if not os.path.isabs(canonical_root):
        raise RegistryError(f"{label}.canonical_root must be absolute")
    return {
        "project_id": project_id,
        "display_name": _bounded_text(
            entry["display_name"], f"{label}.display_name", maximum=_MAX_NAME
        ),
        "canonical_root": canonical_root,
        "planning_binding": _validate_binding(
            entry["planning_binding"], f"{label}.planning_binding"
        ),
    }


def _require_unique(values: Iterable[object], label: str) -> None:
    materialized = tuple(values)
    if len(materialized) != len(set(materialized)):
        raise RegistryError(f"duplicate {label} in registry")


def _validate_projects(values: list[object]) -> list[dict[str, Any]]:
    projects = [_validate_project(value, index) for index, value in enumerate(values)]
    _require_unique((project["project_id"] for project in projects), "project_id")
    _require_unique(
        (os.path.normcase(project["canonical_root"]) for project in projects), "canonical_root"
    )
    defaults: dict[str, int] = {}
    for project in projects:
        if (binding := project["planning_binding"]) is not None:
            resource_id = binding["resource_id"]
            defaults[resource_id] = defaults.get(resource_id, 0) + binding["default"]
    if any(count != 1 for count in defaults.values()):
        raise RegistryError("every bound planning space must have exactly one default project")
    return sorted(projects, key=lambda project: (project["project_id"], project["canonical_root"]))


def binding_entity(binding: Mapping[str, Any] | None) -> dict[str, str] | None:
    """The planning-space entity a binding names, without its default flag."""

    if binding is None:
        return None
    return {"kind": str(binding["kind"]), "resource_id": str(binding["resource_id"])}


def space_projects(
    projects: Iterable[Mapping[str, Any]], space_ref: Mapping[str, Any]
) -> list[Mapping[str, Any]]:
    """The projects bound to one planning space: its default first, then the others by id."""

    entity = planning_space_entity(space_ref)
    return sorted(
        (project for project in projects if binding_entity(project["planning_binding"]) == entity),
        key=lambda project: (not project["planning_binding"]["default"], project["project_id"]),
    )


def projects_shown(bound: list[Mapping[str, Any]]) -> dict[str, Any]:
    """How a space names its projects: the default one's id, and each one's id and name.

    `bound` is `space_projects`' answer, so the default project, which every bound
    space has, comes first.
    """

    return {
        "default_project": str(bound[0]["project_id"]) if bound else None,
        "projects": [
            {"project_id": str(project["project_id"]), "display_name": project["display_name"]}
            for project in bound
        ],
    }


def foreign_bindings(
    projects: Iterable[Mapping[str, Any]], known: frozenset[str]
) -> list[dict[str, Any]]:
    """Each binding whose planning space lives in none of the `known` stores, by project and space.

    A binding whose identity does not decode names no store at all, so it is reported with
    a null store identity rather than dropped.
    """

    foreign: list[dict[str, Any]] = []
    for project in projects:
        binding = project.get("planning_binding")
        if binding is None:
            continue
        space = _binding_space(binding)
        data_scope_id = space["data_scope_id"] if space is not None else None
        if data_scope_id in known:
            continue
        foreign.append(
            {
                "project_id": project["project_id"],
                "space_key": space["space_key"] if space is not None else None,
                "data_scope_id": data_scope_id,
            }
        )
    return foreign


def _binding_space(binding: Mapping[str, Any]) -> dict[str, Any] | None:
    """The store and key of the space a binding names; None when its identity does not decode."""

    try:
        return planning_space_ref(binding_entity(binding))
    except ContractError:
        return None


class FolderPlace(TypedDict):
    project_id: str
    canonical_root: str
    #: The key of the space the project is bound to in the store asked about, or None.
    space_key: str | None


def place_of_folder(folder: str, listing: RegistryResult, data_scope_id: str) -> FolderPlace | None:
    """The project whose root holds this folder, and the space of `data_scope_id` it is bound to.

    The longest registered root that contains the folder decides, compared as the platform
    compares paths (on Windows without regard to case) and as written: a link is not
    followed, so a folder reached through one is held by the root it names. The space is
    the one that project is bound to in this store, or None when it binds none here; the
    place never falls back to a shorter root, so an unbound project inside a bound one
    stays in no space. None when no root holds the folder or the registry was not read.
    """

    if not folder:
        return None
    place = os.path.normcase(os.path.normpath(folder))
    found: tuple[int, Mapping[str, Any]] | None = None
    for candidate in listing["projects"]:
        root = os.path.normcase(os.path.normpath(str(candidate["canonical_root"])))
        if place == root or place.startswith(root.rstrip(os.sep) + os.sep):
            if found is None or len(root) > found[0]:
                found = (len(root), candidate)
    if found is None:
        return None
    holder = found[1]
    binding = holder["planning_binding"]
    space = None if binding is None else _binding_space(binding)
    return {
        "project_id": str(holder["project_id"]),
        "canonical_root": str(holder["canonical_root"]),
        "space_key": (
            str(space["space_key"])
            if space is not None and space["data_scope_id"] == data_scope_id
            else None
        ),
    }


def _space_result(
    resource_ref: dict[str, str] | None,
    status: str,
    *,
    root: str | None = None,
    reason: str = "",
) -> dict[str, object]:
    return {
        "resource_ref": resource_ref,
        "status": status,
        "canonical_root": root,
        "reason": reason,
    }


def resolve_space_root(
    resource_ref: object | None, *, reader: RegistryReader | None = None
) -> dict:
    """Resolve a planning space to its root: the root of the space's default project."""

    if resource_ref is None:
        return _space_result(None, "missing", reason="planning space binding is absent")
    try:
        canonical = planning_space_entity(planning_space_ref(resource_ref))
    except ContractError as error:
        return _space_result(
            None,
            "malformed",
            reason=f"planning space resource_ref is malformed: {error}",
        )
    listing = read_registry(reader=reader)
    if listing["status"] != "available":
        status = "malformed" if listing["status"] == "malformed" else "unavailable"
        return _space_result(canonical, status, reason=listing["reason"])
    matches = [
        project
        for project in listing["projects"]
        if binding_entity(project["planning_binding"]) == canonical
        and project["planning_binding"]["default"]
    ]
    if not matches:
        return _space_result(canonical, "missing", reason="no exact Planning binding exists")
    root = str(matches[0]["canonical_root"])
    if not os.path.isdir(root):
        return _space_result(
            canonical,
            "unavailable",
            root=root,
            reason="mapped canonical_root is not an existing directory",
        )
    answer = _space_result(canonical, "mapped", root=root)
    answer["validated"] = True
    return answer


def session_space_context(
    resource_ref: object | None,
    session_cwd: str = "",
    *,
    reader: RegistryReader | None = None,
) -> dict:
    """Return launch metadata without treating an observed cwd as authority."""

    mapping = resolve_space_root(resource_ref, reader=reader)
    if mapping["status"] == "mapped":
        mapping["effective_cwd"] = mapping["canonical_root"]
        mapping["session_cwd"] = session_cwd or ""
        mapping["fallback"] = False
        return mapping
    mapping["effective_cwd"] = ""
    mapping["session_cwd"] = session_cwd or ""
    mapping["fallback"] = False
    return mapping
