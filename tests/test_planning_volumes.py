"""The volumes read: how much work stands in a scope, counted as the store holds it.

The registry binds `app` to MAIN and `lib` to ALPHA. Items are placed straight in SQL
(`planning_tree.Tree`) with the state entries each case needs, and every expected
number is counted here from the tables and the bindings this case wrote, by the rule
the read states: a space holds its items and the items of other spaces that name one
of its projects; a goal or stage names what a task under it names; a project narrows
a space to the items naming it, and brings other spaces' only when it is the space's.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

from server import store
from server.planning import api, service
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


def _moment(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


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

    def ids(self, *names: str) -> set[str]:
        found = set()
        for name in names:
            space, _, short = name.partition(":")
            found.add(self.trees[space].ids[short])
        return found

    # -- reading ---------------------------------------------------------------

    def volumes(self, space: str | None = None, project: str | None = None, **more: str) -> dict:
        parameters = {**PERIOD, **more}
        if space is None:
            parameters["scope_kind"] = "global"
        else:
            parameters |= {"scope_kind": "space", "data_scope_id": self.scope_id}
            parameters["space_key"] = space
        if project is not None:
            parameters["project_id"] = project
        answer = api.handle_get(
            self.conn, "/api/planning/volumes", {key: [value] for key, value in parameters.items()}
        )
        assert answer is not None
        self.assertEqual(200, answer[0])
        return answer[1]["volumes"]

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

    def counted(self, items: set[str]) -> dict[str, tuple[int, int]]:
        """Tasks and containers in each category; a closed one only when it closed in the period."""

        rows = self.rows()
        found = {category: [0, 0] for category in CATEGORIES}
        for identity in items:
            row = rows[identity]
            if row["category"] not in found:
                continue  # an accepted open goal or stage, in no category
            if row["category"] in CLOSED and not BEGINS <= self.since(identity) < ENDS:
                continue
            found[row["category"]][1 if row["kind"] == "container" else 0] += 1
        return {category: (tasks, containers) for category, (tasks, containers) in found.items()}

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
                    {name: (row["tasks"], row["containers"]) for name, row in found.items()},
                )
        # The case is what it says. In MAIN's read the work closed in the period is d, v, f
        # and the goal C, and y, m and ALPHA's r; c1, w, e, n and z closed outside it, and
        # G, S and ALPHA's K stand accepted and open, in no category.
        main = self.categories(self.volumes("MAIN"))
        self.assertEqual((3, 1), (main["completed"]["tasks"], main["completed"]["containers"]))
        self.assertEqual((3, 0), (main["cancelled"]["tasks"], main["cancelled"]["containers"]))
        self.assertEqual((2, 1), (main["triage"]["tasks"], main["triage"]["containers"]))
        self.assertEqual(
            len(self.board_set("MAIN")) - 3 - 5,
            sum(row["tasks"] + row["containers"] for row in main.values()),
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
                expected = {category: [0, 0] for category in CATEGORIES}
                for identity in self.ids(*names):
                    row = rows[identity]
                    expected[row["category"]][1 if row["kind"] == "container" else 0] += 1
                found = self.categories(self.volumes("MAIN", project))
                self.assertEqual(
                    {category: tuple(pair) for category, pair in expected.items()},
                    {name: (row["tasks"], row["containers"]) for name, row in found.items()},
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
    def refused(self, parameters: dict[str, str]) -> str:
        with self.assertRaises(Exception) as caught:
            api.handle_get(
                self.conn,
                "/api/planning/volumes",
                {key: [value] for key, value in parameters.items()},
            )
        status, body = api.error_response(caught.exception)
        self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))
        return str(body["error"]["message"])

    def space(self, **more: str) -> dict[str, str]:
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
