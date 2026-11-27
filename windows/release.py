"""Build and verify the source and Windows desktop release pair.

Release Kit runs build and smoke from a committed, Git-free source snapshot, and
check in the working tree of the checkout it releases from. Check installs both
npm packages from their lockfiles, so what it verifies is what the lockfiles pin,
but never in that checkout: other worktrees on the machine link their
`node_modules` to its, and `npm ci` empties the tree it installs into, under every
link to it. So check copies the working tree's sources, the files Git tracks or
would add and never a `node_modules`, into a temporary directory, installs and
runs every npm stage there, and puts the web build back in `web/dist`, where
Release Kit's clean-tree check after the checks finds a committed bundle its
sources no longer build. The copy is removed when check ends, without entering a
link inside it. The checkout's own `node_modules`, a directory or a link, is not
read or changed.
The desktop installer is a window for the source service, not a bundled server.
Build installs and packs it in a copy of `desktop/` and `windows/` inside its
work directory, never in the snapshot, which Release Kit cleans only of what it
wrote itself.
The source archive has no Git history, so build writes into it the commit Release
Kit names and the digest of every file (`server/source_archive.py`), which is what
lets `launcher install` pin an unpacked archive; smoke checks that record.

Release Kit runs every command here with its own interpreter as `{python}`, so
`check` takes its Python tools from that interpreter's environment and nowhere
else, and refuses before the first stage when that environment lacks one. The
one exception is a tool whose own dependencies keep it out of that environment:
it has an environment of its own beside it, with its own pins, and is taken and
checked there (`OwnEnvironment`). Build
and smoke need no development tool: build runs npm, and smoke runs the server,
which imports only the standard library.

`prices` is a stage of `check`: it compares the server's price table with
LiteLLM's public price list, so a wrong or missing price is caught before a
release. The server itself makes no network call, so the comparison lives here.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import sysconfig
import tempfile
import urllib.request
import zipfile
from collections.abc import Callable, Collection, Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from types import ModuleType

ROOT = Path(__file__).resolve().parents[1]
NPM = "npm.cmd" if sys.platform == "win32" else "npm"
#: The directories holding an npm package the gates run.
NPM_PACKAGES = ("web", "desktop")
#: The top-level directories `npm run dist` reads, which build copies as siblings.
DIST_PACKAGES = ("desktop", "windows")
#: Names the checkout to `tests/heavy_gate.py` (its `ROOT_VARIABLE`) for the npm
#: stages, whose copy of the sources is in no repository and so has no gate rules.
HEAVY_GATE_ROOT = "VALKAMA_HEAVY_GATE_ROOT"
SKIP_DIRS = frozenset(
    {".git", ".cache", ".private", ".state", "tmp", "node_modules", "release", "__pycache__"}
)
REQUIREMENTS = ROOT / "requirements-dev.txt"
#: The Python `.venv` is built on: the one the installed launcher runs, so the suite
#: and the tools run on the interpreter and the SQLite the service does.
VENV_PYTHON = "3.15"
_PIN = re.compile(r"([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9.+!_-]+)")
#: What pip names a console script: an `.exe` launcher on Windows, the bare name elsewhere.
_SCRIPT_SUFFIXES = (".exe",) if sys.platform == "win32" else ("",)


class ToolchainError(RuntimeError):
    """This environment cannot run the check, and the message says why; nothing has run yet."""


@dataclass(frozen=True)
class OwnEnvironment:
    """A virtual environment beside `.venv` for a tool whose dependencies keep it out of it.

    semgrep is the one: a command-line tool nothing here imports, whose releases
    pin pywin32 to a version with no wheel for the Python `.venv` is built on.
    Its pins live in `requirements`, it is built in `directory` on `python`, the
    newest Python its dependencies install on, and it is run and checked there.
    """

    directory: Path
    requirements: Path
    python: str


SEMGREP_ENVIRONMENT = OwnEnvironment(
    ROOT / ".venv-semgrep", ROOT / "requirements-semgrep.txt", python="3.14"
)


@dataclass(frozen=True)
class Tool:
    """A tool `check` runs: the distribution that pins it, and how it is started.

    `module` runs it as `python -m module`. A tool without one is the console
    script `script` from the environment's own scripts directory: typos and
    lint-imports have no runnable module, and `python -m semgrep` is refused
    by semgrep itself. `environment` names an environment of its own; without
    one the tool belongs to the running interpreter.
    """

    distribution: str
    module: str | None = None
    script: str | None = None
    environment: OwnEnvironment | None = None


TOOLS: dict[str, Tool] = {
    "ruff": Tool("ruff", module="ruff"),
    "typos": Tool("typos", script="typos"),
    "vulture": Tool("vulture", module="vulture"),
    "mypy": Tool("mypy", module="mypy"),
    "lint-imports": Tool("import-linter", script="lint-imports"),
    "semgrep": Tool("semgrep", script="semgrep", environment=SEMGREP_ENVIRONMENT),
    "coverage": Tool("coverage", module="coverage"),
}

#: The two runners of the stages: `tests/isolated.py gates`, the integrator's run of
#: the list in `AGENTS.md`, and `check`, which Release Kit runs before a release.
GATES = "gates"
CHECK = "check"


@dataclass(frozen=True)
class Stage:
    """One stage of the gates, declared once in `STAGES` for both runners.

    `command` is spelled as `AGENTS.md` spells it, and `stage_argv` resolves its
    program. `directory` is where it runs, relative to the checkout; `check`
    runs an npm stage there in its copy of the sources. `resource` is the kind
    of run the machine's heavy-process gate holds for the whole stage, as
    `.heavy-gate.toml` declares it: none for a light stage, nor for one such as
    `npm test` whose command takes a lease for a part of itself. `runners` names
    which runners run it.
    """

    name: str
    group: str
    command: str
    directory: str = "."
    #: It reads the commits of the checkout, so a directory without them refuses it.
    needs_history: bool = False
    resource: str | None = None
    runners: frozenset[str] = frozenset({GATES, CHECK})

    @property
    def needs_modules(self) -> bool:
        return self.command.startswith("npm ")


#: The kind of run `tests/parallel.py` is at the heavy-process gate (its `KIND`).
#: Spelled here: importing the `tests` package moves the environment it runs in.
UNITTEST_PARALLEL = "unittest-parallel"

#: Every stage, in the order both runners run them. The `gates` stages are the list
#: in `AGENTS.md`, which `tests/test_isolated.py` compares. `check` installs the
#: lockfiles' modules first, a registry that cannot be reached costing seconds and
#: not the whole suite, and compares prices next for the same reason. The two steps
#: that read the commits, the subjects and the history audit, are the gates' alone.
STAGES = (
    Stage("web-ci", "web", "npm ci", "web", runners=frozenset({CHECK})),
    Stage("desktop-ci", "desktop", "npm ci", "desktop", runners=frozenset({CHECK})),
    Stage("prices", "python", "python windows/release.py prices", runners=frozenset({CHECK})),
    Stage("ruff", "python", "python -m ruff check ."),
    Stage("format", "python", "python -m ruff format --check ."),
    Stage(
        "subjects",
        "python",
        "python tests/commit_subjects.py",
        needs_history=True,
        runners=frozenset({GATES}),
    ),
    Stage(
        "relkit", "python", "python .github/relkit.pyz audit --history", runners=frozenset({GATES})
    ),
    Stage("typos", "python", "typos"),
    Stage(
        "vulture",
        "python",
        "vulture server tests valkama.py vulture_whitelist.py --min-confidence 60",
    ),
    Stage("mypy", "python", "mypy"),
    Stage("lint-imports", "python", "lint-imports --cache-dir .cache/import-linter"),
    Stage(
        "semgrep",
        "python",
        "semgrep scan --config p/python --config p/security-audit --metrics off --error"
        " server valkama.py",
    ),
    Stage("unittest", "python", "python tests/parallel.py --coverage", resource=UNITTEST_PARALLEL),
    Stage("coverage", "python", "python -m coverage report"),
    Stage("web-test", "web", "npm test", "web"),
    Stage("web-build", "web", "npm run build", "web"),
    Stage("desktop-test", "desktop", "npm test", "desktop"),
)


def runner_stages(runner: str) -> tuple[Stage, ...]:
    """The stages `runner` runs, in their order, read from `STAGES` when asked."""

    return tuple(stage for stage in STAGES if runner in stage.runners)


def stage_argv(command: str, python: str, tools: Mapping[str, tuple[str, ...]]) -> list[str]:
    """A stage's command as a process starts it: `python` and `npm` as named, a tool as resolved."""

    program, *arguments = shlex.split(command)
    if program == "python":
        return [python, *arguments]
    if program == "npm":
        return [NPM, *arguments]
    return [*tools[program], *arguments]


