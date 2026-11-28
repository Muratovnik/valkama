"""What a chain of run records owes: each step counts from a record where nothing it reads changed since.

Every tree is a repository this test made, with its second worktree, as in
`tests/test_run_record.py`. Which test modules a change reaches is a stand-in
here, a table of paths to modules, because the import graph the chain reads is
this checkout's; one test holds the real one to this checkout.
"""

from __future__ import annotations

import contextlib
import io
import json
import re
import sys
import unittest
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from unittest import mock

from tests import record_chain, run_record, test_run_record

ROOT = Path(__file__).resolve().parents[1]

#: A step as the record keeps it: name, command, directory under the tree, exit code, log.
Step = tuple[str, list[str], str, int, str]
TYPOS: Step = ("typos", ["C:/tools/typos.EXE"], "", 0, "")
SUBJECTS: Step = (
    "python-tests-commit_subjects.py",
    [sys.executable, "tests/commit_subjects.py"],
    "",
    0,
    "",
)
UNIT: Step = (
    "unit",
    [sys.executable, "-m", "unittest", "tests.test_app", "tests.test_docs"],
    "",
    0,
    "",
)
LINT: Step = ("npm-run-lint", ["C:/node/npm.CMD", "run", "lint"], "web", 0, "")
SPECS = "--specs=../tmp/specs.txt"
BROWSER: Step = (
    "browser-specs",
    ["C:/node/npm.CMD", "run", "test:browser:allowed", "--", SPECS],
    "web",
    0,
    "",
)
TYPECHECK: Step = ("npm-run-typecheck", ["C:/node/npm.CMD", "run", "typecheck"], "web", 0, "")
UI_SYSTEM: Step = (
    "npm-run-check-ui-system",
    ["C:/node/npm.CMD", "run", "check:ui-system"],
    "web",
    0,
    "",
)
LINT_TYPES: Step = ("npm-run-lint-types", ["C:/node/npm.CMD", "run", "lint:types"], "web", 0, "")
LINT_DEAD: Step = ("npm-run-lint-dead", ["C:/node/npm.CMD", "run", "lint:dead"], "web", 0, "")
BUILD: Step = ("npm-run-build", ["C:/node/npm.CMD", "run", "build"], "web", 0, "")
NPM_TEST: Step = ("npm-test", ["C:/node/npm.CMD", "test"], "web", 0, "")
FAILED_NPM_TEST: Step = ("npm-test", ["C:/node/npm.CMD", "test"], "web", 1, "")
RUFF: Step = ("ruff", [sys.executable, "-m", "ruff", "check", "."], "", 0, "")
MYPY: Step = ("mypy", ["C:/env/mypy.exe"], "", 0, "")
VULTURE: Step = (
    "vulture",
    ["C:/env/vulture.exe", "server", "tests", "valkama.py", "--min-confidence", "60"],
    "",
    0,
    "",
)
SEMGREP: Step = ("semgrep", ["C:/env/semgrep.exe", "scan", "server", "valkama.py"], "", 0, "")
REPORT: Step = ("report", [sys.executable, "-m", "coverage", "report"], "", 0, "")
AUDIT: Step = ("audit", [sys.executable, ".github/relkit.pyz", "audit", "--history"], "", 0, "")
#: Every kind of step but the newest-only ones, as a full record holds them.
FULL = [TYPOS, SUBJECTS, AUDIT, UNIT, REPORT, LINT, BROWSER, RUFF, MYPY, VULTURE, SEMGREP]

#: The web package the chain reads: `test` runs lint, typecheck, check:ui-system and lint:dead,
#: and `lint` runs `lint:types` in turn; `build` is a script `test` does not run.
PACKAGE = {
    "scripts": {
        "test": (
            "npm run lint && npm run typecheck && npm run check:ui-system && npm run lint:dead"
        ),
        "lint": "npm run lint:types",
        "lint:types": "oxlint src",
        "lint:dead": "knip --no-progress",
        "typecheck": "vue-tsc --build",
        "check:ui-system": "node scripts/check-ui-system.mjs",
        "build": "vite build",
    }
}

#: Which test modules each path reaches, as `tests/affected.py` would say it.
REACHES = {
    "server/app.py": {"tests.test_app": "imports server.app"},
    "tests/test_app.py": {"tests.test_app": "changed: tests/test_app.py"},
    "docs/rules.md": {"tests.test_docs": "names docs/rules.md"},
    ".github/relkit.pyz": {"tests.test_docs": "names .github/relkit.pyz"},
}


def stand_in(_top: str) -> record_chain.Reach:
    def select(paths: list[str]) -> dict[str, str]:
        found: dict[str, str] = {}
        for path in paths:
            found.update(REACHES.get(path, {}))
        return found

    return record_chain.Reach(select, {"tests.test_app", "tests.test_docs"})


