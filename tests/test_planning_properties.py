"""What stays true about a work item however the space is driven.

The example suites drive one operation at a time and assert its result. This one
drives arbitrary sequences of them against a real SQLite store and asserts the
things every sequence has to leave true: a guarded write versions the item
exactly once, a refused write leaves nothing behind, an override is on the
record, and one state never orders two of its items the same.

Those are properties the surfaces depend on without stating: the desktop app
resolves a conflict by comparing revisions, and every view draws a state's items
in position order. A sequence that broke either would still pass every
single-operation test in this repository.

Every case runs against a throwaway store in a temporary directory. The owner's
store is never a subject here — and cannot be: `tests/__init__.py` names it as
protected and `store.db_path()` refuses it.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

from hypothesis import strategies as st
from hypothesis.stateful import Bundle, RuleBasedStateMachine, invariant, rule

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import store
from server.planning import model, service
from tests.property_settings import machine_settings

SPACE_NAME = "Property Space"
SPACE_KEY = "PRO"
# Two of them, so a claim can be contested; neither names anybody real.
AUTHORS = st.sampled_from(("agent-one", "agent-two"))
TITLES = (
    st.text(alphabet="abcdefghijklmnopqrstuvwxyz ", min_size=1, max_size=24)
    .map(str.strip)
    .filter(bool)
)
ITEM_TEXTS = st.lists(TITLES, min_size=0, max_size=3, unique=True)
REASONS = st.one_of(st.none(), st.just("waiting on an external service"))


class PlanningMachine(RuleBasedStateMachine):
    items = Bundle("items")

    def __init__(self) -> None:
        super().__init__()
        self.directory = tempfile.TemporaryDirectory()
        self.environment = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": os.path.join(self.directory.name, "valkama.sqlite3"),
                "USERPROFILE": self.directory.name,
                "HOME": self.directory.name,
            },
        )
        self.environment.start()
        self.conn = store.connect()
        space = service.create_planning_space(
            self.conn, project_id="property", name=SPACE_NAME, key=SPACE_KEY
        )
        self.conn.commit()
        # The states this space declares, so a rule picks a real one rather than
        # a name this file decided.
        self.states = [str(state["key"]) for state in space["workflow"]["states"]]
        self.highest_revision: dict[str, int] = {}

    def teardown(self) -> None:
        self.conn.close()
        self.environment.stop()
        self.directory.cleanup()

    def row(self, reference: str) -> sqlite3.Row:
        return self.conn.execute(
            "SELECT w.*, s.key AS state_key FROM work_items w"
            " JOIN workflow_states s ON s.state_id = w.state_id"
            " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
            " WHERE p.key || '-' || w.number = ?",
            (reference,),
        ).fetchone()

    def events(self, reference: str) -> list[str]:
        return [
            event["action"]
            for event in self.conn.execute(
                "SELECT e.action FROM work_item_events e"
                " JOIN work_items w ON w.work_item_id = e.work_item_id"
                " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
                " WHERE p.key || '-' || w.number = ? ORDER BY e.id",
                (reference,),
            )
        ]

    @rule(target=items, title=TITLES)
    def create(self, title):
        item = service.create_work_item(self.conn, space=SPACE_KEY, title=title)
        assert item["revision"] == 0
        return item["reference"]

    @rule(
        item=items,
        which=st.integers(min_value=0, max_value=5),
        force=st.booleans(),
        reason=REASONS,
        author=AUTHORS,
    )
    def transition(self, item, which, force, reason, author):
        target = self.states[which % len(self.states)]
        before = self.row(item)
        try:
            result = service.transition_work_item(
                self.conn, item, target, author=author, force=force, reason=reason or ""
            )
        except model.WorkflowGuardError:
            # A refusal is a decision not to write, so nothing may have moved
            # and the version the caller holds must still be current.
            after = self.row(item)
            assert not force
            assert after["state_key"] == before["state_key"]
            assert after["revision"] == before["revision"]
            return
        after = self.row(item)
        assert after["state_key"] == target
        assert after["revision"] == before["revision"] + 1
        assert result["revision"] == after["revision"]
        if result.get("overridden"):
            # force is the audited way through, so the override has to be
            # readable afterwards rather than only in the caller's result.
            assert force
            assert "overridden" in self.events(item)

    @rule(item=items, drift=st.integers(min_value=1, max_value=3))
    def a_stale_revision_is_refused(self, item, drift):
        before = self.row(item)
        try:
            service.claim_work_item(
                self.conn, item, expected_revision=int(before["revision"]) + drift
            )
        except model.RevisionConflictError as conflict:
            assert conflict.actual == int(before["revision"])
            after = self.row(item)
            assert after["state_key"] == before["state_key"]
            assert after["revision"] == before["revision"]
            return
        raise AssertionError("a write against a revision the store never had was accepted")

    @rule(item=items, author=AUTHORS, release=st.booleans(), force=st.booleans())
    def claim(self, item, author, release, force):
        before = self.row(item)
        try:
            service.claim_work_item(self.conn, item, author=author, release=release, force=force)
        except model.PlanningError:
            # Losing a contested claim costs nothing, and neither does being
            # refused the release of somebody else's: the holder keeps it and
            # the loser's view of the item is still current. Only `force` gets
            # through, so a refusal proves it was absent.
            after = self.row(item)
            assert not force
            assert after["claim_ref"] == before["claim_ref"]
            assert after["revision"] == before["revision"]
            return
        after = self.row(item)
        assert after["claim_ref"] == ("" if release else author)
        assert after["revision"] == before["revision"] + 1

    @rule(item=items, texts=ITEM_TEXTS, force=st.booleans())
    def set_checklist(self, item, texts, force):
        before = self.row(item)
        try:
            service.set_checklist(self.conn, item, list(texts), force=force)
        except model.PlanningError:
            after = self.row(item)
            assert not force
            assert after["checklist"] == before["checklist"]
            assert after["revision"] == before["revision"]
            return
        assert self.row(item)["revision"] == before["revision"] + 1

    @rule(
        item=items,
        which=st.integers(min_value=0, max_value=3),
        done=st.booleans(),
        author=AUTHORS,
        force=st.booleans(),
    )
    def tick(self, item, which, done, author, force):
        before = self.row(item)
        steps = json.loads(before["checklist"])
        if not steps:
            return
        step_id = str(steps[which % len(steps)]["id"])
        try:
            service.tick_checklist_item(
                self.conn, item, step_id, done=done, author=author, force=force
            )
        except model.PlanningError:
            after = self.row(item)
            assert after["checklist"] == before["checklist"]
            assert after["revision"] == before["revision"]
            return
        assert self.row(item)["revision"] == before["revision"] + 1

    @rule(item=items, done=TITLES, next_step=TITLES, author=AUTHORS)
    def summarize(self, item, done, next_step, author):
        before = self.row(item)
        service.set_summary(self.conn, item, {"done": done, "next": next_step}, author=author)
        after = self.row(item)
        assert after["summary"]
        assert after["revision"] == before["revision"] + 1

    @invariant()
    def a_state_orders_its_items_uniquely(self):
        """Two items in one state never share a position, and the order holds.

        Not contiguity. The Board era renumbered a lane on every move because
        its reorder API sent an index into that lane; the neutral views send a
        transition and no index, so a gap left by a departed item costs nothing
        and closing it would be a write nobody asked for. What still has to be
        true is that the display order is total: a repeat would make two items
        swap places between reads.
        """

        for key in self.states:
            positions = [
                row["position"]
                for row in self.conn.execute(
                    "SELECT w.position FROM work_items w"
                    " JOIN workflow_states s ON s.state_id = w.state_id"
                    " WHERE s.key = ? ORDER BY w.position",
                    (key,),
                )
            ]
            assert len(set(positions)) == len(positions), f"{key}: {positions}"
            assert positions == sorted(positions), f"{key}: {positions}"

    @invariant()
    def a_revision_never_goes_backwards(self):
        for row in self.conn.execute(
            "SELECT w.work_item_id, w.revision, s.key AS state_key FROM work_items w"
            " JOIN workflow_states s ON s.state_id = w.state_id"
        ):
            assert row["state_key"] in self.states
            previous = self.highest_revision.get(str(row["work_item_id"]), 0)
            assert row["revision"] >= previous
            self.highest_revision[str(row["work_item_id"])] = int(row["revision"])


PlanningPropertyTests = PlanningMachine.TestCase
PlanningPropertyTests.settings = machine_settings()


if __name__ == "__main__":
    unittest.main()
