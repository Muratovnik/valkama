"""Run behaviour probes: real agent clients in a throwaway profile, on a store copy.

    python tests/agent_probes.py run --cases DIR --sections FILE --claude-md FILE
        --claude-coordinator DIR --codex-agents FILE --client claude|codex|both
        --client-home DIR --out DIR [--store-copy [SOURCE]] [--only ID ...]
    python tests/agent_probes.py judge --out DIR

A development tool like `tests/isolated.py`, and not part of the product. A probe
asks whether an agent, given the user's instructions with some sections
replaced, this checkout's hooks, skill and MCP server, does what a scenario
expects. The scenarios and the text they test belong to whoever runs them;
nothing here knows their rules.

What a run builds in `--client-home`, every time, after clearing everything but
the clients' logins (`.claude/.credentials.json`, `.codex/auth.json`):

- the environment of `isolated_environment(<home>)`, with `VALKAMA_DB` on the
  store copy the probe server serves, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` in the
  home, `GIT_CONFIG_GLOBAL` on a file of the profile, and the launcher directory
  first in `PATH`;
- a Valkama configuration, `.valkama/config.json`, whose `transcript_roots` are
  the profile's two client directories, given to the probe server too: a store
  copy's rows name the user's clients' transcripts, and no server of the run
  reads one. A session whose servers archived one anyway is the environment's
  failure, its sessions named in `foreign_transcripts`;
- copies of the user's `CLAUDE.md`, Codex `AGENTS.md` and coordinator files,
  with the sections of `--sections` put in place of those with the same heading;
- hook registrations for both clients. The user's own run an installed release,
  and a release built for another store schema spools every event it is given
  instead of writing it, so each Valkama hook is pointed at this checkout's
  `valkama.py`; a hook that prints a coordinator file prints the profile's copy;
  every other hook of the user's is left out, so nothing reaches a service the
  user runs. The commit hooks and the `MessageDisplay` hook are added;
- the MCP registration of this checkout, a launcher `valkama.cmd` that runs it,
  this checkout's skill, copies of the user's other skills and plugins, and a
  Git configuration with the commit hooks. Codex on Windows reads the user's
  `.agents/skills` whatever the profile's home is, so it gets the profile's in
  its `$CODEX_HOME/skills` and has each of the user's turned off by path;
- per scenario: the sample workspace with its overlay and repositories, its
  projects in the profile's registry, and a store copy migrated by this
  checkout, served by `tests/isolated.py serve --store-copy`. The workspace is
  a boundary: Git stops at it, Codex takes it for its project's root, and
  Claude Code passes over the instruction files of every directory above it,
  which it would read as a project's: those of the repository the output
  directory lies in, and the user's own `~/.claude/CLAUDE.md` when the output
  is under the user's home.

A run holds the home's lock, `<client-home>.lock` beside it, from clearing the
home to its last session: a second run on the same home waits for the first
and says whose run it waits for, rather than clearing the home under it.

The user's files, hook registrations and store are only read, and the store
only through a connection that cannot write. The run holds itself to that:
`LiveFiles` digests the user's instruction files, client settings, hook
registrations, Git configuration, project registry and installed skill when the
run starts, once the profile is built and after each session, `run.json` keeps
the first and last digests, and a change is an isolation failure, a session's
own when it happened during one. The clients run without the variables a client
session hands its children (`CALLER_SESSION`), so a run started in an agent's
shell does not run them as that agent's children. Each session's record goes to
`--out/<scenario>/<client>/`: the client's output of every turn, the handshake,
the setup's bindings, a copy of the store, its spool and the profile's project
registry after the session, and the failures of the environment, which say why
a session could not be judged rather than that it failed. `judge` reads them
back against each scenario's `expect`: `tests/agent_probes_judge.py`.
"""

from __future__ import annotations

import argparse
import contextlib
import dataclasses
import hashlib
import json
import os
import re
import shlex
import shutil
import sqlite3
import stat
import subprocess
import sys
import threading
import time
import tomllib
import uuid
from collections.abc import Callable, Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import processes, store
from server.projects import project_registry
from server.transcripts import ARCHIVED

TYPE_CHECKING = False
if TYPE_CHECKING:
    from types import ModuleType

ENTRY = ROOT / "valkama.py"
CLIENTS = ("claude", "codex")

#: The keys of a scenario. `about`, `overlay`, `repos`, `registry` and `mcp` say
#: how the profile is set up for it; the rest is the contract of a scenario.
SCENARIO_KEYS = (
    "id",
    "about",
    "clients",
    "workspace",
    "overlay",
    "repos",
    "registry",
    "mcp",
    "setup",
    "turns",
    "expect",
    "rubric",
)
REQUIRED_KEYS = ("id", "clients", "workspace", "turns", "expect")
REGISTRY_KEYS = ("space", "projects", "default")
RUBRIC_KEYS = ("shows", "lines")
#: What a reviewer's file may show: an item by a bound name, the answer, the reports.
RUBRIC_SHOWS = re.compile(r"answer|subagent_reports|item:\{\{[^{}]+\}\}")
CALL_KEYS = ("tool", "author", "session", "as", "args")
TURN_KEYS = ("before", "prompt")
#: The sessions a setup call may run as: the runner's own, and a foreign one
#: that stays alive for the whole session.
SETUP_SESSIONS = ("setup", "other")
#: `tip` registers this checkout's MCP server; `failing`, a command that fails.
MCP_MODES = ("tip", "failing")

#: Every kind of check a scenario may name. A kind outside this list is refused
#: when the scenario is read, because a check nobody judges would pass by silence.
CHECK_KINDS = frozenset(
    {
        "item",
        "items",
        "requests",
        "comments",
        "spaces",
        "writes",
        "session",
        "first_call",
        "call",
        "no_call",
        "order",
        "answer",
        "skill_loaded",
        "subagents",
        "subagent_reports",
        "hook_output",
        "file",
        "git",
        "grep",
        "new_files",
        "command",
        "handshake",
        "dir_empty",
        "registry",
        "any",
    }
)

#: What survives the clearing of the home between runs: the clients' logins.
KEPT_LOGINS = (Path(".claude") / ".credentials.json", Path(".codex") / "auth.json")
#: The variables a client session gives every process it starts: its session, effort,
#: entry point, plugin directories, subagent depth and MCP timeouts. A run started in
#: an agent's shell would hand them on, and its clients would run as children of that
#: session rather than as fresh sessions of their own.
CALLER_SESSION = re.compile(r"CLAUDE|CODEX_|MCP_TIMEOUT$|MCP_CONNECTION_NONBLOCKING$", re.I)
#: Directories of the home the run builds in, under the names the clients read.
CLAUDE_DIR = ".claude"
CODEX_DIR = ".codex"
#: Where the run keeps what it builds outside the clients' own directories.
WORK_DIR = ".probes"
#: Where a session's record keeps the profile's project registry as the session left it.
REGISTRY_COPY = "registry"

#: The hooks the commit pickup needs beyond what the user registered: event,
#: matcher and the `valkama hook` event, per client.
COMMIT_HOOKS = {
    "claude": (
        ("PostToolUse", "Bash|PowerShell", "post-tool-use"),
        ("PostToolUseFailure", "Bash|PowerShell", "post-tool-use-failure"),
    ),
    "codex": (("PostToolUse", "Bash", "post-tool-use"),),
}
#: The Git hooks of the commit pickup, by name and event. The guard keeps a
#: commit that no client session made from starting Python at all.
GIT_HOOKS = (
    ("valkama-commit", "post-commit"),
    ("valkama-rewrite", "post-rewrite"),
    ("valkama-merge", "post-merge"),
)
GIT_HOOK_GUARD = (
    '[ -n "${CLAUDE_CODE_SESSION_ID:-}${CODEX_SESSION_ID:-}${CODEX_THREAD_ID:-}" ] || exit 0'
)
MESSAGE_DISPLAY_PATH = "/api/hooks/message-display"
#: A protocol revision of the `initialize` handshake the server still answers.
HANDSHAKE_PROTOCOL = "2025-06-18"

#: How long one turn of a client may take, one MCP answer, and any other command.
TURN_SECONDS = 1800.0
ANSWER_SECONDS = 60.0
COMMAND_SECONDS = 300.0
_NO_WINDOW = processes.NO_WINDOW


class ProbeError(RuntimeError):
    """Something the run was given is wrong; nothing ran because of it."""


def _say(line: str) -> None:
    sys.stdout.write(f"{line}\n")
    sys.stdout.flush()


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n"
    )


def _isolated() -> ModuleType:
    """`tests/isolated.py`, imported only when a run needs it.

    Importing the `tests` package points `VALKAMA_DB` at a suite file. The fake
    client loads this module without it, and `run` asks where the user's store
    is before anything imports it.
    """

    from tests import isolated

    return isolated


