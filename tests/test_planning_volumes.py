"""The volumes read: how much work stands in a scope, counted as the store holds it.

The registry binds `app` to MAIN and `lib` to ALPHA. Items are placed straight in SQL
(`planning_tree.Tree`) with the state entries each case needs, and every expected
number is counted here from the tables and the bindings this case wrote, by the rule
the read states: a space holds its items and the items of other spaces that name one
of its projects; a goal or stage names what a task under it names; a project narrows
a space to the items naming it, and brings other spaces' only when it is the space's.
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

from server import store
from server.planning import api, commits, model, service, triage
from server.projects import scopes
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.planning_tree import Tree
from tests.registry_fixtures import project_entry, registry_bytes

#: Each project and the space the registry binds it to.
BOUND = {"app": "MAIN", "lib": "ALPHA"}
#: The days of the period, at three hours east of UTC: 21:00 UTC on the 9th up to the 16th.
PERIOD = {"from": "2026-11-10", "to": "2026-11-17", "utc_offset": "180"}
BEGINS = datetime(2026, 11, 9, 21, tzinfo=UTC)
ENDS = datetime(2026, 11, 16, 21, tzinfo=UTC)
#: What says an item came to stand where it is, as the history writes it.
ENTRIES = ("created", "transitioned", "opened")
CATEGORIES = (
    "triage",
    "deferred",
    "ready",
    "active",
    "review",
    "completed",
    "blocked",
    "cancelled",
)
CLOSED = ("completed", "cancelled")
#: The three fields a category holds: its tasks, its goals and its stages.
SHAPES = ("tasks", "goals", "stages")


def _moment(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def _repeated(parameters: dict[str, str | list[str]]) -> dict[str, list[str]]:
    """The query as the HTTP surface hands it on: each name with all its values."""

    return {
        name: value if isinstance(value, list) else [value] for name, value in parameters.items()
    }


class VolumesCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.primary = self.root / "valkama.sqlite3"
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": str(self.primary),
                "HOME": directory.name,
                "USERPROFILE": directory.name,
                "LOCALAPPDATA": str(self.root / "local"),
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.scope_id = str(read_store_metadata(self.conn)["data_scope_id"])
        entries = []
        for project, space in BOUND.items():
            entry = project_entry(project, self.root / project)
            entity = planning_space_entity({"data_scope_id": self.scope_id, "space_key": space})
            entry["planning_binding"] = {**entity, "default": True}
            entries.append(entry)
        registry = self.root / "local" / "Valkama" / "projects.json"
        registry.parent.mkdir(parents=True)
        registry.write_bytes(registry_bytes(entries))
        self.trees = {"MAIN": Tree(self.conn, "MAIN"), "ALPHA": Tree(self.conn, "ALPHA")}
        self.hour = 0

    # -- placing ---------------------------------------------------------------

    def place(
        self,
        space: str,
        name: str,
        *,
        projects: tuple[str, ...] = (),
        entries: tuple[str, ...] = (),
        created: str | None = None,
        **fields: object,
    ) -> str:
        """An item of `space` naming `projects`, whose state entries happened at `entries`.

        Each item is created at a minute of its own, so no two stand from the same moment.
        """

        tree = self.trees[space]
        identity = tree.add(name, **fields)
        self.hour += 1
        self.conn.execute(
            "UPDATE work_items SET created_at = ? WHERE work_item_id = ?",
            (created or f"2026-11-01T00:{self.hour:02d}:00Z", identity),
        )
        for project in projects:
            self.conn.execute(
                "INSERT INTO work_item_projects(work_item_id, project_id, source)"
                " VALUES (?, ?, 'named')",
                (identity, project),
            )
        for stamp in entries:
            self.conn.execute(
                "INSERT INTO work_item_events(work_item_id, action, detail, author, created_at)"
                " VALUES (?, 'transitioned', 'moved', 'case', ?)",
                (identity, stamp),
            )
        return identity

    def question(
        self,
        name: str,
        created: str,
        *,
        status: str = "pending",
        addressee: str | None = None,
        expires_at: str | None = None,
    ) -> str:
        identity = f"request-{created}"
        self.conn.execute(
            "INSERT INTO work_item_requests(request_id, work_item_id, kind, prompt, fields_json,"
            " status, author, created_at, addressee, expires_at)"
            " VALUES (?, ?, 'question', 'Which way?', '[]', ?, 'asking-agent', ?, ?, ?)",
            (identity, *self.ids(name), status, created, addressee, expires_at),
        )
        return identity

    def ids(self, *names: str) -> set[str]:
        found = set()
        for name in names:
            space, _, short = name.partition(":")
            found.add(self.trees[space].ids[short])
        return found

    # -- reading ---------------------------------------------------------------

    def volumes(
        self, space: str | None = None, project: str | None = None, **more: str | list[str]
    ) -> dict:
        """The read of a space, or of every space; a parameter given a list is repeated."""

        parameters: dict[str, str | list[str]] = {**PERIOD, **more}
        if space is None:
            parameters["scope_kind"] = "global"
        else:
            parameters |= {"scope_kind": "space", "data_scope_id": self.scope_id}
            parameters["space_key"] = space
        if project is not None:
            parameters["project_id"] = project
        answer = api.handle_get(self.conn, "/api/planning/volumes", _repeated(parameters))
        assert answer is not None
        self.assertEqual(200, answer[0])
        return answer[1]["volumes"]

    def refused(self, parameters: dict[str, str | list[str]]) -> str:
        """The words of the read's refusal, which is a request the caller can mend."""

        with self.assertRaises(Exception) as caught:
            api.handle_get(self.conn, "/api/planning/volumes", _repeated(parameters))
        status, body = api.error_response(caught.exception)
        self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))
        return str(body["error"]["message"])

    @staticmethod
    def categories(volumes: dict) -> dict[str, dict]:
        return {row["category"]: row for row in volumes["counts"]["categories"]}

    # -- the direct count ------------------------------------------------------

    def rows(self) -> dict[str, sqlite3.Row]:
        return {
            str(row["work_item_id"]): row
            for row in self.conn.execute(
                "SELECT i.work_item_id, i.parent_id, i.kind, i.number, i.created_at,"
                " s.category, p.key AS space_key FROM work_items i"
                " JOIN workflow_states s ON s.state_id = i.state_id"
                " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
            )
        }

    def naming(self, projects: set[str]) -> set[str]:
        """The items naming one of these projects, with every goal and stage above them."""

        rows = self.rows()
        found = {
            str(row[0])
            for row in self.conn.execute("SELECT work_item_id, project_id FROM work_item_projects")
            if row[1] in projects
        }
        for identity in list(found):
            parent = rows[identity]["parent_id"]
            while parent is not None:
                found.add(str(parent))
                parent = rows[str(parent)]["parent_id"]
        return found

    def board_set(self, space: str | None, project: str | None = None) -> set[str]:
        """What a read of the space holds, chosen from the tables and the bindings above."""

        rows = self.rows()
        if space is None:
            return set(rows)
        own = {identity for identity, row in rows.items() if row["space_key"] == space}
        bound = {name for name, home in BOUND.items() if home == space}
        if project is None:
            return own | self.naming(bound)
        named = self.naming({project})
        return named if project in bound else own & named

    def since(self, identity: str) -> datetime:
        """When the item came to stand where it is: its last state entry, or its creation."""

        stamps = [
            str(row[1])
            for row in self.conn.execute(
                "SELECT id, created_at, action FROM work_item_events"
                " WHERE work_item_id = ? ORDER BY id",
                (identity,),
            )
            if row[2] in ENTRIES
        ]
        return _moment(stamps[-1] if stamps else str(self.rows()[identity]["created_at"]))

    @staticmethod
    def shape_of(row: sqlite3.Row) -> str:
        """Which field a stored item counts in: a task, a goal (no parent) or a stage (a parent)."""

        if row["kind"] != "container":
            return "tasks"
        return "stages" if row["parent_id"] is not None else "goals"

    @staticmethod
    def tally(category: dict) -> dict[str, int]:
        """The three counts one category of the read answer holds."""

        return {field: category[field] for field in SHAPES}

    def counted(self, items: set[str]) -> dict[str, dict[str, int]]:
        """Tasks, goals and stages in each category; a closed one only when it closed in the period."""

        rows = self.rows()
        found = {category: dict.fromkeys(SHAPES, 0) for category in CATEGORIES}
        for identity in items:
            row = rows[identity]
            if row["category"] not in found:
                continue  # an accepted open goal or stage, in no category
            if row["category"] in CLOSED and not BEGINS <= self.since(identity) < ENDS:
                continue
            found[row["category"]][self.shape_of(row)] += 1
        return found

    def oldest(self, items: set[str]) -> dict[str, str | None]:
        """The id of the card standing longest in each open category."""

        rows = self.rows()
        found: dict[str, str | None] = {}
        for category in CATEGORIES:
            standing = [identity for identity in items if rows[identity]["category"] == category]
            found[category] = (
                min(standing, key=self.since) if standing and category not in CLOSED else None
            )
        return found


