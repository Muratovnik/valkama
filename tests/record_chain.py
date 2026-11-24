"""Accept the checks of a tree from a chain of run records, each step where nothing it reads changed.

    python tests/run_record.py check RECORD RECORD ... [--tree DIR] [--require NAME ...]

One record holds the checks of one state of a tree. A commit after it that
changes a document leaves the lint, unit and browser runs of that record as
true as they were, since it changed nothing they read, and running them again is
a cost with no evidence in it. A chain is several records: at least one made in
the tree as it is now, as `check` accepts a single record, and earlier ones made
at commits the tree's HEAD descends from, in this worktree or in another of the
repository. What a step ran on is fixed by the commit and the content of the
uncommitted paths its record names, not by which checkout held them, so a branch's records still
speak for its steps after a merge whose other side changed none of their inputs.

A step of an earlier record counts when no path that differs between the state
it ran on and the tree as it is now is an input of it. A step a path touched
counts only through a record where the same step is untouched, and is refused
otherwise, naming the step and the path. What a step reads, conservatively:

- `typos`, `tests/commit_subjects.py` and the release audit read every file or
  every commit, and so does a step not placed below: they count only from a
  record made in the tree as it is now;
- a unittest run (`-m unittest`, `tests/parallel.py`, `tests/affected.py`,
  `coverage run`) reads, test module by test module, what `tests/affected.py`
  reaches; a module a change reaches counts again from a run of it that the
  change does not reach, so a whole suite is carried by targeted reruns;
- `coverage report` reads every Python file and whatever reaches a test module;
  ruff, mypy, vulture and lint-imports the Python files; semgrep `server/` and
  `valkama.py`;
- an npm, npx or node command run in `web/` reads everything under `web/` but
  `web/dist`, and every file a source there names; the browser suite
  (`test:browser`, `playwright`) reads everything under `web/` but `web/dist`,
  `server/`, `valkama.py`, which its configuration serves, and the files outside
  them its sources read (`BROWSER_READS`);
- a path outside `web/`, `server/`, `tests/`, `docs/`, `.agents/`, `valkama.py`
  and the Markdown files at the top is not placed, and is an input of every step.

The same step is the same command in the same directory, by its words after the
program, and for the browser runner also by the specs its list file named when
`run` ran it. An earlier record made on uncommitted changes counts with the paths
it names with their content: a path differs since when its content now is not
the one the run read. One that names none, as a record made before this check
does, or whose run changed the tree itself, cannot be placed and is refused. The order the records are given in does not
matter: of two that both carry a step, the newer one's run of it decides.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from server import git_worktrees, processes
from tests import affected, run_record

#: What a step is, for what it reads.
NEWEST = "newest"
UNITS = "unittest"
COVERAGE = "coverage"
PYTHON = "python"
SEMGREP = "semgrep"
WEB = "web"
BROWSER = "browser"

#: Directories whose every path is placed, and the paths at the top that are.
PLACED_DIRECTORIES = ("web/", "server/", "tests/", "docs/", ".agents/")
WEB_BUILD = "web/dist/"
#: Files outside `web/` and `server/` the browser suite reads: the server its
#: configuration starts. `tests/test_record_chain.py` holds every path a browser
#: source climbs out of `web/` to either to this list or to a path not placed.
BROWSER_READS = ("valkama.py",)

#: unittest's own flags that change what it prints, not which tests run.
_QUIET_FLAGS = frozenset(
    {"-v", "-q", "-f", "-b", "-c", "--verbose", "--quiet", "--failfast", "--catch", "--buffer"}
)
_MODULE_LINE = re.compile(r"^(tests(?:\.\w+)+)(?:\s+#.*)?$")
_SELECTED = re.compile(r"^(\d+) test modules for \d+ changed files$", re.MULTILINE)


def placed(path: str) -> bool:
    """Whether a rule here says which steps read `path`."""

    top = "/" not in path
    return (
        path.startswith(PLACED_DIRECTORIES)
        or path == "valkama.py"
        or (top and path.endswith(".md"))
    )


@dataclass(frozen=True)
class Placement:
    """What one step is: its kind, and for a unittest run the tests it ran, None for all."""

    kind: str
    units: frozenset[str] | None = None


def module_of(unit: str) -> str | None:
    """The test module a test id is in: `tests.test_x` of `tests.test_x.Case.test_y`."""

    parts = unit.split(".")
    for index, part in enumerate(parts):
        if index and part.startswith("test_"):
            return ".".join(parts[: index + 1])
    return None


def _unit(word: str) -> str | None:
    if word.endswith(".py"):
        word = word[:-3].replace("\\", "/").replace("/", ".")
    return word if word.startswith("tests.") and module_of(word) is not None else None


def _units(words: Sequence[str]) -> frozenset[str] | bool | None:
    """The test ids words name, None for every test module, or False when they cannot be read."""

    found: set[str] = set()
    for word in words:
        unit = _unit(word)
        if unit is None:
            return False
        found.add(unit)
    return frozenset(found) if found else None


def _unittest(arguments: Sequence[str]) -> frozenset[str] | bool | None:
    words = [word for word in arguments if word not in _QUIET_FLAGS]
    if words[:1] == ["discover"]:
        # Only the discovery the gates spell runs the whole suite.
        rest = words[1:]
        pairs = dict(zip(rest[::2], rest[1::2], strict=False))
        default = {"-s": ".", "-p": "test_*.py", "-t": "."}
        whole = len(rest) % 2 == 0 and all(default.get(k) == v for k, v in pairs.items())
        return None if whole else False
    if any(word.startswith("-") for word in words):
        return False
    return _units(words)


def _parallel(arguments: Sequence[str]) -> frozenset[str] | bool | None:
    words: list[str] = []
    skip = False
    for word in arguments:
        if skip:
            skip = False
        elif word in ("--jobs", "--run"):
            skip = True
        elif word.startswith(("--jobs=", "--run=")) or word == "--coverage":
            continue
        elif word.startswith("-"):
            return False
        else:
            words.append(word)
    return _units(words)


def _selected(log: Path) -> frozenset[str] | bool:
    """The modules a run of `tests/affected.py` named in its log, or False when it does not say."""

    try:
        text = log.read_bytes().decode("utf-8", errors="replace").replace("\r\n", "\n")
    except OSError:
        return False
    said = _SELECTED.findall(text)
    found = {
        match.group(1)
        for line in text.splitlines()
        if (match := _MODULE_LINE.match(line.strip())) and module_of(match.group(1))
    }
    return frozenset(found) if said and int(said[-1]) == len(found) else False


def _word(argument: str) -> str:
    return re.split(r"[\\/]", argument)[-1]


def _argv(entry: Mapping[str, object]) -> list[str]:
    found = entry.get("argv")
    return [str(word) for word in found] if isinstance(found, list) else []


def place(entry: Mapping[str, object], worktree: str, logs: Path) -> Placement:
    """What a recorded step reads, from its command, where it ran, and for some its log."""

    argv = _argv(entry)
    if not argv:
        return Placement(NEWEST)
    program = _word(argv[0]).lower().rsplit(".", 1)[0]
    arguments = argv[1:]
    if program.startswith("python"):
        if arguments[:1] == ["-m"] and len(arguments) > 1:
            tool, arguments = arguments[1], arguments[2:]
        elif arguments:
            tool, arguments = _word(arguments[0]), arguments[1:]
        else:
            return Placement(NEWEST)
    else:
        tool = program
    units: frozenset[str] | bool | None = False
    if tool == "unittest":
        units = _unittest(arguments)
    elif tool == "parallel.py":
        units = _parallel(arguments)
    elif tool == "affected.py" and "--list" not in arguments:
        units = _selected(logs / str(entry.get("log", "")))
    elif tool == "coverage" and arguments[:1] == ["report"]:
        return Placement(COVERAGE)
    elif tool == "coverage" and arguments[:1] == ["run"] and "-m" in arguments:
        after = arguments[arguments.index("-m") + 1 :]
        if after[:1] == ["unittest"]:
            units = _unittest(after[1:])
    elif tool in ("ruff", "mypy", "vulture", "lint-imports"):
        return Placement(PYTHON)
    elif tool == "semgrep":
        return Placement(SEMGREP)
    elif tool in ("npm", "npx", "node") and _directory(entry) == _web(worktree):
        browser = any("test:browser" in word or "playwright" in word for word in arguments)
        return Placement(BROWSER if browser else WEB)
    if isinstance(units, bool):
        return Placement(NEWEST)
    return Placement(UNITS, units)


def _directory(entry: Mapping[str, object]) -> str:
    return git_worktrees.canonical(str(entry.get("cwd", "")))


def _web(worktree: str) -> str:
    return git_worktrees.canonical(Path(worktree) / "web")


def identity(entry: Mapping[str, object], worktree: str) -> tuple[object, ...]:
    """The same step in two records: its words after the program, where it ran, the lists it read."""

    argv = _argv(entry)
    where = _directory(entry)
    root = git_worktrees.canonical(worktree)
    relative = where[len(root) :] if where.startswith(root) else where
    lists = entry.get("lists")
    named = tuple(
        sorted((str(key), tuple(value or ())) for key, value in lists.items())
        if isinstance(lists, dict)
        else ()
    )
    return (tuple(argv[1:]), relative.replace("\\", "/"), named)


class Reach:
    """Which test modules changed paths reach, as `tests/affected.py` selects them."""

    def __init__(self, select: Callable[[list[str]], Mapping[str, str]], modules: set[str]):
        self._select = select
        self.modules = modules

    def reached(self, paths: Iterable[str]) -> dict[str, str]:
        """Each test module the paths reach, with what reaches it."""

        chosen = sorted(set(paths))
        return dict(self._select(chosen)) if chosen else {}


class ReachRefusedError(Exception):
    """The test modules a change reaches cannot be read for this tree."""


def reach_for(top: str) -> Reach:
    """`tests/affected.py`'s selection in the tree at `top`, which must be this checkout.

    The import graph is built from the packages this process imports, which are
    this checkout's, so a tree of another checkout is checked by its own script.
    """

    if git_worktrees.canonical(top) != git_worktrees.canonical(affected.ROOT):
        raise ReachRefusedError(
            f"the test modules a change reaches are read from this checkout's import graph,"
            f" and {top} is another tree: check it with that tree's own tests/run_record.py"
        )
    graph = affected.build_graph()
    sources = affected.test_sources()
    modules = {module for module in graph.modules if affected.is_test_module(module)}
    return Reach(lambda paths: affected.select(paths, graph, sources), modules)


def _git(top: str, *arguments: str) -> list[str]:
    found = processes.run_text(["git", "-C", top, *arguments], errors="surrogateescape")
    if found.returncode != 0:
        raise OSError(f"git {' '.join(arguments)} failed in {top}: {found.stderr.strip()}")
    return [name for name in found.stdout.split("\0") if name]


def _ancestor(top: str, commit: str, head: str) -> bool:
    found = processes.run_text(["git", "-C", top, "merge-base", "--is-ancestor", commit, head])
    return found.returncode == 0


class Names:
    """Whether a tracked source under `web/`, `web/dist` aside, names a path."""

    def __init__(self, top: str) -> None:
        self._top = top
        self._naming: affected._Naming | None = None

    def names(self, path: str) -> bool:
        if self._naming is None:
            texts = []
            for name in _git(self._top, "ls-files", "-z", "web"):
                if name.startswith(WEB_BUILD):
                    continue
                try:
                    texts.append((Path(self._top) / name).read_bytes().decode("utf-8", "ignore"))
                except OSError:
                    continue
            self._naming = affected._Naming("\n".join(texts))
        return self._naming.names(path)


def _in_web(path: str) -> bool:
    return path.startswith("web/") and not path.startswith(WEB_BUILD)


def reads(kind: str, path: str, web_names: Names) -> bool:
    """Whether a step of `kind` reads `path`; a unittest run's paths are its modules'."""

    if kind == PYTHON:
        return path.endswith(".py")
    if kind == SEMGREP:
        return path.startswith("server/") or path == "valkama.py"
    if kind == WEB:
        return _in_web(path) or (not path.startswith("web/") and web_names.names(path))
    if kind == BROWSER:
        return _in_web(path) or path.startswith("server/") or path in BROWSER_READS
    return True


@dataclass
class Link:
    """One record of a chain: where it is, what it says, and what changed since it."""

    path: Path
    record: dict
    newest: bool
    changed: list[str] = field(default_factory=list)

    @property
    def tree(self) -> Mapping[str, object]:
        return self.record["tree"]

    @property
    def head(self) -> str:
        return str(self.tree.get("head", ""))

    def logs(self) -> Path:
        return self.path.parent / "logs"


@dataclass
class _Ran:
    """A unittest run's valid part: the tests it ran, None for all, and the modules it does not cover."""

    units: frozenset[str] | None
    excluded: frozenset[str]

    def covers(self, unit: str) -> bool:
        module = module_of(unit)
        if module in self.excluded:
            return False
        return self.units is None or any(
            unit == ran or unit.startswith(ran + ".") for ran in self.units
        )


