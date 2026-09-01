"""OPS-003: what an installation needs, and the exact command that supplies it.

The one decision worth stating is that this never edits `~/.claude.json` or
`~/.codex/config.toml`. Both clients own their registration through their own
CLI — `claude mcp add` with `claude mcp get` to read it back, `codex mcp add`
with `codex mcp list --json` — and those commands know their file's format,
scopes and precedence in a way a parser here would only approximate until the
next release changed one of them. So this reads through them and writes through
them, or it does nothing at all.

Nothing is written without `--apply`. §19.3 asks for a configuration diff and
for a tool never to be trusted without confirmation, and both come down to the
same rule: the default run is a reading, and the command that would change
something is printed for a person to look at first.

The check that earns this its place is neither of the obvious two. A client
with no Valkama registered is easy to notice; a client registered against a
source checkout is not. The stable service-owned launcher is the only supported
client command. Its manifest is verified separately, so moving the repository
requires one launcher reinstall and never another edit in every client.
"""

from __future__ import annotations

import json
import os
import shutil
import sys

from .. import launcher, processes

#: The source entry point the managed launcher binds to. Client registrations
#: name only the stable launcher command.
ENTRY_POINT = "valkama.py"

SERVER_NAME = "valkama"

# These values are part of the client registration contract. UTF-8 must be
# explicit because stdio is the MCP wire, and each client needs a distinct
# author for Planning history to remain attributable.
CLIENT_ENVIRONMENTS = {
    "claude": (
        ("VALKAMA_AUTHOR", "claude"),
        ("PYTHONUTF8", "1"),
        ("PYTHONIOENCODING", "utf-8"),
    ),
    "codex": (
        ("VALKAMA_AUTHOR", "codex"),
        ("PYTHONUTF8", "1"),
        ("PYTHONIOENCODING", "utf-8"),
    ),
}

#: How long a client's own listing may take. Both read local configuration;
#: `claude mcp get` also probes the server, which is why this is not tight.
LIST_TIMEOUT_SECONDS = 45

STATUSES = ("ok", "warn", "fail", "unknown")


def entry_point_path() -> str:
    """This checkout's `valkama.py`, absolute, for launcher installation."""

    here = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(here, ENTRY_POINT)


def _finding(
    identifier: str,
    title: str,
    status: str,
    detail: str,
    *,
    commands: list[list[str]] | None = None,
) -> dict:
    if status not in STATUSES:
        raise ValueError(f"unknown setup status {status!r}")
    actions = [list(command) for command in commands or []]
    return {
        "id": identifier,
        "title": title,
        "status": status,
        "detail": detail,
        # Keep the former singular field for readers of setup JSON when there
        # really is one command. Replacing a registration takes remove + add,
        # so `commands` is the authoritative sequence and `command` stays empty
        # rather than pretending either half is sufficient.
        "command": actions[0] if len(actions) == 1 else [],
        "commands": actions,
    }


def _tool(name: str) -> str:
    return shutil.which(name) or ""


def _prerequisites() -> list[dict]:
    findings = [
        _finding(
            "python",
            "Python",
            "ok",
            f"{sys.version.split()[0]} at {sys.executable}",
        )
    ]
    git = _tool("git")
    findings.append(
        _finding(
            "git",
            "Git",
            "ok" if git else "warn",
            git or "not on PATH; the execution module reads a checkout's baseline through it",
        )
    )
    entry = entry_point_path()
    findings.append(
        _finding(
            "entry-point",
            "Entry point",
            "ok" if os.path.isfile(entry) else "fail",
            entry if os.path.isfile(entry) else f"missing: {entry}",
        )
    )
    return findings


def _launcher_finding() -> tuple[dict, dict[str, object]]:
    """Verify the managed launcher and its binding to this checkout."""

    entry = entry_point_path()
    install = [sys.executable, entry, "launcher", "install"]
    try:
        state = launcher.status()
    except launcher.LauncherError as error:
        return (
            _finding("launcher", "Stable launcher", "fail", str(error)),
            {"state": "unavailable", "detail": str(error)},
        )

    command = str(state.get("command") or "")
    current = str(state.get("source_script") or "")
    if state.get("state") == "missing":
        return (
            _finding(
                "launcher",
                "Stable launcher",
                "warn",
                f"not installed at {command}",
                commands=[install],
            ),
            state,
        )
    if state.get("state") == "installed" and current and _same_path(current, entry):
        return (
            _finding(
                "launcher",
                "Stable launcher",
                "ok",
                f"verified at {command}; source is {entry}",
            ),
            state,
        )
    if state.get("state") == "installed":
        return (
            _finding(
                "launcher",
                "Stable launcher",
                "fail",
                f"{command} runs {current or 'an unknown source'} rather than {entry}",
                commands=[install],
            ),
            state,
        )
    if state.get("state") == "drifted":
        return (
            _finding(
                "launcher",
                "Stable launcher",
                "fail",
                f"drifted at {command}: {state.get('detail') or 'managed files disagree'}",
                commands=[[*install, "--force"]],
            ),
            state,
        )
    return (
        _finding(
            "launcher",
            "Stable launcher",
            "fail",
            f"{state.get('state', 'unknown')} at {command}: "
            f"{state.get('detail') or 'launcher is not managed by Valkama'}",
        ),
        state,
    )