class StoreCountTests(VolumesCase):
    """Work in every category in both spaces, closing on both sides of the period's ends."""

    def setUp(self) -> None:
        super().setUp()
        main = "MAIN"
        self.place(main, "G", kind="goal", state="container", entries=("2026-10-02T00:00:00Z",))
        self.place(main, "a", state="dev", parent="G", started=True, projects=("app",))
        self.place(main, "b", state="ready", parent="G", projects=("app",))
        self.place(main, "S", kind="stage", state="container", parent="G")
        self.place(main, "c", state="review", parent="S", started=True, projects=("app",))
        # Done inside the period; a later event that is no state entry changes nothing.
        self.place(main, "d", state="done", parent="G", started=True, projects=("app",))
        self.place_entries("MAIN:d", "2026-11-12T10:00:00Z")
        self.later("MAIN:d", "summarized", "2026-11-20T00:00:00Z")
        # Triage: the goal stands from its one entry, the task from its last of two.
        self.place(main, "H", kind="goal", entries=("2026-10-20T00:00:00Z",))
        self.place(
            main,
            "h1",
            parent="H",
            entries=("2026-10-01T00:00:00Z", "2026-11-12T00:00:00Z"),
        )
        self.place(main, "t0")
        self.place(main, "D", kind="goal", state="deferred")
        self.place(main, "d1", state="deferred", parent="D")
        # A goal done inside the period over a task done before it.
        self.place(main, "C", kind="goal", state="done", entries=("2026-11-10T08:00:00Z",))
        self.place(main, "c1", state="done", parent="C", started=True)
        self.place_entries("MAIN:c1", "2026-11-02T10:00:00Z")
        self.place(main, "x", state="blocked", started=True)
        # Done in the period and again after it, and done before it and again in it.
        self.place(main, "w", state="done", started=True)
        self.place_entries("MAIN:w", "2026-11-11T10:00:00Z", "2026-11-17T10:00:00Z")
        self.place(main, "v", state="done", started=True)
        self.place_entries("MAIN:v", "2026-11-03T10:00:00Z", "2026-11-15T10:00:00Z")
        # The period's two ends: its start is in it, and its end is not.
        self.place(main, "f", state="done", started=True, entries=("2026-11-09T21:00:00Z",))
        self.place(main, "e", state="done", started=True, entries=("2026-11-16T21:00:00Z",))
        self.place(main, "n", state="done", started=True)
        self.place(main, "y", state="cancelled", entries=("2026-11-13T00:00:00Z",))
        self.place(main, "z", state="cancelled", entries=("2026-11-20T00:00:00Z",))
        # Cancelled with no entry at all: it stands from its creation, inside the period.
        self.place(main, "m", state="cancelled", created="2026-11-14T00:00:00Z")
        self.place(main, "s1", state="dev", started=True, projects=("lib",))
        alpha = "ALPHA"
        self.place(alpha, "K", kind="goal", state="container")
        self.place(
            alpha,
            "k1",
            state="ready",
            parent="K",
            projects=("app",),
            entries=("2026-10-05T00:00:00Z",),
        )
        self.place(alpha, "k2", parent="K", projects=("lib",))
        self.place(alpha, "u", state="review", started=True, projects=("app",))
        self.place(alpha, "q", state="done", started=True, projects=("lib",))
        self.place_entries("ALPHA:q", "2026-11-12T00:00:00Z")
        self.place(alpha, "r", state="cancelled", projects=("app",))
        self.place_entries("ALPHA:r", "2026-11-12T00:00:00Z")
        self.place(alpha, "j", state="deferred", projects=("lib",))
        # Outside goals: a task naming both projects, and labels on some of the work; w
        # carries one too, but it was done after the period and stands in no row.
        self.place(main, "p", state="ready", projects=("app", "lib"))
        for name, labels in (
            ("MAIN:t0", ("ui", "api")),
            ("MAIN:x", ("ui",)),
            ("MAIN:v", ("api",)),
            ("MAIN:w", ("ui",)),
            ("ALPHA:u", ("ui",)),
            ("MAIN:a", ("ui",)),
        ):
            self.conn.execute(
                "UPDATE work_items SET labels = ? WHERE work_item_id = ?",
                (json.dumps(labels), *self.ids(name)),
            )
        self.conn.commit()

    def place_entries(self, name: str, *stamps: str) -> None:
        for stamp in stamps:
            self.later(name, "transitioned", stamp)

    def later(self, name: str, action: str, stamp: str) -> None:
        (identity,) = self.ids(name)
        self.conn.execute(
            "INSERT INTO work_item_events(work_item_id, action, detail, author, created_at)"
            " VALUES (?, ?, 'later', 'case', ?)",
            (identity, action, stamp),
        )

    READS = (
        ("MAIN", None),
        ("MAIN", "app"),
        ("MAIN", "lib"),
        ("ALPHA", None),
        ("ALPHA", "lib"),
        ("ALPHA", "app"),
        (None, None),
    )

    def test_counts_are_the_store_counted_directly(self) -> None:
        for space, project in self.READS:
            with self.subTest(space=space, project=project):
                found = self.categories(self.volumes(space, project))
                self.assertEqual(list(CATEGORIES), list(found))
                self.assertEqual(
                    self.counted(self.board_set(space, project)),
                    {name: self.tally(row) for name, row in found.items()},
                )
        # The case is what it says. In MAIN's read the work closed in the period is d, v, f
        # and the goal C, and y, m and ALPHA's r; c1, w, e, n and z closed outside it, and
        # G, S and ALPHA's K stand accepted and open, in no category.
        main = self.categories(self.volumes("MAIN"))
        self.assertEqual({"tasks": 3, "goals": 1, "stages": 0}, self.tally(main["completed"]))
        self.assertEqual({"tasks": 3, "goals": 0, "stages": 0}, self.tally(main["cancelled"]))
        self.assertEqual({"tasks": 2, "goals": 1, "stages": 0}, self.tally(main["triage"]))
        self.assertEqual(
            len(self.board_set("MAIN")) - 3 - 5,
            sum(row["tasks"] + row["goals"] + row["stages"] for row in main.values()),
        )

    def test_the_oldest_card_is_the_longest_in_its_state(self) -> None:
        rows = self.rows()
        for space, project in self.READS:
            with self.subTest(space=space, project=project):
                found = self.categories(self.volumes(space, project))
                expected = self.oldest(self.board_set(space, project))
                for category in CATEGORIES:
                    oldest = found[category]["oldest"]
                    identity = expected[category]
                    if identity is None:
                        self.assertIsNone(oldest, category)
                        continue
                    row = rows[identity]
                    self.assertEqual(
                        {
                            "work_item_id": identity,
                            "reference": f"{row['space_key']}-{row['number']}",
                            "since": self.since(identity).isoformat().replace("+00:00", "Z"),
                        },
                        oldest,
                        category,
                    )
        # Triage's longest is the goal by its one entry, not h1 by the first of its two;
        # ready's is another space's task naming MAIN's project.
        main = self.categories(self.volumes("MAIN"))
        self.assertEqual(self.ids("MAIN:H"), {main["triage"]["oldest"]["work_item_id"]})
        self.assertEqual(self.ids("ALPHA:k1"), {main["ready"]["oldest"]["work_item_id"]})

    def outside(self, items: set[str]) -> list[str]:
        """The tasks under no goal that count: a closed one only when it closed in the period."""

        rows = self.rows()
        return [
            identity
            for identity, counts in ((i, self.counted({i})) for i in items)
            if rows[identity]["kind"] != "container"
            and rows[identity]["parent_id"] is None
            and any(counts[category]["tasks"] for category in CATEGORIES)
        ]

    def test_outside_goals_the_rows_add_up_to_the_tasks_under_no_goal(self) -> None:
        rows = self.rows()
        projects: dict[str, set[str]] = {}
        for identity, project in self.conn.execute(
            "SELECT work_item_id, project_id FROM work_item_projects"
        ):
            projects.setdefault(str(identity), set()).add(str(project))
        labels = {
            identity: json.loads(str(text))
            for identity, text in self.conn.execute("SELECT work_item_id, labels FROM work_items")
        }

        def by_category(found: list[str]) -> dict[str, int]:
            return {
                category: sum(rows[i]["category"] == category for i in found)
                for category in CATEGORIES
            }

        for space, project in self.READS:
            with self.subTest(space=space, project=project):
                outside = self.volumes(space, project)["outside"]
                tasks = self.outside(self.board_set(space, project))
                self.assertEqual(len(tasks), outside["tasks"])
                self.assertEqual(
                    len(tasks),
                    sum(sum(row["categories"].values()) for row in outside["by_project"]),
                )
                expected: dict[object, list[str]] = {}
                for identity in tasks:
                    held = projects.get(identity, set())
                    key = "several" if len(held) > 1 else next(iter(held), None)
                    expected.setdefault(key, []).append(identity)
                self.assertEqual(
                    {key: by_category(found) for key, found in expected.items()},
                    {
                        (
                            "several"
                            if row["project"]["combinations"] is not None
                            else row["project"]["id"]
                        ): row["categories"]
                        for row in outside["by_project"]
                    },
                )
                named: dict[str | None, list[str]] = {}
                for identity in tasks:
                    for label in labels[identity] or [None]:
                        named.setdefault(label, []).append(identity)
                self.assertEqual(
                    {label: by_category(found) for label, found in named.items()},
                    {row["label"]: row["categories"] for row in outside["by_label"]},
                )
        # The case is what it says. MAIN reads its t0, x, v, f, y, m, s1 and p and ALPHA's
        # u and r, which name its project; w, e, n and z closed outside the period, and a
        # sits under a goal. The most tasks first, and between rows of one task a project
        # before several.
        outside = self.volumes("MAIN")["outside"]
        self.assertEqual(10, outside["tasks"])
        self.assertEqual(
            [(None, 6), ("app", 2), ("lib", 1), (None, 1)],
            [
                (row["project"]["id"], sum(row["categories"].values()))
                for row in outside["by_project"]
            ],
        )
        several = outside["by_project"][3]["project"]
        self.assertEqual(
            {
                "id": None,
                "unknown": False,
                "name": None,
                "combinations": [[{"id": "app", "name": "app"}, {"id": "lib", "name": "lib"}]],
            },
            several,
        )
        self.assertEqual(
            {"id": "app", "unknown": False, "name": "app", "combinations": None},
            outside["by_project"][1]["project"],
        )
        self.assertEqual(
            [(None, 6), ("ui", 3), ("api", 2)],
            [(row["label"], sum(row["categories"].values())) for row in outside["by_label"]],
        )
        self.assertEqual(list(CATEGORIES), list(outside["by_label"][0]["categories"]))


