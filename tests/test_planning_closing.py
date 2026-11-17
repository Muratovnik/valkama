"""A goal or stage closes when nothing under it is open, and waits for confirmation then.

The oracle tree: goal G, filed and so accepted by the owner, holds stage S1, which
holds stage S2, and the tasks each case names. Session A is a subagent of the
coordinator C; B is another session; the person writes through `/api/planning/`.

The expectations come from the work model's rules for a container: it may not be
completed while anything under it is open, at any depth, and `force` does not carry
that; the write that closes the last open item under it is the moment it comes to
await confirmation, which a row of `work_item_confirmations` records for exactly as
long as it lasts; Valkama says so on the container in a call of its own, naming what
was cancelled and what moved out, and the coordinator of the agent that closed it
follows the container; reopening or filing work under it ends the wait and the
question that asked to confirm it.

The invariant is checked against the store's own rows, by a rule written here in SQL
apart from `item_tree`: an accepted open container with children, or one that left,
and none of them open.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import UTC, datetime
from unittest import mock

from server import mcp_surface, store
from server.planning import api, calls, closing, leases, person_events, questions, service
from tests.test_hooks_tree_notices import AS_C, C, Harness

COORDINATOR = C
AS_A = {"sessionId": COORDINATOR, "threadId": "0a000000-0000-4000-8000-00000000000a"}
AS_B = {"sessionId": "0b000000-0000-4000-8000-00000000000b"}
CREATE = "/api/planning/work-items"
APPLY = "/api/planning/work-item/apply"
UPDATE = "/api/planning/work-item/update"
DELETE = "/api/planning/work-item/delete"
MERGE = "/api/planning/work-item/merge"
DONE = {"done": "Done as asked", "next": "Nothing"}
NOW = datetime(2026, 11, 17, 9, 30, tzinfo=UTC)

#: The containers that await confirmation, by the work model's rule, read straight from
#: the store: accepted and open, it had children, and none of them is open.
AWAITING = """
SELECT g.work_item_id FROM work_items g JOIN workflow_states gs ON gs.state_id = g.state_id
WHERE g.kind = 'container' AND gs.category = 'container'
AND (EXISTS (SELECT 1 FROM work_items c WHERE c.parent_id = g.work_item_id)
     OR EXISTS (SELECT 1 FROM work_item_events e
                WHERE e.work_item_id = g.work_item_id AND e.action = 'child_left'))
AND NOT EXISTS (SELECT 1 FROM work_items c JOIN workflow_states cs ON cs.state_id = c.state_id
                WHERE c.parent_id = g.work_item_id AND cs.category NOT IN ('completed', 'cancelled'))
