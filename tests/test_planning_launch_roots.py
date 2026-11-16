"""Where a launch from an item runs, and the roots a claim names.

The space's launch place chooses the launch root: `space` always takes the
space's root, the root of its default project; `item_project` takes the root of
the item's one project, and the space's root when it names none or several. A goal
or stage always takes the space's. The capabilities read and the attempt's
`project_id` both name it.

A claim answers with `project_roots`: the root of each project the task changes,
or of its space's default project when it names none, with how each stands. The
projects of the item's space come first, the default before the others, then every
other project, each part by id.

The registry here: HOME binds `umbrella` (its default, whose root holds `inner`),
`inner` and `side`; ROVER binds `rover`; `ghost` (no directory) and `loose` are bound
nowhere. Item D names `inner` and `rover`, item V only `inner`.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import mcp_surface, store
from server.executions import api as execution_api
from server.executions import lifecycle
from server.planning import api, item_projects, service
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_entry, registry_bytes
from tests.test_executions import LaunchHarness

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
AGENT = {"sessionId": SESSION}


class RootsCase(unittest.TestCase):
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
        self.dirs = {
            "umbrella": self.root / "umbrella",
            "inner": self.root / "umbrella" / "inner",
            "side": self.root / "side",
            "rover": self.root / "rover",
            "loose": self.root / "loose",
            "ghost": self.root / "ghost",
            "gone": self.root / "gone",
        }
        for name, path in self.dirs.items():
            if name != "ghost":
                path.mkdir(parents=True)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.write_registry()
        self.tool("create_planning_space", name="Home", key="HOME")
        self.tool("create_planning_space", name="Rover", key="ROVER")

    def write_registry(self, *, without: str = "") -> None:
        scope = str(read_store_metadata(self.conn)["data_scope_id"])
        bindings = {
            "umbrella": ("HOME", True),
            "inner": ("HOME", False),
            "side": ("HOME", False),
            "rover": ("ROVER", True),
        }
        entries = []
        for project, path in self.dirs.items():
            if project == without:
                continue
            entry = project_entry(project, path)
            entry["display_name"] = project.title()
            if project in bindings:
                key, default = bindings[project]
                space = planning_space_entity({"data_scope_id": scope, "space_key": key})
                entry["planning_binding"] = {**space, "default": default}
            entries.append(entry)
        self.registry.write_bytes(registry_bytes(entries))

    def tool(self, name: str, /, **arguments: object) -> dict:
        answer = mcp_surface.run_tool_call(self.conn, name, arguments, meta=AGENT)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def item(
        self,
        title: str,
        projects: list[str] | None = None,
        *,
        space: str = "HOME",
        kind: str = "task",
        parent: str | None = None,
    ) -> dict:
        made = service.create_work_item(
            self.conn,
            space=space,
            title=title,
            projects=projects,
            kind=kind,
            parent=parent,
            acceptance="assignment",
        )
        self.conn.commit()
        return made

    def mapped(self, project: str) -> dict:
        return {
            "project_id": project,
            "display_name": project.title(),
            "root": str(self.dirs[project]),
            "status": "mapped",
        }

    def place(self, launch_place: str, space: str = "HOME") -> dict:
        status, record = api.handle_post(
            self.conn,
            "/api/planning/space/settings",
            {"space": space, "launch_place": launch_place},
        ) or (0, {})
        self.conn.commit()
        self.assertEqual(200, status)
        return record

    def launch_root(self, item: dict) -> tuple[str | None, str | None]:
        found = item_projects.launch_root(self.conn, str(item["work_item_id"]))
        return found["project_id"], found["root"]

    def capabilities(self, item: dict) -> dict:
        status, body = execution_api.handle_get(
            self.conn, "/api/execution/capabilities", {"work_item": [str(item["reference"])]}
        ) or (0, {})
        self.assertEqual(200, status)
        return body


class ClaimRootsTests(RootsCase):
    def test_a_claim_names_the_root_of_each_project_the_task_changes(self) -> None:
        d = self.item("D", ["inner", "rover"])
        plain = self.item("plain")
        self.assertEqual(
            [self.mapped("inner"), self.mapped("rover")],
            self.tool("claim_work_item", id=d["reference"])["project_roots"],
        )
        # An item that names none holds its space's default project.
        self.assertEqual(
            [self.mapped("umbrella")],
            self.tool("claim_work_item", id=plain["reference"])["project_roots"],
        )

    def test_the_space_s_projects_come_first_the_default_before_the_others(self) -> None:
        every = ["rover", "loose", "gone", "inner", "umbrella", "side", "ghost"]
        item = self.item("every", every)
        self.write_registry(without="gone")
        roots = item_projects.project_roots(self.conn, str(item["work_item_id"]))
        self.assertEqual(
            [
                self.mapped("umbrella"),
                self.mapped("inner"),
                self.mapped("side"),
                {
                    "project_id": "ghost",
                    "display_name": "Ghost",
                    "root": str(self.dirs["ghost"]),
                    "status": "missing",
                },
                {
                    "project_id": "gone",
                    "display_name": None,
                    "root": None,
                    "status": "unregistered",
                },
                self.mapped("loose"),
                self.mapped("rover"),
            ],
            roots,
        )
        self.assertEqual(
            set(item_projects.ROOT_STATUSES) - {"unavailable"}, {root["status"] for root in roots}
        )

    def test_an_unread_registry_names_the_item_s_projects_by_id_and_no_default(self) -> None:
        d = self.item("D", ["rover", "inner"])
        plain = self.item("plain")
        self.registry.write_bytes(b"{ not json")
        self.assertEqual(
            [
                {"project_id": project, "display_name": None, "root": None, "status": "unavailable"}
                for project in ("inner", "rover")
            ],
            self.tool("claim_work_item", id=d["reference"])["project_roots"],
        )
        self.assertEqual([], self.tool("claim_work_item", id=plain["reference"])["project_roots"])

    def test_every_answer_where_a_claim_began_or_held_names_the_roots(self) -> None:
        expected = [self.mapped("inner")]
        verbose = self.item("verbose", ["inner"])
        self.assertEqual(
            expected,
            self.tool("claim_work_item", id=verbose["reference"], verbose=True)["project_roots"],
        )
        batch = self.item("batch", ["inner"])
        self.assertEqual(
            expected,
            self.tool("apply_work_item_changes", id=batch["reference"], claim=True)[
                "project_roots"
            ],
        )
        created = self.tool(
            "create_work_item",
            space="HOME",
            title="made",
            projects=["inner"],
            claim=True,
            acceptance="assignment",
        )
        self.assertEqual(expected, created["project_roots"])
        # The queue hands over the one ready task nobody holds now.
        self.tool("claim_work_item", id=self.item("plain")["reference"])
        ready = self.item("ready", ["inner"])
        taken = self.tool("claim_ready_work_item", space="HOME")
        self.assertEqual(
            (ready["reference"], expected),
            (taken["work_item"]["reference"], taken["project_roots"]),
        )

    def test_an_answer_without_a_claim_names_no_roots(self) -> None:
        item = self.item("item", ["inner"])
        self.tool("claim_work_item", id=item["reference"])
        self.assertNotIn(
            "project_roots", self.tool("claim_work_item", id=item["reference"], release=True)
        )
        self.assertNotIn(
            "project_roots",
            self.tool("apply_work_item_changes", id=item["reference"], update={"title": "renamed"}),
        )
        self.assertNotIn(
            "project_roots",
            self.tool("create_work_item", space="HOME", title="unclaimed", acceptance="assignment"),
        )
        self.assertNotIn("project_roots", self.tool("claim_ready_work_item", space="ROVER"))
        # The HTTP boundary answers a browser, which edits no checkout.
        _status, http = api.handle_post(
            self.conn, "/api/planning/work-item/claim", {"id": item["reference"]}
        ) or (0, {})
        self.assertNotIn("project_roots", http)


class LaunchRootTests(RootsCase):
    def test_the_launch_place_space_takes_the_space_s_root_whatever_the_item_names(self) -> None:
        for projects in (None, ["inner"], ["rover"], ["inner", "rover"]):
            item = self.item("space", projects)
            self.assertEqual(
                ("umbrella", str(self.dirs["umbrella"])), self.launch_root(item), projects
            )

    def test_the_launch_place_item_project_follows_how_many_projects_it_names(self) -> None:
        self.place("item_project")
        cases = {
            # None: the default project of its space.
            "none": (None, "umbrella"),
            # One: that project, even one of another space.
            "inner": (["inner"], "inner"),
            "rover": (["rover"], "rover"),
            # Several: the space's root, as a set has no first.
            "several": (["inner", "rover"], "umbrella"),
        }
        for title, (projects, expected) in cases.items():
            item = self.item(title, projects)
            self.assertEqual((expected, str(self.dirs[expected])), self.launch_root(item), title)

    def test_a_goal_takes_the_space_s_root_though_its_tasks_name_one_project(self) -> None:
        self.place("item_project")
        goal = self.item("goal", kind="goal")
        self.item("under", ["rover"], parent=str(goal["reference"]))
        self.assertEqual(("umbrella", str(self.dirs["umbrella"])), self.launch_root(goal))

    def test_a_root_that_cannot_be_named_says_why(self) -> None:
        self.place("item_project")
        ghost = self.item("ghost", ["ghost"])
        gone = self.item("gone", ["gone"])
        self.write_registry(without="gone")
        found = item_projects.launch_root(self.conn, str(ghost["work_item_id"]))
        self.assertEqual(("ghost", "unavailable"), (found["project_id"], found["status"]))
        # The word the claim's roots give the same project, not `missing`, which a
        # space that binds nothing gives below.
        found = item_projects.launch_root(self.conn, str(gone["work_item_id"]))
        self.assertEqual(
            ("gone", None, "unregistered"), (found["project_id"], found["root"], found["status"])
        )
        self.assertEqual(
            "unregistered",
            item_projects.project_roots(self.conn, str(gone["work_item_id"]))[0]["status"],
        )
        self.assertEqual("unregistered", self.capabilities(gone)["repository_status"])
        bare_space = self.tool("create_planning_space", name="Bare", key="BARE")
        bare = self.item("bare", space=bare_space["key"])
        found = item_projects.launch_root(self.conn, str(bare["work_item_id"]))
        self.assertEqual(
            (None, None, "missing"), (found["project_id"], found["root"], found["status"])
        )
        self.registry.write_bytes(b"{ not json")
        self.assertEqual(
            "malformed", item_projects.launch_root(self.conn, str(ghost["work_item_id"]))["status"]
        )
        self.registry.unlink()
        found = item_projects.launch_root(self.conn, str(ghost["work_item_id"]))
        self.assertEqual(("ghost", "unavailable"), (found["project_id"], found["status"]))

    def test_changing_the_launch_place_changes_the_root_the_server_names(self) -> None:
        v = self.item("V", ["inner"])
        d = self.item("D", ["inner", "rover"])
        before = self.capabilities(v)
        self.assertEqual(
            (str(self.dirs["umbrella"]), "mapped", "umbrella", "space"),
            tuple(
                before[name]
                for name in (
                    "repository",
                    "repository_status",
                    "repository_project",
                    "launch_place",
                )
            ),
        )
        self.place("item_project")
        after = self.capabilities(v)
        self.assertEqual(
            (str(self.dirs["inner"]), "mapped", "inner", "item_project"),
            tuple(
                after[name]
                for name in (
                    "repository",
                    "repository_status",
                    "repository_project",
                    "launch_place",
                )
            ),
        )
        self.assertEqual(str(self.dirs["umbrella"]), self.capabilities(d)["repository"])

    def test_a_read_that_names_no_item_names_no_root(self) -> None:
        _status, body = execution_api.handle_get(self.conn, "/api/execution/capabilities", {}) or (
            0,
            {},
        )
        self.assertEqual(
            ("", "missing", None, None),
            tuple(
                body[name]
                for name in (
                    "repository",
                    "repository_status",
                    "repository_project",
                    "launch_place",
                )
            ),
        )

    def test_a_launch_records_the_project_of_its_root(self) -> None:
        self.place("item_project")
        v = self.item("V", ["rover"])
        record = service.get_work_item(self.conn, str(v["reference"]))
        self.assertEqual("rover", lifecycle._project_id(self.conn, str(v["work_item_id"])))
        self.assertEqual(
            "rover", lifecycle._correlation(self.conn, "e1", record)["valkama.project.id"]
        )
        self.place("space")
        self.assertEqual("umbrella", lifecycle._project_id(self.conn, str(v["work_item_id"])))
        self.registry.write_bytes(b"{ not json")
        bare = self.item("bare")
        self.assertEqual("", lifecycle._project_id(self.conn, str(bare["work_item_id"])))


class AddedRootsTests(RootsCase):
    """The roots a launch gets beside the one it runs in."""

    def added(self, item: dict) -> list[str]:
        roots = item_projects.added_roots(self.conn, str(item["work_item_id"]))
        for root in roots:
            self.assertEqual(str(self.dirs[root["project_id"]]), root["root"])
        return [root["project_id"] for root in roots]

    def test_a_root_inside_the_launch_root_is_left_out_and_one_outside_comes_in(self) -> None:
        self.place("item_project")
        d = self.item("D", ["inner", "rover"])
        # Two projects: the launch runs in the space's root `umbrella`. `inner` lies
        # inside it; `rover` is the item's and outside; `side` is the space's, not
        # named, and outside.
        self.assertEqual(("umbrella", str(self.dirs["umbrella"])), self.launch_root(d))
        self.assertEqual(["rover", "side"], self.added(d))

    def test_the_item_s_roots_come_in_claim_order_then_the_space_s_by_id(self) -> None:
        item = self.item("every", ["rover", "loose", "gone", "ghost", "side"])
        self.write_registry(without="gone")
        # `ghost` has no directory and `gone` left the registry: neither is mapped.
        self.assertEqual(["side", "loose", "rover"], self.added(item))

    def test_a_launch_in_another_space_s_root_gets_every_root_of_the_item_s_space(self) -> None:
        self.place("item_project")
        rover = self.item("rover", ["rover"])
        self.assertEqual(("rover", str(self.dirs["rover"])), self.launch_root(rover))
        # Outside `rover` each of them, `inner` too though `umbrella` holds it.
        self.assertEqual(["inner", "side", "umbrella"], self.added(rover))
        self.assertEqual([], self.added(self.item("plain", space="ROVER")))

    def test_an_unread_registry_adds_no_root(self) -> None:
        d = self.item("D", ["inner", "rover"])
        self.registry.write_bytes(b"{ not json")
        self.assertEqual([], self.added(d))


class LaunchPlaceSettingTests(RootsCase):
    def test_the_owner_writes_the_launch_place_and_the_space_record_answers(self) -> None:
        record = self.place("item_project")
        self.assertEqual(
            ("HOME", "item_project", "umbrella"),
            (record["key"], record["launch_place"], record["default_project"]),
        )
        self.assertEqual(
            "item_project", self.tool("get_planning_space", space="HOME")["launch_place"]
        )
        listed = {
            space["key"]: space for space in self.tool("list_planning_spaces")["planning_spaces"]
        }
        self.assertEqual(
            ("item_project", "space"),
            (listed["HOME"]["launch_place"], listed["ROVER"]["launch_place"]),
        )
        self.assertEqual("space", self.place("space", "Home")["launch_place"])

    def test_an_unknown_launch_place_is_refused_and_nothing_changes(self) -> None:
        for payload in (
            {"space": "HOME", "launch_place": "elsewhere"},
            {"space": "HOME", "launch_place": None},
            {"space": "HOME"},
            {"space": "HOME", "launch_place": ["space"]},
        ):
            with self.assertRaises(Exception) as caught:
                api.handle_post(self.conn, "/api/planning/space/settings", payload)
            self.conn.rollback()
            self.assertEqual(
                (400, "invalid_request", "launch_place must be space or item_project"),
                (
                    api.error_response(caught.exception)[0],
                    api.error_response(caught.exception)[1]["error"]["code"],
                    api.error_response(caught.exception)[1]["error"]["message"],
                ),
                payload,
            )
        self.assertEqual("space", self.tool("get_planning_space", space="HOME")["launch_place"])
        with self.assertRaises(Exception) as caught:
            api.handle_post(
                self.conn,
                "/api/planning/space/settings",
                {"space": "NONE", "launch_place": "space"},
            )
        self.conn.rollback()
        self.assertEqual(400, api.error_response(caught.exception)[0])

    def test_no_planning_tool_writes_the_launch_place(self) -> None:
        for tool in mcp_surface.catalogue():
            self.assertNotIn(
                "launch_place", tool["inputSchema"].get("properties", {}), tool["name"]
            )


class LaunchedProjectTests(LaunchHarness):
    """The attempt row itself carries the project of the launch root."""

    def test_the_attempt_names_the_project_whose_root_it_runs_in(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        local = Path(directory.name)
        patch = mock.patch.dict(os.environ, {"LOCALAPPDATA": str(local)})
        patch.start()
        self.addCleanup(patch.stop)
        scope = str(read_store_metadata(self.conn)["data_scope_id"])
        space = planning_space_entity({"data_scope_id": scope, "space_key": "TST"})
        home = project_entry("home", self.repo)
        home["planning_binding"] = {**space, "default": True}
        extra = project_entry("extra", local / "extra")
        registry = local / "Valkama" / "projects.json"
        registry.parent.mkdir(parents=True)
        registry.write_bytes(registry_bytes([home, extra]))
        launched = []
        for place in ("space", "item_project"):
            service.set_launch_place(self.conn, "TST", place)
            made = service.create_work_item(
                self.conn, space="TST", title=place, projects=["extra"], acceptance="assignment"
            )
            self.conn.commit()
            lifecycle.launch_work_item(self.conn, self.packet(str(made["reference"])))
            launched.append(
                self.conn.execute(
                    "SELECT project_id FROM executions WHERE work_item_id = ?",
                    (str(made["work_item_id"]),),
                ).fetchone()[0]
            )
        self.assertEqual(["home", "extra"], launched)


if __name__ == "__main__":
    unittest.main()