class ChainCase(test_run_record.TreeCase):
    def setUp(self) -> None:
        super().setUp()
        self.write("web/src/App.vue", "<template>one</template>\n")
        self.write("web/scripts/tokens.mjs", "const source = { file: 'DESIGN.md' }\n")
        self.write("web/package.json", json.dumps(PACKAGE, indent=2) + "\n")
        self.write("DESIGN.md", "# Design\n")
        self.write("docs/rules.md", "rules\n")
        self.commit("feat: the web and the documents")
        self.git("-C", str(self.other), "merge", "-q", "main")
        self.specs(["production-one.spec.ts", "production-two.spec.ts"])
        reach = mock.patch.object(record_chain, "reach_for", side_effect=stand_in)
        reach.start()
        self.addCleanup(reach.stop)

    def specs(self, names: Iterable[str], tree: Path | None = None) -> None:
        listed = (tree or self.repo) / "tmp" / "specs.txt"
        listed.parent.mkdir(parents=True, exist_ok=True)
        listed.write_text("".join(f"{name}\n" for name in names), encoding="utf-8")

    def record(self, run: str, steps: Sequence[Step], tree: Path | None = None) -> Path:
        """A record of `steps` made in `tree` as it is now, kept in its ignored `tmp/<run>`."""

        tree = tree or self.repo
        out = tree / "tmp" / run
        logs = out / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        entries = []
        for name, argv, where, code, said in steps:
            log = logs / f"{name}.log"
            log.write_bytes(said.encode("utf-8"))
            cwd = tree / where if where else tree
            entry = run_record.step(name, argv, cwd, log, code)
            if lists := run_record.named_lists(argv, cwd):
                entry["lists"] = lists
            entries.append(entry)
        result = 0 if all(step[3] == 0 for step in steps) else 1
        return run_record.write(out, run_record.begin(tree, {}), entries, result)

    def judged(self, *records: Path, required: Sequence[str] = ()) -> tuple[int, str]:
        demands = [word for name in required for word in ("--require", name)]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = run_record.main(
                ["check", *map(str, records), "--tree", str(self.repo), *demands]
            )
        return code, output.getvalue()

    def head(self, tree: Path | None = None) -> str:
        return self.git("-C", str(tree or self.repo), "rev-parse", "HEAD").strip()


class DocumentTests(ChainCase):
    def test_a_document_commit_after_a_record_is_accepted_with_a_record_of_typos_and_subjects(
        self,
    ) -> None:
        full = self.record("full", [TYPOS, SUBJECTS, UNIT, LINT, BROWSER])
        self.write("docs/guides/use.md", "how to use it\n")
        self.commit("docs: say how to use it")
        small = self.record("small", [TYPOS, SUBJECTS])

        code, said = self.judged(small, full, required=["typos"])

        self.assertEqual(run_record.PASSED, code, said)
        self.assertIn(f"accepted: a chain of 2 records, the newest at {self.head()}", said)
        self.assertRegex(
            said, r"full\S* made in .*: unit exit=0, npm-run-lint exit=0, browser-specs"
        )
        self.assertRegex(said, r"small\S* made in .*: typos exit=0, python-tests-commit_subjects")
        # The controls: the earlier record alone is of another commit, and the order given is free.
        self.assertEqual(run_record.REFUSED, self.judged(full)[0])
        self.assertEqual(code, self.judged(full, small, required=["typos"])[0])

    def test_typos_and_subjects_count_only_from_a_record_of_the_tree_as_it_is_now(self) -> None:
        full = self.record("full", [TYPOS, SUBJECTS, LINT])
        self.write("docs/guides/use.md", "how to use it\n")
        self.commit("docs: say how to use it")
        small = self.record("small", [LINT])

        code, said = self.judged(small, full)

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step typos reads every file or commit", said)
        self.assertIn("step python-tests-commit_subjects.py reads every file or commit", said)
        self.assertNotIn("npm-run-lint", said, "a document is no input of the web's lint")

    def test_a_document_a_web_source_names_needs_the_web_steps_again_and_not_the_browser(
        self,
    ) -> None:
        full = self.record("full", [TYPOS, SUBJECTS, LINT, BROWSER])
        self.write("DESIGN.md", "# Design\n\nA new rule.\n")
        self.commit("docs(design): state a new rule")

        code, said = self.judged(self.record("small", [TYPOS, SUBJECTS]), full)

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step npm-run-lint reads DESIGN.md, which changed since", said)
        self.assertNotIn("browser-specs", said)
        rerun = self.record("rerun", [TYPOS, SUBJECTS, LINT])
        self.assertEqual(run_record.PASSED, self.judged(rerun, full)[0])


class WebTests(ChainCase):
    def test_a_web_source_commit_without_a_newer_browser_record_is_refused_naming_step_and_path(
        self,
    ) -> None:
        full = self.record("full", [TYPOS, SUBJECTS, LINT, BROWSER])
        made_at = self.head()
        self.write("web/src/App.vue", "<template>two</template>\n")
        self.commit("fix(web): say two")
        newer = self.record("newer", [TYPOS, SUBJECTS, LINT])

        code, said = self.judged(newer, full)

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn(
            f"{full}: step browser-specs reads web/src/App.vue, which changed since {made_at},"
            " and no record has it untouched",
            said,
        )
        self.assertNotIn("step npm-run-lint", said, "the newer record ran the lint again")
        # The control: the same browser run again at this commit is what the chain needs.
        browsed = self.record("browsed", [TYPOS, SUBJECTS, LINT, BROWSER])
        self.assertEqual(run_record.PASSED, self.judged(browsed, full)[0])

    def test_a_browser_run_over_another_list_is_not_the_same_step(self) -> None:
        full = self.record("full", [TYPOS, SUBJECTS, BROWSER])
        self.write("web/src/App.vue", "<template>two</template>\n")
        self.commit("fix(web): say two")
        self.specs(["production-one.spec.ts"])

        code, said = self.judged(self.record("fewer", [TYPOS, SUBJECTS, BROWSER]), full)

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step browser-specs reads web/src/App.vue", said)

    def test_a_browser_run_is_its_specs_whatever_path_its_list_file_had(self) -> None:
        full = self.record("full", [TYPOS, SUBJECTS, BROWSER])
        self.write("web/src/App.vue", "<template>two</template>\n")
        self.commit("fix(web): say two")
        elsewhere = self.repo / "tmp" / "elsewhere" / "chosen.txt"
        elsewhere.parent.mkdir(parents=True)
        elsewhere.write_text("production-two.spec.ts\nproduction-one.spec.ts\n", encoding="utf-8")
        moved: Step = (
            "browser-chosen",
            [*BROWSER[1][:-1], "--specs=../tmp/elsewhere/chosen.txt"],
            "web",
            0,
            "",
        )

        code, said = self.judged(self.record("moved", [TYPOS, SUBJECTS, moved]), full)

        self.assertEqual(run_record.PASSED, code, said)
        # The control: a list of other specs at that path is another step.
        elsewhere.write_text("production-one.spec.ts\n", encoding="utf-8")
        code, said = self.judged(self.record("fewer", [TYPOS, SUBJECTS, moved]), full)
        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step browser-specs reads web/src/App.vue", said)

    def test_a_failed_step_that_still_counts_fails_the_chain_and_a_newer_pass_replaces_it(
        self,
    ) -> None:
        failed_lint: Step = (LINT[0], LINT[1], LINT[2], 1, "")
        full = self.record("full", [TYPOS, SUBJECTS, failed_lint])
        self.write("docs/guides/use.md", "how to use it\n")
        self.commit("docs: say how to use it")

        code, said = self.judged(self.record("small", [TYPOS, SUBJECTS]), full)

        self.assertEqual(run_record.FAILED, code, said)
        self.assertTrue(said.rstrip().endswith("failed: npm-run-lint"), said)
        code, said = self.judged(self.record("again", [TYPOS, SUBJECTS, LINT]), full)
        self.assertEqual(run_record.PASSED, code, said)


