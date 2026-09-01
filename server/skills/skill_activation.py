"""Owner-correct activation adapters for canonical Agent Skills.

Codex owns its enabled state through the app-server protocol. Claude Code owns
its enabled state through ``skillOverrides``. This module keeps those two
contracts separate and never exposes canonical absolute paths to the browser.
"""

from __future__ import annotations

import contextlib
import json
import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path

MAX_APP_SERVER_OUTPUT = 4 * 1024 * 1024
MAX_CLAUDE_SETTINGS_BYTES = 1024 * 1024
APP_SERVER_TIMEOUT_SECONDS = 12
CLAUDE_OVERRIDE_VALUES = frozenset({"on", "off", "name-only", "user-invocable-only"})

#: Whether a client can hold a different answer per project, declared rather
#: than inferred. Claude's `skillOverrides` may be set in any settings file and
#: a project's file outranks the user's, so it can. Codex writes enablement
#: against a manifest path with no project in the call, and `list_codex_skills`
#: treats one path reporting two different values across cwds as a conflict —
#: which is the same statement made as an assertion.
#:
#: A matrix that offered a per-project toggle for a client without one would be
#: the fictional universality §15.4 forbids: the control would appear to decide
#: something and would silently decide it everywhere.
CLIENT_PROJECT_SCOPE = {"claude": True, "codex": False}
_SETTINGS_LOCK = threading.RLock()


class SkillActivationError(RuntimeError):
    def __init__(self, code: str, *, status: int = 409) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def canonical_path(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(os.fspath(path))).replace("\\", "/")


