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

import hashlib
import json
import os
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from unittest import mock

from server import mcp_surface, store
from server.planning import (
    api,
    calls,
    closing,
    leases,
    model,
    participation,
    person_events,
    questions,
    service,
    sweep,
)
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
        # The question the owner gets after the hold names the description.
        with mock.patch.object(leases, "utc_now", lambda: NOW + closing.CONFIRMATION_HOLD):
            sweep.run_pass(self.conn)
        [prompt] = self.conn.execute(
            "SELECT prompt FROM work_item_requests WHERE purpose = 'confirm'"
        ).fetchone()
        self.assertTrue(
            prompt.endswith("\n\nIt has no steps: check what was done against its description."),
            prompt,
        )

    def test_a_question_too_long_counts_the_lines_it_leaves_out(self) -> None:
        part = {
            "cancelled": [{"reference": f"MAIN-{n}", "reason": "x" * 90} for n in range(200)],
            "moved_out": [],
        }
        asked = closing.prompt("MAIN-3", part, ["a step"])
        text = asked.text
        self.assertLessEqual(len(text), closing.PROMPT_LIMIT)
        shown = text.count("\n- MAIN-")
        self.assertGreater(shown, 50)
        self.assertTrue(
            text.endswith(f"\n({200 - shown + 3} more line(s) not shown: see MAIN-3)"), text[-80:]
        )
        # Its key holds what the text shows: the entries that fit and how many lines did not.
        self.assertEqual("confirm_asked", asked.key)
        self.assertEqual(
            {
                "reference": "MAIN-3",
                "cancelled": part["cancelled"][:shown],
                "moved_out": [],
                "steps": [],
                "hidden": 200 - shown + 3,
            },
            asked.values,
        )


