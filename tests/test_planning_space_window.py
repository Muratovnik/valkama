"""The owner's space window: one save creates, edits or removes a space with its projects.

The space is the store's and its projects the registry's, written only through
`registry_owner`. Each case reads both afterwards: the store's row and the
registry's inventory and projection, which must agree. A refused save changes
neither, except where the contract says a creation or a rename stands while the
registry refuses its projects, and then the answer says so.
"""

from __future__ import annotations

import contextlib
import io
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

from server import cli, http_surface, store
from server.planning import api, calls, service
from server.planning import space_window as window
from server.projects import project_registry, registry_owner
from server.store_identity.metadata import read_store_metadata


class SpaceWindowTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": str(self.root / "valkama.sqlite3"),
                "HOME": directory.name,
                "USERPROFILE": directory.name,
                "LOCALAPPDATA": str(self.root / "local"),
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.scope = str(read_store_metadata(self.conn)["data_scope_id"])
        self.inventory = registry_owner.inventory_path()
        self.target = registry_owner.projection_path()
        for project_id in ("app", "lib", "docs", "loose"):
            self.register(project_id)

    # -- helpers --------------------------------------------------------------

    def register(self, project_id: str) -> None:
        folder = self.root / project_id
        folder.mkdir(exist_ok=True)
        registry_owner.update(
            self.inventory,
            self.target,
            [
                registry_owner.Add(
                    {
                        "project_id": project_id,
                        "display_name": project_id.title(),
                        "canonical_root": str(folder),
                        "planning_binding": None,
                    }
                )
            ],
        )

    def save(self, conn: Any = None, **payload: object) -> dict:
        with calls.bind(calls.browser(), window.WRITE_PATH):
            return window.save(conn or self.conn, payload)

    def refused(self, code: str, **payload: object) -> dict:
        with self.assertRaises(Exception) as caught:
            self.save(**payload)
        status, body = window.error_response(caught.exception)
        self.assertEqual(code, body["error"]["code"], body)
        self.assertGreaterEqual(status, 400)
        return body["error"]

    def ref(self, key: str) -> dict:
        return {"data_scope_id": self.scope, "space_key": key}

    def bindings(self) -> dict[str, tuple[str, bool] | None]:
        """Each project's space key and default flag, read from the registry's two files."""

        listing = project_registry.parse_registry(self.target.read_bytes())
        self.assertEqual("available", listing["status"], listing["reason"])
        self.assertEqual(
            listing["projects"], registry_owner.parse_inventory(self.inventory.read_bytes())
        )
        answer: dict[str, tuple[str, bool] | None] = {}
        for entry in listing["projects"]:
            space = window._bound_space(entry["planning_binding"])
            answer[entry["project_id"]] = (
                None
                if space is None
                else (space["space_key"], entry["planning_binding"]["default"])
            )
        return answer

    def spaces(self) -> dict[str, str]:
        return {
            str(row["key"]): str(row["name"])
            for row in self.conn.execute("SELECT key, name FROM planning_spaces")
        }

    def registry_bytes(self) -> tuple[bytes, bytes]:
        return self.inventory.read_bytes(), self.target.read_bytes()

    def create_main(self) -> dict:
        return self.save(
            name="Атлас",
            key="MAIN",
            projects=[
                {"project_id": "app", "default": True},
                {"project_id": "lib", "default": False},
            ],
        )

    def issue_a_number(self, key: str) -> None:
        service.create_work_item(self.conn, space=key, title="First task", kind="task")
        self.conn.commit()

    # -- creating -------------------------------------------------------------

    def test_a_creation_writes_the_space_then_its_projects_with_one_default(self) -> None:
        folder = self.root / "fresh"
        folder.mkdir()
        answer = self.save(
            name="Атлас",
            key="MAIN",
            projects=[
                {"project_id": "fresh", "default": False},
                {"project_id": "app", "default": True},
            ],
            new_projects=[
                {"project_id": "fresh", "display_name": "Fresh", "canonical_root": str(folder)}
            ],
        )
        self.assertEqual("created", answer["operation"])
        self.assertEqual({"status": "written"}, answer["registry"])
        self.assertEqual(self.ref("MAIN"), answer["space_ref"])
        self.assertEqual("app", answer["space"]["default_project"])
        self.assertEqual({"MAIN": "Атлас"}, self.spaces())
        self.assertEqual(
            {
                "app": ("MAIN", True),
                "docs": None,
                "fresh": ("MAIN", False),
                "lib": None,
                "loose": None,
            },
            self.bindings(),
        )

    def test_the_server_binding_has_the_bytes_the_command_writes(self) -> None:
        self.save(name="Main work", key="MAIN", projects=[{"project_id": "app", "default": True}])
        by_window = self.registry_bytes()
        registry_owner.rollback(self.inventory, self.target)
        self.assertEqual({"app": None, "docs": None, "lib": None, "loose": None}, self.bindings())
        with contextlib.redirect_stdout(io.StringIO()):
            cli.main(["projects", "bind", "app", "--space", "MAIN"])
        self.assertEqual(by_window, self.registry_bytes())

    def test_a_cyrillic_name_gets_no_key_and_the_save_is_refused_whole(self) -> None:
        before = self.registry_bytes()
        self.assertEqual(
            {"key": None, "refusal": {"code": "key_underivable", "message": mock.ANY}},
            window.key_read(self.conn, {"name": ["Атлас"]}),
        )
        self.refused("key_underivable", name="Атлас", projects=[])
        self.assertEqual({}, self.spaces())
        self.assertEqual(before, self.registry_bytes())

    def test_a_folder_that_does_not_exist_refuses_the_creation_whole(self) -> None:
        before = self.registry_bytes()
        error = self.refused(
            "registry",
            name="Main work",
            key="MAIN",
            projects=[{"project_id": "gone", "default": True}],
            new_projects=[
                {
                    "project_id": "gone",
                    "display_name": "Gone",
                    "canonical_root": str(self.root / "gone"),
                }
            ],
        )
        self.assertEqual("root_missing", error["reason"])
        self.assertEqual({}, self.spaces())
        self.assertEqual(before, self.registry_bytes())

    def test_a_busy_registry_leaves_the_space_created_and_a_second_save_binds_it(self) -> None:
        with registry_owner._lock(self.target):
            answer = self.create_main()
        self.assertEqual("created", answer["operation"])
        self.assertEqual("refused", answer["registry"]["status"])
        self.assertEqual("busy", answer["registry"]["reason"])
        self.assertEqual({"MAIN": "Атлас"}, self.spaces())
        self.assertNotIn(("MAIN", True), self.bindings().values())
        # The window then edits the created space: the same save, now naming it.
        again = self.save(
            space=self.ref("MAIN"),
            name="Атлас",
            projects=[
                {"project_id": "app", "default": True},
                {"project_id": "lib", "default": False},
            ],
        )
        self.assertEqual({"status": "written"}, again["registry"])
        self.assertEqual(
            {"app": ("MAIN", True), "lib": ("MAIN", False)},
            {key: value for key, value in self.bindings().items() if value},
        )

    def test_the_default_of_a_space_that_keeps_others_does_not_move_in(self) -> None:
        self.create_main()
        before = self.registry_bytes()
        error = self.refused(
            "registry", name="Second", key="TWO", projects=[{"project_id": "app", "default": True}]
        )
        self.assertEqual("default_leaving", error["reason"])
        self.assertEqual({"MAIN": "Атлас"}, self.spaces())
        self.assertEqual(before, self.registry_bytes())

    def test_a_taken_name_or_key_is_refused_by_its_code(self) -> None:
        self.create_main()
        self.refused("name_taken", name="Атлас", key="TWO", projects=[])
        self.refused("key_taken", name="Second", key="MAIN", projects=[])
        self.refused("key_invalid", name="Second", key="two", projects=[])

    # -- editing --------------------------------------------------------------

    def test_an_edit_renames_moves_the_default_adds_and_removes_projects(self) -> None:
        self.create_main()
        answer = self.save(
            space=self.ref("MAIN"),
            name="Atlas",
            projects=[
                {"project_id": "lib", "default": True},
                {"project_id": "docs", "default": False},
            ],
        )
        self.assertEqual("edited", answer["operation"])
        self.assertEqual("Atlas", answer["space"]["name"])
        self.assertEqual({"MAIN": "Atlas"}, self.spaces())
        self.assertEqual(
            {"app": None, "docs": ("MAIN", False), "lib": ("MAIN", True), "loose": None},
            self.bindings(),
        )
        # The space may be left with no project, its default leaving last.
        self.save(space=self.ref("MAIN"), name="Atlas", projects=[])
        self.assertEqual({"app": None, "docs": None, "lib": None, "loose": None}, self.bindings())

    def test_a_save_that_changes_nothing_writes_nothing(self) -> None:
        self.create_main()
        before = self.registry_bytes()
        answer = self.save(
            space=self.ref("MAIN"),
            name="Атлас",
            key="MAIN",
            projects=[
                {"project_id": "app", "default": True},
                {"project_id": "lib", "default": False},
            ],
        )
        self.assertEqual({"status": "unchanged"}, answer["registry"])
        self.assertEqual(before, self.registry_bytes())

    def test_the_key_changes_while_no_number_is_issued_and_its_projects_follow(self) -> None:
        self.create_main()
        answer = self.save(
            space=self.ref("MAIN"),
            name="Атлас",
            key="ATLAS",
            projects=[
                {"project_id": "app", "default": False},
                {"project_id": "lib", "default": True},
            ],
        )
        self.assertEqual(self.ref("ATLAS"), answer["space_ref"])
        self.assertEqual({"status": "written"}, answer["registry"])
        self.assertEqual({"ATLAS": "Атлас"}, self.spaces())
        self.assertEqual(
            {"app": ("ATLAS", False), "docs": None, "lib": ("ATLAS", True), "loose": None},
            self.bindings(),
        )

    def test_the_key_does_not_change_once_a_number_is_issued(self) -> None:
        self.create_main()
        self.issue_a_number("MAIN")
        before = self.registry_bytes()
        self.assertTrue(window.form_read(self.conn, {"space": ["MAIN"]})["space"]["key_locked"])
        self.refused(
            "key_issued",
            space=self.ref("MAIN"),
            name="Атлас",
            key="ATLAS",
            projects=[{"project_id": "app", "default": True}],
        )
        self.assertEqual({"MAIN": "Атлас"}, self.spaces())
        self.assertEqual(before, self.registry_bytes())

    def test_a_refused_registry_rolls_the_key_change_back(self) -> None:
        self.create_main()
        before = self.registry_bytes()
        with registry_owner._lock(self.target):
            error = self.refused(
                "registry",
                space=self.ref("MAIN"),
                name="Renamed",
                key="ATLAS",
                projects=[{"project_id": "app", "default": True}],
            )
        self.assertEqual("busy", error["reason"])
        self.assertEqual({"MAIN": "Атлас"}, self.spaces())
        self.assertEqual(before, self.registry_bytes())

    def test_a_store_that_refuses_its_commit_gets_the_registry_put_back(self) -> None:
        self.create_main()
        bindings = self.bindings()
        failing = mock.patch.object(
            window, "_commit", side_effect=sqlite3.OperationalError("disk I/O error")
        )
        with failing:
            error = self.refused(
                "store_refused",
                space=self.ref("MAIN"),
                name="Атлас",
                key="ATLAS",
                projects=[
                    {"project_id": "app", "default": True},
                    {"project_id": "docs", "default": False},
                ],
            )
        self.assertIn("disk I/O error", error["message"])
        self.assertEqual({"MAIN": "Атлас"}, self.spaces())
        self.assertEqual(bindings, self.bindings())

    # -- removing -------------------------------------------------------------

    def test_an_empty_space_is_removed_and_its_projects_stay_registered(self) -> None:
        self.create_main()
        answer = self.save(space=self.ref("MAIN"), remove=True)
        self.assertEqual(
            {"operation": "removed", "space": None, "space_ref": None},
            {key: answer[key] for key in ("operation", "space", "space_ref")},
        )
        self.assertEqual({}, self.spaces())
        self.assertEqual({"app": None, "docs": None, "lib": None, "loose": None}, self.bindings())
        self.assertEqual(0, self.conn.execute("SELECT COUNT(*) FROM workflows").fetchone()[0])

    def test_a_space_with_work_is_not_removed(self) -> None:
        self.create_main()
        self.issue_a_number("MAIN")
        before = self.registry_bytes()
        self.assertEqual(1, window.form_read(self.conn, {"space": ["MAIN"]})["space"]["work_items"])
        self.refused("space_not_empty", space=self.ref("MAIN"), remove=True)
        self.assertEqual({"MAIN": "Атлас"}, self.spaces())
        self.assertEqual(before, self.registry_bytes())

    # -- who and where ----------------------------------------------------------

    def test_only_the_owner_saves_and_only_a_space_of_the_main_store(self) -> None:
        self.create_main()
        with self.assertRaises(Exception) as caught:
            window.save(self.conn, {"name": "Agent's", "projects": []})
        self.assertEqual("owner_only", api.error_response(caught.exception)[1]["error"]["code"])
        other = {"data_scope_id": "33333333-3333-4333-8333-333333333333", "space_key": "MAIN"}
        self.refused("not_main_store", space=other, name="Атлас", projects=[])
        self.refused("space_missing", space=self.ref("NONE"), name="Атлас", projects=[])

    def test_the_write_has_a_boundary_of_its_own_ahead_of_plannings(self) -> None:
        boundary = http_surface._boundary(http_surface._POST_BOUNDARIES, window.WRITE_PATH)
        assert boundary is not None
        self.assertIs(http_surface._Commit.DOMAIN, boundary.commit)
        self.assertIsNone(api.handle_post(self.conn, window.WRITE_PATH, {}))

    # -- the reads ----------------------------------------------------------------

    def test_the_reads_name_every_project_the_key_and_what_may_still_change(self) -> None:
        self.create_main()
        projects = api.handle_get(self.conn, "/api/planning/projects", {})
        assert projects is not None
        listed = {entry["project_id"]: entry for entry in projects[1]["projects"]}
        self.assertEqual({"status": "available", "reason": ""}, projects[1]["registry"])
        self.assertEqual(self.ref("MAIN"), listed["app"]["space"])
        self.assertTrue(listed["app"]["default"])
        self.assertIsNone(listed["loose"]["space"])
        self.assertEqual(str((self.root / "loose").resolve()), listed["loose"]["root"])

        self.assertEqual(
            {"key": "MW", "refusal": None}, window.key_read(self.conn, {"name": ["Main work"]})
        )
        self.assertEqual(
            {"key": "MAI", "refusal": None}, window.key_read(self.conn, {"name": ["Main"]})
        )
        form = window.form_read(self.conn, {"space": ["MAIN"]})
        self.assertEqual(
            {"name": "Атлас", "key": "MAIN", "key_locked": False, "work_items": 0}, form["space"]
        )
        self.assertEqual(form["workflow"], window.form_read(self.conn, {})["workflow"])
        self.assertEqual(9, form["workflow"]["states"])


if __name__ == "__main__":
    unittest.main()
