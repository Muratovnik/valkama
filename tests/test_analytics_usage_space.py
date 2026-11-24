"""The Analytics read of usage narrowed to one space: the work its board holds.

The registry binds `alpha` to MAIN and `beta` to BETA. MAIN's items name alpha, beta and
nothing; BETA's name alpha, beta and both. A space holds its own items and the items of
the other space that name its project, as its board does; a project narrows it as the
board narrows, so a project of another space brings the space's own items alone. Work on
no item is the space's when its session stands in one of the space's projects.

Each stretch spends a power of two seconds, so a total names exactly the stretches in it.
"""

from __future__ import annotations

from unittest import mock

from server.analytics import usage
from server.planning import service as planning
from server.projects import project_registry
from tests.analytics_fixtures import DAY, START, UsageStore, day
from tests.registry_fixtures import registry_bytes, space_entry

#: The seconds of each stretch, by what it was spent on.
SPENT = {
    "main-alpha": 1,
    "main-beta": 2,
    "main-bare": 4,
    "beta-alpha": 8,
    "beta-beta": 16,
    "beta-both": 32,
    "place-alpha": 64,
    "place-beta": 128,
    "place-nowhere": 256,
    "gone-item": 512,
}


def seconds(*names: str) -> float:
    return float(sum(SPENT[name] for name in names))


class SpaceCase(UsageStore):
    def setUp(self) -> None:
        super().setUp()
        registry = registry_bytes(
            [
                space_entry(self.conn, "alpha", self.alpha_root, "MAIN", board="Alpha project"),
                space_entry(self.conn, "beta", self.beta_root, "BETA", board="Beta project"),
            ]
        )
        patch = mock.patch.object(project_registry, "_read_registry_bytes", lambda: registry)
        patch.start()
        self.addCleanup(patch.stop)
        planning.create_planning_space(self.conn, name="Beta", key="BETA")
        self.conn.commit()
        self.items = {
            "main-alpha": self.task("MAIN", ["alpha"]),
            "main-beta": self.task("MAIN", ["beta"]),
            "main-bare": self.task("MAIN", None),
            "beta-alpha": self.task("BETA", ["alpha"]),
            "beta-beta": self.task("BETA", ["beta"]),
            "beta-both": self.task("BETA", ["alpha", "beta"]),
            "gone-item": "00000000-0000-4000-8000-00000000dead",
        }
        self.session("s-items")
        self.session("s-in-alpha", self.alpha_root / "src")
        self.session("s-in-beta", self.beta_root)
        self.session("s-nowhere", self.root / "elsewhere")
        at = 0
        for name, spent in SPENT.items():
            session = {
                "place-alpha": "s-in-alpha",
                "place-beta": "s-in-beta",
                "place-nowhere": "s-nowhere",
            }.get(name, "s-items")
            self.segment(session, at, at + spent, item=self.items.get(name))
            at += spent

    def task(self, space: str, projects: list[str] | None) -> str:
        """An item of `space` naming `projects`, given by an edit: filed with them it would
        lie in their home space, and an edit does not move it."""

        created = planning.create_work_item(self.conn, space=space, title=f"Work of {space}")
        identity = str(created["work_item_id"])
        if projects is not None:
            planning.update_work_item(self.conn, identity, projects=projects)
        self.conn.commit()
        return identity

    def total(self, **parameters: str) -> float:
        read = self.read(**{"from": day(0), "to": day(1), **parameters})
        return float(read["total"]["agent_seconds"])

    def board(self, space: str, project: str | None = None) -> set[str]:
        """The items the space's board holds, narrowed by `project` as the board narrows."""

        return {
            str(row["work_item_id"])
            for row in planning.list_work_items(
                self.conn, space=space, project=project, other_spaces=True, limit=None
            )
        }

    def items_read(self, **parameters: str) -> set[str]:
        read = self.read(**{"from": day(0), "to": day(1), "group_by": "work_item", **parameters})
        return {
            row["group"]["work_item"]["id"]
            for row in read["rows"]
            if row["group"]["work_item"]["id"] is not None
        }


class SpaceTotalTests(SpaceCase):
    def test_a_space_holds_its_items_the_foreign_items_naming_its_project_and_its_places(
        self,
    ) -> None:
        self.assertEqual(
            seconds(
                "main-alpha", "main-beta", "main-bare", "beta-alpha", "beta-both", "place-alpha"
            ),
            self.total(space="MAIN"),
        )
        self.assertEqual(
            seconds("beta-alpha", "beta-beta", "beta-both", "main-beta", "place-beta"),
            self.total(space="BETA"),
        )
        # Without a space the read holds every stretch, a gone item's and a place no
        # project holds among them.
        self.assertEqual(float(sum(SPENT.values())), self.total())

    def test_a_spaces_items_are_the_ones_its_board_holds(self) -> None:
        for space in ("MAIN", "BETA"):
            with self.subTest(space):
                self.assertEqual(self.board(space), self.items_read(space=space))

    def test_the_space_is_named_as_the_other_reads_name_it(self) -> None:
        main = str(planning.get_planning_space(self.conn, "MAIN")["planning_space_id"])
        for named in (main, "Alpha"):
            with self.subTest(named):
                self.assertEqual(self.total(space="MAIN"), self.total(space=named))

    def test_a_spaces_rows_add_up_to_its_total(self) -> None:
        read = self.read(**{"from": day(0), "to": day(1), "space": "MAIN", "group_by": "project"})
        self.assertEqual(
            read["total"]["agent_seconds"], sum(row["agent_seconds"] for row in read["rows"])
        )
        # The item naming both is the group of several; the one naming none its own.
        self.assertEqual(
            [
                ("alpha", False, seconds("main-alpha", "beta-alpha", "place-alpha")),
                (None, True, seconds("beta-both")),
                (None, False, seconds("main-bare")),
                ("beta", False, seconds("main-beta")),
            ],
            [
                (
                    row["group"]["project"]["id"],
                    row["group"]["project"]["combinations"] is not None,
                    row["agent_seconds"],
                )
                for row in read["rows"]
            ],
        )