class CancelListTests(Tree):
    """Cancelling a goal or stage with open work under it, in two calls.

    The tree: under G, S1 holds a (at work, held by A), b (ready) and d (done),
    and S2, which holds c (triage); x, outside G, waits on b by a `blocks` link, and y,
    outside G too, is put off until a. The
    list and its token are what the work model's rule for a cancel says, read here from
    the store and the answer: the token's projection is built in this test from the
    contract's definition, not taken from the server.
    """

    def setUp(self) -> None:
        super().setUp()
        self.s1 = self.made("S1", "stage", self.goal)
        self.s2 = self.made("S2", "stage", self.s1)
        self.a = self.made("a", parent=self.s1)
        self.b = self.made("b", parent=self.s1)
        self.d = self.made("d", parent=self.s1)
        self.c = str(
            self.person(CREATE, space="MAIN", title="c", parent=self.s2, state="triage")[
                "reference"
            ]
        )
        self.x = self.made("x")
        self.person(APPLY, id=self.b, links=[{"other": self.x, "kind": "blocks"}])
        self.y = self.made("y")
        self.person(APPLY, id=self.y, defer={"until": self.a, "reason": "after a"})
        self.close(AS_B, self.d)
        self.agent("claim_work_item", AS_A, id=self.a)
        self.holder = str(service.get_work_item(self.conn, self.a)["claim_ref"])
        # A has read what the person did on G before it cancels it.
        self.agent("apply_work_item_changes", AS_A, id=self.goal, comment={"body": "Reading it"})

    def cancel_goal(self, **transition: object) -> dict:
        return self.agent(
            "apply_work_item_changes",
            AS_A,
            id=self.goal,
            summary={"done": "Not needed", "next": "Nothing", "why": "the plan changed"},
            transition={"state": "cancelled", "reason": "the plan changed", **transition},
        )

    def refused(self, **transition: object) -> dict:
        """The refusal's body as both surfaces send it, with nothing of the call kept."""

        with self.assertRaises(api.PlanningHttpError) as caught:
            self.cancel_goal(**transition)
        status, body = api.error_response(caught.exception)
        self.assertEqual(409, status)
        error = dict(body["error"])
        self.assertEqual("cancel_list", error["code"])
        return error

    def written(self) -> tuple:
        """What a write leaves: every item's revision, state and summary, and each trail."""

        items = self.conn.execute(
            "SELECT work_item_id, revision, state_id, summary, claim_ref FROM work_items"
            " ORDER BY work_item_id"
        ).fetchall()
        counts = [
            self.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("work_item_events", "work_item_comments", "work_item_requests")
        ]
        return tuple(tuple(row) for row in items), tuple(counts)

    def state(self, reference: str) -> str | None:
        record = service.get_work_item(self.conn, reference)
        return None if record["state"] is None else str(record["state"]["category"])

    def expected_token(self, cancels: list[dict], dependents: list[dict]) -> str:
        """The token as the contract defines it: 16 hex digits of the SHA-256 of the projection."""

        projection = {
            "cancels": sorted(
                [
                    entry["reference"],
                    entry["container_state"] if entry["state"] is None else entry["state"]["key"],
                    sorted(entry["holder"]),
                ]
                for entry in cancels
            ),
            "dependents": sorted(
                [entry["reference"], entry["waits_on"], entry["how"]] for entry in dependents
            ),
        }
        text = json.dumps(projection, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        return hashlib.sha256(text.encode("ascii")).hexdigest()[:16]

    def test_the_first_call_is_refused_with_the_list_and_writes_nothing(self) -> None:
        before = self.written()
        error = self.refused()
        self.assertEqual(before, self.written(), "the refused call wrote nothing")
        cancels = error["cancels"]
        self.assertEqual(
            [self.s1, self.s2, self.a, self.b, self.c], [entry["reference"] for entry in cancels]
        )
        by = {entry["reference"]: entry for entry in cancels}
        self.assertEqual(
            {"S1": "stage", "S2": "stage", "a": "task", "b": "task", "c": "task"},
            {entry["title"]: entry["kind"] for entry in cancels},
        )
        self.assertEqual(
            (None, "in_progress"), (by[self.s1]["state"], by[self.s1]["container_state"])
        )
        self.assertEqual(
            (None, "not_started"), (by[self.s2]["state"], by[self.s2]["container_state"])
        )
        self.assertEqual(
            {self.a: "active", self.b: "ready", self.c: "triage"},
            {ref: by[ref]["state"]["category"] for ref in (self.a, self.b, self.c)},
        )
        self.assertEqual({"key", "name", "category"}, set(by[self.a]["state"]))
        self.assertEqual([self.holder], by[self.a]["holder"])
        self.assertEqual([], by[self.b]["holder"])
        self.assertEqual(
            sorted(
                [
                    {
                        "reference": self.x,
                        "title": "x",
                        "kind": "task",
                        "waits_on": self.b,
                        "how": "blocks",
                    },
                    {
                        "reference": self.y,
                        "title": "y",
                        "kind": "task",
                        "waits_on": self.a,
                        "how": "deferred",
                    },
                ],
                key=lambda entry: entry["reference"],
            ),
            error["dependents"],
        )
        self.assertEqual(self.expected_token(cancels, error["dependents"]), error["list_token"])
        self.assertIn(error["list_token"], error["message"])
        self.assertEqual({"group": "transition", "index": 0}, error["step"])

    def test_force_does_not_carry_it_and_a_person_meets_it_too(self) -> None:
        before = self.written()
        self.refused(force=True)
        with self.assertRaises(api.PlanningHttpError) as caught:
            self.person(APPLY, id=self.goal, summary=DONE, transition={"state": "cancelled"})
        self.conn.rollback()
        self.assertEqual("cancel_list", api.error_response(caught.exception)[1]["error"]["code"])
        self.assertEqual(before, self.written())

    def test_the_second_call_with_the_token_cancels_the_list(self) -> None:
        token = self.refused()["list_token"]
        answer = self.cancel_goal(cancels=token)
        moved = answer["applied"]["transition"]
        self.assertEqual([self.s1, self.s2, self.a, self.b, self.c], moved["cancelled"])
        self.assertEqual([{"reference": self.a, "holder": self.holder}], moved["released"])
        self.assertEqual([self.x], moved["freed"])
        self.assertEqual([self.y], moved["returned"])
        for reference in (self.goal, self.s1, self.s2, self.a, self.b, self.c):
            with self.subTest(item=reference):
                self.assertEqual("cancelled", self.state(reference))
        self.assertEqual("completed", self.state(self.d))
        goal = f"cancelled with {self.goal}"
        for reference in (self.s1, self.s2, self.a, self.b, self.c):
            with self.subTest(summary=reference):
                record = service.get_work_item(self.conn, reference)
                self.assertEqual(
                    {
                        "done": f"Cancelled with {self.goal}.",
                        "next": "Nothing: the goal or stage it served was cancelled.",
                        "why": "the plan changed",
                    },
                    {name: record["summary"][name] for name in ("done", "next", "why")},
                )
                self.assertEqual("", record["claim_ref"])
                self.assertTrue(
                    [event for event in record["events"] if event["action"] == "transitioned"
                     and event["detail"].endswith(f": {goal}")],
                    "its move says it was cancelled with the goal",
                )  # fmt: skip
        self.assertEqual(self.holder, service.get_work_item(self.conn, self.a)["last_claim_ref"])
        x = service.get_work_item(self.conn, self.x)
        self.assertEqual(([self.b], []), (x["cancelled_blockers"], x["waits_for"]))
        self.assertTrue(x["open"])
        y = service.get_work_item(self.conn, self.y)
        self.assertEqual("triage", y["state"]["category"])
        self.assertEqual(
            {"because": "cancelled", "item": self.a},
            {name: y["returned"][name] for name in ("because", "item")},
        )

    def test_the_deepest_go_first_so_each_stage_closes_with_nothing_open_under_it(self) -> None:
        self.cancel_goal(cancels=self.refused()["list_token"])
        order = [
            str(row[0])
            for row in self.conn.execute(
                "SELECT i.title FROM work_item_events e JOIN work_items i"
                " ON i.work_item_id = e.work_item_id WHERE e.action = 'transitioned'"
                " AND e.detail LIKE ? ORDER BY e.id",
                (f"%: cancelled with {self.goal}",),
            )
        ]
        self.assertEqual(["c", "S2", "a", "b", "S1"], order)
        self.holds()

    def test_a_list_that_changed_is_refused_with_the_new_one(self) -> None:
        token = self.refused()["list_token"]
        e = self.made("e", parent=self.s1)
        before = self.written()
        error = self.refused(cancels=token)
        self.assertEqual(before, self.written(), "nothing was cancelled")
        self.assertIn(e, [entry["reference"] for entry in error["cancels"]])
        self.assertNotEqual(token, error["list_token"])
        self.assertIn("changed", error["message"])
        self.cancel_goal(cancels=error["list_token"])
        self.assertEqual("cancelled", self.state(e))

    def test_a_comment_and_a_new_title_leave_the_token_as_it_was(self) -> None:
        token = self.refused()["list_token"]
        self.agent(
            "apply_work_item_changes",
            AS_A,
            id=self.a,
            update={"title": "a, renamed", "description": "Now described"},
            comment={"body": "still on it"},
        )
        self.cancel_goal(cancels=token)
        self.assertEqual("cancelled", self.state(self.a))

    def test_another_holder_or_another_state_changes_the_token(self) -> None:
        token = self.refused()["list_token"]
        self.agent("claim_work_item", AS_B, id=self.a, force=True)
        held = self.refused(cancels=token)
        self.assertNotEqual(token, held["list_token"])
        self.person(APPLY, id=self.c, transition={"state": "ready"})
        moved = self.refused(cancels=held["list_token"])
        self.assertNotEqual(held["list_token"], moved["list_token"])
        self.assertEqual(
            "ready", {e["reference"]: e for e in moved["cancels"]}[self.c]["state"]["key"]
        )

    def test_cancels_goes_only_with_cancelling_a_goal_or_stage(self) -> None:
        self.agent("apply_work_item_changes", AS_A, id=self.b, comment={"body": "Reading it"})
        with self.assertRaises(api.PlanningHttpError) as caught:
            self.agent(
                "apply_work_item_changes",
                AS_A,
                id=self.b,
                summary=DONE,
                transition={"state": "cancelled", "cancels": "0123456789abcdef"},
            )
        self.assertIn("cancels goes with cancelling a goal or stage", str(caught.exception))
        self.assertEqual("ready", self.state(self.b))

    def test_work_that_cannot_be_cancelled_refuses_the_whole_cancel(self) -> None:
        workflow = service.get_work_item(self.conn, self.b)
        row = self.conn.execute(
            "SELECT workflow_id, state_id FROM work_items WHERE work_item_id = ?",
            (workflow["work_item_id"],),
        ).fetchone()
        self.conn.execute(
            "DELETE FROM workflow_transitions WHERE workflow_id = ? AND from_state_id = ?"
            " AND to_state_id IN (SELECT state_id FROM workflow_states WHERE category = 'cancelled')",
            (row[0], row[1]),
        )
        self.conn.commit()
        before = self.written()
        with self.assertRaises(api.PlanningHttpError) as caught:
            self.cancel_goal()
        self.assertIn("[transition]", str(caught.exception))
        self.assertIn(self.b, str(caught.exception))
        self.assertEqual(before, self.written())

    def test_a_summary_it_had_keeps_what_was_done(self) -> None:
        self.person(APPLY, id=self.b, summary={"done": "half done", "next": "rest"})
        reports = len(self.reports(self.b))
        self.cancel_goal(cancels=self.refused()["list_token"])
        b = service.get_work_item(self.conn, self.b)
        self.assertEqual(
            {
                "done": "half done",
                "next": f"Nothing: cancelled with {self.goal}, the goal or stage it served.",
                "why": "the plan changed",
            },
            {name: b["summary"][name] for name in ("done", "next", "why")},
        )
        kept = self.reports(self.b)
        self.assertEqual(reports + 1, len(kept), "the new summary is a new report")
        self.assertIn({"done": "half done", "next": "rest"}, [dict(r) for r in kept])
        a = service.get_work_item(self.conn, self.a)
        self.assertEqual(f"Cancelled with {self.goal}.", a["summary"]["done"])

    def reports(self, reference: str) -> list[dict]:
        return [
            {name: value for name, value in json.loads(row[0]).items() if name in ("done", "next")}
            for row in self.conn.execute(
                "SELECT report FROM work_item_comments WHERE work_item_id = ? AND report != ''"
                " ORDER BY id",
                (self.identity(reference),),
            )
        ]


class SingleCancelTests(Tree):
    def test_a_task_is_cancelled_in_one_call_and_names_what_it_freed(self) -> None:
        b = self.made("b")
        x = self.made("x")
        other = self.made("other")
        y = self.made("y")
        self.person(
            APPLY, id=b, links=[{"other": x, "kind": "blocks"}, {"other": y, "kind": "blocks"}]
        )
        self.person(APPLY, id=other, links=[{"other": y, "kind": "blocks"}])
        answer = self.cancel(b)
        self.assertEqual([x], answer["applied"]["transition"]["freed"])
        self.assertNotIn("cancelled", answer["applied"]["transition"])
        self.assertEqual([other], service.get_work_item(self.conn, y)["waits_for"])

    def test_a_goal_with_nothing_open_under_it_is_cancelled_in_one_call(self) -> None:
        a = self.made("a", parent=self.goal)
        self.cancel(a)
        answer = self.cancel(self.goal)
        self.assertNotIn("cancelled", answer["applied"]["transition"])
        self.assertFalse(service.get_work_item(self.conn, self.goal)["open"])


class Waiting(Tree):
    """G awaits confirmation: a closed by the case, b cancelled and c moved out, each with why."""

    ANSWER = "/api/planning/request/answer"
    EXPIRE = "/api/planning/request/expire"

    def setUp(self) -> None:
        super().setUp()
        self.a = self.made("a", parent=self.goal)
        self.b = self.made("b", parent=self.goal)
        self.c = self.made("c", parent=self.goal)
        self.cancel(self.b, "the owner dropped it")
        self.person(UPDATE, id=self.c, parent=self.made("H", "goal"))
        self.conn.execute(
            "UPDATE work_item_events SET detail = ? WHERE action = 'child_left'",
            (f"{self.c}: split into its own goal",),
        )
        self.conn.commit()

    def sweep(self, at: datetime = NOW) -> dict[str, int]:
        with mock.patch.object(leases, "utc_now", lambda: at):
            done = sweep.run_pass(self.conn)
        self.assertEqual(({}, [], []), (done.failures, done.busy, done.left))
        return done.changed

    def live(self, session: str, at: datetime = NOW) -> None:
        """The session was seen at `at`: live for the common quiet period of a lease after it."""

        seen = at.strftime("%Y-%m-%dT%H:%M:%SZ")
        self.conn.execute(
            "INSERT INTO sessions(id, client, last_seen) VALUES(?, 'claude', ?)"
            " ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, status = 'active'",
            (session, seen),
        )
        self.conn.commit()

    def questions(self, reference: str) -> list[dict]:
        """The confirmation questions on the item, oldest first."""

        return [
            dict(row)
            for row in self.conn.execute(
                "SELECT * FROM work_item_requests WHERE work_item_id = ? AND purpose = 'confirm'"
                " ORDER BY created_at, request_id",
                (self.identity(reference),),
            )
        ]

    def answer(self, asked: dict, given: str, note: str = "") -> dict:
        body: dict = {
            "id": asked["request_id"],
            "expected_revision": asked["revision"],
            "answers": {"answer": given},
        }
        if note:
            body["note"] = note
        return self.person(self.ANSWER, **body)

    def open_notices(self, reference: str) -> list[str]:
        """The scopes of the words waiting for the next session on the item, not yet delivered."""

        return [
            str(row[0])
            for row in self.conn.execute(
                "SELECT scope FROM work_item_waiting_notices WHERE work_item_id = ?"
                " AND delivered_call IS NULL ORDER BY notice_id",
                (self.identity(reference),),
            )
        ]

    def heard(self, answer: dict) -> list[tuple[str, list[str]]]:
        """The goal or stage a claim's answer names, with the kinds of the words it hands over."""

        return [
            (entry["reference"], [said["kind"] for said in entry["said"]])
            for entry in answer.get("waiting", [])
        ]

    def written(self) -> tuple:
        """What a refused write must leave as it was."""

        return (
            self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0],
            self.conn.execute("SELECT status, revision FROM work_item_requests").fetchall(),
            service.get_work_item(self.conn, self.goal)["revision"],
            self.rows(),
        )


