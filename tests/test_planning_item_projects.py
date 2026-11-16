"""The projects a work item changes: named on a write, read on the card, carried by a merge.

A project is named only while the registry reads and records it, and a goal or
stage names none: it reads the projects of the tasks under it. A project an item
gets by two ways keeps the strongest source, named before commits before migrated,
which the card, a goal's read and a merge all apply. A search finds an item by
the words of its projects' ids, and a list keeps the items naming one project.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import mcp_surface, store
from server.planning import api, calls, model, service, words
from tests.registry_fixtures import project_entry, registry_bytes

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
AGENT = {"sessionId": SESSION}
SPACE = "PRJ"
#: The projects the registry records, with the names the card shows.
REGISTERED = {"valkama": "Valkama", "rover": "Rover", "atlas": "Atlas"}


def named(*projects: str) -> list[dict]:
    """What the card shows for projects a write named, in the order of their ids."""

    return [
        {"project_id": project, "display_name": REGISTERED[project], "source": "named"}
        for project in sorted(projects)
    ]


class ItemProjectsCase(unittest.TestCase):
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
        self.write_registry(REGISTERED)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Projects", key=SPACE)
        self.conn.commit()

    def write_registry(self, projects: dict[str, str]) -> None:
        entries = []
        for project, name in projects.items():
            entry = project_entry(project, self.root / project)
            entry["display_name"] = name
            entries.append(entry)
        self.registry.write_bytes(registry_bytes(entries))

    def create(self, title: str, **fields: object) -> dict:
        created = service.create_work_item(self.conn, space=SPACE, title=title, **fields)
        self.conn.commit()
        return created

    def task(self, title: str, **fields: object) -> str:
        return str(self.create(title, **fields)["reference"])

    def card(self, reference: str) -> dict:
        return service.get_work_item(self.conn, reference)

    def stored(self, reference: str) -> set[tuple[str, str]]:
        identity = str(self.card(reference)["work_item_id"])
        return {
            (str(row[0]), str(row[1]))
            for row in self.conn.execute(
                "SELECT project_id, source FROM work_item_projects WHERE work_item_id = ?",
                (identity,),
            )
        }

    def give(self, reference: str, project: str, source: str) -> None:
        """A row a later writer leaves (commits) or the migration (migrated), set directly."""

        identity = str(self.card(reference)["work_item_id"])
        self.conn.execute(
            "INSERT OR REPLACE INTO work_item_projects(work_item_id, project_id, source)"
            " VALUES(?,?,?)",
            (identity, project, source),
        )
        self.conn.commit()

    def tool(self, name: str, **arguments: object) -> dict:
        answer = mcp_surface.run_tool_call(self.conn, name, arguments, meta=AGENT)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def refused(self, name: str, **arguments: object) -> str:
        """The message a tool call is refused with, after committing what is left."""

        with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught:
            mcp_surface.run_tool_call(self.conn, name, arguments, meta=AGENT)
        self.conn.commit()
        status, body = api.error_response(caught.exception)
        self.assertEqual(400, status)
        error = body["error"]
        assert isinstance(error, dict)
        self.assertEqual("invalid_request", error["code"])
        return str(error["message"])

    def item_count(self) -> int:
        return int(self.conn.execute("SELECT COUNT(*) FROM work_items").fetchone()[0])


class WriteAndReadTests(ItemProjectsCase):
    def test_a_created_task_names_its_projects_on_the_card_and_in_the_list(self) -> None:
        reference = self.tool(
            "create_work_item",
            space=SPACE,
            title="Two projects",
            projects=["valkama", "rover", "valkama"],
        )["reference"]
        expected = named("valkama", "rover")
        self.assertEqual(expected, self.card(reference)["projects"])
        listed = service.list_work_items(self.conn, space=SPACE)
        self.assertEqual(
            expected, next(i for i in listed if i["reference"] == reference)["projects"]
        )
        self.assertEqual({("valkama", "named"), ("rover", "named")}, self.stored(reference))

    def test_a_task_that_names_none_reads_an_empty_set(self) -> None:
        self.assertEqual([], self.card(self.task("No project"))["projects"])

    def test_a_store_an_earlier_build_wrote_reads_no_projects(self) -> None:
        # Such a store, attached as it is, has no table of projects at all.
        reference = self.task("Older", projects=["valkama"])
        self.conn.execute("DROP TABLE work_item_projects")
        self.assertEqual([], self.card(reference)["projects"])
        listed = service.list_work_items(self.conn, space=SPACE)
        self.assertEqual([[]], [item["projects"] for item in listed])

    def test_an_edit_replaces_the_set_and_names_each_project_it_keeps(self) -> None:
        reference = self.task("Edited", projects=["valkama"])
        self.give(reference, "valkama", "commits")
        before = self.card(reference)
        answer = self.tool(
            "apply_work_item_changes", id=reference, update={"projects": ["valkama", "atlas"]}
        )
        self.assertEqual(["projects"], answer["applied"]["update"])
        after = self.card(reference)
        # The edit named valkama, and named is stronger than the commits it had.
        self.assertEqual(named("valkama", "atlas"), after["projects"])
        self.assertEqual(before["revision"] + 1, after["revision"])
        # An edit of projects is no audited action: the history holds none of it.
        self.assertEqual(
            [event["action"] for event in before["events"]],
            [event["action"] for event in after["events"]],
        )
        self.tool("apply_work_item_changes", id=reference, update={"projects": ["atlas"]})
        self.assertEqual(named("atlas"), self.card(reference)["projects"])
        self.tool("apply_work_item_changes", id=reference, update={"projects": []})
        self.assertEqual([], self.card(reference)["projects"])

    def test_an_edit_naming_the_set_the_item_has_writes_nothing(self) -> None:
        reference = self.task("Same", projects=["valkama"])
        revision = self.card(reference)["revision"]
        self.tool("apply_work_item_changes", id=reference, update={"projects": ["valkama"]})
        self.assertEqual(revision, self.card(reference)["revision"])

    def test_the_http_edit_names_projects_as_the_batch_does(self) -> None:
        reference = self.task("Over HTTP")
        with calls.bind(calls.verify_mcp(AGENT, None), "/api/planning/work-item/update"):
            api.handle_post(
                self.conn,
                "/api/planning/work-item/update",
                {"id": reference, "projects": ["rover"]},
            )
        self.conn.commit()
        self.assertEqual(named("rover"), self.card(reference)["projects"])

    def test_an_item_names_at_most_twenty_projects(self) -> None:
        many = {f"project-{index:02d}": f"Project {index}" for index in range(21)}
        self.write_registry(many)
        twenty = sorted(many)[:20]
        reference = self.task("Twenty", projects=[*twenty, twenty[0]])
        self.assertEqual(
            twenty, [entry["project_id"] for entry in self.card(reference)["projects"]]
        )
        count = self.item_count()
        message = self.refused(
            "create_work_item", space=SPACE, title="Twenty-one", projects=sorted(many)
        )
        self.assertEqual("projects must hold at most 20 projects", message)
        self.assertEqual(count, self.item_count())

    def test_a_name_the_registry_no_longer_records_reads_as_null(self) -> None:
        reference = self.task("Renamed away", projects=["atlas", "valkama"])
        self.write_registry({"valkama": "Valkama"})
        self.assertEqual(
            [
                {"project_id": "atlas", "display_name": None, "source": "named"},
                *named("valkama"),
            ],
            self.card(reference)["projects"],
        )

    def test_deleting_an_item_deletes_its_projects(self) -> None:
        reference = self.task("Gone", projects=["valkama"])
        identity = str(self.card(reference)["work_item_id"])
        service.delete_work_item(self.conn, reference)
        self.conn.commit()
        self.assertEqual(
            0,
            self.conn.execute(
                "SELECT COUNT(*) FROM work_item_projects WHERE work_item_id = ?", (identity,)
            ).fetchone()[0],
        )


class RefusalTests(ItemProjectsCase):
    def test_an_unregistered_project_is_refused_with_the_registered_ones(self) -> None:
        count = self.item_count()
        message = self.refused(
            "create_work_item", space=SPACE, title="Unknown", projects=["valkama", "nowhere"]
        )
        self.assertEqual(
            "[project] project nowhere is not registered: registered projects are"
            " atlas, rover, valkama",
            message,
        )
        self.assertEqual(count, self.item_count())
        reference = self.task("Known", projects=["valkama"])
        message = self.refused(
            "apply_work_item_changes",
            id=reference,
            update={"projects": ["nowhere", "elsewhere"], "title": "Renamed"},
        )
        # The batch names the group a refusal came from.
        self.assertTrue(
            message.startswith("update: [project] projects nowhere, elsewhere are not registered")
        )
        card = self.card(reference)
        self.assertEqual(("Known", named("valkama")), (card["title"], card["projects"]))

    def test_an_unreadable_registry_refuses_projects_and_takes_a_write_without_them(
        self,
    ) -> None:
        reference = self.task("Before", projects=["valkama"])
        unreadable = {
            "absent": lambda: self.registry.unlink(),
            "malformed": lambda: self.registry.write_bytes(b"{"),
        }
        for name, spoil in unreadable.items():
            with self.subTest(registry=name):
                self.write_registry(REGISTERED)
                spoil()
                count = self.item_count()
                said = (
                    "[project] the project registry cannot be read, so projects cannot be named now"
                )
                self.assertEqual(
                    said,
                    self.refused("create_work_item", space=SPACE, title="No", projects=["valkama"]),
                )
                self.assertEqual(count, self.item_count())
                self.assertEqual(
                    f"update: {said}",
                    self.refused(
                        "apply_work_item_changes", id=reference, update={"projects": ["atlas"]}
                    ),
                )
                self.assertEqual({("valkama", "named")}, self.stored(reference))
                self.task("Without projects")
                self.assertEqual(count + 1, self.item_count())

    def test_a_goal_or_stage_names_no_projects(self) -> None:
        said = "[project] a goal or stage names no projects: the tasks under it do"
        count = self.item_count()
        self.assertEqual(
            said,
            self.refused(
                "create_work_item", space=SPACE, title="Goal", kind="goal", projects=["valkama"]
            ),
        )
        goal = self.task("Goal", kind="goal")
        self.assertEqual(
            said,
            self.refused(
                "create_work_item",
                space=SPACE,
                title="Stage",
                kind="stage",
                parent=goal,
                projects=["valkama"],
            ),
        )
        self.assertEqual(count + 1, self.item_count())
        self.assertEqual(
            f"update: {said}",
            self.refused("apply_work_item_changes", id=goal, update={"projects": ["valkama"]}),
        )
        # Naming none is what a goal or stage does: nothing to refuse.
        self.tool("apply_work_item_changes", id=goal, update={"projects": []})
        self.assertEqual(set(), self.stored(goal))


class ContainerTests(ItemProjectsCase):
    def test_a_goal_reads_the_projects_of_every_task_under_it_by_the_strongest_source(
        self,
    ) -> None:
        goal = self.task("Goal", kind="goal")
        stage = self.task("Stage", kind="stage", parent=goal)
        first = self.task("First", parent=goal, projects=["rover"])
        self.give(first, "atlas", "migrated")
        second = self.task("Deep", parent=stage)
        self.give(second, "rover", "commits")
        self.give(second, "atlas", "commits")
        self.task("Elsewhere", projects=["valkama"])
        expected = [
            {"project_id": "atlas", "display_name": "Atlas", "source": "commits"},
            {"project_id": "rover", "display_name": "Rover", "source": "named"},
        ]
        self.assertEqual(expected, self.card(goal)["projects"])
        self.assertEqual(
            [
                {"project_id": "atlas", "display_name": "Atlas", "source": "commits"},
                {"project_id": "rover", "display_name": "Rover", "source": "commits"},
            ],
            self.card(stage)["projects"],
        )
        listed = {
            item["reference"]: item for item in service.list_work_items(self.conn, space=SPACE)
        }
        self.assertEqual(expected, listed[goal]["projects"])
        self.assertEqual(self.card(stage)["projects"], listed[stage]["projects"])
        self.assertEqual(set(), self.stored(goal))

    def test_a_goal_with_no_task_naming_a_project_reads_none(self) -> None:
        goal = self.task("Empty goal", kind="goal")
        self.task("Plain", parent=goal)
        self.assertEqual([], self.card(goal)["projects"])


class MergeTests(ItemProjectsCase):
    def test_a_merge_carries_the_duplicates_projects_by_the_strongest_source(self) -> None:
        survivor = self.task("The change")
        self.give(survivor, "valkama", "commits")
        first = self.task("Found once", projects=["valkama"])
        second = self.task("Found again")
        self.give(second, "rover", "migrated")
        self.give(second, "valkama", "migrated")
        answer = self.tool("merge_work_items", id=survivor, items=[first, second])
        self.assertEqual([1, 2], [entry["moved"]["projects"] for entry in answer["merged"]])
        self.assertEqual(
            [
                {"project_id": "rover", "display_name": "Rover", "source": "migrated"},
                {"project_id": "valkama", "display_name": "Valkama", "source": "named"},
            ],
            self.card(survivor)["projects"],
        )
        self.assertEqual((set(), set()), (self.stored(first), self.stored(second)))
        self.assertIn("1 project.", self.card(first)["summary"]["done"])

    def test_a_weaker_source_arriving_leaves_the_survivors_stronger_one(self) -> None:
        survivor = self.task("The change", projects=["valkama"])
        duplicate = self.task("Twin")
        self.give(duplicate, "valkama", "commits")
        self.tool("merge_work_items", id=survivor, items=[duplicate])
        self.assertEqual(named("valkama"), self.card(survivor)["projects"])


class SearchTests(ItemProjectsCase):
    """A project's id is a word of the item that names it, by the index and by a phrase."""

    def setUp(self) -> None:
        super().setUp()
        self.write_registry({**REGISTERED, "event-relay-service": "Relay Service"})

    def found(self, query: str) -> list[str]:
        return [item["reference"] for item in service.search_work_items(self.conn, query)]

    def stale(self) -> list[str]:
        return [
            str(row[0])
            for row in self.conn.execute(
                "SELECT work_item_id FROM work_item_search_rows WHERE stale = 1"
            )
        ]

    def test_a_word_of_a_project_id_finds_the_task_while_it_names_the_project(self) -> None:
        wanted = self.task("Bring up the listener", projects=["event-relay-service"])
        self.task("Unrelated work")
        # Each word of the id finds it, as a part of a former label would.
        for query in ("relay", "service", "event relay"):
            with self.subTest(query=query):
                self.assertEqual([wanted], self.found(query))
        self.tool("apply_work_item_changes", id=wanted, update={"projects": ["rover"]})
        self.assertEqual([], self.found("service"))
        self.assertEqual([wanted], self.found("rover"))
        self.assertEqual([], self.stale())

    def test_a_project_row_gained_or_lost_marks_only_its_item_stale(self) -> None:
        """Any writer: the rows here are written outside the service, as a migration does."""

        marked = self.task("Marked")
        self.task("Left alone")
        identity = str(self.card(marked)["work_item_id"])
        self.assertEqual([], self.stale())
        self.conn.execute(
            "INSERT INTO work_item_projects(work_item_id, project_id, source)"
            " VALUES(?, 'atlas', 'commits')",
            (identity,),
        )
        self.assertEqual([identity], self.stale())
        words.bring_current(self.conn)
        self.assertEqual([marked], self.found("atlas"))
        self.conn.execute("DELETE FROM work_item_projects WHERE work_item_id = ?", (identity,))
        self.assertEqual([identity], self.stale())
        words.bring_current(self.conn)
        self.assertEqual([], self.found("atlas"))

    def test_without_the_index_a_phrase_finds_the_task_by_its_project(self) -> None:
        wanted = self.task("Bring up the listener", projects=["event-relay-service"])
        self.task("Unrelated work")
        self.conn.execute("DROP TABLE work_item_search")
        self.assertEqual([wanted], self.found("relay-service"))
        # A phrase, not words: the id holds no "service relay".
        self.assertEqual([], self.found("service relay"))
        # An attached store an earlier build wrote has no table of projects to read.
        self.conn.execute("DROP TABLE work_item_projects")
        self.assertEqual([wanted], self.found("listener"))
        self.assertEqual([], self.found("relay-service"))