class NpmTestTests(ChainCase):
    def test_a_passed_npm_test_counts_for_the_web_steps_its_test_script_runs(self) -> None:
        # The lint:types step is the one `lint` runs, so it is covered through two scripts.
        full = self.record(
            "full",
            [TYPOS, SUBJECTS, UNIT, LINT, LINT_TYPES, TYPECHECK, UI_SYSTEM, LINT_DEAD, NPM_TEST],
        )
        self.write("DESIGN.md", "# Design\n\nA new rule.\n")
        self.commit("docs(design): state a new rule")

        code, said = self.judged(self.record("newest", [TYPOS, SUBJECTS, NPM_TEST]), full)

        self.assertEqual(run_record.PASSED, code, said)
        self.assertIn(f"accepted: a chain of 2 records, the newest at {self.head()}", said)
        # The control: a failed npm test covers nothing, so the same chain is refused.
        code, said = self.judged(self.record("failed", [TYPOS, SUBJECTS, FAILED_NPM_TEST]), full)
        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step npm-run-lint reads DESIGN.md, which changed since", said)

    def test_without_a_newer_npm_test_the_web_steps_it_runs_are_refused_naming_them(self) -> None:
        full = self.record(
            "full", [TYPOS, SUBJECTS, UNIT, LINT, TYPECHECK, UI_SYSTEM, LINT_DEAD, NPM_TEST]
        )
        self.write("DESIGN.md", "# Design\n\nA new rule.\n")
        self.commit("docs(design): state a new rule")

        code, said = self.judged(self.record("newest", [TYPOS, SUBJECTS]), full)

        self.assertEqual(run_record.REFUSED, code, said)
        for name in (
            "npm-run-lint",
            "npm-run-typecheck",
            "npm-run-check-ui-system",
            "npm-run-lint-dead",
            "npm-test",
        ):
            self.assertIn(f"step {name} reads DESIGN.md, which changed since", said)

    def test_a_web_step_outside_the_test_script_is_not_covered_by_npm_test(self) -> None:
        full = self.record("full", [TYPOS, SUBJECTS, UNIT, BUILD, NPM_TEST])
        self.write("DESIGN.md", "# Design\n\nA new rule.\n")
        self.commit("docs(design): state a new rule")

        code, said = self.judged(self.record("newest", [TYPOS, SUBJECTS, NPM_TEST]), full)

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step npm-run-build reads DESIGN.md, which changed since", said)
        self.assertNotIn("step npm-test reads", said, "the newer record ran npm test")

    def test_the_expansion_follows_the_test_script_of_web_package_json(self) -> None:
        without_lint = {
            "scripts": {
                "test": "npm run typecheck && npm run check:ui-system && npm run lint:dead",
                "lint": PACKAGE["scripts"]["lint"],
                "lint:types": PACKAGE["scripts"]["lint:types"],
            }
        }
        self.write("web/package.json", json.dumps(without_lint, indent=2) + "\n")
        self.commit("chore(web): take lint out of the test script")
        full = self.record("full", [TYPOS, SUBJECTS, LINT, NPM_TEST])
        self.write("DESIGN.md", "# Design\n\nA new rule.\n")
        self.commit("docs(design): state a new rule")

        code, said = self.judged(self.record("newest", [TYPOS, SUBJECTS, NPM_TEST]), full)

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step npm-run-lint reads DESIGN.md, which changed since", said)
        # The control: the same lint run in the newest record is what the chain needs.
        linted = self.record("linted", [TYPOS, SUBJECTS, LINT, NPM_TEST])
        self.assertEqual(run_record.PASSED, self.judged(linted, full)[0])


