"""The Valkama skill, installed where each client finds its user's skills.

The skill is the procedure an agent follows around the planning tools, and it
has to match the tools the client actually runs. Those come from the release
the launcher pins, so the skill does too: the files are copied from that
release's `server/skill/valkama`, and a `launcher install` that pins another
release refreshes every copy installed here. A checkout's own edits reach
agents the way its code does, through the next install.

Each client keeps its user's skills in a directory it reads by itself, and
neither needs its configuration touched for a skill there: Claude Code reads
`~/.claude/skills` (under `CLAUDE_CONFIG_DIR` when that is set), and Codex reads
`~/.agents/skills`, the user location its `~/.codex/skills` predecessor is kept
beside for compatibility. This writes only there, never `~/.claude.json` or
`~/.codex/config.toml`, the same rule `setup` keeps for registrations.

A copy is Valkama's only while it can prove it: a manifest beside the files
records each one's digest. A directory without the manifest is somebody else's
skill and is left alone; a managed file edited by hand is drifted and is not
overwritten or removed without `force`. Removing a copy removes the files the
manifest names and nothing else.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from .. import launcher

SKILL_NAME = "valkama"

#: The skill's place inside a release or a checkout.
SOURCE_PARTS = ("server", "skill", SKILL_NAME)

#: The file that makes an installed copy Valkama's.
MANIFEST_NAME = ".valkama-skill.json"
SCHEMA_VERSION = 1

CLIENTS = ("claude", "codex")
CLIENT_TITLES = {"claude": "Claude Code", "codex": "Codex"}

#: What an installed copy can be. `outdated` is a managed copy of another
#: release's skill; `drifted` one whose files no longer match their manifest;
#: `unmanaged` a directory of that name Valkama did not write.
STATES = ("missing", "installed", "outdated", "drifted", "unmanaged")


class SkillError(RuntimeError):
    """The skill cannot be installed from here, or a client was misnamed."""


@dataclass(frozen=True)
class Skill:
    """The skill a copy is compared with: where it comes from, and its files."""

    origin: str
    directory: str
    revision: str | None
    files: dict[str, bytes] = field(default_factory=dict)

    def digests(self) -> dict[str, str]:
        return {name: _digest(data) for name, data in sorted(self.files.items())}

    def described(self) -> dict[str, object]:
        return {
            "origin": self.origin,
            "directory": self.directory,
            "revision": self.revision,
            "files": sorted(self.files),
        }


#: What `uninstall` compares with: no files, so every managed copy is removable.
_NOTHING = Skill(origin="none", directory="", revision=None)


def client_home(client: str) -> Path:
    """The directory whose presence says the client is set up for this user."""

    if client == "claude":
        configured = os.environ.get("CLAUDE_CONFIG_DIR")
        return Path(configured).expanduser() if configured else Path.home() / ".claude"
    if client == "codex":
        configured = os.environ.get("CODEX_HOME")
        return Path(configured).expanduser() if configured else Path.home() / ".codex"
    raise SkillError(f"unknown client {client!r}; expected one of {', '.join(CLIENTS)}")


def target(client: str) -> Path:
    """Where the client looks for this user's copy of the skill."""

    if client == "claude":
        return client_home("claude") / "skills" / SKILL_NAME
    if client == "codex":
        return Path.home() / ".agents" / "skills" / SKILL_NAME
    raise SkillError(f"unknown client {client!r}; expected one of {', '.join(CLIENTS)}")


def detected() -> list[str]:
    """The clients this user has: those whose own directory exists."""

    return [client for client in CLIENTS if client_home(client).is_dir()]


def source(launcher_directory: str | None = None) -> Skill:
    """The skill of the release the launcher pins, or of this code when none is.

    `origin` says which: `pinned` when the launcher names a release that is
    there, `running` otherwise — a development run, or no launcher at all.
    """

    try:
        state = launcher.status(launcher_directory)
    except launcher.LauncherError:
        state = {}
    script = state.get("source_script")
    revision = state.get("revision")
    if state.get("state") == "installed" and state.get("source_available") and script:
        origin, root = "pinned", Path(str(script)).parent
    else:
        origin, root, revision = "running", launcher.source_script().parent, None
    directory = root.joinpath(*SOURCE_PARTS)
    return Skill(
        origin=origin,
        directory=str(directory),
        revision=revision if isinstance(revision, str) else None,
        files=_files(directory),
    )


