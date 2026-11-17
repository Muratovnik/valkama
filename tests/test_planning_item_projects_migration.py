"""Labels carried into the projects of work items, as the work-model migration does it.

`valkama projects map-items` reads a store Valkama 2.9 left, the registry and Git,
and writes the file the migration gives each task its projects by. The migration
first checks that file, the registry and the store, before its recovery point and
before any write; then `item-projects` writes the projects and `labels` takes off
the labels a project now carries. Every store is the one the migration's own tests
build, with labels and commit refs added in the plain SQL 2.9 wrote, and the
repositories are made by git.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import cli, processes, store
from server.planning import item_projects, words
from server.store_identity.refs import planning_space_entity
from tests import registry_fixtures, schema17
from tests.test_planning_work_model_migration import (
    DATA_SCOPE,
    StoreCase,
    file_digest,
    identity,
    item_projects_file,
    registry,
)


def bound(directory: str, key: str, project: str, *, default: bool) -> dict:
    """A registry entry binding `project` to the space `key`, its root under `directory`."""

    entity = planning_space_entity({"data_scope_id": DATA_SCOPE, "space_key": key})
    return {
        "project_id": project,
        "display_name": project.title(),
        "canonical_root": os.path.join(directory, "roots", project),
        "planning_binding": {**entity, "default": default},
    }


def git(root: str, *args: str) -> str:
    done = processes.run_text(
        [
            "git",
            "-C",
            root,
            "-c",
            "user.name=Test User",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            *args,
        ]
    )
    if done.returncode != 0:
        raise AssertionError(done.stderr)
    return done.stdout.strip()


def repository(root: str, subject: str) -> str:
    """A repository at `root` holding one commit; its full hash."""

    os.makedirs(root)
    git(root, "init", "-b", "main")
    with open(os.path.join(root, "file.txt"), "w", encoding="utf-8") as handle:
        handle.write(subject)
    git(root, "add", "file.txt")
    git(root, "commit", "-m", subject)
    return git(root, "rev-parse", "HEAD")


class PreconditionTests(StoreCase):
    """Each condition the migration starts on, refused before any write.

    A refusal leaves no recovery point, the store's bytes and logical identity as
    they were, a 2.9 store still refused by `connect()`, and a report `refused`
    naming the reason.
    """

    def assert_refused(self, says: str) -> dict:
        before, digest = identity(self.path), file_digest(self.path)
        with self.assertRaises(store.WorkModelPreconditionError) as raised:
            self.migrate()
        self.assertIn(says, str(raised.exception))
        report = raised.exception.report
        self.assertEqual("refused", report["status"])
        self.assertIn(says, report["message"])
        self.assertNotIn("recovery_point", report)
        self.assertEqual([], report["steps"])
        self.assertFalse(os.path.exists(os.path.join(self.directory.name, "backups")))
        self.assertEqual((before, digest), (identity(self.path), file_digest(self.path)))
        with self.assertRaises(store.WorkModelMigrationRequiredError):
            store.connect(self.path)
        return report

    def write_file(self, **kwargs: object) -> None:
        self.file = item_projects_file(self.path, self.directory.name, **kwargs)

    def test_a_registry_of_format_3_is_refused_naming_the_upgrade(self) -> None:
        registry(self, self.directory.name, raw=b'{"projects": [], "schema_version": 3}')
        self.assert_refused("registry.schema_version must be 4: run valkama projects upgrade first")

    def test_no_registry_is_refused_naming_the_upgrade(self) -> None:
        os.remove(os.path.join(os.environ["LOCALAPPDATA"], "Valkama", "projects.json"))
        self.assert_refused("absent: run valkama projects upgrade first")

    def test_a_space_whose_project_is_not_bound_to_it_is_refused_naming_the_bind(self) -> None:
        # `work-model` is registered but bound to the other space, `other` to none.
        registry(
            self,
            self.directory.name,
            bound={"KEEP": "kept", "ALT": "work-model"},
            unbound=("other",),
        )
        report = self.assert_refused(
            "planning space WM belongs to project work-model, which the registry does not bind"
            " to it: run valkama projects bind work-model --space WM"
        )
        self.assertIn("run valkama projects bind other --space ALT", report["message"])

    def test_two_spaces_of_one_name_are_refused_naming_them(self) -> None:
        conn = sqlite3.connect(self.path)
        conn.execute("UPDATE planning_spaces SET name = 'Work model' WHERE key = 'ALT'")
        conn.commit()
        conn.close()
        self.assert_refused("planning spaces ALT, WM share the name 'Work model'")

    def test_a_store_holding_items_needs_the_file(self) -> None:
        self.file = None
        self.assert_refused("the store holds work items: name the file")

    def test_a_file_that_cannot_be_read_is_refused(self) -> None:
        self.file = os.path.join(self.directory.name, "missing.json")
        self.assert_refused("missing.json")

    def test_a_file_that_is_not_the_format_is_refused(self) -> None:
        with open(self.file, "w", encoding="utf-8") as handle:
            handle.write('{"format": "something else"}')
        self.assert_refused("the item projects file is malformed")

    def test_a_file_of_another_store_is_refused(self) -> None:
        self.write_file(data_scope_id="00000000-0000-4000-8000-0000000000aa")
        self.assert_refused("was made from the store 00000000-0000-4000-8000-0000000000aa")

    def test_a_file_of_another_state_of_the_store_is_refused(self) -> None:
        self.write_file(items_digest="0" * 64)
        self.assert_refused("was made from another state of this store")

    def test_a_file_naming_a_project_nobody_registered_is_refused(self) -> None:
        task = self.ids["WM-9"]
        self.write_file(
            items={
                task: {"drop_labels": [], "projects": [{"project_id": "ghost", "source": "named"}]}
            }
        )
        self.assert_refused(f"{task} names project ghost, which is not registered")

    def test_a_label_that_is_not_a_word_of_its_project_is_refused(self) -> None:
        self.write_file(labels={"infra": "work-model"})
        self.assert_refused(
            "label infra is not a word of project work-model: a search for it would lose its"
            " items; keep it as a label"
        )

    def test_a_dropped_label_the_file_does_not_map_is_refused(self) -> None:
        task = self.ids["WM-9"]
        named = [{"project_id": "work-model", "source": "named"}]
        self.write_file(items={task: {"drop_labels": ["model"], "projects": named}})
        self.assert_refused(f"{task} drops the label model, which labels does not map")

    def test_a_dropped_label_whose_project_the_entry_does_not_name_is_refused(self) -> None:
        task = self.ids["WM-9"]
        named = [{"project_id": "other", "source": "named"}]
        self.write_file(
            items={task: {"drop_labels": ["model"], "projects": named}},
            labels={"model": "work-model"},
        )
        self.assert_refused(
            f"{task} drops the label model, but does not name its project work-model"
        )

    def test_an_entry_for_a_goal_or_stage_is_refused(self) -> None:
        epic = self.ids["WM-1"]
        named = [{"project_id": "work-model", "source": "named"}]
        self.write_file(items={epic: {"drop_labels": [], "projects": named}})
        self.assert_refused(f"the item projects file gives projects to {epic}, which is no task")

    def test_the_command_prints_the_refused_report_and_exits_with_the_refusal(self) -> None:
        self.write_file(items_digest="0" * 64)
        output = io.StringIO()
        with (
            mock.patch.dict(os.environ, {"VALKAMA_DB": self.path}),
            contextlib.redirect_stdout(output),
            self.assertRaises(SystemExit) as raised,
        ):
            cli.main(["migrate", "work-model", "--item-projects", self.file])
        self.assertIn("another state of this store", str(raised.exception.code))
        self.assertEqual("refused", json.loads(output.getvalue())["status"])
        self.assertFalse(os.path.exists(os.path.join(self.directory.name, "backups")))


class CommitProjectsTests(unittest.TestCase):
    """The project a commit value belongs to, asked of Git in the registered roots."""

    def setUp(self) -> None:
        self.home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.home.cleanup)
        roots = os.path.join(self.home.name, "roots")
        self.alone = repository(os.path.join(roots, "alpha"), "alpha")
        self.shared = repository(os.path.join(roots, "beta"), "beta")
        git(roots, "clone", "--quiet", os.path.join(roots, "beta"), os.path.join(roots, "gamma"))
        self.projects = [
            {"project_id": name, "canonical_root": os.path.join(roots, name)}
            for name in ("alpha", "beta", "gamma", "plain")
        ]
        os.makedirs(os.path.join(roots, "plain"))

    def test_each_value_resolves_to_its_one_project_or_to_none(self) -> None:
        values = [
            self.alone,
            self.alone[:7].upper(),
            f"beta@{self.alone[:9]}",
            f"Gamma {self.alone[:9]}",
            f"elsewhere@{self.alone[:9]}",
            self.shared[:10],
            "0" * 40,
            f"main {self.alone[:7]} (merged)",
            "https://example.invalid/commit/1",
        ]
        self.assertEqual(
            {
                self.alone: "alpha",
                self.alone[:7].upper(): "alpha",
                f"beta@{self.alone[:9]}": "beta",
                f"Gamma {self.alone[:9]}": "gamma",
            },
            item_projects.commit_projects(values, self.projects),
        )

    def test_nothing_to_ask_asks_no_repository(self) -> None:
        with mock.patch.object(processes, "run_text") as run:
            self.assertEqual(
                {"alpha@1234567": "alpha"},
                item_projects.commit_projects(["alpha@1234567", "a range"], self.projects),
            )
        run.assert_not_called()


#: Labels and commits of the tasks of `WM`, and of one container, added to the store
#: the migration's tests build. `@ALONE` stands for the commit only `work-model`
#: holds, `@SHARED` for one two repositories hold.
LABELLED = {
    "WM-1": (["valkama"], []),
    "WM-2": (["valkama", "ui", "board-ish"], []),
    "WM-4": (["relay-service"], []),
    "WM-5": (["valkama", "ui"], ["rover@1234567"]),
    "WM-7": (["rover"], []),
    "WM-8": (["ui", "work-model"], ["@ALONE"]),
    "WM-9": (["valkama"], ["@SHARED"]),
    "WM-10": (["atlas"], []),
}


class MapItemsTests(StoreCase):
    """`projects map-items` then `migrate work-model`, through the command line."""

    def setUp(self) -> None:
        super().setUp()
        roots = os.path.join(self.directory.name, "roots")
        alone = repository(os.path.join(roots, "work-model"), "work model")
        shared = repository(os.path.join(roots, "atlas"), "atlas")
        git(roots, "clone", "--quiet", os.path.join(roots, "atlas"), os.path.join(roots, "kept"))
        entries = [
            bound(self.directory.name, "KEEP", "kept", default=True),
            bound(self.directory.name, "WM", "work-model", default=True),
            bound(self.directory.name, "WM", "valkama", default=False),
            bound(self.directory.name, "WM", "event-relay-service", default=False),
            bound(self.directory.name, "ALT", "other", default=True),
            bound(self.directory.name, "ALT", "rover", default=False),
            {
                "project_id": "atlas",
                "display_name": "Atlas",
                "canonical_root": os.path.join(roots, "atlas"),
                "planning_binding": None,
            },
        ]
        registry(self, self.directory.name, raw=registry_fixtures.registry_bytes(entries))
        conn = sqlite3.connect(self.path)
        try:
            for reference, (labels, commits) in LABELLED.items():
                conn.execute(
                    "UPDATE work_items SET labels = ? WHERE work_item_id = ?",
                    (json.dumps(labels), self.ids[reference]),
                )
                for value in commits:
                    value = value.replace("@ALONE", alone).replace("@SHARED", shared[:12])
                    conn.execute(
                        "INSERT INTO work_item_refs(work_item_id, kind, value) VALUES(?,'commit',?)",
                        (self.ids[reference], value),
                    )
            with schema17.words_as_2_9():
                words.bring_current(conn)
            conn.commit()
        finally:
            conn.close()
        self.registry_file = os.path.join(os.environ["LOCALAPPDATA"], "Valkama", "projects.json")
        self.output = os.path.join(self.directory.name, "mapped.json")

    def command(self, *arguments: str) -> tuple[int | str, dict | None]:
        output = io.StringIO()
        with (
            mock.patch.dict(os.environ, {"VALKAMA_DB": self.path}),
            contextlib.redirect_stdout(output),
        ):
            try:
                cli.main(list(arguments))
            except SystemExit as exit_:
                return (exit_.code if exit_.code is not None else 0), None
        return 0, json.loads(output.getvalue())

    def map_items(self, *labels: str) -> dict:
        code, summary = self.command(
            "projects",
            "map-items",
            "--output",
            self.output,
            *(f"--label={pair}" for pair in labels),
        )
        self.assertEqual(0, code)
        assert summary is not None
        return summary

    def entry(self, document: dict, reference: str) -> dict | None:
        return document["items"].get(self.ids[reference])

    def test_the_file_and_its_counts_follow_commits_then_labels_then_the_space(self) -> None:
        before = (file_digest(self.path), identity(self.path))
        registry_bytes = Path(self.registry_file).read_bytes()
        summary = self.map_items("relay-service=event-relay-service")
        # Only read: the store and the registry are as they were.
        self.assertEqual(before, (file_digest(self.path), identity(self.path)))
        self.assertEqual(registry_bytes, Path(self.registry_file).read_bytes())
        with open(self.output, "rb") as handle:
            raw = handle.read()
        document = json.loads(raw)
        self.assertNotIn(b"\r", raw)
        self.assertEqual(raw.decode(), json.dumps(document, indent=1, sort_keys=True) + "\n")
        self.assertEqual(
            (DATA_SCOPE, "valkama-item-projects", 1),
            (document["data_scope_id"], document["format"], document["version"]),
        )
        identities = sorted(str(row[0]) for row in self.read("SELECT work_item_id FROM work_items"))
        self.assertEqual(
            hashlib.sha256("".join(f"{i}\n" for i in identities).encode()).hexdigest(),
            document["items_digest"],
        )

        def named(*projects: str, source: str = "named") -> list[dict]:
            return [{"project_id": project, "source": source} for project in projects]

        # A label naming a project bound to the item's space is carried and dropped;
        # `--label` carries one more.
        self.assertEqual(
            {"drop_labels": ["valkama"], "projects": named("valkama")}, self.entry(document, "WM-2")
        )
        self.assertEqual(
            {"drop_labels": ["relay-service"], "projects": named("event-relay-service")},
            self.entry(document, "WM-4"),
        )
        # Commits come first: their project, and the label it names leaves too.
        self.assertEqual(
            {"drop_labels": ["work-model"], "projects": named("work-model", source="commits")},
            self.entry(document, "WM-8"),
        )
        # A commit naming another project leaves the label, which is a discrepancy.
        self.assertEqual(
            {"drop_labels": [], "projects": named("rover", source="commits")},
            self.entry(document, "WM-5"),
        )
        # A hash two repositories hold says nothing, so the label decides.
        self.assertEqual(
            {"drop_labels": ["valkama"], "projects": named("valkama")}, self.entry(document, "WM-9")
        )
        # A container, a label of another space's project and one of a project bound
        # nowhere give no entry: the space's project follows.
        for reference in ("WM-1", "WM-7", "WM-10", "WM-12"):
            self.assertIsNone(self.entry(document, reference), reference)
        # The labels it carried: the rule's, where a task of the project's space holds
        # them, and the one `--label` named.
        self.assertEqual(
            {
                "relay-service": "event-relay-service",
                "valkama": "valkama",
                "work-model": "work-model",
            },
            document["labels"],
        )
        self.assertEqual(
            [
                {
                    "reference": "WM-5",
                    "label": "valkama",
                    "project": "valkama",
                    "commits": ["rover"],
                }
            ],
            summary["discrepancies"],
        )
        self.assertEqual(
            [{"reference": "WM-7", "label": "rover", "space": "ALT"}], summary["foreign_labels"]
        )
        tasks = 14
        self.assertEqual(
            {"commits": 2, "containers": 7, "migrated": tasks - 5, "named": 3},
            summary["counts"]["WM"],
        )
        self.assertEqual({"migrated": 2}, summary["counts"]["ALT"])
        self.assertEqual(
            sum(counted.get("migrated", 0) for counted in summary["counts"].values()),
            summary["sources"]["migrated"],
        )
        self.assertEqual((5, self.output), (summary["entries"], summary["output"]))

    def test_the_reviewed_file_migrates_and_a_dropped_label_is_still_found(self) -> None:
        self.map_items("relay-service=event-relay-service")
        with open(self.output, encoding="utf-8") as handle:
            document = json.load(handle)
        # The reviewer gives the task holding another space's label that project.
        document["labels"]["rover"] = "rover"
        document["items"][self.ids["WM-7"]] = {
            "drop_labels": ["rover"],
            "projects": [{"project_id": "rover", "source": "named"}],
        }
        with open(self.output, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(document, handle)
        code, report = self.command("migrate", "work-model", "--item-projects", self.output)
        self.assertEqual(0, code)
        assert report is not None
        self.assertEqual("migrated", report["status"])
        failed = [entry["name"] for entry in report["postconditions"] if not entry["passed"]]
        self.assertEqual([], failed)
        held = {
            (str(row[0]), str(row[1]), str(row[2]))
            for row in self.read("SELECT work_item_id, project_id, source FROM work_item_projects")
        }
        for reference, project, source in (
            ("WM-2", "valkama", "named"),
            ("WM-4", "event-relay-service", "named"),
            ("WM-5", "rover", "commits"),
            ("WM-7", "rover", "named"),
            ("WM-8", "work-model", "commits"),
            ("WM-10", "work-model", "migrated"),
        ):
            self.assertEqual(
                {(project, source)},
                {(row[1], row[2]) for row in held if row[0] == self.ids[reference]},
                reference,
            )
        self.assertFalse([row for row in held if row[0] == self.ids["WM-1"]])
        labels = {reference: json.loads(self.item(reference)["labels"]) for reference in LABELLED}
        self.assertEqual(
            {
                "WM-1": ["valkama"],
                "WM-2": ["ui", "board-ish"],
                "WM-4": [],
                "WM-5": ["valkama", "ui"],
                "WM-7": [],
                "WM-8": ["ui"],
                "WM-9": [],
                "WM-10": ["atlas"],
            },
            labels,
        )
        conn = store.connect(self.path)
        self.addCleanup(conn.close)

        def found(stem: str) -> set[str]:
            rows = words.search_rows(conn, [stem], space_id=None, limit=1000, offset=0)
            assert rows is not None
            return {str(row["work_item_id"]) for row in rows}

        # The label left; the project's id still finds the task, by each of its words.
        self.assertLessEqual({self.ids["WM-2"], self.ids["WM-9"]}, found("valka"))
        self.assertIn(self.ids["WM-4"], found("relay"))
        self.assertIn(self.ids["WM-4"], found("servi"))
        post_indexes = next(
            entry for entry in report["postconditions"] if entry["name"] == "indexes"
        )
        self.assertGreater(post_indexes["detail"]["searches_compared"], 1)

    def test_a_label_that_is_not_a_word_of_its_project_is_refused_before_the_store_is_read(
        self,
    ) -> None:
        code, _ = self.command(
            "projects", "map-items", "--output", self.output, "--label", "infra=event-relay-service"
        )
        self.assertIn("label infra is not a word of project event-relay-service", str(code))
        self.assertFalse(os.path.exists(self.output))

    def test_a_label_naming_a_project_nobody_registered_is_refused(self) -> None:
        code, _ = self.command(
            "projects", "map-items", "--output", self.output, "--label", "ghost=ghost"
        )
        self.assertIn("project ghost named by --label ghost=ghost is not registered", str(code))
        self.assertFalse(os.path.exists(self.output))

    def test_an_existing_file_is_not_replaced(self) -> None:
        with open(self.output, "w", encoding="utf-8") as handle:
            handle.write("kept")
        code, _ = self.command("projects", "map-items", "--output", self.output)
        self.assertIn("already exists", str(code))
        with open(self.output, encoding="utf-8") as handle:
            self.assertEqual("kept", handle.read())

    def test_a_registry_of_format_3_is_refused_naming_the_upgrade(self) -> None:
        with open(self.registry_file, "wb") as handle:
            handle.write(b'{"projects": [], "schema_version": 3}')
        code, _ = self.command("projects", "map-items", "--output", self.output)
        self.assertIn("run valkama projects upgrade first", str(code))
        self.assertFalse(os.path.exists(self.output))

    def test_a_migrated_store_needs_no_file(self) -> None:
        self.migrate()
        code, _ = self.command("projects", "map-items", "--output", self.output)
        self.assertIn("needs no item projects file", str(code))


if __name__ == "__main__":
    unittest.main()