class PlacementTests(ChainCase):
    def test_a_path_no_rule_places_touches_every_step_of_the_earlier_record(self) -> None:
        full = self.record("full", [TYPOS, SUBJECTS, UNIT, LINT])
        self.write("requirements-dev.txt", "ruff==1.0\n")
        self.commit("build: pin ruff")

        code, said = self.judged(self.record("small", [TYPOS, SUBJECTS]), full)

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn(
            "step npm-run-lint may read requirements-dev.txt, which changed since"
            f" {self.git('rev-parse', 'HEAD~1').strip()} and which no rule places",
            said,
        )
        self.assertIn(
            "step unit ran tests.test_app, which requirements-dev.txt, which no rule", said
        )

    def changed_after_full(self, path: str, text: str) -> tuple[Path, str]:
        """A record of every kind of step, then a commit of `path` alone, and what is refused."""

        full = self.record("full", FULL)
        self.write(path, text)
        self.commit(f"chore: change {path}")
        code, said = self.judged(self.record("small", [TYPOS, SUBJECTS]), full)
        self.assertEqual(run_record.REFUSED, code, said)
        self.assertNotIn("no rule places", said)
        return full, said

    def assert_touches(self, said: str, touched: Sequence[str], untouched: Sequence[str]) -> None:
        for name in touched:
            self.assertIn(f"step {name} ", said)
        for name in untouched:
            self.assertNotIn(f"step {name} ", said)

    def test_a_desktop_file_touches_the_tests_and_the_report_and_no_lint_web_or_browser(
        self,
    ) -> None:
        full, said = self.changed_after_full("desktop/main.js", "app.start()\n")

        self.assertIn("step unit ran tests.test_app, which may read desktop/main.js by", said)
        self.assertIn("step unit ran tests.test_docs, which may read desktop/main.js by", said)
        self.assertIn("step report reads tests.test_app, which may read desktop/main.js", said)
        self.assert_touches(
            said,
            ["audit", "unit", "report"],
            ["npm-run-lint", "browser-specs", "ruff", "mypy", "vulture", "semgrep"],
        )
        # The control: the tests and the report run again complete the chain.
        again = self.record("again", [TYPOS, SUBJECTS, AUDIT, UNIT, REPORT])
        self.assertEqual(run_record.PASSED, self.judged(again, full)[0])

    def test_pyproject_touches_the_python_tools_the_tests_and_the_report_and_not_the_web(
        self,
    ) -> None:
        full, said = self.changed_after_full("pyproject.toml", "[tool.ruff]\nline-length = 99\n")

        self.assertIn("step ruff reads pyproject.toml, which changed since", said)
        self.assertIn("step report reads pyproject.toml, which changed since", said)
        self.assert_touches(
            said,
            ["audit", "unit", "report", "ruff", "mypy", "vulture"],
            ["npm-run-lint", "browser-specs", "semgrep"],
        )
        again = self.record("again", [TYPOS, SUBJECTS, AUDIT, UNIT, REPORT, RUFF, MYPY, VULTURE])
        self.assertEqual(run_record.PASSED, self.judged(again, full)[0])

    def test_a_python_file_of_windows_touches_what_reads_every_python_file_and_not_vulture(
        self,
    ) -> None:
        full, said = self.changed_after_full("windows/release.py", "print('release')\n")

        self.assertIn("step ruff reads windows/release.py, which changed since", said)
        self.assertIn("step unit ran tests.test_app, which may read windows/release.py", said)
        self.assert_touches(
            said,
            ["audit", "unit", "report", "ruff", "mypy"],
            ["vulture", "npm-run-lint", "browser-specs", "semgrep"],
        )
        again = self.record("again", [TYPOS, SUBJECTS, AUDIT, UNIT, REPORT, RUFF, MYPY])
        self.assertEqual(run_record.PASSED, self.judged(again, full)[0])

    def test_the_tray_script_the_server_starts_touches_the_browser_suite_and_not_ruff(
        self,
    ) -> None:
        _, said = self.changed_after_full("windows/tray.ps1", "Write-Output tray\n")

        self.assertIn("step browser-specs reads windows/tray.ps1, which changed since", said)
        self.assert_touches(
            said,
            ["audit", "unit", "report", "browser-specs"],
            ["ruff", "mypy", "vulture", "npm-run-lint", "semgrep"],
        )

    def test_a_workflow_touches_the_audit_the_tests_and_the_report_alone(self) -> None:
        full, said = self.changed_after_full(".github/workflows/ci.yml", "on: push\n")

        self.assertIn("step audit reads every file or commit", said)
        self.assert_touches(
            said,
            ["audit", "unit", "report"],
            ["ruff", "mypy", "vulture", "npm-run-lint", "browser-specs", "semgrep"],
        )
        again = self.record("again", [TYPOS, SUBJECTS, AUDIT, UNIT, REPORT])
        self.assertEqual(run_record.PASSED, self.judged(again, full)[0])

    def test_a_ruff_step_reads_the_files_it_names_and_not_one_whose_name_they_begin(
        self,
    ) -> None:
        self.write("tests/test_release.py", "RELEASE = 1\n")
        self.commit("test: the release")
        named: Step = (
            "ruff-named",
            [sys.executable, "-m", "ruff", "check", "windows/release.py", "tests/test_release.py"],
            "",
            0,
            "",
        )
        full = self.record("full", [TYPOS, SUBJECTS, named, MYPY])
        self.write("tests/test_released.py", "RELEASED = 1\n")
        self.commit("test: the released")

        code, said = self.judged(self.record("small", [TYPOS, SUBJECTS]), full)

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step mypy reads tests/test_released.py", said)
        self.assertNotIn("step ruff-named", said)
        # The control: a change of a file it names touches it.
        self.write("tests/test_release.py", "RELEASE = 2\n")
        self.commit("test: the release again")
        code, said = self.judged(self.record("later", [TYPOS, SUBJECTS]), full)
        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step ruff-named reads tests/test_release.py, which changed since", said)

    def test_an_update_of_the_vendored_release_kit_needs_again_only_the_audit_and_its_namers(
        self,
    ) -> None:
        audit: Step = (
            "audit",
            [sys.executable, ".github/relkit.pyz", "audit", "--history"],
            "",
            0,
            "",
        )
        report: Step = ("report", [sys.executable, "-m", "coverage", "report"], "", 0, "")
        self.write(".github/relkit.pyz", "0.36.0\n")
        self.commit("build: vendor release-kit 0.36.0")
        full = self.record("full", [TYPOS, SUBJECTS, audit, UNIT, report, LINT, BROWSER])
        self.write(".github/relkit.pyz", "0.37.0\n")
        self.commit("build: update release-kit to 0.37.0")

        code, said = self.judged(self.record("small", [TYPOS, SUBJECTS]), full)

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertNotIn("no rule places", said)
        self.assertIn("step audit reads every file or commit", said)
        self.assertIn("step unit ran tests.test_docs, which names .github/relkit.pyz", said)
        self.assertIn("step report reads tests.test_docs, which names .github/relkit.pyz", said)
        self.assertNotIn("tests.test_app", said)
        self.assertNotIn("npm-run-lint", said)
        self.assertNotIn("browser-specs", said)
        # The control: the audit, the module that names the file and the report that reads
        # it, run again, complete the chain.
        docs: Step = ("docs", [sys.executable, "-m", "unittest", "tests.test_docs"], "", 0, "")
        again = self.record("again", [TYPOS, SUBJECTS, audit, docs, report])
        self.assertEqual(run_record.PASSED, self.judged(again, full)[0])

    def test_a_record_at_a_commit_head_does_not_descend_from_is_refused(self) -> None:
        self.write("docs/guides/use.md", "how to use it\n")
        self.commit("docs: say how to use it")
        small = self.record("small", [TYPOS, SUBJECTS])
        (self.other / "web" / "src" / "App.vue").write_text("<template>x</template>\n")
        self.git("-C", str(self.other), "commit", "-qam", "fix(web): say x")
        aside = self.record("aside", [LINT], tree=self.other)

        code, said = self.judged(small, aside)

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn(f"{aside} was made at {self.head(self.other)} in ", said)
        self.assertIn(f"which is not a commit this tree's HEAD {self.head()} descends from", said)

    def test_a_record_of_another_worktree_at_an_ancestor_counts(self) -> None:
        self.specs(["production-one.spec.ts", "production-two.spec.ts"], tree=self.other)
        made_there = self.record("there", [LINT, BROWSER], tree=self.other)
        self.write("docs/guides/use.md", "how to use it\n")
        self.commit("docs: say how to use it")

        code, said = self.judged(self.record("small", [TYPOS, SUBJECTS]), made_there)

        self.assertEqual(run_record.PASSED, code, said)
        self.assertIn("npm-run-lint exit=0, browser-specs exit=0", said)

    def test_an_earlier_record_of_uncommitted_changes_counts_those_paths_as_changed(self) -> None:
        self.write("web/src/App.vue", "<template>tried</template>\n")
        tried = self.record("tried", [LINT, BROWSER])
        named = json.loads(tried.read_text())["tree"]["paths"]
        self.assertEqual(["web/src/App.vue"], list(named))
        self.assertRegex(named["web/src/App.vue"], r"^[0-9a-f]{40}$")
        self.git("checkout", "--", "web/src/App.vue")
        self.write("docs/guides/use.md", "how to use it\n")
        self.commit("docs: say how to use it")
        small = self.record("small", [TYPOS, SUBJECTS])

        code, said = self.judged(small, tried)

        # The commit since that record changed a document, but the run was on a web change.
        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step browser-specs reads web/src/App.vue", said)
        unnamed = json.loads(tried.read_text())
        del unnamed["tree"]["paths"]
        tried.write_text(json.dumps(unnamed), encoding="utf-8")
        code, said = self.judged(small, tried)
        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("on uncommitted changes it does not name", said)

    def test_a_record_of_uncommitted_changes_counts_for_the_commit_that_holds_them(self) -> None:
        self.write("web/src/App.vue", "<template>two</template>\n")
        self.write("web/src/New.vue", "<template>new</template>\n")
        before = self.record("before", [LINT, BROWSER])
        self.commit("fix(web): say two")

        code, said = self.judged(self.record("after", [TYPOS, SUBJECTS]), before)

        self.assertEqual(run_record.PASSED, code, said)
        self.assertIn("npm-run-lint exit=0, browser-specs exit=0", said)
        # The control: content other than what the run read is a change since it.
        self.write("web/src/New.vue", "<template>newer</template>\n")
        self.commit("fix(web): say newer")
        code, said = self.judged(self.record("later", [TYPOS, SUBJECTS]), before)
        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step browser-specs reads web/src/New.vue", said)

    def test_no_record_of_the_tree_as_it_is_now_is_refused(self) -> None:
        full = self.record("full", [TYPOS])
        self.write("docs/guides/use.md", "how to use it\n")
        self.commit("docs: say how to use it")
        older = self.record("older", [TYPOS])
        self.write("docs/guides/use.md", "how to use it now\n")
        self.commit("docs: say how to use it now")

        code, said = self.judged(older, full)

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn(f"refused: no record describes {self.repo} as it is now", said)

    def test_require_reads_the_steps_that_count_across_the_chain(self) -> None:
        full = self.record("full", [TYPOS, SUBJECTS, LINT])
        self.write("docs/guides/use.md", "how to use it\n")
        self.commit("docs: say how to use it")
        small = self.record("small", [TYPOS, SUBJECTS])

        code, said = self.judged(small, full, required=["typos", "npm-run-lint"])
        self.assertEqual(run_record.PASSED, code, said)
        code, said = self.judged(small, full, required=["typos", "desktop-test"])
        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("no step that counts in the chain is named desktop-test", said)


