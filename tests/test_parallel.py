"""`tests/parallel.py`: test modules in several processes, and one verdict as unittest's.

The verdict tests run real worker processes over a package of their own, written
into a temporary directory, so each outcome is what unittest itself made of a
module: a failure, an error, a skip, and a process that ends before it reports.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import tomllib
import unittest
from pathlib import Path
from unittest import mock

from tests import legacy_lock, parallel

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "alpha_suite"

MODULES = {
    "test_passes": """
        import unittest

        class Passes(unittest.TestCase):
            def test_one(self):
                self.assertTrue(True)

            def test_two(self):
                self.assertEqual(2, 1 + 1)
    """,
    "test_fails": """
        import unittest

        class Fails(unittest.TestCase):
            def test_sum(self):
                self.assertEqual(3, 1 + 1, "the sum is wrong")
    """,
    "test_errors": """
        import unittest

        class Errors(unittest.TestCase):
            def test_raises(self):
                raise RuntimeError("the fixture is missing")
    """,
    "test_skips": """
        import unittest

        class Skips(unittest.TestCase):
            @unittest.skip("not on this platform")
            def test_elsewhere(self):
                raise AssertionError("a skipped test ran")

            def test_here(self):
                pass
    """,
    "test_crashes": """
        import unittest

        from alpha_suite import leave

        class Crashes(unittest.TestCase):
            def test_takes_its_process_down(self):
                leave(3)

            def test_after(self):
                pass
    """,
    "test_exits_wrong": """
        import atexit
        import unittest

        from alpha_suite import leave

        class ExitsWrong(unittest.TestCase):
            def test_passes_then_the_process_fails(self):
                atexit.register(leave, 4)
    """,
}

#: The package's `__init__`: a way out of the process that skips every cleanup, as a
#: crash does, after removing the throwaway directory the `tests` package made for it.
LEAVE = """
import os
import shutil
import sys


def leave(code):
    shutil.rmtree(os.path.dirname(sys.modules["tests"].SUITE_STORE), ignore_errors=True)
    os._exit(code)
