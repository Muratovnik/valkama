"""Build and verify the source and Windows desktop release pair.

Release Kit runs build and smoke from a committed, Git-free source snapshot.
The desktop installer is a window for the source service, not a bundled server.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NPM = "npm.cmd" if sys.platform == "win32" else "npm"
SKIP_DIRS = frozenset(
    {".git", ".cache", ".private", ".state", "tmp", "node_modules", "release", "__pycache__"}
)


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


def isolated_environment(state: Path) -> dict[str, str]:
    state.mkdir()
    for name in ("local", "roaming", "temp", "claude-sessions", "codex-rollouts", "documents"):
        (state / name).mkdir()
    environment = os.environ.copy()
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


def check() -> None:
    require_version(version())
    stages = [
        ((sys.executable, "-m", "ruff", "check", "."), ROOT),
        ((sys.executable, "-m", "ruff", "format", "--check", "."), ROOT),
        (("typos",), ROOT),
        (
            (
                "vulture",
                "server",
                "tests",
                "valkama.py",
                "vulture_whitelist.py",
                "--min-confidence",
                "60",
            ),
            ROOT,
        ),
        (("mypy",), ROOT),
        (("lint-imports", "--cache-dir", ".cache/import-linter"), ROOT),
        (
            (
                "semgrep",
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
            (
                sys.executable,
                "-m",
                "coverage",
                "run",
                "-m",
                "unittest",
                "discover",
                "-s",
                ".",
                "-p",
                "test_*.py",
            ),
            ROOT,
        ),
        ((sys.executable, "-m", "coverage", "report"), ROOT),
        ((NPM, "test"), ROOT / "web"),
        ((NPM, "run", "typecheck"), ROOT / "web"),
        ((NPM, "run", "build"), ROOT / "web"),
        ((NPM, "test"), ROOT / "desktop"),
    ]
    for command, cwd in stages:
        sys.stdout.write(f"release check: {' '.join(command)}\n")
        sys.stdout.flush()
        # Gate output is not parsed; inherit pipes to preserve the tool's text.
        if command[1:4] == ("-m", "coverage", "run"):
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
                environment = isolated_environment(Path(task) / "user-state")
                environment["GIT_CEILING_DIRECTORIES"] = task
                subprocess.run(command, cwd=cwd, env=environment, check=True)
        elif command[0] == "semgrep" and sys.platform == "win32":
            # semgrep-core's native socketpair fails when its temporary socket
            # path is too long. Release coordinators often supply a deeply
            # nested TEMP; give only this process a short owned OS temp path.
            native_temp = (Path(os.environ["LOCALAPPDATA"]) / "Temp").resolve()
            task_parent = native_temp / "codex"
            if task_parent.resolve().parent != native_temp:
                raise ValueError("Semgrep workspace must stay inside the OS temporary directory")
            task_parent.mkdir(exist_ok=True)
            with tempfile.TemporaryDirectory(prefix="sg-", dir=task_parent) as task:
                environment = {**os.environ, "TEMP": task, "TMP": task, "TMPDIR": task}
                subprocess.run(command, cwd=cwd, env=environment, check=True)
        else:
            subprocess.run(command, cwd=cwd, check=True)


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
    parser.add_argument("action", choices=("check", "build", "smoke"))
    parser.add_argument("--assets", type=Path)
    parser.add_argument("--version")
    parser.add_argument("--work-dir", type=Path)
    args = parser.parse_args()
    if args.action == "check":
        check()
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