@dataclass(frozen=True)
class Interpreter:
    """One Python environment: its executable, where its console scripts are, what it has."""

    executable: Path
    scripts: Path
    version_of: Callable[[str], str | None]


def _installed(distribution: str) -> str | None:
    try:
        return importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        return None


def running_interpreter() -> Interpreter:
    """The interpreter running this file, which is the `{python}` Release Kit passed.

    Its scripts directory is the one its installer writes console scripts to:
    `Scripts` beside the executable in a Windows venv, `bin` in a POSIX one.
    """

    return Interpreter(Path(sys.executable), Path(sysconfig.get_path("scripts")), _installed)


def environment_interpreter(directory: Path) -> Interpreter:
    """The virtual environment at `directory`, read from its files without starting it.

    What it has installed is read from its own site-packages and nowhere else,
    so a distribution of the running interpreter never answers for it.
    """

    windows = sys.platform == "win32"
    scripts = directory / ("Scripts" if windows else "bin")
    if windows:
        site = [directory / "Lib" / "site-packages"]
    else:
        site = sorted((directory / "lib").glob("python*/site-packages"))
    paths = [str(path) for path in site]

    def version_of(distribution: str) -> str | None:
        found = next(iter(importlib.metadata.distributions(name=distribution, path=paths)), None)
        return None if found is None else found.version

    return Interpreter(scripts / ("python.exe" if windows else "python"), scripts, version_of)


#: What `require_toolchain` reads for an environment of its own: the environment and its pins.
OwnToolchain = Mapping[OwnEnvironment, tuple[Interpreter, Mapping[str, str]]]


def own_environments() -> dict[OwnEnvironment, tuple[Interpreter, dict[str, str]]]:
    """Each environment of its own that a tool names, with the pins its requirements file holds."""

    found: dict[OwnEnvironment, tuple[Interpreter, dict[str, str]]] = {}
    for tool in TOOLS.values():
        own = tool.environment
        if own is not None and own not in found:
            text = own.requirements.read_text(encoding="utf-8")
            found[own] = (environment_interpreter(own.directory), pins(text))
    return found


def pins(text: str) -> dict[str, str]:
    """Every `name==version` in a requirements file; anything looser is refused."""

    found = {}
    for line in text.splitlines():
        requirement = line.split("#", 1)[0].strip()
        if not requirement:
            continue
        match = _PIN.fullmatch(requirement)
        if match is None:
            raise ValueError(f"a gate requirements file must pin exactly: {requirement}")
        found[match.group(1)] = match.group(2)
    return found