class ProjectFilterTests(ItemProjectsCase):
    def listed(self, **arguments: object) -> list[str]:
        answer = self.tool("list_work_items", **arguments)
        return sorted(str(item["reference"]) for item in answer["work_items"])

    def test_the_project_filter_reads_every_space_and_narrows_to_a_space_given(self) -> None:
        service.create_planning_space(self.conn, name="Other", key="OTH")
        here = self.task("Here", projects=["rover"])
        goal = self.task("Umbrella", kind="goal")
        under = self.task("Under the goal", parent=goal, projects=["rover"])
        other_goal = self.task("Another umbrella", kind="goal")
        self.task("Another project", parent=other_goal, projects=["valkama"])
        self.task("No project")
        there = str(
            service.create_work_item(
                self.conn, space="OTH", title="There", projects=["rover", "atlas"]
            )["reference"]
        )
        self.conn.commit()
        # A goal names what a task under it names, and nothing else.
        self.assertEqual(sorted([here, goal, under, there]), self.listed(project="rover"))
        self.assertEqual(sorted([here, goal, under]), self.listed(project="rover", space=SPACE))
        self.assertEqual([there], self.listed(project="atlas"))
        self.assertEqual([], self.listed(project="atlas", space=SPACE))
        self.assertEqual([], self.listed(project="unnamed"))
        read = api.handle_get(
            self.conn, "/api/planning/work-items", {"project": ["atlas"], "space": ["OTH"]}
        )
        assert read is not None
        self.assertEqual([there], [item["reference"] for item in read[1]["work_items"]])


if __name__ == "__main__":
    unittest.main()
