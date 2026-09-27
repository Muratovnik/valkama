"""Own the user inventory and its fixed schema-v3 project projection."""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import stat
import tempfile
import tomllib
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from . import project_registry

SCHEMA_VERSION = 1
PROJECT_ID = re.compile(r"^[a-z][a-z0-9-]{0,159}$")


class RegistryOwnerError(ValueError):
    """The requested change cannot safely update the project registry."""


def inventory_path() -> Path:
    return Path(project_registry.registry_path()).with_name("project-registry.toml")


def projection_path() -> Path:
    return Path(project_registry.registry_path())


def rollback_path(target: Path) -> Path:
    return target.with_name(target.name + ".valkama.rollback")


def _read(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def _is_reparse(path: Path) -> bool:
    try:
        metadata = path.stat(follow_symlinks=False)
    except FileNotFoundError:
        return False
    return path.is_symlink() or bool(
        getattr(metadata, "st_file_attributes", 0)
        & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    )


def _safe_path(path: Path) -> None:
    if not path.is_absolute():
        raise RegistryOwnerError(f"state path must be absolute: {path}")
    for parent in (path.parent, *path.parent.parents):
        if _is_reparse(parent):
            raise RegistryOwnerError(f"state path traverses a link: {parent}")
    if _is_reparse(path) or (path.exists() and not path.is_file()):
        raise RegistryOwnerError(f"state path is not a regular file: {path}")


@contextmanager
def _lock(target: Path) -> Iterator[None]:
    target.parent.mkdir(parents=True, exist_ok=True)
    lock_path = target.with_name(f".{target.name}.lock")
    with lock_path.open("a+b") as handle:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()
            os.fsync(handle.fileno())
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)  # type: ignore[attr-defined]
        except OSError as error:
            raise RegistryOwnerError(f"another writer holds {lock_path}") from error
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)  # type: ignore[attr-defined]


def _replace(path: Path, expected: bytes | None, replacement: bytes | None) -> bool:
    if _read(path) != expected:
        raise RegistryOwnerError(f"state changed during update: {path}")
    if replacement == expected:
        return False
    if replacement is None:
        path.unlink(missing_ok=True)
        return True
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(replacement)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def _text(value: Any, label: str, maximum: int) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or len(value) > maximum
        or any(ord(char) < 32 for char in value)
    ):
        raise RegistryOwnerError(f"{label} must be bounded, trimmed text")
    return value


def _root(value: Any, *, resolve: bool) -> str:
    candidate = Path(_text(value, "canonical_root", 4096))
    if not candidate.is_absolute():
        raise RegistryOwnerError("canonical_root must be absolute")
    if any(part in {".", ".."} for part in candidate.parts):
        raise RegistryOwnerError("canonical_root must not contain traversal")
    if not resolve:
        return str(candidate)
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise RegistryOwnerError(f"canonical_root cannot be resolved: {error}") from error
    if not resolved.is_dir():
        raise RegistryOwnerError("canonical_root must be a directory")
    return str(resolved)


def _entry(value: Any, *, resolve_root: bool) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RegistryOwnerError("project entry must be an object")
    keys = {"project_id", "display_name", "canonical_root", "planning_binding"}
    if set(value) not in (keys, keys - {"planning_binding"}):
        raise RegistryOwnerError("project entry has missing or unknown fields")
    project_id = _text(value["project_id"], "project_id", 160)
    if PROJECT_ID.fullmatch(project_id) is None:
        raise RegistryOwnerError("project_id must be a lowercase project slug")
    binding = value.get("planning_binding")
    if binding is not None:
        if not isinstance(binding, dict) or set(binding) != {"kind", "resource_id"}:
            raise RegistryOwnerError("planning_binding must have kind and resource_id")
        if binding["kind"] != "planning-space":
            raise RegistryOwnerError("planning_binding.kind must be planning-space")
        resource_id = _text(binding["resource_id"], "planning_binding.resource_id", 512)
        binding = {"kind": "planning-space", "resource_id": resource_id}
    return {
        "project_id": project_id,
        "display_name": _text(value["display_name"], "display_name", 160),
        "canonical_root": _root(value["canonical_root"], resolve=resolve_root),
        "planning_binding": binding,
    }


def _projects(values: Any, *, resolve_root: bool) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        raise RegistryOwnerError("projects must be an array")
    projects = [_entry(value, resolve_root=resolve_root) for value in values]
    for label, identities in (
        ("project_id", [entry["project_id"] for entry in projects]),
        ("canonical_root", [entry["canonical_root"].casefold() for entry in projects]),
        (
            "planning_binding.resource_id",
            [
                entry["planning_binding"]["resource_id"]
                for entry in projects
                if entry["planning_binding"]
            ],
        ),
    ):
        if len(identities) != len(set(identities)):
            raise RegistryOwnerError(f"duplicate {label}")
    return sorted(projects, key=lambda entry: entry["project_id"])


