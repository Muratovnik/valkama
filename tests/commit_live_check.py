"""The live check of the commit hook: real Claude Code and Codex sessions, no person.

Not a test of the suite. It builds a set in a directory of its own, runs each client
once with one small task, and reports what reached the set's store:

    python tests/commit_live_check.py prepare SET --python BASE_PYTHON
    python tests/commit_live_check.py claude SET
    python tests/commit_live_check.py codex SET [--session-hooks] [--kept]
    python tests/commit_live_check.py report SET

The set holds a space root W with a `.git` of its own and a registered repository R
nested in it, a fresh store of this checkout, a registry of format 4 naming R, and
a global Git file: a byte copy of the global file the caller's Git reads, with the
three hook entries of the release written into the copy. Every client runs with
`GIT_CONFIG_GLOBAL` naming that copy and `VALKAMA_DB` naming the set's store, and
without the caller's own client session variables. The hook commands differ from
the release's only in running this checkout and in naming the set's store and
registry. The caller's global Git file is only read: `prepare` records its SHA-256
and `report` compares it.

The client hooks are W's own: `W/.claude/settings.json` (`PostToolUse` and
`PostToolUseFailure` on `Bash` and `PowerShell`), and `W/.codex/hooks.json`
(`PostToolUse` on its shell tool); with `--session-hooks` Codex also gets the same
hook by `-c hooks=`, marked `session` in the inputs. Each runs through a small
wrapper in the set that keeps the hook's input and the records it found before
`valkama hook` takes them, so the report can compare `CODEX_TOOL_CALL_ID` with
`tool_use_id` and name the agents.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import store
from server.hooks import git_hook
from tests import CALLER_LOCAL_APP_DATA
from tests.registry_fixtures import project_entry, registry_bytes

PROJECT = "live-check"
#: What a client puts in its shell, and the caller's own session carries.
DROPPED_PREFIXES = ("CLAUDE_CODE_", "CLAUDECODE", "CODEX_")
CLAUDE_TOOLS = "Bash,PowerShell,Agent,Read"

WRAPPER = '''"""Keeps a client hook's input and the records it can see, then runs `valkama hook`."""
import io, json, os, shutil, sys, time
SET = {set!r}
CHECKOUT = {checkout!r}
os.environ["VALKAMA_DB"] = {store!r}
os.environ["LOCALAPPDATA"] = {local!r}
client, event = sys.argv[1], sys.argv[2]
raw = sys.stdin.buffer.read()
stamp = f"{{time.time_ns()}}-" + "-".join(sys.argv[1:])
os.makedirs(os.path.join(SET, "inputs"), exist_ok=True)
with open(os.path.join(SET, "inputs", stamp + ".json"), "wb") as handle:
    handle.write(raw)
seen = os.path.join(SET, "seen", stamp)
for folder in {folders!r}:
    if os.path.isdir(folder):
        for name in os.listdir(folder):
            if name.endswith(".json"):
                os.makedirs(seen, exist_ok=True)
                shutil.copyfile(os.path.join(folder, name), os.path.join(seen, name))
sys.path.insert(0, CHECKOUT)
from server.hooks import entry
answer = io.BytesIO()
status = entry.main([client, event], io.BytesIO(raw), answer)
with open(os.path.join(SET, "inputs", stamp + ".answer"), "wb") as handle:
    handle.write(answer.getvalue())