def _pin_problems(
    interpreter: Interpreter, pinned: Mapping[str, str], source: str = REQUIREMENTS.name
) -> list[str]:
    problems = []
    for distribution, wanted in pinned.items():
        installed = interpreter.version_of(distribution)
        if installed is None:
            problems.append(f"{distribution}: not installed; {source} pins {wanted}")
        elif installed != wanted:
            problems.append(f"{distribution}: {installed} installed; {source} pins {wanted}")
    return problems


def _build_hint(own: OwnEnvironment) -> str:
    name = own.directory.name
    return (
        f" Build {name} beside it from {own.requirements.name} the same way, on"
        f" Python {own.python} (uv venv {name} --python {own.python}, then uv pip"
        f" install --python {name}/Scripts/python.exe -r {own.requirements.name})."
    )


def require_toolchain(
    interpreter: Interpreter,
    pinned: Mapping[str, str],
    own: OwnToolchain,
    only: Collection[str] | None = None,
) -> dict[str, tuple[str, ...]]:
    """How to start each tool, or one refusal naming everything missing.

    A tool is taken from the running interpreter unless it names an environment
    of its own, and then from that environment alone, its pin read from that
    environment's requirements file and checked against what is installed
    there. A console script is looked up in its environment's scripts directory
    alone: a same-named one on PATH belongs to some other environment.

    `only` names the tools to check, and the default is every tool. A tool left
    out is neither checked nor resolved, so an environment that only a tool
    outside the selection needs may be absent. The running interpreter's pins
    are checked either way.
    """

    if only is not None:
        unknown = sorted(set(only) - set(TOOLS))
        if unknown:
            raise ValueError(f"not a gate tool: {', '.join(unknown)}")
    problems = _pin_problems(interpreter, pinned)
    commands: dict[str, tuple[str, ...]] = {}
    hints: dict[OwnEnvironment, str] = {}
    for name, tool in TOOLS.items():
        if only is not None and name not in only:
            continue
        environment, wanted, source = interpreter, pinned, REQUIREMENTS.name
        if tool.environment is not None:
            hints[tool.environment] = _build_hint(tool.environment)
            source = tool.environment.requirements.name
            if tool.environment not in own:
                problems.append(
                    f"{name}: its environment {tool.environment.directory} was not read"
                )
                continue
            environment, wanted = own[tool.environment]
            if not environment.executable.is_file():
                problems.append(
                    f"{name}: no environment at {tool.environment.directory}; build it from {source}"
                )
                continue
            problems += _pin_problems(environment, wanted, source)
        if tool.distribution not in wanted:
            problems.append(f"{name}: {tool.distribution} is not pinned in {source}")
        if tool.module is not None:
            commands[name] = (str(environment.executable), "-m", tool.module)
        elif tool.script is not None:
            found = _console_script(environment.scripts, tool.script)
            if found is not None:
                commands[name] = (str(found),)
            elif environment.version_of(tool.distribution) is not None:
                # A missing distribution is already reported; a missing script
                # beside an installed one is a broken install.
                problems.append(f"{name}: no {tool.script} console script in {environment.scripts}")
    if problems:
        listed = "\n".join(f"  - {problem}" for problem in problems)
        raise ToolchainError(
            f"release check: {interpreter.executable} does not hold the pinned gate"
            f" toolchain:\n{listed}\n"
            "Run the release with the project's virtual environment: create it and"
            f" install the pins (uv venv .venv --python {VENV_PYTHON}, then uv pip install"
            " --python .venv/Scripts/python.exe -r requirements-dev.txt; or"
            " python -m venv .venv, then .venv/Scripts/python -m pip install -r"
            " requirements-dev.txt), then run .venv/Scripts/python .github/relkit.pyz"
            " release prepare <version> (.venv/bin/python outside Windows)."
            + "".join(hints.values())
        )
    return commands


def _console_script(directory: Path, name: str) -> Path | None:
    """The console script `name` in `directory`, and nowhere else.

    `shutil.which` with a `path` still searches the current directory first on
    Windows, so a same-named executable where the release runs would win.
    """

    for candidate in (directory / f"{name}{suffix}" for suffix in _SCRIPT_SUFFIXES):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def tool_environment(interpreter: Interpreter, base: Mapping[str, str]) -> dict[str, str]:
    """`base` with the interpreter's scripts directory first on PATH.

    semgrep's launcher starts `pysemgrep` through PATH and only appends its own
    directory, so a shared install earlier on PATH would otherwise run instead.
    """

    return _scripts_first(interpreter.scripts, base)


def program_environment(command: Sequence[str], base: Mapping[str, str]) -> dict[str, str]:
    """`base` with the directory of the program `command` starts first on PATH.

    A tool from an environment of its own needs its own scripts first for the
    reason `tool_environment` gives: semgrep's launcher would otherwise start a
    `pysemgrep` an older `.venv` still holds. A program named without a
    directory, such as npm, is found on PATH and leaves it as it is.
    """

    program = Path(command[0])
    return _scripts_first(program.parent, base) if program.is_absolute() else dict(base)


def _scripts_first(scripts: Path, base: Mapping[str, str]) -> dict[str, str]:
    environment = dict(base)
    key = next((name for name in environment if name.upper() == "PATH"), "PATH")
    parts = [part for part in environment.get(key, "").split(os.pathsep) if part]
    if parts[:1] != [str(scripts)]:
        parts.insert(0, str(scripts))
    environment[key] = os.pathsep.join(parts)
    return environment