def _files(directory: Path) -> dict[str, bytes]:
    """Every file of the skill, by its path inside the skill, as stored."""

    if not (directory / "SKILL.md").is_file():
        return {}
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file() and "__pycache__" not in path.relative_to(directory).parts
    }


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _manifest(path: Path) -> tuple[dict[str, object] | None, dict[str, str], str | None]:
    """The manifest of a copy, the digests it records, and why it is unusable if it is."""

    if not (path / MANIFEST_NAME).is_file():
        return None, {}, None
    try:
        document = json.loads((path / MANIFEST_NAME).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        return None, {}, f"its manifest cannot be read: {error}"
    files = document.get("files") if isinstance(document, dict) else None
    if (
        not isinstance(document, dict)
        or document.get("schema_version") != SCHEMA_VERSION
        or not isinstance(files, dict)
        or not all(isinstance(value, str) for value in files.values())
    ):
        return None, {}, "its manifest is not one this build wrote"
    return document, {str(name): str(digest) for name, digest in files.items()}, None


def _contents(path: Path) -> set[str]:
    """Every file in a copy but its manifest, by its path inside the copy."""

    return {
        candidate.relative_to(path).as_posix()
        for candidate in path.rglob("*")
        if candidate.is_file() and candidate.name != MANIFEST_NAME
    }


def status(client: str, skill: Skill) -> dict[str, object]:
    """One client's copy, compared with its manifest and with `skill`."""

    path = target(client)
    answer: dict[str, object] = {
        "client": client,
        "path": str(path),
        "detected": client_home(client).is_dir(),
        "revision": None,
        "source_revision": skill.revision,
        "detail": None,
    }
    if path.is_symlink():
        return {**answer, "state": "unmanaged", "detail": "it is a link, which is never followed"}
    if not path.is_dir() or not any(path.iterdir()):
        return {**answer, "state": "missing"}
    manifest, recorded, problem = _manifest(path)
    if manifest is None:
        detail = problem or "it has no Valkama manifest, so another tool or a person wrote it"
        return {**answer, "state": "drifted" if problem else "unmanaged", "detail": detail}
    answer["revision"] = manifest.get("revision")
    problems = []
    for name, digest in sorted(recorded.items()):
        file = path / name
        if not file.is_file():
            problems.append(f"{name} is missing")
        elif _digest(file.read_bytes()) != digest:
            problems.append(f"{name} was edited")
    problems.extend(f"{name} was added" for name in sorted(_contents(path) - set(recorded)))
    if problems:
        return {**answer, "state": "drifted", "detail": "; ".join(problems)}
    return {**answer, "state": "installed" if skill.digests() == recorded else "outdated"}


def _chosen(clients: list[str] | None) -> list[str]:
    if clients is None:
        return detected()
    for client in clients:
        target(client)  # refuses an unknown name
    return list(dict.fromkeys(clients))


def install(
    clients: list[str] | None = None,
    *,
    force: bool = False,
    launcher_directory: str | None = None,
) -> dict[str, object]:
    """Write the skill for each client named, or for each one this user has.

    Idempotent: a copy that already matches is left as it is. A drifted or
    unmanaged one is refused without `force`; with it, the skill's files are
    written over it and anything else in the directory stays and is named.
    """

    skill = source(launcher_directory)
    if not skill.files:
        raise SkillError(f"there is no skill at {skill.directory}")
    return {
        "skill": skill.described(),
        "clients": [_install_one(client, skill, force=force) for client in _chosen(clients)],
    }


def _install_one(client: str, skill: Skill, *, force: bool) -> dict[str, object]:
    current = status(client, skill)
    state = current["state"]
    if state == "installed":
        return {**current, "action": "unchanged"}
    if state in ("drifted", "unmanaged") and not force:
        return {
            **current,
            "action": "refused",
            "fix": f"valkama skill install --client {client} --force",
        }
    path = Path(str(current["path"]))
    _document, previous, _problem = _manifest(path)
    for name, data in sorted(skill.files.items()):
        _atomic_write(path / name, data)
    # A file an earlier release of the skill had and this one does not.
    for name in sorted(set(previous) - set(skill.files)):
        _remove(path, name)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "skill": SKILL_NAME,
        "revision": skill.revision,
        "origin": skill.origin,
        "files": skill.digests(),
    }
    _atomic_write(
        path / MANIFEST_NAME,
        (json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode(),
    )
    _prune_empty(path)
    foreign = sorted(_contents(path) - set(skill.files))
    return {
        **status(client, skill),
        "action": "installed" if state == "missing" else "replaced",
        **({"foreign": foreign} if foreign else {}),
    }


def uninstall(clients: list[str] | None = None, *, force: bool = False) -> dict[str, object]:
    """Remove the files Valkama wrote, and the directory once nothing else is in it.

    Every client is considered when none is named, because a client may have
    been removed after the skill was installed for it. An unmanaged directory is
    never removed: nothing proves it is Valkama's to remove.
    """

    results = []
    for client in _chosen(clients) if clients is not None else list(CLIENTS):
        current = status(client, _NOTHING)
        state = current["state"]
        if state == "missing":
            results.append({**current, "action": "unchanged"})
            continue
        if state == "unmanaged" or (state == "drifted" and not force):
            results.append({**current, "action": "refused"})
            continue
        path = Path(str(current["path"]))
        _document, recorded, _problem = _manifest(path)
        for name in sorted(recorded):
            _remove(path, name)
        (path / MANIFEST_NAME).unlink(missing_ok=True)
        _prune_empty(path)
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
        results.append({**status(client, _NOTHING), "action": "removed"})
    return {"clients": results}


def refresh(launcher_directory: str | None = None) -> list[dict[str, object]]:
    """After a launcher install: bring every copy Valkama manages to the pinned skill.

    Only copies that are Valkama's and unedited move; a missing, drifted or
    unmanaged one is left as it is, because installing for a client is a
    decision `skill install` makes, not a side effect of pinning a release.
    """

    skill = source(launcher_directory)
    if not skill.files:
        return []
    return [
        _install_one(client, skill, force=False)
        for client in CLIENTS
        if status(client, skill)["state"] in ("installed", "outdated")
    ]


def report(launcher_directory: str | None = None) -> dict[str, object]:
    """Every client's copy, read only, with the skill they are compared with."""

    skill = source(launcher_directory)
    return {"skill": skill.described(), "clients": copies(skill)}


def copies(skill: Skill | None = None) -> list[dict[str, object]]:
    """Every client's copy, read only: what `skill status` and the doctor show."""

    compared = skill if skill is not None else source()
    return [status(client, compared) for client in CLIENTS]


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _remove(path: Path, name: str) -> None:
    file = path / name
    if file.is_file() and not file.is_symlink():
        file.unlink()


def _prune_empty(path: Path) -> None:
    """Remove the empty directories inside a copy, deepest first."""

    for directory in sorted(
        (candidate for candidate in path.rglob("*") if candidate.is_dir()),
        key=lambda candidate: len(candidate.parts),
        reverse=True,
    ):
        if not directory.is_symlink() and not any(directory.iterdir()):
            directory.rmdir()
