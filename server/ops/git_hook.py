"""`valkama git-hook install|status|uninstall`: Valkama's hooks in the global Git configuration.

Git runs a hook its configuration names, `hook.<name>.command` for
`hook.<name>.event`, in addition to the hook directory's own. Valkama keeps three
there, `hook.valkama-commit`, `hook.valkama-rewrite` and `hook.valkama-merge`
(`hooks.git_hook.NAMES`), in the file `git config --global` writes, and touches
nothing else in it: `core.hooksPath`, the hook directory and every other entry
belong to whoever set them. The names are Valkama's, so `install` replaces a
command or an event found under one of them, and `uninstall` removes their
sections whole, which leaves the file's bytes as they were before `install` when
nothing else changed it in between.

Each command runs the launcher's shim on the interpreter its manifest records
(`hooks.git_hook.command`), never a checkout's `valkama.py`: the hook follows the
pinned release, and `launcher install` rewrites the command of a hook that is
there when the interpreter or the launcher's place changed (`refresh`). A
virtualenv's interpreter is replaced with its base one from `pyvenv.cfg`: on
Windows a virtualenv's `python.exe` starts the base one as a second process, and
the hook, started with `-I -S`, needs nothing from the environment.

`status` reads each hook's state:

- `installed`: Git lists it in the global scope, with the current command;
- `missing`: no command under its name;
- `stale`: a command or an event other than the current launcher's, or no
  launcher to compare with;
- `disabled`: `hook.<name>.enabled` is false in the global configuration;
- `unsupported`: everything is in place and Git does not list it, which is what
  a Git that runs no hooks from its configuration does.

and the commit records waiting for a client hook, with the directories they wait
in (`hooks.commit_records`).
"""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Callable, Mapping
from pathlib import Path

from .. import launcher, processes
from ..hooks import commit_records, notify
from ..hooks import git_hook as hook

#: Each hook's name by the event it runs on: the run's own table.
NAMES = hook.NAMES
STATES = ("installed", "missing", "stale", "disabled", "unsupported")
#: Which state a set of hooks reads as when they differ, the first that one of them has.
_ORDER = ("missing", "stale", "disabled", "unsupported")
#: What `install` says when no launcher gives it an interpreter and a shim to name.
INSTALL_FIRST = "install the launcher first: valkama launcher install"
#: The most one of its Git calls may take.
GIT_SECONDS = 30.0
#: The values Git reads as false for a boolean setting.
_FALSE = frozenset({"false", "no", "off", "0"})
_PATTERN = r"^hook\.valkama-"

#: Runs one Git command line and gives its decoded result.
Runner = Callable[[list[str]], processes.TextResult]


class GitHookError(RuntimeError):
    """The global Git configuration could not be read or written; the message says why."""


def _run(argv: list[str]) -> processes.TextResult:
    try:
        return processes.run_text(argv, errors="replace", timeout=GIT_SECONDS)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise GitHookError(f"git could not run: {error}") from error


def global_file(environ: Mapping[str, str] | None = None) -> str:
    """The file `git config --global` writes: `GIT_CONFIG_GLOBAL`, else Git's own choice.

    Git writes `~/.gitconfig`, unless that file is not there and
    `$XDG_CONFIG_HOME/git/config` (`~/.config/git/config`) is.
    """

    source = os.environ if environ is None else environ
    named = source.get("GIT_CONFIG_GLOBAL")
    if named:
        return named
    home = source.get("HOME") or os.path.expanduser("~")
    own = os.path.join(home, ".gitconfig")
    xdg = os.path.join(source.get("XDG_CONFIG_HOME") or os.path.join(home, ".config"), "git")
    other = os.path.join(xdg, "config")
    return other if not os.path.isfile(own) and os.path.isfile(other) else own


def base_interpreter(python: str) -> str:
    """The interpreter a virtualenv's `python` was made from, or `python` itself."""

    path = Path(python)
    for root in (path.parent, path.parent.parent):
        config = root / "pyvenv.cfg"
        if not config.is_file():
            continue
        try:
            text = config.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return python
        for line in text.splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip().casefold() == "home":
                candidate = Path(value.strip()) / path.name
                return str(candidate) if candidate.is_file() else python
        return python
    return python


