"""`tests/affected.py`: which test modules a change reaches.

The small graphs below are written by hand, so each rule is seen alone. The
cases on history are changes whose targeted runs, chosen by hand, left a module
that imports the changed code red for the next change to find.
"""

from __future__ import annotations

import sys
import unittest
from collections.abc import Mapping
from typing import ClassVar

import grimp

from server import processes
from tests import affected


def graph(imports: Mapping[str, tuple[str, ...]], *modules: str) -> grimp.ImportGraph:
    """A graph of `importer: (imported, ...)`, with `modules` that import nothing."""

    built = grimp.ImportGraph()
    for module in modules:
        built.add_module(module)
    for importer, imported in imports.items():
        built.add_module(importer)
        for target in imported:
            built.add_import(importer=importer, imported=target)
    return built


def chosen(changed: list[str], built: grimp.ImportGraph, sources: Mapping[str, str] | None = None):
    return set(affected.select(changed, built, sources or {}))


class ImportsTest(unittest.TestCase):
    GRAPH: ClassVar[dict[str, tuple[str, ...]]] = {
        "tests.test_direct": ("server.alpha",),
        "tests.helper": ("server.alpha",),
        "tests.test_through_a_helper": ("tests.helper",),
        "server.beta": ("server.alpha",),
        "tests.test_through_the_server": ("server.beta",),
        "tests.test_elsewhere": ("server.gamma",),
        "tests.test_a_submodule": ("server.pkg.inner",),
    }

    def setUp(self) -> None:
        self.graph = graph(self.GRAPH, "server.alpha", "server.gamma", "server.pkg")

    def test_a_module_reaches_its_importers_however_far_up_they_are(self) -> None:
        self.assertEqual(
            {"tests.test_direct", "tests.test_through_a_helper", "tests.test_through_the_server"},
            chosen(["server/alpha.py"], self.graph) - set(affected.SURFACES),
        )

    def test_only_test_modules_are_named_never_a_helper_they_import(self) -> None:
        self.assertNotIn("tests.helper", chosen(["server/alpha.py"], self.graph))

    def test_a_changed_test_module_and_a_changed_helper_reach_what_imports_them(self) -> None:
        self.assertEqual({"tests.test_direct"}, chosen(["tests/test_direct.py"], self.graph))
        self.assertEqual({"tests.test_through_a_helper"}, chosen(["tests/helper.py"], self.graph))

    def test_a_package_init_reaches_whatever_imports_a_module_under_it(self) -> None:
        # Every import of `server.pkg.inner` runs `server/pkg/__init__.py` first.
        self.assertIn("tests.test_a_submodule", chosen(["server/pkg/__init__.py"], self.graph))

    def test_a_module_reaches_nothing_that_does_not_import_it(self) -> None:
        self.assertNotIn("tests.test_elsewhere", chosen(["server/alpha.py"], self.graph))


class NamedFilesTest(unittest.TestCase):
    """A test that reads a file names it; how the suite's tests spell that name."""

    def setUp(self) -> None:
        self.graph = graph(
            {"tests.test_imports_the_reader": ("tests.reader",)},
            "tests.test_doc",
            "tests.test_joined",
            "tests.test_split",
            "tests.test_folder",
            "tests.test_unrelated",
            "tests.reader",
        )

    def selected(self, path: str, sources: Mapping[str, str]) -> set[str]:
        return chosen([path], self.graph, sources)

    def test_a_document_is_named_by_its_repository_path(self) -> None:
        sources = {
            "tests/test_doc.py": '"""Each answer is the one docs/contract.md states."""\n',
            "tests/test_unrelated.py": 'NAME = "docs/contract.md.orig"\n',
        }
        self.assertEqual({"tests.test_doc"}, self.selected("docs/contract.md", sources))

    def test_a_file_is_named_by_a_string_that_ends_in_its_name(self) -> None:
        sources = {
            "tests/test_joined.py": 'SKILL = ROOT / "server" / "skill" / "app"\n'
            'BODY = (SKILL / "SKILL.md").read_text()\n',
            "tests/test_split.py": 'open(os.path.join(ROOT, "server", "skill", "app", "SKILL.md"))\n',
            "tests/test_unrelated.py": "# reads the skill's SKILL\n",
        }
        self.assertEqual(
            {"tests.test_joined", "tests.test_split"},
            self.selected("server/skill/app/SKILL.md", sources) - set(affected.SURFACES),
        )

    def test_a_file_read_with_its_whole_directory_is_named_by_the_directory(self) -> None:
        sources = {
            "tests/test_folder.py": 'FIXTURES = ROOT / "web" / "tests" / "fixtures" / "server"\n',
            "tests/test_unrelated.py": 'FIXTURES = ROOT / "web" / "tests"\n',
        }
        self.assertEqual(
            {"tests.test_folder"},
            self.selected("web/tests/fixtures/server/card.json", sources),
        )

    def test_a_helper_that_names_a_file_reaches_the_tests_that_import_it(self) -> None:
        sources = {"tests/reader.py": 'DUMP = HERE / "fixtures" / "schema-8.sql"\n'}
        self.assertEqual(
            {"tests.test_imports_the_reader"},
            self.selected("tests/fixtures/schema-8.sql", sources),
        )

    def test_a_python_file_outside_the_graph_is_named_too(self) -> None:
        # `valkama.py` and the fixture scripts a test runs are no module of the graph.
        sources = {"tests/test_doc.py": 'subprocess.run([sys.executable, ROOT / "valkama.py"])\n'}
        self.assertEqual({"tests.test_doc"}, self.selected("valkama.py", sources))


