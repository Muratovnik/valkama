"""OPS-001/002: what is configured, and where each answer came from.

The public configuration was once a scatter of environment variables, and a
registry override moved the Kernel's view of the projects registry but nothing
else's, so an owner who set it got a platform reading one file and a Skills or
Memory module reading another. Configuration nobody can see the whole of is configuration that
disagrees with itself in one place at a time.

So there is one file, one precedence, and one answer that says which layer it
came from. Environment beats file beats the caller's own default, because the
environment is what automation and a development shell reach for and neither
should have to edit a file to override one run.

A value in the file may be a reference rather than a literal, which is OPS-002.
The syntax is the one the neighbouring tool already uses — `${VAR}` and
`${VAR:-default}`, verified in Claude Code's MCP reference rather than invented
here — including its behaviour for a reference that cannot be resolved: the raw
text is kept and the failure is reported, instead of the value silently
becoming empty. A blank where a token should be is the failure mode that costs
an hour; a stated unresolved reference costs a glance.

The OS keychain named in OPS-002 is deliberately not built. The task says
keychain *or* explicit environment references, nothing here holds a secret yet,
and a credential reader with nothing to read is a mechanism whose first real
use would be its first test. `SECRET_SCHEMES` is where the second scheme goes.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Mapping

#: Where the owner's configuration lives. Beside the runtime state rather than
#: beside the store, because one of the things it configures is where the store
#: is: a file found through the store could not answer that.
CONFIG_DIRECTORY = ".valkama"
CONFIG_FILE = "config.json"

#: A file nobody has to be able to hand-audit is a file that can grow secrets.
MAX_CONFIG_BYTES = 64 * 1024

#: The reference forms a value may take. `${VAR}` and `${VAR:-default}` are
#: Claude Code's, and matching them means one syntax across the two files an
#: owner edits rather than two that look alike.
#:
#: Anywhere in the value, not only as the whole of it. That is what the
#: neighbouring file does — `${API_BASE_URL:-https://api.example.com}/mcp` is
#: its own documented example — and a narrower rule wearing the same syntax
#: would be worse than a different one: it reads as familiar and silently
#: leaves `${USERPROFILE}/.claude` as a literal path.
_REFERENCE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")

#: Schemes a reference may resolve through. One today; the OS keychain is the
#: second, and it goes here rather than into a branch somewhere else.
SECRET_SCHEMES = ("environment",)


class ConfigurationError(RuntimeError):
    """The configuration file exists and cannot be read as one."""


#: What an owner may set, and the variable that overrides each one.
#:
#: A setting is listed here only if an owner would reasonably set it for good.
#: `VALKAMA_CUTOVER` and `VALKAMA_PROTECTED_STORE` are absent on purpose: they
#: are one-shot switches for a single dangerous operation, and a durable file
#: is exactly where a permission like that must not be able to live.
SETTINGS: tuple[dict[str, str], ...] = (
    {
        "key": "store",
        "environment": "VALKAMA_DB",
        "description": "the SQLite file this installation reads and writes",
    },
    {
        "key": "document_roots",
        "environment": "VALKAMA_DOC_ROOTS",
        "description": f"document roots to search, separated by {os.pathsep!r}",
    },
    # The two the first sweep missed, because they are read through a variable
    # name held in a parameter rather than written at the call. Their absence
    # is what the doctor reports as unconfigured telemetry, and until now the
    # only place they were named was that warning's own fix text.
    {
        "key": "claude_session_root",
        "environment": "VALKAMA_CLAUDE_SESSION_ROOT",
        "description": "where Claude Code keeps its session journals",
    },
    {
        "key": "codex_rollout_root",
        "environment": "VALKAMA_CODEX_ROLLOUT_ROOT",
        "description": "where Codex keeps its rollout journals",
    },
)

SETTING_KEYS = tuple(item["key"] for item in SETTINGS)


def config_path() -> str:
    return os.path.join(os.path.expanduser("~"), CONFIG_DIRECTORY, CONFIG_FILE)


def read_file(path: str | None = None) -> dict[str, str]:
    """The configuration file, or an empty one. A malformed file is refused.

    Refused rather than ignored: a file with a typo in it reads as no file at
    all, and the owner then watches the product use a default they thought they
    had replaced.
    """

    target = path or config_path()
    try:
        # Closed explicitly. A handle left open on Windows is a file nothing
        # can move or delete, and this one sits in the owner's home directory.
        with open(target, "rb") as handle:
            raw = handle.read(MAX_CONFIG_BYTES + 1)
    except FileNotFoundError:
        return {}
    except OSError as error:
        raise ConfigurationError(f"configuration file cannot be read: {target}") from error
    if len(raw) > MAX_CONFIG_BYTES:
        raise ConfigurationError(f"configuration file exceeds {MAX_CONFIG_BYTES} bytes: {target}")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ConfigurationError(f"configuration file is not valid JSON: {target}") from error
    if not isinstance(value, dict):
        raise ConfigurationError(f"configuration file is not an object: {target}")
    unknown = sorted(str(name) for name in value if str(name) not in SETTING_KEYS)
    if unknown:
        raise ConfigurationError(f"configuration file names unknown settings: {', '.join(unknown)}")
    for name, item in value.items():
        if not isinstance(item, str):
            raise ConfigurationError(f"configuration value for {name} is not text")
    return {str(name): str(item) for name, item in value.items()}


def resolve_reference(value: str, environ: Mapping[str, str] | None = None) -> dict:
    """One value, resolved if it is a reference and returned as itself if not.

    A literal comes back unchanged, which is what makes the reference syntax
    additive: an owner who writes a plain path never meets it.
    """

    source = os.environ if environ is None else environ
    if _REFERENCE.search(value) is None:
        return {"value": value, "reference": "", "resolved": True, "reason": ""}

    missing: list[str] = []

    def substitute(match: re.Match[str]) -> str:
        name, fallback = match.group(1), match.group(2)
        if name in source:
            return source[name]
        if fallback is not None:
            return fallback
        # The raw text is kept rather than blanked, and the failure is named
        # below. A value that quietly becomes empty is indistinguishable from
        # one nobody set — and a path with a hole in it is worse than both.
        missing.append(name)
        return match.group(0)

    expanded = _REFERENCE.sub(substitute, value)
    if missing:
        names = ", ".join(sorted(set(missing)))
        return {
            "value": expanded,
            "reference": value,
            "resolved": False,
            "reason": f"{names} is not set and the reference has no default",
        }
    return {"value": expanded, "reference": value, "resolved": True, "reason": ""}


def configured(
    key: str,
    *,
    environ: Mapping[str, str] | None = None,
    path: str | None = None,
) -> str | None:
    """The configured value for one setting, or nothing if none is set.

    Nothing, rather than a default: the caller owns its own default, and moving
    those here would put the store's path in a module the store imports.
    """

    return _resolution(key, environ=environ, file=read_file(path))["value"] or None


def _setting(key: str) -> dict[str, str]:
    for item in SETTINGS:
        if item["key"] == key:
            return item
    raise KeyError(key)


def _resolution(key: str, *, environ: Mapping[str, str] | None, file: Mapping[str, str]) -> dict:
    setting = _setting(key)
    source = os.environ if environ is None else environ
    variable = setting["environment"]
    if source.get(variable):
        return {
            "key": key,
            "value": source[variable],
            "source": "environment",
            "reference": "",
            "resolved": True,
            "reason": "",
        }
    if key in file:
        answer = resolve_reference(file[key], environ=source)
        return {"key": key, "source": "file", **answer}
    return {
        "key": key,
        "value": "",
        "source": "default",
        "reference": "",
        "resolved": True,
        "reason": "",
    }


def report(
    effective: Mapping[str, str],
    *,
    environ: Mapping[str, str] | None = None,
    path: str | None = None,
) -> dict:
    """Every setting, its layer, and the value the product actually uses.

    `effective` is supplied by the caller because each default belongs to the
    module that owns the setting, and a copy of those defaults here would be a
    second answer to "where is the store" — which is the exact failure this
    module exists to end.
    """

    file = read_file(path)
    settings = []
    for item in SETTINGS:
        resolution = _resolution(item["key"], environ=environ, file=file)
        settings.append(
            {
                **resolution,
                "environment": item["environment"],
                "description": item["description"],
                "effective": str(effective.get(item["key"], "")),
            }
        )
    return {
        "interface_version": "valkama-configuration",
        "path": path or config_path(),
        "present": bool(file),
        "schemes": list(SECRET_SCHEMES),
        "settings": settings,
    }


def render(reading: dict) -> str:
    """The report as a person reads it: the layer, then the value it produced."""

    lines = [f"configuration: {reading['path']}" + ("" if reading["present"] else " (absent)")]
    # Measured rather than guessed: a column pinned at a number stays right
    # until the first setting whose name is one character longer.
    width = max((len(item["key"]) for item in reading["settings"]), default=0) + 1
    for item in reading["settings"]:
        mark = "" if item["resolved"] else "  UNRESOLVED"
        lines.append(f"{item['key']:<{width}} {item['source']:<12} {item['effective']}{mark}")
        if item["reference"]:
            lines.append(f"{'':<{width}} reference    {item['reference']}")
        if not item["resolved"]:
            lines.append(f"{'':<{width}} reason       {item['reason']}")
        lines.append(f"{'':<{width}} override     {item['environment']}")
    return "\n".join(lines)


__all__ = [
    "CONFIG_FILE",
    "MAX_CONFIG_BYTES",
    "SECRET_SCHEMES",
    "SETTINGS",
    "SETTING_KEYS",
    "ConfigurationError",
    "config_path",
    "configured",
    "read_file",
    "render",
    "report",
    "resolve_reference",
]