# --- scenarios ---------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class Scenario:
    """One scenario file, checked against the format and with its paths resolved."""

    path: Path
    id: str
    clients: tuple[str, ...]
    workspace: Path
    overlay: Path | None
    repos: tuple[str, ...]
    registry: Mapping[str, Any] | None
    mcp: str
    setup: tuple[Mapping[str, Any], ...]
    turns: tuple[Mapping[str, Any], ...]
    expect: Mapping[str, list]
    rubric: Mapping[str, Mapping[str, Any]] = dataclasses.field(default_factory=dict)

    @property
    def name(self) -> str:
        return self.path.stem


def _refuse(path: Path, message: str) -> ProbeError:
    return ProbeError(f"{path}: {message}")


def _check_keys(path: Path, where: str, value: object, allowed: Sequence[str]) -> Mapping:
    if not isinstance(value, Mapping):
        raise _refuse(path, f"{where} is not an object")
    unknown = sorted(set(value) - set(allowed))
    if unknown:
        raise _refuse(path, f"{where} has unknown key(s) {', '.join(unknown)}")
    return value


def _check_calls(path: Path, where: str, calls: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(calls, list):
        raise _refuse(path, f"{where} is not a list")
    for index, call in enumerate(calls):
        found = _check_keys(path, f"{where}[{index}]", call, CALL_KEYS)
        if not isinstance(found.get("tool"), str):
            raise _refuse(path, f"{where}[{index}] names no tool")
        if found.get("session", "setup") not in SETUP_SESSIONS:
            raise _refuse(path, f"{where}[{index}] runs as an unknown session {found['session']!r}")
    return tuple(calls)


def check_kinds(checks: object, path: Path, where: str) -> None:
    """Refuse a check list holding a kind outside `CHECK_KINDS`, `any` included."""

    if not isinstance(checks, list):
        raise _refuse(path, f"{where} is not a list of checks")
    for index, check in enumerate(checks):
        kind = check.get("check") if isinstance(check, Mapping) else None
        if kind not in CHECK_KINDS:
            raise _refuse(path, f"{where}[{index}] is an unknown kind of check {kind!r}")
        if kind == "any":
            check_kinds(check.get("of"), path, f"{where}[{index}].of")


def load_scenario(path: Path) -> Scenario:
    """Read one scenario, refusing a key, a session or a kind of check it does not know."""

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise _refuse(path, f"cannot be read: {error}") from error
    data = _check_keys(path, "the scenario", raw, SCENARIO_KEYS)
    missing = [key for key in REQUIRED_KEYS if key not in data]
    if missing:
        raise _refuse(path, f"lacks {', '.join(missing)}")
    clients = tuple(data["clients"])
    if not clients or set(clients) - set(CLIENTS):
        raise _refuse(path, f"clients must be some of {', '.join(CLIENTS)}")
    registry = data.get("registry")
    if registry is not None:
        _check_keys(path, "registry", registry, REGISTRY_KEYS)
    mcp = data.get("mcp", "tip")
    if mcp not in MCP_MODES:
        raise _refuse(path, f"mcp is {mcp!r}, not one of {', '.join(MCP_MODES)}")
    turns = data["turns"]
    if not isinstance(turns, list) or not turns:
        raise _refuse(path, "turns is not a list of at least one turn")
    for index, turn in enumerate(turns):
        found = _check_keys(path, f"turns[{index}]", turn, TURN_KEYS)
        if not isinstance(found.get("prompt"), str):
            raise _refuse(path, f"turns[{index}] has no prompt")
        _check_calls(path, f"turns[{index}].before", found.get("before", []))
    expect = data["expect"]
    if not isinstance(expect, Mapping):
        raise _refuse(path, "expect is not an object of probes")
    for probe, checks in expect.items():
        check_kinds(checks, path, f"expect.{probe}")
    rubric = _check_keys(path, "rubric", data.get("rubric") or {}, list(expect))
    for probe, entry in rubric.items():
        found = _check_keys(path, f"rubric.{probe}", entry, RUBRIC_KEYS)
        for shown in found.get("shows") or ():
            if not isinstance(shown, str) or not RUBRIC_SHOWS.fullmatch(shown):
                raise _refuse(path, f"rubric.{probe} shows an unknown part {shown!r}")
    overlay = data.get("overlay")
    return Scenario(
        path=path,
        id=str(data["id"]),
        clients=clients,
        workspace=(path.parent / data["workspace"]).resolve(),
        overlay=None if overlay is None else (path.parent / overlay).resolve(),
        repos=tuple(data.get("repos") or ()),
        registry=registry,
        mcp=mcp,
        setup=_check_calls(path, "setup", data.get("setup", [])),
        turns=tuple(turns),
        expect=expect,
        rubric=rubric,
    )


def load_cases(directory: Path, only: Sequence[str] | None) -> list[Scenario]:
    """Every scenario in `directory`, or those `only` names by scenario or by probe."""

    scenarios = [load_scenario(path) for path in sorted(directory.glob("*.json"))]
    if not scenarios:
        raise ProbeError(f"{directory} holds no scenario")
    if only:
        wanted = set(only)
        scenarios = [item for item in scenarios if item.id in wanted or wanted & set(item.expect)]
        if not scenarios:
            raise ProbeError(f"no scenario in {directory} is or holds {', '.join(only)}")
    return scenarios


# --- sections ----------------------------------------------------------------


def _chunks(text: str) -> list[tuple[str | None, str]]:
    """`text` cut before each `## ` heading outside a code fence, each with its heading."""

    chunks: list[tuple[str | None, str]] = [(None, "")]
    fenced = False
    for line in text.splitlines(keepends=True):
        if line.startswith("```"):
            fenced = not fenced
        if not fenced and line.startswith("## "):
            chunks.append((line[3:].strip(), ""))
        heading, body = chunks[-1]
        chunks[-1] = (heading, body + line)
    return chunks


def read_sections(path: Path) -> dict[str, str]:
    """The `## ` sections of a file by heading; front matter and preamble are not sections."""

    text = path.read_text(encoding="utf-8")
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end < 0:
            raise ProbeError(f"{path}: front matter does not end")
        text = text[end + len("\n---\n") :]
    sections = {heading: body for heading, body in _chunks(text) if heading is not None}
    if not sections:
        raise ProbeError(f"{path} holds no `## ` section")
    return sections


def replace_sections(text: str, sections: Mapping[str, str]) -> tuple[str, set[str]]:
    """`text` with each section `sections` has a heading for replaced; and those headings."""

    used: set[str] = set()
    parts = []
    for heading, body in _chunks(text):
        if heading is not None and heading in sections:
            used.add(heading)
            trailing = body[len(body.rstrip("\n")) :] or "\n"
            body = sections[heading].rstrip("\n") + trailing
        parts.append(body)
    return "".join(parts), used


def _first_heading(text: str) -> str | None:
    for line in text.splitlines():
        if line.startswith("#"):
            return line.lstrip("#").strip()
    return None


# --- hook registrations --------------------------------------------------------


def _words(hook: Mapping[str, Any]) -> list[str]:
    """The program and arguments of a command hook, from either form a client writes."""

    if "args" in hook:
        return [str(hook.get("command", "")), *(str(word) for word in hook.get("args") or ())]
    command = str(hook.get("commandWindows") or hook.get("command") or "")
    return [word.strip("\"'") for word in command.split()]


def valkama_hook(hook: Mapping[str, Any]) -> tuple[str, str] | None:
    """The client and event of a hook that runs `valkama hook <client> <event>`, else None."""

    if hook.get("type", "command") != "command":
        return None
    words = _words(hook)
    if len(words) >= 3 and words[-3] == "hook" and words[-2] in CLIENTS:
        return words[-2], words[-1]
    return None


def hook_groups(registration: Mapping[str, Any]) -> Iterator[tuple[str, Mapping, Mapping]]:
    """Every (event, group, hook) of a registration's `hooks`."""

    for event, groups in (registration.get("hooks") or {}).items():
        for group in groups or ():
            for hook in group.get("hooks") or ():
                yield event, group, hook


def hook_command(client: str, event: str, python: str) -> dict[str, Any]:
    """This checkout's `valkama hook` command, in the form each client registers."""

    words = [python, str(ENTRY), "hook", client, event]
    if client == "claude":
        return {"type": "command", "command": python, "args": words[1:]}
    line = subprocess.list2cmdline(words) if sys.platform == "win32" else shlex.join(words)
    return {"type": "command", "command": line, "commandWindows": line}


def _remapped(hook: Mapping[str, Any], live: Path, copy: Path) -> dict[str, Any] | None:
    """`hook` reading the profile's coordinator copy, or None when it reads no coordinator file."""

    def mapped(word: str) -> str:
        try:
            relative = Path(word).resolve().relative_to(live.resolve())
        except (ValueError, OSError):
            return word
        return str(copy / relative)

    if "args" in hook:
        args = [mapped(str(word)) for word in hook.get("args") or ()]
        return {**hook, "args": args} if args != list(hook.get("args") or ()) else None
    changed = dict(hook)
    for key in ("command", "commandWindows"):
        value = hook.get(key)
        if isinstance(value, str):
            for variant in {str(live), live.as_posix()}:
                value = value.replace(variant, str(copy))
            changed[key] = value
    return changed if changed != dict(hook) else None


#: Valkama hooks a probe session runs without. `watch` waits for news while a session
#: idles and wakes it, registered with `asyncRewake` on `UserPromptSubmit`; Claude
#: Code 2.1.328 under `-p` waits for it before the turn starts, so the first turn of a
#: probe stood until the turn's limit. A `-p` session ends after its turn and has no
#: idle to wake, so no probe needs it; the record counts it among the dropped hooks.
HEADLESS_LEFT_OUT = frozenset({"watch"})


@dataclasses.dataclass
class HookPlan:
    """A client's registration as the profile writes it, and what was left out of it."""

    hooks: dict[str, list[dict[str, Any]]]
    dropped: dict[str, int]


def profile_hooks(
    client: str,
    live: Mapping[str, Any],
    *,
    python: str,
    coordinator: tuple[Path, Path] | None,
    port: int | None,
) -> HookPlan:
    """The hooks of `live` for the profile: Valkama's on this checkout, the rest left out.

    A hook printing a file of the coordinator directory stays, reading the copy.
    The commit hooks are added for an event no Valkama hook covers yet, and the
    `MessageDisplay` hook of Claude Code posts to the probe server on `port`.
    """

    hooks: dict[str, list[dict[str, Any]]] = {}
    dropped: dict[str, int] = {}
    for event, group, hook in hook_groups(live):
        found = valkama_hook(hook)
        if found is not None and found[1] in HEADLESS_LEFT_OUT:
            dropped[event] = dropped.get(event, 0) + 1
            continue
        if found is not None:
            kept: dict[str, Any] | None = {
                **{key: value for key, value in hook.items() if key not in ("args",)},
                **hook_command(found[0], found[1], python),
            }
        elif coordinator is not None and hook.get("type", "command") == "command":
            kept = _remapped(hook, *coordinator)
        else:
            kept = None
        if kept is None:
            dropped[event] = dropped.get(event, 0) + 1
            continue
        groups = hooks.setdefault(event, [])
        entry = {key: value for key, value in group.items() if key != "hooks"}
        if groups and {k: v for k, v in groups[-1].items() if k != "hooks"} == entry:
            groups[-1]["hooks"].append(kept)
        else:
            groups.append({**entry, "hooks": [kept]})
    for event, matcher, name in COMMIT_HOOKS[client]:
        covered = any(
            valkama_hook(hook) for group in hooks.get(event, ()) for hook in group["hooks"]
        )
        if not covered:
            hooks.setdefault(event, []).append(
                {
                    "matcher": matcher,
                    "hooks": [{**hook_command(client, name, python), "timeout": 5}],
                }
            )
    if client == "claude" and port is not None:
        url = f"http://127.0.0.1:{port}{MESSAGE_DISPLAY_PATH}"
        hooks["MessageDisplay"] = [
            {"matcher": "*", "hooks": [{"type": "http", "url": url, "timeout": 2}]}
        ]
    return HookPlan(hooks=hooks, dropped=dropped)


def without_mcp_servers(config: str) -> str:
    """A Codex `config.toml` without its `[mcp_servers.*]` tables."""

    kept, skipping = [], False
    for line in config.splitlines(keepends=True):
        header = re.match(r"\s*\[\[?\s*([^\]]+?)\s*\]", line)
        if header:
            skipping = header.group(1).split(".")[0].strip("\"' ") == "mcp_servers"
        if not skipping:
            kept.append(line)
    return "".join(kept)


def _toml(value: str) -> str:
    # A JSON string is a TOML basic string: the same escapes, `\uXXXX` included.
    return json.dumps(value, ensure_ascii=False)


def codex_config(
    live: str, registration: Mapping[str, Any], hidden_skills: Sequence[Path] = ()
) -> str:
    """The user's Codex configuration with `registration` as its only MCP server.

    Each of `hidden_skills`, a `SKILL.md` of the user's that Codex would read
    whatever the profile's home, is turned off by its path. Codex reads the
    `AGENTS.md` files from its project's root down to its working directory, and
    takes for that root the nearest directory above with a `.git`: from a
    workspace in a run's output directory, the repository that directory lies in,
    whose instructions the probe would then follow. With no markers the root is
    the workspace itself.
    """

    lines = [
        "project_root_markers = []",
        without_mcp_servers(live).rstrip("\n"),
        "",
        "[mcp_servers.valkama]",
        f"command = {_toml(registration['command'])}",
        f"args = [{', '.join(_toml(word) for word in registration['args'])}]",
        "",
        "[mcp_servers.valkama.env]",
        *(f"{name} = {_toml(value)}" for name, value in sorted(registration["env"].items())),
        "",
    ]
    for path in hidden_skills:
        lines += ["[[skills.config]]", f"path = {_toml(str(path))}", "enabled = false", ""]
    text = "\n".join(lines)
    try:
        parsed = tomllib.loads(text)
    except tomllib.TOMLDecodeError as error:
        raise ProbeError(f"the Codex configuration does not take the profile's: {error}") from None
    servers = parsed.get("mcp_servers")
    if not isinstance(servers, dict) or set(servers) != {"valkama"}:
        raise ProbeError("the Codex configuration names MCP servers outside its tables")
    entries = parsed.get("skills", {}).get("config", [])
    off = {entry.get("path") for entry in entries if entry.get("enabled") is False}
    if not {str(path) for path in hidden_skills} <= off:
        raise ProbeError("the Codex configuration turns the user's skills back on")
    return text


#: The instruction files Claude Code reads in a directory above its working one.
ANCESTOR_INSTRUCTIONS = (
    "CLAUDE.md",
    "CLAUDE.local.md",
    "AGENTS.md",
    ".claude/CLAUDE.md",
    ".claude/AGENTS.md",
    ".claude/rules/**",
)


def ancestor_instructions(workspace: Path, own: Path) -> list[str]:
    """The instruction files above `workspace`, as Claude Code's `claudeMdExcludes` patterns.

    Claude Code reads the instruction files of every directory above its working
    one, and a run's workspaces lie in its output directory, inside whatever
    project holds that: a probe would follow that project's instructions as its
    own. The files under `own`, the profile's client directory, stay.
    """

    own = own.resolve()
    return [
        (directory / name).as_posix()
        for directory in workspace.resolve().parents
        for name in ANCESTOR_INSTRUCTIONS
        if own != directory / name and own not in (directory / name).parents
    ]


# --- the profile -------------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class Inputs:
    """What a run reads of the user's: instruction files and the clients' own directories."""

    sections: Path
    claude_md: Path
    codex_agents: Path
    coordinator: Path

    @property
    def claude_dir(self) -> Path:
        configured = os.environ.get("CLAUDE_CONFIG_DIR")
        return Path(configured) if configured else Path.home() / CLAUDE_DIR

    @property
    def codex_dir(self) -> Path:
        configured = os.environ.get("CODEX_HOME")
        return Path(configured) if configured else Path.home() / CODEX_DIR

    @property
    def agents_skills(self) -> Path:
        return Path.home() / ".agents" / "skills"


#: Windows' known folder of the user's profile, `FOLDERID_Profile`.
_FOLDERID_PROFILE = uuid.UUID("5E6C858F-0E22-4760-9AFE-EA3317B67173")


def codex_user_home() -> Path | None:
    """The home whose `.agents/skills` Codex reads here, when the profile cannot move it.

    Codex 0.166 reads its user's skills from `$CODEX_HOME/skills` and from
    `.agents/skills` under the home `dirs::home_dir` names
    (`codex-rs/ext/skills/src/host_roots.rs`). On Windows that is the shell's
    profile folder, `SHGetKnownFolderPath(FOLDERID_Profile)` in `dirs-sys`,
    whatever `HOME` and `USERPROFILE` say, so a probe's Codex read the user's own
    installed skill there. Elsewhere it is `HOME`, which the profile sets: None.
    """

    if sys.platform != "win32":
        return None
    import ctypes

    folder = ctypes.create_string_buffer(_FOLDERID_PROFILE.bytes_le, 16)
    found = ctypes.c_wchar_p()
    result = ctypes.WinDLL("shell32").SHGetKnownFolderPath(folder, 0, None, ctypes.byref(found))
    try:
        return Path(found.value) if result == 0 and found.value else None
    finally:
        ctypes.WinDLL("ole32").CoTaskMemFree(found)


def _codex_skills(home: Path, codex_dir: Path, user_home: Path | None) -> tuple[Path, ...]:
    """Codex's user skills, all from the profile; the user's `SKILL.md` files it must pass over.

    Codex reads the profile's `$CODEX_HOME/skills`, and `.agents/skills` under
    `user_home` when the profile cannot move that home. The profile's own
    `.agents/skills`, this checkout's skill and the copies of the user's others,
    goes into the first where it has no skill of that name, and every skill under
    the second is returned to be turned off by its path.
    """

    target = codex_dir / "skills"
    for child in sorted((home / ".agents" / "skills").iterdir()):
        if (target / child.name).exists():
            continue
        if child.is_dir():
            shutil.copytree(child, target / child.name, symlinks=True)
        else:
            shutil.copy2(child, target / child.name)
    if user_home is None:
        return ()
    users = user_home / ".agents" / "skills"
    if not users.is_dir() or users.resolve() == (home / ".agents" / "skills").resolve():
        return ()
    return tuple(sorted(users.rglob("SKILL.md")))


@dataclasses.dataclass
class Profile:
    """The client home a run built, and the environment its clients run in."""

    home: Path
    environment: dict[str, str]
    python: str
    claude_settings: dict[str, Any]
    claude_hooks: Mapping[str, Any]
    codex_hooks: Mapping[str, Any]
    codex_config: str
    coordinator: tuple[Path, Path]
    #: The user's skills Codex would read beside the profile's, turned off in its configuration.
    codex_hidden_skills: tuple[Path, ...] = ()
    #: The configuration of every Valkama server the run starts, by setting.
    server_config: dict[str, str] = dataclasses.field(default_factory=dict)

    @property
    def claude_dir(self) -> Path:
        return self.home / CLAUDE_DIR

    @property
    def codex_dir(self) -> Path:
        return self.home / CODEX_DIR

    @property
    def work(self) -> Path:
        return self.home / WORK_DIR

    @property
    def local(self) -> Path:
        return self.home / "AppData" / "Local"

    @property
    def registry(self) -> Path:
        return self.local / "Valkama"


def clear_home(home: Path) -> None:
    """Remove everything in `home` but the clients' logins."""

    home.mkdir(parents=True, exist_ok=True)
    kept = {home / path for path in KEPT_LOGINS}
    keep_dirs = {parent for path in kept for parent in path.parents}

    def clear(directory: Path) -> None:
        for child in directory.iterdir():
            if child in kept:
                continue
            if child in keep_dirs and child.is_dir() and not child.is_symlink():
                clear(child)
            elif child.is_dir() and not child.is_symlink() and not _is_junction(child):
                if not remove_tree(child):
                    raise ProbeError(f"could not clear {child}")
            else:
                child.unlink()

    clear(home)


def remove_tree(path: Path) -> bool:
    """Remove `path`, read-only files included; report whether it went.

    A copied plugin holds Git objects, which Git writes read-only, and Windows
    refuses to delete those until they are made writable.
    """

    def writable(function: Callable[[str], object], name: str, _: object) -> None:
        os.chmod(name, stat.S_IWRITE)
        function(name)

    with contextlib.suppress(OSError):
        shutil.rmtree(path, onerror=writable)
    # What is left is held by a process that just ended; that waits it out.
    return bool(_isolated().remove_tree(path))


def _is_junction(path: Path) -> bool:
    return bool(getattr(os.path, "isjunction", lambda _: False)(path))


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _copy_skills(source: Path, target: Path) -> None:
    """Every skill in `source` but Valkama's, which this checkout installs itself."""

    target.mkdir(parents=True, exist_ok=True)
    if not source.is_dir():
        return
    for child in source.iterdir():
        if child.name == "valkama":
            continue
        if child.is_dir():
            shutil.copytree(child, target / child.name, symlinks=True)
        else:
            shutil.copy2(child, target / child.name)


def _copy_plugins(source: Path, target: Path, live: Path, copy: Path) -> None:
    """A client's plugin directory, its records pointing at the copy rather than the user's."""

    if not source.is_dir():
        return
    shutil.copytree(source, target, symlinks=True)
    prefixes = {str(live): str(copy), live.as_posix(): copy.as_posix()}

    def moved(value: object) -> object:
        if isinstance(value, str):
            for old, new in prefixes.items():
                if value.startswith(old):
                    return new + value[len(old) :]
            return value
        if isinstance(value, list):
            return [moved(item) for item in value]
        if isinstance(value, dict):
            return {key: moved(item) for key, item in value.items()}
        return value

    for record in target.glob("*.json"):
        with contextlib.suppress(ValueError):
            data = json.loads(record.read_text(encoding="utf-8"))
            _write_json(record, moved(data))


def _run_command(
    argv: Sequence[str],
    environment: Mapping[str, str],
    *,
    cwd: Path = ROOT,
    stdin: bytes | None = None,
    timeout: float = COMMAND_SECONDS,
) -> tuple[int, str]:
    """Run one command to its end; its exit code and output, decoded for a reader only."""

    try:
        done = subprocess.run(
            list(argv),
            cwd=cwd,
            env=dict(environment),
            input=stdin,
            stdin=None if stdin is not None else subprocess.DEVNULL,
            capture_output=True,
            creationflags=_NO_WINDOW,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return 127, f"{argv[0]} did not run: {error}"
    # Shown to a person and recorded, never parsed for a decision.
    output = (done.stdout + done.stderr).decode("utf-8", errors="replace")
    return done.returncode, output


def _valkama(profile_env: Mapping[str, str], *arguments: str, cwd: Path = ROOT) -> str:
    code, output = _run_command([sys.executable, str(ENTRY), *arguments], profile_env, cwd=cwd)
    if code != 0:
        raise ProbeError(f"valkama {' '.join(arguments)} failed ({code}): {output.strip()[-800:]}")
    return output


def _write_launcher(directory: Path, python: str) -> None:
    """`valkama` on the profile's PATH, running this checkout."""

    directory.mkdir(parents=True, exist_ok=True)
    (directory / "valkama.cmd").write_text(
        f'@echo off\r\n"{python}" "{ENTRY}" %*\r\n', encoding="utf-8", newline=""
    )
    if sys.platform != "win32":
        script = directory / "valkama"
        script.write_text(
            f'#!/bin/sh\nexec {shlex.quote(python)} {shlex.quote(str(ENTRY))} "$@"\n',
            encoding="utf-8",
            newline="\n",
        )
        script.chmod(0o755)


def _write_git_config(path: Path, python: str, environment: Mapping[str, str]) -> None:
    settings = [
        ("user.name", "Valkama probes"),
        ("user.email", "probes@example.invalid"),
        ("init.defaultBranch", "main"),
    ]
    for name, event in GIT_HOOKS:
        command = (
            f"{GIT_HOOK_GUARD}; exec {shlex.quote(Path(python).as_posix())}"
            f" {shlex.quote(ENTRY.as_posix())} git-hook run {event}"
        )
        settings += [(f"hook.{name}.command", command), (f"hook.{name}.event", event)]
    for key, value in settings:
        code, output = _run_command(["git", "config", "--file", str(path), key, value], environment)
        if code != 0:
            raise ProbeError(f"could not write {key} into {path}: {output.strip()}")


def build_profile(home: Path, inputs: Inputs) -> Profile:
    """Clear `home` and build in it what every session of a run shares."""

    isolated = _isolated()
    clear_home(home)
    python = sys.executable
    claude_dir, codex_dir = home / CLAUDE_DIR, home / CODEX_DIR
    local = home / "AppData" / "Local"
    for directory in (claude_dir, codex_dir, local, home / "AppData" / "Roaming", home / WORK_DIR):
        directory.mkdir(parents=True, exist_ok=True)

    sections = read_sections(inputs.sections)
    used: set[str] = set()
    for source, target in (
        (inputs.claude_md, claude_dir / "CLAUDE.md"),
        (inputs.codex_agents, codex_dir / "AGENTS.md"),
    ):
        text, found = replace_sections(source.read_text(encoding="utf-8"), sections)
        target.write_text(text, encoding="utf-8", newline="\n")
        used |= found
    coordinator = claude_dir / "coordinator"
    shutil.copytree(inputs.coordinator, coordinator)
    for path in sorted(coordinator.glob("*.md")):
        heading = _first_heading(path.read_text(encoding="utf-8"))
        if heading in sections:
            path.write_text(sections[heading], encoding="utf-8", newline="\n")
            used.add(heading)
    unplaced = sorted(set(sections) - used)
    if unplaced:
        raise ProbeError(
            f"no instruction file has a section headed {', '.join(unplaced)}: nothing would test it"
        )

    environment = {
        name: value
        for name, value in isolated.isolated_environment(home).items()
        if not CALLER_SESSION.match(name)
    }
    environment.pop("VALKAMA_DB", None)
    launcher = local / "Valkama" / "bin"
    environment.update(
        {
            "CLAUDE_CONFIG_DIR": str(claude_dir),
            "CODEX_HOME": str(codex_dir),
            "GIT_CONFIG_GLOBAL": str(home / ".gitconfig"),
            "PATH": os.pathsep.join([str(launcher), environment.get("PATH", "")]),
        }
    )
    _write_launcher(launcher, python)
    _write_git_config(home / ".gitconfig", python, environment)
    server_config = {
        # A store copy's rows name the user's own clients' transcripts; every server
        # of the run, the probe server and each client's MCP server, reads only the
        # profile's.
        "transcript_roots": os.pathsep.join([str(claude_dir), str(codex_dir)]),
    }
    _write_json(home / ".valkama" / "config.json", server_config)

    live_claude, live_codex = inputs.claude_dir, inputs.codex_dir
    _copy_skills(live_claude / "skills", claude_dir / "skills")
    _copy_skills(inputs.agents_skills, home / ".agents" / "skills")
    _copy_skills(live_codex / "skills", codex_dir / "skills")
    _copy_plugins(live_claude / "plugins", claude_dir / "plugins", live_claude, claude_dir)
    _copy_plugins(live_codex / "plugins", codex_dir / "plugins", live_codex, codex_dir)
    _valkama(environment, "skill", "install", "--client", "claude", "--client", "codex")
    hidden_skills = _codex_skills(home, codex_dir, codex_user_home())

    settings = _read_json(live_claude / "settings.json")
    claude_hooks = {"hooks": settings.pop("hooks", None) or {}}
    settings.pop("statusLine", None)
    if isinstance(settings.get("env"), dict):
        settings["env"] = {
            name: value
            for name, value in settings["env"].items()
            if not name.upper().startswith("VALKAMA_")
        }
    codex_text = live_codex / "config.toml"
    return Profile(
        home=home,
        environment=environment,
        python=python,
        claude_settings=settings,
        claude_hooks=claude_hooks,
        codex_hooks=_read_json(live_codex / "hooks.json"),
        codex_config=codex_text.read_text(encoding="utf-8") if codex_text.is_file() else "",
        coordinator=(inputs.coordinator, coordinator),
        codex_hidden_skills=hidden_skills,
        server_config=server_config,
    )


def mcp_registration(
    profile: Profile, mode: str, store_file: Path, client: str, *, port: int
) -> dict[str, Any]:
    """The MCP server a session's clients start: this checkout's, or one that fails.

    `port` is the probe server's: the links an answer carries name it, and without
    it they would name the user's own listener.
    """

    if mode == "failing":
        return {"command": profile.python, "args": ["-c", "import sys; sys.exit(3)"], "env": {}}
    names = ("HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA")
    env = {name: profile.environment[name] for name in names if name in profile.environment}
    env.update(
        {
            name: value
            for name, value in profile.environment.items()
            if name.upper().startswith("VALKAMA_")
        }
    )
    env.update(
        {
            "VALKAMA_DB": str(store_file),
            "VALKAMA_AUTHOR": client,
            "VALKAMA_PORT": str(port),
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
        }
    )
    return {"command": profile.python, "args": [str(ENTRY), "mcp"], "env": env}


def write_client_configs(
    profile: Profile, *, port: int, mode: str, store_file: Path, workspace: Path
) -> dict[str, dict[str, int]]:
    """Each client's hooks and MCP registration for one session; what was left out, by client."""

    dropped = {}
    claude = profile_hooks(
        "claude",
        profile.claude_hooks,
        python=profile.python,
        coordinator=profile.coordinator,
        port=port,
    )
    excluded = list(profile.claude_settings.get("claudeMdExcludes") or [])
    excluded += ancestor_instructions(workspace, profile.claude_dir)
    _write_json(
        profile.claude_dir / "settings.json",
        {**profile.claude_settings, "claudeMdExcludes": excluded, "hooks": claude.hooks},
    )
    registration = mcp_registration(profile, mode, store_file, "claude", port=port)
    _write_json(
        profile.claude_dir / ".claude.json",
        {"mcpServers": {"valkama": {"type": "stdio", **registration}}},
    )
    codex = profile_hooks(
        "codex", profile.codex_hooks, python=profile.python, coordinator=None, port=None
    )
    _write_json(profile.codex_dir / "hooks.json", {"hooks": codex.hooks})
    config = codex_config(
        profile.codex_config,
        mcp_registration(profile, mode, store_file, "codex", port=port),
        profile.codex_hidden_skills,
    )
    (profile.codex_dir / "config.toml").write_text(config, encoding="utf-8", newline="\n")
    dropped["claude"], dropped["codex"] = claude.dropped, codex.dropped
    return dropped


# --- the store ------------------------------------------------------------------------


def prepare_store(
    source: Path | None, work: Path, registry: Path | None = None
) -> tuple[Path, dict[str, Any]]:
    """A store for the run in `work`: a fresh one, or `source` copied and migrated.

    `source` is read through a connection that cannot write. The migration runs
    on the copy with a copy of the user's project registry beside it, which is
    what gives the copy's work items their projects; the registry is only read.
    `registry` is the directory it was in when `main` asked, beside the store.
    """

    isolated = _isolated()
    base = work / "base.sqlite3"
    migration = work / "migration"
    migration.mkdir(parents=True, exist_ok=True)
    environment = {**isolated.isolated_environment(migration), "VALKAMA_DB": str(base)}
    if source is None:
        code, output = _run_command(
            [sys.executable, "-c", "from server import store; store.connect().close()"],
            environment,
        )
        if code != 0:
            raise ProbeError(f"could not create a store: {output.strip()[-800:]}")
        return base, {"source": None}
    isolated.copy_store(source, base)
    isolated.copy_registry(migration, registry)
    carried = migration / "AppData" / "Local" / "Valkama"
    arguments = ["migrate", "work-model"]
    if (carried / "projects.json").is_file():
        # A registry 2.9 left is of the formats before; one already carried says so.
        _valkama(environment, "projects", "upgrade")
        items = work / "item-projects.json"
        _valkama(environment, "projects", "map-items", "--output", str(items))
        arguments += ["--item-projects", str(items)]
    report = _valkama(environment, *arguments)
    status = re.search(r'"status": "(\w+)"', report)
    return base, {"source": str(source), "migration": status.group(1) if status else None}


# --- talking to an MCP server ---------------------------------------------------------


class McpError(RuntimeError):
    """The MCP server did not start, or did not answer."""


class McpClient:
    """One stdio MCP server, spoken to the way a client does: line-delimited JSON-RPC."""

    def __init__(
        self,
        command: str,
        args: Sequence[str],
        environment: Mapping[str, str],
        *,
        cwd: Path,
        log: Path | None = None,
    ) -> None:
        self._log = log.open("ab") if log is not None else None
        self._next = 0
        try:
            self.process = subprocess.Popen(
                [command, *args],
                cwd=cwd,
                env=dict(environment),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=self._log if self._log is not None else subprocess.DEVNULL,
                creationflags=_NO_WINDOW,
            )
        except OSError as error:
            self._close_log()
            raise McpError(f"{command} did not start: {error}") from error

    def _close_log(self) -> None:
        if self._log is not None:
            self._log.close()
            self._log = None

    def request(self, method: str, params: Mapping[str, Any]) -> dict[str, Any]:
        """Send one request and return its answer, or raise McpError."""

        self._next += 1
        message = {"jsonrpc": "2.0", "id": self._next, "method": method, "params": dict(params)}
        stdin, stdout = self.process.stdin, self.process.stdout
        assert stdin is not None and stdout is not None
        watchdog = threading.Timer(ANSWER_SECONDS, self.process.kill)
        watchdog.start()
        try:
            stdin.write(json.dumps(message).encode("utf-8") + b"\n")
            stdin.flush()
            while True:
                line = stdout.readline()
                if not line:
                    raise McpError(f"the server ended without answering {method}")
                answer = json.loads(line)
                if isinstance(answer, dict) and answer.get("id") == self._next:
                    return answer
        except (OSError, ValueError) as error:
            raise McpError(f"{method}: {error}") from error
        finally:
            watchdog.cancel()

    def initialize(self, name: str) -> dict[str, Any]:
        answer = self.request(
            "initialize",
            {
                "protocolVersion": HANDSHAKE_PROTOCOL,
                "capabilities": {},
                "clientInfo": {"name": name, "version": "1"},
            },
        )
        if "result" not in answer:
            raise McpError(f"initialize was refused: {answer.get('error')}")
        stdin = self.process.stdin
        assert stdin is not None
        stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        stdin.flush()
        return dict(answer["result"])

    def call(
        self, tool: str, arguments: Mapping[str, Any], meta: Mapping[str, Any]
    ) -> tuple[Any, bool]:
        """One tool call: its answer, parsed when it is JSON, and whether it is an error."""

        answer = self.request(
            "tools/call", {"name": tool, "arguments": dict(arguments), "_meta": dict(meta)}
        )
        result = answer.get("result") or {}
        if "structuredContent" in result:
            data = result["structuredContent"]
        else:
            text = "".join(
                part.get("text", "")
                for part in result.get("content") or ()
                if isinstance(part, dict)
            )
            try:
                data = json.loads(text)
            except ValueError:
                data = text or answer.get("error")
        return data, bool(result.get("isError")) or "error" in answer

    def close(self) -> None:
        with contextlib.suppress(OSError):
            if self.process.stdin is not None:
                self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        if self.process.stdout is not None:
            self.process.stdout.close()
        self._close_log()

    def __enter__(self) -> McpClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


# --- one session ------------------------------------------------------------------------


_PLACEHOLDER = re.compile(r"\{\{([^{}]+)\}\}")


def substitute(value: Any, names: Mapping[str, str]) -> Any:
    """`value` with every `{{name}}` in its strings replaced; an unknown name is refused."""

    if isinstance(value, str):

        def replace(found: re.Match[str]) -> str:
            key = found.group(1).strip()
            if key not in names:
                raise ProbeError(f"nothing is bound to {{{{{key}}}}}")
            return names[key]

        return _PLACEHOLDER.sub(replace, value)
    if isinstance(value, list):
        return [substitute(item, names) for item in value]
    if isinstance(value, dict):
        return {key: substitute(item, names) for key, item in value.items()}
    return value


def client_argv(
    client: str, program: Sequence[str], prompt: str, workspace: Path, session: str | None
) -> list[str]:
    """The command line of one turn; `session` continues the session of the first."""

    if client == "claude":
        argv = [
            *program,
            "-p",
            prompt,
            "--permission-mode",
            "auto",
            "--permission-prompts",
            "none",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-hook-events",
        ]
        return argv + (["--resume", session] if session else [])
    argv = [
        *program,
        "exec",
        "--json",
        "-C",
        str(workspace),
        "-s",
        "workspace-write",
        # The elevated sandbox keeps its setup in the Codex home, which every run
        # clears, and makes it again only with an administrator's consent: each run
        # asked for it, and a run nobody watched had no shell. The unelevated one
        # cannot start an app alias such as a Store PowerShell's `pwsh.exe`. MXC
        # needs no setup, starts both and still refuses a write outside the
        # workspace; what a probe judges does not depend on which one isolates.
        "-c",
        'windows.sandbox="mxc"',
        "--dangerously-bypass-hook-trust",
    ]
    return argv + (["resume", session, prompt] if session else [prompt])


#: Codex's words when its sandbox could not start a command at all, whatever the command.
_SANDBOX_REFUSED = "Failed to create unified exec process"


def sandbox_refusal(client: str, output: Path) -> str | None:
    """What the client's sandbox said when it refused to start a command, if it did.

    The agent then works without a shell, which no probe is about, so the
    session is the environment's failure rather than the agent's result.
    """

    if client != "codex":
        return None
    with contextlib.suppress(OSError):
        for line in output.read_bytes().splitlines():
            try:
                record = json.loads(line)
            except ValueError:
                continue
            item = record.get("item") if isinstance(record, dict) else None
            if not isinstance(item, dict) or item.get("type") != "command_execution":
                continue
            said = item.get("aggregated_output")
            if isinstance(said, str) and said.startswith(_SANDBOX_REFUSED):
                return said
    return None


def session_id(client: str, output: Path) -> str | None:
    """The session a turn's output names: Claude Code's `session_id`, Codex's thread."""

    with contextlib.suppress(OSError):
        for line in output.read_bytes().splitlines():
            try:
                record = json.loads(line)
            except ValueError:
                continue
            if not isinstance(record, dict):
                continue
            if client == "claude" and isinstance(record.get("session_id"), str):
                return record["session_id"]
            if client == "codex" and record.get("type") == "thread.started":
                found = record.get("thread_id")
                return found if isinstance(found, str) else None
    return None


@dataclasses.dataclass
class Session:
    """What one scenario on one client recorded, written to `session.json`."""

    scenario: str
    client: str
    directory: Path
    session_id: str | None = None
    roles: dict[str, str] = dataclasses.field(default_factory=dict)
    bindings: dict[str, str] = dataclasses.field(default_factory=dict)
    turns: list[dict[str, Any]] = dataclasses.field(default_factory=list)
    failures: list[dict[str, str]] = dataclasses.field(default_factory=list)
    port: int | None = None
    setup_last_event: int = 0
    environment: dict[str, str] = dataclasses.field(default_factory=dict)
    dropped_hooks: dict[str, dict[str, int]] = dataclasses.field(default_factory=dict)
    #: Sessions the run did not start whose transcript its servers archived.
    foreign_transcripts: list[str] = dataclasses.field(default_factory=list)

    def fail(self, stage: str, detail: str) -> None:
        self.failures.append({"stage": stage, "detail": detail})

    def write(self) -> None:
        record = dataclasses.asdict(self)
        record["directory"] = str(self.directory)
        _write_json(self.directory / "session.json", record)


#: The variables of the profile a record keeps, for a check that names one; the
#: rest of the environment may hold what a record should not.
RECORDED_VARIABLES = (
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "GIT_CONFIG_GLOBAL",
    "GIT_CEILING_DIRECTORIES",
    "VALKAMA_DB",
    "VALKAMA_PORT",
    "PATH",
)


def build_workspace(scenario: Scenario, target: Path, environment: Mapping[str, str]) -> None:
    """The scenario's workspace: the sample, its overlay, and its repositories committed once."""

    shutil.copytree(scenario.workspace, target)
    if scenario.overlay is not None:
        shutil.copytree(scenario.overlay, target, dirs_exist_ok=True)
    for repo in scenario.repos:
        directory = (target / repo).resolve()
        for argv in (
            ["git", "init", "-q"],
            ["git", "add", "-A"],
            ["git", "commit", "-q", "-m", "Sample workspace"],
        ):
            code, output = _run_command(argv, environment, cwd=directory)
            if code != 0:
                raise ProbeError(f"{' '.join(argv)} in {directory} failed: {output.strip()}")


def _reset_registry(profile: Profile) -> None:
    """The profile's project registry, emptied: each scenario names its own projects."""

    if profile.registry.is_dir():
        for child in profile.registry.iterdir():
            if child.is_file():
                child.unlink()


def _meta(session: str) -> dict[str, str]:
    # The form a Codex call carries its session in, which the server confirms.
    return {"sessionId": session, "threadId": session, "callId": str(uuid.uuid4())}


def _cancel_list_token(answer: object) -> str | None:
    """The token of a `cancel_list` refusal: what a cancel of open work is confirmed by."""

    refusal = answer.get("error") if isinstance(answer, Mapping) else None
    if not isinstance(refusal, Mapping) or refusal.get("code") != "cancel_list":
        return None
    token = refusal.get("list_token")
    return token if isinstance(token, str) else None


def _last_event(store_file: Path) -> int:
    uri = f"{store_file.resolve().as_uri()}?mode=ro"
    with contextlib.closing(sqlite3.connect(uri, uri=True)) as conn:
        found = conn.execute("SELECT COALESCE(MAX(id), 0) FROM execution_events").fetchone()
    return int(found[0])


def foreign_transcripts(store_file: Path, after: int, home: Path) -> list[str]:
    """The sessions whose transcript a run's servers archived from outside the run's home.

    Every session a run starts keeps its transcript in the profile's client
    directories. A `transcript_archived` row written after the store was copied
    that names any other file is a session of the user's, read by a server of the
    run: the copy's rows name the user's clients' files.
    """

    uri = f"{store_file.resolve().as_uri()}?mode=ro"
    own = os.path.normcase(os.path.abspath(home)) + os.sep
    with contextlib.closing(sqlite3.connect(uri, uri=True)) as conn:
        rows = conn.execute(
            "SELECT session_id, transcript_path FROM execution_events WHERE kind = ? AND id > ?",
            (ARCHIVED, after),
        ).fetchall()
    return sorted(
        {
            str(session)
            for session, path in rows
            if not os.path.normcase(os.path.abspath(path or "")).startswith(own)
        }
    )


class SessionRunner:
    """One scenario on one client, from its server's start to the copy of its store."""

    def __init__(
        self,
        profile: Profile,
        scenario: Scenario,
        client: str,
        program: Sequence[str],
        directory: Path,
        base_store: Path,
    ) -> None:
        self.profile, self.scenario, self.client = profile, scenario, client
        self.program = list(program)
        self.directory = directory
        self.base_store = base_store
        self.workspace = directory / "workspace"
        self.serve_out = profile.work / "serve"
        self.record = Session(scenario=scenario.id, client=client, directory=directory)
        self.names: dict[str, str] = {}
        self.environment: dict[str, str] = {}
        self.store_file = Path()
        self.port = 0
        self.copied_last_event = 0

    def run(self) -> Session:
        isolated = _isolated()
        if self.directory.exists() and not remove_tree(self.directory):
            raise ProbeError(f"could not clear {self.directory}")
        self.directory.mkdir(parents=True)
        try:
            build_workspace(self.scenario, self.workspace, self.profile.environment)
            _reset_registry(self.profile)
            if not self._serve():
                return self.record
            try:
                self._session()
            finally:
                self._check_transcripts()
                self._keep_store()
                isolated.stop(self.serve_out)
        except ProbeError as error:
            self.record.fail("setup", str(error))
        finally:
            self.record.write()
        return self.record

    def _serve(self) -> bool:
        isolated = _isolated()
        environment = {**os.environ, "LOCALAPPDATA": str(self.profile.local)}
        self.copied_last_event = _last_event(self.base_store)
        started = isolated.start(
            self.serve_out,
            self.base_store,
            environment=environment,
            config=self.profile.server_config,
        )
        if started != 0:
            self.record.fail("server", f"the probe server did not start; see {self.serve_out}")
            return False
        state = json.loads((self.serve_out / isolated.STATE).read_text(encoding="utf-8"))
        port = int(state["port"])
        self.store_file = isolated.store_path(self.serve_out / isolated.HOME)
        self.environment = {
            **self.profile.environment,
            "VALKAMA_DB": str(self.store_file),
            # Git in the workspace stops at it: above lies the repository the run's
            # output directory may be in, which is not the probe's to read or commit to.
            "GIT_CEILING_DIRECTORIES": str(self.directory),
            # What the clients and their commands open or call is the probe server.
            "VALKAMA_PORT": str(port),
        }
        self.port = self.record.port = port
        self.record.environment = {
            name: self.environment[name] for name in RECORDED_VARIABLES if name in self.environment
        }
        self.names.update(
            {
                "client": self.client,
                "port": str(port),
                "store_dir": str(self.directory),
                "workspace": str(self.workspace),
                "home": str(self.profile.home),
                **{f"env.{name}": value for name, value in self.environment.items()},
            }
        )
        self.record.dropped_hooks = write_client_configs(
            self.profile,
            port=port,
            mode=self.scenario.mcp,
            store_file=self.store_file,
            workspace=self.workspace,
        )
        return True

    def _session(self) -> None:
        self._setup()
        if self.record.failures:
            return
        self._handshake()
        self.record.setup_last_event = _last_event(self.store_file)
        for index, turn in enumerate(self.scenario.turns, start=1):
            if index > 1:
                if self.record.session_id is None:
                    self.record.fail(f"turn {index}", "the first turn named no session to resume")
                    return
                self._calls(turn.get("before") or ())
                if self.record.failures:
                    return
            if not self._turn(index, substitute(turn["prompt"], self.names)):
                return

    def _role(self, name: str) -> str:
        """The session id of a setup role, opened by a session start the first time."""

        if name not in self.record.roles:
            identifier = str(uuid.uuid4())
            payload = {
                "session_id": identifier,
                "hook_event_name": "SessionStart",
                "source": "startup",
                "cwd": str(self.workspace),
                "transcript_path": "",
            }
            code, output = _run_command(
                [self.profile.python, str(ENTRY), "hook", "codex", "session-start"],
                self.environment,
                cwd=self.workspace,
                stdin=json.dumps(payload).encode("utf-8"),
            )
            if code != 0:
                raise ProbeError(f"the session start of {name} failed: {output.strip()}")
            self.record.roles[name] = identifier
        return self.record.roles[name]

    def _mcp(self) -> McpClient:
        registration = mcp_registration(
            self.profile, "tip", self.store_file, "codex", port=self.port
        )
        client = McpClient(
            registration["command"],
            registration["args"],
            {**self.environment, **registration["env"]},
            cwd=self.workspace,
            log=self.directory / "setup-mcp.log",
        )
        try:
            client.initialize("probe-setup")
        except McpError:
            client.close()
            raise
        return client

    def _setup(self) -> None:
        registry = self.scenario.registry
        calls = list(self.scenario.setup)
        if registry is None and not calls:
            return
        with self._mcp() as client:
            if registry is not None:
                self._space(client, str(registry["space"]))
                self._projects(registry)
            self._run_calls(client, calls)

    def _space(self, client: McpClient, key: str) -> None:
        meta = _meta(self._role("setup"))
        found, error = client.call("list_planning_spaces", {}, meta)
        spaces = found.get("spaces", found) if isinstance(found, dict) else found
        if not error and isinstance(spaces, list):
            if any(isinstance(space, dict) and space.get("key") == key for space in spaces):
                return
        answer, error = client.call("create_planning_space", {"name": key, "key": key}, meta)
        if error:
            raise ProbeError(f"the space {key} could not be created: {answer}")

    def _projects(self, registry: Mapping[str, Any]) -> None:
        for name in registry.get("projects") or ():
            root = (self.workspace / name).resolve()
            _valkama(self.environment, "projects", "add", name, "--name", name, "--root", str(root))
            bind = ["projects", "bind", name, "--space", str(registry["space"])]
            if registry.get("default") == name:
                bind.append("--default")
            _valkama(self.environment, *bind)

    def _calls(self, calls: Sequence[Mapping[str, Any]]) -> None:
        if not calls:
            return
        try:
            with self._mcp() as client:
                self._run_calls(client, calls)
        except (McpError, ProbeError) as error:
            self.record.fail("between turns", str(error))

    def _run_calls(self, client: McpClient, calls: Sequence[Mapping[str, Any]]) -> None:
        for call in calls:
            arguments = substitute(call.get("args") or {}, self.names)
            if "author" in call:
                arguments["author"] = call["author"]
            meta = _meta(self._role(str(call.get("session", "setup"))))
            answer, error = client.call(str(call["tool"]), arguments, meta)
            token = _cancel_list_token(answer) if error else None
            if token is not None and isinstance(arguments.get("transition"), Mapping):
                # A cancel that ends open work under the item names that work and waits
                # for the same transition back with its token: the session the step
                # stands for meant the cancel, so it confirms the list.
                transition = {**arguments["transition"], "cancels": token}
                arguments = {**arguments, "transition": transition}
                answer, error = client.call(str(call["tool"]), arguments, meta)
            if error:
                raise ProbeError(f"{call['tool']} was refused: {answer}")
            name = call.get("as")
            if name is not None:
                reference = answer.get("reference") if isinstance(answer, dict) else None
                if not isinstance(reference, str):
                    raise ProbeError(f"{call['tool']} answered no reference to bind {name}")
                self.names[str(name)] = reference
                self.record.bindings[str(name)] = reference

    def _handshake(self) -> None:
        """What the registered MCP command says to `initialize`, asked before the session."""

        registration = mcp_registration(
            self.profile, self.scenario.mcp, self.store_file, self.client, port=self.port
        )
        result: dict[str, Any]
        try:
            with McpClient(
                registration["command"],
                registration["args"],
                {**self.environment, **registration["env"]},
                cwd=self.workspace,
            ) as client:
                result = {"answer": client.initialize(self.client)}
        except McpError as error:
            result = {"error": str(error)}
        _write_json(self.directory / "handshake.json", result)

    def _turn(self, index: int, prompt: str) -> bool:
        argv = client_argv(
            self.client, self.program, prompt, self.workspace, self.record.session_id
        )
        output = self.directory / f"turn-{index}.jsonl"
        errors = self.directory / f"turn-{index}.stderr.txt"
        turn: dict[str, Any] = {
            "index": index,
            "prompt": prompt,
            "output": output.name,
            "stderr": errors.name,
        }
        self.record.turns.append(turn)
        started = time.monotonic()
        with output.open("wb") as out, errors.open("wb") as err:
            try:
                process = subprocess.Popen(
                    argv,
                    cwd=self.workspace,
                    env=self.environment,
                    stdin=subprocess.DEVNULL,
                    stdout=out,
                    stderr=err,
                    creationflags=_NO_WINDOW,
                    start_new_session=sys.platform != "win32",
                )
            except OSError as error:
                self.record.fail(f"turn {index}", f"{argv[0]} did not start: {error}")
                return False
            try:
                code = process.wait(timeout=TURN_SECONDS)
            except subprocess.TimeoutExpired:
                processes.stop_process_tree(process)
                self.record.fail(f"turn {index}", f"no end after {TURN_SECONDS:.0f}s")
                return False
        turn.update(exit=code, seconds=round(time.monotonic() - started, 3))
        if code != 0:
            tail = errors.read_bytes()[-800:].decode("utf-8", errors="replace")
            self.record.fail(f"turn {index}", f"the client exited with {code}: {tail.strip()}")
            return False
        refused = sandbox_refusal(self.client, output)
        if refused is not None:
            self.record.fail(f"turn {index}", f"the sandbox started no command: {refused}")
            return False
        if self.record.session_id is None:
            self.record.session_id = session_id(self.client, output)
        return True

    def _check_transcripts(self) -> None:
        """The session is the environment's failure when a server read a user's transcript."""

        if not self.store_file.is_file():
            return
        try:
            found = foreign_transcripts(self.store_file, self.copied_last_event, self.profile.home)
        except sqlite3.Error as error:
            self.record.fail("isolation", f"the archived transcripts could not be read: {error}")
            return
        self.record.foreign_transcripts = found
        if found:
            self.record.fail(
                "isolation",
                f"the servers archived the transcripts of {len(found)} session(s)"
                " this run did not start",
            )

    def _keep_store(self) -> None:
        """The session's store, spool and project registry, kept beside its record.

        The registry is kept because the next scenario empties it, and a check
        reads the projects this session registered.
        """

        if not self.store_file.is_file():
            return
        try:
            _isolated().copy_store(self.store_file, self.directory / "store.sqlite3")
        except (OSError, sqlite3.Error) as error:
            self.record.fail("record", f"the store could not be copied: {error}")
        spool = self.store_file.parent / "spool"
        if spool.is_dir():
            shutil.copytree(spool, self.directory / "spool")
        kept = self.directory / REGISTRY_COPY
        kept.mkdir()
        for path in self.profile.registry.glob("*"):
            if path.is_file():
                shutil.copy2(path, kept / path.name)


# --- the user's files -------------------------------------------------------------------


def _sha256(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


class LiveFiles:
    """The user's files a run reads and must leave as they were, digested as the run goes.

    The instruction files, each client's settings and hook registration, the global
    Git configuration with its hooks, the project registry, the coordinator files and
    the installed Valkama skill. Their digests are taken when the run starts, again
    once the profile and the store are ready, and after each session, and a change is
    the isolation failure of the stage it happened in. `~/.claude.json` is not among
    them: the user's running Claude Code sessions rewrite it whatever a run does. Nor
    is the store, which the user's own service writes: the run reads it only through a
    connection that cannot write.
    """

    def __init__(self, files: Sequence[Path], trees: Sequence[Path]) -> None:
        self.files = tuple(dict.fromkeys(path.resolve() for path in files))
        self.trees = tuple(dict.fromkeys(path.resolve() for path in trees))
        self.before = self.digest()
        self.after = self.before
        #: Each stage that changed a file: its name and the files' paths.
        self.changes: list[dict[str, Any]] = []

    @classmethod
    def of(cls, inputs: Inputs, registry: Path | None, git_config: Path | None) -> LiveFiles:
        claude, codex = inputs.claude_dir, inputs.codex_dir
        files = [
            claude / "settings.json",
            inputs.claude_md,
            claude / "CLAUDE.md",
            codex / "config.toml",
            codex / "hooks.json",
            inputs.codex_agents,
            codex / "AGENTS.md",
        ]
        if git_config is not None:
            files.append(git_config)
        if registry is not None:
            files += [registry / "projects.json", registry / "project-registry.toml"]
        skills = [base / "valkama" for base in (claude / "skills", inputs.agents_skills)]
        return cls(files, [inputs.coordinator, *skills, codex / "skills" / "valkama"])

    def digest(self) -> dict[str, str | None]:
        """Each file by its path, with the SHA-256 of its bytes, or None where there is none."""

        paths = list(self.files)
        for tree in self.trees:
            if tree.is_dir():
                paths += sorted(path for path in tree.rglob("*") if path.is_file())
        return {str(path): _sha256(path) for path in dict.fromkeys(paths)}

    def check(self, stage: str) -> list[str]:
        """The files that changed since the last check, recorded as `stage`'s change."""

        now = self.digest()
        changed = sorted(
            path for path in {*self.after, *now} if self.after.get(path) != now.get(path)
        )
        self.after = now
        if changed:
            self.changes.append({"stage": stage, "changed": changed})
        return changed

    def record(self) -> dict[str, Any]:
        return {"before": self.before, "after": self.after, "changes": self.changes}


# --- the run ----------------------------------------------------------------------------


def _programs(chosen: Sequence[str], given: Sequence[str], path: str) -> dict[str, list[str]]:
    """The command that starts each client: the one named, or the one on the profile's PATH."""

    programs: dict[str, list[str]] = {}
    for item in given:
        client, _, program = item.partition("=")
        if client not in CLIENTS or not program:
            raise ProbeError(f"--client-program takes CLIENT=PATH, not {item!r}")
        # Resolved here: a turn runs in the scenario's workspace, not where the run started.
        program = str(Path(program).resolve()) if Path(program).exists() else program
        programs[client] = [sys.executable, program] if program.endswith(".py") else [program]
    for client in chosen:
        if client not in programs:
            found = shutil.which(client, path=path)
            if found is None:
                raise ProbeError(f"{client} is not on PATH")
            programs[client] = [found]
    return programs


def run(
    options: argparse.Namespace,
    source: Path | None,
    registry: Path | None = None,
    git_config: Path | None = None,
) -> int:
    """Every chosen scenario on every chosen client; 0 when no session met a failure.

    `registry` and `git_config` are the user's project registry directory and global
    Git file, found by `main` before the `tests` package moved where they are looked for.
    """

    chosen = list(CLIENTS) if options.client == "both" else [options.client]
    scenarios = load_cases(options.cases.resolve(), options.only)
    inputs = Inputs(
        sections=options.sections.resolve(),
        claude_md=options.claude_md.resolve(),
        codex_agents=options.codex_agents.resolve(),
        coordinator=options.claude_coordinator.resolve(),
    )
    home, out = options.client_home.resolve(), options.out.resolve()
    from tests import machine_lock

    with machine_lock.held(
        f"a probe run into {out}", path=home_lock(home), say=_say, name="probe-home lock"
    ):
        live = LiveFiles.of(inputs, registry, git_config)
        return _run_locked(options, chosen, scenarios, inputs, home, out, source, registry, live)


def home_lock(home: Path) -> Path:
    """The lock of one client home: beside it, since a run clears everything in it.

    A run clears the home before it builds the profile, so a second run beside the
    first would take the profile, the logins aside, from under the first's clients.
    It waits for the lock instead, saying whose run holds it, as the heavy test runs
    of `tests/machine_lock.py` do with the same primitive.
    """

    return home.with_name(f"{home.name}.lock")


def _run_locked(
    options: argparse.Namespace,
    chosen: Sequence[str],
    scenarios: Sequence[Scenario],
    inputs: Inputs,
    home: Path,
    out: Path,
    source: Path | None,
    registry: Path | None,
    live: LiveFiles,
) -> int:
    profile = build_profile(home, inputs)
    programs = _programs(chosen, options.client_program or (), profile.environment["PATH"])
    base, prepared = prepare_store(source, profile.work, registry)
    versions = {
        client: _run_command([*programs[client], "--version"], profile.environment)[1].strip()
        for client in chosen
    }
    head = _run_command(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], os.environ)
    sessions = []
    # A profile that changed the user's files runs no session on them.
    prepared_ok = not live.check("profile")
    for scenario in scenarios if prepared_ok else ():
        for client in (item for item in chosen if item in scenario.clients):
            _say(f"{scenario.id} {client}")
            record = SessionRunner(
                profile, scenario, client, programs[client], out / scenario.name / client, base
            ).run()
            changed = live.check(f"{scenario.id} {client}")
            if changed:
                record.fail("isolation", f"the user's files changed: {', '.join(changed)}")
                record.write()
            for failure in record.failures:
                _say(f"  environment failure at {failure['stage']}: {failure['detail']}")
            sessions.append(
                {
                    "scenario": scenario.id,
                    "client": client,
                    "record": str(record.directory.relative_to(out)),
                    "failures": len(record.failures),
                }
            )
    _write_json(
        out / "run.json",
        {
            "head": head[1].strip(),
            "cases": str(options.cases.resolve()),
            "sections": str(inputs.sections),
            "store": prepared,
            "versions": versions,
            "sessions": sessions,
            "live_files": live.record(),
        },
    )
    for change in live.changes:
        _say(f"isolation failure: {change['stage']} changed {', '.join(change['changed'])}")
    _say(f"the user's files: {len(live.after)} checked, {len(live.changes)} stage(s) changed them")
    failed = sum(1 for item in sessions if item["failures"])
    _say(f"{len(sessions)} session(s), {failed} with an environment failure; record in {out}")
    return 1 if failed or live.changes or not sessions else 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Behaviour probes of agent clients.")
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("run", help="run scenarios on clients in a throwaway profile")
    command.add_argument("--cases", type=Path, required=True, help="the scenario directory")
    command.add_argument("--sections", type=Path, required=True, help="the sections to test")
    command.add_argument("--claude-md", type=Path, required=True)
    command.add_argument("--claude-coordinator", type=Path, required=True)
    command.add_argument("--codex-agents", type=Path, required=True)
    command.add_argument("--client", choices=(*CLIENTS, "both"), required=True)
    command.add_argument("--client-home", type=Path, required=True, help="the clients' home")
    command.add_argument("--out", type=Path, required=True, help="where the records go")
    command.add_argument(
        "--store-copy",
        nargs="?",
        const="",
        metavar="SOURCE",
        help="probe on a migrated copy of SOURCE, by default the store this user runs on;"
        " without it, on a fresh store",
    )
    command.add_argument("--only", nargs="+", metavar="ID", help="scenarios or probes to run")
    command.add_argument(
        "--client-program",
        action="append",
        metavar="CLIENT=PATH",
        help="start CLIENT with PATH (a .py runs with this interpreter) instead of PATH's",
    )
    command = commands.add_parser("judge", help="judge the sessions a run recorded")
    command.add_argument("--out", type=Path, required=True, help="the directory of the run")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8")
    options = _parser().parse_args(argv)
    try:
        if options.command == "judge":
            from tests import agent_probes_judge

            return agent_probes_judge.judge(options.out.resolve())
        copy = options.store_copy
        # Asked before anything imports the `tests` package, which redirects the store
        # and moves `LOCALAPPDATA`, where the registry the copy migrates with is.
        source = None if copy is None else Path(copy or store.db_path())
        registry = Path(project_registry.registry_path()).parent
        git_config = Path(os.environ.get("GIT_CONFIG_GLOBAL") or Path.home() / ".gitconfig")
        return run(options, source, registry, git_config)
    except ProbeError as error:
        _say(f"refused: {error}")
        return 2


if __name__ == "__main__":
    # The judge imports this module by its name in the package; run as a script,
    # it is that module, rather than a second copy with classes of its own.
    sys.modules.setdefault("tests.agent_probes", sys.modules[__name__])
    sys.exit(main())