class OwnerQuestionTests(Waiting):
    """G awaits with nobody working there, since a person closed the last item."""

    def setUp(self) -> None:
        super().setUp()
        self.person(APPLY, id=self.a, summary=DONE, transition={"state": "done"})
        self.assertEqual([], self.followers(self.goal))

    def test_a_pass_asks_the_owner_once_naming_what_was_cancelled_and_moved_out(self) -> None:
        self.assertEqual({sweep.CONFIRMATIONS: 1}, self.sweep())
        [asked] = self.questions(self.goal)
        self.assertEqual(
            ("question", "pending", "valkama"), (asked["kind"], asked["status"], asked["author"])
        )
        self.assertEqual(
            f"All work under {self.goal} is closed: confirm it, or leave it to the next session"
            " that takes work in this space.\n"
            f"\nCancelled:\n- {self.b}: the owner dropped it\n"
            f"\nMoved out:\n- {self.c}: split into its own goal\n"
            "\nIts steps:\n- The goal holds",
            asked["prompt"],
        )
        [field] = json.loads(asked["fields_json"])
        self.assertEqual(
            ("answer", "choice", True, ["confirm", "leave"]),
            (field["id"], field["type"], field["required"], [o["id"] for o in field["options"]]),
        )
        [(detail, author, _call, source, tool)] = self.events(self.goal, "request_created")
        self.assertEqual(
            (asked["request_id"], "valkama", "valkama", closing.QUESTION_TOOL),
            (detail, author, source, tool),
        )
        self.assertEqual(asked["request_id"], self.rows()[self.identity(self.goal)][2])
        self.assertEqual(asked["request_id"], self.confirmation(self.goal)["asked"])
        # One question in a period of waiting, however many passes follow.
        self.assertEqual({}, self.sweep())
        self.assertEqual({}, self.sweep(NOW + timedelta(days=2)))
        self.assertEqual(1, len(self.questions(self.goal)))

    def test_confirm_ticks_its_steps_writes_its_summary_and_completes_it(self) -> None:
        self.sweep()
        [asked] = self.questions(self.goal)
        answer = self.answer(asked, "confirm", note="checked against the plan")
        self.assertEqual(("answered", "completed"), (answer["status"], answer["carried_out"]))
        goal = service.get_work_item(self.conn, self.goal)
        self.assertEqual("completed", goal["state"]["category"])
        self.assertEqual(
            [(True, "user")], [(step["done"], step["done_by"]) for step in goal["checklist"]]
        )
        self.assertEqual(
            {
                "done": "Confirmed by the owner: all work under it is closed.",
                "next": "Nothing: the work under it is closed.",
                "why": "checked against the plan",
            },
            goal["summary"],
        )
        self.assertEqual("answered", self.questions(self.goal)[0]["status"])
        self.assertEqual({}, self.rows())
        self.holds()
        # Nobody worked there, and the answer that ended the wait leaves no words for
        # the next session about a goal with nothing left to confirm.
        self.assertEqual([], self.open_notices(self.goal))

    def test_a_person_filing_work_under_it_ends_the_wait_and_its_words(self) -> None:
        self.sweep()
        self.assertIn("tree", self.open_notices(self.goal), "nobody heard the last close")
        self.made("d", parent=self.goal)
        [asked] = self.questions(self.goal)
        self.assertEqual(("expired", "withdrawn"), (asked["status"], asked["expired_reason"]))
        self.assertEqual({}, self.rows())
        self.assertEqual([], self.open_notices(self.goal))

    def test_leave_leaves_it_to_the_next_session_in_the_space_and_asks_no_more(self) -> None:
        self.sweep()
        [asked] = self.questions(self.goal)
        later = NOW + timedelta(hours=2)
        with mock.patch.object(leases, "utc_now", lambda: later):
            answer = self.answer(asked, "leave")
        self.assertEqual("left_for_next_session", answer["carried_out"])
        self.assertIn("space", self.open_notices(self.goal))
        self.assertEqual(
            "2026-11-17T11:30:00Z", self.confirmation(self.goal)["left_for_next_session"]
        )
        self.assertEqual(
            "awaiting_confirmation", service.get_work_item(self.conn, self.goal)["container_state"]
        )
        self.assertEqual({}, self.sweep(NOW + timedelta(days=3)))
        self.assertEqual(1, len(self.questions(self.goal)))

    def test_a_claim_under_the_goal_hears_what_leave_left_once(self) -> None:
        """Filing and claiming a task under the goal in one call takes both rows leave left."""

        self.sweep()
        [asked] = self.questions(self.goal)
        self.answer(asked, "leave")
        self.assertEqual(["tree", "space"], self.open_notices(self.goal))
        created = self.agent(
            "create_work_item",
            AS_A,
            space="MAIN",
            title="T under the goal",
            parent=self.goal,
            claim=True,
        )
        self.assertEqual(
            [(self.goal, ["steps_edited", "awaiting_confirmation", "question_answered"])],
            self.heard(created),
        )

    def test_a_session_that_took_the_words_outside_the_goal_hears_them_once_under_it(self) -> None:
        self.sweep()
        [asked] = self.questions(self.goal)
        self.answer(asked, "leave")
        elsewhere = self.made("T outside the goal")
        # The space row starts at the leave, so the claim outside it takes that answer only.
        outside = self.agent("claim_work_item", AS_A, id=elsewhere)
        self.assertEqual([(self.goal, ["question_answered"])], self.heard(outside))
        self.assertEqual(["tree"], self.open_notices(self.goal), "the space row went to the claim")
        created = self.agent(
            "create_work_item",
            AS_A,
            space="MAIN",
            title="T under the goal",
            parent=self.goal,
            claim=True,
        )
        self.assertEqual(
            [(self.goal, ["steps_edited", "awaiting_confirmation"])],
            self.heard(created),
            "the session already had the leave's answer; the tree row's earlier words are new",
        )

    def test_a_second_session_under_the_goal_still_hears_the_tree_row(self) -> None:
        self.sweep()
        [asked] = self.questions(self.goal)
        self.answer(asked, "leave")
        self.agent("claim_work_item", AS_A, id=self.made("T outside the goal"))
        created = self.agent(
            "create_work_item",
            AS_B,
            space="MAIN",
            title="T under the goal",
            parent=self.goal,
            claim=True,
        )
        self.assertEqual(
            [(self.goal, ["steps_edited", "awaiting_confirmation", "question_answered"])],
            self.heard(created),
            "the tree row was still open for this session",
        )

    def test_an_own_variant_carries_nothing_out(self) -> None:
        self.sweep()
        [asked] = self.questions(self.goal)
        before = self.written()
        body = {"id": asked["request_id"], "expected_revision": asked["revision"]}
        with self.assertRaisesRegex(model.PlanningError, r"\[purpose\] answer is confirm or leave"):
            self.person(self.ANSWER, **body, answers={}, own={"answer": "Half of it"})
        self.conn.rollback()
        self.assertEqual(before, self.written())

    def test_the_step_records_a_wait_a_write_left_unrecorded(self) -> None:
        """A write that went around the marks: the pass records it, then asks."""

        self.conn.execute("DELETE FROM work_item_confirmations")
        self.conn.commit()
        self.assertEqual({sweep.CONFIRMATIONS: 1}, self.sweep(), "recorded and asked count once")
        self.holds()
        recorded = self.events(self.goal, "awaiting_confirmation")[-1]
        self.assertEqual(
            (f"cancelled {self.b}; moved out {self.c}", "valkama", "valkama", sweep.CONFIRMATIONS),
            (recorded[0], recorded[1], recorded[3], recorded[4]),
        )
        since, call, request, left = self.rows()[self.identity(self.goal)]
        self.assertEqual(("2026-11-17T09:30:00Z", recorded[2], None), (since, call, left))
        self.assertEqual(self.questions(self.goal)[0]["request_id"], request)
        self.assertEqual([], self.followers(self.goal), "the step subscribes nobody")
        self.assertEqual({}, self.sweep())