class SurfacesTest(unittest.TestCase):
    #: The modules that hold every MCP tool, every HTTP path and every web contract
    #: fixture: a new tool, route or field anywhere in the server turns them red.
    WHOLE_SURFACES: ClassVar[set[str]] = {
        "tests.test_planning_work_model_surfaces",
        "tests.test_planning_api",
        "tests.test_web_contract_fixtures",
    }

    def setUp(self) -> None:
        self.graph = graph({}, "server.alpha", "tests.test_other")

    def test_every_change_of_the_server_runs_the_surfaces_whatever_it_imports(self) -> None:
        for path in ("server/alpha.py", "server/skill/app/SKILL.md"):
            with self.subTest(path=path):
                self.assertLessEqual(self.WHOLE_SURFACES, chosen([path], self.graph))
                self.assertLessEqual(set(affected.SURFACES), chosen([path], self.graph))

    def test_a_change_outside_the_server_runs_no_surface_it_does_not_reach(self) -> None:
        self.assertEqual(set(), chosen(["docs/guide.md", "web/src/main.ts"], self.graph))

    def test_each_surface_is_a_test_module_of_the_real_graph(self) -> None:
        real = affected.build_graph()
        for module in affected.SURFACES:
            with self.subTest(module=module):
                self.assertIn(module, real.modules)
                self.assertTrue(affected.is_test_module(module))


class WebTest(unittest.TestCase):
    def test_a_web_source_is_handed_to_the_web_command_and_the_build_is_not(self) -> None:
        command = affected.web_command(
            ["web/src/shared/api/planningModel.ts", "web/dist/index.html", "server/http_surface.py"]
        )
        self.assertEqual(["npx", "vitest", "related", "--run"], command[:4])
        self.assertEqual(["src/shared/api/planningModel.ts"], command[-1:])
        self.assertNotIn("dist/index.html", command)

    def test_no_web_change_gives_no_command(self) -> None:
        self.assertEqual([], affected.web_command(["web/dist/index.html", "docs/guide.md"]))


class RunTest(unittest.TestCase):
    UNITTEST: ClassVar[list[str]] = [sys.executable, "-m", "unittest"]

    def test_a_quarter_of_the_test_modules_or_fewer_runs_without_the_lock(self) -> None:
        self.assertEqual(
            [*self.UNITTEST, "tests.test_a"], affected.run_command(["tests.test_a"], 4)
        )

    def test_a_larger_selection_waits_for_the_machines_heavy_test_lock(self) -> None:
        command = affected.run_command(["tests.test_a", "tests.test_b"], 4)
        self.assertEqual(
            [sys.executable, str(affected.ROOT / "tests" / "machine_lock.py"), "run"], command[:3]
        )
        self.assertEqual(
            [*self.UNITTEST, "tests.test_a", "tests.test_b"], command[command.index("--") + 1 :]
        )


def present(commit: str) -> bool:
    found = processes.run_text(
        ["git", "-C", str(affected.ROOT), "cat-file", "-e", f"{commit}^{{commit}}"]
    )
    return found.returncode == 0


class HistoryTest(unittest.TestCase):
    """Each change named a module that imports its code, and its targeted run left it out."""

    CASES: ClassVar[dict[str, set[str]]] = {
        # The groups take what their single writes take, and the change rewrote both.
        "dfadab9f0": {"tests.test_planning_apply_groups"},
        # A read's statements and the stores an earlier build wrote.
        "bbfe097e2": {"tests.test_planning_scale", "tests.test_planning_exact_api"},
        # A new HTTP path that the surface test calls every path of.
        "d0a4defca": {"tests.test_planning_work_model_surfaces"},
        # A new card field that the full record of an exact read holds.
        "19c1618e": {"tests.test_planning_api"},
    }

    @classmethod
    def setUpClass(cls) -> None:
        cls.graph = affected.build_graph()
        cls.sources = affected.test_sources()

    def test_each_change_names_the_module_its_hand_chosen_run_left_out(self) -> None:
        for commit, missed in self.CASES.items():
            with self.subTest(commit=commit):
                if not present(commit):
                    self.skipTest(f"{commit} is not in this clone's history")
                changed = affected.changed_files(f"{commit}~1..{commit}", staged=False)
                self.assertLessEqual(
                    missed, set(affected.select(changed, self.graph, self.sources))
                )

    def test_a_change_of_this_script_names_its_own_tests(self) -> None:
        self.assertIn(
            "tests.test_affected", affected.select(["tests/affected.py"], self.graph, self.sources)
        )


if __name__ == "__main__":
    unittest.main()