"""


class Tree(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        clock = mock.patch.object(leases, "utc_now", lambda: NOW)
        clock.start()
        self.addCleanup(clock.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Crew", key="MAIN")
        self.conn.commit()
        self.goal = self.made("G", "goal", steps=["The goal holds"])

    # -- writes ---------------------------------------------------------------------

    def person(self, path: str, **payload: object) -> dict:
        with calls.bind(calls.browser(), path):
            answer = api.handle_post(self.conn, path, payload)
        self.conn.commit()
        assert answer is not None
        return answer[1]

    def agent(self, tool: str, meta: object, **arguments: object) -> dict:
        try:
            answer = mcp_surface.call_tool(self.conn, tool, arguments, meta=meta)
        except BaseException:
            self.conn.rollback()
            raise
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def made(
        self,
        title: str,
        kind: str = "task",
        parent: str | None = None,
        steps: list[str] | None = None,
    ) -> str:
        payload: dict = {"space": "MAIN", "title": title, "kind": kind}
        if parent is not None:
            payload["parent"] = parent
        reference = str(self.person(CREATE, **payload)["reference"])
        if steps:
            self.person(APPLY, id=reference, checklist=steps)
        return reference

    def close(self, meta: object, reference: str) -> dict:
        """The agent takes the task in one call and completes it in the next."""

        self.agent("claim_work_item", meta, id=reference)
        return self.agent(
            "apply_work_item_changes",
            meta,
            id=reference,
            summary=DONE,
            transition={"state": "done"},
        )

    def cancel(self, reference: str, reason: str = "") -> dict:
        return self.person(
            APPLY,
            id=reference,
            summary={"done": "Not needed", "next": "Nothing", "why": "covered elsewhere"},
            transition={"state": "cancelled", "reason": reason},
        )

    def confirm(self, meta: object, reference: str) -> dict:
        """Read what the person did there, then tick every step, summarize and complete it."""

        self.agent("apply_work_item_changes", meta, id=reference, comment={"body": "Checking it"})
        steps = service.get_work_item(self.conn, reference)["checklist"]
        return self.agent(
            "apply_work_item_changes",
            meta,
            id=reference,
            checklist_ticks=[{"item_id": step["id"]} for step in steps if not step["done"]],
            summary={"done": "Everything under it is closed", "next": "Nothing"},
            transition={"state": "done"},
        )

    # -- reads ----------------------------------------------------------------------

    def identity(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["work_item_id"])

    def rows(self) -> dict[str, tuple]:
        return {
            str(row[0]): tuple(row[1:])
            for row in self.conn.execute(
                "SELECT work_item_id, since, call_id, request_id, left_at"
                " FROM work_item_confirmations"
            )
        }

    def holds(self) -> None:
        """A row stands for exactly the containers that await confirmation, and each reads so."""

        expected = {str(row[0]) for row in self.conn.execute(AWAITING)}
        self.assertEqual(expected, set(self.rows()), "row <=> awaiting confirmation")
        for identity in expected:
            self.assertEqual(
                "awaiting_confirmation",
                service.get_work_item(self.conn, identity)["container_state"],
            )

    def events(self, reference: str, action: str) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute(
                "SELECT e.detail, e.author, e.call_id, c.identity_source, c.tool FROM"
                " work_item_events e JOIN execution_events c ON c.id = e.call_id"
                " WHERE e.work_item_id = ? AND e.action = ? ORDER BY e.id",
                (self.identity(reference), action),
            )
        ]

    def followers(self, reference: str) -> list[str]:
        return [
            str(row[0])
            for row in self.conn.execute(
                "SELECT session_id FROM work_item_subscriptions WHERE work_item_id = ?"
                " AND follows = 1",
                (self.identity(reference),),
            )
        ]

    def confirmation(self, reference: str) -> dict:
        answer = api.handle_get(self.conn, "/api/planning/work-item", {"id": [reference]})
        assert answer is not None
        return dict(answer[1]["work_item"]["confirmation"])


class InvariantTests(Tree):
    def test_a_row_stands_exactly_while_its_container_awaits_confirmation(self) -> None:
        """The oracle tree driven through its writes, the invariant read after each."""

        self.holds()
        a = self.made("a", parent=self.goal)
        self.holds()
        self.agent("claim_work_item", AS_A, id=a)
        self.holds()
        # A goal with open work under it is not completed, forced or not.
        for force in (False, True):
            with self.assertRaisesRegex(api.PlanningHttpError, r"\[children\]"):
                self.confirm_forced(self.goal, force)
            self.holds()
        b = self.made("b", parent=self.goal)
        self.cancel(b, "the owner dropped it")
        self.holds()
        h = self.made("H", "goal")
        c = self.made("c", parent=self.goal)
        self.person(UPDATE, id=c, parent=h)
        self.holds()
        # The last open item under G closes.
        self.close(AS_A, a)
        self.holds()
        self.assertIn(self.identity(self.goal), self.rows())
        # Reopened, and closed again; then work filed under it, and deleted.
        self.person(APPLY, id=a, transition={"state": "ready"})
        self.holds()
        self.assertEqual({}, self.rows())
        self.close(AS_A, a)
        self.holds()
        d = self.made("d", parent=self.goal)
        self.holds()
        self.person(DELETE, id=d)
        self.holds()
        # A merge closes the merged item as the cancelled duplicate of the survivor.
        e = self.made("e", parent=self.goal)
        f = self.made("f", parent=self.goal)
        self.person(MERGE, id=e, items=[f])
        self.holds()
        self.cancel(e, "not needed")
        self.holds()
        # The coordinator confirms; reopened, it awaits again.
        self.confirm(AS_C, self.goal)
        self.holds()
        self.assertEqual({}, self.rows())
        self.person(APPLY, id=self.goal, transition={"state": "ready"})
        self.holds()
        self.assertIn(self.identity(self.goal), self.rows())
        # A stage confirmed is a change under the stage or goal over it.
        s1 = self.made("S1", "stage", self.goal)
        self.holds()
        s2 = self.made("S2", "stage", s1)
        t = self.made("t", parent=s2)
        self.holds()
        self.close(AS_A, t)
        self.holds()
        self.confirm(AS_C, s2)
        self.holds()
        self.confirm(AS_C, s1)
        self.holds()
        self.confirm(AS_C, self.goal)
        self.holds()
        self.assertEqual({}, self.rows())

    def confirm_forced(self, reference: str, force: bool) -> None:
        self.agent(
            "apply_work_item_changes",
            AS_C,
            id=reference,
            summary={"done": "Done", "next": "Nothing"},
            transition={"state": "done", "force": force},
        )


class ChildrenTests(Tree):
    def test_a_container_with_open_work_under_it_at_any_depth_is_not_completed(self) -> None:
        """Nor is one whose open item stands under a closed stage, in triage or deferred."""

        stage = self.made("S1", "stage", self.goal)
        a = self.made("a", parent=stage)
        for force in (False, True):
            with self.subTest(force=force):
                with self.assertRaises(api.PlanningHttpError) as caught:
                    self.agent(
                        "apply_work_item_changes",
                        AS_C,
                        id=self.goal,
                        summary=DONE,
                        transition={"state": "done", "force": force},
                    )
                message = str(caught.exception)
                self.assertIn("[children]", message)
                self.assertIn(a, message, "the open task under the stage is named")
                self.assertIn(stage, message)
        self.assertTrue(service.get_work_item(self.conn, self.goal)["open"])

    def test_the_refusal_names_five_and_counts_the_rest(self) -> None:
        under = [self.made(f"t{number}", parent=self.goal) for number in range(7)]
        with self.assertRaises(api.PlanningHttpError) as caught:
            self.person(APPLY, id=self.goal, summary=DONE, transition={"state": "done"})
        self.conn.rollback()
        message = str(caught.exception)
        for reference in under[:5]:
            self.assertIn(reference, message)
        self.assertNotIn(under[5], message)
        self.assertIn("and 2 more", message)


class EnteringTests(Tree):
    def setUp(self) -> None:
        super().setUp()
        self.a = self.made("a", parent=self.goal)
        self.b = self.made("b", parent=self.goal)
        self.c = self.made("c", parent=self.goal)
        self.cancel(self.b, "the owner dropped it")
        self.h = self.made("H", "goal")
        self.person(UPDATE, id=self.c, parent=self.h)
        # The reason a move out gives, as it is recorded on the container it left.
        self.conn.execute(
            "UPDATE work_item_events SET detail = ? WHERE action = 'child_left'",
            (f"{self.c}: split into its own goal",),
        )
        self.conn.commit()
        self.agent("claim_work_item", AS_A, id=self.a)

    def test_closing_the_last_open_item_records_the_wait_in_the_same_write(self) -> None:
        answer = self.close(AS_A, self.a)
        self.assertEqual([self.goal], answer["awaiting_confirmation"])
        goal = service.get_work_item(self.conn, self.goal)
        self.assertEqual("awaiting_confirmation", goal["container_state"])
        [(detail, author, call, source, tool)] = self.events(self.goal, "awaiting_confirmation")
        self.assertEqual(f"cancelled {self.b}; moved out {self.c}", detail)
        self.assertEqual(("valkama", "valkama", closing.EVENT_TOOL), (author, source, tool))
        closed = self.events(self.a, "transitioned")[-1]
        self.assertNotEqual(closed[2], call, "the record is Valkama's own call, not A's")
        self.assertEqual(
            {self.identity(self.goal): ("2026-11-17T09:30:00Z", call, None, None)}, self.rows()
        )
        self.assertEqual([COORDINATOR], self.followers(self.goal), "C follows G, not its subagent")
        self.assertEqual(
            {
                "since": "2026-11-17T09:30:00Z",
                "steps": 1,
                "cancelled": [{"reference": self.b, "reason": "the owner dropped it"}],
                "moved_out": [{"reference": self.c, "reason": "split into its own goal"}],
                "asked": None,
                "left_for_next_session": None,
            },
            self.confirmation(self.goal),
        )
        self.assertIn("awaiting_confirmation", person_events.SERVER_ASKS)
        self.assertEqual("awaiting_confirmation", person_events.KINDS["awaiting_confirmation"])

    def test_the_coordinator_confirms_by_completing_it(self) -> None:
        self.close(AS_A, self.a)
        answer = self.confirm(AS_C, self.goal)
        self.assertEqual("done", answer["state"]["key"])
        self.assertNotIn("awaiting_confirmation", answer)
        self.assertEqual({}, self.rows())

    def asked(self) -> str:
        """A question to confirm G, as the server asks it, recorded on G's row."""

        goal = self.identity(self.goal)
        with calls.bind(calls.valkama(), "confirmation-question"):
            asked = questions.ask(
                self.conn,
                goal,
                kind="question",
                prompt="Confirm it?",
                fields=[],
                author="valkama",
                purpose="confirm",
            )
        self.conn.execute(
            "UPDATE work_item_confirmations SET request_id = ? WHERE work_item_id = ?",
            (asked, goal),
        )
        self.conn.commit()
        return asked

    def ended(self, asked: str) -> None:
        self.assertNotEqual(
            "awaiting_confirmation", service.get_work_item(self.conn, self.goal)["container_state"]
        )
        self.assertEqual({}, self.rows())
        status, reason = self.conn.execute(
            "SELECT status, expired_reason FROM work_item_requests WHERE request_id = ?", (asked,)
        ).fetchone()
        self.assertEqual(("expired", "withdrawn"), (status, reason))
        self.assertEqual(asked, self.events(self.goal, "request_expired")[-1][0])

    def test_the_last_item_reopened_ends_the_wait_and_its_question(self) -> None:
        """The wait's row goes, and the question to confirm ends withdrawn."""

        self.close(AS_A, self.a)
        asked = self.asked()
        self.person(APPLY, id=self.a, transition={"state": "ready"})
        self.ended(asked)

    def test_work_filed_under_it_ends_the_wait_and_its_question(self) -> None:
        self.close(AS_A, self.a)
        asked = self.asked()
        self.made("new", parent=self.goal)
        self.ended(asked)

    def test_a_person_closing_it_subscribes_nobody(self) -> None:
        self.person(APPLY, id=self.a, summary=DONE, transition={"state": "done"})
        self.assertEqual([], self.followers(self.goal))
        self.assertIn(self.identity(self.goal), self.rows())

    def test_what_did_not_fit_the_detail_is_counted(self) -> None:
        part = {
            "steps": 0,
            "cancelled": [{"reference": f"MAIN-{n}", "reason": None} for n in range(1000, 1100)],
            "moved_out": [{"reference": "MAIN-7", "reason": None}],
        }
        text = closing.detail(part)
        self.assertLessEqual(len(text), closing.DETAIL_LIMIT)
        self.assertTrue(text.endswith("; moved out 1 more; " + closing.NO_STEPS), text)
        named, _and, hidden = text.split(";")[0].removeprefix("cancelled ").partition(" and ")
        self.assertEqual(100, len(named.split(", ")) + int(hidden.removesuffix(" more")))
        self.assertGreater(len(named.split(", ")), 30, "as many as fit are named")


