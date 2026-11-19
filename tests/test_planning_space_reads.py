"""A space's read: its items, other spaces' items naming its projects, and links both ways.

The registry binds `example-project` and `valkama` to MAIN and `beta-app` to BETA. A
task of MAIN naming `valkama` and `beta-app` is in the reads of both spaces, marked
in BETA's as MAIN's. Every link with an end among a read's items comes with it, in
either direction, and an end the read does not hold is named in
`other_space_ends`. A project narrows a read to the items naming it, and other
spaces bring theirs only for a project of the space read. A goal or stage names
what a task under it names, at any depth.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import mcp_surface, store
from server.planning import api, read_model, service, views
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_entry, registry_bytes

AGENT = {"sessionId": "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3f"}
MAIN = {"key": "MAIN", "name": "Example project"}
BETA = {"key": "BETA", "name": "Beta"}
#: Each project, the space the registry binds it to and whether it is that space's default.
BOUND = {
    "example-project": ("MAIN", True),
    "valkama": ("MAIN", False),
    "beta-app": ("BETA", True),
}


class SpaceReadCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": str(root / "valkama.sqlite3"),
                "HOME": directory.name,
                "USERPROFILE": directory.name,
                "LOCALAPPDATA": str(root / "local"),
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        scope = str(read_store_metadata(self.conn)["data_scope_id"])
        entries = []
        for project, (space, default) in BOUND.items():
            entry = project_entry(project, root / project)
            entity = planning_space_entity({"data_scope_id": scope, "space_key": space})
            entry["planning_binding"] = {**entity, "default": default}
            entries.append(entry)
        registry = root / "local" / "Valkama" / "projects.json"
        registry.parent.mkdir(parents=True)
        registry.write_bytes(registry_bytes(entries))
        for space in (MAIN, BETA):
            service.create_planning_space(self.conn, name=space["name"], key=space["key"])
        self.d = self.task("MAIN", "Two projects", ["valkama", "beta-app"])
        self.v = self.task("MAIN", "Valkama only", ["valkama"])
        self.a = self.task("MAIN", "Blocks D")
        self.b = self.task("MAIN", "Blocked by D")
        self.r = self.task("BETA", "Beta's own", ["beta-app"])
        self.bv = self.task("BETA", "Names another space's project", ["valkama"])
        self.link(self.a, self.d, "blocks")
        self.link(self.d, self.b, "blocks")
        self.link(self.a, self.b, "relates-to")
        self.link(self.v, self.r, "relates-to")

    def task(
        self, space: str, title: str, projects: list[str] | None = None, **fields: object
    ) -> str:
        """An item of `space` naming `projects`, given by an edit: filed with them it
        would lie in their home space, and an edit does not move it."""

        created = service.create_work_item(self.conn, space=space, title=title, **fields)
        if projects is not None:
            service.update_work_item(self.conn, str(created["work_item_id"]), projects=projects)
        self.conn.commit()
        return str(created["reference"])

    def link(self, source: str, target: str, kind: str) -> None:
        service.link_work_items(self.conn, source, target, kind)
        self.conn.commit()

    def tool(self, name: str, **arguments: object) -> dict:
        answer = mcp_surface.run_tool_call(self.conn, name, arguments, meta=AGENT)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def listed(self, **arguments: object) -> list[str]:
        return sorted(
            row["reference"] for row in self.tool("list_work_items", **arguments)["work_items"]
        )

    def read(self, space: str, project: str | None = None) -> dict:
        return views.planning_payload(self.conn, space=space, project=project)

    @staticmethod
    def marks(payload: dict) -> dict[str, dict | None]:
        return {item["reference"]: item["other_space"] for item in payload["work_items"]}

    def identity(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["work_item_id"])


class OtherSpaceItemTests(SpaceReadCase):
    def test_an_item_naming_two_projects_is_in_the_read_of_each_space(self) -> None:
        self.assertIn(self.d, self.listed(project="valkama"))
        self.assertIn(self.d, self.listed(project="beta-app"))
        self.assertEqual({self.r: None, self.bv: None, self.d: MAIN}, self.marks(self.read("BETA")))
        # BETA's item naming valkama is in MAIN's read the same way.
        self.assertEqual(
            {self.d: None, self.v: None, self.a: None, self.b: None, self.bv: BETA},
            self.marks(self.read("MAIN")),
        )

    def test_a_spaces_list_holds_and_marks_the_other_spaces_items(self) -> None:
        rows = {
            row["reference"]: row
            for row in self.tool("list_work_items", space="BETA")["work_items"]
        }
        self.assertEqual({self.r, self.bv, self.d}, set(rows))
        self.assertEqual(MAIN, rows[self.d]["other_space"])
        # A row of the space's own carries no mark: it would only repeat the space read.
        self.assertNotIn("other_space", rows[self.r])
        full = self.tool("list_work_items", space="BETA", verbose=True)["work_items"]
        self.assertEqual(
            {self.r: None, self.bv: None, self.d: MAIN}, self.marks({"work_items": full})
        )
        # Without a space there is no space read, and nothing is marked.
        everywhere = self.tool("list_work_items", verbose=True)["work_items"]
        self.assertFalse(any("other_space" in item for item in everywhere))

    def test_each_row_of_a_spaces_read_names_its_parent_by_reference(self) -> None:
        goal = self.task("MAIN", "Goal", kind="goal")
        stage = self.task("MAIN", "Stage", kind="goal", parent=goal)
        under = self.task("MAIN", "Under the stage", ["beta-app"], parent=stage)
        own_goal = self.task("BETA", "Own goal", kind="goal")
        own = self.task("BETA", "Under its own goal", ["beta-app"], parent=own_goal)
        parents = {item["reference"]: item["parent"] for item in self.read("BETA")["work_items"]}
        # Another space's card names its parent in its own space, as this space's work does.
        self.assertEqual(stage, parents[under])
        self.assertEqual(goal, parents[stage])
        self.assertEqual(own_goal, parents[own])
        self.assertIsNone(parents[goal])
        self.assertIsNone(parents[self.d])

    def test_the_parents_of_a_read_are_named_in_one_statement(self) -> None:
        goal = self.task("MAIN", "Goal", kind="goal")
        children = [self.task("MAIN", f"Task {n}", parent=goal) for n in range(5)]
        ids = [self.identity(reference) for reference in [goal, *children]]
        said: list[str] = []
        self.conn.set_trace_callback(said.append)
        try:
            named = read_model.parent_references(self.conn, [*ids, None, ids[0]])
        finally:
            self.conn.set_trace_callback(None)
        self.assertEqual(1, len(said), said)
        self.assertEqual(dict(zip(ids, [goal, *children], strict=True)), named)
        self.assertEqual({}, read_model.parent_references(self.conn, [None, ""]))

    def test_a_list_of_the_space_alone_is_what_a_caller_asks_without_other_spaces(self) -> None:
        own = service.list_work_items(self.conn, space="BETA", limit=None)
        self.assertEqual({self.r, self.bv}, {item["reference"] for item in own})
        self.assertFalse(any("other_space" in item for item in own))


class LinkBetweenSpacesTests(SpaceReadCase):
    def edges(self, payload: dict, key: str = "links") -> set[tuple[str, str, str]]:
        names = {
            self.identity(reference): reference
            for reference in (self.d, self.v, self.a, self.b, self.r, self.bv)
        }
        return {(names[edge["from"]], names[edge["to"]], edge["kind"]) for edge in payload[key]}

    def test_links_with_an_end_in_the_read_come_both_ways_with_the_ends_it_does_not_hold(
        self,
    ) -> None:
        graph = views.graph_payload(self.conn, space="BETA")
        # Into D and out of it, and the relation from MAIN to BETA's own item; A to B has no end here.
        self.assertEqual(
            {
                (self.a, self.d, "blocks"),
                (self.d, self.b, "blocks"),
                (self.v, self.r, "relates-to"),
            },
            self.edges(graph, "edges"),
        )
        expected_state = {
            "key": "triage",
            "name": "Triage",
            "category": "triage",
            "is_terminal": False,
        }
        self.assertEqual(
            [
                {
                    "work_item_id": self.identity(reference),
                    "reference": reference,
                    "title": title,
                    "kind": "task",
                    "state": expected_state,
                    "space": MAIN,
                }
                for reference, title in (
                    (self.v, "Valkama only"),
                    (self.a, "Blocks D"),
                    (self.b, "Blocked by D"),
                )
            ],
            graph["other_space_ends"],
        )
        nodes = {node["reference"]: node["other_space"] for node in graph["nodes"]}
        self.assertEqual({self.r: None, self.bv: None, self.d: MAIN}, nodes)
        # D waits for A, an open blocker the read does not hold.
        self.assertEqual(1, next(n for n in graph["nodes"] if n["reference"] == self.d)["depth"])
        self.assertEqual(graph["other_space_ends"], self.read("BETA")["other_space_ends"])

    def test_the_other_space_reads_the_same_link_from_its_end(self) -> None:
        here = self.read("MAIN")
        self.assertEqual(
            {
                (self.a, self.d, "blocks"),
                (self.d, self.b, "blocks"),
                (self.a, self.b, "relates-to"),
                (self.v, self.r, "relates-to"),
            },
            self.edges(here),
        )
        self.assertEqual(
            [(self.r, BETA)], [(end["reference"], end["space"]) for end in here["other_space_ends"]]
        )


class ProjectRefinementTests(SpaceReadCase):
    def references(self, payload: dict) -> list[str]:
        return sorted(item["reference"] for item in payload["work_items"])

    def test_a_project_of_the_space_narrows_its_items_and_the_other_spaces(self) -> None:
        self.assertEqual(sorted([self.r, self.d]), self.references(self.read("BETA", "beta-app")))
        self.assertEqual(sorted([self.r, self.d]), self.listed(space="BETA", project="beta-app"))

    def test_a_project_of_another_space_keeps_only_the_spaces_own_items_naming_it(self) -> None:
        # D names valkama too, but valkama is MAIN's: BETA's read narrowed by it is BETA's own.
        self.assertEqual([self.bv], self.references(self.read("BETA", "valkama")))
        self.assertEqual([self.bv], self.listed(space="BETA", project="valkama"))
        self.assertEqual([self.d], self.references(self.read("MAIN", "beta-app")))
        self.assertEqual(
            sorted([self.d, self.v, self.bv]), self.references(self.read("MAIN", "valkama"))
        )

    def test_the_http_read_and_the_graph_take_the_project_beside_the_space(self) -> None:
        query = {"space": ["BETA"], "project": ["valkama"]}
        for path, key in (("/api/planning", "work_items"), ("/api/planning/graph", "nodes")):
            with self.subTest(path=path):
                answer = api.handle_get(self.conn, path, query)
                assert answer is not None
                self.assertEqual([self.bv], [entry["reference"] for entry in answer[1][key]])
                with self.assertRaises(api.PlanningHttpError) as refused:
                    api.handle_get(self.conn, path, {"project": ["valkama"]})
                self.assertEqual(400, refused.exception.status)
        # The narrowed read's links are the ones with an end among what it kept.
        narrowed = self.read("BETA", "valkama")
        self.assertEqual([], narrowed["links"])
        self.assertEqual([], narrowed["other_space_ends"])


class ContainerTests(SpaceReadCase):
    def test_a_goal_or_stage_is_kept_when_a_task_under_it_names_the_project(self) -> None:
        goal = self.task("MAIN", "Goal", kind="goal")
        stage = self.task("MAIN", "Stage", kind="goal", parent=goal)
        deep = self.task("MAIN", "Deep task", ["beta-app"], parent=stage)
        other_goal = self.task("MAIN", "Goal naming none of it", kind="goal")
        self.task("MAIN", "Valkama work", ["valkama"], parent=other_goal)
        self.assertEqual(
            sorted([goal, stage, deep, self.d, self.r]), self.listed(project="beta-app")
        )
        self.assertNotIn(other_goal, self.listed(project="beta-app"))
        self.assertIn(other_goal, self.listed(project="valkama"))
        self.assertEqual(
            {self.r: None, self.bv: None, self.d: MAIN, goal: MAIN, stage: MAIN, deep: MAIN},
            self.marks(self.read("BETA")),
        )
        self.assertEqual(
            sorted([goal, stage, deep, self.d, self.r]),
            sorted(self.marks(self.read("BETA", "beta-app"))),
        )
        self.assertEqual(
            sorted([goal, stage, deep, self.d]), sorted(self.marks(self.read("MAIN", "beta-app")))
        )
        nodes = {n["reference"]: n for n in views.graph_payload(self.conn, space="BETA")["nodes"]}
        self.assertEqual("goal", nodes[goal]["kind"])
        self.assertEqual("stage", nodes[stage]["kind"])


if __name__ == "__main__":
    unittest.main()