def run(
    *command: str,
    cwd: Path = ROOT,
    env: dict[str, str] | None = None,
    input_bytes: bytes | None = None,
) -> bytes:
    """Capture only when a response must be parsed; never use locale text pipes."""

    result = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        input=input_bytes,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        # Diagnostics are human-facing; replacement is safe here, not for decisions.
        detail = result.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"{' '.join(command)} exited {result.returncode}: {detail}")
    return result.stdout


def linked_modules(package: Path) -> Path | None:
    """Where the `node_modules` of `package` really is, when that is somewhere else.

    A worktree often links its modules to another checkout's. `npm ci` through
    such a link empties the target and then replaces the link with a directory of
    its own, so every checkout sharing the target loses its modules. Paths are
    compared because `Path.is_symlink` does not see a Windows junction on 3.11.
    """

    target = (package / "node_modules").resolve()
    return None if target == package.resolve() / "node_modules" else target


def task_parent() -> Path:
    """The short directory under the OS temporary one that `check` makes its own areas in.

    Release coordinators often supply a deeply nested TEMP: too long for the socket
    path semgrep-core makes in it, and a deep start for the paths of an npm install.
    """

    temp_root = (
        (Path(os.environ["LOCALAPPDATA"]) / "Temp").resolve()
        if sys.platform == "win32"
        else Path(tempfile.gettempdir()).resolve()
    )
    parent = temp_root / "codex"
    if parent.resolve().parent != temp_root:
        raise ValueError("check workspace must stay inside the temporary directory")
    parent.mkdir(exist_ok=True)
    return parent


