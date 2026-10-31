"""A chain of work, read through the HTTP boundary the web view and the MCP tool share.

The fixture is the shape that made a chain necessary: an epic whose children
are all planned work, items discovered from those children that landed under
another epic or under none, and one of them an epic of its own whose children
belong to the chain too. Around it sit the links that must not widen the
boundary -- relates-to, duplicates, blocks, a discovered-from pointing upstream,
and one from another space -- so a walk that follows any of them is caught.

Expected values come from the chain definition, worked by hand for this fixture,
not from the implementation.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import UTC, datetime
from unittest import mock

from server import store
from server.planning import api as planning_api
from server.planning import chain, service

CHAIN_PATH = "/api/planning/work-item/chain"


def at(day: str) -> datetime:
    return datetime.fromisoformat(f"{day}T12:00:00+00:00").astimezone(UTC)


class ChainFixture(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="chain", name="Quality", key="QA")
        service.create_planning_space(self.conn, project_id="other", name="Other", key="OTH")
        self.today("2026-10-31")
        self.ids: dict[str, str] = {}
        self.refs: dict[str, str] = {}

        def make(name: str, *, state: str | None = None, **fields: object) -> None:
            item = service.create_work_item(
                self.conn, space=str(fields.pop("space", "QA")), title=name, state=state, **fields
            )
            self.ids[name] = str(item["work_item_id"])
            self.refs[name] = str(item["reference"])

        def link(source: str, target: str, kind: str) -> None:
            service.link_work_items(self.conn, self.refs[source], self.refs[target], kind)

        make("R", kind="epic")
        make("C1", parent="QA-1")
        make("C2", parent="QA-1")
        make("C3", parent="QA-1")
        make("D0")
        make("D1", state="review")
        make("E", kind="epic")
        make("E1", parent=self.refs["E"])
        make("E2", state="todo", parent=self.refs["E"])
        make("O", kind="epic")
        make("F", state="done", parent=self.refs["O"])
        make("O2", parent=self.refs["O"])
        make("D2", state="cancelled")
        make("Up")
        make("Rel")
        make("Dup")
        make("Blk")
        make("Z", space="OTH")

        # What grew out of the epic.
        link("D0", "R", "discovered-from")
        link("D1", "C1", "discovered-from")
        link("E", "C2", "discovered-from")
        link("F", "D1", "discovered-from")
        link("D2", "E1", "discovered-from")
        # Links that describe the chain without extending it.
        link("C3", "E2", "blocks")
        link("C1", "D0", "blocks")
        link("C2", "D0", "relates-to")
        # Links that must not pull anything in.
        link("C2", "Up", "discovered-from")
        link("Rel", "C2", "relates-to")
        link("Dup", "C1", "duplicates")
        link("C3", "Blk", "blocks")
        link("Z", "C1", "discovered-from")

        # The claim starts C3: it moves it to Dev with its one transition.
        service.claim_work_item(self.conn, self.refs["C3"], author="one")
        for name in ("C1", "E1"):
            service.set_summary(self.conn, self.refs[name], {"done": "d", "next": "n"})
        service.transition_work_item(self.conn, self.refs["C1"], "dev", force=True)
        service.transition_work_item(self.conn, self.refs["C1"], "done", force=True)
        service.transition_work_item(self.conn, self.refs["E1"], "done", force=True)
        service.transition_work_item(self.conn, self.refs["F"], "done", force=True)

        # Controlled clocks: when each item was created, when each transition
        # happened, and the one terminal item that has no transition at all.
        for name, day in {
            "C1": "2026-10-10",
            "C2": "2026-10-10",
            "C3": "2026-10-10",
            "D0": "2026-10-20",
            "D1": "2026-10-20",
            "E": "2026-10-26",
            "E1": "2026-10-26",
            "E2": "2026-10-27",
            "F": "2026-10-28",
            "D2": "2026-10-30",
        }.items():
            self.conn.execute(
                "UPDATE work_items SET created_at = ?, updated_at = ? WHERE work_item_id = ?",
                (f"{day}T08:00:00Z", f"{day}T09:30:00Z", self.ids[name]),
            )
        for name, stamps in {
            "C3": ["2026-10-12T10:00:00Z"],
            "C1": ["2026-10-15T10:00:00Z", "2026-10-20T10:00:00Z"],
            "E1": ["2026-10-29T10:00:00Z"],
            "F": ["2026-10-31T07:00:00Z"],
        }.items():
            events = [
                row[0]
                for row in self.conn.execute(
                    "SELECT id FROM work_item_events WHERE work_item_id = ?"
                    " AND action = 'transitioned' ORDER BY id",
                    (self.ids[name],),
                )
            ]
            self.assertEqual(len(stamps), len(events), name)
            for event, stamp in zip(events, stamps, strict=True):
                self.conn.execute(
                    "UPDATE work_item_events SET created_at = ? WHERE id = ?", (stamp, event)
                )
        self.conn.commit()

    def today(self, day: str) -> None:
        patch = mock.patch.object(chain, "utc_now", return_value=at(day))
        patch.start()
        self.addCleanup(patch.stop)

    def read(self, **parameters: str) -> dict:
        answer = planning_api.handle_get(
            self.conn, CHAIN_PATH, {name: [value] for name, value in parameters.items()}
        )
        assert answer is not None
        self.assertEqual(200, answer[0])
        return answer[1]["chain"]

    def refusal(self, **parameters: str) -> tuple[int, str, str]:
        try:
            planning_api.handle_get(
                self.conn, CHAIN_PATH, {name: [value] for name, value in parameters.items()}
            )
        except Exception as error:  # noqa: BLE001 -- the mapping is what is under test
            status, body = planning_api.error_response(error)
            return status, body["error"]["code"], body["error"]["message"]
        raise AssertionError("the chain read did not refuse")

    def names(self, references: list[str | None]) -> list[str | None]:
        by_reference = {reference: name for name, reference in self.refs.items()}
        return [
            by_reference[reference] if reference is not None else None for reference in references
        ]


class ChainBoundaryTests(ChainFixture):
    MEMBERS = ("C1", "C2", "C3", "D0", "D1", "E", "E1", "E2", "F", "D2")

    def test_the_chain_follows_discovery_and_children_downward_only(self) -> None:
        found = self.read(id=self.refs["R"])
        self.assertEqual("chain", found["scope"])
        # By number, which is creation order here.
        self.assertEqual(list(self.MEMBERS), self.names([m["reference"] for m in found["members"]]))
        excluded = {"R", "O", "O2", "Up", "Rel", "Dup", "Blk", "Z"}
        self.assertFalse(excluded & set(self.names([m["reference"] for m in found["members"]])))

    def test_the_epic_scope_is_the_roots_children_alone(self) -> None:
        found = self.read(id=self.refs["R"], scope="epic")
        self.assertEqual("epic", found["scope"])
        self.assertEqual(["C1", "C2", "C3"], self.names([m["reference"] for m in found["members"]]))
        self.assertEqual(
            (3, 1, 2, 1), (found["total"], found["closed"], found["open"], found["ready"])
        )
        self.assertEqual(
            [("R", 3, 2)],
            [
                (self.names([o["parent_reference"]])[0], o["count"], o["open"])
                for o in found["origins"]
            ],
        )

    def test_the_root_is_named_by_reference_or_by_id_and_is_never_a_member(self) -> None:
        by_reference = self.read(id=self.refs["R"])
        by_id = self.read(id=self.ids["R"])
        self.assertEqual(by_reference, by_id)
        self.assertEqual(
            {
                "work_item_id": self.ids["R"],
                "reference": self.refs["R"],
                "title": "R",
                "kind": "epic",
                "has_children": True,
            },
            by_reference["root"],
        )

    def test_a_root_without_children_still_has_what_was_discovered_from_it(self) -> None:
        found = self.read(id=self.refs["D1"])
        self.assertEqual(["F"], self.names([m["reference"] for m in found["members"]]))
        self.assertFalse(found["root"]["has_children"])
        self.assertEqual(0, self.read(id=self.refs["D1"], scope="epic")["total"])

    def test_counts_and_categories(self) -> None:
        found = self.read(id=self.refs["R"])
        self.assertEqual(
            (10, 4, 6, 2), (found["total"], found["closed"], found["open"], found["ready"])
        )
        self.assertEqual(
            {"active": 1, "backlog": 3, "cancelled": 1, "completed": 3, "queued": 1, "review": 1},
            found["by_category"],
        )

    def test_origins_put_the_roots_children_first_then_the_largest_group(self) -> None:
        found = self.read(id=self.refs["R"])
        self.assertEqual(
            [("R", "R", 3, 2), (None, None, 4, 3), ("E", "E", 2, 1), ("O", "O", 1, 0)],
            [
                (
                    self.names([origin["parent_reference"]])[0],
                    origin["parent_title"],
                    origin["count"],
                    origin["open"],
                )
                for origin in found["origins"]
            ],
        )

    def test_each_member_says_where_it_stands(self) -> None:
        members = {
            self.names([m["reference"]])[0]: m for m in self.read(id=self.refs["R"])["members"]
        }
        self.assertEqual(
            {
                "C1": "2026-10-20T10:00:00Z",  # the newest of its two transitions
                "E1": "2026-10-29T10:00:00Z",
                "F": "2026-10-31T07:00:00Z",
                "D2": "2026-10-30T09:30:00Z",  # no transition: its last update
            },
            {name: m["closed_at"] for name, m in members.items() if m["closed_at"] is not None},
        )
        # Open with a transition behind it is still open.
        self.assertIsNone(members["C3"]["closed_at"])
        self.assertEqual("2026-10-10T08:00:00Z", members["C3"]["created_at"])
        # Ready: unheld, uncontained, not started, and nothing unfinished blocks
        # it. D0's only blocker is finished; E is a container; E2 waits on C3.
        self.assertEqual({"C2", "D0"}, {name for name, m in members.items() if m["ready"]})
        self.assertEqual(
            ("one", "unconfirmed"), (members["C3"]["claim_ref"], members["C3"]["claim_state"])
        )
        self.assertEqual(("", None), (members["C2"]["claim_ref"], members["C2"]["claim_state"]))
        self.assertEqual(
            {"C1": "R", "C2": "R", "C3": "R", "E1": "E", "E2": "E", "F": "O"},
            {
                name: self.names([m["parent_reference"]])[0]
                for name, m in members.items()
                if m["parent_reference"] is not None
            },
        )
        self.assertEqual(
            {"key": "dev", "name": "Dev", "category": "active", "is_terminal": False},
            members["C3"]["state"],
        )

    def test_readiness_is_the_one_the_item_record_reports(self) -> None:
        for member in self.read(id=self.refs["R"])["members"]:
            with self.subTest(member=member["reference"]):
                item = service.get_work_item(self.conn, member["reference"])
                self.assertEqual(item["ready"], member["ready"])

    def test_edges_are_the_blocks_and_discovery_links_inside_the_chain(self) -> None:
        found = self.read(id=self.refs["R"])
        by_id = {identity: name for name, identity in self.ids.items()}
        self.assertEqual(
            {
                ("D0", "R", "discovered-from"),
                ("D1", "C1", "discovered-from"),
                ("E", "C2", "discovered-from"),
                ("F", "D1", "discovered-from"),
                ("D2", "E1", "discovered-from"),
                ("C3", "E2", "blocks"),
                ("C1", "D0", "blocks"),
            },
            {(by_id[e["from"]], by_id[e["to"]], e["kind"]) for e in found["edges"]},
        )
        self.assertEqual(len(found["edges"]), 7)

    def test_the_series_is_cumulative_over_the_days_anything_changed(self) -> None:
        self.assertEqual(
            [
                {"day": "2026-10-10", "created": 3, "closed": 0, "total": 3, "closed_total": 0},
                {"day": "2026-10-20", "created": 2, "closed": 1, "total": 5, "closed_total": 1},
                {"day": "2026-10-26", "created": 2, "closed": 0, "total": 7, "closed_total": 1},
                {"day": "2026-10-27", "created": 1, "closed": 0, "total": 8, "closed_total": 1},
                {"day": "2026-10-28", "created": 1, "closed": 0, "total": 9, "closed_total": 1},
                {"day": "2026-10-29", "created": 0, "closed": 1, "total": 9, "closed_total": 2},
                {"day": "2026-10-30", "created": 1, "closed": 1, "total": 10, "closed_total": 3},
                {"day": "2026-10-31", "created": 0, "closed": 1, "total": 10, "closed_total": 4},
            ],
            self.read(id=self.refs["R"])["series"],
        )

    def test_recent_reads_the_last_seven_days_and_names_the_trend(self) -> None:
        for today, created, closed, trend in (
            # 10-25..10-31: E, E1, E2, F, D2 created; E1, D2, F closed.
            ("2026-10-31", 5, 3, "growing"),
            # 10-28..11-03: F, D2 created; E1, D2, F closed.
            ("2026-11-03", 2, 3, "converging"),
            # 10-27..11-02: E2, F, D2 created and E1, D2, F closed.
            ("2026-11-02", 3, 3, "steady"),
            # Nothing at all in the window is steady too.
            ("2026-11-20", 0, 0, "steady"),
        ):
            with self.subTest(today=today):
                self.today(today)
                self.assertEqual(
                    {"days": 7, "created": created, "closed": closed, "trend": trend},
                    self.read(id=self.refs["R"])["recent"],
                )

    def test_the_answer_has_exactly_the_published_shape(self) -> None:
        found = self.read(id=self.refs["R"])
        self.assertEqual(
            {
                "root",
                "scope",
                "total",
                "closed",
                "open",
                "ready",
                "by_category",
                "origins",
                "series",
                "recent",
                "members",
                "edges",
            },
            set(found),
        )
        self.assertEqual(
            {"parent_reference", "parent_title", "count", "open"}, set(found["origins"][0])
        )
        self.assertEqual(
            {"day", "created", "closed", "total", "closed_total"}, set(found["series"][0])
        )
        self.assertEqual({"from", "to", "kind"}, set(found["edges"][0]))
        self.assertEqual(
            {
                "work_item_id",
                "reference",
                "title",
                "state",
                "claim_ref",
                "claim_state",
                "parent_reference",
                "created_at",
                "closed_at",
                "ready",
                "rank",
            },
            set(found["members"][0]),
        )
        answer = planning_api.handle_get(self.conn, CHAIN_PATH, {"id": [self.refs["R"]]})
        assert answer is not None
        self.assertEqual({"interface_version", "chain"}, set(answer[1]))

    def test_a_bad_scope_an_unknown_item_and_no_item_are_refused(self) -> None:
        self.assertEqual(
            (400, "invalid_request", "scope must be chain or epic"),
            self.refusal(id=self.refs["R"], scope="relates"),
        )
        self.assertEqual(
            (400, "invalid_request", "scope must be chain or epic"),
            self.refusal(id=self.refs["R"], scope="Chain"),
        )
        # A blank parameter is an absent one on every read here, so it is the default.
        self.assertEqual("chain", self.read(id=self.refs["R"], scope="")["scope"])
        # A well-formed id that names nothing is not an invalid request: it has its own code.
        self.assertEqual((404, "not_found", "no work item QA-999"), self.refusal(id="QA-999"))
        self.assertEqual((400, "invalid_request", "id is required"), self.refusal())

    def test_the_list_read_keeps_only_one_items_children(self) -> None:
        answer = planning_api.handle_get(
            self.conn, "/api/planning/work-items", {"parent": [self.refs["E"]]}
        )
        assert answer is not None
        self.assertEqual(
            ["E1", "E2"],
            sorted(self.names([item["reference"] for item in answer[1]["work_items"]])),
        )
        answer = planning_api.handle_get(
            self.conn,
            "/api/planning/work-items",
            {"parent": [self.ids["R"]], "category": ["active"]},
        )
        assert answer is not None
        self.assertEqual(["C3"], self.names([i["reference"] for i in answer[1]["work_items"]]))


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