def _codex_registration(text: str) -> dict[str, object] | None:
    """Codex's structured registration for the server called Valkama.

    Parsed rather than searched. The first version looked for this checkout's
    path inside the raw output and reported a correct registration as wrong,
    because JSON escapes each backslash and normalising the separator turned
    `C:\\Users` into `C://Users`.
    """

    try:
        servers = json.loads(text)
    except (TypeError, ValueError):
        return None
    if not isinstance(servers, list):
        return None
    for server in servers:
        if not isinstance(server, dict) or server.get("name") != SERVER_NAME:
            continue
        transport = server.get("transport")
        if not isinstance(transport, dict) or transport.get("type") != "stdio":
            continue
        environment = transport.get("env")
        return {
            "command": str(transport.get("command") or ""),
            "args": [str(item) for item in transport.get("args", []) if isinstance(item, str)],
            "env": {
                str(key): str(value)
                for key, value in (environment.items() if isinstance(environment, dict) else [])
                if isinstance(key, str) and isinstance(value, str)
            },
        }
    return None


def _claude_registration(text: str) -> dict[str, object] | None:
    """Claude's plain-text registration, including scope and environment."""

    registration: dict[str, object] = {"command": "", "args": [], "env": {}, "scope": ""}
    environment: dict[str, str] = {}
    in_environment = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("Scope:"):
            scope = stripped[len("Scope:") :].strip().split(maxsplit=1)
            registration["scope"] = scope[0].casefold() if scope else ""
            in_environment = False
        elif stripped.startswith("Command:"):
            registration["command"] = stripped[len("Command:") :].strip()
            in_environment = False
        if stripped.startswith("Args:"):
            registration["args"] = stripped[len("Args:") :].split()
            in_environment = False
        elif stripped == "Environment:":
            in_environment = True
        elif in_environment and line.startswith("    ") and "=" in stripped:
            key, value = stripped.split("=", 1)
            environment[key] = value
        elif stripped and not line.startswith("    "):
            in_environment = False
    registration["env"] = environment
    return registration if registration["command"] else None


def _add_command(client: str, command: str) -> list[str]:
    environment = CLIENT_ENVIRONMENTS[client]
    env_options = [part for key, value in environment for part in ("--env", f"{key}={value}")]
    if client == "claude":
        return [
            "claude",
            "mcp",
            "add",
            SERVER_NAME,
            "--scope",
            "user",
            *env_options,
            "--",
            command,
            "mcp",
        ]
    return ["codex", "mcp", "add", *env_options, SERVER_NAME, "--", command, "mcp"]


def _remove_command(client: str) -> list[str]:
    # Claude's scope-less remove deliberately removes whichever effective scope
    # `mcp get` just reported. Adding the replacement at user scope afterwards
    # cannot leave a checkout-local registration shadowing it.
    return [client, "mcp", "remove", SERVER_NAME]


def _registration_problems(
    client: str,
    registration: dict[str, object],
    expected_command: str,
) -> list[str]:
    problems = []
    actual_command = str(registration.get("command") or "")
    if not actual_command or not _same_path(actual_command, expected_command):
        problems.append(f"command is {actual_command or 'missing'} rather than {expected_command}")
    if registration.get("args") != ["mcp"]:
        problems.append(f"args are {registration.get('args')!r} rather than ['mcp']")
    environment = registration.get("env")
    actual_environment = environment if isinstance(environment, dict) else {}
    for key, value in CLIENT_ENVIRONMENTS[client]:
        if actual_environment.get(key) != value:
            problems.append(f"{key} is not {value!r}")
    if client == "claude" and registration.get("scope") != "user":
        problems.append("scope is not user")
    return problems


def _registration(
    client: str,
    title: str,
    listing: list[str],
    expected_command: str,
    parse,
    *,
    runner=None,
) -> dict:
    """One client's Valkama registration, judged against the stable launcher.

    Three answers rather than two. Absent is a registration to make; present
    and naming the verified launcher is done; a direct checkout path is the one
    that matters — the product has shipped that failure before, and it does not
    announce itself.
    """

    if not expected_command:
        return _finding(client, title, "unknown", "stable launcher path is unavailable")
    run = runner or processes.run_text
    if not _tool(client):
        return _finding(client, title, "unknown", f"{client} is not on PATH")
    result = run([_tool(client), *listing])
    if result.returncode != 0:
        words = f"{result.stdout or ''}\n{result.stderr or ''}".casefold()
        if "no mcp server" in words or "not found" in words:
            return _finding(
                client,
                title,
                "warn",
                f"{client} has no Valkama server registered",
                commands=[_add_command(client, expected_command)],
            )
        return _finding(
            client,
            title,
            "warn",
            f"{client} could not report its servers: {(result.stderr or '').strip()[:200]}",
        )
    registration = parse(result.stdout or "")
    if registration is None:
        return _finding(
            client,
            title,
            "warn",
            f"{client} has no Valkama server registered",
            commands=[_add_command(client, expected_command)],
        )
    problems = _registration_problems(client, registration, expected_command)
    if not problems:
        return _finding(
            client,
            title,
            "ok",
            f"{client} runs {expected_command} mcp with the required environment",
        )
    return _finding(
        client,
        title,
        "fail",
        f"{client} registration is stale: {'; '.join(problems)}",
        commands=[_remove_command(client), _add_command(client, expected_command)],
    )