def parse_inventory(raw: bytes) -> list[dict[str, Any]]:
    try:
        document = tomllib.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
        raise RegistryOwnerError(f"cannot parse inventory: {error}") from error
    if not isinstance(document, dict) or set(document) != {"schema_version", "projects"}:
        raise RegistryOwnerError("inventory must contain schema_version and projects")
    if type(document["schema_version"]) is not int or document["schema_version"] != SCHEMA_VERSION:
        raise RegistryOwnerError(f"inventory schema_version must be {SCHEMA_VERSION}")
    return _projects(document["projects"], resolve_root=False)


def render_inventory(projects: list[dict[str, Any]]) -> bytes:
    lines = [f"schema_version = {SCHEMA_VERSION}"]
    if not projects:
        lines.append("projects = []")
    for entry in _projects(projects, resolve_root=False):
        lines.extend(
            [
                "",
                "[[projects]]",
                f"project_id = {json.dumps(entry['project_id'], ensure_ascii=False)}",
                f"display_name = {json.dumps(entry['display_name'], ensure_ascii=False)}",
                f"canonical_root = {json.dumps(entry['canonical_root'], ensure_ascii=False)}",
            ]
        )
        if entry["planning_binding"]:
            lines.extend(
                [
                    "",
                    "[projects.planning_binding]",
                    'kind = "planning-space"',
                    f"resource_id = {json.dumps(entry['planning_binding']['resource_id'], ensure_ascii=False)}",
                ]
            )
    return ("\n".join(lines) + "\n").encode("utf-8")


