"""Own the user inventory and its fixed schema-v4 project projection.

The inventory is format 2 and the projection format 4: a planning-space binding
carries `default`, several projects may bind one space, and each bound space has
exactly one default project. The format before that (inventory 1, projection 3)
is read in one place only, `_former_projects`, by the two commands that carry a
registry across: `upgrade` and `import`. Both translate it the same way, giving
every binding `default: true`, which holds because a space had one project
then.

Each write keeps the bytes it replaced for `rollback`, which undoes that one
write. A change of format, and an import into a machine with no registry, keep
once more, with their SHA-256, the bytes or absence of the inventory, the
projection and that one-write snapshot as they were before, for `downgrade`;
`rollback` never crosses a change of format.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
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

from ..store_identity.primitives import ContractError
from ..store_identity.refs import planning_space_ref
from . import project_registry, scopes

SCHEMA_VERSION = 2
FORMER_SCHEMA_VERSION = 1
FORMER_PROJECTION_VERSION = 3
PROJECT_ID = re.compile(r"^[a-z][a-z0-9-]{0,159}$")


class RegistryOwnerError(ValueError):
    """The requested change cannot safely update the project registry."""


def inventory_path() -> Path:
    return Path(project_registry.registry_path()).with_name("project-registry.toml")


def projection_path() -> Path:
    return Path(project_registry.registry_path())


def rollback_path(target: Path) -> Path:
    return target.with_name(target.name + ".valkama.rollback")


def upgrade_path(target: Path) -> Path:
    return target.with_name(target.name + ".valkama.upgrade")


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


def _safe_state(inventory: Path, target: Path) -> None:
    lock_path = target.with_name(f".{target.name}.lock")
    for path in (inventory, target, rollback_path(target), upgrade_path(target), lock_path):
        _safe_path(path)


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


def _replace_all(changes: list[tuple[Path, bytes | None, bytes | None]]) -> None:
    """Write each file in order; on a failure, put back every one already written."""

    reached = 0
    try:
        for path, before, after in changes:
            reached += 1
            _replace(path, before, after)
    except BaseException:
        for path, before, after in reversed(changes[:reached]):
            if after != before and _read(path) == after:
                _replace(path, after, before)
        raise


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


def _binding(value: Any, *, former: bool) -> dict[str, Any] | None:
    if value is None:
        return None
    keys = {"kind", "resource_id"} if former else {"kind", "resource_id", "default"}
    if not isinstance(value, dict) or set(value) != keys:
        raise RegistryOwnerError(
            "planning_binding must have kind and resource_id"
            if former
            else "planning_binding must have kind, resource_id and default"
        )
    if value["kind"] != "planning-space":
        raise RegistryOwnerError("planning_binding.kind must be planning-space")
    if not former and type(value["default"]) is not bool:
        raise RegistryOwnerError("planning_binding.default must be true or false")
    return {
        "default": True if former else value["default"],
        "kind": "planning-space",
        "resource_id": _text(value["resource_id"], "planning_binding.resource_id", 512),
    }


def _entry(value: Any, *, resolve_root: bool, former: bool = False) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RegistryOwnerError("project entry must be an object")
    keys = {"project_id", "display_name", "canonical_root", "planning_binding"}
    if set(value) not in (keys, keys - {"planning_binding"}):
        raise RegistryOwnerError("project entry has missing or unknown fields")
    project_id = _text(value["project_id"], "project_id", 160)
    if PROJECT_ID.fullmatch(project_id) is None:
        raise RegistryOwnerError("project_id must be a lowercase project slug")
    return {
        "project_id": project_id,
        "display_name": _text(value["display_name"], "display_name", 160),
        "canonical_root": _root(value["canonical_root"], resolve=resolve_root),
        "planning_binding": _binding(value.get("planning_binding"), former=former),
    }


def _projects(values: Any, *, resolve_root: bool, former: bool = False) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        raise RegistryOwnerError("projects must be an array")
    projects = [_entry(value, resolve_root=resolve_root, former=former) for value in values]
    bound = [entry["planning_binding"] for entry in projects if entry["planning_binding"]]
    unique = [
        ("project_id", [entry["project_id"] for entry in projects]),
        ("canonical_root", [entry["canonical_root"].casefold() for entry in projects]),
    ]
    if former:
        unique.append(
            ("planning_binding.resource_id", [binding["resource_id"] for binding in bound])
        )
    for label, identities in unique:
        if len(identities) != len(set(identities)):
            raise RegistryOwnerError(f"duplicate {label}")
    defaults: dict[str, int] = {}
    for binding in bound:
        defaults[binding["resource_id"]] = defaults.get(binding["resource_id"], 0) + int(
            binding["default"]
        )
    for resource_id, count in defaults.items():
        if count != 1:
            raise RegistryOwnerError(
                f"planning space {_space_key(resource_id)} must have exactly one default"
                f" project, not {count}"
            )
    return sorted(projects, key=lambda entry: entry["project_id"])


def _space_key(resource_id: str) -> str:
    """The key a binding's opaque identity names, for a message; the identity itself if none."""

    try:
        return str(
            planning_space_ref({"kind": "planning-space", "resource_id": resource_id})["space_key"]
        )
    except ContractError:
        return resource_id


