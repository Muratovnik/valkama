"""What the commit hooks cost, measured as processes: not a test of the suite.

    python tests/commit_hook_cost.py --python BASE_PYTHON [--runs 20]

It builds the commit tests' place (`commit_fixtures`) in a temporary directory, with
the hooks running through the launcher's own shim (`launcher._shim_bytes`) pointed at
this checkout, and the interpreter given, as the release runs them. It prints, in
milliseconds:

- `commit`: what the hook adds to one `git commit` in a client session in a
  registered repository: the median and the 90th percentile over `--runs` commits,
  each against a commit with the hooks taken out of the global file, in turns;
- `rebase`: what the hook adds to a rebase of `--runs` commits made in a session;
- `post_tool_use`: the process of `hook claude post-tool-use` through the shim with
  no record, and with one record of its session, median of `--runs` each.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import launcher
from tests.commit_fixtures import CLAUDE, CommitPlace


def _ms(nanoseconds: float) -> float:
    return round(nanoseconds / 1e6, 1)


def _p90(values: list[int]) -> int:
    ordered = sorted(values)
    return ordered[max(0, round(0.9 * len(ordered)) - 1)]


def measure(python: str, runs: int) -> dict:
    case = unittest.TestCase()
    place = CommitPlace(case)
    shim = place.base / "launcher" / launcher.SHIM_NAME
    shim.parent.mkdir()
    shim.write_bytes(launcher._shim_bytes(ROOT / "valkama.py"))
    place.global_file.write_bytes(b"")
    place.install(python)
    # The fixture's own hooks name this checkout's entry point; the release runs the shim.
    hooked = place.global_file.read_bytes().replace(
        str(ROOT / "valkama.py").replace("\\", "/").encode(), str(shim).replace("\\", "/").encode()
    )
    place.global_file.write_bytes(hooked)
    session = place.sessions(CLAUDE_CODE_SESSION_ID=CLAUDE)
    try:
        added = []
        for number in range(runs):
            spent = {}
            for hooks in (True, False):
                place.global_file.write_bytes(hooked if hooks else b"")
                started = time.perf_counter_ns()
                place.commit(place.repository, f"cost-{number}-{hooks}", environ=session)
                spent[hooks] = time.perf_counter_ns() - started
            added.append(spent[True] - spent[False])
        recorded = len(place.beside_the_store())
        for path in place.beside_the_store():
            path.unlink()

        rebases = {}
        for hooks in (True, False):
            place.global_file.write_bytes(b"")
            branch = f"topic-{hooks}"
            place.git(place.repository, "checkout", "-q", "-b", branch, "main")
            for number in range(runs):
                place.commit(place.repository, f"{branch}-{number}")
            place.git(place.repository, "checkout", "-q", "main")
            place.commit(place.repository, f"base-{hooks}")
            place.git(place.repository, "checkout", "-q", branch)
            place.global_file.write_bytes(hooked if hooks else b"")
            started = time.perf_counter_ns()
            place.git(place.repository, "rebase", "-q", "main", environ=session)
            rebases[hooks] = time.perf_counter_ns() - started
            place.git(place.repository, "checkout", "-q", "main")
        left_by_rebase = len(place.beside_the_store())

        place.global_file.write_bytes(hooked)
        payload = json.dumps(
            {"session_id": CLAUDE, "tool_name": "Bash", "duration_ms": 60_000}
        ).encode()
        hook = [python, "-I", "-S", str(shim), "hook", "claude", "post-tool-use"]
        environ = {**place.environ, "PYTHONUTF8": "1"}

        def hook_once() -> int:
            started = time.perf_counter_ns()
            subprocess.run(hook, input=payload, env=environ, capture_output=True, check=True)
            return time.perf_counter_ns() - started

        empty = [hook_once() for _run in range(runs)]
        one = []
        for number in range(runs):
            place.commit(place.repository, f"taken-{number}", environ=session)
            one.append(hook_once())
        taken_all = not place.beside_the_store()
    finally:
        case.doCleanups()
    return {
        "runs": runs,
        "commit": {
            "added_median_ms": _ms(statistics.median(added)),
            "added_p90_ms": _ms(_p90(added)),
            "records_written": recorded,
        },
        "rebase": {
            "commits": runs,
            "with_hooks_ms": _ms(rebases[True]),
            "without_hooks_ms": _ms(rebases[False]),
            "added_ms": _ms(rebases[True] - rebases[False]),
            "records_left_by_the_rebase": left_by_rebase,
        },
        "post_tool_use": {
            "no_record_median_ms": _ms(statistics.median(empty)),
            "one_record_median_ms": _ms(statistics.median(one)),
            "every_record_taken": taken_all,
        },
        "python": python,
        "platform": sys.platform,
        "git": subprocess.run(
            ["git", "--version"], capture_output=True, text=True, check=False
        ).stdout.strip(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--runs", type=int, default=20)
    options = parser.parse_args(argv)
    os.environ.setdefault("PYTHONUTF8", "1")
    sys.stdout.write(json.dumps(measure(options.python, options.runs), indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
