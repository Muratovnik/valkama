"""One SKILL.md, read as an entry: what it declares and whether it is valid.

The bounds are the point. A manifest is somebody else's file — it may be huge,
not valid UTF-8, or name a directory that is not inside the root it was found under —
so every read here is bounded, every path is checked for containment, and a
manifest that cannot be trusted becomes an entry that says so rather than an
exception that stops the scan.

Discovery, the owner-source merge and the read model that assembles these live
in `skills_inventory`; this module knows nothing about them, and nothing here
touches a client's activation state.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import os
import re
from pathlib import Path, PurePosixPath
from urllib.parse import quote

#: Which provider answers for the catalogue itself, as opposed to the clients
#: that own activation. §15.4 keeps those two apart, and the ref names the
#: one that found the file.
CATALOGUE_PROVIDER_ID = "filesystem-catalogue"
MAX_SKILLS_PER_ROOT = 512
MAX_SKILL_BYTES = 256 * 1024
MAX_DESCRIPTION = 240
MAX_METADATA_VALUE = 160
MAX_CAPABILITY_ENTRIES = 128
MAX_DIRECTORY_NAME = 96
_FRONTMATTER_KEY = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$")
_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def observed_at(value: str | None) -> str:
    if value:
        return str(value)
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def bounded(value: object, limit: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _strip_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def parse_frontmatter(text: str) -> tuple[dict[str, str], str | None]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, "frontmatter_missing"
    try:
        end = next(index for index, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration:
        return {}, "frontmatter_unclosed"

    values: dict[str, str] = {}
    index = 1
    while index < end:
        line = lines[index]
        if not line.strip() or line.lstrip().startswith("#"):
            index += 1
            continue
        match = _FRONTMATTER_KEY.match(line)
        if not match:
            index += 1
            continue
        key, raw = match.groups()
        raw = raw or ""
        if raw.strip() in {"|", ">"}:
            block: list[str] = []
            index += 1
            while index < end and (not lines[index].strip() or lines[index][:1].isspace()):
                block.append(lines[index].strip())
                index += 1
            values[key] = " ".join(part for part in block if part)
            continue
        values[key] = _strip_quotes(raw)
        index += 1
    return values, None


def contained(root: Path, candidate: Path) -> bool:
    try:
        root_path = str(root.resolve())
        candidate_path = str(candidate.resolve())
        return os.path.commonpath((root_path, candidate_path)) == root_path
    except (OSError, ValueError):
        return False


def lexically_contained(root: Path, candidate: Path) -> bool:
    """Containment without resolving links.

    Owner-authored junction/symlink projections are a legitimate skill layout:
    the manifest path is constructed from a real directory listing under the
    root, so its lexical path cannot traverse outside it, while resolving the
    final target would reject exactly those projections.
    """

    try:
        root_path = os.path.normpath(str(root.absolute()))
        candidate_path = os.path.normpath(str(candidate.absolute()))
        return os.path.commonpath((root_path, candidate_path)) == root_path
    except (OSError, ValueError):
        return False


def skill_directories(root: Path) -> tuple[list[Path], bool]:
    if not root.is_dir():
        return [], False
    directories: list[Path] = []
    for item in root.iterdir():
        if item.is_dir():
            directories.append(item)
            if len(directories) > MAX_SKILLS_PER_ROOT:
                break
    directories.sort(key=lambda item: item.name.casefold())
    return directories[:MAX_SKILLS_PER_ROOT], len(directories) > MAX_SKILLS_PER_ROOT


def _capability(skill_dir: Path, root: Path, name: str) -> tuple[bool, int, bool]:
    target = skill_dir / name
    try:
        if not target.is_dir() or not contained(root, target):
            return False, 0, False
        count = 0
        for _ in target.iterdir():
            count += 1
            if count > MAX_CAPABILITY_ENTRIES:
                break
        return True, min(count, MAX_CAPABILITY_ENTRIES), count > MAX_CAPABILITY_ENTRIES
    except OSError:
        return False, 0, False


def base_entry(spec: dict, directory_name: str, observed_at: str) -> dict:
    project_id = spec.get("project_id")
    safe_directory = quote(directory_name, safe="-._")
    if spec["scope"] == "global":
        key = f"global:{safe_directory}"
    else:
        key = f"project:{quote(str(project_id), safe='-._')}:{safe_directory}"
    return {
        "key": key,
        # SKL-002. The identity as an object rather than a string that happens
        # to encode one: a later reader pointing at a skill from a work item or
        # from analytics needs something to point with that is not a path, and
        # a path is not an identity anyway — the same skill projected into two
        # roots has two of them.
        "skill_ref": {
            "provider_id": CATALOGUE_PROVIDER_ID,
            "root_id": spec["id"],
            "skill_id": bounded(directory_name, 96),
            "content_hash": None,
        },
        "directory_name": bounded(directory_name, 96),
        "name": bounded(directory_name, 64),
        "description": "",
        "scope": spec["scope"],
        "source": spec["source"],
        "project_id": project_id,
        "project_title": spec.get("project_title"),
        "owner_project_id": None,
        "owner_project_title": None,
        "root_id": spec["id"],
        "location": str(PurePosixPath(spec["relative_root"], directory_name, "SKILL.md")),
        "availability": "available",
        "duplicate": False,
        "validation": {"schema": "agentskills-v1", "status": "invalid", "checks": [], "code": None},
        "capabilities": {
            "scripts": False,
            "references": False,
            "assets": False,
            "script_entries": 0,
            "reference_entries": 0,
            "asset_entries": 0,
            "script_entries_truncated": False,
            "reference_entries_truncated": False,
            "asset_entries_truncated": False,
        },
        "metadata": {"version": None, "license": None, "compatibility": None},
        "provenance": {
            "source": "filesystem",
            "observed_at": observed_at,
            "content_hash": None,
            "duplicate_of": None,
        },
    }


def skill_entry(root: Path, skill_dir: Path, spec: dict, observed_at: str) -> dict:
    entry = base_entry(spec, skill_dir.name, observed_at)
    validation = entry["validation"]
    if not contained(root, skill_dir):
        entry["availability"] = "unsafe"
        validation.update(status="invalid", code="path_escape")
        return entry
    if len(skill_dir.name) > MAX_DIRECTORY_NAME:
        validation.update(status="invalid", code="directory_name_too_long")
        return entry

    manifest = skill_dir / "SKILL.md"
    if not contained(root, manifest):
        entry["availability"] = "unsafe"
        validation.update(status="invalid", code="path_escape")
        return entry
    try:
        with manifest.open("rb") as handle:
            raw = handle.read(MAX_SKILL_BYTES + 1)
    except FileNotFoundError:
        entry["availability"] = "missing"
        validation.update(status="invalid", code="skill_file_missing")
        return entry
    except OSError:
        entry["availability"] = "unreadable"
        validation.update(status="invalid", code="skill_file_unreadable")
        return entry

    validation["checks"].append("skill_file")
    if len(raw) > MAX_SKILL_BYTES:
        validation.update(status="invalid", code="skill_file_too_large")
        return entry
    digest = hashlib.sha256(raw).hexdigest()
    entry["provenance"]["content_hash"] = digest
    # The ref carries it too: a reference to a skill whose file has changed is
    # a reference to a different skill, and a reader holding one needs to be
    # able to see that without a second lookup.
    entry["skill_ref"]["content_hash"] = digest
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        validation.update(status="invalid", code="skill_file_not_utf8")
        return entry

    frontmatter, error = parse_frontmatter(text)
    if error:
        validation.update(status="invalid", code=error)
        return entry
    validation["checks"].append("frontmatter")

    name = bounded(frontmatter.get("name"), 64)
    description = bounded(frontmatter.get("description"), MAX_DESCRIPTION)
    entry["name"] = name or entry["name"]
    entry["description"] = description
    if not name or not _NAME.fullmatch(name):
        validation.update(status="invalid", code="name_invalid")
    elif name != skill_dir.name:
        validation.update(status="invalid", code="name_directory_mismatch")
    elif not description:
        validation.update(status="invalid", code="description_missing")
    else:
        validation["checks"].extend(("name", "description", "directory_name"))
        validation.update(status="valid", code=None)

    for key in ("version", "license", "compatibility"):
        value = bounded(frontmatter.get(key), MAX_METADATA_VALUE)
        entry["metadata"][key] = value or None

    for singular, plural in (
        ("script", "scripts"),
        ("reference", "references"),
        ("asset", "assets"),
    ):
        present, count, truncated = _capability(skill_dir, root, plural)
        entry["capabilities"][plural] = present
        entry["capabilities"][f"{singular}_entries"] = count
        entry["capabilities"][f"{singular}_entries_truncated"] = truncated
    return entry


def markdown_without_frontmatter(text: str) -> str:
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return text
    for index, line in enumerate(lines[1:], 1):
        if line.strip() == "---":
            return "".join(lines[index + 1 :]).lstrip("\r\n")
    return text