class UnitTests(ChainCase):
    def test_a_test_module_a_change_reaches_counts_again_only_from_a_newer_run_of_it(
        self,
    ) -> None:
        full = self.record("full", [TYPOS, SUBJECTS, UNIT])
        self.write("server/app.py", "print('two')\n")
        self.commit("fix: say two")

        code, said = self.judged(self.record("small", [TYPOS, SUBJECTS]), full)

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step unit ran tests.test_app, which imports server.app since", said)
        self.assertNotIn("tests.test_docs", said)
        app = ("app", [sys.executable, "-m", "unittest", "tests.test_app"], "", 0, "")
        code, said = self.judged(self.record("app", [TYPOS, SUBJECTS, app]), full)
        self.assertEqual(run_record.PASSED, code, said)
        self.assertIn("unit exit=0", said, "unit still counts for tests.test_docs")

    def test_a_whole_suite_is_carried_by_a_rerun_of_the_modules_a_change_reaches(self) -> None:
        whole = ("unittest", [sys.executable, "tests/parallel.py", "--coverage"], "", 0, "")
        full = self.record("full", [TYPOS, SUBJECTS, whole])
        self.write("docs/rules.md", "new rules\n")
        self.commit("docs: change the rules")

        code, said = self.judged(self.record("small", [TYPOS, SUBJECTS]), full)
        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step unittest ran tests.test_docs, which names docs/rules.md since", said)

        one_case = (
            "case",
            [sys.executable, "-m", "unittest", "tests.test_docs.Case.test_a"],
            "",
            0,
            "",
        )
        code, said = self.judged(self.record("case", [TYPOS, SUBJECTS, one_case]), full)
        self.assertEqual(run_record.REFUSED, code, "one test of a module is not the module")
        selected = (
            "affected",
            [sys.executable, "tests/affected.py", "HEAD~1..HEAD"],
            "",
            0,
            "tests.test_docs\n1 test modules for 1 changed files\n",
        )
        code, said = self.judged(self.record("selected", [TYPOS, SUBJECTS, selected]), full)
        self.assertEqual(run_record.PASSED, code, said)
        # The control: a log that does not say how many it selected places no module.
        unsaid: Step = (selected[0], selected[1], selected[2], selected[3], "tests.test_docs\n")
        code, said = self.judged(self.record("unsaid", [TYPOS, SUBJECTS, unsaid]), full)
        self.assertEqual(run_record.REFUSED, code, said)

    def test_a_run_on_another_python_neither_sets_aside_nor_hides_a_run_of_the_suite(
        self,
    ) -> None:
        def whole(name: str, python: str, code: int) -> Step:
            return (name, [python, "tests/parallel.py", "--coverage"], "", code, "")

        new, old = "C:/Python315/python.exe", "C:/Python311/python.exe"
        failed = self.record("gates", [TYPOS, SUBJECTS, whole("unittest", new, 1)])
        self.write("server/other.py", "print('other')\n")
        self.commit("fix: another file no test reaches")

        on_old = self.record("old", [TYPOS, SUBJECTS, whole("unittest-311", old, 0)])
        code, said = self.judged(on_old, failed, required=["unittest"])
        self.assertEqual(run_record.FAILED, code, said)
        self.assertIn("unittest exit=1", said)
        self.assertIn("unittest-311 exit=0", said)
        # The control: a rerun on the same Python sets the failed run aside.
        rerun = self.record("rerun", [TYPOS, SUBJECTS, whole("rerun", new, 0)])
        code, said = self.judged(rerun, failed)
        self.assertEqual(run_record.PASSED, code, said)
        self.assertNotIn("unittest exit=1", said)

    def test_a_touched_module_counts_again_only_from_a_run_of_it_on_the_same_python(
        self,
    ) -> None:
        new, old = "C:/Python315/python.exe", "C:/Python311/python.exe"
        full = self.record(
            "full", [TYPOS, SUBJECTS, ("unittest", [new, "tests/parallel.py"], "", 0, "")]
        )
        self.write("server/app.py", "print('two')\n")
        self.commit("fix: say two")

        def app(python: str) -> Step:
            return ("app", [python, "-m", "unittest", "tests.test_app"], "", 0, "")

        code, said = self.judged(self.record("on-old", [TYPOS, SUBJECTS, app(old)]), full)
        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step unittest ran tests.test_app, which imports server.app since", said)
        code, said = self.judged(self.record("on-new", [TYPOS, SUBJECTS, app(new)]), full)
        self.assertEqual(run_record.PASSED, code, said)