def _toml(raw: bytes) -> dict[str, Any]:
    try:
        document = tomllib.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
        raise RegistryOwnerError(f"cannot parse inventory: {error}") from error
    if not isinstance(document, dict) or set(document) != {"schema_version", "projects"}:
        raise RegistryOwnerError("inventory must contain schema_version and projects")
    return document


def _version(document: dict[str, Any]) -> object:
    version = document["schema_version"]
    return version if type(version) is int else None


def parse_inventory(raw: bytes) -> list[dict[str, Any]]:
    document = _toml(raw)
    version = _version(document)
    if version == FORMER_SCHEMA_VERSION:
        raise RegistryOwnerError(
            f"inventory schema_version is {FORMER_SCHEMA_VERSION}: run valkama projects upgrade"
        )
    if version != SCHEMA_VERSION:
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
            binding = entry["planning_binding"]
            lines.extend(
                [
                    "",
                    "[projects.planning_binding]",
                    'kind = "planning-space"',
                    f"resource_id = {json.dumps(binding['resource_id'], ensure_ascii=False)}",
                    f"default = {'true' if binding['default'] else 'false'}",
                ]
            )
    return ("\n".join(lines) + "\n").encode("utf-8")


def render_projection(projects: list[dict[str, Any]]) -> bytes:
    document = {
        "schema_version": project_registry.SCHEMA_VERSION,
        "projects": _projects(projects, resolve_root=False),
    }
    return (json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _json(raw: bytes) -> object:
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_json_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RegistryOwnerError(f"project projection is malformed: {error}") from error


def _projection_version(raw: bytes) -> object:
    document = _json(raw)
    if not isinstance(document, dict) or set(document) != {"schema_version", "projects"}:
        raise RegistryOwnerError("project projection must contain schema_version and projects")
    return _version(document)


def _existing_projection(raw: bytes | None) -> list[dict[str, Any]] | None:
    if raw is None:
        return None
    if _projection_version(raw) == FORMER_PROJECTION_VERSION:
        raise RegistryOwnerError(
            f"project projection is format {FORMER_PROJECTION_VERSION}:"
            " run valkama projects upgrade"
        )
    result = project_registry.parse_registry(raw)
    if result["status"] != "available":
        raise RegistryOwnerError(result["reason"])
    return result["projects"]


def _former_projects(raw: bytes, *, projection: bool) -> list[dict[str, Any]]:
    """Read an inventory of format 1 or a projection of format 3, translated to the current shape.

    The one reader of the former format. Its entries have the shape of today's,
    each binding marked `default: true`: in that format a space had one project.
    """

    if projection:
        document = _json(raw)
        if not isinstance(document, dict) or set(document) != {"schema_version", "projects"}:
            raise RegistryOwnerError("project projection must contain schema_version and projects")
        expected, label = FORMER_PROJECTION_VERSION, "projection"
    else:
        document = _toml(raw)
        expected, label = FORMER_SCHEMA_VERSION, "inventory"
    if _version(document) != expected:
        raise RegistryOwnerError(f"former {label} schema_version must be {expected}")
    return _projects(document["projects"], resolve_root=False, former=True)


def _unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise RegistryOwnerError(f"project projection has duplicate key {key!r}")
        result[key] = value
    return result


def _encoded(value: bytes | None) -> str | None:
    return None if value is None else base64.b64encode(value).decode("ascii")


def _decoded(value: object) -> bytes | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("snapshot bytes must be base64 text")
    return base64.b64decode(value, validate=True)


def _snapshot(inventory: bytes | None, target: bytes | None) -> bytes:
    return (
        json.dumps(
            {"inventory": _encoded(inventory), "projection": _encoded(target)},
            sort_keys=True,
        )
        + "\n"
    ).encode("ascii")


def _decode_snapshot(raw: bytes) -> tuple[bytes | None, bytes | None]:
    try:
        document = json.loads(raw.decode("ascii"))
        if not isinstance(document, dict) or set(document) != {"inventory", "projection"}:
            raise ValueError("invalid rollback snapshot")
        return _decoded(document["inventory"]), _decoded(document["projection"])
    except (ValueError, TypeError, UnicodeDecodeError, KeyError, binascii.Error) as error:
        raise RegistryOwnerError(f"invalid rollback snapshot: {error}") from error


def _digest(value: bytes | None) -> str | None:
    return None if value is None else hashlib.sha256(value).hexdigest()


#: The field holding each file an upgrade snapshot keeps: inventory, projection, one-write snapshot.
_UPGRADE_FIELDS = ("inventory", "projection", "rollback")


def _upgrade_snapshot(inventory: bytes | None, target: bytes | None, backup: bytes | None) -> bytes:
    document: dict[str, str | None] = {}
    for field, value in zip(_UPGRADE_FIELDS, (inventory, target, backup), strict=True):
        document[field] = _encoded(value)
        document[f"{field}_sha256"] = _digest(value)
    return (json.dumps(document, indent=2, sort_keys=True) + "\n").encode("ascii")


def _decode_upgrade_snapshot(raw: bytes) -> tuple[bytes | None, bytes | None, bytes | None]:
    """The inventory, projection and one-write snapshot, each checked against its SHA-256."""

    keys = {key for field in _UPGRADE_FIELDS for key in (field, f"{field}_sha256")}
    try:
        document = json.loads(raw.decode("ascii"))
        if not isinstance(document, dict) or set(document) != keys:
            raise ValueError("unknown or missing fields")
        inventory, target, backup = (_decoded(document[field]) for field in _UPGRADE_FIELDS)
    except (ValueError, TypeError, UnicodeDecodeError, binascii.Error) as error:
        raise RegistryOwnerError(f"invalid upgrade snapshot: {error}") from error
    if any(
        _digest(value) != document[f"{field}_sha256"]
        for field, value in zip(_UPGRADE_FIELDS, (inventory, target, backup), strict=True)
    ):
        raise RegistryOwnerError("upgrade snapshot bytes do not match their SHA-256; not restored")
    return inventory, target, backup


def _publish(
    inventory: Path,
    target: Path,
    before_inventory: bytes | None,
    before_target: bytes | None,
    desired_inventory: bytes,
    desired_target: bytes,
    *,
    first: bool = False,
) -> bool:
    """One write, keeping the bytes it replaces for `rollback`.

    `first` marks the write that brings a registry to a machine with none, or to one
    with no project: it also keeps that state for `downgrade`, unless an upgrade
    snapshot already holds an earlier one.
    """

    if before_inventory == desired_inventory and before_target == desired_target:
        return False
    backup = rollback_path(target)
    before_backup = _read(backup)
    snapshot = upgrade_path(target)
    kept: list[tuple[Path, bytes | None, bytes | None]] = []
    if first and _read(snapshot) is None:
        kept.append(
            (snapshot, None, _upgrade_snapshot(before_inventory, before_target, before_backup))
        )
    _replace_all(
        [
            *kept,
            (backup, before_backup, _snapshot(before_inventory, before_target)),
            (inventory, before_inventory, desired_inventory),
            (target, before_target, desired_target),
        ]
    )
    return True


def _carry_across(
    inventory: Path,
    target: Path,
    before_inventory: bytes | None,
    before_target: bytes | None,
    projects: list[dict[str, Any]],
) -> bool:
    """Write the registry in the current format, keeping the former bytes once for `downgrade`."""

    snapshot = upgrade_path(target)
    if _read(snapshot) is not None:
        raise RegistryOwnerError(
            f"an upgrade snapshot already exists: {snapshot};"
            " run valkama projects downgrade before upgrading again"
        )
    _replace_all(
        [
            (
                snapshot,
                None,
                _upgrade_snapshot(before_inventory, before_target, _read(rollback_path(target))),
            ),
            (inventory, before_inventory, render_inventory(projects)),
            (target, before_target, render_projection(projects)),
        ]
    )
    return True


def _is_current(inventory: bytes) -> bool:
    """Whether the inventory is already in the current format, by its version alone."""

    return _version(_toml(inventory)) == SCHEMA_VERSION


def _write_current(
    inventory: Path,
    target: Path,
    before_inventory: bytes | None,
    before_target: bytes | None,
    projects: list[dict[str, Any]],
) -> bool:
    """Write `projects` in the current formats, keeping each file that already holds exactly them.

    A registry with no project is the same as none: a machine with neither file, and an
    import into an empty registry, both reach this as their first write.
    """

    held = [] if before_inventory is None else parse_inventory(before_inventory)
    shown = [] if before_target is None else _existing_projection(before_target)
    return _publish(
        inventory,
        target,
        before_inventory,
        before_target,
        before_inventory
        if before_inventory is not None and held == projects
        else render_inventory(projects),
        before_target
        if before_target is not None and shown == projects
        else render_projection(projects),
        first=not held and not shown,
    )


def upgrade(inventory: Path, target: Path) -> bool:
    """Carry an inventory of format 1 and its projection of format 3 to formats 2 and 4.

    On a machine with neither file there is no project to carry: it gets the empty
    registry of those formats, as an import into it would write.
    """

    _safe_state(inventory, target)
    with _lock(target):
        before_inventory = _read(inventory)
        before_target = _read(target)
        if before_inventory is None:
            if before_target is not None:
                raise RegistryOwnerError(
                    f"project inventory is missing: {inventory};"
                    " import the former one with valkama projects import --source <file>"
                )
            return _write_current(inventory, target, None, None, [])
        if _is_current(before_inventory):
            return False
        projects = _former_projects(before_inventory, projection=False)
        if before_target is not None and (
            _former_projects(before_target, projection=True) != projects
        ):
            raise RegistryOwnerError(
                "inventory and projection differ; run valkama projects apply with the"
                " release that wrote them, then upgrade"
            )
        return _carry_across(inventory, target, before_inventory, before_target, projects)


def import_inventory(inventory: Path, target: Path, source: Path) -> bool:
    """Take a former writer's inventory of format 1 once, into inventory 2 and projection 4."""

    _safe_state(inventory, target)
    _safe_path(source)
    with _lock(target):
        imported = _read(source)
        if imported is None:
            raise RegistryOwnerError(f"source inventory is missing: {source}")
        try:
            projects = _former_projects(imported, projection=False)
        except RegistryOwnerError as error:
            raise RegistryOwnerError(f"source inventory: {error}") from error
        before_inventory = _read(inventory)
        before_target = _read(target)
        former: list[bool] = []
        if before_inventory is not None:
            old = _version(_toml(before_inventory)) == FORMER_SCHEMA_VERSION
            former.append(old)
            held = (
                _former_projects(before_inventory, projection=False)
                if old
                else parse_inventory(before_inventory)
            )
            if held and held != projects:
                raise RegistryOwnerError(
                    "Valkama inventory differs from import; refusing to overwrite it"
                )
        if before_target is not None:
            old = _projection_version(before_target) == FORMER_PROJECTION_VERSION
            former.append(old)
            shown = (
                _former_projects(before_target, projection=True)
                if old
                else _existing_projection(before_target)
            )
            if shown and shown != projects:
                raise RegistryOwnerError("projection differs from import; refusing to overwrite it")
        if len(set(former)) > 1:
            raise RegistryOwnerError(
                "inventory and projection are of different formats; refusing to import"
            )
        if any(former):
            return _carry_across(inventory, target, before_inventory, before_target, projects)
        return _write_current(inventory, target, before_inventory, before_target, projects)


def downgrade(inventory: Path, target: Path) -> bool:
    """Put back exactly the three files the upgrade snapshot keeps, and remove it."""

    _safe_state(inventory, target)
    with _lock(target):
        snapshot = upgrade_path(target)
        raw = _read(snapshot)
        if raw is None:
            raise RegistryOwnerError(f"upgrade snapshot is missing: {snapshot}")
        restored_inventory, restored_target, restored_backup = _decode_upgrade_snapshot(raw)
        backup = rollback_path(target)
        _replace_all(
            [
                (inventory, _read(inventory), restored_inventory),
                (target, _read(target), restored_target),
                (backup, _read(backup), restored_backup),
                (snapshot, raw, None),
            ]
        )
        return True


def _leaving_default(projects: list[dict[str, Any]], entry: dict[str, Any]) -> None:
    """Refuse taking a space's default project away while the space keeps other projects."""

    binding = entry["planning_binding"]
    if binding is None or not binding["default"]:
        return
    others = sorted(
        other["project_id"]
        for other in projects
        if other is not entry
        and other["planning_binding"]
        and other["planning_binding"]["resource_id"] == binding["resource_id"]
    )
    if others:
        key = _space_key(binding["resource_id"])
        raise RegistryOwnerError(
            f"{entry['project_id']} is the default project of planning space {key}, which keeps"
            f" {', '.join(others)}; first make another one its default:"
            f" valkama projects bind {others[0]} --space {key} --default"
        )


def _bind(
    projects: list[dict[str, Any]], project_id: str, reference: dict[str, str], make_default: bool
) -> None:
    matches = [entry for entry in projects if entry["project_id"] == project_id]
    if len(matches) != 1:
        raise RegistryOwnerError(f"project is not registered: {project_id}")
    entry = matches[0]
    resource_id = _text(reference.get("resource_id"), "planning_binding.resource_id", 512)
    current = entry["planning_binding"]
    staying = current is not None and current["resource_id"] == resource_id
    if not staying:
        _leaving_default(projects, entry)
    siblings = [
        other
        for other in projects
        if other is not entry
        and other["planning_binding"]
        and other["planning_binding"]["resource_id"] == resource_id
    ]
    default = make_default or not siblings or (staying and bool(current and current["default"]))
    if default:
        for other in siblings:
            other["planning_binding"] = dict(other["planning_binding"], default=False)
    entry["planning_binding"] = {
        "default": default,
        "kind": "planning-space",
        "resource_id": resource_id,
    }


def update(
    inventory: Path,
    target: Path,
    *,
    add: dict[str, Any] | None = None,
    bind: tuple[str, dict[str, str], bool] | None = None,
    edit: tuple[str, str | None, str | None] | None = None,
    remove: str | None = None,
) -> bool:
    """One write of the inventory and its projection; with no change named, republish them."""

    _safe_state(inventory, target)
    with _lock(target):
        before_inventory = _read(inventory)
        before_target = _read(target)
        existing = _existing_projection(before_target)
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
                _bind(projects, *bind)
                projects = _projects(projects, resolve_root=False)
            if remove is not None:
                removed = [entry for entry in projects if entry["project_id"] == remove]
                if not removed:
                    raise RegistryOwnerError(f"project is not registered: {remove}")
                _leaving_default(projects, removed[0])
                projects = [entry for entry in projects if entry["project_id"] != remove]
        return _publish(
            inventory,
            target,
            before_inventory,
            before_target,
            render_inventory(projects),
            render_projection(projects),
        )


def check(inventory: Path, target: Path, primary_db: str) -> dict[str, Any]:
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
    known, unreadable = scopes.data_scope_ids(primary_db)
    return {
        "ok": semantic_match,
        "projects": len(projects),
        "planning_bindings": sum(entry["planning_binding"] is not None for entry in projects),
        "bytes_match": current == render_projection(projects),
        # Reported, not refused: the registry is consistent, but a binding names a store
        # this machine does not hold, so no planning read can answer for that project.
        "foreign_bindings": project_registry.foreign_bindings(projects, known),
        "unreadable_stores": unreadable,
    }


def rollback(inventory: Path, target: Path) -> bool:
    """Undo the last write, from the bytes it saved; never across a change of format."""

    _safe_state(inventory, target)
    with _lock(target):
        snapshot = _read(rollback_path(target))
        if snapshot is None:
            hint = (
                "; the registry was upgraded: run valkama projects downgrade to return to the"
                " former format"
                if _read(upgrade_path(target)) is not None
                else ""
            )
            raise RegistryOwnerError(f"rollback snapshot is missing{hint}")
        restored_inventory, restored_target = _decode_snapshot(snapshot)
        if (
            restored_inventory is not None and _version(_toml(restored_inventory)) != SCHEMA_VERSION
        ) or (
            restored_target is not None
            and _projection_version(restored_target) != project_registry.SCHEMA_VERSION
        ):
            raise RegistryOwnerError(
                "the rollback snapshot holds the registry in another format;"
                " run valkama projects downgrade to return to the format before the upgrade"
            )
        if restored_inventory is not None:
            parse_inventory(restored_inventory)
        _existing_projection(restored_target)
        before_inventory = _read(inventory)
        before_target = _read(target)
        _replace_all(
            [
                (inventory, before_inventory, restored_inventory),
                (target, before_target, restored_target),
            ]
        )
        return before_inventory != restored_inventory or before_target != restored_target