def render_projection(projects: list[dict[str, Any]]) -> bytes:
    document = {"schema_version": 3, "projects": _projects(projects, resolve_root=False)}
    return (json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _existing_projection(raw: bytes | None) -> list[dict[str, Any]] | None:
    if raw is None:
        return None
    try:
        json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_json_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RegistryOwnerError(f"project projection is malformed: {error}") from error
    result = project_registry.parse_registry(raw)
    if result["status"] != "available":
        raise RegistryOwnerError(result["reason"])
    return result["projects"]


def _unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise RegistryOwnerError(f"project projection has duplicate key {key!r}")
        result[key] = value
    return result


def _snapshot(inventory: bytes | None, target: bytes | None) -> bytes:
    return (
        json.dumps(
            {
                "inventory": None
                if inventory is None
                else base64.b64encode(inventory).decode("ascii"),
                "projection": None if target is None else base64.b64encode(target).decode("ascii"),
            },
            sort_keys=True,
        )
        + "\n"
    ).encode("ascii")


def _decode_snapshot(raw: bytes) -> tuple[bytes | None, bytes | None]:
    try:
        document = json.loads(raw.decode("ascii"))
        if not isinstance(document, dict) or set(document) != {"inventory", "projection"}:
            raise ValueError("invalid rollback snapshot")
        values = []
        for name in ("inventory", "projection"):
            value = document[name]
            values.append(None if value is None else base64.b64decode(value, validate=True))
        return values[0], values[1]
    except (ValueError, TypeError, UnicodeDecodeError, KeyError, binascii.Error) as error:
        raise RegistryOwnerError(f"invalid rollback snapshot: {error}") from error


def _publish(
    inventory: Path,
    target: Path,
    before_inventory: bytes | None,
    before_target: bytes | None,
    desired_inventory: bytes,
    desired_target: bytes,
) -> bool:
    if before_inventory == desired_inventory and before_target == desired_target:
        return False
    backup = rollback_path(target)
    before_backup = _read(backup)
    snapshot = _snapshot(before_inventory, before_target)
    try:
        _replace(backup, before_backup, snapshot)
        _replace(inventory, before_inventory, desired_inventory)
        _replace(target, before_target, desired_target)
    except BaseException:
        if _read(target) == desired_target:
            _replace(target, desired_target, before_target)
        if _read(inventory) == desired_inventory:
            _replace(inventory, desired_inventory, before_inventory)
        if _read(backup) == snapshot:
            _replace(backup, snapshot, before_backup)
        raise
    return True


def update(
    inventory: Path,
    target: Path,
    *,
    add: dict[str, Any] | None = None,
    bind: tuple[str, dict[str, str]] | None = None,
    edit: tuple[str, str | None, str | None] | None = None,
    remove: str | None = None,
    source: Path | None = None,
) -> bool:
    lock_path = target.with_name(f".{target.name}.lock")
    for path in (inventory, target, rollback_path(target), lock_path):
        _safe_path(path)
    if source is not None:
        _safe_path(source)
    with _lock(target):
        before_inventory = _read(inventory)
        before_target = _read(target)
        existing = _existing_projection(before_target)
        if source is not None:
            imported = _read(source)
            if imported is None:
                raise RegistryOwnerError(f"source inventory is missing: {source}")
            projects = parse_inventory(imported)
            if before_inventory is not None and parse_inventory(before_inventory) != projects:
                raise RegistryOwnerError(
                    "Valkama inventory differs from import; refusing to overwrite it"
                )
            if existing is not None and existing != projects:
                raise RegistryOwnerError("projection differs from import; refusing to overwrite it")
            desired_inventory = imported if before_inventory is None else before_inventory
        else:
            if before_inventory is None:
                if existing is not None:
                    raise RegistryOwnerError(
                        "projection exists without inventory; import it before updating"
                    )
                if add is None:
                    raise RegistryOwnerError(f"project inventory is missing: {inventory}")
                projects = []
            else:
                projects = parse_inventory(before_inventory)
            if any(value is not None for value in (add, bind, edit, remove)):
                if existing is not None and existing != projects:
                    raise RegistryOwnerError("inventory and projection differ; run projects check")
                if add is not None:
                    projects = _projects(
                        [*projects, _entry(add, resolve_root=True)], resolve_root=False
                    )
                if edit is not None:
                    project_id, name, root = edit
                    if name is None and root is None:
                        raise RegistryOwnerError("project update requires --name or --root")
                    matches = [entry for entry in projects if entry["project_id"] == project_id]
                    if len(matches) != 1:
                        raise RegistryOwnerError(f"project is not registered: {project_id}")
                    if name is not None:
                        matches[0]["display_name"] = name
                    if root is not None:
                        matches[0]["canonical_root"] = _root(root, resolve=True)
                    projects = _projects(projects, resolve_root=False)
                if bind is not None:
                    project_id, reference = bind
                    matches = [entry for entry in projects if entry["project_id"] == project_id]
                    if len(matches) != 1:
                        raise RegistryOwnerError(f"project is not registered: {project_id}")
                    if matches[0]["planning_binding"] not in (None, reference):
                        raise RegistryOwnerError("project already has a different planning binding")
                    matches[0]["planning_binding"] = reference
                    projects = _projects(projects, resolve_root=False)
                if remove is not None:
                    reduced = [entry for entry in projects if entry["project_id"] != remove]
                    if len(reduced) == len(projects):
                        raise RegistryOwnerError(f"project is not registered: {remove}")
                    projects = reduced
            desired_inventory = render_inventory(projects)
        desired_target = render_projection(projects)
        if source is not None and existing == projects and before_target is not None:
            desired_target = before_target  # keep exact pre-transfer projection bytes
        return _publish(
            inventory,
            target,
            before_inventory,
            before_target,
            desired_inventory,
            desired_target,
        )


def check(inventory: Path, target: Path) -> dict[str, Any]:
    for path in (inventory, target):
        _safe_path(path)
    raw = _read(inventory)
    if raw is None:
        raise RegistryOwnerError(f"project inventory is missing: {inventory}")
    projects = parse_inventory(raw)
    current = _read(target)
    existing = _existing_projection(current)
    if _read(inventory) != raw or _read(target) != current:
        raise RegistryOwnerError("inventory or projection changed during check")
    semantic_match = existing == projects
    return {
        "ok": semantic_match,
        "projects": len(projects),
        "planning_bindings": sum(entry["planning_binding"] is not None for entry in projects),
        "bytes_match": current == render_projection(projects),
    }


def rollback(inventory: Path, target: Path) -> bool:
    lock_path = target.with_name(f".{target.name}.lock")
    for path in (inventory, target, rollback_path(target), lock_path):
        _safe_path(path)
    with _lock(target):
        snapshot = _read(rollback_path(target))
        if snapshot is None:
            raise RegistryOwnerError("rollback snapshot is missing")
        restored_inventory, restored_target = _decode_snapshot(snapshot)
        if restored_inventory is not None:
            parse_inventory(restored_inventory)
        _existing_projection(restored_target)
        before_inventory = _read(inventory)
        before_target = _read(target)
        try:
            _replace(inventory, before_inventory, restored_inventory)
            _replace(target, before_target, restored_target)
        except BaseException:
            if _read(target) == restored_target:
                _replace(target, restored_target, before_target)
            if _read(inventory) == restored_inventory:
                _replace(inventory, restored_inventory, before_inventory)
            raise
        return before_inventory != restored_inventory or before_target != restored_target