class HoldTests(Waiting):
    """C's subagent A closed the last item, and C stays live and says nothing."""

    def setUp(self) -> None:
        super().setUp()
        self.agent("claim_work_item", AS_A, id=self.a)
        self.close(AS_A, self.a)
        self.assertEqual([COORDINATOR], self.followers(self.goal))

    def test_the_owner_is_asked_after_a_day_and_cs_confirmation_ends_the_question(self) -> None:
        self.live(COORDINATOR, NOW + timedelta(hours=23))
        self.assertEqual({}, self.sweep(NOW + timedelta(hours=23, minutes=59)))
        self.assertEqual([], self.questions(self.goal))
        self.assertEqual({sweep.CONFIRMATIONS: 1}, self.sweep(NOW + closing.CONFIRMATION_HOLD))
        [asked] = self.questions(self.goal)
        self.confirm(AS_C, self.goal)
        self.assertEqual("done", service.get_work_item(self.conn, self.goal)["state"]["key"])
        [ended] = self.questions(self.goal)
        self.assertEqual(
            (asked["request_id"], "expired", "item_completed"),
            (ended["request_id"], ended["status"], ended["expired_reason"]),
        )
        self.assertEqual({}, self.rows())

    def test_once_nobody_is_live_the_owner_is_asked_at_once(self) -> None:
        self.live(COORDINATOR, NOW - leases.quiet_period(participation.load(self.conn), None))
        changed = self.sweep(NOW + timedelta(minutes=10))
        self.assertEqual(1, changed[sweep.CONFIRMATIONS])
        self.assertEqual(1, len(self.questions(self.goal)))


class WhoAnswersTests(Waiting):
    """No agent answers or withdraws it; the person's answer counts."""

    def setUp(self) -> None:
        super().setUp()
        self.person(APPLY, id=self.a, summary=DONE, transition={"state": "done"})
        self.sweep()
        [self.asked] = self.questions(self.goal)

    def test_agents_neither_answer_nor_withdraw_it(self) -> None:
        before = self.written()
        body = {"id": self.asked["request_id"], "expected_revision": self.asked["revision"]}
        for meta in (AS_A, AS_B):
            for tool, arguments, code in (
                (
                    "answer_work_item_request",
                    {**body, "answers": {"answer": "confirm"}},
                    "owner_only",
                ),
                ("expire_work_item_request", body, "not_asker"),
            ):
                with self.subTest(meta=meta, tool=tool):
                    with self.assertRaises(Exception) as refusal:
                        mcp_surface.run_tool_call(self.conn, tool, arguments, meta=meta)
                    self.conn.rollback()
                    status, error = api.error_response(refusal.exception)
                    self.assertEqual((403, code), (status, error["error"]["code"]))
        self.assertEqual(before, self.written())
        answer = self.answer(self.questions(self.goal)[0], "confirm")
        self.assertEqual("completed", answer["carried_out"])


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