class BoardSetTests(VolumesCase):
    """A space counts the items its board reads, and a project narrows both alike."""

    def setUp(self) -> None:
        super().setUp()
        self.place("ALPHA", "H", kind="goal")
        self.place("ALPHA", "t1", parent="H", projects=("app",))
        self.place("ALPHA", "t2", parent="H", projects=("lib",))
        self.place("ALPHA", "u", state="ready", projects=("app",))
        self.place("MAIN", "s1", state="dev", started=True, projects=("lib",))
        self.conn.commit()

    def test_a_space_counts_what_its_board_reads(self) -> None:
        cases = {
            None: ("ALPHA:H", "ALPHA:t1", "ALPHA:u", "MAIN:s1"),
            "app": ("ALPHA:H", "ALPHA:t1", "ALPHA:u"),
            "lib": ("MAIN:s1",),
        }
        rows = self.rows()
        for project, names in cases.items():
            with self.subTest(project=project):
                board = service.list_work_items(
                    self.conn, space="MAIN", project=project, other_spaces=True, limit=None
                )
                self.assertEqual(self.ids(*names), {str(item["work_item_id"]) for item in board})
                expected = {category: dict.fromkeys(SHAPES, 0) for category in CATEGORIES}
                for identity in self.ids(*names):
                    row = rows[identity]
                    expected[row["category"]][self.shape_of(row)] += 1
                found = self.categories(self.volumes("MAIN", project))
                self.assertEqual(expected, {name: self.tally(row) for name, row in found.items()})


