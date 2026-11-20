"""Name the test modules a change reaches, and run them.

    python tests/affected.py [RANGE | --staged] [--list] [--why]

RANGE is what `git diff` takes, such as `HEAD~1..HEAD` after a commit; `--staged`
reads the index; with neither, the working tree against `HEAD`, untracked files
included. Without `--list` the modules run in one `python -m unittest` from the
repository root and the exit code is its own.

A test module is reached when:

- it imports a changed module of `server/` or `tests/`, directly or through
  other modules. The import graph is grimp's, the one `lint-imports` checks, and
  it is built from the working tree, so for an old range it is today's graph. A
  changed package `__init__` reaches whatever imports any module under it,
  because every such import runs it;
- it, or a helper under `tests/` it imports, names a changed file that is not
  in the graph (a document, a fixture, `valkama.py`, a deleted module): by its
  repository path anywhere in its text, by a string that ends in the file's name,
  or by a string that is the file's directory, two levels deep or more, which is
  how a test that reads every file of a directory names it. Path parts joined
  with `/` or `,` between strings count as one string;
- it is one of `SURFACES`, which run on every change under `server/`.

A change under `web/`, other than `web/dist`, is printed as the command that covers it,
`npx vitest related`, which follows the web's own module graph; this script does
not run node. Browser specs are not selected at all: they are chosen by what
they premise, a route, a fixture or a page helper, not by what they import. Nor
does this replace the gates a stage or a release runs: it is the targeted run
between commits.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import grimp

from server import processes

#: The packages of the graph: the server and its tests, as `[tool.importlinter]`
#: names the first. `valkama.py` is a module of its own that grimp does not take,
#: so it is reached by name.
PACKAGES = ("server", "tests")

#: Modules that hold a whole surface of the server against a list of their own,
#: so an addition anywhere under `server/` turns them red whatever it imports.
SURFACES: Mapping[str, str] = {
    "tests.test_planning_work_model_surfaces": (
        "holds every MCP tool, planning HTTP path, exact-space path and streamed view"
        " to the calls it makes"
    ),
    "tests.test_planning_api": (
        "holds every declared planning HTTP path to its own list, and an exact read's"
        " full record to the fields it always had"
    ),
    "tests.test_web_contract_fixtures": (
        "holds every answer the web reads to the fixtures committed under web/tests/fixtures/server"
    ),
    "tests.test_planning_label_edits": (
        "holds every history action the server writes to the list the web's card reads"
    ),
}

WEB = "web/"
WEB_BUILD = "web/dist/"
_JOINED = re.compile(r"[\"']\s*[/,]\s*[\"']")
_STRING = re.compile(r"\"([^\"\\\n]*)\"|'([^'\\\n]*)'")


def is_test_module(module: str) -> bool:
    return module.startswith("tests.") and module.rsplit(".", 1)[-1].startswith("test_")


def changed_files(revisions: str | None, *, staged: bool) -> list[str]:
    """The repository paths a range, the index or the working tree changes.

    A rename is its two paths, so the old name still reaches what named it.
    """

    diff = ["diff", "--name-only", "--no-renames", "-z"]
    if staged:
        found = [_git(*diff, "--cached")]
    elif revisions:
        found = [_git(*diff, revisions)]
    else:
        found = [_git(*diff, "HEAD"), _git("ls-files", "--others", "--exclude-standard", "-z")]
    return sorted({path for listing in found for path in listing.split("\0") if path})


def _git(*arguments: str) -> str:
    result = processes.run_text(["git", "-C", str(ROOT), *arguments])
    if result.returncode != 0:
        raise SystemExit(f"git {' '.join(arguments)}: {result.stderr.strip()}")
    return result.stdout


def build_graph() -> grimp.ImportGraph:
    return grimp.build_graph(*PACKAGES, cache_dir=None)


def test_sources(root: Path = ROOT) -> dict[str, str]:
    """Every Python file under `tests/`, by repository path, with its text."""

    return {
        path.relative_to(root).as_posix(): path.read_text(encoding="utf-8")
        for path in sorted((root / "tests").rglob("*.py"))
        if "__pycache__" not in path.parts
    }


def module_of(path: str) -> str | None:
    """The module a Python path of the graph's packages is, or None."""

    pure = PurePosixPath(path)
    if pure.suffix != ".py" or pure.parts[0] not in PACKAGES:
        return None
    parts = list(pure.with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


class _Naming:
    """What one source names: its text, and its strings with joined parts joined."""

    def __init__(self, text: str) -> None:
        self.text = text
        strings: set[str] = set()
        for source in (text, _JOINED.sub("/", text)):
            for match in _STRING.finditer(source):
                strings.add(match.group(1) if match.group(1) is not None else match.group(2))
        self.strings = {value.rstrip("/") for value in strings}
        self.tails = {value.rsplit("/", 1)[-1] for value in self.strings}

    def names(self, path: str) -> bool:
        pure = PurePosixPath(path)
        directory = pure.parent.as_posix()
        return (
            pure.name in self.tails
            or (directory.count("/") >= 1 and directory in self.strings)
            or (
                path in self.text
                and re.search(rf"(?<![\w./-]){re.escape(path)}(?![\w-]|\.\w)", self.text)
                is not None
            )
        )


def select(
    changed: Iterable[str],
    graph: grimp.ImportGraph,
    sources: Mapping[str, str],
) -> dict[str, str]:
    """Each test module the change reaches, with the first reason found for it."""

    chosen: dict[str, str] = {}

    def take(modules: Iterable[str], reason: str) -> None:
        for module in sorted(modules):
            if is_test_module(module):
                chosen.setdefault(module, reason)

    named: list[str] = []
    touches_server = False
    for path in changed:
        touches_server = touches_server or path.startswith("server/")
        module = module_of(path)
        if module is None or module not in graph.modules:
            named.append(path)
            continue
        take([module], f"changed: {path}")
        for target in sorted({module} | graph.find_descendants(module)):
            take(graph.find_downstream_modules(target), f"imports {target}")

    if named:
        namings = {path: _Naming(text) for path, text in sources.items()}
        for path in named:
            for source, naming in namings.items():
                holder = module_of(source)
                if holder is None or holder not in graph.modules or not naming.names(path):
                    continue
                take([holder], f"names {path}")
                take(graph.find_downstream_modules(holder), f"imports {holder}, which names {path}")

    if touches_server:
        for module, why in SURFACES.items():
            chosen.setdefault(module, f"surface: {why}")
    return dict(sorted(chosen.items()))


def web_command(changed: Iterable[str]) -> list[str]:
    """The web's own command for the changed web sources, run from `web/`; empty when none."""

    files = sorted(
        path[len(WEB) :]
        for path in changed
        if path.startswith(WEB) and not path.startswith(WEB_BUILD) and (ROOT / path).is_file()
    )
    return ["npx", "vitest", "related", "--run", "--maxWorkers=2", *files] if files else []


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python tests/affected.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    where = parser.add_mutually_exclusive_group()
    where.add_argument("range", nargs="?", help="a range git diff takes, such as HEAD~1..HEAD")
    where.add_argument("--staged", action="store_true", help="the index against HEAD")
    parser.add_argument("--list", action="store_true", help="name the modules, run nothing")
    parser.add_argument("--why", action="store_true", help="give each module its reason")
    options = parser.parse_args(argv)

    changed = changed_files(options.range, staged=options.staged)
    chosen = select(changed, build_graph(), test_sources())
    command = web_command(changed)
    sys.stdout.writelines(
        f"{module}  # {reason}\n" if options.why else f"{module}\n"
        for module, reason in chosen.items()
    )
    if command:
        sys.stderr.write(f"web: from web/ run {' '.join(command)}\n")
    sys.stderr.write(f"{len(chosen)} test modules for {len(changed)} changed files\n")
    sys.stdout.flush()
    if options.list or not chosen:
        return 0
    return subprocess.run(
        [sys.executable, "-m", "unittest", *chosen], cwd=ROOT, check=False
    ).returncode


if __name__ == "__main__":
    sys.exit(main())