class SpaceAndProjectTests(SpaceCase):
    def test_a_project_of_the_space_brings_the_other_spaces_items_naming_it(self) -> None:
        self.assertEqual(
            seconds("main-alpha", "beta-alpha", "beta-both", "place-alpha"),
            self.total(space="MAIN", project="alpha"),
        )
        self.assertEqual(
            self.board("MAIN", "alpha"), self.items_read(space="MAIN", project="alpha")
        )

    def test_a_project_of_another_space_brings_the_spaces_own_items_alone(self) -> None:
        # BETA's item naming both names MAIN's alpha too, and stays out: as on the board.
        self.assertEqual(seconds("main-beta"), self.total(space="MAIN", project="beta"))
        self.assertEqual(self.board("MAIN", "beta"), self.items_read(space="MAIN", project="beta"))

    def test_several_projects_hold_what_each_brings(self) -> None:
        self.assertEqual(
            seconds("main-alpha", "main-beta", "beta-alpha", "beta-both", "place-alpha"),
            self.total(space="MAIN", project="alpha,beta"),
        )

    def test_none_keeps_the_spaces_items_that_name_no_project(self) -> None:
        self.assertEqual(seconds("main-bare"), self.total(space="MAIN", none="project"))
        self.assertEqual(
            seconds("main-alpha", "beta-alpha", "beta-both", "place-alpha", "main-bare"),
            self.total(space="MAIN", project="alpha", none="project"),
        )

    def test_a_project_alone_reads_every_space(self) -> None:
        self.assertEqual(
            seconds("main-alpha", "beta-alpha", "beta-both", "place-alpha"),
            self.total(project="alpha"),
        )
        self.assertEqual(
            seconds("main-beta", "beta-beta", "beta-both", "place-beta"),
            self.total(project="beta"),
        )


class ScopedRunsTests(SpaceCase):
    """The runs a project or a space narrows the pauses read to (`usage.scoped_runs`): those
    with a stretch the usage read's project filter admits and its space holds."""

    def placed(self, project: str | None = None, space: str | None = None) -> set:
        start = START.timestamp()
        return usage.scoped_runs(
            self.conn, start=start, end=start + DAY, project=project, space=space
        )

    def test_a_run_on_an_item_is_the_projects_it_names_and_one_on_none_its_places(self) -> None:
        # MAIN's item naming beta, worked from a session standing in alpha's root: the projects
        # the item names place it, not its space's project nor the session's place.
        self.session("s-task", self.alpha_root)
        self.segment("s-task", 2000, 2001, item=self.items["main-beta"])
        alpha, beta = self.placed("alpha"), self.placed("beta")
        self.assertEqual((False, True), (("s-task", "") in alpha, ("s-task", "") in beta))
        self.assertEqual((True, False), (("s-in-alpha", "") in alpha, ("s-in-alpha", "") in beta))
        self.assertEqual(set(), self.placed("gamma"))

    def test_a_space_holds_the_runs_on_its_boards_items_and_in_its_places(self) -> None:
        # BETA's item naming beta alone, worked from a session standing in alpha's root: the
        # item is BETA's board's, so the run is BETA's and not MAIN's, whatever the place.
        self.session("s-beta-task", self.alpha_root)
        self.segment("s-beta-task", 2000, 2001, item=self.items["beta-beta"])
        self.assertEqual({("s-items", ""), ("s-in-alpha", "")}, self.placed(space="MAIN"))
        self.assertEqual(
            {("s-items", ""), ("s-in-beta", ""), ("s-beta-task", "")}, self.placed(space="BETA")
        )

    def test_a_project_narrows_the_space_as_the_space_read_narrows(self) -> None:
        # MAIN with beta, a project of another space, holds MAIN's own items naming it alone:
        # the run on BETA's item naming beta stays out, as does the place in beta's root.
        self.session("s-main-beta", self.beta_root)
        self.segment("s-main-beta", 2000, 2001, item=self.items["main-beta"])
        self.session("s-beta-beta", self.beta_root)
        self.segment("s-beta-beta", 2002, 2003, item=self.items["beta-beta"])
        self.assertEqual({("s-items", ""), ("s-main-beta", "")}, self.placed("beta", space="MAIN"))

    def test_a_space_the_store_does_not_hold_is_refused(self) -> None:
        with self.assertRaises(usage.UsageQueryError):
            self.placed(space="NOPE")


class SpaceRefusalTests(SpaceCase):
    def test_a_space_the_store_does_not_hold_is_refused_as_the_reads_refuse(self) -> None:
        for named in ("NOPE", "x" * 201):
            with self.subTest(named):
                status, body = self.answer(**{"from": day(0), "to": day(1), "space": named})
                self.assertEqual(400, status)
                self.assertEqual("invalid_request", body["error"]["code"])
                self.assertTrue(body["error"]["message"])

    def test_with_no_readable_registry_a_space_holds_its_own_items_alone(self) -> None:
        def unreadable() -> bytes:
            raise FileNotFoundError

        with mock.patch.object(project_registry, "_read_registry_bytes", unreadable):
            self.assertEqual(
                seconds("main-alpha", "main-beta", "main-bare"), self.total(space="MAIN")
            )