class StagesTests(Tree):
    def test_a_confirmed_stage_brings_the_one_over_it_to_wait(self) -> None:
        s1 = self.made("S1", "stage", self.goal, steps=["S1 holds"])
        s2 = self.made("S2", "stage", s1)
        t = self.made("t", parent=s2)
        self.assertEqual([s2], self.close(AS_A, t)["awaiting_confirmation"])
        self.assertEqual([s1], self.confirm(AS_C, s2)["awaiting_confirmation"])
        self.assertNotIn(self.identity(self.goal), self.rows())
        self.assertEqual([self.goal], self.confirm(AS_C, s1)["awaiting_confirmation"])
        self.assertEqual({self.identity(self.goal)}, set(self.rows()))


class NoStepsTests(Tree):
    def test_a_container_without_steps_is_checked_against_its_description(self) -> None:
        goal = self.made("Bare", "goal")
        a = self.made("a", parent=goal)
        self.close(AS_A, a)
        [(detail, *_rest)] = self.events(goal, "awaiting_confirmation")
        self.assertTrue(detail.endswith("no steps: check it against its description"), detail)
        self.assertEqual("no steps: check it against its description", detail)
        self.assertEqual(0, self.confirmation(goal)["steps"])


class WakeTests(Harness):
    """The record wakes whoever works there: Valkama's own, of a kind that asks."""

    def test_the_coordinator_hears_its_subagents_last_close_as_a_record_that_asks(self) -> None:
        subagent = {"sessionId": C, "threadId": "0c000000-0000-4000-8000-0000000000c1"}
        self.settle(C)
        self.agent("claim_work_item", subagent, id=self.u)
        self.close(subagent, self.u)
        found = person_events.valkama_since(self.conn, self.identity(self.h), 0)
        asking = [entry for _call, entry in found if entry["kind"] == "awaiting_confirmation"]
        self.assertEqual([True], [entry.get("asks") for entry in asking])
        continued = self.hook(C, "stop")
        assert continued is not None, "C's turn goes on with what asks for it"
        self.assertIn("awaiting_confirmation", continued)
        self.assertIn("a record of Valkama's here asks for this session", continued)

    def identity(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["work_item_id"])


if __name__ == "__main__":
    unittest.main()