class GoalAndStageTests(VolumesCase):
    """A category that holds a goal and two stages: each counts in its own field, not the other's."""

    def setUp(self) -> None:
        super().setUp()
        self.place("MAIN", "G", kind="goal", state="deferred")
        self.place("MAIN", "S1", kind="stage", state="deferred", parent="G")
        self.place("MAIN", "S2", kind="stage", state="deferred", parent="G")
        self.place("MAIN", "t", state="deferred", parent="S1")
        self.conn.commit()

    def test_a_goal_and_a_stage_are_counted_in_their_own_fields(self) -> None:
        found = self.categories(self.volumes("MAIN"))
        self.assertEqual({"tasks": 1, "goals": 1, "stages": 2}, self.tally(found["deferred"]))
        self.assertEqual(
            self.counted(self.board_set("MAIN"))["deferred"], self.tally(found["deferred"])
        )


class WaitingTests(VolumesCase):
    """Questions on MAIN's work and ALPHA's: to the owner, to a session, answered, run out."""

    def setUp(self) -> None:
        super().setUp()
        self.place("MAIN", "a")
        self.place("MAIN", "b", state="ready")
        self.place("ALPHA", "k", projects=("app",))
        self.place("ALPHA", "o")
        self.conn.execute("INSERT INTO sessions(id, client) VALUES ('sess-x', 'codex')")
        self.asked = {
            "first": self.question("MAIN:a", "2026-11-05T09:00:00.000Z"),
            "second": self.question("MAIN:a", "2026-11-06T09:00:00.000Z"),
            "elsewhere": self.question("ALPHA:k", "2026-11-04T09:00:00.000Z"),
            "unbound": self.question("ALPHA:o", "2026-11-01T09:00:00.000Z"),
        }
        # Never waiting for the owner: asked of a session, answered, run out past its deadline.
        self.question("MAIN:b", "2026-11-02T09:00:00.000Z", addressee="sess-x")
        self.question("MAIN:b", "2026-11-02T10:00:00.000Z", status="answered")
        self.question("MAIN:b", "2026-11-02T11:00:00.000Z", expires_at="2026-11-03T00:00:00Z")
        self.conn.commit()

    def waiting_directly(self, items: set[str]) -> list[str]:
        """The questions to the owner still waiting on these items, counted from the rows."""

        return [
            str(row[0])
            for row in self.conn.execute(
                "SELECT request_id, work_item_id FROM work_item_requests"
                " WHERE status = 'pending' AND comment_id IS NULL AND addressee IS NULL"
                " AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at",
                (datetime.now(UTC).isoformat(),),
            )
            if str(row[1]) in items
        ]

    def test_waiting_counts_the_owner_questions(self) -> None:
        rows = self.rows()
        for space, project in (("MAIN", None), ("MAIN", "app"), ("ALPHA", None), (None, None)):
            with self.subTest(space=space, project=project):
                waiting = self.volumes(space, project)["counts"]["waiting_owner"]
                expected = self.waiting_directly(self.board_set(space, project))
                self.assertEqual(len(expected), waiting["count"])
                first = self.conn.execute(
                    "SELECT work_item_id, created_at FROM work_item_requests WHERE request_id = ?",
                    (expected[0],),
                ).fetchone()
                row = rows[str(first[0])]
                self.assertEqual(
                    {
                        "request_id": expected[0],
                        "reference": f"{row['space_key']}-{row['number']}",
                        "since": str(first[1]),
                    },
                    waiting["oldest"],
                )
        # The case is what it says: MAIN waits on its two and on ALPHA's k, which names its
        # project, oldest first; ALPHA's o names none of MAIN's.
        main = self.volumes("MAIN")["counts"]["waiting_owner"]
        self.assertEqual(
            (3, self.asked["elsewhere"]), (main["count"], main["oldest"]["request_id"])
        )
        self.assertEqual(4, self.volumes()["counts"]["waiting_owner"]["count"])
        self.assertEqual(
            {"count": 0, "oldest": None},
            self.volumes("MAIN", "lib")["counts"]["waiting_owner"],
        )