def copy_sources(checkout: Path, copy: Path) -> None:
    """Copy into `copy` each file of `checkout`'s working tree that Git tracks or would add.

    The bytes are the working tree's, edits not yet committed included: what the
    npm stages read when they ran in the checkout. An ignored file is local output,
    and a `node_modules` is left out even where Git reports one, as it does a link.
    The whole tree is copied because the npm stages read past their packages: the
    web tests read `docs/`, `tests/` and `windows/`, its duplicate scan `server/`,
    and the desktop tests their samples in `tests/fixtures/`.
    """

    listed = run(
        "git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", cwd=checkout
    ).decode("utf-8", errors="strict")
    for name in sorted(set(listed.split("\0")) - {""}):
        relative = PurePosixPath(name)
        source = checkout.joinpath(*relative.parts)
        # A tracked file deleted from the working tree is no source to check.
        if "node_modules" in relative.parts or not source.is_file():
            continue
        target = copy.joinpath(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def _writable_and_again(function: Callable[[str], object], path: str, _failure: object) -> None:
    """Clear the read-only mark Windows refuses to delete, which an npm package may carry.

    Only on the entry itself: a mode change on a link would change what it points to.
    """

    entry = Path(path)
    if entry.resolve() == entry.parent.resolve() / entry.name:
        os.chmod(entry, stat.S_IWRITE)
    function(path)


def _remove_copy(copy: Path) -> str | None:
    """Remove the copy without entering a link in it; what was left, said, when not all went."""

    try:
        shutil.rmtree(copy, onerror=_writable_and_again)
    except OSError as failure:
        return f"release check: the npm copy {copy} could not be removed and is left: {failure}"
    return None


@contextlib.contextmanager
def npm_copy(checkout: Path) -> Iterator[Path]:
    """A temporary copy of `checkout`'s sources for the npm stages, removed when they end.

    A copy that cannot be removed fails the check; when a stage failed first, that
    failure is the one raised, and the copy left behind is named beside it.
    """

    copy = Path(tempfile.mkdtemp(prefix="valkama-npm-", dir=task_parent()))
    try:
        copy_sources(checkout, copy)
        yield copy
    except BaseException:
        if (left := _remove_copy(copy)) is not None:
            sys.stderr.write(f"{left}\n")
        raise
    if (left := _remove_copy(copy)) is not None:
        raise RuntimeError(left)


def publish_web_build(built: Path, published: Path) -> None:
    """Replace the checkout's bundle, `published`, with the one the build wrote in the copy.

    The build empties its output directory before writing, so the bundle replaces
    the checkout's whole, and a chunk it no longer writes goes too. A committed
    bundle that differs is then what Release Kit's clean-tree check refuses.
    """

    if published.exists():
        shutil.rmtree(published)
    shutil.copytree(built, published)


def version() -> str:
    return (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def package_version() -> str:
    package = json.loads((ROOT / "desktop/package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "desktop/package-lock.json").read_text(encoding="utf-8"))
    if (
        package["version"] != lock["version"]
        or package["version"] != lock["packages"][""]["version"]
    ):
        raise ValueError("desktop package and lockfile versions differ")
    return str(package["version"])


def require_version(expected: str) -> None:
    if expected != version() or expected != package_version():
        raise ValueError("VERSION, requested release and desktop package must match")


def isolated_environment(state: Path, base: Mapping[str, str] | None = None) -> dict[str, str]:
    state.mkdir()
    for name in ("local", "roaming", "temp", "claude-sessions", "codex-rollouts", "documents"):
        (state / name).mkdir()
    environment = dict(os.environ if base is None else base)
    for name in ("VALKAMA_CUTOVER", "VALKAMA_PROTECTED_STORE"):
        environment.pop(name, None)
    environment.update(
        {
            "VALKAMA_DB": str(state / "valkama.sqlite3"),
            "USERPROFILE": str(state),
            "HOME": str(state),
            "LOCALAPPDATA": str(state / "local"),
            "APPDATA": str(state / "roaming"),
            "TEMP": str(state / "temp"),
            "TMP": str(state / "temp"),
            "VALKAMA_CLAUDE_SESSION_ROOT": str(state / "claude-sessions"),
            "VALKAMA_CODEX_ROLLOUT_ROOT": str(state / "codex-rollouts"),
            "VALKAMA_DOC_ROOTS": str(state / "documents"),
            "VALKAMA_NO_TRAY": "1",
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
        }
    )
    return environment


def check(
    interpreter: Interpreter | None = None,
    requirements: str | None = None,
    own: OwnToolchain | None = None,
) -> None:
    """Run every gate, each Python tool from the interpreter running this file.

    A tool with an environment of its own comes from that environment.

    The toolchain is verified against the pins before anything else, so a
    wrong interpreter is refused in one message instead of one stage at a time.
    `npm ci` runs ahead of the Python stages, though only the npm stages need it:
    a registry that cannot be reached then costs a minute and not the whole suite.
    Every npm stage runs in `npm_copy`, never in the checkout; the Python stages
    run in the checkout.
    """

    interpreter = interpreter or running_interpreter()
    if requirements is None:
        requirements = REQUIREMENTS.read_text(encoding="utf-8")
    tools = require_toolchain(
        interpreter, pins(requirements), own_environments() if own is None else own
    )
    require_version(version())
    base = tool_environment(interpreter, os.environ)
    with npm_copy(ROOT) as copy:
        sys.stdout.write(f"release check: the npm stages run in a copy of the sources, {copy}\n")
        _run_stages(_stages(interpreter, tools, copy), base)


def _stages(
    interpreter: Interpreter, tools: Mapping[str, tuple[str, ...]], copy: Path
) -> list[tuple[str, tuple[str, ...], Path]]:
    """Each stage of `check`, from `STAGES`: its name, its command and where it runs.

    The npm stages run in `copy`, the Python stages in the checkout. The web
    build is the one npm stage whose output leaves the copy: `_run_stages` puts it
    in the checkout's `web/dist`.
    """

    python = str(interpreter.executable)
    return [
        (
            stage.name,
            tuple(stage_argv(stage.command, python, tools)),
            # Into the copy: `npm ci` empties the tree it installs into, and the
            # checkout's may be the one other worktrees link theirs to.
            (copy if stage.needs_modules else ROOT) / stage.directory,
        )
        for stage in runner_stages(CHECK)
    ]


def _run_stages(stages: list[tuple[str, tuple[str, ...], Path]], shared: dict[str, str]) -> None:
    for stage, command, cwd in stages:
        sys.stdout.write(f"release check: {' '.join(command)}\n")
        sys.stdout.flush()
        base = program_environment(command, shared)
        if command[0] == NPM:
            # The copy is in no repository, so the heavy-process gate finds no rules there.
            base[HEAVY_GATE_ROOT] = str(ROOT)
        # Gate output is not parsed; inherit pipes to preserve the tool's text.
        if stage == "unittest":
            # The suite in a profile of its own, as `gates` runs every stage.
            with tempfile.TemporaryDirectory(prefix="valkama-check-", dir=task_parent()) as task:
                environment = isolated_environment(Path(task) / "user-state", base)
                environment["GIT_CEILING_DIRECTORIES"] = task
                subprocess.run(command, cwd=cwd, env=environment, check=True)
        elif stage == "semgrep" and sys.platform == "win32":
            # semgrep-core's native socketpair fails when its temporary socket
            # path is too long; give only this process a short owned OS temp path.
            with tempfile.TemporaryDirectory(prefix="sg-", dir=task_parent()) as task:
                environment = {**base, "TEMP": task, "TMP": task, "TMPDIR": task}
                subprocess.run(command, cwd=cwd, env=environment, check=True)
        elif stage == "web-build":
            subprocess.run(command, cwd=cwd, env=base, check=True)
            # The build wrote the copy's `dist`; the checkout's is the one served,
            # committed and compared by Release Kit after the checks.
            publish_web_build(cwd / "dist", ROOT / "web" / "dist")
        else:
            subprocess.run(command, cwd=cwd, env=base, check=True)


#: LiteLLM's public price list (BerriAI/litellm, MIT). The check reads it to compare
#: and copies nothing from it.
LITELLM_PRICES = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
)
PRICE_SOURCE_TIMEOUT = 30.0
#: The LiteLLM field for each kind the table prices, in USD per token. LiteLLM names a
#: vendor's longer cache retention by its length, which `_LONGER_CACHE` supplies.
_LITELLM_FIELDS = {
    "input": "input_cost_per_token",
    "cached_read": "cache_read_input_token_cost",
    "cache_write_5m": "cache_creation_input_token_cost",
    "cache_write_1h": "cache_creation_input_token_cost_above_{longer}",
    "output": "output_cost_per_token",
}
_LONGER_CACHE = {"anthropic": "1hr", "openai": "12hr"}
#: A price LiteLLM gives prompts over some length, which the table must model too.
_LITELLM_LONG = re.compile(r"input_cost_per_token_above_(\d+)k_tokens")
_DATED = re.compile(r"-\d{8}$")


class PriceCheckError(RuntimeError):
    """The price stage fails, and the message says what differs or what could not be read."""


def fetch_price_list() -> Mapping[str, object]:
    """LiteLLM's price list, or a refusal saying it could not be read."""

    try:
        with urllib.request.urlopen(LITELLM_PRICES, timeout=PRICE_SOURCE_TIMEOUT) as answer:
            document = json.loads(answer.read().decode("utf-8"))
    except (OSError, ValueError) as failure:
        raise PriceCheckError(
            f"release check: LiteLLM's price list could not be read from {LITELLM_PRICES}:"
            f" {failure}. No price was compared, so the check does not pass."
        ) from failure
    if not isinstance(document, dict):
        raise PriceCheckError(
            f"release check: {LITELLM_PRICES} is not a price list. No price was compared."
        )
    return document


def server_module(name: str, *parts: str) -> ModuleType | None:
    """A standard-library-only server module, loaded from its file.

    This script runs with `windows/` on its path and not the server package, so
    the server's own code for a question is loaded where it lies.
    """

    spec = importlib.util.spec_from_file_location(name, ROOT.joinpath("server", *parts))
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    # A dataclass resolves its annotations through the module's sys.modules entry.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def price_table() -> ModuleType:
    """The server's price table, loaded from its file as the server prices with it."""

    module = server_module("valkama_usage_prices", "telemetry", "usage_prices.py")
    if module is None:
        raise PriceCheckError("release check: the server's price table cannot be loaded")
    return module


def source_archive() -> ModuleType:
    """The record format `launcher install` reads an unpacked source archive by."""

    module = server_module("valkama_source_archive", "source_archive.py")
    if module is None:
        raise RuntimeError("the server's source archive record cannot be loaded")
    return module


def _per_million(value: float | None) -> str:
    return "no price" if value is None else f"{value:g} USD per million tokens"


@dataclass(frozen=True)
class PriceComparison:
    """What differs, what LiteLLM does not list, and how many models were compared."""

    differences: list[str]
    notes: list[str]
    compared: int


def compare_prices(table: ModuleType, document: Mapping[str, object]) -> PriceComparison:
    """What differs between the table and LiteLLM's list.

    Every model of the table LiteLLM lists for the same vendor is compared rate by
    rate, its long prices included; a dated LiteLLM id of a Claude model is that
    model. A model or a rate LiteLLM does not list is reported and does not fail: a
    new model can precede their update. A price only one side has is a difference.
    """

    differences: list[str] = []
    notes: list[str] = []
    compared = 0
    for model, listing in sorted(table.listings().items()):
        entries = sorted(
            (key, entry)
            for key, entry in document.items()
            if isinstance(entry, dict)
            and entry.get("litellm_provider") == listing.vendor
            and (key == model or (listing.vendor == "anthropic" and _DATED.sub("", key) == model))
        )
        if not entries:
            notes.append(f"{model}: not listed there")
            continue
        compared += 1
        tiers = [("", "", listing.rates)]
        if listing.long is not None:
            tiers.append(
                (
                    f"_above_{listing.long_prompt // 1000}k_tokens",
                    f" over {listing.long_prompt} prompt tokens",
                    listing.long,
                )
            )
        for key, entry in entries:
            for suffix, length, rates in tiers:
                for kind in table.PRICED_KINDS:
                    field = (
                        _LITELLM_FIELDS[kind].format(longer=_LONGER_CACHE[listing.vendor]) + suffix
                    )
                    ours = getattr(rates, kind)
                    theirs = entry.get(field)
                    if isinstance(theirs, bool) or not isinstance(theirs, int | float):
                        if ours is not None:
                            notes.append(f"{model} {kind}{length}: {key} lists no {field}")
                        continue
                    theirs = theirs * 1_000_000
                    if ours is None or not math.isclose(ours, theirs, rel_tol=1e-9, abs_tol=1e-12):
                        differences.append(
                            f"{model} {kind}{length}: Valkama {_per_million(ours)},"
                            f" LiteLLM ({key}) {_per_million(theirs)}"
                        )
            for field in sorted(entry):
                match = _LITELLM_LONG.fullmatch(field)
                if match and int(match.group(1)) * 1000 != listing.long_prompt:
                    differences.append(
                        f"{model}: LiteLLM ({key}) prices prompts over {match.group(1)}k"
                        " tokens apart, and Valkama has no long prices at that length"
                    )
    return PriceComparison(differences, notes, compared)


def check_prices(
    fetch: Callable[[], Mapping[str, object]] = fetch_price_list,
    table: ModuleType | None = None,
) -> list[str]:
    """The price stage: the lines to print when it passes, or a refusal naming each difference."""

    found = compare_prices(table or price_table(), fetch())
    if not found.compared:
        # An empty answer or a list in another shape would otherwise pass with every
        # model "not listed there".
        raise PriceCheckError(
            f"release check: {LITELLM_PRICES} lists none of the table's models, so it is"
            " not the price list this check reads. No price was compared."
        )
    if found.differences:
        listed = "\n".join(f"  - {line}" for line in (*found.differences, *found.notes))
        raise PriceCheckError(
            f"release check: {len(found.differences)} price(s) differ from LiteLLM's list at"
            f" {LITELLM_PRICES}:\n{listed}\n"
            "Check each against the vendor's own pricing page before changing"
            " server/telemetry/usage_prices.py: the page decides, not this list."
        )
    return [
        f"release check: the prices of {found.compared} model(s) agree with {LITELLM_PRICES}",
        *found.notes,
    ]


def source_files() -> list[Path]:
    files = []
    for parent, directories, names in os.walk(ROOT):
        directories[:] = sorted(name for name in directories if name not in SKIP_DIRS)
        for name in sorted(names):
            path = Path(parent) / name
            if path.is_file() and not path.is_symlink() and not name.endswith((".pyc", ".log")):
                files.append(path)
    return files


def write_source_archive(
    target: Path, root: Path, files: list[Path], commit: str, version: str
) -> None:
    """Write `files` of `root` as the source archive, with the record that installs it.

    The archive has no Git history, so the record names the commit it was built
    from and the digest of each file it holds; `launcher install` run in the
    unpacked directory checks those and pins that commit.
    """

    record = source_archive()
    digests: dict[str, str] = {}

    def entry(name: str) -> zipfile.ZipInfo:
        item = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        item.compress_type = zipfile.ZIP_DEFLATED
        item.external_attr = 0o644 << 16
        return item

    try:
        with zipfile.ZipFile(
            target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
        ) as archive:
            for path in files:
                relative = path.relative_to(root).as_posix()
                data = path.read_bytes()
                digests[relative] = hashlib.sha256(data).hexdigest()
                archive.writestr(entry(relative), data)
            archive.writestr(entry(record.RECORD), record.record(commit, version, digests))
    except BaseException:
        # A half-written archive is not an asset.
        target.unlink(missing_ok=True)
        raise


def copy_dist_sources(root: Path, files: list[Path], copy: Path) -> Path:
    """Copy the files of `root` that `npm run dist` reads into `copy`; return its desktop package.

    Those are `desktop/` and, beside it, `windows/`: electron-builder's config in
    `desktop/package.json` names the icon `../windows/valkama.ico`, so the two stay
    siblings. `files` is the source archive's list, which holds no `node_modules`
    and no `release` output, so the installer is built from what the archive
    ships. Build runs in a snapshot without Git, where `copy_sources` cannot list.
    """

    copy.mkdir(parents=True)
    for path in files:
        relative = path.relative_to(root)
        if relative.parts[0] in DIST_PACKAGES:
            target = copy / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
    return copy / "desktop"


def build(assets: Path, expected: str, work_dir: Path, commit: str) -> None:
    """Write the source archive from `ROOT` and build the installer from a copy in `work_dir`.

    `ROOT` is Release Kit's snapshot, and Release Kit removes from it only what it
    wrote itself, so an install there left the desktop `node_modules` behind after
    every preparation. The install and the build run in `work_dir`, which Release
    Kit discards whole after a run that succeeded and keeps after one that failed,
    as the diagnostic; build therefore leaves the copy to it.
    """

    require_version(expected)
    if sys.platform != "win32":
        raise RuntimeError("Windows NSIS build requires Windows")
    if assets.exists() and any(assets.iterdir()):
        raise ValueError("release asset directory must be empty")
    assets.mkdir(parents=True, exist_ok=True)
    source = assets / f"valkama-{expected}-source.zip"
    files = source_files()
    write_source_archive(source, ROOT, files, commit, expected)
    desktop = copy_dist_sources(ROOT, files, work_dir / "desktop-sources")
    sys.stdout.write(f"release build: npm ci, in a copy of the desktop sources, {desktop}\n")
    sys.stdout.flush()
    subprocess.run((NPM, "ci"), cwd=desktop, check=True)
    sys.stdout.write("release build: npm run dist\n")
    sys.stdout.flush()
    build_output = work_dir / "desktop-build"
    subprocess.run(
        (NPM, "run", "dist", "--", f"--config.directories.output={build_output}"),
        cwd=desktop,
        check=True,
    )
    installer_name = f"Valkama Setup {expected}.exe"
    installer = build_output / installer_name
    if not installer.is_file():
        raise FileNotFoundError(installer)
    published_installer = f"Valkama-Setup-{expected}.exe"
    shutil.copyfile(installer, assets / published_installer)
    lines = [
        f"{hashlib.sha256((assets / name).read_bytes()).hexdigest()}  {name}"
        for name in (source.name, published_installer)
    ]
    (assets / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")


def smoke_mcp(source: Path, state: Path, environment: dict[str, str], expected: str) -> str:
    """The version the MCP server of the sources in `source` reports, both handshakes checked.

    It creates a space with a Unicode name through the planning tools and reads it
    back, in the store under `state`. The suite runs it on the checkout as well, so
    a request the tools no longer take fails a test instead of the release smoke.
    """

    meta = {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}
    label = "Проверка 漢字"
    messages = [
        {"jsonrpc": "2.0", "id": 1, "method": "server/discover", "params": {"_meta": meta}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {"_meta": meta}},
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "_meta": meta,
                "name": "create_planning_space",
                "arguments": {"name": label, "key": "REL"},
            },
        },
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {"_meta": meta, "name": "list_planning_spaces", "arguments": {}},
        },
    ]
    request = (
        b"\n".join(json.dumps(message, ensure_ascii=False).encode("utf-8") for message in messages)
        + b"\n"
    )
    output = run(
        sys.executable, "valkama.py", "mcp", cwd=source, env=environment, input_bytes=request
    )
    answers = [json.loads(line) for line in output.decode("utf-8", errors="strict").splitlines()]
    if [answer.get("id") for answer in answers] != [1, 2, 3, 4]:
        raise ValueError("MCP did not answer every release smoke request")
    reported = answers[0]["result"]["_meta"]["io.modelcontextprotocol/serverInfo"]["version"]
    if not reported.startswith(expected + "+"):
        raise ValueError("MCP release version differs from candidate")
    if not any(tool["name"] == "create_planning_space" for tool in answers[1]["result"]["tools"]):
        raise ValueError("MCP tool catalogue is incomplete")
    for answer in answers[2:]:
        if answer["result"].get("isError"):
            raise ValueError(f"MCP call failed: {answer['result']}")
    if label not in json.dumps(answers[3], ensure_ascii=False):
        raise ValueError("Unicode Planning name did not survive MCP write and read")
    if not (state / "valkama.sqlite3").is_file():
        raise ValueError("MCP did not use the isolated smoke store")
    legacy = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {"protocolVersion": "2025-11-25"},
    }
    legacy_output = run(
        sys.executable,
        "valkama.py",
        "mcp",
        cwd=source,
        env=environment,
        input_bytes=json.dumps(legacy).encode("utf-8") + b"\n",
    )
    legacy_answer = json.loads(legacy_output.decode("utf-8", errors="strict"))
    if legacy_answer["result"]["protocolVersion"] != "2025-11-25":
        raise ValueError("legacy MCP handshake differs from the release contract")
    if not legacy_answer["result"]["serverInfo"]["version"].startswith(expected + "+"):
        raise ValueError("legacy MCP release version differs from candidate")
    return reported


