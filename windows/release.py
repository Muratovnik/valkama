"""Build and verify the source and Windows desktop release pair.

Release Kit runs build and smoke from a committed, Git-free source snapshot, and
check in the working tree of the main checkout, with whatever ignored
`node_modules` that holds. So check reinstalls both npm packages from their
lockfiles first: what it verifies is what the lockfile pins.
The desktop installer is a window for the source service, not a bundled server.

Release Kit runs every command here with its own interpreter as `{python}`, so
`check` takes its Python tools from that interpreter's environment and nowhere
else, and refuses before the first stage when that environment lacks one. Build
and smoke need no development tool: build runs npm, and smoke runs the server,
which imports only the standard library.

`prices` is a stage of `check`: it compares the server's price table with
LiteLLM's public price list, so a wrong or missing price is caught before a
release. The server itself makes no network call, so the comparison lives here.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
import re
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import urllib.request
import zipfile
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[1]
NPM = "npm.cmd" if sys.platform == "win32" else "npm"
#: The directories holding an npm package the gates run.
NPM_PACKAGES = ("web", "desktop")
SKIP_DIRS = frozenset(
    {".git", ".cache", ".private", ".state", "tmp", "node_modules", "release", "__pycache__"}
)
REQUIREMENTS = ROOT / "requirements-dev.txt"
_PIN = re.compile(r"([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9.+!_-]+)")
#: What pip names a console script: an `.exe` launcher on Windows, the bare name elsewhere.
_SCRIPT_SUFFIXES = (".exe",) if sys.platform == "win32" else ("",)


class ToolchainError(RuntimeError):
    """This environment cannot run the check, and the message says why; nothing has run yet."""


@dataclass(frozen=True)
class Tool:
    """A tool `check` runs: the distribution that pins it, and how it is started.

    `module` runs it as `python -m module`. A tool without one is the console
    script `script` from the interpreter's own scripts directory: typos and
    lint-imports have no runnable module, and `python -m semgrep` is refused
    by semgrep itself.
    """

    distribution: str
    module: str | None = None
    script: str | None = None


TOOLS: dict[str, Tool] = {
    "ruff": Tool("ruff", module="ruff"),
    "typos": Tool("typos", script="typos"),
    "vulture": Tool("vulture", module="vulture"),
    "mypy": Tool("mypy", module="mypy"),
    "lint-imports": Tool("import-linter", script="lint-imports"),
    "semgrep": Tool("semgrep", script="semgrep"),
    "coverage": Tool("coverage", module="coverage"),
}


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


def pins(text: str) -> dict[str, str]:
    """Every `name==version` in requirements-dev.txt; anything looser is refused."""

    found = {}
    for line in text.splitlines():
        requirement = line.split("#", 1)[0].strip()
        if not requirement:
            continue
        match = _PIN.fullmatch(requirement)
        if match is None:
            raise ValueError(f"requirements-dev.txt must pin exactly: {requirement}")
        found[match.group(1)] = match.group(2)
    return found


def _pin_problems(interpreter: Interpreter, pinned: Mapping[str, str]) -> list[str]:
    problems = []
    for distribution, wanted in pinned.items():
        installed = interpreter.version_of(distribution)
        if installed is None:
            problems.append(f"{distribution}: not installed; requirements-dev.txt pins {wanted}")
        elif installed != wanted:
            problems.append(
                f"{distribution}: {installed} installed; requirements-dev.txt pins {wanted}"
            )
    return problems


def require_toolchain(
    interpreter: Interpreter, pinned: Mapping[str, str]
) -> dict[str, tuple[str, ...]]:
    """How to start each tool from this interpreter, or one refusal naming everything missing.

    A console script is looked up in the interpreter's own scripts directory
    alone: a same-named one on PATH belongs to some other environment.
    """

    problems = _pin_problems(interpreter, pinned)
    commands: dict[str, tuple[str, ...]] = {}
    for name, tool in TOOLS.items():
        if tool.distribution not in pinned:
            problems.append(f"{name}: {tool.distribution} is not pinned in requirements-dev.txt")
        if tool.module is not None:
            commands[name] = (str(interpreter.executable), "-m", tool.module)
        elif tool.script is not None:
            found = _console_script(interpreter.scripts, tool.script)
            if found is not None:
                commands[name] = (str(found),)
            elif interpreter.version_of(tool.distribution) is not None:
                # A missing distribution is already reported; a missing script
                # beside an installed one is a broken install.
                problems.append(f"{name}: no {tool.script} console script in {interpreter.scripts}")
    if problems:
        listed = "\n".join(f"  - {problem}" for problem in problems)
        raise ToolchainError(
            f"release check: {interpreter.executable} does not hold the pinned gate"
            f" toolchain:\n{listed}\n"
            "Run the release with the project's virtual environment: create it and"
            " install the pins (uv venv .venv --python 3.11, then uv pip install"
            " --python .venv/Scripts/python.exe -r requirements-dev.txt; or"
            " python -m venv .venv, then .venv/Scripts/python -m pip install -r"
            " requirements-dev.txt), then run .venv/Scripts/python .github/relkit.pyz"
            " release prepare <version> (.venv/bin/python outside Windows)."
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

    environment = dict(base)
    key = next((name for name in environment if name.upper() == "PATH"), "PATH")
    rest = environment.get(key, "")
    environment[key] = os.pathsep.join(part for part in (str(interpreter.scripts), rest) if part)
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


def check(interpreter: Interpreter | None = None, requirements: str | None = None) -> None:
    """Run every gate, each Python tool from the interpreter running this file.

    The toolchain is verified against the pins before anything else, so a
    wrong interpreter is refused in one message instead of one stage at a time.
    `npm ci` runs ahead of the Python stages, though only the npm stages need it:
    a registry that cannot be reached then costs a minute and not the whole suite.
    """

    interpreter = interpreter or running_interpreter()
    if requirements is None:
        requirements = REQUIREMENTS.read_text(encoding="utf-8")
    tools = require_toolchain(interpreter, pins(requirements))
    for package in NPM_PACKAGES:
        target = linked_modules(ROOT / package)
        if target is not None:
            raise ToolchainError(
                f"release check: {ROOT / package / 'node_modules'} is a link to {target}, and"
                " npm ci through a link empties its target for every checkout sharing it."
                " Remove the link and run the check again."
            )
    require_version(version())
    base = tool_environment(interpreter, os.environ)
    stages: list[tuple[str, tuple[str, ...], Path]] = [
        *(("npm", (NPM, "ci"), ROOT / package) for package in NPM_PACKAGES),
        # Early for the reason `npm ci` is: a source that cannot be reached costs
        # seconds, not the whole suite.
        (
            "prices",
            (str(interpreter.executable), str(ROOT / "windows" / "release.py"), "prices"),
            ROOT,
        ),
        ("ruff", (*tools["ruff"], "check", "."), ROOT),
        ("ruff", (*tools["ruff"], "format", "--check", "."), ROOT),
        ("typos", tools["typos"], ROOT),
        (
            "vulture",
            (
                *tools["vulture"],
                "server",
                "tests",
                "valkama.py",
                "vulture_whitelist.py",
                "--min-confidence",
                "60",
            ),
            ROOT,
        ),
        ("mypy", tools["mypy"], ROOT),
        ("lint-imports", (*tools["lint-imports"], "--cache-dir", ".cache/import-linter"), ROOT),
        (
            "semgrep",
            (
                *tools["semgrep"],
                "scan",
                "--config",
                "p/python",
                "--config",
                "p/security-audit",
                "--metrics",
                "off",
                "--error",
                "server",
                "valkama.py",
            ),
            ROOT,
        ),
        (
            "coverage run",
            (*tools["coverage"], "run", "-m", "unittest", "discover", "-s", ".", "-p", "test_*.py"),
            ROOT,
        ),
        ("coverage", (*tools["coverage"], "report"), ROOT),
        ("npm", (NPM, "test"), ROOT / "web"),
        ("npm", (NPM, "run", "typecheck"), ROOT / "web"),
        ("npm", (NPM, "run", "build"), ROOT / "web"),
        ("npm", (NPM, "test"), ROOT / "desktop"),
    ]
    for stage, command, cwd in stages:
        sys.stdout.write(f"release check: {' '.join(command)}\n")
        sys.stdout.flush()
        # Gate output is not parsed; inherit pipes to preserve the tool's text.
        if stage == "coverage run":
            temp_root = (
                (Path(os.environ["LOCALAPPDATA"]) / "Temp").resolve()
                if sys.platform == "win32"
                else Path(tempfile.gettempdir()).resolve()
            )
            task_parent = temp_root / "codex"
            if task_parent.resolve().parent != temp_root:
                raise ValueError("check workspace must stay inside the temporary directory")
            task_parent.mkdir(exist_ok=True)
            with tempfile.TemporaryDirectory(prefix="valkama-check-", dir=task_parent) as task:
                environment = isolated_environment(Path(task) / "user-state", base)
                environment["GIT_CEILING_DIRECTORIES"] = task
                subprocess.run(command, cwd=cwd, env=environment, check=True)
        elif stage == "semgrep" and sys.platform == "win32":
            # semgrep-core's native socketpair fails when its temporary socket
            # path is too long. Release coordinators often supply a deeply
            # nested TEMP; give only this process a short owned OS temp path.
            native_temp = (Path(os.environ["LOCALAPPDATA"]) / "Temp").resolve()
            task_parent = native_temp / "codex"
            if task_parent.resolve().parent != native_temp:
                raise ValueError("Semgrep workspace must stay inside the OS temporary directory")
            task_parent.mkdir(exist_ok=True)
            with tempfile.TemporaryDirectory(prefix="sg-", dir=task_parent) as task:
                environment = {**base, "TEMP": task, "TMP": task, "TMPDIR": task}
                subprocess.run(command, cwd=cwd, env=environment, check=True)
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


def price_table() -> ModuleType:
    """The server's price table, loaded from its file as the server prices with it."""

    spec = importlib.util.spec_from_file_location(
        "valkama_usage_prices", ROOT / "server" / "telemetry" / "usage_prices.py"
    )
    if spec is None or spec.loader is None:
        raise PriceCheckError("release check: the server's price table cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    # A dataclass resolves its annotations through the module's sys.modules entry.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
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


def build(assets: Path, expected: str, work_dir: Path) -> None:
    require_version(expected)
    if sys.platform != "win32":
        raise RuntimeError("Windows NSIS build requires Windows")
    if assets.exists() and any(assets.iterdir()):
        raise ValueError("release asset directory must be empty")
    assets.mkdir(parents=True, exist_ok=True)
    source = assets / f"valkama-{expected}-source.zip"
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in source_files():
            relative = path.relative_to(ROOT).as_posix()
            item = zipfile.ZipInfo(relative, date_time=(2026, 1, 1, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o644 << 16
            archive.writestr(item, path.read_bytes())
    sys.stdout.write("release build: npm ci\n")
    sys.stdout.flush()
    subprocess.run((NPM, "ci"), cwd=ROOT / "desktop", check=True)
    sys.stdout.write("release build: npm run dist\n")
    sys.stdout.flush()
    build_output = work_dir / "desktop-build"
    subprocess.run(
        (NPM, "run", "dist", "--", f"--config.directories.output={build_output}"),
        cwd=ROOT / "desktop",
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


def smoke(assets: Path, expected: str, work_dir: Path) -> None:
    require_version(expected)
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
        if archived != expected_files:
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
                "arguments": {"project_id": "release", "name": label, "key": "REL"},
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
        sys.executable, "valkama.py", "mcp", cwd=extracted, env=environment, input_bytes=request
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
        cwd=extracted,
        env=environment,
        input_bytes=json.dumps(legacy).encode("utf-8") + b"\n",
    )
    legacy_answer = json.loads(legacy_output.decode("utf-8", errors="strict"))
    if legacy_answer["result"]["protocolVersion"] != "2025-11-25":
        raise ValueError("legacy MCP handshake differs from the release contract")
    if not legacy_answer["result"]["serverInfo"]["version"].startswith(expected + "+"):
        raise ValueError("legacy MCP release version differs from candidate")
    sys.stdout.write(
        f"release smoke: source CLI/MCP, Unicode and {reported}; installer structure verified\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "prices", "build", "smoke"))
    parser.add_argument("--assets", type=Path)
    parser.add_argument("--version")
    parser.add_argument("--work-dir", type=Path)
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
    elif args.assets is None or args.version is None:
        parser.error("build and smoke require --assets and --version")
    elif args.action == "build":
        if args.work_dir is None:
            parser.error("build requires --work-dir")
        build(args.assets, args.version, args.work_dir)
    elif args.work_dir is None:
        parser.error("smoke requires --work-dir")
    else:
        smoke(args.assets, args.version, args.work_dir)


if __name__ == "__main__":
    main()