class UnattachedCommitTests(VolumesCase):
    """Commits of `app` (MAIN's project) and `lib` (ALPHA's): attached, on no card, rewritten."""

    def setUp(self) -> None:
        super().setUp()
        self.place("MAIN", "a")
        attached = self.commit("app", "a")
        self.conn.execute(
            "INSERT INTO work_item_commits(work_item_id, commit_id, attached_by)"
            " VALUES (?, ?, 'manual')",
            (*self.ids("MAIN:a"), attached),
        )
        self.commit("app", "b")
        kept = self.commit("app", "c")
        self.commit("lib", "d")
        # Never on no card: one a rewrite replaced, and one no session reported.
        self.commit("app", "e", rewritten_to=kept)
        self.commit("lib", "f", session=None)
        self.conn.commit()

    def commit(
        self,
        project: str,
        digit: str,
        *,
        session: str | None = "sess-a",
        rewritten_to: int | None = None,
    ) -> int:
        found = self.conn.execute(
            "INSERT INTO commits(project_id, hash, committed_at, session_id, reported_at,"
            " rewritten_to) VALUES (?, ?, '2026-11-12T10:00:00Z', ?, '2026-11-12T10:00:01Z', ?)",
            (project, digit * 40, session, rewritten_to),
        ).lastrowid
        assert found is not None
        return found

    def listed(self, **query: str) -> int:
        answer = api.handle_get(
            self.conn,
            "/api/planning/commits/unattached",
            {key: [value] for key, value in query.items()},
        )
        assert answer is not None
        self.assertEqual(200, answer[0])
        return int(answer[1]["total"])

    def test_unattached_commits_match_their_list(self) -> None:
        pairs = (
            (self.volumes("MAIN"), self.listed(space="MAIN"), 2),
            (self.volumes("MAIN", "app"), self.listed(project="app"), 2),
            (self.volumes(), self.listed(), 3),
        )
        for volumes, total, expected in pairs:
            with self.subTest(scope=volumes["scope"]):
                self.assertEqual(
                    (expected, expected), (volumes["counts"]["unattached_commits"], total)
                )
        directly = self.conn.execute(
            "SELECT COUNT(*) FROM commits c WHERE c.session_id IS NOT NULL"
            " AND c.rewritten_to IS NULL"
            " AND c.commit_id NOT IN (SELECT commit_id FROM work_item_commits)"
        ).fetchone()[0]
        self.assertEqual(directly, self.volumes()["counts"]["unattached_commits"])

    def test_a_scope_whose_list_cannot_be_read_has_no_number_and_still_answers(self) -> None:
        # A project only an item names: the registry lists no `zed`, so its list refuses it.
        self.place("MAIN", "z", projects=("zed",))
        self.conn.commit()
        with self.assertRaises(commits.UnknownProjectsError):
            self.listed(project="zed")
        read = self.volumes("MAIN", "zed")
        self.assertIsNone(read["counts"]["unattached_commits"])
        self.assertEqual(1, self.categories(read)["triage"]["tasks"])
        self.assertEqual(1, read["outside"]["tasks"])
        self.assertEqual(7, len(read["flow"]["days"]))

        # A space while the registry cannot be read: its list refuses, and the whole store's
        # still reads, needing the registry only for names.
        (self.root / "local" / "Valkama" / "projects.json").write_bytes(b"{")
        with self.assertRaises(commits.UnknownProjectsError):
            self.listed(space="MAIN")
        read = self.volumes("MAIN")
        self.assertIsNone(read["counts"]["unattached_commits"])
        self.assertEqual(2, self.categories(read)["triage"]["tasks"])
        self.assertEqual(2, read["outside"]["tasks"])
        # The commit attached to a still flows; no project binds to MAIN, so none on no card.
        self.assertEqual(1, read["flow"]["totals"]["commits"])
        self.assertEqual(3, self.volumes()["counts"]["unattached_commits"])

        # Any other refusal of the list is the read's refusal still.
        other = model.PlanningError("the list refused something else")
        with mock.patch.object(commits, "unattached", side_effect=other):
            with self.assertRaises(model.PlanningError) as caught:
                self.volumes()
        self.assertIs(other, caught.exception)


