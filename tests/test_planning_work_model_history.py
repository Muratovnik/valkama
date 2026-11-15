"""How history is read once a goal or stage can come to stand accepted and open.

A container that came to stand in the service state is written down as `opened`,
whose detail is a reason or nothing and never a state's key; the work model names
it, beside `created` and `transitioned`, as an entry into a state
(`model.STATE_ENTRY_ACTIONS`). So every reader that asks where an item stood reads
`opened` as an entry into no category, and only `created` and `transitioned` name
a category by their detail. What a person and an agent are told of such a move is
that the item is "accepted and open".
"""

from __future__ import annotations

import os
import re
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

from server import store
from server.alerts import emit
from server.hooks import notify
from server.planning import model, person_events, views
from tests.planning_tree import Tree


class HistoryCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": str(Path(directory.name) / "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.tree = Tree(self.conn)

    def call(self, session: str = "session-a") -> int:
        """One call an agent's proved session made."""

        return int(
            self.conn.execute(
                "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
                " tool, session_id) VALUES (?, 'tool_call', 'confirmed', 'mcp',"
                " 'apply_work_item_changes', ?)",
                (str(uuid.uuid4()), session),
            ).lastrowid
        )

    def event(self, name: str, action: str, detail: str, call: int | None = None) -> int:
        return int(
            self.conn.execute(
                "INSERT INTO work_item_events(work_item_id, action, detail, author, call_id)"
                " VALUES (?, ?, ?, 'agent', ?)",
                (self.tree.ids[name], action, detail, call),
            ).lastrowid
        )

    def row(self, name: str) -> object:
        return self.conn.execute(
            "SELECT * FROM work_items WHERE work_item_id = ?", (self.tree.ids[name],)
        ).fetchone()


class BlockerToldTests(HistoryCase):
    """What the holder of a blocked item is told of its blocker's moves."""

    def setUp(self) -> None:
        super().setUp()
        self.tree.add("G", kind="goal", state="container")
        self.tree.add("a", state="ready")
        self.tree.block("G", "a")

    def test_a_blocker_that_came_to_stand_accepted_and_open_is_told_so_and_the_hook_prints_it(
        self,
    ) -> None:
        call = self.call()
        self.event("G", "opened", "confirmed by the owner", call)
        told = person_events.blocker_changes(self.conn, self.tree.ids["a"], 0)
        self.assertEqual([call], [at for at, _entry in told])
        entry = told[0][1]
        self.assertEqual(
            ("blocker_changed", self.tree.refs["G"], "accepted and open"),
            (entry["kind"], entry["blocker"], entry["state"]),
        )
        self.assertEqual(f" on {self.tree.refs['G']}, now accepted and open", notify._thread(entry))

    def test_a_close_that_an_opening_undid_is_not_the_blockers_last(self) -> None:
        closing, opening = self.call(), self.call()
        self.event("G", "transitioned", "done", closing)
        self.event("G", "opened", "", opening)
        told = person_events.blocker_changes(self.conn, self.tree.ids["a"], 0)
        self.assertEqual(
            [("blocker_changed", "Done"), ("blocker_changed", "accepted and open")],
            [(entry["kind"], entry["state"]) for _at, entry in told],
        )

    def test_a_close_after_the_opening_is_the_blockers_last(self) -> None:
        opening, closing = self.call(), self.call()
        self.event("G", "opened", "", opening)
        self.event("G", "transitioned", "done", closing)
        told = person_events.blocker_changes(self.conn, self.tree.ids["a"], 0)
        self.assertEqual(
            [("blocker_changed", "accepted and open"), ("blocker_closed", "Done")],
            [(entry["kind"], entry["state"]) for _at, entry in told],
        )

    def test_the_last_entry_is_read_by_the_actions_the_work_model_names(self) -> None:
        """This reader imports nothing of the product, so it spells the actions out."""

        last = re.search(r"t\.action IN \(([^)]*)\)", person_events._BLOCKER_CHANGES)
        assert last is not None, "the last entry is read by a list of actions"
        named = tuple(part.strip().strip("'") for part in last.group(1).split(","))
        self.assertEqual(model.STATE_ENTRY_ACTIONS, named)


class OpenedEntryToldTests(HistoryCase):
    def test_another_agent_opening_a_container_is_told_as_accepted_and_open(self) -> None:
        self.tree.add("G", kind="goal", state="container")
        with_reason, without = self.call("session-b"), self.call("session-b")
        self.event("G", "opened", "confirmed by the owner", with_reason)
        self.event("G", "opened", "", without)
        told = person_events.agents_since(self.conn, self.tree.ids["G"], 0)
        self.assertEqual(
            [
                ("status", "accepted and open: confirmed by the owner"),
                ("status", "accepted and open"),
            ],
            [(entry["kind"], entry["text"]) for _at, entry in told],
        )


class CategoryBeforeTests(HistoryCase):
    """The category a review toast asks of the history: where an item stood before a call."""

    def test_an_opened_container_stood_in_no_category_before_it_moved(self) -> None:
        self.tree.add("G", kind="goal", state="container")
        self.event("G", "created", "triage")
        self.event("G", "opened", "confirmed by the owner")
        move = self.event("G", "transitioned", "done")
        self.assertIsNone(emit._category_before(self.conn, self.row("G"), move))

    def test_a_task_stood_in_the_category_of_the_state_it_last_entered(self) -> None:
        self.tree.add("a", state="ready")
        self.event("a", "created", "triage")
        self.event("a", "transitioned", "review: ready to look at")
        move = self.event("a", "transitioned", "done")
        self.assertEqual("review", emit._category_before(self.conn, self.row("a"), move))

    def test_a_container_reopened_after_it_was_opened_stood_where_the_reopening_put_it(
        self,
    ) -> None:
        self.tree.add("G", kind="goal", state="container")
        self.event("G", "opened", "")
        self.event("G", "transitioned", "ready")
        move = self.event("G", "transitioned", "done")
        self.assertEqual("ready", emit._category_before(self.conn, self.row("G"), move))


class FeedCategoryTests(HistoryCase):
    def test_only_an_entry_into_a_state_gives_the_feed_a_category(self) -> None:
        self.tree.add("G", kind="goal", state="container")
        self.tree.add("a", state="review")
        entries = {
            self.event("a", "created", "triage"): "triage",
            self.event("a", "transitioned", "review: ready to look at"): "review",
            # A step whose text is a state's key, and an opening whose reason is one.
            self.event("a", "checklist_completed", "review"): None,
            self.event("G", "opened", "done"): None,
            self.event("G", "accepted", "owner"): None,
        }
        feed = {
            entry["event_id"]: entry["state_category"] for entry in views.activity_feed(self.conn)
        }
        self.assertEqual(entries, {event: feed[event] for event in entries})


if __name__ == "__main__":
    unittest.main()