def smoke(assets: Path, expected: str, work_dir: Path, commit: str) -> None:
    require_version(expected)
    record = source_archive()
    names = {f"valkama-{expected}-source.zip", f"Valkama-Setup-{expected}.exe", "SHA256SUMS"}
    if {path.name for path in assets.iterdir()} != names:
        raise ValueError("release asset set differs from the declared set")
    source = assets / f"valkama-{expected}-source.zip"
    installer = assets / f"Valkama-Setup-{expected}.exe"
    if installer.stat().st_size < 1_000_000 or installer.read_bytes()[:2] != b"MZ":
        raise ValueError("desktop installer is missing or not a Windows executable")
    lines = (assets / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
    want = [
        f"{hashlib.sha256((assets / name).read_bytes()).hexdigest()}  {name}"
        for name in (source.name, installer.name)
    ]
    if lines != want:
        raise ValueError("release checksums do not match the candidate files")
    extracted = work_dir / "source"
    if extracted.exists():
        raise ValueError("smoke workspace must be fresh")
    extracted.mkdir(parents=True)
    with zipfile.ZipFile(source) as archive:
        archived = {item.filename for item in archive.infolist()}
        expected_files = {path.relative_to(ROOT).as_posix() for path in source_files()}
        if archived != expected_files | {record.RECORD}:
            raise ValueError("source archive differs from the Git-free source snapshot")
        if any(
            path.startswith((".git/", ".private/", ".state/", "tmp/", "node_modules/"))
            or "/node_modules/" in path
            for path in archived
        ):
            raise ValueError("source archive contains private or runtime state")
        for item in archive.infolist():
            target = (extracted / item.filename).resolve()
            if not target.is_relative_to(extracted.resolve()):
                raise ValueError("source archive escapes smoke workspace")
        archive.extractall(extracted)
    # What `launcher install` checks in an unpacked archive, against the candidate.
    described = record.verify(extracted)
    if (described.commit, described.version) != (commit, expected):
        raise ValueError("source archive record names another commit or version")
    if set(described.files) != expected_files:
        raise ValueError("source archive record lists other files than the archive holds")
    if (extracted / "VERSION").read_text(encoding="utf-8").strip() != expected:
        raise ValueError("source archive version differs")
    if not (extracted / "web/dist/index.html").is_file():
        raise ValueError("source archive lacks the built web UI")
    if not (extracted / "windows/install-desktop.ps1").is_file():
        raise ValueError("source archive lacks desktop installation support")
    state = work_dir / "user-state"
    environment = isolated_environment(state)
    capabilities = json.loads(
        run(sys.executable, "valkama.py", "capabilities", cwd=extracted, env=environment).decode(
            "utf-8", errors="strict"
        )
    )
    if (
        capabilities["component"] != "valkama"
        or capabilities["interfaces"]["mcp"]["modern_protocol"] != "2026-07-28"
    ):
        raise ValueError("source CLI capabilities differ from the release contract")
    runtime = json.loads(
        run(sys.executable, "valkama.py", "runtime", cwd=extracted, env=environment).decode(
            "utf-8", errors="strict"
        )
    )
    dist = extracted / "web/dist"
    static_entries = [
        {
            "path": path.relative_to(dist).as_posix(),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        for path in sorted(dist.rglob("*"), key=lambda item: str(item).casefold())
        if path.is_file()
    ]
    static_digest = hashlib.sha256(
        json.dumps(
            static_entries, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()
    if runtime["static"]["sha256"] != static_digest:
        raise ValueError("CLI runtime static digest differs from archived UI bytes")
    reported = smoke_mcp(extracted, state, environment, expected)
    sys.stdout.write(
        f"release smoke: source CLI/MCP, Unicode and {reported}; installer structure verified\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "prices", "build", "smoke"))
    parser.add_argument("--assets", type=Path)
    parser.add_argument("--version")
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--commit", help="the commit the release is built from")
    args = parser.parse_args()
    if args.action == "check":
        try:
            check()
        except ToolchainError as error:
            sys.exit(str(error))
    elif args.action == "prices":
        try:
            lines = check_prices()
        except PriceCheckError as error:
            sys.exit(str(error))
        sys.stdout.write("".join(f"{line}\n" for line in lines))
    elif args.assets is None or args.version is None or args.commit is None:
        parser.error("build and smoke require --assets, --version and --commit")
    elif args.action == "build":
        if args.work_dir is None:
            parser.error("build requires --work-dir")
        build(args.assets, args.version, args.work_dir, args.commit)
    elif args.work_dir is None:
        parser.error("smoke requires --work-dir")
    else:
        smoke(args.assets, args.version, args.work_dir, args.commit)


if __name__ == "__main__":
    main()