class FilterTests(VolumesCase):
    """MAIN's work under no goal, of each kind and with labels, beside a goal labelled too."""

    def setUp(self) -> None:
        super().setUp()
        for name, kind, labels in (
            ("t", "task", ("ui", "api")),
            ("b", "bug", ("ui",)),
            ("c", "bug", ()),
            ("i", "improvement", ("ui",)),
        ):
            self.place("MAIN", name, kind=kind)
            self.label(f"MAIN:{name}", *labels)
        # A goal never matches a filter, whatever labels it carries.
        self.place("MAIN", "G", kind="goal")
        self.label("MAIN:G", "ui")
        self.asked = self.question("MAIN:b", "2026-11-05T09:00:00.000Z")
        self.question("MAIN:G", "2026-11-04T09:00:00.000Z")
        self.conn.execute(
            "INSERT INTO commits(project_id, hash, committed_at, session_id, reported_at)"
            " VALUES ('app', ?, '2026-11-12T10:00:00Z', 'sess-a', '2026-11-12T10:00:01Z')",
            ("a" * 40,),
        )
        # A label the store holds only on another space's item, which MAIN does not read.
        self.place("ALPHA", "o")
        self.label("ALPHA:o", "docs")
        self.conn.commit()

    def label(self, name: str, *labels: str) -> None:
        self.conn.execute(
            "UPDATE work_items SET labels = ? WHERE work_item_id = ?",
            (json.dumps(labels), *self.ids(name)),
        )

    def test_a_filter_counts_the_tasks_it_keeps(self) -> None:
        unfiltered = self.volumes("MAIN")
        self.assertIsNone(unfiltered["filter"])
        read = self.volumes("MAIN", kind=["bug", "task"], label="ui")
        self.assertEqual({"kinds": ["bug", "task"], "labels": ["ui"]}, read["filter"])
        found = self.categories(read)
        # The bug and the task with `ui`: not the bug without it, the improvement or the goal.
        kept = self.ids("MAIN:t", "MAIN:b")
        self.assertEqual(
            {name: counts["tasks"] for name, counts in self.counted(kept).items()},
            {name: row["tasks"] for name, row in found.items()},
        )
        self.assertEqual(2, found["triage"]["tasks"])
        for row in found.values():
            self.assertEqual((None, None), (row["goals"], row["stages"]), row["category"])
        self.assertEqual(self.ids("MAIN:t"), {found["triage"]["oldest"]["work_item_id"]})
        # The goal's question is not on a task the filter keeps.
        waiting = read["counts"]["waiting_owner"]
        self.assertEqual((1, self.asked), (waiting["count"], waiting["oldest"]["request_id"]))
        self.assertEqual(2, unfiltered["counts"]["waiting_owner"]["count"])
        # A commit on no card has no task to match: the number is the one without a filter.
        self.assertEqual(1, read["counts"]["unattached_commits"])
        self.assertEqual(
            unfiltered["counts"]["unattached_commits"], read["counts"]["unattached_commits"]
        )
        # Outside goals the same two, and the rows by label are the filter's labels alone.
        outside = read["outside"]
        self.assertEqual(2, outside["tasks"])
        self.assertEqual(
            [("ui", 2)],
            [(row["label"], sum(row["categories"].values())) for row in outside["by_label"]],
        )
        self.assertEqual(2, sum(sum(row["categories"].values()) for row in outside["by_project"]))

        # Kinds alone keep every label's row, and the row of none.
        bugs = self.volumes("MAIN", kind="bug")
        self.assertEqual({"kinds": ["bug"], "labels": []}, bugs["filter"])
        self.assertEqual(2, self.categories(bugs)["triage"]["tasks"])
        self.assertEqual(
            [("ui", 1), (None, 1)],
            [
                (row["label"], sum(row["categories"].values()))
                for row in bugs["outside"]["by_label"]
            ],
        )

        # A label the store holds outside the scope reads as nothing, and is no refusal.
        empty = self.volumes("MAIN", label="docs")
        self.assertEqual({"kinds": [], "labels": ["docs"]}, empty["filter"])
        self.assertEqual(0, sum(row["tasks"] for row in empty["counts"]["categories"]))
        self.assertEqual({"count": 0, "oldest": None}, empty["counts"]["waiting_owner"])
        self.assertEqual(
            (0, [], []),
            tuple(empty["outside"][part] for part in ("tasks", "by_project", "by_label")),
        )

    def test_a_filter_refuses_what_is_no_kind_of_task_and_no_label_of_the_store(self) -> None:
        main: dict[str, str | list[str]] = {
            "scope_kind": "space",
            "data_scope_id": self.scope_id,
            "space_key": "MAIN",
            **PERIOD,
        }
        for kind in ("goal", "stage", "epic", "container"):
            with self.subTest(kind=kind):
                self.assertEqual(
                    "kind filters tasks: task, bug or improvement",
                    self.refused({**main, "kind": ["bug", kind]}),
                )
        self.assertEqual(
            "no work item carries label nowhere", self.refused({**main, "label": ["ui", "nowhere"]})
        )