class MergeTests(ChainCase):
    def test_a_merge_carries_a_branch_record_for_steps_the_other_side_did_not_touch(self) -> None:
        (self.other / "web" / "src" / "App.vue").write_text("<template>x</template>\n")
        self.git("-C", str(self.other), "commit", "-qam", "fix(web): say x")
        self.specs(["production-one.spec.ts", "production-two.spec.ts"], tree=self.other)
        branch = self.record("branch", [TYPOS, SUBJECTS, UNIT, LINT, BROWSER], tree=self.other)
        self.write("docs/guides/use.md", "how to use it\n")
        self.commit("docs: say how to use it")
        self.git("merge", "-q", "--no-ff", "-m", "chore: merge other", "other")

        code, said = self.judged(self.record("merged", [TYPOS, SUBJECTS]), branch)

        self.assertEqual(run_record.PASSED, code, said)
        self.assertIn("unit exit=0, npm-run-lint exit=0, browser-specs exit=0", said)
        # The control: once the other side changed a web source, the branch's web runs do not hold.
        self.write("web/src/Other.vue", "<template>y</template>\n")
        self.commit("fix(web): say y")
        code, said = self.judged(self.record("later", [TYPOS, SUBJECTS]), branch)
        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("step browser-specs reads web/src/Other.vue", said)
        self.assertIn("step npm-run-lint reads web/src/Other.vue", said)