def commands(launcher_directory: str | None = None) -> dict[str, str] | None:
    """Each event's command for the installed launcher; None when none is installed."""

    try:
        state = launcher.status(launcher_directory)
    except launcher.LauncherError:
        return None
    python, shim = state.get("python"), state.get("shim")
    if state.get("state") != "installed" or not isinstance(python, str) or not python:
        return None
    if not isinstance(shim, str) or not shim:
        return None
    interpreter = base_interpreter(python)
    return {event: hook.command(interpreter, shim, event) for event in NAMES}


def _entries(run: Runner) -> dict[str, dict[str, list[str]]]:
    """Valkama's entries in the global configuration: by name, each setting's values in order."""

    found = run(["git", "config", "--global", "-z", "--get-regexp", _PATTERN])
    if found.returncode == 1 and not found.stdout:
        return {}
    if found.returncode != 0:
        detail = (found.stderr or "").strip()[:400]
        raise GitHookError(f"the global Git configuration could not be read: {detail}")
    entries: dict[str, dict[str, list[str]]] = {}
    for item in found.stdout.split("\0"):
        if not item:
            continue
        key, _, value = item.partition("\n")
        section, _, setting = key.rpartition(".")
        name = section.partition(".")[2]
        entries.setdefault(name, {}).setdefault(setting, []).append(value)
    return entries


def _listed(run: Runner, event: str, cwd: str) -> set[str] | None:
    """The hooks Git runs from the global scope on `event`; None when Git cannot say."""

    listing = run(["git", "-C", cwd, "hook", "list", "--show-scope", event])
    if listing.returncode not in (0, 1):
        return None
    found = set()
    for line in listing.stdout.splitlines():
        fields = line.split("\t")
        if len(fields) == 2 and fields[0] == "global":
            found.add(fields[1])
    return found


def _neutral_directory(path: str) -> str:
    """Where Git is run to list hooks: the global file's directory, when it exists."""

    directory = os.path.dirname(os.path.abspath(path))
    return directory if os.path.isdir(directory) else os.path.abspath(os.sep)


def hook_states(launcher_directory: str | None = None, *, run: Runner | None = None) -> dict:
    """The global file and each hook's name, event and state."""

    git = run or _run
    entries = _entries(git)
    expected = commands(launcher_directory)
    path = global_file()
    hooks = []
    for event, name in NAMES.items():
        entry = entries.get(name, {})
        if not entry.get("command"):
            state = "missing"
        elif (
            expected is None
            or entry["command"] != [expected[event]]
            or entry.get("event") != [event]
        ):
            state = "stale"
        elif entry.get("enabled") and entry["enabled"][-1].strip().lower() in _FALSE:
            state = "disabled"
        else:
            listed = _listed(git, event, _neutral_directory(path))
            state = "installed" if listed is not None and name in listed else "unsupported"
        hooks.append({"name": name, "event": event, "state": state})
    return {"global_file": path, "hooks": hooks}


def overall(hooks: list[dict]) -> str:
    """One state for the three: `installed` when each is, else the first of `_ORDER` one has."""

    states = {entry["state"] for entry in hooks}
    return next((state for state in _ORDER if state in states), "installed")


def waiting(store_path: str | None = None) -> dict:
    """The commit records on disk: the directories that exist, every record file in them
    (its time, session key and path, oldest first) and the files set aside in
    `rejected/` beside them, by directory.

    The places are the ones a client hook reads: beside the store the one
    configuration names, and in each registered project's own Git directory.
    """

    path = store_path if store_path is not None else notify.settings()[0]
    places = [commit_records.store_directory(path)] if path else []
    places += commit_records.own_fallbacks(commit_records.registry_roots(json.loads))
    present = [directory for directory in places if os.path.isdir(directory)]
    rejected = {}
    for directory in present:
        aside = os.path.join(directory, commit_records.REJECTED)
        try:
            count = sum(1 for entry in os.scandir(aside) if entry.is_file())
        except OSError:
            continue
        if count:
            rejected[aside] = count
    return {
        "directories": present,
        "files": commit_records.every(present),
        "rejected": rejected,
    }