def _links(paths: Sequence[Path], tree: Path) -> tuple[list[Link], list[str], dict]:
    current = run_record.tree_state(tree)
    links, refusals = [], []
    for given in paths:
        path = given / run_record.NAME if given.is_dir() else given
        record, why = run_record.read(path)
        if record is None:
            refusals.append(why)
            continue
        found = run_record.differences(record["tree"], current)
        links.append(Link(path, record, newest=not found))
    return links, refusals, current


def _place_earlier(link: Link, current: Mapping[str, object]) -> str | None:
    """Fill in what changed since an earlier record, or say why it cannot be placed."""

    top, head, tree = str(current["worktree"]), str(current["head"]), link.tree
    made = f"{link.path} was made at {link.head or 'no commit'} in {tree.get('worktree')}"
    if not link.head or not _ancestor(top, link.head, head):
        return f"{made}, which is not a commit this tree's HEAD {head} descends from"
    if link.record.get("changed_by_run"):
        return f"{made}, and the run it records changed the tree itself"
    listed = tree.get("paths")
    ran_on = (
        {str(name): str(blob) for name, blob in listed.items()} if isinstance(listed, dict) else {}
    )
    if tree.get("dirty") and not ran_on:
        return f"{made} on uncommitted changes it does not name"
    # A path differs from what the run read when it differs from the record's commit
    # and the run read the commit's, or from the content the record names for it.
    since = set(_git(top, "diff", "--name-only", "--no-renames", "-z", link.head))
    since |= set(_git(top, "ls-files", "-z", "--others", "--exclude-standard"))
    now = run_record.on_disk(
        Path(top), [name.encode("utf-8", "surrogateescape") for name in ran_on]
    )
    changed = {name for name in since if name not in ran_on}
    changed |= {
        name
        for name, blob in ran_on.items()
        if now[name.encode("utf-8", "surrogateescape")].decode("ascii") != blob
    }
    link.changed = sorted(changed)
    return None


