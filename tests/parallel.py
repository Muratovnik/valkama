"""Run test modules in several processes at once, with one verdict for all of them.

    python tests/parallel.py [--jobs N] [--coverage] [MODULE ...]

With no MODULE it runs the whole suite: every module `unittest discover -s . -p
"test_*.py"` finds, found the way discovery walks the `tests` package. Each
module runs in a process of its own, `python -m tests.parallel --worker`, which
imports the `tests` package first, as `python -m unittest tests.<module>` does:
so each has its own throwaway store, `LOCALAPPDATA` and global Git file, and no
module reads state another left in memory. At most `--jobs` of them run at once,
the longest first by the last run's times.

The verdict is unittest's, summed: every module's failures, errors and skips are
listed with the module, the closing lines are unittest's own (`Ran N tests in`,
then `OK` or `FAILED (...)`), and the exit code is 1 when any module failed or
errored. A process that ends without its report, killed or crashed, counts as an
error of its module, and so does one whose exit code disagrees with its report;
nothing is lost because a module took its process down. A module named twice
runs once.

The run takes a lease at the machine's heavy-process gate, through
`tests/heavy_gate.py`, as the kind `KIND` sized by its modules and wanting `--jobs`
processes at once, and runs as many as the share K the gate gives; unless a holder
started it, as `tests/isolated.py gates` does, whose lease gives it K the same way.
The run the gate starts is told so by `--gated` and takes no lease again. Where no
gate is installed (CI, a fresh clone) `tests/heavy_gate.py` starts that run
directly, with no lease and no mark of one, and it runs the `--jobs` asked; without
the flag it would ask for a lease again, and each run would start the next until
the machine ran out of memory. In an agent's session a run that finds no room exits 75 at once, saying why;
`HEAVY_GATE_WAIT=1` makes it wait. `--coverage` runs every process
under `coverage run --parallel-mode` and combines their data at the end, into
the data file `coverage report` reads.

One process is still `python -m unittest discover -s . -p "test_*.py"`, or
`tests/affected.py --jobs 1` for a selection.

This file is a script for its caller and a module for its workers: run as a
script it imports nothing from the `tests` package, whose import moves the
environment every worker must inherit untouched.
"""

from __future__ import annotations

import argparse
import json
import locale
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from fnmatch import fnmatch
from pathlib import Path
from typing import TextIO

ROOT = Path(__file__).resolve().parents[1]

#: The pattern the gates' discovery is spelled with.
PATTERN = "test_*.py"
#: The kind of run this is at the heavy-process gate, as `.heavy-gate.toml` declares it.
KIND = "unittest-parallel"
#: How many processes run at once by default, and fewer on a machine with fewer CPUs.
DEFAULT_JOBS = 8
#: The variable a run under a lease sets for what it starts,
#: `tests.legacy_lock.HELD_BY_ANCESTOR`, held equal by a test: not imported from
#: there, since importing the package moves the environment the workers inherit.
HELD_VARIABLE = "VALKAMA_HEAVY_TEST_LOCK_HELD"
#: The share of processes the gate gave the lease this run is under.
K_VARIABLE = "HEAVY_GATE_K"
#: The flag of the run `tests/heavy_gate.py` starts, at the gate or directly where
#: there is none: that run takes no lease again.
GATED = "--gated"
#: The last run's seconds for each module, which orders the next run.
DURATIONS = ROOT / ".cache" / "test-durations.json"
#: How often the caller looks at its workers.
POLL_SECONDS = 0.05
#: The lines of a crashed module's output the verdict quotes.
TAIL_LINES = 40


