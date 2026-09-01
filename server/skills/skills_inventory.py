"""Bounded, read-only inventory of canonical Agent Skills roots.

The inventory exposes metadata, validation, and change identity only. An
explicit detail request may read one bounded manifest for preview. Neither
surface executes a skill or grants installation, trust, or runtime authority.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from ..projects import project_registry
from . import manifests, skill_activation

INTERFACE_VERSION = "skills"
#: Which provider answers for the catalogue itself, as opposed to the clients
#: that own activation. §15.4 keeps those two apart, and the ref names the
#: one that found the file.
CLIENTS = ({"id": "codex"}, {"id": "claude"})
CLIENT_IDS = frozenset(client["id"] for client in CLIENTS)
MAX_PROJECTS = 100
_activation_states = skill_activation.activation_states


def _root_spec(
    *,
    root_id: str,
    root: Path,
    boundary: Path,
    scope: str,
    source: str,
    project_id: str | None = None,
    project_title: str | None = None,
    relative_root: str = ".agents/skills",
) -> dict:
    return {
        "id": root_id,
        "root": root,
        "boundary": boundary,
        "scope": scope,
        "source": source,
        "project_id": project_id,
        # The registry file calls this `board`; it is owner-written and stays
        # that way on disk. What Valkama publishes names a project.
        "project_title": project_title,
        "relative_root": relative_root,
    }


def _scan_root(spec: dict, observed_at: str) -> tuple[dict, list[dict]]:
    root = spec["root"]
    root_payload = {
        "id": spec["id"],
        "scope": spec["scope"],
        "source": spec["source"],
        "project_id": spec.get("project_id"),
        "project_title": spec.get("project_title"),
        "relative_root": spec["relative_root"],
        "availability": "available",
        "validation": "valid",
        "skill_count": 0,
        "truncated": False,
        "reason": None,
        "manifest_source_hash": None,
    }
    if not manifests.contained(spec["boundary"], root):
        root_payload.update(availability="unsafe", validation="invalid", reason="root_path_escape")
        return root_payload, []
    try:
        if not root.exists():
            root_payload.update(availability="missing", validation="invalid", reason="root_missing")
            return root_payload, []
        if not root.is_dir():
            root_payload.update(
                availability="unavailable", validation="invalid", reason="root_not_directory"
            )
            return root_payload, []
    except OSError:
        root_payload.update(
            availability="unavailable", validation="invalid", reason="root_unreadable"
        )
        return root_payload, []

    try:
        directories, truncated = manifests.skill_directories(root)
    except OSError:
        root_payload.update(
            availability="unavailable", validation="invalid", reason="root_unreadable"
        )
        return root_payload, []
    entries = [manifests.skill_entry(root, skill, spec, observed_at) for skill in directories]
    root_payload["skill_count"] = len(entries)
    root_payload["truncated"] = truncated
    invalid = sum(item["validation"]["status"] == "invalid" for item in entries)
    partial = sum(item["validation"]["status"] == "partial" for item in entries)
    if invalid or partial or truncated:
        root_payload["validation"] = "partial"
        root_payload["availability"] = "partial"
        if truncated and (invalid or partial):
            root_payload["reason"] = "skill_limit_and_validation_incomplete"
        elif truncated:
            root_payload["reason"] = "skill_limit_reached"
        else:
            root_payload["reason"] = "skill_validation_incomplete"
    return root_payload, entries


def _inventory_specs(home: Path, registered: list[dict]) -> list[dict]:
    specs = [
        _root_spec(
            root_id="global-agent-skills",
            root=home / ".agents" / "skills",
            boundary=home,
            scope="global",
            source="user-canonical",
        )
    ]
    for project in registered:
        project_root = Path(project["canonical_root"])
        specs.append(
            _root_spec(
                root_id=f"project:{project['project_id']}",
                root=project_root / ".agents" / "skills",
                boundary=project_root,
                scope="project",
                source="project-local",
                project_id=project["project_id"],
                project_title=project["display_name"],
            )
        )
    return specs


def _reconcile_root_status(roots: list[dict], skills: list[dict]) -> None:
    entries_by_root: dict[str, list[dict]] = {}
    for skill in skills:
        entries_by_root.setdefault(skill["root_id"], []).append(skill)
    for root in roots:
        if root.get("reason") != "skill_validation_incomplete" or root.get("truncated"):
            continue
        entries = entries_by_root.get(root["id"], [])
        if entries and all(entry["validation"]["status"] == "valid" for entry in entries):
            root.update(availability="available", validation="valid", reason=None)


def inventory_payload(
    *,
    registry_reader: project_registry.RegistryReader | None = None,
    user_home: str | None = None,
    observed_at: str | None = None,
) -> dict:
    """Return an ephemeral inventory without creating files or sidecars."""

    timestamp = manifests.observed_at(observed_at)
    home = Path(user_home).expanduser() if user_home else Path.home()
    registry = project_registry.read_registry(reader=registry_reader)
    total_project_count = len(registry["projects"])
    registered = registry["projects"][:MAX_PROJECTS]
    registry_truncated = total_project_count > MAX_PROJECTS
    specs = _inventory_specs(home, registered)

    roots: list[dict] = []
    skills: list[dict] = []
    for spec in specs:
        root_payload, entries = _scan_root(spec, timestamp)
        roots.append(root_payload)
        skills.extend(entries)
    _reconcile_root_status(roots, skills)

    variants: dict[str, list[dict]] = {}
    for skill in skills:
        variants.setdefault(skill["name"].casefold(), []).append(skill)
    for group in variants.values():
        if len(group) < 2:
            continue
        first = group[0]["key"]
        for skill in group:
            skill["duplicate"] = True
            skill["provenance"]["duplicate_of"] = None if skill["key"] == first else first

    states = _activation_states(skills, specs, home)
    for skill in skills:
        skill["clients"] = states.get(
            skill["key"],
            {
                "codex": {
                    "enabled": None,
                    "can_toggle": False,
                    "status": "unavailable",
                    "reason": "activation_unavailable",
                },
                "claude": {
                    "enabled": None,
                    "can_toggle": False,
                    "status": "unavailable",
                    "reason": "activation_unavailable",
                },
            },
        )

    project_rows = []
    for project in registered:
        project_roots = [root for root in roots if root.get("project_id") == project["project_id"]]
        statuses = [root["availability"] for root in project_roots]
        if "available" in statuses:
            root_status = "available"
        elif "partial" in statuses:
            root_status = "partial"
        else:
            root_status = statuses[0] if statuses else "unavailable"
        project_rows.append(
            {
                "id": project["project_id"],
                "project_title": project["display_name"],
                "skill_count": sum(
                    skill.get("project_id") == project["project_id"]
                    or skill.get("owner_project_id") == project["project_id"]
                    for skill in skills
                ),
                "root_status": root_status,
            }
        )

    valid = sum(item["validation"]["status"] == "valid" for item in skills)
    invalid = sum(item["validation"]["status"] == "invalid" for item in skills)
    partial = len(skills) - valid - invalid
    return {
        "interface_version": INTERFACE_VERSION,
        "as_of": timestamp,
        "clients": [dict(client) for client in CLIENTS],
        "registry": {
            "status": registry["status"],
            "source": "host_runtime",
            "project_count": len(registered),
            "total_project_count": total_project_count,
            "truncated": registry_truncated,
            "reason": "project_limit_reached"
            if registry_truncated
            else (
                f"host_runtime_registry_{registry['status']}"
                if registry["status"] != "available"
                else None
            ),
        },
        "roots": roots,
        "projects": project_rows,
        "skills": skills,
        "summary": {
            "roots": len(roots),
            "projects": len(project_rows),
            "skills": len(skills),
            "valid": valid,
            "invalid": invalid,
            "partial": partial,
            "duplicates": sum(bool(item["duplicate"]) for item in skills),
        },
    }


#: How many cells one matrix reads. Every Claude cell is a settings chain read
#: from disk, so the product of skills and projects is the cost — and a matrix
#: that quietly stopped partway would be read as a complete one.
MAX_MATRIX_CELLS = 2000


MISSING_CELL = {
    "enabled": None,
    "can_toggle": False,
    "status": "unavailable",
    "reason": "activation_unavailable",
}


def _activation_target(
    *,
    key: str,
    registry_reader: project_registry.RegistryReader | None,
    user_home: str | None,
) -> tuple[dict, dict, Path]:
    home = Path(user_home).expanduser() if user_home else Path.home()
    registry = project_registry.read_registry(reader=registry_reader)
    registered = registry["projects"][:MAX_PROJECTS]
    specs = _inventory_specs(home, registered)
    candidates: list[tuple[dict, dict, Path]] = []
    for spec in specs:
        if not manifests.contained(spec["boundary"], spec["root"]):
            continue
        try:
            directories, _ = manifests.skill_directories(spec["root"])
        except OSError:
            continue
        for skill_dir in directories:
            entry = manifests.skill_entry(
                spec["root"], skill_dir, spec, manifests.observed_at(None)
            )
            candidates.append((entry, spec, skill_dir / "SKILL.md"))

    variants: dict[str, list[tuple[dict, dict, Path]]] = {}
    for candidate in candidates:
        variants.setdefault(candidate[0]["name"].casefold(), []).append(candidate)
    for group in variants.values():
        if len(group) < 2:
            continue
        for entry, _, _ in group:
            entry["duplicate"] = True

    matches = [candidate for candidate in candidates if candidate[0]["key"] == key]
    if len(matches) != 1:
        raise skill_activation.SkillActivationError("skill_not_found", status=404)
    return matches[0]


def skill_detail(
    *,
    key: str,
    registry_reader: project_registry.RegistryReader | None = None,
    user_home: str | None = None,
) -> dict:
    """Return one bounded manifest body selected by its stable logical key."""

    if not isinstance(key, str) or not key or len(key) > 256:
        raise skill_activation.SkillActivationError("skill_detail_invalid", status=422)
    entry, spec, manifest = _activation_target(
        key=key, registry_reader=registry_reader, user_home=user_home
    )
    if not manifests.lexically_contained(spec["root"], manifest):
        raise skill_activation.SkillActivationError("skill_path_unsafe", status=409)
    try:
        with manifest.open("rb") as handle:
            raw = handle.read(manifests.MAX_SKILL_BYTES + 1)
    except FileNotFoundError as error:
        raise skill_activation.SkillActivationError("skill_file_missing", status=404) from error
    except OSError as error:
        raise skill_activation.SkillActivationError("skill_file_unreadable", status=409) from error
    if len(raw) > manifests.MAX_SKILL_BYTES:
        raise skill_activation.SkillActivationError("skill_file_too_large", status=413)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise skill_activation.SkillActivationError("skill_file_not_utf8", status=409) from error
    return {
        "interface_version": "skill-detail",
        "key": entry["key"],
        "name": entry["name"],
        "location": entry["location"],
        "content_hash": hashlib.sha256(raw).hexdigest(),
        "markdown": manifests.markdown_without_frontmatter(text),
    }


def _project_root(
    project_id: str, *, registry_reader: project_registry.RegistryReader | None
) -> Path:
    """The checkout a Host Runtime project maps to, or a refusal naming it."""

    for project in project_registry.read_registry(reader=registry_reader)["projects"]:
        if str(project.get("project_id")) == project_id and project.get("canonical_root"):
            return Path(str(project["canonical_root"])).expanduser()
    raise skill_activation.SkillActivationError("project_root_unavailable", status=404)


def update_skill_activation(
    *,
    key: str,
    client: str,
    enabled: object,
    project: str | None = None,
    registry_reader: project_registry.RegistryReader | None = None,
    user_home: str | None = None,
) -> dict:
    """Turn one canonical skill on or off at the client-owned boundary."""

    if (
        not isinstance(key, str)
        or len(key) > 256
        or client not in CLIENT_IDS
        or not isinstance(enabled, bool)
        or (project is not None and (not isinstance(project, str) or len(project) > 256))
    ):
        raise skill_activation.SkillActivationError("skill_activation_invalid", status=422)
    if project is not None and not skill_activation.CLIENT_PROJECT_SCOPE.get(client, False):
        raise skill_activation.SkillActivationError(
            "client_activation_is_not_project_scoped", status=409
        )
    entry, spec, manifest = _activation_target(
        key=key, registry_reader=registry_reader, user_home=user_home
    )
    if entry["availability"] != "available" or entry["validation"]["status"] != "valid":
        raise skill_activation.SkillActivationError("skill_invalid", status=409)
    home = Path(user_home).expanduser() if user_home else Path.home()
    if client == "codex":
        skill_activation.set_codex_skill(manifest, enabled)
    else:
        if entry["duplicate"]:
            raise skill_activation.SkillActivationError("claude_skill_name_collision", status=409)
        project_root = (
            _project_root(project, registry_reader=registry_reader)
            if project is not None
            else (spec["boundary"] if entry["scope"] == "project" else None)
        )
        projection = skill_activation.claude_projection_status(
            manifest, home=home, project_root=project_root
        )
        if projection == "conflict":
            raise skill_activation.SkillActivationError(
                "claude_skill_projection_conflict", status=409
            )
        if projection == "missing" and enabled:
            skill_activation.ensure_claude_projection(
                manifest, home=home, project_root=project_root
            )
        skill_activation.set_claude_skill(
            entry["name"], enabled, home=home, project_root=project_root
        )
    return inventory_payload(registry_reader=registry_reader, user_home=user_home)