def _order(links: list[Link]) -> list[Link]:
    """The newest first: records of the tree as it is now, then by when each finished."""

    by_finish = sorted(links, key=lambda link: str(link.record.get("finished", "")), reverse=True)
    return sorted(by_finish, key=lambda link: not link.newest)


def check(paths: Sequence[Path], tree: Path, required: Sequence[str] = ()) -> tuple[int, str]:
    """Whether a chain of records accepts `tree` as it is now, and what to say."""

    links, refusals, current = _links(paths, tree)
    if refusals:
        return run_record.REFUSED, "refused: " + "; ".join(refusals)
    if not current["head"]:
        return run_record.REFUSED, f"refused: {current['worktree']} is not a Git working tree"
    if not any(link.newest for link in links):
        why = "; ".join(
            f"{link.path}: " + "; ".join(run_record.differences(link.tree, current))
            for link in links
        )
        return run_record.REFUSED, f"refused: no record describes {tree} as it is now: {why}"
    for link in links:
        if not link.newest and (unplaced := _place_earlier(link, current)) is not None:
            return run_record.REFUSED, f"refused: {unplaced}"
    try:
        return _judge(_order(links), current, required)
    except ReachRefusedError as error:
        return run_record.REFUSED, f"refused: {error}"


def _judge(
    links: list[Link], current: Mapping[str, object], required: Sequence[str]
) -> tuple[int, str]:
    top = str(current["worktree"])
    web_names = Names(top)
    reach: Reach | None = None

    def reached(link: Link) -> dict[str, str]:
        nonlocal reach
        if reach is None:
            reach = reach_for(top)
        return reach.reached(path for path in link.changed if placed(path))

    # Each step as placed, and for an earlier record the path that touches it.
    plain: list[tuple[Link, Mapping[str, object], tuple[object, ...], str | None]] = []
    runs: list[tuple[Link, Mapping[str, object], _Ran, dict[str, str]]] = []
    for link in links:
        worktree = str(link.tree.get("worktree", ""))
        unplaced = next((path for path in link.changed if not placed(path)), None)
        for entry in link.record["steps"]:
            placement = place(entry, worktree, link.logs())
            if placement.kind == UNITS:
                runs.append((link, entry, *_touched_units(link, placement, unplaced, reached)))
                continue
            touched = _touched(link, placement.kind, unplaced, web_names, reached)
            plain.append((link, entry, (placement.kind, *identity(entry, worktree)), touched))

    problems: list[str] = []
    counting: list[tuple[Link, Mapping[str, object]]] = []
    valid = {key for _, _, key, touched in plain if touched is None}
    for link, entry, key, touched in plain:
        if touched is not None and key not in valid:
            problems.append(
                f"{link.path}: step {entry['name']} {touched}, and no record has it untouched"
            )
    decided: set[tuple[object, ...]] = set()
    for link in links:
        keys = {key for owner, _, key, touched in plain if owner is link and touched is None}
        for owner, entry, key, touched in plain:
            if owner is link and touched is None and key not in decided:
                counting.append((link, entry))
        decided |= keys

    valid_runs = [ran for _, _, ran, _ in runs if ran.units is None or ran.units]
    for link, entry, _, touched_units in runs:
        for unit, why in touched_units.items():
            if not any(ran.covers(unit) for ran in valid_runs):
                problems.append(
                    f"{link.path}: step {entry['name']} ran {unit}, which {why},"
                    " and no record ran it untouched"
                )
    covered: list[_Ran] = []
    for link in links:
        mine = [(entry, ran) for owner, entry, ran, _ in runs if owner is link]
        for entry, ran in mine:
            if not _superseded(ran, covered):
                counting.append((link, entry))
        covered += [ran for _, ran in mine]

    if problems:
        return run_record.REFUSED, "refused: " + "; ".join(problems)
    return _verdict(links, counting, required)


