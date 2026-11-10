"""The live-work frame, as the connection contract describes it ("The live-work frame").

Which rows: an open item with live work, `quiet` included; a pinned item, open or
closed; every parent of those. Their order: groups first in the order of work, each
followed by its own rows, then the rest, the rows that are not groups by number.
`agents` counts the live subagents `ladder` places on a row, each on one item. A
session at work or waiting on no row is listed under the space of the folder it was
opened in, or in `elsewhere`, which places a row and binds nothing.

The cases build their sessions through the real hook ingest and their claims through
the real write path, as `test_planning_live_work` does, with its clock.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from unittest import mock

from server.planning import executors, live_frame, live_work, service
from server.projects import project_registry
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_entry, registry_bytes
from tests.test_planning_live_work import SPACE, LiveWorkCase, ago, second


def _session() -> str:
    return str(uuid.uuid4())


class FrameCase(LiveWorkCase):
    def frame(self) -> dict:
        return live_frame.frame(self.conn)

    def space(self, key: str = SPACE) -> dict:
        (found,) = [space for space in self.frame()["spaces"] if space["key"] == key]
        return found

    def rows(self, key: str = SPACE) -> dict[str, dict]:
        return {row["reference"]: row for row in self.space(key)["rows"]}

    def order(self, key: str = SPACE) -> list[str]:
        return [row["reference"] for row in self.space(key)["rows"]]

    def working(self, reference: str, session: str | None = None) -> str:
        """A session that claimed the item and has a turn running on it."""

        session = session or _session()
        self.claim(reference, session)
        self.hook(session, "session-start", ago(minutes=30))
        self.hook(session, "user-prompt-submit", ago(minutes=10))
        self.comment(reference, session)
        return session

    def pin(self, reference: str, pinned: bool = True) -> None:
        service.pin_work_item(self.conn, reference, pinned)

    def child(self, parent: str, kind: str = "task") -> str:
        created = service.create_work_item(
            self.conn, space=SPACE, title="Child", kind=kind, parent=parent
        )
        return str(created["reference"])

    def updated_at(self, reference: str) -> str:
        number = int(reference.rsplit("-", 1)[1])
        row = self.conn.execute(
            "SELECT updated_at FROM work_items WHERE number = ?", (number,)
        ).fetchone()
        return str(row[0])

    def epic(self) -> str:
        created = service.create_work_item(self.conn, space=SPACE, title="Epic", kind="epic")
        return str(created["reference"])


class RowTests(FrameCase):
    def test_a_store_with_nothing_live_and_nothing_pinned_has_no_space(self) -> None:
        self.item()
        self.assertEqual({"spaces": [], "elsewhere": []}, self.frame())

    def test_a_working_row_carries_every_field_the_contract_names(self) -> None:
        reference = self.item()
        session = self.working(reference)
        space = self.space()
        self.assertEqual(
            {"key": SPACE, "name": "Live", "project_id": None, "sessions": []},
            {name: value for name, value in space.items() if name != "rows"},
        )
        self.assertEqual(
            [
                {
                    "reference": reference,
                    "title": "Work",
                    "kind": "task",
                    "parent": None,
                    "state": "working",
                    "agents": 0,
                    "long": False,
                    "asks": False,
                    "since": second(minutes=10),
                    "quiet_since": None,
                    "executor": executors.session_executors(self.conn, [session])[session],
                    "pinned": False,
                    "state_name": "Backlog",
                    "is_terminal": False,
                    "updated_at": self.updated_at(reference),
                }
            ],
            space["rows"],
        )

    def test_a_row_says_when_its_item_last_changed_which_only_a_write_moves(self) -> None:
        reference = self.item()
        self.working(reference)
        self.conn.execute(
            "UPDATE work_items SET updated_at = ? WHERE number = ?",
            ("2026-01-02T03:04:05Z", int(reference.rsplit("-", 1)[1])),
        )
        self.conn.commit()
        self.assertEqual("2026-01-02T03:04:05Z", self.rows()[reference]["updated_at"])
        self.assertEqual(self.frame(), self.frame(), "time passing moves nothing")
        service.update_work_item(self.conn, reference, title="Renamed")
        moved = self.rows()[reference]["updated_at"]
        self.assertEqual(self.updated_at(reference), moved)
        self.assertGreater(moved, "2026-01-02T03:04:05Z")

    def test_a_quiet_row_is_in_the_frame_with_its_state_and_since_when(self) -> None:
        reference = self.item()
        session = _session()
        self.claim(reference, session)
        self.hook(session, "session-start", ago(days=3))
        self.seen(session, second(days=2))
        row = self.rows()[reference]
        self.assertEqual(("quiet", second(days=2)), (row["state"], row["quiet_since"]))

    def test_a_waiting_row_says_whether_its_wait_is_long(self) -> None:
        fresh, stale = self.item(), self.item()
        for reference, hours in ((fresh, 1), (stale, 5)):
            session = _session()
            self.claim(reference, session)
            self.hook(session, "user-prompt-submit", ago(hours=hours, minutes=1))
            self.hook(session, "stop", ago(hours=hours))
        rows = self.rows()
        self.assertEqual(
            [("waiting", False, second(hours=1)), ("waiting", True, second(hours=5))],
            [
                (rows[reference]["state"], rows[reference]["long"], rows[reference]["since"])
                for reference in (fresh, stale)
            ],
        )

    def test_a_row_whose_session_asks_says_so_and_since_when(self) -> None:
        reference = self.item()
        session = _session()
        self.claim(reference, session)
        self.hook(session, "user-prompt-submit", ago(minutes=10))
        self.hook(session, "notification", ago(minutes=4))
        row = self.rows()[reference]
        self.assertEqual(
            ("waiting", True, second(minutes=4)), (row["state"], row["asks"], row["since"])
        )

    def test_a_row_names_the_session_its_state_comes_from(self) -> None:
        reference = self.item(["step"])
        quiet, waiting = _session(), _session()
        self.claim(reference, quiet)
        self.hook(quiet, "session-start", ago(days=3))
        self.seen(quiet, second(days=2))
        self.assertEqual(quiet, self.rows()[reference]["executor"]["session"])
        self.hold_step(reference, waiting)
        self.hook(waiting, "stop", ago(minutes=5))
        row = self.rows()[reference]
        self.assertEqual(("waiting", waiting), (row["state"], row["executor"]["session"]))
        mover = _session()
        self.hook(mover, "user-prompt-submit", ago(minutes=1))
        self.comment(reference, mover)
        row = self.rows()[reference]
        self.assertEqual(
            ("working", mover, second(minutes=1)),
            (row["state"], row["executor"]["session"], row["since"]),
            "the session that wrote to it, though it holds nothing",
        )

    def test_a_row_only_an_attempt_moves_and_a_pinned_one_name_no_session(self) -> None:
        attempted, pinned = self.item(), self.item()
        self.attempt(attempted, "running")
        self.pin(pinned)
        rows = self.rows()
        self.assertEqual(
            [("working", None, None), (None, None, None)],
            [
                (rows[reference]["state"], rows[reference]["executor"], rows[reference]["since"])
                for reference in (attempted, pinned)
            ],
        )

    def test_a_row_an_attempt_moves_names_no_session_that_waits_behind_it(self) -> None:
        reference = self.item()
        waiting = _session()
        self.claim(reference, waiting)
        self.hook(waiting, "session-start", ago(minutes=30))
        self.hook(waiting, "user-prompt-submit", ago(minutes=20))
        self.hook(waiting, "stop", ago(minutes=10))
        self.attempt(reference, "running")
        row = self.rows()[reference]
        self.assertEqual(
            ("working", None, None),
            (row["state"], row["executor"], row["since"]),
            "the attempt is at work: the session that waits is not what the row shows",
        )

    def test_an_open_item_with_no_live_work_and_no_pin_is_no_row(self) -> None:
        live, idle = self.item(), self.item()
        self.working(live)
        self.assertNotIn(idle, self.rows())

    def test_a_pinned_item_with_no_work_is_a_row_with_no_state(self) -> None:
        reference = self.item()
        self.pin(reference)
        row = self.rows()[reference]
        self.assertEqual(
            (None, 0, True, False), (row["state"], row["agents"], row["pinned"], row["is_terminal"])
        )

    def test_a_pin_outlives_the_close_and_reopening_makes_it_an_open_row_again(self) -> None:
        reference = self.item()
        self.pin(reference)
        service.transition_work_item(self.conn, reference, "done", force=True)
        closed = self.rows()[reference]
        self.assertEqual(
            ("Done", True, True), (closed["state_name"], closed["is_terminal"], closed["pinned"])
        )
        service.transition_work_item(self.conn, reference, "dev", force=True)
        reopened = self.rows()[reference]
        self.assertEqual(
            ("Dev", False, True),
            (reopened["state_name"], reopened["is_terminal"], reopened["pinned"]),
        )

    def test_a_closed_item_without_a_pin_is_no_row(self) -> None:
        reference = self.item()
        self.pin(reference)
        service.transition_work_item(self.conn, reference, "done", force=True)
        self.pin(reference, False)
        self.assertEqual([], self.frame()["spaces"])

    def test_the_parent_of_a_row_is_a_row_so_parent_names_one(self) -> None:
        epic, idle_epic = self.epic(), self.epic()
        task, idle = self.child(epic), self.child(idle_epic)
        service.transition_work_item(self.conn, epic, "done", force=True)
        self.working(task)
        rows = self.rows()
        self.assertEqual({epic, task}, set(rows), (idle, idle_epic))
        self.assertEqual((None, epic), (rows[epic]["parent"], rows[task]["parent"]))
        self.assertIsNone(rows[epic]["state"])
        self.assertTrue(rows[epic]["is_terminal"], "a closed parent still heads its group")

    def test_an_epic_at_work_is_one_row_heading_its_group_with_its_own_state(self) -> None:
        epic = self.epic()
        task = self.child(epic)
        self.working(epic)
        self.pin(task)
        self.assertEqual([epic, task], self.order())
        self.assertEqual("working", self.rows()[epic]["state"])

    def test_spaces_come_by_key_and_a_space_with_no_rows_is_left_out(self) -> None:
        service.create_planning_space(self.conn, project_id="a", name="Alpha", key="AA")
        service.create_planning_space(self.conn, project_id="z", name="Zulu", key="ZZ")
        service.create_planning_space(self.conn, project_id="m", name="Empty", key="MM")
        for key in ("ZZ", "AA"):
            self.pin(str(service.create_work_item(self.conn, space=key, title="x")["reference"]))
        self.pin(self.item())
        self.assertEqual(["AA", SPACE, "ZZ"], [space["key"] for space in self.frame()["spaces"]])


class OrderTests(FrameCase):
    def test_groups_come_first_in_the_order_of_work_then_the_rest_by_number(self) -> None:
        loose_low = self.item()
        later, sooner = self.epic(), self.epic()
        later_child = self.child(later)
        third, first = self.child(sooner), self.child(sooner)
        loose_high = self.item()
        # The order of work puts `sooner` first: it is placed first in its state.
        service.update_work_item(self.conn, sooner, rank="first")
        for reference in (loose_high, loose_low, first, third, later_child):
            self.pin(reference)
        self.assertEqual(
            [sooner, third, first, later, later_child, loose_low, loose_high], self.order()
        )

    def test_a_change_of_state_does_not_move_a_row_that_is_not_a_group(self) -> None:
        first, second_item, third = self.item(), self.item(), self.item()
        for reference in (first, second_item, third):
            self.pin(reference)
        before = self.order()
        service.transition_work_item(self.conn, first, "dev", force=True)
        self.working(second_item)
        self.assertEqual(before, self.order())

    def test_an_unchanged_store_gives_the_same_frame(self) -> None:
        reference = self.item()
        self.working(reference)
        self.pin(self.item())
        self.assertEqual(self.frame(), self.frame())


class AgentTests(FrameCase):
    def coordinator(self, *held: str) -> str:
        session = _session()
        for reference in held:
            self.claim(reference, session)
        self.hook(session, "session-start", ago(minutes=59), source="startup")
        self.hook(session, "user-prompt-submit", ago(minutes=58))
        return session

    def subagent(self, session: str, agent: str) -> None:
        self.hook(session, "subagent-start", ago(minutes=3), agent=agent)

    def test_each_live_subagent_counts_once_on_the_item_of_its_latest_write(self) -> None:
        first, second_item, other = self.item(), self.item(), self.item()
        session = self.coordinator(first, second_item, other)
        for agent in ("a1", "a2", "a3"):
            self.subagent(session, agent)
        self.comment(first, session, "a1")
        self.comment(first, session, "a2")
        self.comment(second_item, session, "a2")
        rows = self.rows()
        self.assertEqual(
            (1, 1, 0),
            (rows[first]["agents"], rows[second_item]["agents"], rows[other]["agents"]),
            "a2 stands where it wrote last; a3, with no sign and three holds, stands nowhere",
        )

    def test_a_subagent_with_no_write_stands_on_its_step_then_its_packet(self) -> None:
        stepped, packed, held = self.item(["step"]), self.item(), self.item()
        session = self.coordinator(held)
        self.subagent(session, "a1")
        self.subagent(session, "a2")
        self.hold_step(stepped, session, agent="a1")
        self.conn.execute(
            "INSERT INTO usage_runs(session_id, agent_id, client, path, packet_item)"
            " VALUES (?, 'a2', 'claude', 'x', ?)",
            (session, self.identity(packed)),
        )
        rows = self.rows()
        self.assertEqual(
            (1, 1, 0), (rows[stepped]["agents"], rows[packed]["agents"], rows[held]["agents"])
        )

    def test_a_subagent_with_no_other_sign_stands_on_its_sessions_one_hold(self) -> None:
        held = self.item()
        session = self.coordinator(held)
        self.subagent(session, "a1")
        self.assertEqual(1, self.rows()[held]["agents"])

    def test_the_sessions_own_run_is_not_counted(self) -> None:
        reference = self.item()
        self.working(reference)
        self.assertEqual(0, self.rows()[reference]["agents"])

    def test_the_map_the_graph_reads_is_the_placement_map(self) -> None:
        first, second_item = self.item(), self.item()
        session = self.coordinator(first, second_item)
        self.subagent(session, "a1")
        self.comment(first, session, "a1")
        items = service.list_work_items(self.conn, space=SPACE, limit=None)
        self.assertEqual(
            live_work.live_work(self.conn, items), live_work.placed(self.conn, items).live
        )


class SessionPlaceTests(FrameCase):
    """Where a session on no row is listed. What its row says is `live_sessions`'s."""

    def setUp(self) -> None:
        super().setUp()
        self.root = Path(self.conn.execute("PRAGMA database_list").fetchone()[2]).parent
        self.bound = self.root / "bound"
        self.unbound = self.bound / "inner"
        self.unbound.mkdir(parents=True)
        space_ref = {
            "data_scope_id": read_store_metadata(self.conn)["data_scope_id"],
            "space_key": SPACE,
        }
        bound = project_entry("bound-project", self.bound)
        bound["planning_binding"] = planning_space_entity(space_ref)
        registry = registry_bytes([bound, project_entry("inner-project", self.unbound)])
        patch = mock.patch.object(project_registry, "_read_registry_bytes", return_value=registry)
        patch.start()
        self.addCleanup(patch.stop)

    def at_work(self, folder: str, minutes: float = 10) -> str:
        """A session with a turn running on nothing, opened in `folder`."""

        session = _session()
        self.hook(session, "session-start", ago(minutes=minutes + 20), cwd=folder)
        self.hook(session, "user-prompt-submit", ago(minutes=minutes))
        return session

    def listed(self, sessions: list[dict]) -> list[str]:
        return [row["session"] for row in sessions]

    def test_a_session_on_no_row_is_listed_under_the_space_its_folder_is_bound_to(self) -> None:
        session = self.at_work(str(self.bound / "src"))
        space = self.space()
        self.assertEqual(("bound-project", []), (space["project_id"], space["rows"]))
        self.assertEqual([session], self.listed(space["sessions"]))
        self.assertEqual([], self.frame()["elsewhere"])

    def test_the_longest_root_decides_and_a_project_binding_no_space_is_elsewhere(self) -> None:
        inner = self.at_work(str(self.unbound), minutes=5)
        nowhere = self.at_work(os.path.join(os.path.dirname(self.root), "nowhere"))
        frame = self.frame()
        self.assertEqual([], frame["spaces"])
        self.assertEqual([inner, nowhere], self.listed(frame["elsewhere"]), "freshest first")

    def test_a_session_whose_work_is_a_row_is_not_listed(self) -> None:
        reference = self.item()
        session = _session()
        self.hook(session, "session-start", ago(minutes=40), cwd=str(self.bound))
        self.working(reference, session)
        self.assertEqual([], self.space()["sessions"])
        self.hook(session, "stop", ago(minutes=1))
        self.assertEqual([], self.space()["sessions"], "it waits on its row")

    def test_a_session_waiting_on_no_row_stays_listed(self) -> None:
        session = self.at_work(str(self.bound))
        self.hook(session, "stop", ago(minutes=1))
        (row,) = self.space()["sessions"]
        self.assertEqual((session, "waiting", False), (row["session"], row["state"], row["long"]))

    def test_listing_writes_nothing_and_binds_nothing(self) -> None:
        self.at_work(str(self.bound))
        before = self.conn.total_changes
        self.frame()
        self.assertEqual(before, self.conn.total_changes)