sys.stdout.buffer.write(answer.getvalue())
sys.exit(status)
'''


def _slashed(path: Path | str) -> str:
    return str(path).replace("\\", "/")


def _git(cwd: Path, *arguments: str, environ: dict[str, str] | None = None) -> str:
    done = subprocess.run(
        ["git", *arguments], cwd=cwd, env=environ, capture_output=True, check=True
    )
    return done.stdout.decode("utf-8", "replace").strip()


def _sha256(path: str) -> str:
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def _clean_environment() -> dict[str, str]:
    """The caller's environment for a client or Git, as the caller started this process.

    Importing the `tests` package moved `LOCALAPPDATA` into the suite's directory, which
    goes when this process ends; a client keeps the caller's. Its hooks are given the
    set's own registry explicitly.
    """

    environment = {
        name: value
        for name, value in os.environ.items()
        if not name.upper().startswith(DROPPED_PREFIXES) and name.upper() != "GIT_CONFIG_GLOBAL"
    }
    if CALLER_LOCAL_APP_DATA is not None:
        environment["LOCALAPPDATA"] = CALLER_LOCAL_APP_DATA
    return environment


def real_global_file() -> str:
    """The file `git config --global` reads for the caller, from Git's own answer."""

    listing = subprocess.run(
        ["git", "config", "--global", "--show-origin", "--list"],
        env=_clean_environment(),
        capture_output=True,
        check=False,
    ).stdout.decode("utf-8", "replace")
    for line in listing.splitlines():
        if line.startswith("file:"):
            return line[len("file:") :].split("\t", 1)[0]
    return os.path.join(os.path.expanduser("~"), ".gitconfig")


def _paths(set_dir: Path) -> dict[str, Path]:
    return {
        "space": set_dir / "W",
        "repository": set_dir / "W" / "R",
        "store": set_dir / "store" / "valkama.sqlite3",
        "local": set_dir / "local",
        "gitconfig": set_dir / "gitconfig",
        "wrapper": set_dir / "client_hook.py",
        "state": set_dir / "state.json",
    }


def prepare(set_dir: Path, python: str) -> dict:
    if set_dir.exists():
        raise SystemExit(f"{set_dir} exists: a live check starts from a new set")
    paths = _paths(set_dir)
    for folder in (paths["repository"], paths["store"].parent, paths["local"] / "Valkama"):
        folder.mkdir(parents=True)
    real_global = real_global_file()
    real_local = CALLER_LOCAL_APP_DATA or ""
    state = {
        "python": python,
        "checkout": str(ROOT),
        "real_global_file": real_global,
        "real_global_sha256_before": _sha256(real_global),
        "real_registry": os.path.join(real_local, "Valkama", "projects.json"),
        "paths": {name: str(path) for name, path in paths.items()},
    }
    shutil.copyfile(real_global, paths["gitconfig"])
    state["set_gitconfig_sha256_copy"] = _sha256(str(paths["gitconfig"]))
    exports = (
        f"; export VALKAMA_DB={_slashed(paths['store'])}"
        f"; export LOCALAPPDATA={_slashed(paths['local'])}; exec "
    )
    for event, name in git_hook.NAMES.items():
        command = git_hook.command(python, str(ROOT / "valkama.py"), event)
        command = command.replace("; exec ", exports, 1)
        _git(set_dir, "config", "--file", str(paths["gitconfig"]), f"hook.{name}.command", command)
        _git(set_dir, "config", "--file", str(paths["gitconfig"]), f"hook.{name}.event", event)
    with mock.patch.dict(os.environ, {"VALKAMA_DB": str(paths["store"])}):
        store.connect().close()
    (paths["local"] / "Valkama" / "projects.json").write_bytes(
        registry_bytes([project_entry(PROJECT, paths["repository"])])
    )
    environ = {**_clean_environment(), "GIT_CONFIG_GLOBAL": str(paths["gitconfig"])}
    for folder in (paths["space"], paths["repository"]):
        _git(folder, "init", "-q", "-b", "main", environ=environ)
        (folder / "README.md").write_text(f"{folder.name}\n", encoding="utf-8", newline="\n")
        _git(folder, "add", "README.md", environ=environ)
        _git(folder, "commit", "-qm", "docs: start", environ=environ)
    folders = [
        str(paths["store"].parent / "commits"),
        str(paths["repository"] / ".git" / "valkama" / "commits"),
    ]
    paths["wrapper"].write_text(
        WRAPPER.format(
            set=str(set_dir),
            checkout=str(ROOT),
            store=str(paths["store"]),
            local=str(paths["local"]),
            folders=folders,
        ),
        encoding="utf-8",
        newline="\n",
    )
    hook = f"{_slashed(python)} -I -S {_slashed(paths['wrapper'])}"
    claude_dir = paths["space"] / ".claude"
    claude_dir.mkdir()
    shells = "Bash|PowerShell"
    claude_hooks = {
        event: [
            {"matcher": shells, "hooks": [{"type": "command", "command": f"{hook} claude {arg}"}]}
        ]
        for event, arg in (
            ("PostToolUse", "post-tool-use"),
            ("PostToolUseFailure", "post-tool-use-failure"),
        )
    }
    (claude_dir / "settings.json").write_text(
        json.dumps({"hooks": claude_hooks}, indent=1), encoding="utf-8", newline="\n"
    )
    codex_dir = paths["space"] / ".codex"
    codex_dir.mkdir()
    (codex_dir / "hooks.json").write_text(
        json.dumps({"hooks": codex_hooks(hook)}, indent=1), encoding="utf-8", newline="\n"
    )
    state["codex_hook_command"] = f"{hook} codex post-tool-use"
    paths["state"].write_text(json.dumps(state, indent=1), encoding="utf-8", newline="\n")
    return state


#: The names of Codex's shell tool: a hook's input says `Bash`, the tool calls itself
#: `exec_command`, and `shell` is its older name.
CODEX_SHELLS = "^(Bash|exec_command|shell)$"


def codex_hooks(hook: str, layer: str = "") -> dict:
    """W's `PostToolUse` hook for Codex; `layer` marks the session layer's copy in the
    inputs the wrapper keeps, so the report tells which layer ran it."""

    command = f"{hook} codex post-tool-use{f' {layer}' if layer else ''}"
    entry = {"type": "command", "command": command, "commandWindows": command, "timeout": 30}
    return {"PostToolUse": [{"matcher": CODEX_SHELLS, "hooks": [entry]}]}


def task(state: dict, client: str) -> str:
    """The one task each client gets: the inspection, then three commits, the subagent's
    after an inspection of its own shell.

    An inspection writes its result into W, the one directory a Codex sandbox lets the
    command write; its output also stays in the client's event stream."""

    python = _slashed(state["python"])
    script = _slashed(Path(state["checkout"]) / "tests" / "commit_inspection.py")

    def inspection(name: str) -> str:
        return (
            f"{python} -I -S {script} --repository R --interpreter {python}"
            f" --registry {_slashed(state['real_registry'])}"
            f" --global-file {_slashed(state['real_global_file'])}"
            f" --output {_slashed(Path(state['paths']['space']) / f'inspection-{name}.json')}"
        )

    return (
        "This is a test of commit hooks. Run exactly these shell commands, each as its own"
        " command, change nothing else, and do not retry a command that fails.\n"
        f"1. {inspection(client)}\n"
        f'2. git -C R commit --allow-empty -m "test: coordinator commit {client}"\n'
        "3. Start one subagent and have it run exactly these two shell commands, each as its"
        f" own command, then come back: {inspection(client + '-subagent')} and then"
        f' git -C R commit --allow-empty -m "test: subagent commit {client}"\n'
        f'4. git -C R commit --allow-empty -m "test: failing command {client}"; exit 3\n'
        "Then reply DONE."
    )


def _environment(state: dict) -> dict[str, str]:
    return {
        **_clean_environment(),
        "GIT_CONFIG_GLOBAL": state["paths"]["gitconfig"],
        "VALKAMA_DB": state["paths"]["store"],
    }


def launch(set_dir: Path, client: str, *, session_hooks: bool = False, kept: bool = False) -> dict:
    """Run one client on the set. `kept` runs Codex without `--ephemeral`: an ephemeral
    thread keeps no rollout, and a subagent cannot start from it."""

    state = json.loads(_paths(set_dir)["state"].read_text(encoding="utf-8"))
    space = state["paths"]["space"]
    text = task(state, client)
    if client == "claude":
        argv = [
            shutil.which("claude") or "claude",
            "-p",
            "--setting-sources",
            "project",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-hook-events",
            "--strict-mcp-config",
            "--allowedTools",
            CLAUDE_TOOLS,
        ]
    else:
        trust = f"projects.'{space.lower()}'.trust_level=\"trusted\""
        argv = [
            shutil.which("codex") or "codex",
            "exec",
            "-C",
            space,
            "-s",
            "workspace-write",
            *(() if kept else ("--ephemeral",)),
            "--json",
            "--ignore-user-config",
            "-c",
            'windows.sandbox="elevated"',
            "-c",
            trust,
            "--dangerously-bypass-hook-trust",
        ]
        if session_hooks:
            argv += ["-c", "hooks=" + _toml_inline(codex_hooks(_hook_of(state), "session"))]
        argv.append("-")
    name = f"{client}{'-session-hooks' if session_hooks else ''}{'-kept' if kept else ''}"
    # The task goes in on stdin: `--allowedTools` takes every word after it, and a
    # command line with line breaks does not survive a `.cmd` launcher.
    started = {"argv": argv, "stdin": text, "cwd": space}
    done = subprocess.run(
        argv,
        cwd=space,
        env=_environment(state),
        input=text.encode("utf-8"),
        capture_output=True,
        timeout=1200,
        check=False,
    )
    (set_dir / f"{name}.stdout.jsonl").write_bytes(done.stdout)
    (set_dir / f"{name}.stderr.txt").write_bytes(done.stderr)
    started["returncode"] = done.returncode
    (set_dir / f"{name}.launch.json").write_text(
        json.dumps(started, indent=1), encoding="utf-8", newline="\n"
    )
    return started


def _hook_of(state: dict) -> str:
    return state["codex_hook_command"].rsplit(" codex ", 1)[0]


def _toml_inline(value: object) -> str:
    """`value` as a TOML inline value, for `-c key=value`."""

    if isinstance(value, dict):
        return "{" + ", ".join(f"{key} = {_toml_inline(item)}" for key, item in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ", ".join(_toml_inline(item) for item in value) + "]"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return json.dumps(value)


def report(set_dir: Path) -> dict:
    import sqlite3

    state = json.loads(_paths(set_dir)["state"].read_text(encoding="utf-8"))
    conn = sqlite3.connect(f"file:{state['paths']['store']}?mode=ro", uri=True)
    try:
        rows = [
            dict(
                zip(
                    ("project_id", "hash", "subject", "session_id", "agent_id", "client"),
                    row,
                    strict=True,
                )
            )
            for row in conn.execute(
                "SELECT project_id, hash, subject, session_id, agent_id, client FROM commits"
                " ORDER BY commit_id"
            )
        ]
    finally:
        conn.close()
    log = _git(
        Path(state["paths"]["repository"]),
        "log",
        "--format=%H %s",
        environ={**_clean_environment(), "GIT_CONFIG_GLOBAL": state["paths"]["gitconfig"]},
    )
    inputs = []
    for path in (
        sorted((set_dir / "inputs").glob("*.json")) if (set_dir / "inputs").is_dir() else []
    ):
        try:
            payload = json.loads(path.read_bytes().decode("utf-8"))
        except ValueError:
            payload = {"unparsed": path.read_bytes()[:200].decode("utf-8", "replace")}
        inputs.append(
            {
                "file": path.name,
                **{
                    key: payload.get(key)
                    for key in (
                        "session_id",
                        "tool_name",
                        "tool_use_id",
                        "agent_id",
                        "agent_type",
                        "duration_ms",
                        "hook_event_name",
                    )
                },
                "answer": (path.with_suffix(".answer")).read_bytes().decode("utf-8", "replace")
                if path.with_suffix(".answer").exists()
                else None,
            }
        )
    seen = []
    for folder in sorted((set_dir / "seen").glob("*")) if (set_dir / "seen").is_dir() else []:
        for path in sorted(folder.glob("*.json")):
            record = json.loads(path.read_bytes().decode("utf-8"))
            seen.append(
                {
                    "seen_by": folder.name,
                    "file": path.name,
                    "hash": [commit["hash"] for commit in record["commits"]],
                    "claude": record["claude"],
                    "codex": record["codex"],
                }
            )
    left = {
        "beside_the_store": sorted(
            p.name for p in (Path(state["paths"]["store"]).parent / "commits").glob("*.json")
        ),
        "in_the_git_directory": sorted(
            p.name
            for p in (Path(state["paths"]["repository"]) / ".git" / "valkama" / "commits").glob(
                "*.json"
            )
        ),
    }
    after = _sha256(state["real_global_file"])
    return {
        "real_global_file": state["real_global_file"],
        "real_global_sha256_before": state["real_global_sha256_before"],
        "real_global_sha256_after": after,
        "real_global_unchanged": after == state["real_global_sha256_before"],
        "commits_in_r": log.splitlines(),
        "store_rows": rows,
        "hook_inputs": inputs,
        "records_seen_by_hooks": seen,
        "records_left": left,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "claude", "codex", "report"))
    parser.add_argument("set", type=Path)
    parser.add_argument("--python", help="the interpreter the hook commands start (prepare)")
    parser.add_argument("--session-hooks", action="store_true", help="codex: hooks by -c")
    parser.add_argument("--kept", action="store_true", help="codex: without --ephemeral")
    options = parser.parse_args(argv)
    set_dir = options.set.resolve()
    if options.action == "prepare":
        if not options.python:
            parser.error("prepare needs --python")
        result: object = prepare(set_dir, options.python)
    elif options.action == "report":
        result = report(set_dir)
    else:
        result = launch(
            set_dir, options.action, session_hooks=options.session_hooks, kept=options.kept
        )
    sys.stdout.write(json.dumps(result, indent=1, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