def _codex_request(
    method: str,
    params: dict,
    *,
    runner: Callable | None = None,
    executable: str | None = None,
) -> dict:
    binary = executable or shutil.which("codex")
    if not binary:
        raise SkillActivationError("codex_app_server_unavailable", status=503)
    initialize = {
        "id": 0,
        "method": "initialize",
        "params": {"clientInfo": {"name": "valkama", "title": "Valkama", "version": "1"}},
    }
    initialized = {"method": "initialized", "params": {}}
    operation = {"id": 1, "method": method, "params": params}
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    if runner is None:
        return _codex_interactive_request(
            binary, initialize, initialized, operation, creationflags=creationflags
        )

    request = "".join(
        json.dumps(packet, ensure_ascii=False) + "\n"
        for packet in (initialize, initialized, operation)
    )
    try:
        completed = runner(
            [binary, "app-server", "--stdio"],
            input=request,
            text=True,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=APP_SERVER_TIMEOUT_SECONDS,
            check=False,
            creationflags=creationflags,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise SkillActivationError("codex_app_server_unavailable", status=503) from error
    output = str(getattr(completed, "stdout", "") or "")
    if len(output.encode("utf-8", errors="replace")) > MAX_APP_SERVER_OUTPUT:
        raise SkillActivationError("codex_app_server_response_too_large", status=503)
    response = None
    for line in output.splitlines():
        try:
            packet = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(packet, dict) and packet.get("id") == 1:
            response = packet
            break
    if not isinstance(response, dict):
        raise SkillActivationError("codex_app_server_invalid_response", status=503)
    if "error" in response:
        raise SkillActivationError("codex_skill_update_rejected", status=409)
    result = response.get("result")
    if not isinstance(result, dict):
        raise SkillActivationError("codex_app_server_invalid_response", status=503)
    return result


def _codex_interactive_request(
    binary: str,
    initialize: dict,
    initialized: dict,
    operation: dict,
    *,
    creationflags: int,
) -> dict:
    """Keep stdin open until app-server answers each side of its handshake."""

    try:
        process = subprocess.Popen(
            [binary, "app-server", "--stdio"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=creationflags,
        )
    except OSError as error:
        raise SkillActivationError("codex_app_server_unavailable", status=503) from error
    # Bound to locals rather than read through `process` inside the closures
    # below: a check on an attribute does not survive into a nested function.
    stdin, stdout = process.stdin, process.stdout
    if stdin is None or stdout is None:
        process.kill()
        raise SkillActivationError("codex_app_server_unavailable", status=503)

    lines: queue.Queue[str | None] = queue.Queue(maxsize=256)

    def read_stdout() -> None:
        try:
            for line in stdout:
                lines.put(line)
        finally:
            lines.put(None)

    reader = threading.Thread(target=read_stdout, name="codex-skill-reader", daemon=True)
    reader.start()
    deadline = time.monotonic() + APP_SERVER_TIMEOUT_SECONDS
    received_bytes = 0

    def send(packet: dict) -> None:
        try:
            stdin.write(json.dumps(packet, ensure_ascii=False) + "\n")
            stdin.flush()
        except (OSError, BrokenPipeError) as error:
            raise SkillActivationError("codex_app_server_unavailable", status=503) from error

    def receive(response_id: int) -> dict:
        nonlocal received_bytes
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise SkillActivationError("codex_app_server_timeout", status=503)
            try:
                line = lines.get(timeout=remaining)
            except queue.Empty as error:
                raise SkillActivationError("codex_app_server_timeout", status=503) from error
            if line is None:
                raise SkillActivationError("codex_app_server_invalid_response", status=503)
            received_bytes += len(line.encode("utf-8", errors="replace"))
            if received_bytes > MAX_APP_SERVER_OUTPUT:
                raise SkillActivationError("codex_app_server_response_too_large", status=503)
            try:
                packet = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(packet, dict) and packet.get("id") == response_id:
                return packet

    try:
        send(initialize)
        ready = receive(0)
        if "error" in ready or not isinstance(ready.get("result"), dict):
            raise SkillActivationError("codex_app_server_invalid_response", status=503)
        send(initialized)
        send(operation)
        response = receive(1)
        if "error" in response:
            raise SkillActivationError("codex_skill_update_rejected", status=409)
        result = response.get("result")
        if not isinstance(result, dict):
            raise SkillActivationError("codex_app_server_invalid_response", status=503)
        return result
    finally:
        with contextlib.suppress(OSError):
            stdin.close()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=1)


def list_codex_skills(
    cwds: list[Path],
    *,
    request: Callable[[str, dict], dict] = _codex_request,
) -> dict[str, bool]:
    result = request(
        "skills/list", {"cwds": [canonical_path(path) for path in cwds], "forceReload": True}
    )
    data = result.get("data")
    if not isinstance(data, list):
        raise SkillActivationError("codex_app_server_invalid_response", status=503)
    observed: dict[str, bool] = {}
    for group in data:
        if not isinstance(group, dict) or not isinstance(group.get("skills"), list):
            raise SkillActivationError("codex_app_server_invalid_response", status=503)
        for skill in group["skills"]:
            if (
                not isinstance(skill, dict)
                or not isinstance(skill.get("path"), str)
                or not isinstance(skill.get("enabled"), bool)
            ):
                raise SkillActivationError("codex_app_server_invalid_response", status=503)
            key = canonical_path(skill["path"])
            previous = observed.get(key)
            if previous is not None and previous != skill["enabled"]:
                raise SkillActivationError("codex_skill_state_conflict", status=503)
            observed[key] = skill["enabled"]
    return observed


def set_codex_skill(
    manifest: Path,
    enabled: bool,
    *,
    runner: Callable | None = None,
    executable: str | None = None,
    request: Callable[[str, dict], dict] | None = None,
) -> bool:
    invoke = request or (
        lambda method, params: _codex_request(method, params, runner=runner, executable=executable)
    )
    result = invoke(
        "skills/config/write",
        {
            "path": str(manifest),
            "name": None,
            "enabled": enabled,
        },
    )
    effective = result.get("effectiveEnabled")
    if not isinstance(effective, bool):
        raise SkillActivationError("codex_app_server_invalid_response", status=503)
    return effective


def _settings_path(
    *, scope: str, home: Path, project_root: Path | None, local: bool = False
) -> Path:
    if scope == "global":
        return home / ".claude" / "settings.json"
    if scope != "project" or project_root is None:
        raise SkillActivationError("skill_scope_invalid", status=422)
    return project_root / ".claude" / ("settings.local.json" if local else "settings.json")


def _read_settings(path: Path) -> tuple[dict, bytes]:
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return {}, b""
    except OSError as error:
        raise SkillActivationError("claude_settings_unavailable", status=503) from error
    if len(raw) > MAX_CLAUDE_SETTINGS_BYTES:
        raise SkillActivationError("claude_settings_too_large", status=409)
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise SkillActivationError("claude_settings_malformed", status=409) from error
    if not isinstance(value, dict):
        raise SkillActivationError("claude_settings_malformed", status=409)
    overrides = value.get("skillOverrides", {})
    if not isinstance(overrides, dict):
        raise SkillActivationError("claude_settings_malformed", status=409)
    for override in overrides.values():
        if override not in CLAUDE_OVERRIDE_VALUES:
            raise SkillActivationError("claude_skill_override_invalid", status=409)
    return value, raw


def _unavailable_state(error: SkillActivationError) -> dict:
    return {"enabled": None, "can_toggle": False, "status": "unavailable", "reason": error.code}


def claude_skill_state(
    name: str,
    *,
    home: Path,
    project_root: Path | None = None,
) -> dict:
    """This skill's state as `project_root` sees it, or as the user does.

    The chain is read lowest first and the last file wins, which is Claude's
    own precedence: user, then the shared project file, then the project-local
    one. Asking with a project root is how a global skill can be off in one
    project and on everywhere else — a fact the reading used to be unable to
    express, because it chose the files from where the skill lived rather than
    from who was asking.
    """

    paths = [_settings_path(scope="global", home=home, project_root=None)]
    if project_root is not None:
        paths.extend(
            (
                _settings_path(scope="project", home=home, project_root=project_root),
                _settings_path(scope="project", home=home, project_root=project_root, local=True),
            )
        )
    try:
        mode = "on"
        for path in paths:
            settings, _ = _read_settings(path)
            overrides = settings.get("skillOverrides", {})
            if name in overrides:
                mode = overrides[name]
    except SkillActivationError as error:
        return _unavailable_state(error)
    enabled = mode != "off"
    return {
        "enabled": enabled,
        "can_toggle": True,
        "status": "enabled" if enabled else "disabled",
        "reason": None,
    }


def _atomic_write_settings(path: Path, original: bytes, value: dict) -> None:
    encoded = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False
        ) as handle:
            temporary = Path(handle.name)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            current = path.read_bytes()
        except FileNotFoundError:
            current = b""
        if current != original:
            raise SkillActivationError("claude_settings_changed", status=409)
        os.replace(temporary, path)
        temporary = None
    except OSError as error:
        raise SkillActivationError("claude_settings_write_failed", status=503) from error
    finally:
        if temporary is not None:
            with contextlib.suppress(OSError):
                temporary.unlink()