def default_jobs(cpus: int | None = None) -> int:
    """`DEFAULT_JOBS`, or half the machine's logical CPUs where that is fewer, and at least 1."""

    return max(1, min(DEFAULT_JOBS, (cpus or os.cpu_count() or 1) // 2))


def granted_jobs(jobs: int, environment: Mapping[str, str] = os.environ) -> int:
    """The processes a run under a lease runs at once: the share K its gate gave, else `jobs`."""

    try:
        k = int(environment.get(K_VARIABLE, ""))
    except ValueError:
        return jobs
    return k if k >= 1 else jobs


def whole_suite(root: Path = ROOT, pattern: str = PATTERN, package: str = "tests") -> list[str]:
    """Every test module of the suite, found as discovery walks the `tests` package.

    Discovery enters a directory only when it is a package and takes a file whose
    name matches the pattern and is an identifier; it imports nothing to find them.
    """

    found: list[str] = []

    def walk(directory: Path, package: str) -> None:
        for entry in sorted(directory.iterdir()):
            if entry.is_dir():
                if entry.name.isidentifier() and (entry / "__init__.py").is_file():
                    walk(entry, f"{package}.{entry.name}")
            elif (
                fnmatch(entry.name, pattern) and entry.suffix == ".py" and entry.stem.isidentifier()
            ):
                found.append(f"{package}.{entry.stem}")

    walk(root / package, package)
    return sorted(found)


def ordered(modules: Iterable[str], seconds: Mapping[str, float], root: Path = ROOT) -> list[str]:
    """The longest first by `seconds`; a module with no time before them, the largest file first.

    The longest first keeps one long module from starting last and running on alone.
    """

    def size(module: str) -> int:
        try:
            return (root / f"{module.replace('.', '/')}.py").stat().st_size
        except OSError:
            return 0

    def key(module: str) -> tuple[int, float]:
        known = seconds.get(module)
        return (0, -size(module)) if known is None else (1, -known)

    return sorted(dict.fromkeys(modules), key=key)


def read_durations(path: Path) -> dict[str, float]:
    try:
        recorded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(recorded, dict):
        return {}
    return {
        str(module): float(value)
        for module, value in recorded.items()
        if isinstance(value, int | float)
    }


def write_durations(path: Path, seconds: Mapping[str, float]) -> None:
    """Merge this run's times into the file, replaced whole so a reader never sees half of it."""

    merged = {**read_durations(path), **seconds}
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    partial.write_text(json.dumps(merged, indent=0, sort_keys=True), encoding="utf-8")
    os.replace(partial, path)


# --- a worker: one module in this process --------------------------------------


def work(module: str, report: Path, stream: TextIO) -> int:
    """Run `module` here with unittest's own runner, write its report, and exit as unittest would."""

    started = time.monotonic()
    suite = unittest.defaultTestLoader.loadTestsFromName(module)
    result = unittest.TextTestRunner(stream=stream, verbosity=1).run(suite)
    record = {
        "module": module,
        "ran": result.testsRun,
        "failures": [[str(test), text] for test, text in result.failures],
        "errors": [[str(test), text] for test, text in result.errors],
        "skipped": [[str(test), reason] for test, reason in result.skipped],
        "expected_failures": len(result.expectedFailures),
        "unexpected_successes": [str(test) for test in result.unexpectedSuccesses],
        "successful": result.wasSuccessful(),
        "seconds": time.monotonic() - started,
    }
    partial = report.with_name(f"{report.name}.tmp")
    partial.write_text(json.dumps(record), encoding="utf-8")
    os.replace(partial, report)
    return 0 if result.wasSuccessful() else 1


# --- the caller: every module, a few at a time ----------------------------------


@dataclass
class Outcome:
    """What one module's process left: its report, or why there is none."""

    module: str
    code: int
    seconds: float
    ran: int = 0
    failures: list[tuple[str, str]] = field(default_factory=list)
    errors: list[tuple[str, str]] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)
    expected_failures: int = 0
    unexpected_successes: list[str] = field(default_factory=list)
    output: str = ""

    @property
    def successful(self) -> bool:
        return not (self.failures or self.errors or self.unexpected_successes)


def _tail(text: str) -> str:
    return "\n".join(text.splitlines()[-TAIL_LINES:])


def outcome(module: str, code: int, seconds: float, report: Path, output: str) -> Outcome:
    """The module's result from its report; a missing one, or a disagreeing exit code, is an error."""

    found = Outcome(module, code, seconds, output=output)
    try:
        record = json.loads(report.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        found.errors.append(
            (
                f"{module} (its process)",
                f"the process ended with exit code {code} before it reported its tests;"
                f" the last of its output:\n{_tail(output)}",
            )
        )
        return found
    found.ran = int(record["ran"])
    found.failures = [(test, text) for test, text in record["failures"]]
    found.errors = [(test, text) for test, text in record["errors"]]
    found.skipped = [(test, reason) for test, reason in record["skipped"]]
    found.expected_failures = int(record["expected_failures"])
    found.unexpected_successes = list(record["unexpected_successes"])
    expected = 0 if record["successful"] else 1
    if code != expected:
        found.errors.append(
            (
                f"{module} (its process)",
                f"the process ended with exit code {code} after its tests, where its"
                f" report says {expected}; the last of its output:\n{_tail(output)}",
            )
        )
    return found


def worker_command(module: str, report: Path, *, coverage: bool) -> list[str]:
    flags = ["-X", "utf8"] if sys.flags.utf8_mode else []
    measured = ["-m", "coverage", "run", "--parallel-mode"] if coverage else []
    return [
        sys.executable,
        *flags,
        *measured,
        *("-m", "tests.parallel", "--worker", str(report), module),
    ]


def worker_environment(base: Mapping[str, str]) -> dict[str, str]:
    """What a worker starts with: the caller's environment without its `VALKAMA_DB`.

    The `tests` package keeps a store the caller names, as `tests/isolated.py gates`
    names its profile's, and points it at the process's own throwaway file only
    when none is named. One process at a time could share the caller's; processes
    at once would write one store together, so each gets its own, as a targeted run
    of one module does.
    """

    return {name: value for name, value in base.items() if name != "VALKAMA_DB"}


def _output_codec() -> str:
    # What a worker's streams are written in: it runs with this interpreter's flags.
    return "utf-8" if sys.flags.utf8_mode else locale.getpreferredencoding(False)


def run_modules(
    modules: Sequence[str],
    jobs: int,
    *,
    cwd: Path = ROOT,
    environment: Mapping[str, str] | None = None,
    coverage: bool = False,
    say: Callable[[str], None],
) -> list[Outcome]:
    """Run each module in its own process, `jobs` at a time, in the order given."""

    pending = list(dict.fromkeys(modules))
    total = len(pending)
    started_with = worker_environment(os.environ if environment is None else environment)
    finished: list[Outcome] = []
    running: dict[str, tuple[subprocess.Popen[bytes], Path, Path, float]] = {}
    scratch = Path(tempfile.mkdtemp(prefix="valkama-parallel-"))
    try:
        while pending or running:
            while pending and len(running) < jobs:
                module = pending.pop(0)
                report = scratch / f"{module}.json"
                log = scratch / f"{module}.log"
                with log.open("wb") as written:
                    process = subprocess.Popen(
                        worker_command(module, report, coverage=coverage),
                        cwd=cwd,
                        env=started_with,
                        stdin=subprocess.DEVNULL,
                        stdout=written,
                        stderr=subprocess.STDOUT,
                    )
                running[module] = (process, report, log, time.monotonic())
            for module, (process, report, log, started) in list(running.items()):
                code = process.poll()
                if code is None:
                    continue
                del running[module]
                # For a person reading the run; nothing is decided by this text.
                output = log.read_bytes().decode(_output_codec(), errors="replace")
                done = outcome(module, code, time.monotonic() - started, report, output)
                finished.append(done)
                say(_progress(len(finished), total, done))
            if running:
                time.sleep(POLL_SECONDS)
    finally:
        for process, _report, _log, _started in running.values():
            process.kill()
            process.wait()
        shutil.rmtree(scratch, ignore_errors=True)
    return finished


def _progress(index: int, total: int, done: Outcome) -> str:
    width = len(str(total))
    state = "ok" if done.successful else _counts(done.failures, done.errors, [], [])
    return f"[{index:>{width}}/{total}] {done.module}  {state}  {done.seconds:.1f} s"


def _counts(
    failures: Sequence[object],
    errors: Sequence[object],
    skipped: Sequence[object],
    unexpected: Sequence[object],
    expected_failures: int = 0,
) -> str:
    parts = [
        f"{name}={len(found)}"
        for name, found in (("failures", failures), ("errors", errors))
        if found
    ]
    if skipped:
        parts.append(f"skipped={len(skipped)}")
    if expected_failures:
        parts.append(f"expected failures={expected_failures}")
    if unexpected:
        parts.append(f"unexpected successes={len(unexpected)}")
    return ", ".join(parts)


def verdict(outcomes: Sequence[Outcome], seconds: float, jobs: int) -> tuple[int, str]:
    """The exit code and the text of the whole run: unittest's, summed over the modules."""

    lines: list[str] = []
    failed = [done for done in outcomes if not done.successful]
    for done in failed:
        lines += ["", f"--- {done.module}: its output ---", done.output.rstrip()]
    failures = [(done.module, *item) for done in outcomes for item in done.failures]
    errors = [(done.module, *item) for done in outcomes for item in done.errors]
    skipped = [(done.module, *item) for done in outcomes for item in done.skipped]
    unexpected = [(done.module, test) for done in outcomes for test in done.unexpected_successes]
    for kind, found in (("FAIL", failures), ("ERROR", errors)):
        for module, test, text in found:
            lines += ["", "=" * 70, f"{kind}: {test}  [{module}]", "-" * 70, text.rstrip()]
    for module, test in unexpected:
        lines.append(f"UNEXPECTED SUCCESS: {test}  [{module}]")
    if skipped:
        lines.append("")
    for module, test, reason in skipped:
        lines.append(f"skipped: {test}  [{module}]: {reason}")
    ran = sum(done.ran for done in outcomes)
    lines += [
        "-" * 70,
        f"Ran {ran} test{'' if ran == 1 else 's'} in {seconds:.3f}s"
        f" ({len(outcomes)} modules, {jobs} at a time)",
        "",
    ]
    expected = sum(done.expected_failures for done in outcomes)
    counts = _counts(failures, errors, skipped, unexpected, expected)
    if failed or not outcomes:
        lines.append(f"FAILED ({counts})" if counts else "FAILED (no module ran)")
        return 1, "\n".join(lines)
    lines.append(f"OK ({counts})" if counts else "OK")
    return 0, "\n".join(lines)


def run(
    modules: Sequence[str],
    jobs: int,
    *,
    coverage: bool = False,
    cwd: Path = ROOT,
    environment: Mapping[str, str] | None = None,
    durations: Path | None = DURATIONS,
    say: Callable[[str], None],
) -> int:
    """Run `modules`, the longest first, and say the verdict; its exit code is the run's."""

    seconds = read_durations(durations) if durations is not None else {}
    chosen = ordered(modules, seconds, cwd)
    jobs = max(1, min(jobs, len(chosen) or 1))
    started = time.monotonic()
    outcomes = run_modules(
        chosen, jobs, cwd=cwd, environment=environment, coverage=coverage, say=say
    )
    elapsed = time.monotonic() - started
    if durations is not None:
        write_durations(durations, {done.module: round(done.seconds, 2) for done in outcomes})
    code, text = verdict(outcomes, elapsed, jobs)
    say(text)
    return code


def _coverage(*arguments: str, cwd: Path) -> int:
    return subprocess.run(
        [sys.executable, "-m", "coverage", *arguments], cwd=cwd, check=False
    ).returncode


def gate_command(argv: Sequence[str], modules: int, jobs: int) -> list[str]:
    """This run again, under a lease at the heavy-process gate for `modules` wanting `jobs`."""

    gate = str(ROOT / "tests" / "heavy_gate.py")
    return [
        *(sys.executable, gate, "run", "--kind", KIND, "--size", str(modules)),
        *("--want", str(jobs), "--", sys.executable, str(Path(__file__).resolve())),
        *(GATED, *argv),
    ]


def _say(line: str) -> None:
    sys.stdout.write(f"{line}\n")
    sys.stdout.flush()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python tests/parallel.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("modules", nargs="*", metavar="MODULE", help="by default the whole suite")
    parser.add_argument(
        "--jobs", type=int, default=default_jobs(), help="processes at once (default %(default)s)"
    )
    parser.add_argument("--coverage", action="store_true", help="measure every process")
    parser.add_argument("--worker", type=Path, metavar="REPORT", help=argparse.SUPPRESS)
    parser.add_argument(GATED, action="store_true", help=argparse.SUPPRESS)
    arguments = list(sys.argv[1:] if argv is None else argv)
    options = parser.parse_args(arguments)
    if options.worker is not None:
        if len(options.modules) != 1:
            parser.error("a worker runs one module")
        return work(options.modules[0], options.worker, sys.stderr)
    if options.jobs < 1:
        parser.error("--jobs is a whole number from 1")
    modules = list(dict.fromkeys(options.modules)) or whole_suite()
    jobs = min(options.jobs, len(modules))
    if not options.gated and HELD_VARIABLE not in os.environ:
        return subprocess.run(gate_command(arguments, len(modules), jobs), check=False).returncode
    jobs = min(granted_jobs(jobs), len(modules))
    if options.coverage:
        _coverage("erase", cwd=ROOT)
    code = run(modules, jobs, coverage=options.coverage, say=_say)
    if options.coverage:
        combined = _coverage("combine", "--quiet", cwd=ROOT)
        if combined != 0:
            _say(f"coverage combine ended with exit code {combined}")
            code = code or combined
    return code


if __name__ == "__main__":
    sys.exit(main())