def _same_path(left: str, right: str) -> bool:
    """Whether two spellings name one file.

    `normcase` is what settles it on Windows, where a drive letter's case and
    the separator both vary without the path differing.
    """

    return os.path.normcase(os.path.abspath(left)) == os.path.normcase(os.path.abspath(right))


def inspect(*, runner=None) -> dict:
    """What this installation has, and what each missing piece would take."""

    entry = entry_point_path()
    launcher_finding, launcher_state = _launcher_finding()
    launcher_command = str(launcher_state.get("command") or "")
    findings = [
        *_prerequisites(),
        launcher_finding,
        _registration(
            "claude",
            "Claude Code registration",
            ["mcp", "get", "valkama"],
            launcher_command,
            _claude_registration,
            runner=runner,
        ),
        _registration(
            "codex",
            "Codex registration",
            ["mcp", "list", "--json"],
            launcher_command,
            _codex_registration,
            runner=runner,
        ),
    ]
    counts = {
        status: sum(1 for item in findings if item["status"] == status) for status in STATUSES
    }
    return {
        "interface_version": "valkama-setup",
        "entry_point": entry,
        "python": sys.executable,
        "findings": findings,
        "summary": counts,
        "status": "fail"
        if counts["fail"]
        else "warn"
        if counts["warn"]
        else "unknown"
        if counts["unknown"]
        else "ok",
        # What `--apply` would run, gathered so a reader sees the whole change
        # rather than assembling it from the findings.
        "commands": [command for item in findings for command in item["commands"]],
    }


def apply(reading: dict, *, runner=None) -> dict:
    """Run the proposed commands, through each client's own CLI.

    Only what the reading proposed, and only what a person has already seen: a
    fresh inspection here would let the set of changes differ from the set that
    was shown.
    """

    run = runner or processes.run_text
    results = []
    for command in reading.get("commands", []):
        if str(command[0]) in CLIENT_ENVIRONMENTS:
            verification, _state = _launcher_finding()
            if verification["status"] != "ok":
                results.append(
                    {
                        "command": command,
                        "returncode": 126,
                        "detail": "not run: stable launcher verification failed: "
                        f"{verification['detail']}",
                    }
                )
                continue
        located = _tool(str(command[0]))
        if not located:
            results.append({"command": command, "returncode": 127, "detail": "not on PATH"})
            continue
        outcome = run([located, *[str(part) for part in command[1:]]])
        results.append(
            {
                "command": command,
                "returncode": outcome.returncode,
                "detail": (outcome.stdout or outcome.stderr or "").strip()[:400],
            }
        )
    verification, _state = _launcher_finding()
    return {
        "applied": results,
        "changed": sum(1 for item in results if item["returncode"] == 0),
        "launcher_verification": verification,
    }


def render(reading: dict, applied: dict | None = None) -> str:
    lines = [f"valkama setup: {reading['status']}"]
    for item in reading["findings"]:
        lines.append(f"  [{item['status']:<7}] {item['title']}: {item['detail']}")
        for command in item["commands"]:
            lines.append(f"            would run: {_quoted(command)}")
    if applied is None:
        if reading["commands"]:
            lines.append("")
            lines.append("Nothing was changed. Re-run with --apply to run the commands above.")
        return "\n".join(lines)
    lines.append("")
    for item in applied["applied"]:
        mark = "ok" if item["returncode"] == 0 else f"exit {item['returncode']}"
        lines.append(f"  [{mark}] {_quoted(item['command'])}")
        if item["detail"]:
            lines.append(f"            {item['detail']}")
    verification = applied.get("launcher_verification")
    if verification:
        lines.append(
            f"  [{verification['status']}] launcher verification: {verification['detail']}"
        )
    return "\n".join(lines)


def _quoted(command: list[str]) -> str:
    return " ".join(json.dumps(part) if " " in str(part) else str(part) for part in command)


__all__ = [
    "CLIENT_ENVIRONMENTS",
    "ENTRY_POINT",
    "LIST_TIMEOUT_SECONDS",
    "SERVER_NAME",
    "STATUSES",
    "apply",
    "entry_point_path",
    "inspect",
    "render",
]