class FrameTests(VolumesCase):
    def test_the_answer_names_its_scope_period_and_first_measured_moment(self) -> None:
        self.assertIsNone(self.volumes("MAIN")["measured_from"])
        identity = self.place("MAIN", "a", state="dev", started=True)
        self.conn.execute("INSERT INTO usage_runs(session_id, client, path) VALUES ('s', 'c', 'p')")
        for started, item in (
            ("2026-10-17T16:03:29.000Z", identity),
            ("2026-10-01T00:00:00Z", None),
        ):
            self.conn.execute(
                "INSERT INTO usage_segments(run_id, session_id, started_at, ended_at, seconds,"
                " work_item_id, quality) VALUES (1, 's', ?, ?, 1, ?, 'observed')",
                (started, started, item),
            )
        answer = self.volumes("MAIN", "app")
        self.assertEqual(
            {
                "kind": "space",
                "space_ref": {"data_scope_id": self.scope_id, "space_key": "MAIN"},
                "project_ref": {"project_id": "app"},
            },
            answer["scope"],
        )
        self.assertEqual(
            {
                "from": "2026-11-10T00:00:00+03:00",
                "to": "2026-11-17T00:00:00+03:00",
                "utc_offset": 180,
            },
            answer["period"],
        )
        # Only work counted to an item says when the counting began.
        self.assertEqual("2026-10-17T16:03:29.000Z", answer["measured_from"])
        self.assertEqual(
            {"kind": "global", "space_ref": None, "project_ref": None}, self.volumes()["scope"]
        )