def set_claude_skill(
    name: str,
    enabled: bool,
    *,
    home: Path,
    project_root: Path | None = None,
) -> bool:
    """Write the override where the asker owns it.

    A project's answer goes in its own `settings.local.json` — the file Claude
    ranks highest and the one that is not shared — and the user's goes in user
    settings. Which file follows from who asked, exactly as the reading does.
    """

    target = (
        _settings_path(scope="project", home=home, project_root=project_root, local=True)
        if project_root is not None
        else _settings_path(scope="global", home=home, project_root=None)
    )
    with _SETTINGS_LOCK:
        settings, original = _read_settings(target)
        overrides = dict(settings.get("skillOverrides", {}))
        overrides[name] = "on" if enabled else "off"
        settings["skillOverrides"] = overrides
        _atomic_write_settings(target, original, settings)
    return enabled


def _state(enabled: bool) -> dict:
    return {
        "enabled": enabled,
        "can_toggle": True,
        "status": "enabled" if enabled else "disabled",
        "reason": None,
    }


def _missing(reason: str) -> dict:
    return {"enabled": None, "can_toggle": False, "status": "unavailable", "reason": reason}


def _disabled(reason: str) -> dict:
    return {"enabled": False, "can_toggle": True, "status": "disabled", "reason": reason}