"""


def module(name: str) -> str:
    return f"{PACKAGE}.{name}"


class VerdictTests(unittest.TestCase):
    """Each module's outcome reaches the one verdict, with its module, as unittest counts it."""

    @classmethod
    def setUpClass(cls) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-parallel-", ignore_cleanup_errors=True)
        cls.addClassCleanup(directory.cleanup)
        cls.root = Path(directory.name)
        package = cls.root / PACKAGE
        package.mkdir()
        (package / "__init__.py").write_text(LEAVE, encoding="utf-8")
        for name, source in MODULES.items():
            (package / f"{name}.py").write_text(textwrap.dedent(source), encoding="utf-8")

    def run_modules(self, *names: str, jobs: int = 3) -> tuple[int, str]:
        said: list[str] = []
        # The workers import `tests.parallel` from this checkout and the package from `root`.
        environment = {**os.environ, "PYTHONPATH": str(ROOT)}
        code = parallel.run(
            [module(name) for name in names],
            jobs,
            cwd=self.root,
            environment=environment,
            durations=None,
            say=said.append,
        )
        return code, "\n".join(said)

    def test_a_failure_an_error_and_a_crash_fail_the_run_each_with_its_module(self) -> None:
        code, said = self.run_modules(
            "test_passes", "test_fails", "test_errors", "test_skips", "test_crashes"
        )

        self.assertEqual(1, code)
        self.assertRegex(
            said,
            r"FAIL: test_sum \(alpha_suite\.test_fails\.Fails[^)]*\)  \[alpha_suite\.test_fails\]",
        )
        self.assertIn("the sum is wrong", said)
        self.assertRegex(
            said,
            r"ERROR: test_raises \(alpha_suite\.test_errors\.Errors[^)]*\)  \[alpha_suite\.test_errors\]",
        )
        self.assertIn("RuntimeError: the fixture is missing", said)
        # The crashed module ran tests whose results died with it: it is an error, not a gap.
        self.assertIn(
            "ERROR: alpha_suite.test_crashes (its process)  [alpha_suite.test_crashes]", said
        )
        self.assertIn("the process ended with exit code 3 before it reported its tests", said)
        self.assertRegex(
            said,
            r"skipped: test_elsewhere \(alpha_suite\.test_skips\.Skips[^)]*\)  \[alpha_suite\.test_skips\]: not on this platform",
        )
        # 2 + 1 + 1 + 2; the crashed module's tests are not counted, since none reported.
        self.assertRegex(said, r"(?m)^Ran 6 tests in [0-9.]+s \(5 modules, 3 at a time\)$")
        self.assertRegex(said, r"(?m)^FAILED \(failures=1, errors=2, skipped=1\)$")

    def test_passes_and_skips_alone_pass_the_run(self) -> None:
        code, said = self.run_modules("test_passes", "test_skips")

        self.assertEqual(0, code)
        self.assertRegex(said, r"(?m)^Ran 4 tests in ")
        self.assertRegex(said, r"(?m)^OK \(skipped=1\)$")
        self.assertIn("[alpha_suite.test_skips]: not on this platform", said)

    def test_an_exit_code_that_disagrees_with_the_report_is_an_error(self) -> None:
        code, said = self.run_modules("test_exits_wrong", "test_passes")

        self.assertEqual(1, code)
        self.assertIn(
            "ERROR: alpha_suite.test_exits_wrong (its process)  [alpha_suite.test_exits_wrong]",
            said,
        )
        self.assertIn("exit code 4 after its tests, where its report says 0", said)
        self.assertRegex(said, r"(?m)^FAILED \(errors=1\)$")

    def test_a_module_named_twice_runs_once(self) -> None:
        code, said = self.run_modules("test_passes", "test_passes", "test_skips", jobs=2)

        self.assertEqual(0, code)
        self.assertRegex(said, r"(?m)^Ran 4 tests in [0-9.]+s \(2 modules, 2 at a time\)$")
        self.assertEqual(1, said.count("alpha_suite.test_passes  ok"))

    def test_each_worker_has_a_store_of_its_own_whatever_the_caller_names(self) -> None:
        named = str(self.root / "named.sqlite3")

        started = parallel.worker_environment({"VALKAMA_DB": named, "HOME": "h"})

        self.assertEqual({"HOME": "h"}, started)