class RefusalTests(VolumesCase):
    def space(self, **more: str) -> dict[str, str | list[str]]:
        return {
            "scope_kind": "space",
            "data_scope_id": self.scope_id,
            "space_key": "MAIN",
            **PERIOD,
            **more,
        }

    def test_each_refusal_says_what_cannot_be_read(self) -> None:
        cases = {
            "scope_kind must be global or space": {"scope_kind": "board", **PERIOD},
            "a space scope names data_scope_id and space_key": {
                "scope_kind": "space",
                "data_scope_id": self.scope_id,
                **PERIOD,
            },
            "no planning space NOPE": self.space(space_key="NOPE"),
            "no project nowhere": self.space(project_id="nowhere"),
            "from must be a date or a time with its offset": self.space(**{"from": "yesterday"}),
            "to must be later than from": self.space(to="2026-11-10"),
            "the period holds more than 2400 steps of one day": self.space(
                **{"from": "1990-01-01", "to": "2026-01-01"}
            ),
        }
        for message, parameters in cases.items():
            with self.subTest(message):
                self.assertEqual(message, self.refused(parameters))
        self.assertEqual("scope_kind must be global or space", self.refused(dict(PERIOD)))

    def test_a_space_of_an_attached_store_is_refused_by_name(self) -> None:
        attached = self.root / "side.sqlite3"
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(attached)}):
            other = store.connect()
            try:
                service.create_planning_space(other, name="Side", key="SIDE")
                other.commit()
                side = str(read_store_metadata(other)["data_scope_id"])
            finally:
                other.close()
        # A store nobody attached is no store this read knows.
        self.assertEqual(
            "no planning space SIDE", self.refused(self.space(data_scope_id=side, space_key="SIDE"))
        )
        scopes.attach(str(self.primary), "side", str(attached))
        self.assertEqual(
            "volumes read the store this service writes; SIDE lives in an attached store",
            self.refused(self.space(data_scope_id=side, space_key="SIDE")),
        )


class EntryMomentTests(VolumesCase):
    def test_the_entry_moment_is_the_last_entry_by_id_in_both_reads(self) -> None:
        # The history's last entry is the one written last: the highest id. Its stamp is
        # earlier than the stamp of the entry before it, so a reading by the latest stamp
        # and one by history order part here. The stack and the Volumes read must both
        # give the last entry's stamp.
        drift = self.place(
            "MAIN", "drift", entries=("2026-11-12T09:00:00Z", "2026-11-05T09:00:00Z")
        )
        expected = "2026-11-05T09:00:00Z"

        with self.subTest("the stack"):
            self.assertEqual(expected, triage.entered(self.conn, drift))
            (waiting,) = triage.waiting(self.conn, self.trees["MAIN"].space_id)
            self.assertEqual((drift, expected), (waiting.work_item_id, waiting.entered_at))
        with self.subTest("the volumes read"):
            oldest = self.categories(self.volumes("MAIN"))["triage"]["oldest"]
            self.assertEqual((drift, expected), (oldest["work_item_id"], oldest["since"]))