def status(
    launcher_directory: str | None = None,
    *,
    run: Runner | None = None,
    store_path: str | None = None,
) -> dict:
    """Each hook's state, the records waiting and the directories they wait in."""

    reading = hook_states(launcher_directory, run=run)
    records = waiting(store_path)
    files = records["files"]
    return {
        **reading,
        "records": {
            "count": len(files),
            "oldest": commit_records.timestamp(files[0][0]) if files else None,
        },
        "record_directories": records["directories"],
    }


def _set(run: Runner, key: str, value: str) -> None:
    written = run(["git", "config", "--global", "--replace-all", key, value])
    if written.returncode != 0:
        detail = (written.stderr or "").strip()[:400]
        raise GitHookError(f"git config --global could not write {key}: {detail}")


def install(launcher_directory: str | None = None, *, run: Runner | None = None) -> dict:
    """Write the three hooks for the installed launcher; `changed` says whether anything was.

    A name's command is written before its event: Git runs no hook that has a
    command and no event, so an interrupted install never leaves one running the
    command of another build.
    """

    git = run or _run
    expected = commands(launcher_directory)
    if expected is None:
        raise GitHookError(INSTALL_FIRST)
    entries = _entries(git)
    changed = False
    for event, name in NAMES.items():
        entry = entries.get(name, {})
        if entry.get("command") != [expected[event]]:
            _set(git, f"hook.{name}.command", expected[event])
            changed = True
        if entry.get("event") != [event]:
            _set(git, f"hook.{name}.event", event)
            changed = True
    return {
        "global_file": global_file(),
        "hooks": [
            {"name": name, "event": event, "command": expected[event]}
            for event, name in NAMES.items()
        ],
        "changed": changed,
    }


def refresh(launcher_directory: str | None = None, *, run: Runner | None = None) -> dict:
    """After a launcher install: point the command of each hook that is there at it.

    A hook that is not there stays away: installing one is what `install`
    decides, not a side effect of pinning a release. Its event and whether it
    is enabled are left as they are.
    """

    git = run or _run
    entries = _entries(git)
    present = [
        (event, name) for event, name in NAMES.items() if entries.get(name, {}).get("command")
    ]
    if not present:
        return {"global_file": global_file(), "hooks": [], "changed": False}
    expected = commands(launcher_directory)
    if expected is None:
        raise GitHookError(INSTALL_FIRST)
    changed = False
    for event, name in present:
        if entries[name]["command"] != [expected[event]]:
            _set(git, f"hook.{name}.command", expected[event])
            changed = True
    return {
        "global_file": global_file(),
        "hooks": [
            {"name": name, "event": event, "command": expected[event]} for event, name in present
        ],
        "changed": changed,
    }


def uninstall(*, run: Runner | None = None) -> dict:
    """Remove the section of each of the three hooks that is there, and nothing else."""

    git = run or _run
    entries = _entries(git)
    removed = []
    for name in NAMES.values():
        if name not in entries:
            continue
        gone = git(["git", "config", "--global", "--remove-section", f"hook.{name}"])
        if gone.returncode != 0:
            detail = (gone.stderr or "").strip()[:400]
            raise GitHookError(f"git config --global could not remove hook.{name}: {detail}")
        removed.append(name)
    return {"global_file": global_file(), "removed": removed, "changed": bool(removed)}


def render(result: dict) -> str:
    """One answer of `git-hook` as lines for a person."""

    lines = [f"global Git file: {result['global_file']}"]
    if "removed" in result:
        names = ", ".join(result["removed"]) or "nothing"
        lines.append(f"removed: {names}")
        return "\n".join(lines)
    for entry in result["hooks"]:
        lines.append(
            f"  {entry['name']:<16} {entry['event']:<13} {entry.get('state', '')}".rstrip()
        )
    if "changed" in result:
        lines.append("changed" if result["changed"] else "already as it should be")
    records = result.get("records")
    if records is not None:
        oldest = f", the oldest from {records['oldest']}" if records["oldest"] else ""
        lines.append(f"commit records waiting: {records['count']}{oldest}")
        for directory in result["record_directories"]:
            lines.append(f"  {directory}")
    return "\n".join(lines)


__all__ = [
    "INSTALL_FIRST",
    "NAMES",
    "STATES",
    "GitHookError",
    "base_interpreter",
    "commands",
    "global_file",
    "hook_states",
    "install",
    "overall",
    "refresh",
    "render",
    "status",
    "uninstall",
    "waiting",
]
