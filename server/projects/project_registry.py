r"""Strict, read-only consumption of Host Runtime's minimal project registry.

Host Runtime is the only writer and recovery owner. Valkama reads the fixed
``%LOCALAPPDATA%\Valkama\projects.json`` projection and accepts the whole
schema-v3 snapshot or none of it. The registry carries project identity and one
optional opaque Planning binding; hook configuration, index commands, memory
namespaces and source-manifest provenance are deliberately not part of it.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable, Iterable, Mapping
from typing import Any, Literal, TypedDict

from ..platform.contracts import ContractError, planning_space_entity, planning_space_ref

RegistryReader = Callable[[], bytes | None]
RegistryStatus = Literal["available", "absent", "malformed", "unavailable"]


class RegistryResult(TypedDict):
    status: RegistryStatus
    source: Literal["host_runtime"]
    projects: list[dict[str, Any]]
    reason: str


class RegistryError(ValueError):
    """The registry bytes do not satisfy Host Runtime's canonical schema."""


_DOCUMENT_KEYS = {"schema_version", "projects"}
_ENTRY_KEYS = {"project_id", "display_name", "canonical_root", "planning_binding"}
_BINDING_KEYS = {"kind", "resource_id"}
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
        "source": "host_runtime",
        "projects": [] if projects is None else projects,
        "reason": reason,
    }


def read_registry(*, reader: RegistryReader | None = None) -> RegistryResult:
    """Read one immutable snapshot through the fixed production path."""

    try:
        raw = (reader or _read_registry_bytes)()
    except FileNotFoundError:
        return _result("absent", reason="Host Runtime project registry is absent")
    except OSError as error:
        return _result(
            "unavailable", reason=f"Host Runtime project registry cannot be read: {error}"
        )
    return parse_registry(raw)


def parse_registry(raw: bytes | None) -> RegistryResult:
    """Validate exact schema-v3 bytes and return the complete set or no projects."""

    if raw is None:
        return _result("absent", reason="Host Runtime project registry is absent")
    if not isinstance(raw, bytes):
        return _result("malformed", reason="project registry reader must return bytes")
    try:
        document = json.loads(raw.decode("utf-8"))
        document = _exact_mapping(document, _DOCUMENT_KEYS, "registry")
        if document["schema_version"] != 3:
            raise RegistryError("registry.schema_version must be 3")
        projects = document["projects"]
        if not isinstance(projects, list):
            raise RegistryError("registry.projects must be an array")
        validated = _validate_projects(projects)
    except (UnicodeDecodeError, json.JSONDecodeError, RegistryError) as error:
        return _result("malformed", reason=f"Host Runtime project registry is malformed: {error}")
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


def _validate_binding(value: object, label: str) -> dict[str, str] | None:
    if value is None:
        return None
    binding = _exact_mapping(value, _BINDING_KEYS, label)
    if binding["kind"] != "planning-space":
        raise RegistryError(f"{label}.kind must be planning-space")
    return {
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
    _require_unique(
        (
            binding["resource_id"]
            for project in projects
            if (binding := project["planning_binding"]) is not None
        ),
        "planning_binding resource_id",
    )
    return sorted(projects, key=lambda project: (project["project_id"], project["canonical_root"]))


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
        "source": "host_runtime",
    }


def resolve_space_root(
    resource_ref: object | None, *, reader: RegistryReader | None = None
) -> dict:
    """Resolve one canonical Planning identity from Host Runtime's binding."""

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
        project for project in listing["projects"] if project["planning_binding"] == canonical
    ]
    if not matches:
        return _space_result(canonical, "missing", reason="no exact Planning binding exists")
    if len(matches) > 1:
        return _space_result(canonical, "ambiguous", reason=f"{len(matches)} exact bindings exist")
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
