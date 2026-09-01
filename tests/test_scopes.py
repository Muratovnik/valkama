"""Federation must be a read-time union that never risks the primary store."""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import store
from server.planning import service as planning_service
from server.projects import scopes
from tests import SUITE_STORE


class RegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.primary = os.path.join(self._dir.name, "valkama.sqlite3")
        os.environ["VALKAMA_DB"] = self.primary
        connection = store.connect()
        planning_service.create_planning_space(connection, project_id="personal", name="Personal")
        # The planning service leaves the transaction to its caller, unlike the
        # board operations it replaced.
        connection.commit()
        connection.close()
        self.work = os.path.join(self._dir.name, "work.sqlite3")
        os.environ["VALKAMA_DB"] = self.work
        connection = store.connect()
        planning_service.create_planning_space(connection, project_id="work", name="Work")
        planning_service.create_work_item(connection, space="WOR", title="work item")
        connection.commit()
        connection.close()
        os.environ["VALKAMA_DB"] = self.primary

    def tearDown(self) -> None:
        os.environ["VALKAMA_DB"] = SUITE_STORE
        self._dir.cleanup()

    def test_the_primary_scope_exists_without_a_registry(self) -> None:
        listed = scopes.load(self.primary)
        self.assertEqual([scopes.PRIMARY_SCOPE], [item["name"] for item in listed])
        self.assertTrue(listed[0]["primary"])
        self.assertFalse(os.path.isfile(scopes.registry_path(self.primary)))

    def test_attach_and_detach_leave_the_files_alone(self) -> None:
        scopes.attach(self.primary, "work", self.work, label="NDA work")
        listed = scopes.load(self.primary)
        self.assertEqual(["personal", "work"], [item["name"] for item in listed])
        self.assertEqual("NDA work", listed[1]["label"])

        scopes.detach(self.primary, "work")
        self.assertEqual(["personal"], [item["name"] for item in scopes.load(self.primary)])
        self.assertTrue(os.path.isfile(self.work), "detaching never deletes a store")

    def test_the_primary_scope_cannot_be_detached_or_shadowed(self) -> None:
        with self.assertRaisesRegex(scopes.ScopeError, "cannot be detached"):
            scopes.detach(self.primary, "personal")
        with self.assertRaisesRegex(scopes.ScopeError, "always attached"):
            scopes.attach(self.primary, "personal", self.work)

    def test_duplicate_names_and_paths_are_refused(self) -> None:
        scopes.attach(self.primary, "work", self.work)
        with self.assertRaisesRegex(scopes.ScopeError, "already attached"):
            scopes.attach(self.primary, "work", self.work)
        other = os.path.join(self._dir.name, "second.sqlite3")
        os.environ["VALKAMA_DB"] = other
        store.connect().close()
        os.environ["VALKAMA_DB"] = self.primary
        with self.assertRaisesRegex(scopes.ScopeError, "another name"):
            scopes.attach(self.primary, "work2", self.work)
        scopes.attach(self.primary, "work2", other)

    def test_bad_names_and_paths_are_refused(self) -> None:
        for name in ("9lives", "", "a" * 40, "with space"):
            with self.subTest(name=name), self.assertRaises(scopes.ScopeError):
                scopes.attach(self.primary, name, self.work)
        with self.assertRaisesRegex(scopes.ScopeError, "absolute"):
            scopes.attach(self.primary, "rel", "work.sqlite3")

    def test_a_name_is_matched_case_insensitively(self) -> None:
        # Typing "Work" must reach the same scope rather than creating a second
        # one that shadows it.
        scopes.attach(self.primary, "Work", self.work)
        self.assertEqual("work", scopes.load(self.primary)[1]["name"])
        self.assertEqual("work", scopes.find(self.primary, "WORK")["name"])

    def test_a_corrupt_registry_is_reported_not_ignored(self) -> None:
        with open(scopes.registry_path(self.primary), "w", encoding="utf-8") as handle:
            handle.write("{not json")
        with self.assertRaisesRegex(scopes.ScopeError, "cannot read"):
            scopes.load(self.primary)
        with open(scopes.registry_path(self.primary), "w", encoding="utf-8") as handle:
            json.dump({"wrong": []}, handle)
        with self.assertRaisesRegex(scopes.ScopeError, "scopes array"):
            scopes.load(self.primary)

    def test_reading_a_scope_is_read_only(self) -> None:
        scopes.attach(self.primary, "work", self.work)
        connection = scopes.open_readonly(scopes.find(self.primary, "work"))
        try:
            titles = [row["title"] for row in connection.execute("SELECT title FROM work_items")]
            self.assertEqual(["work item"], titles)
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute(
                    "INSERT INTO planning_spaces(planning_space_id,project_id,name,key,position)"
                    " VALUES ('x','p','nope','NOPE',0)"
                )
        finally:
            connection.close()

    def test_an_absent_or_foreign_file_is_an_unavailable_scope(self) -> None:
        missing = {"name": "gone", "path": os.path.join(self._dir.name, "absent.sqlite3")}
        with self.assertRaisesRegex(scopes.ScopeError, "not present"):
            scopes.open_readonly(missing)
        foreign = os.path.join(self._dir.name, "foreign.sqlite3")
        import sqlite3

        connection = sqlite3.connect(foreign)
        connection.execute("CREATE TABLE unrelated(id INTEGER)")
        connection.commit()
        connection.close()
        with self.assertRaisesRegex(scopes.ScopeError, "not a Valkama store"):
            scopes.open_readonly({"name": "foreign", "path": foreign})

    def test_qualified_ids_survive_a_round_trip(self) -> None:
        self.assertEqual("work#WOR-12", scopes.qualified("work", "WOR-12"))
        self.assertEqual(("work", "WOR-12"), scopes.split_qualified("work#WOR-12"))
        # A reference is read back upper-cased, so two stores compared together
        # cannot disagree about the same item because of how it was typed.
        self.assertEqual(("work", "WOR-12"), scopes.split_qualified("Work#wor-12"))
        for bad in ("WOR-12", "work#", ""):
            with self.subTest(value=bad), self.assertRaises(scopes.ScopeError):
                scopes.split_qualified(bad)


if __name__ == "__main__":
    unittest.main()