def _projection_path(
    manifest: Path,
    *,
    home: Path,
    project_root: Path | None,
) -> tuple[Path, Path]:
    boundary = project_root or home
    return boundary, boundary / ".claude" / "skills" / manifest.parent.name


def _contained(boundary: Path, candidate: Path) -> bool:
    try:
        boundary_path = os.path.normcase(str(boundary.resolve()))
        candidate_path = os.path.normcase(str(candidate.resolve()))
        return os.path.commonpath((boundary_path, candidate_path)) == boundary_path
    except (OSError, ValueError):
        return False


def claude_projection_status(
    manifest: Path,
    *,
    home: Path,
    project_root: Path | None,
) -> str:
    """Describe whether Claude's discovery path points at the canonical skill."""

    boundary, projection = _projection_path(manifest, home=home, project_root=project_root)
    if not _contained(boundary, projection.parent):
        return "conflict"
    try:
        if not projection.exists():
            return "conflict" if projection.is_symlink() else "missing"
        return "matched" if projection.resolve() == manifest.parent.resolve() else "conflict"
    except OSError:
        return "conflict"


def ensure_claude_projection(
    manifest: Path,
    *,
    home: Path,
    project_root: Path | None,
) -> None:
    """Create Claude's discovery link without replacing any existing entry."""

    boundary, projection = _projection_path(manifest, home=home, project_root=project_root)
    status = claude_projection_status(manifest, home=home, project_root=project_root)
    if status == "matched":
        return
    if status == "conflict":
        raise SkillActivationError("claude_skill_projection_conflict", status=409)
    try:
        projection.parent.mkdir(parents=True, exist_ok=True)
        if not _contained(boundary, projection.parent):
            raise SkillActivationError("claude_skill_projection_unsafe", status=409)
        os.symlink(manifest.parent, projection, target_is_directory=True)
    except SkillActivationError:
        raise
    except FileExistsError as error:
        raise SkillActivationError("claude_skill_projection_conflict", status=409) from error
    except OSError as error:
        raise SkillActivationError("claude_skill_projection_create_failed", status=503) from error


def activation_states(skills: list[dict], specs: list[dict], home: Path) -> dict[str, dict]:
    specs_by_id = {spec["id"]: spec for spec in specs}
    project_roots = [spec["boundary"] for spec in specs if spec["scope"] == "project"]
    try:
        codex = list_codex_skills([home, *project_roots])
        codex_error = None
    except SkillActivationError as error:
        codex = {}
        codex_error = error.code

    result: dict[str, dict] = {}
    for skill in skills:
        spec = specs_by_id.get(skill["root_id"])
        if not spec:
            result[skill["key"]] = {
                "codex": _missing("root_unavailable"),
                "claude": _missing("root_unavailable"),
            }
            continue
        manifest = spec["root"] / skill["directory_name"] / "SKILL.md"
        valid = skill["availability"] == "available" and skill["validation"]["status"] == "valid"
        if not valid:
            result[skill["key"]] = {
                "codex": _missing("skill_invalid"),
                "claude": _missing("skill_invalid"),
            }
            continue
        codex_enabled = codex.get(canonical_path(manifest))
        codex_state = (
            _missing(codex_error or "codex_skill_not_discovered")
            if codex_enabled is None
            else _state(codex_enabled)
        )

        project_root = spec["boundary"] if skill["scope"] == "project" else None
        if skill["duplicate"]:
            claude_state = _missing("claude_skill_name_collision")
        else:
            projection = claude_projection_status(manifest, home=home, project_root=project_root)
            if projection == "missing":
                claude_state = _disabled("claude_skill_projection_missing")
            elif projection == "conflict":
                claude_state = _missing("claude_skill_projection_conflict")
            else:
                claude_state = claude_skill_state(
                    skill["name"], home=home, project_root=project_root
                )
        result[skill["key"]] = {"codex": codex_state, "claude": claude_state}
    return result