def _touched(
    link: Link,
    kind: str,
    unplaced: str | None,
    web_names: Names,
    reached: Callable[[Link], dict[str, str]],
) -> str | None:
    """What touches a step that is not a unittest run, or None when it counts."""

    if link.newest:
        return None
    since = f"since {link.head}"
    if kind == NEWEST:
        return (
            "reads every file or commit, so it counts only from a record of the tree as it is now"
        )
    if unplaced is not None:
        return f"may read {unplaced}, which changed {since} and which no rule places"
    if kind == COVERAGE:
        python = next((path for path in link.changed if path.endswith(".py")), None)
        if python is not None:
            return f"reads {python}, which changed {since}"
        module, why = next(iter(reached(link).items()), (None, ""))
        return None if module is None else f"reads {module}, which {why} {since}"
    path = next((path for path in link.changed if reads(kind, path, web_names)), None)
    return None if path is None else f"reads {path}, which changed {since}"


def _touched_units(
    link: Link,
    placement: Placement,
    unplaced: str | None,
    reached: Callable[[Link], dict[str, str]],
) -> tuple[_Ran, dict[str, str]]:
    """A unittest run's valid part, and each test it ran that a change reaches, with what reaches it."""

    if link.newest:
        return _Ran(placement.units, frozenset()), {}
    since = f"since {link.head}"
    if unplaced is not None:
        units = placement.units if placement.units is not None else frozenset({"tests"})
        why = f"{unplaced}, which no rule places, may reach {since}"
        return _Ran(frozenset(), frozenset()), dict.fromkeys(sorted(units), why)
    modules = reached(link)
    if placement.units is None:
        touched = {module: f"{why} {since}" for module, why in modules.items()}
    else:
        touched = {
            unit: f"{modules[module]} {since}"
            for unit in sorted(placement.units)
            if (module := module_of(unit)) in modules
        }
    return _Ran(placement.units, frozenset(modules)), touched