class SuiteTests(unittest.TestCase):
    def test_the_whole_suite_is_what_discovery_finds(self) -> None:
        # The oracle is unittest's discovery itself, over a tree with each case it skips.
        directory = tempfile.TemporaryDirectory(prefix="vk-discover-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        files = {
            "beta_suite/__init__.py": "",
            "beta_suite/test_top.py": "",
            "beta_suite/helper.py": "",
            "beta_suite/sub/__init__.py": "",
            "beta_suite/sub/test_inner.py": "",
            "beta_suite/data/test_not_a_package.py": "",
            "beta_suite/test-not-a-name.py": "",
            "beta_suite/test_notes.txt": "",
        }
        case = "import unittest\nclass Case(unittest.TestCase):\n    def test_it(self):\n        pass\n"
        for name, text in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(case if Path(name).name.startswith("test") else text, encoding="utf-8")
        discover = (
            "import unittest\n"
            "suite = unittest.TestLoader().discover('beta_suite', pattern='test_*.py', top_level_dir='.')\n"
            "def walk(s):\n"
            "    for t in s:\n"
            "        yield from walk(t) if isinstance(t, unittest.TestSuite) else [type(t).__module__]\n"
            "print('\\n'.join(sorted(set(walk(suite)))))\n"
        )
        found = subprocess.run(
            [sys.executable, "-c", discover], cwd=root, capture_output=True, check=True
        )

        expected = found.stdout.decode("utf-8", "strict").split()
        self.assertEqual(["beta_suite.sub.test_inner", "beta_suite.test_top"], expected)
        self.assertEqual(expected, parallel.whole_suite(root, package="beta_suite"))

    def test_the_longest_go_first_and_a_module_never_timed_before_them(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-order-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        (root / "tests").mkdir()
        (root / "tests" / "test_new_small.py").write_text("x", encoding="utf-8")
        (root / "tests" / "test_new_large.py").write_text("x" * 100, encoding="utf-8")
        seconds = {"tests.test_quick": 1.0, "tests.test_slow": 90.0}
        modules = [
            "tests.test_quick",
            "tests.test_new_small",
            "tests.test_slow",
            "tests.test_new_large",
        ]

        self.assertEqual(
            ["tests.test_new_large", "tests.test_new_small", "tests.test_slow", "tests.test_quick"],
            parallel.ordered(modules, seconds, root),
        )

    def test_a_run_s_times_are_merged_into_the_file_the_next_run_orders_by(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-times-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "cache" / "durations.json"
        parallel.write_durations(path, {"tests.test_a": 2.0, "tests.test_b": 5.0})
        parallel.write_durations(path, {"tests.test_b": 7.5})

        self.assertEqual({"tests.test_a": 2.0, "tests.test_b": 7.5}, parallel.read_durations(path))
        path.write_text("not json", encoding="utf-8")
        self.assertEqual({}, parallel.read_durations(path))


class GateTests(unittest.TestCase):
    def test_the_figures_copied_from_the_package_and_the_rules_are_their_own(self) -> None:
        self.assertEqual(legacy_lock.HELD_BY_ANCESTOR, parallel.HELD_VARIABLE)
        kinds = tomllib.loads((ROOT / ".heavy-gate.toml").read_text(encoding="utf-8"))["kind"]
        declared = {kind["name"]: kind for kind in kinds}
        self.assertIn(parallel.KIND, declared)
        self.assertIn("python tests/parallel.py", declared[parallel.KIND]["commands"])
        self.assertTrue(declared[parallel.KIND]["self_gated"])

    def test_a_run_not_under_a_holder_takes_a_lease_of_its_kind_sized_by_its_modules(self) -> None:
        command = parallel.gate_command(["--jobs", "3", "tests.test_a"], 1, 3)

        self.assertEqual(
            [sys.executable, str(ROOT / "tests" / "heavy_gate.py"), "run"], command[:3]
        )
        options = command[: command.index("--")]
        self.assertEqual(parallel.KIND, options[options.index("--kind") + 1])
        self.assertEqual("1", options[options.index("--size") + 1])
        self.assertEqual("3", options[options.index("--want") + 1])
        self.assertEqual(
            [
                *(sys.executable, str(ROOT / "tests" / "parallel.py"), parallel.GATED),
                *("--jobs", "3", "tests.test_a"),
            ],
            command[command.index("--") + 1 :],
        )

    def test_the_run_its_gate_command_starts_runs_its_modules_and_asks_for_no_lease(self) -> None:
        # Where no gate is installed, `tests/heavy_gate.py` starts that run directly, with
        # neither the mark of a holder nor a share K: asking for a lease again there would
        # start a run that asks again, until the machine ran out of memory.
        argv = ["--jobs", "2", "tests.test_a", "tests.test_b"]
        command = parallel.gate_command(argv, 2, 2)
        started_by_gate = command[command.index("--") + 3 :]
        environment = {
            name: value
            for name, value in os.environ.items()
            if name not in (parallel.HELD_VARIABLE, parallel.K_VARIABLE)
        }
        with (
            mock.patch.dict(os.environ, environment, clear=True),
            mock.patch.object(parallel.subprocess, "run") as started,
            mock.patch.object(parallel, "run", return_value=0) as ran,
        ):
            self.assertEqual(0, parallel.main(started_by_gate))
        started.assert_not_called()
        self.assertEqual(["tests.test_a", "tests.test_b"], ran.call_args.args[0])
        self.assertEqual(2, ran.call_args.args[1])

    def test_a_run_under_a_lease_runs_the_share_its_gate_gave(self) -> None:
        self.assertEqual(3, parallel.granted_jobs(8, {"HEAVY_GATE_K": "3"}))
        for given in ({}, {"HEAVY_GATE_K": ""}, {"HEAVY_GATE_K": "0"}, {"HEAVY_GATE_K": "x"}):
            with self.subTest(given=given):
                self.assertEqual(8, parallel.granted_jobs(8, given))

        modules = ["tests.test_a", "tests.test_b", "tests.test_c", "tests.test_d"]
        held = {parallel.HELD_VARIABLE: "the lock", "HEAVY_GATE_K": "2"}
        with (
            mock.patch.dict(os.environ, held),
            mock.patch.object(parallel, "run", return_value=0) as ran,
        ):
            self.assertEqual(0, parallel.main(["--jobs", "8", *modules]))
        self.assertEqual(2, ran.call_args.args[1])
        # Never more processes than modules, whatever the gate gave.
        with (
            mock.patch.dict(os.environ, {**held, "HEAVY_GATE_K": "16"}),
            mock.patch.object(parallel, "run", return_value=0) as ran,
        ):
            parallel.main(modules[:3])
        self.assertEqual(3, ran.call_args.args[1])

    def test_a_run_not_under_a_holder_runs_nothing_itself_but_its_gate_command(self) -> None:
        environment = {
            name: value for name, value in os.environ.items() if name != parallel.HELD_VARIABLE
        }
        with (
            mock.patch.dict(os.environ, environment, clear=True),
            mock.patch.object(parallel.subprocess, "run") as started,
            mock.patch.object(parallel, "run") as ran,
        ):
            started.return_value.returncode = 75
            self.assertEqual(75, parallel.main(["--jobs", "2", "tests.test_a", "tests.test_b"]))
        ran.assert_not_called()
        command = started.call_args.args[0]
        self.assertEqual(
            parallel.gate_command(["--jobs", "2", "tests.test_a", "tests.test_b"], 2, 2), command
        )

    def test_the_default_takes_half_the_machine_up_to_its_ceiling(self) -> None:
        self.assertEqual(
            [1, 1, 2, parallel.DEFAULT_JOBS, parallel.DEFAULT_JOBS],
            [parallel.default_jobs(cpus) for cpus in (1, 2, 4, 2 * parallel.DEFAULT_JOBS, 64)],
        )

    def test_a_worker_runs_under_coverage_only_when_asked(self) -> None:
        report = Path("report.json")
        plain = parallel.worker_command("tests.test_a", report, coverage=False)
        measured = parallel.worker_command("tests.test_a", report, coverage=True)

        self.assertNotIn("coverage", plain)
        self.assertEqual(
            ["coverage", "run", "--parallel-mode", "-m", "tests.parallel"],
            measured[measured.index("coverage") : measured.index("tests.parallel") + 1],
        )
        self.assertEqual(["--worker", "report.json", "tests.test_a"], measured[-3:])

    def test_a_worker_report_is_what_unittest_made_of_its_module(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-report-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        report = Path(directory.name) / "report.json"
        stream = open(os.devnull, "w", encoding="utf-8")
        self.addCleanup(stream.close)

        name = f"{__name__}.GateTests.test_the_figures_copied_from_the_package_and_the_rules_are_their_own"

        code = parallel.work(name, report, stream)

        recorded = json.loads(report.read_text(encoding="utf-8"))
        self.assertEqual(0, code)
        self.assertEqual(
            (name, 1, [], [], True),
            tuple(recorded[key] for key in ("module", "ran", "failures", "errors", "successful")),
        )


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
