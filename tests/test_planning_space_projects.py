"""A planning space holds no project: the registry binds them, and a space record shows them.

The store keeps a space's name, key and launch place; which projects it holds, and
which of them is its default, are the registry's. Every reader that shows a space
adds them: the tools, the HTTP reads, the read model and the spaces stream. A
registry that was not read knows no projects, which is not the same as none, so
both fields are then null. A launch reads the space's default project the same way.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import mcp_surface, store
from server.executions import lifecycle
from server.planning import api, service, views
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_entry, registry_bytes

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
AGENT = {"sessionId": SESSION}


class SpaceProjectsCase(unittest.TestCase):
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
        self.registry = self.root / "local" / "Valkama" / "projects.json"
        self.registry.parent.mkdir(parents=True)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.data_scope_id = str(read_store_metadata(self.conn)["data_scope_id"])
        # The registry binds two projects to HOME before it exists, as a bind
        # names a space by its key; BARE is bound none.
        home = {"data_scope_id": self.data_scope_id, "space_key": "HOME"}
        entries = []
        for project, default in (("zeta", True), ("alpha", False), ("loose", None)):
            entry = project_entry(project, self.root / project)
            entry["display_name"] = project.title()
            if default is not None:
                entry["planning_binding"] = {**planning_space_entity(home), "default": default}
            entries.append(entry)
        self.registry.write_bytes(registry_bytes(entries))
        self.home = self.tool("create_planning_space", name="Home", key="HOME")
        self.bare = self.tool("create_planning_space", name="Bare", key="BARE")

    def tool(self, name: str, /, **arguments: object) -> dict:
        answer = mcp_surface.run_tool_call(self.conn, name, arguments, meta=AGENT)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def project(self, project: str, default: bool) -> dict:
        return {
            "project_id": project,
            "display_name": project.title(),
            "root": str(self.root / project),
            "default": default,
        }

    def listed(self) -> dict[str, dict]:
        answer = self.tool("list_planning_spaces")
        return {space["key"]: space for space in answer["planning_spaces"]}

    def unreadable(self) -> None:
        self.registry.write_bytes(b"{ not json")


class CreateTests(SpaceProjectsCase):
    def test_a_space_is_created_by_its_name_and_key_and_holds_no_project(self) -> None:
        self.assertEqual(
            {
                "name": "Bare",
                "key": "BARE",
                "provider_kind": "local",
                "launch_place": "space",
                "projects": [],
                "default_project": None,
            },
            {
                field: self.bare[field]
                for field in self.bare
                if field not in ("planning_space_id", "workflow")
            },
        )
        self.assertIn("workflow", self.bare)
        # A space bound before it was made shows its projects from the first answer.
        self.assertEqual("zeta", self.home["default_project"])

    def test_a_second_space_by_the_same_name_is_refused(self) -> None:
        with self.assertRaises(Exception) as caught:
            mcp_surface.run_tool_call(
                self.conn, "create_planning_space", {"name": "Home", "key": "HOMETWO"}, meta=AGENT
            )
        self.conn.rollback()
        status, body = api.error_response(caught.exception)
        self.assertEqual(
            (400, "a planning space named Home already exists"),
            (status, body["error"]["message"]),
        )
        self.assertEqual(["BARE", "HOME"], sorted(self.listed()))

    def test_the_tool_takes_a_name_and_a_key_and_no_project(self) -> None:
        tool = next(
            tool for tool in mcp_surface.catalogue() if tool["name"] == "create_planning_space"
        )
        self.assertEqual({"name", "key"}, set(tool["inputSchema"]["properties"]))
        self.assertEqual(["name"], tool["inputSchema"]["required"])
        made = self.tool("create_planning_space", name="Derived")
        self.assertEqual("DER", made["key"])


class RecordTests(SpaceProjectsCase):
    def test_each_listed_space_names_its_projects_its_default_and_its_launch_place(self) -> None:
        spaces = self.listed()
        # The default first, then the others by id; a project bound nowhere is in none.
        self.assertEqual(
            [self.project("zeta", True), self.project("alpha", False)], spaces["HOME"]["projects"]
        )
        self.assertEqual("zeta", spaces["HOME"]["default_project"])
        self.assertEqual(
            ([], None), (spaces["BARE"]["projects"], spaces["BARE"]["default_project"])
        )
        self.assertEqual({"space"}, {space["launch_place"] for space in spaces.values()})
        self.assertNotIn("project_id", spaces["HOME"])

    def test_the_space_read_the_http_list_and_the_read_model_say_the_same(self) -> None:
        listed = self.listed()["HOME"]
        read = self.tool("get_planning_space", space="HOME")
        status, http = api.handle_get(self.conn, "/api/planning/spaces", {})
        model = views.planning_payload(self.conn, space="HOME")
        for record in (read, model["planning_space"]):
            self.assertEqual(
                (listed["projects"], "zeta", "space"),
                (record["projects"], record["default_project"], record["launch_place"]),
            )
        shown = {space["key"]: space for space in http["planning_spaces"]}
        self.assertEqual((200, listed), (status, shown["HOME"]))
        self.assertEqual(
            listed, {space["key"]: space for space in model["planning_spaces"]}["HOME"]
        )
        self.assertNotIn("project_id", model["planning_space"])

    def test_an_unreadable_registry_names_no_projects_rather_than_none(self) -> None:
        self.unreadable()
        spaces = self.listed()
        for key in ("HOME", "BARE"):
            self.assertEqual(
                (None, None), (spaces[key]["projects"], spaces[key]["default_project"])
            )
        read = self.tool("get_planning_space", space="HOME")
        self.assertEqual((None, None), (read["projects"], read["default_project"]))
        model = views.planning_payload(self.conn, space="HOME")["planning_space"]
        self.assertEqual((None, None), (model["projects"], model["default_project"]))

    def test_a_project_no_longer_chooses_the_space_a_read_shows(self) -> None:
        with self.assertRaisesRegex(api.PlanningHttpError, "a project does not choose"):
            api.handle_get(self.conn, "/api/planning", {"project": ["zeta"]})
        status, model = api.handle_get(self.conn, "/api/planning", {"space": ["HOME"]})
        self.assertEqual((200, "HOME"), (status, model["planning_space"]["key"]))


class LaunchProjectTests(SpaceProjectsCase):
    def test_a_launch_names_the_default_project_of_its_space(self) -> None:
        spaces = self.listed()
        self.assertEqual(
            "zeta", lifecycle._project_id(self.conn, spaces["HOME"]["planning_space_id"])
        )
        self.assertEqual("", lifecycle._project_id(self.conn, spaces["BARE"]["planning_space_id"]))
        self.unreadable()
        self.assertEqual("", lifecycle._project_id(self.conn, spaces["HOME"]["planning_space_id"]))


class ServiceRecordTests(SpaceProjectsCase):
    def test_the_store_s_record_of_a_space_holds_no_projects(self) -> None:
        # What the store knows, before a reader adds the registry's projects.
        record = service.list_planning_spaces(self.conn)[0]
        self.assertEqual(
            {
                "planning_space_id",
                "name",
                "key",
                "provider_kind",
                "launch_place",
                "work_items",
                "open",
                "active",
                "completed",
                "updated_at",
            },
            set(record),
        )


if __name__ == "__main__":
    unittest.main()