def _superseded(ran: _Ran, newer: list[_Ran]) -> bool:
    """Whether newer runs cover every test this run's valid part covers."""

    if ran.units is None:
        return any(other.units is None and other.excluded <= ran.excluded for other in newer)
    return all(
        any(other.covers(unit) for other in newer)
        for unit in ran.units
        if module_of(unit) not in ran.excluded
    )


def _verdict(
    links: list[Link], counting: list[tuple[Link, Mapping[str, object]]], required: Sequence[str]
) -> tuple[int, str]:
    def said(entry: Mapping[str, object]) -> str:
        return f"{entry['name']} exit={entry['exit']}" + (
            f" tests={entry['tests']}" if "tests" in entry else ""
        )

    lines = []
    for link in links:
        counts = [entry for owner, entry in counting if owner is link]
        mine = [said(entry) for entry in link.record["steps"] if any(entry is c for c in counts)]
        changed = len(link.changed)
        where = (
            "the tree as it is now"
            if link.newest
            else f"{changed} path{'' if changed == 1 else 's'} changed since,"
            " none an input of what counts"
        )
        lines.append(
            f"  {link.path} made in {link.tree.get('worktree')} at {link.head}, {where}:"
            f" {', '.join(mine) or 'nothing counts'}"
        )
    names = {str(entry["name"]) for _, entry in counting}
    missing = [name for name in dict.fromkeys(required) if name not in names]
    if missing:
        return run_record.REFUSED, (
            f"refused: no step that counts in the chain is named {', '.join(missing)},"
            " which this check requires; what counts:\n" + "\n".join(lines)
        )
    head = f"accepted: a chain of {len(links)} records, the newest at {links[0].head}:\n"
    failed = [
        str(entry["name"]) + (" (required)" if entry["name"] in required else "")
        for _, entry in counting
        if entry["exit"] != 0
    ]
    if not counting:
        failed = ["no step ran"]
    body = head + "\n".join(lines) + "\n"
    if failed:
        return run_record.FAILED, body + f"failed: {', '.join(failed)}"
    return run_record.PASSED, body + "passed"