class SingleRecordTests(ChainCase):
    def test_one_record_is_checked_as_before_the_chain(self) -> None:
        record = self.record("one", [TYPOS, LINT])
        with mock.patch.object(record_chain, "check", side_effect=AssertionError("a chain")):
            code, said = self.judged(record, required=["typos"])
        self.assertEqual(run_record.PASSED, code, said)
        self.assertIn(f"accepted: {record} was made in ", said)


class ListTests(test_run_record.TreeCase):
    def test_run_keeps_what_a_specs_list_named(self) -> None:
        listed = self.repo / "tmp" / "specs.txt"
        listed.parent.mkdir(parents=True)
        listed.write_text("b.spec.ts\na.spec.ts\n\n", encoding="utf-8")
        out = self.repo / "tmp" / "checks"
        with (
            mock.patch.object(run_record, "tool_versions", return_value={}),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            for words in (["--specs=tmp/specs.txt"], ["--specs=tmp/none.txt"], []):
                run_record.run(
                    out,
                    ["python", "-c", "pass", *words],
                    cwd=self.repo,
                    name=None,
                    environment={},
                    root=self.repo,
                )
        steps = json.loads((out / run_record.NAME).read_text(encoding="utf-8"))["steps"]
        self.assertEqual({"tmp/specs.txt": ["a.spec.ts", "b.spec.ts"]}, steps[0]["lists"])
        self.assertEqual({"tmp/none.txt": None}, steps[1]["lists"])
        self.assertNotIn("lists", steps[2])


class ThisCheckoutTests(unittest.TestCase):
    def test_the_reach_is_this_checkouts_import_graph_and_refuses_another_tree(self) -> None:
        reach = record_chain.reach_for(str(ROOT))
        # test_docs_lifecycle reads DESIGN.md by name, as every document at the top.
        self.assertIn("tests.test_docs_lifecycle", reach.reached(["DESIGN.md"]))
        self.assertIn("tests.test_record_chain", reach.modules)
        with self.assertRaisesRegex(record_chain.ReachRefusedError, "that tree's own"):
            record_chain.reach_for(str(ROOT / "tmp"))

    def test_every_file_a_browser_source_climbs_out_of_web_to_is_one_the_browser_rule_reads(
        self,
    ) -> None:
        web = ROOT / "web"
        sources = [web / "playwright.config.ts", web / "vite.config.ts"]
        sources += sorted(path for path in (web / "tests" / "browser").rglob("*") if path.is_file())
        names = record_chain.Names(str(ROOT))
        found: dict[str, str] = {}
        for source in sources:
            for climb in re.findall(r"(?:\.\./)+[\w.][\w./-]*", source.read_text(encoding="utf-8")):
                target = (source.parent / climb).resolve()
                if target.is_relative_to(web) or not target.is_relative_to(ROOT):
                    continue
                found[target.relative_to(ROOT).as_posix()] = source.name
        self.assertIn("valkama.py", found, "the server the configuration starts is among them")
        for path, named_by in found.items():
            with self.subTest(path=path, source=named_by):
                read = record_chain.reads(record_chain.BROWSER, path, names)
                self.assertTrue(read or not record_chain.placed(path))

    def test_every_tracked_path_is_placed_or_listed_as_an_input_of_every_step(self) -> None:
        def declared(path: str) -> bool:
            top, nested, _ = path.partition("/")
            return record_chain.placed(path) or top + ("/" if nested else "") in (
                record_chain.EVERY_STEP
            )

        tracked = record_chain._git(str(ROOT), "ls-files", "-z")
        self.assertGreater(len(tracked), 100)
        self.assertEqual([], [path for path in tracked if not declared(path)])
        tops = {path.split("/", 1)[0] + ("/" if "/" in path else "") for path in tracked}
        for name in record_chain.EVERY_STEP:
            with self.subTest(name=name):
                self.assertIn(name, tops, "an entry no tracked path has is stale")
                self.assertFalse(record_chain.placed(name.rstrip("/") + "/x"))
        # The controls: a new top-level directory or file is neither.
        self.assertFalse(declared("newtop/file.txt"))
        self.assertFalse(declared("NEWFILE"))

    def test_every_file_the_served_server_reads_beside_it_is_one_the_browser_rule_reads(
        self,
    ) -> None:
        from server.ops import toast, tray

        names = record_chain.Names(str(ROOT))
        found = [*tray.assets(str(ROOT)), *toast.assets(str(ROOT))]
        self.assertEqual(4, len(found))
        for full in found:
            path = Path(full).relative_to(ROOT).as_posix()
            with self.subTest(path=path):
                self.assertTrue(record_chain.placed(path))
                self.assertTrue(record_chain.reads(record_chain.BROWSER, path, names))


class PlaceTests(unittest.TestCase):
    """What each command a record keeps reads, by its words."""

    def placed(self, argv: list[str], cwd: str = "C:/tree") -> record_chain.Placement:
        entry: Mapping[str, object] = {"argv": argv, "cwd": cwd, "log": "x.log"}
        return record_chain.place(entry, "C:/tree", Path("C:/none"))

    def test_each_kind_of_command_is_placed(self) -> None:
        python = "C:/Python315/python.exe"
        cases = {
            record_chain.NEWEST: [
                ["C:/tools/typos.EXE"],
                [python, "tests/commit_subjects.py"],
                [python, ".github/relkit.pyz", "audit", "--history"],
                [python, "-c", "pass"],
                [python, "-m", "unittest", "-k", "fast", "tests.test_x"],
                [python, "tests/affected.py", "--list"],
                [python, "windows/release.py", "check"],
                ["C:/node/npm.CMD", "test"],
            ],
            record_chain.PYTHON: [[python, "-m", "ruff", "check", "."], ["C:/x/lint-imports.exe"]],
            record_chain.SEMGREP: [["C:/env/semgrep.exe", "scan"]],
            record_chain.COVERAGE: [
                [python, "-m", "coverage", "report"],
                [python, "windows/release.py", "coverage-margin"],
            ],
        }
        for kind, commands in cases.items():
            for argv in commands:
                with self.subTest(argv=argv):
                    self.assertEqual(kind, self.placed(argv).kind)
        self.assertEqual(
            record_chain.WEB, self.placed(["C:/node/npm.CMD", "test"], "C:/tree/web").kind
        )
        browser = ["C:/node/npm.CMD", "run", "test:browser:allowed", "--", SPECS]
        self.assertEqual(record_chain.BROWSER, self.placed(browser, "C:/tree/web").kind)

    def test_a_ruff_or_vulture_step_is_placed_with_the_paths_it_names(self) -> None:
        python = "C:/Python315/python.exe"
        named = ("windows/release.py", "tests/test_release.py")
        cases: dict[tuple[tuple[str, ...], str], tuple[str, ...] | None] = {
            (("-m", "ruff", "check", "."), "C:/tree"): None,
            (("-m", "ruff", "format", "--check", "."), "C:/tree"): None,
            (("-m", "ruff", "check"), "C:/tree"): None,
            (("-m", "ruff", "check", *named), "C:/tree"): named,
            (("-m", "ruff", "check", "--output-format", "concise", "x.py"), "C:/tree"): None,
            (("-m", "ruff", "check", "../tests/x.py"), "C:/tree/web"): ("tests/x.py",),
            (("-m", "ruff", "check", "../outside.py"), "C:/tree"): None,
            (("-m", "vulture", "server", "tests", "--min-confidence", "60"), "C:/tree"): (
                "server",
                "tests",
            ),
            (("-m", "vulture", "server", "--exclude", "x"), "C:/tree"): None,
        }
        for (words, cwd), scope in cases.items():
            with self.subTest(words=words, cwd=cwd):
                found = self.placed([python, *words], cwd)
                self.assertEqual(record_chain.PYTHON, found.kind)
                self.assertEqual(scope, found.scope)

    def test_a_scoped_python_step_reads_its_files_their_directories_and_configuration(
        self,
    ) -> None:
        names = record_chain.Names("C:/none")
        scope = ("tests/test_release.py", "server")
        cases = {
            "tests/test_release.py": True,
            "tests/test_released.py": False,
            "server/app.py": True,
            "server/sub/app.py": True,
            "server_old/app.py": False,
            "server/notes.md": False,
            "pyproject.toml": True,
            "windows/release.py": False,
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                found = record_chain.reads(record_chain.PYTHON, path, names, scope)
                self.assertEqual(expected, found)
        self.assertTrue(record_chain.reads(record_chain.PYTHON, "windows/release.py", names))

    def test_the_identity_of_a_browser_run_is_its_specs_and_not_its_list_file(self) -> None:
        def identity(words: list[str], lists: Mapping[str, list[str] | None]) -> tuple[object, ...]:
            entry = {"argv": ["C:/node/npm.CMD", *words], "cwd": "C:/tree/web", "lists": lists}
            return record_chain.identity(entry, "C:/tree")

        run = ["run", "test:browser:allowed", "--"]
        one = identity([*run, "--specs=a.txt"], {"a.txt": ["x.spec.ts", "y.spec.ts"]})
        self.assertEqual(
            one, identity([*run, "--specs=b.txt"], {"b.txt": ["y.spec.ts", "x.spec.ts"]})
        )
        self.assertNotEqual(one, identity([*run, "--specs=a.txt"], {"a.txt": ["x.spec.ts"]}))
        self.assertNotEqual(
            one,
            identity(
                [*run, "--with-clipboard=z", "--specs=b.txt"], {"b.txt": ["x.spec.ts", "y.spec.ts"]}
            ),
        )
        # A list `run` could not read, and two lists, the runner reading the last, keep their paths.
        self.assertNotEqual(
            identity([*run, "--specs=a.txt"], {"a.txt": None}),
            identity([*run, "--specs=b.txt"], {"b.txt": None}),
        )
        both = {"a.txt": ["x.spec.ts"], "b.txt": ["y.spec.ts"]}
        self.assertNotEqual(
            identity([*run, "--specs=a.txt", "--specs=b.txt"], both),
            identity([*run, "--specs=b.txt", "--specs=a.txt"], both),
        )

    def test_a_unittest_run_is_placed_with_the_tests_it_ran(self) -> None:
        python = "C:/Python315/python.exe"
        cases: dict[tuple[str, ...], frozenset[str] | None] = {
            ("-m", "unittest", "-v", "tests.test_x", "tests/test_y.py"): frozenset(
                {"tests.test_x", "tests.test_y"}
            ),
            ("-m", "unittest", "discover", "-s", ".", "-p", "test_*.py"): None,
            ("tests/parallel.py", "--coverage", "--jobs", "4"): None,
            ("tests/parallel.py", "tests.test_x"): frozenset({"tests.test_x"}),
            ("-m", "coverage", "run", "-m", "unittest", "tests.test_x.Case"): frozenset(
                {"tests.test_x.Case"}
            ),
        }
        for words, units in cases.items():
            with self.subTest(words=words):
                found = self.placed([python, *words])
                self.assertEqual((record_chain.UNITS, units), (found.kind, found.units))


if __name__ == "__main__":
    unittest.main()
