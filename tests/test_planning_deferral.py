"""Putting work off until a day, a time or another item's close, and its coming back.

The oracle tree: goal G, filed and so accepted by the owner; session A is a subagent of
the coordinator, B another session; the person writes through `/api/planning/`. The
clock is `leases.utc_now`, fixed at 17 November 2026, 09:30 UTC.

The expectations come from the work model's rule for deferred work: an item stands in
a deferred state for exactly as long as a condition says when it comes back, and only a
write brings it back -- the sweep's `returns` step, the take-next queue, or the close,
cancel or delete of the item it waits on -- never a read. Work under goals and stages
all accepted does not come back by itself: the owner is asked whether to do it, put it
off again or drop it, and an agent neither takes it nor moves it before the answer.

The invariant is checked against the store's own rows, by a rule written here in SQL:
the items in a state of the deferred category are exactly the items with a condition.
"""

from __future__ import annotations

import itertools
import json
import unittest
from datetime import UTC, datetime
from unittest import mock

from server import mcp_surface
from server.planning import api, deferral, leases, person_events, service, sweep
from tests.test_planning_closing import APPLY, AS_A, AS_B, DELETE, DONE, MERGE, Tree

CLAIM = "/api/planning/work-item/claim"
ANSWER = "/api/planning/request/answer"
#: The day after the fixed clock, and a moment once it has come.
TOMORROW = "2026-11-18"
CAME = datetime(2026, 11, 18, 0, 0, 1, tzinfo=UTC)
#: An hour after the fixed clock, and as the store writes it.
LATER = datetime(2026, 11, 17, 10, 30, tzinfo=UTC)
LATER_AT = "2026-11-17T10:30:00Z"
WHY = "waits for the vendor's reply"
#: The items standing in a deferred state, and the items with a condition.
DEFERRED = (
    "SELECT i.work_item_id FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
    " WHERE s.category = 'deferred'"
)
CONDITIONS = "SELECT work_item_id FROM work_item_deferrals"


class Deferral(Tree):
    # -- writes ---------------------------------------------------------------------

    def defer(
        self, reference: str, until: str = TOMORROW, reason: str = WHY, meta: object = None
    ) -> dict:
        """Put the item off: the person's write, or the agent's of `meta`."""

        entry = {"until": until, "reason": reason}
        if meta is None:
            return self.person(APPLY, id=reference, defer=entry)
        return self.agent("apply_work_item_changes", meta, id=reference, defer=entry)

    def sweep(self, at: datetime = CAME) -> dict[str, int]:
        with mock.patch.object(leases, "utc_now", lambda: at):
            done = sweep.run_pass(self.conn)
        self.assertEqual(({}, [], []), (done.failures, done.busy, done.left))
        return done.changed

    def refused(self, write: object) -> tuple[int, dict]:
        """The status and the error of a refused write, with nothing of it kept."""

        with self.assertRaises(Exception) as caught:
            write()  # type: ignore[operator]
        self.conn.rollback()
        status, body = api.error_response(caught.exception)
        return status, dict(body["error"])

    def answer(self, asked: dict, given: str, **fields: object) -> dict:
        return self.person(
            ANSWER,
            id=asked["request_id"],
            expected_revision=asked["revision"],
            answers={"answer": given, **fields},
        )

    # -- reads ----------------------------------------------------------------------

    def category(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["state"]["category"])

    def basis(self, reference: str) -> str | None:
        found = self.conn.execute(
            "SELECT acceptance FROM work_items WHERE work_item_id = ?", (self.identity(reference),)
        ).fetchone()
        return None if found[0] is None else str(found[0])

    def condition(self, reference: str) -> tuple | None:
        found = self.conn.execute(
            "SELECT until_at, until_item_id, reason, call_id, since, reached_at"
            " FROM work_item_deferrals WHERE work_item_id = ?",
            (self.identity(reference),),
        ).fetchone()
        return None if found is None else tuple(found)

    def holds(self) -> None:
        """A condition stands for exactly the items in a deferred state, and each reads so."""

        deferred = {str(row[0]) for row in self.conn.execute(DEFERRED)}
        self.assertEqual(deferred, {str(row[0]) for row in self.conn.execute(CONDITIONS)})
        for identity in deferred:
            self.assertIn("deferred", service.get_work_item(self.conn, identity))

    def returns(self, reference: str) -> list[dict]:
        """The questions whether to take the item up again, oldest first."""

        return [
            dict(row)
            for row in self.conn.execute(
                "SELECT * FROM work_item_requests WHERE work_item_id = ? AND purpose = 'return'"
                " ORDER BY created_at, request_id",
                (self.identity(reference),),
            )
        ]

    def written(self) -> tuple:
        """What a refused write and a read must leave as they were."""

        return (
            tuple(
                tuple(row)
                for row in self.conn.execute(
                    "SELECT work_item_id, revision, state_id, claim_ref, checklist FROM work_items"
                    " ORDER BY work_item_id"
                )
            ),
            self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0],
            tuple(tuple(row) for row in self.conn.execute(CONDITIONS)),
            tuple(
                tuple(row)
                for row in self.conn.execute(
                    "SELECT request_id, status, revision FROM work_item_requests"
                    " ORDER BY request_id"
                )
            ),
        )

    def came_back(self, reference: str, because: str, detail: str) -> None:
        """The item came back to triage in one call of Valkama's own, saying why."""

        self.assertEqual("triage", self.category(reference))
        self.assertIsNone(self.condition(reference))
        [returned] = self.events(reference, "returned")
        self.assertEqual(
            (detail, "valkama", "valkama", "deferral-return"), returned[:2] + returned[3:]
        )
        moved = self.events(reference, "transitioned")[-1]
        self.assertEqual(
            (f"triage: returned, {detail}", returned[2]), (moved[0], moved[2]), "one call"
        )
        record = service.get_work_item(self.conn, reference)
        [at] = [event["at"] for event in record["events"] if event["action"] == "returned"]
        item = None if because in ("date", "comments") else detail.partition(" ")[2]
        self.assertEqual({"because": because, "item": item, "at": at}, record["returned"])
        self.assertNotIn("deferred", record)
        self.holds()


class PuttingOffTests(Deferral):
    def test_it_waits_deferred_with_no_basis_no_claim_and_no_place_in_the_queue(
        self,
    ) -> None:
        t = self.made("t", steps=["Look"])
        self.person(APPLY, id=t, transition={"state": "ready"})
        self.assertEqual("owner", self.basis(t))
        step = service.get_work_item(self.conn, t)["checklist"][0]["id"]
        self.agent("claim_work_item", AS_B, id=t)
        self.agent("claim_work_item_checklist_item", AS_B, id=t, item_id=step)
        answer = self.defer(t, meta=AS_B)
        moved = answer["applied"]["defer"]
        self.assertEqual(
            ("deferred", "2026-11-18T00:00:00Z"), (moved["state"], moved["deferred"]["until"])
        )
        record = service.get_work_item(self.conn, t)
        self.assertEqual("deferred", record["state"]["category"])
        self.assertEqual((None, ""), (record["acceptance"], record["claim_ref"]))
        self.assertEqual("", record["checklist"][0]["claimed_by"])
        self.assertEqual(
            {
                "until": "2026-11-18T00:00:00Z",
                "until_item": None,
                "until_comments": None,
                "reason": WHY,
                "since": "2026-11-17T09:30:00Z",
                "reached_at": None,
            },
            {name: value for name, value in record["deferred"].items() if name != "by"},
        )
        self.assertEqual(AS_B["sessionId"], record["deferred"]["by"]["session_id"])
        self.assertIsNone(service.claim_ready_work_item(self.conn, space="MAIN"))
        self.conn.rollback()
        self.holds()

    def test_each_condition_that_could_never_come_is_refused(self) -> None:
        t = self.made("t", parent=self.made("S1", "stage", self.goal))
        closed = self.made("x")
        self.cancel(closed)
        before = self.written()
        for entry, says in (
            ({"reason": WHY}, "[deferral] defer needs until"),
            ({"until": "2026-11-16", "reason": WHY}, "[deferral] 2026-11-16 has come already"),
            ({"until": "2026-11-17T08:00:00Z", "reason": WHY}, "has come already"),
            ({"until": "2026-11-31", "reason": WHY}, "is no day of the calendar"),
            ({"until": "2026-12-01T09:00:00", "reason": WHY}, "names no zone"),
            (
                {"until": "soon", "reason": WHY},
                "[deferral] until soon is no day, time, count of comments or work item",
            ),
            ({"until": t, "reason": WHY}, f"[deferral] {t} cannot wait on itself"),
            ({"until": self.goal, "reason": WHY}, f"[deferral] {t} stands under {self.goal}"),
            ({"until": closed, "reason": WHY}, f"[deferral] {closed} is closed already"),
            ({"until": TOMORROW}, "[deferral] defer needs reason"),
            ({"until": TOMORROW, "reason": " "}, "[deferral] defer needs reason"),
        ):
            with self.subTest(defer=entry):
                status, error = self.refused(
                    lambda entry=entry: self.person(APPLY, id=t, defer=entry)
                )
                self.assertEqual((400, "invalid_request"), (status, error["code"]))
                self.assertIn(says, error["message"])
        self.assertEqual(before, self.written(), "nothing of a refused put-off was kept")
        for force in (False, True):
            with self.subTest(move_with_force=force):
                status, error = self.refused(
                    lambda force=force: self.agent(
                        "apply_work_item_changes",
                        AS_B,
                        id=t,
                        transition={"state": "deferred", "force": force},
                    )
                )
                self.assertEqual((409, "workflow_guard"), (status, error["code"]))
                self.assertIn(
                    f"[deferred] {t} is put off with defer, which names the day or item it comes"
                    " back on, not by a move",
                    error["message"],
                )
        self.assertEqual(before, self.written())
        # The refusal names the write that passes.
        self.defer(t, meta=AS_B)
        self.assertEqual("deferred", self.category(t))
        self.holds()

    def test_a_put_off_is_one_change_of_state_in_its_batch(self) -> None:
        t = self.made("t")
        status, error = self.refused(
            lambda: self.person(
                APPLY,
                id=t,
                defer={"until": TOMORROW, "reason": WHY},
                transition={"state": "ready"},
            )
        )
        self.assertEqual(400, status)
        self.assertIn("transition and defer each change the state", error["message"])

    def test_putting_it_off_again_replaces_the_condition(self) -> None:
        t = self.made("t")
        x = self.made("x")
        self.defer(t)
        self.defer(t, until=x, reason="after x")
        until_at, until_item, reason, _call, _since, reached = self.condition(t) or ()
        self.assertEqual(
            (None, self.identity(x), "after x", None), (until_at, until_item, reason, reached)
        )
        self.assertEqual(x, service.get_work_item(self.conn, t)["deferred"]["until_item"])
        self.holds()

    def test_a_time_is_read_in_its_zone(self) -> None:
        t = self.made("t")
        self.defer(t, until="2026-11-18T09:00:00+03:00")
        self.assertEqual("2026-11-18T06:00:00Z", (self.condition(t) or ())[0])

    def test_a_goal_is_put_off_with_its_work_left_to_whoever_holds_it(self) -> None:
        a = self.made("a", parent=self.goal)
        self.agent("claim_work_item", AS_A, id=a)
        holder = service.get_work_item(self.conn, a)["claim_ref"]
        for meta in (AS_B, None):
            with self.subTest(by="agent B" if meta else "person"):
                if meta is not None:
                    status, error = self.refused(
                        lambda: self.person(APPLY, id=self.goal, defer={"until": TOMORROW})
                    )
                    self.assertEqual(400, status)
                    self.assertIn("[deferral] defer needs reason", error["message"])
                self.defer(self.goal, reason="the budget comes in December", meta=meta)
                record = service.get_work_item(self.conn, self.goal)
                self.assertEqual("deferred", record["state"]["category"])
                self.assertIsNone(record["acceptance"])
                work = service.get_work_item(self.conn, a)
                self.assertEqual(("active", holder), (work["state"]["category"], work["claim_ref"]))
                self.assertIn("ancestor_deferred", work["withheld"])
                detail, _author, call, source, _tool = self.events(self.goal, "transitioned")[-1]
                self.assertEqual("deferred: until 2026-11-18: the budget comes in December", detail)
                session = self.conn.execute(
                    "SELECT session_id FROM execution_events WHERE id = ?", (call,)
                ).fetchone()[0]
                self.assertEqual(record["deferred"]["by"]["session_id"], session)
                self.assertEqual("the budget comes in December", record["deferred"]["reason"])
                if meta is not None:
                    self.assertEqual(AS_B["sessionId"], session)
                else:
                    self.assertEqual(("browser", None), (source, session))
                    self.assertEqual("user", record["deferred"]["by"]["author"])
                self.holds()
                # The next run starts from the goal accepted again.
                self.person(APPLY, id=self.goal, transition={"state": "ready"})
                self.holds()


class ComingBackTests(Deferral):
    def test_a_pass_after_the_day_brings_it_back_once(self) -> None:
        t = self.made("t")
        self.defer(t)
        self.assertEqual({}, self.sweep(datetime(2026, 11, 17, 23, 59, 59, tzinfo=UTC)))
        self.assertEqual({sweep.RETURNS: 1}, self.sweep())
        self.came_back(t, "date", "date 2026-11-18")
        before = self.written()
        self.assertEqual({}, self.sweep(), "a second pass has nothing to do")
        self.assertEqual(before, self.written())

    def test_the_close_of_the_item_it_waits_on_brings_it_back_in_that_write(self) -> None:
        x = self.made("x")
        t = self.made("t")
        self.defer(t, until=x)
        answer = self.close(AS_A, x)
        self.assertEqual([t], answer["applied"]["transition"]["returned"])
        self.came_back(t, "completed", f"completed {x}")

    def test_a_cancel_brings_it_back_alone_and_by_its_goals_cascade(self) -> None:
        x = self.made("x")
        t = self.made("t")
        self.defer(t, until=x)
        self.cancel(x, "not needed")
        self.came_back(t, "cancelled", f"cancelled {x}")
        h = self.made("H", "goal")
        y = self.made("y", parent=self.made("S", "stage", h))
        u = self.made("u")
        self.defer(u, until=y)

        def cancel(**more: object) -> dict:
            return self.person(
                APPLY,
                id=h,
                summary={"done": "Not needed", "next": "Nothing"},
                transition={"state": "cancelled", **more},
            )

        status, error = self.refused(cancel)
        self.assertEqual((409, "cancel_list"), (status, error["code"]))
        self.assertIn(
            {"reference": u, "title": "u", "kind": "task", "waits_on": y, "how": "deferred"},
            error["dependents"],
        )
        answer = cancel(cancels=error["list_token"])
        self.assertEqual([u], answer["applied"]["transition"]["returned"])
        self.came_back(u, "cancelled", f"cancelled {y}")

    def test_a_merge_passes_the_wait_to_the_item_it_merged_into(self) -> None:
        x = self.made("x")
        z = self.made("z")
        t = self.made("t")
        self.defer(t, until=x)
        self.person(MERGE, id=z, items=[x], reason="one change")
        self.assertEqual("deferred", self.category(t), "the merged item's close waits for z")
        self.assertEqual(self.identity(z), (self.condition(t) or ())[1])
        self.assertEqual(z, service.get_work_item(self.conn, t)["deferred"]["until_item"])
        self.person(APPLY, id=z, summary=DONE, transition={"state": "done"})
        self.came_back(t, "completed", f"completed {z}")

    def test_a_delete_brings_it_back_as_if_it_closed(self) -> None:
        x = self.made("x")
        t = self.made("t")
        self.defer(t, until=x)
        answer = self.person(DELETE, id=x)
        self.assertEqual([t], answer["returned"])
        self.came_back(t, "deleted", f"deleted {x}")

    def test_the_take_next_queue_brings_back_what_came_due_in_its_space(self) -> None:
        t = self.made("t")
        self.defer(t)
        with mock.patch.object(leases, "utc_now", lambda: CAME):
            self.assertIsNone(service.claim_ready_work_item(self.conn, space="MAIN"))
        self.conn.commit()
        self.came_back(t, "date", "date 2026-11-18")

    def test_the_return_is_one_call_whose_entry_into_triage_the_blocked_item_reads(
        self,
    ) -> None:
        x = self.made("x")
        t = self.made("t")
        y = self.made("y")
        self.person(APPLY, id=t, links=[{"other": y, "kind": "blocks"}])
        self.defer(t, until=x)
        self.person(APPLY, id=x, summary=DONE, transition={"state": "done"})
        self.came_back(t, "completed", f"completed {x}")
        [returned] = self.events(t, "returned")
        number = int(t.rpartition("-")[2])
        entries = [
            row
            for row in self.conn.execute(
                person_events._BLOCKER_CHANGES, (person_events.OPENED, self.identity(y), 0)
            )
            if row[1] == number and row[5] == returned[2]
        ]
        self.assertEqual([("Triage", 1)], [(row[3], row[12]) for row in entries])
        # The item it blocks hears it as it hears each record Valkama writes in a call
        # of its own: Valkama's, and a change short of a close.
        told = [
            (entry["kind"], entry["via"], entry["blocker"], entry["state"])
            for call, entry in person_events.blocker_changes(self.conn, self.identity(y), 0)
            if call == returned[2]
        ]
        self.assertEqual([("blocker_changed", "valkama", t, "Triage")], told)


class ReadTests(Deferral):
    def test_a_read_after_the_day_finds_it_put_off_and_writes_nothing(self) -> None:
        t = self.made("t")
        self.defer(t)
        before = self.written()
        with mock.patch.object(leases, "utc_now", lambda: CAME):
            record = service.get_work_item(self.conn, t)
            found = api.handle_get(self.conn, "/api/planning/work-item", {"id": [t]})
            card = mcp_surface.call_tool(self.conn, "get_work_item", {"id": t}, meta=AS_B)
        self.conn.commit()
        assert found is not None and isinstance(card, dict)
        self.assertEqual("deferred", record["state"]["category"])
        self.assertEqual("deferred", found[1]["work_item"]["state"]["category"])
        self.assertEqual(
            {
                "until": "2026-11-18T00:00:00Z",
                "until_item": None,
                "until_comments": None,
                "reached_at": None,
            },
            card["deferred"],
        )
        self.assertEqual(before, self.written(), "a read brings nothing back")
        self.holds()


class OwnerQuestionTests(Deferral):
    """Under goals and stages all accepted, the owner decides."""

    def setUp(self) -> None:
        super().setUp()
        self.t = self.made("t", parent=self.goal, steps=["Look"])
        self.defer(self.t)
        self.assertEqual({sweep.RETURNS: 1}, self.sweep())
        [self.asked] = self.returns(self.t)

    def test_the_pass_asks_once_and_the_item_stays_put_off(self) -> None:
        self.assertEqual("deferred", self.category(self.t))
        self.assertEqual("2026-11-18T00:00:01Z", (self.condition(self.t) or ())[5])
        self.assertEqual(("pending", "valkama"), (self.asked["status"], self.asked["author"]))
        self.assertEqual(
            f"{self.t} was put off until 2026-11-18; that has come. Do it, put it off again,"
            " or drop it.",
            self.asked["prompt"],
        )
        self.assertEqual(
            "2026-11-18T00:00:01Z",
            service.get_work_item(self.conn, self.t)["deferred"]["reached_at"],
        )
        self.assertEqual({}, self.sweep(), "asked once")
        self.holds()

    def test_do_takes_it_up_on_the_basis_its_goal_gives(self) -> None:
        answer = self.answer(self.asked, "do")
        self.assertEqual("ready", answer["carried_out"])
        self.assertEqual(("ready", "inherited"), (self.category(self.t), self.basis(self.t)))
        self.assertEqual("answered", self.returns(self.t)[0]["status"])
        self.holds()

    def test_later_puts_it_off_again_until_the_day_it_names(self) -> None:
        before = self.condition(self.t) or ()
        answer = self.answer(self.asked, "later", until="2026-12-01")
        self.assertEqual("deferred", answer["carried_out"])
        until_at, until_item, reason, call, since, reached = self.condition(self.t) or ()
        self.assertEqual(
            ("2026-12-01T00:00:00Z", None, WHY, before[4], None),
            (until_at, until_item, reason, since, reached),
        )
        self.assertNotEqual(before[3], call, "the answer's call set it")
        self.assertEqual("deferred", self.category(self.t))
        self.assertEqual({}, self.sweep(), "not come yet")
        self.holds()

    def test_later_names_the_day(self) -> None:
        before = self.written()
        status, error = self.refused(lambda: self.answer(self.asked, "later"))
        self.assertEqual(400, status)
        self.assertIn("until", error["message"])
        self.assertEqual(before, self.written())

    def test_drop_cancels_it(self) -> None:
        answer = self.answer(self.asked, "drop")
        self.assertEqual("cancelled", answer["carried_out"])
        record = service.get_work_item(self.conn, self.t)
        self.assertEqual("cancelled", record["state"]["category"])
        self.assertEqual(
            "Nothing: the owner dropped it when it came back.", record["summary"]["next"]
        )
        self.holds()

    def test_an_agent_neither_takes_it_nor_moves_it_but_to_cancelled(self) -> None:
        step = service.get_work_item(self.conn, self.t)["checklist"][0]["id"]
        before = self.written()
        for name, write in (
            ("claim", lambda: self.agent("claim_work_item", AS_A, id=self.t)),
            ("forced claim", lambda: self.agent("claim_work_item", AS_A, id=self.t, force=True)),
            (
                "step claim",
                lambda: self.agent("claim_work_item_checklist_item", AS_A, id=self.t, item_id=step),
            ),
            (
                "move to ready",
                lambda: self.agent(
                    "apply_work_item_changes",
                    AS_A,
                    id=self.t,
                    transition={"state": "ready", "acceptance": "assignment"},
                ),
            ),
            (
                "forced move to ready",
                lambda: self.agent(
                    "apply_work_item_changes",
                    AS_A,
                    id=self.t,
                    transition={"state": "ready", "acceptance": "assignment", "force": True},
                ),
            ),
            (
                "putting it off again",
                lambda: self.agent(
                    "apply_work_item_changes",
                    AS_A,
                    id=self.t,
                    defer={"until": "2026-12-01", "reason": WHY},
                ),
            ),
        ):
            with self.subTest(write=name):
                status, error = self.refused(write)
                self.assertEqual((409, "workflow_guard"), (status, error["code"]))
                self.assertIn(
                    f"[acceptance_question] the owner has not decided whether {self.t} is to be"
                    f" done (question {self.asked['request_id']})",
                    error["message"],
                )
        self.assertEqual(before, self.written(), "nothing written, the question still open")

    def test_a_persons_claim_is_their_answer(self) -> None:
        self.person(CLAIM, id=self.t)
        # Taken by the person, it is accepted by the one order of bases every way in
        # follows: the goals all accepted over it give it, as a do answer does.
        self.assertEqual(("active", "inherited"), (self.category(self.t), self.basis(self.t)))
        self.assertIsNone(self.condition(self.t))
        [asked] = self.returns(self.t)
        self.assertEqual(("expired", "withdrawn"), (asked["status"], asked["expired_reason"]))
        self.holds()

    def test_an_agents_cancel_passes_and_ends_the_question(self) -> None:
        # A has read what the person did on it before it cancels it.
        self.agent("apply_work_item_changes", AS_A, id=self.t, comment={"body": "Reading it"})
        self.agent(
            "apply_work_item_changes",
            AS_A,
            id=self.t,
            summary={"done": "Nothing", "next": "Nothing", "why": "dropped"},
            transition={"state": "cancelled"},
        )
        self.assertEqual("cancelled", self.category(self.t))
        [asked] = self.returns(self.t)
        self.assertEqual(("expired", "item_cancelled"), (asked["status"], asked["expired_reason"]))
        self.holds()

    def test_no_agent_answers_or_withdraws_it(self) -> None:
        before = self.written()
        body = {"id": self.asked["request_id"], "expected_revision": self.asked["revision"]}
        for meta in (AS_A, AS_B):
            for tool, arguments, code in (
                ("answer_work_item_request", {**body, "answers": {"answer": "do"}}, "owner_only"),
                ("expire_work_item_request", body, "not_asker"),
            ):
                with self.subTest(meta=meta, tool=tool):
                    status, error = self.refused(
                        lambda tool=tool, arguments=arguments, meta=meta: mcp_surface.run_tool_call(
                            self.conn, tool, arguments, meta=meta
                        )
                    )
                    self.assertEqual((403, code), (status, error["code"]))
        self.assertEqual(before, self.written())
        self.assertEqual("ready", self.answer(self.asked, "do")["carried_out"])

    def test_a_merge_into_work_not_put_off_withdraws_the_question(self) -> None:
        # B works on the item the put-off one turns out to duplicate.
        s = self.made("s", parent=self.goal, steps=["Work"])
        self.agent("claim_work_item", AS_B, id=s)
        self.person(MERGE, id=s, items=[self.t], reason="one change", force=True)
        # The question asked about work put off: on work under way it asks about nothing.
        [asked] = self.returns(s)
        self.assertEqual(
            (self.asked["request_id"], "expired", "withdrawn"),
            (asked["request_id"], asked["status"], asked["expired_reason"]),
        )
        self.assertIn(
            asked["request_id"], [event[0] for event in self.events(self.t, "request_expired")]
        )
        self.assertEqual("active", self.category(s))
        self.assertTrue(service.get_work_item(self.conn, s)["claim_ref"])
        self.holds()

    def test_a_merge_into_work_put_off_moves_the_question_that_waits(self) -> None:
        d = self.made("d", parent=self.goal, steps=["Work"])
        self.defer(d)
        self.person(MERGE, id=d, items=[self.t], reason="one change")
        [asked] = self.returns(d)
        self.assertEqual(
            (self.asked["request_id"], "pending"), (asked["request_id"], asked["status"])
        )
        self.assertEqual("ready", self.answer(asked, "do")["carried_out"])
        self.assertEqual(("ready", "inherited"), (self.category(d), self.basis(d)))
        self.holds()


class AwaitedItemTests(Deferral):
    """Work under an accepted goal waits on an item that closes, closes again or goes.

    The condition names that item, and the store lets the item go only once no
    condition names it; the owner is asked once, when the condition first comes.
    """

    def setUp(self) -> None:
        super().setUp()
        self.x = self.made("x")
        self.t = self.made("t", parent=self.goal)
        self.defer(self.t, until=self.x)

    def at(self, moment: datetime, write: object) -> dict:
        with mock.patch.object(leases, "utc_now", lambda: moment):
            return write()  # type: ignore[operator,no-any-return]

    def waits_on(self) -> tuple:
        """The moment, the item and when it came, as the condition of t holds them."""

        until_at, until_item, _reason, _call, _since, reached = self.condition(self.t) or ()
        return until_at, until_item, reached

    def test_deleted_open_it_asks_the_owner_and_keeps_the_moment_in_its_place(self) -> None:
        answer = self.at(LATER, lambda: self.person(DELETE, id=self.x))
        self.assertEqual([self.t], answer["returned"])
        self.assertEqual("deferred", self.category(self.t))
        self.assertEqual((LATER_AT, None, LATER_AT), self.waits_on())
        self.assertEqual(["pending"], [row["status"] for row in self.returns(self.t)])
        self.holds()

    def test_closed_again_or_deleted_after_the_owner_was_asked_it_asks_nothing_new(
        self,
    ) -> None:
        self.person(APPLY, id=self.x, summary=DONE, transition={"state": "done"})
        [asked] = self.returns(self.t)
        came = "2026-11-17T09:30:00Z"
        self.assertEqual((None, self.identity(self.x), came), self.waits_on())
        self.at(LATER, lambda: self.person(APPLY, id=self.x, transition={"state": "triage"}))
        self.at(LATER, lambda: self.cancel(self.x))
        self.assertEqual((None, self.identity(self.x), came), self.waits_on())
        answer = self.at(LATER, lambda: self.person(DELETE, id=self.x))
        self.assertNotIn("returned", answer, "nothing came back by the delete")
        self.assertEqual((came, None, came), self.waits_on())
        self.assertEqual(
            [(asked["request_id"], "pending")],
            [(row["request_id"], row["status"]) for row in self.returns(self.t)],
        )
        self.assertEqual("ready", self.answer(asked, "do")["carried_out"])
        self.holds()

    def test_deleted_itself_while_asked_it_takes_its_condition_and_question_along(
        self,
    ) -> None:
        self.person(APPLY, id=self.x, summary=DONE, transition={"state": "done"})
        identity = self.identity(self.t)
        self.person(DELETE, id=self.t)
        for table in ("work_item_deferrals", "work_item_requests"):
            with self.subTest(table=table):
                found = self.conn.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE work_item_id = ?",
                    (identity,),
                ).fetchone()[0]
                self.assertEqual(0, found)
        self.holds()


class ClaimTests(Deferral):
    def test_a_claim_by_number_takes_it_out_with_its_condition(self) -> None:
        t = self.made("t")
        self.defer(t)
        answer = self.agent("claim_work_item", AS_A, id=t)
        self.assertEqual({"from": "deferred", "to": "dev"}, answer["started"])
        self.assertEqual("active", self.category(t))
        self.assertIsNone(self.condition(t))
        self.holds()


class InvariantTests(Deferral):
    def test_a_condition_stands_exactly_while_its_item_is_put_off_after_each_write(self) -> None:
        s1 = self.made("S1", "stage", self.goal)
        a = self.made("a", parent=s1, steps=["Look"])
        x = self.made("x")
        t = self.made("t")
        u = self.made("u", parent=self.goal)
        writes = (
            ("t until x", lambda: self.defer(t, until=x)),
            ("u until tomorrow", lambda: self.defer(u, meta=AS_B)),
            ("S1 put off", lambda: self.defer(s1, meta=AS_A)),
            ("t until tomorrow", lambda: self.defer(t)),
            ("t until x again", lambda: self.defer(t, until=x)),
            ("a claimed under S1", lambda: self.agent("claim_work_item", AS_A, id=a)),
            ("the pass after the day", lambda: self.sweep()),
            ("S1 accepted again", lambda: self.person(APPLY, id=s1, transition={"state": "ready"})),
            ("x closed", lambda: self.close(AS_B, x)),
            ("u taken by the person", lambda: self.person(CLAIM, id=u)),
            ("t put off again", lambda: self.defer(t, until="2026-12-01")),
            ("t cancelled", lambda: self.cancel(t)),
            ("a moved to triage", lambda: self.person(APPLY, id=a, transition={"state": "triage"})),
            ("a put off", lambda: self.defer(a, until="2026-12-01")),
            ("a moved to ready", lambda: self.person(APPLY, id=a, transition={"state": "ready"})),
        )
        for name, write in writes:
            with self.subTest(after=name):
                write()
                self.holds()
        self.assertEqual(
            {"t": "cancelled", "u": "active", "S1": None, "a": "ready", "x": "completed"},
            {
                title: (
                    None
                    if service.get_work_item(self.conn, reference)["state"] is None
                    else self.category(reference)
                )
                for title, reference in (("t", t), ("u", u), ("S1", s1), ("a", a), ("x", x))
            },
        )


class CommentCountTests(Deferral):
    """Work put off until a count of new comments, alone or with a day, whichever first.

    The owner's rule: every comment and reply written on the item after it was put off
    counts, a person's or an agent's; a count and a day bring it back on whichever comes
    first. A comment that reaches the count brings the work back in its own write, and
    the sweep reads every count again, so no comment is missed and none asks twice.
    """

    def say(self, reference: str, body: str = "News", meta: object = None, **more: object) -> int:
        """A comment on the item, the person's or the agent's of `meta`; its id."""

        entry = {"body": body, **more}
        if meta is None:
            self.person(APPLY, id=reference, comment=entry)
        else:
            self.agent("apply_work_item_changes", meta, id=reference, comment=entry)
        return int(
            self.conn.execute(
                "SELECT MAX(id) FROM work_item_comments WHERE work_item_id = ?",
                (self.identity(reference),),
            ).fetchone()[0]
        )

    def counted(self, reference: str) -> tuple:
        """The count and where it started, as the condition of the item holds them."""

        found = self.conn.execute(
            "SELECT until_comments, comments_after FROM work_item_deferrals WHERE work_item_id = ?",
            (self.identity(reference),),
        ).fetchone()
        return () if found is None else tuple(found)

    def test_a_persons_and_an_agents_comments_and_replies_count_from_the_put_off(self) -> None:
        t = self.made("t")
        before = self.say(t, "Written before the put-off")
        self.defer(t, until="3 comments")
        self.assertEqual((3, before), self.counted(t))
        self.assertEqual(
            {"until": None, "until_item": None, "until_comments": 3, "reached_at": None},
            {
                name: value
                for name, value in service.get_work_item(self.conn, t)["deferred"].items()
                if name in ("until", "until_item", "until_comments", "reached_at")
            },
        )
        root = self.say(t, "The person asks")
        self.say(t, "The agent answers", meta=AS_B, reply_to=root)
        self.assertEqual("deferred", self.category(t), "two of three")
        self.assertEqual({}, self.sweep(), "the sweep finds nothing come either")
        self.say(t, "The person replies", reply_to=root)
        self.came_back(t, "comments", "comments 3")

    def test_one_comment_brings_it_back_in_the_write_of_that_comment(self) -> None:
        t = self.made("t")
        self.defer(t, until="1 comment", meta=AS_B)
        self.say(t, meta=AS_A)
        self.came_back(t, "comments", "comments 1")

    def test_a_count_or_a_day_comes_back_on_the_count_when_it_comes_first(self) -> None:
        for until in (f"{TOMORROW} or 2 comments", f"2 comments or {TOMORROW}"):
            with self.subTest(until=until):
                t = self.made("t")
                self.defer(t, until=until)
                self.assertEqual(
                    ("2026-11-18T00:00:00Z", None), (self.condition(t) or ())[:2], "the day"
                )
                self.assertEqual(2, self.counted(t)[0])
                self.say(t)
                self.say(t, meta=AS_B)
                self.came_back(t, "comments", "comments 2")

    def test_a_count_or_a_day_comes_back_on_the_day_when_it_comes_first(self) -> None:
        t = self.made("t")
        self.defer(t, until=f"2 comments or {TOMORROW}")
        self.say(t)
        self.assertEqual({sweep.RETURNS: 1}, self.sweep())
        self.came_back(t, "date", "date 2026-11-18")

    def test_a_count_reached_after_the_day_passed_unread_comes_back_on_the_day(self) -> None:
        """The day passed before the comment, though no pass read it yet: it came first."""

        t = self.made("t")
        self.defer(t, until=f"{TOMORROW} or 1 comment")
        with mock.patch.object(leases, "utc_now", lambda: CAME):
            self.say(t)
        self.came_back(t, "date", "date 2026-11-18")

    def test_the_sweep_counts_a_comment_whose_write_did_not_ask(self) -> None:
        """A comment the store holds by another path than the service's write -- an older
        writer, a restore -- is counted by the next pass."""

        t = self.made("t")
        self.defer(t, until="1 comment")
        self.conn.execute(
            "INSERT INTO work_item_comments(work_item_id, author, body) VALUES(?, 'agent', 'x')",
            (self.identity(t),),
        )
        self.conn.commit()
        self.assertEqual("deferred", self.category(t))
        self.assertEqual({sweep.RETURNS: 1}, self.sweep(LATER))
        self.came_back(t, "comments", "comments 1")

    def test_under_accepted_goals_it_asks_once_however_many_comments_follow(self) -> None:
        t = self.made("t", parent=self.goal)
        self.defer(t, until="2 comments")
        self.say(t)
        self.say(t, meta=AS_B)
        [asked] = self.returns(t)
        self.assertEqual("deferred", self.category(t))
        self.assertEqual(
            f"{t} was put off until 2 new comments; that has come. Do it, put it off again,"
            " or drop it.",
            asked["prompt"],
        )
        self.assertEqual(
            ("put_off_came", {"reference": t, "until": None, "item": None, "comments": 2}),
            (asked["prompt_key"], json.loads(asked["prompt_values"])),
        )
        self.assertEqual(
            "2026-11-17T09:30:00Z", service.get_work_item(self.conn, t)["deferred"]["reached_at"]
        )
        before = self.written()
        self.say(t, "A third")
        self.say(t, "A fourth", meta=AS_B)
        self.assertEqual({}, self.sweep(), "asked once")
        self.assertEqual([asked["request_id"]], [row["request_id"] for row in self.returns(t)])
        self.assertEqual(before[0], self.written()[0], "no item changed")
        self.holds()

    def test_later_counts_the_new_comments_from_the_answer(self) -> None:
        t = self.made("t", parent=self.goal)
        self.defer(t)
        self.assertEqual({sweep.RETURNS: 1}, self.sweep())
        [asked] = self.returns(t)
        since = (self.condition(t) or ())[4]
        last = self.say(t, "Before the answer")
        answer = self.answer(asked, "later", until="2 comments")
        self.assertEqual("deferred", answer["carried_out"])
        until_at, until_item, reason, _call, kept, reached = self.condition(t) or ()
        self.assertEqual(
            (None, None, WHY, since, None), (until_at, until_item, reason, kept, reached)
        )
        self.assertEqual((2, last), self.counted(t), "the count starts with the answer")
        self.say(t)
        self.assertEqual(1, len(self.returns(t)), "one of two")
        self.say(t, meta=AS_B)
        first, second = self.returns(t)
        self.assertEqual(("answered", "pending"), (first["status"], second["status"]))
        self.assertEqual(2, json.loads(second["prompt_values"])["comments"])
        self.holds()

    def test_later_takes_a_count_or_a_day(self) -> None:
        t = self.made("t", parent=self.goal)
        self.defer(t)
        self.sweep()
        [asked] = self.returns(t)
        self.answer(asked, "later", until="2026-12-01 or 5 comments")
        self.assertEqual(("2026-12-01T00:00:00Z", None), (self.condition(t) or ())[:2])
        self.assertEqual(5, self.counted(t)[0])

    def test_a_put_back_after_a_failed_launch_keeps_where_the_count_started(self) -> None:
        t = self.made("t")
        self.defer(t, until="2 comments")
        start = self.counted(t)
        identity = self.identity(t)
        kept = deferral.held(self.conn, identity)
        assert kept is not None
        deferral.clear(self.conn, identity)
        self.say(t)
        deferral.restore(self.conn, identity, kept)
        self.assertEqual(start, self.counted(t))

    def test_each_count_that_names_no_condition_is_refused(self) -> None:
        t = self.made("t")
        x = self.made("x")
        before = self.written()
        for until, says in (
            ("0 comments", "[deferral] 0 comments is no count: count 1 to 999 new comments"),
            ("1000 comments", "[deferral] 1000 comments is no count"),
            (
                f"3 comments or {x}",
                f"[deferral] until 3 comments or {x}: a count of comments goes with a day or a"
                " time, not with an item",
            ),
            (f"{TOMORROW} or 2026-11-19", "is no condition: join one count and one day or time"),
            ("3 comments or 4 comments", "is no condition"),
            (f"{TOMORROW} or 3 comments or 4 comments", "is no condition"),
            ("2026-11-16 or 3 comments", "[deferral] 2026-11-16 has come already"),
            ("three comments", "is no day, time, count of comments or work item"),
        ):
            with self.subTest(until=until):
                status, error = self.refused(
                    lambda until=until: self.person(
                        APPLY, id=t, defer={"until": until, "reason": WHY}
                    )
                )
                self.assertEqual((400, "invalid_request"), (status, error["code"]))
                self.assertIn(says, error["message"])
        self.assertEqual(before, self.written(), "nothing of a refused put-off was kept")
        # The same refusal stands in the owner's answer `later`.
        g = self.made("g", parent=self.goal)
        self.defer(g)
        self.sweep()
        [asked] = self.returns(g)
        status, error = self.refused(lambda: self.answer(asked, "later", until="0 comments"))
        self.assertEqual(400, status)
        self.assertIn("[deferral] 0 comments is no count", error["message"])
        self.assertEqual("pending", self.returns(g)[0]["status"])


#: The conditions a comment brings in the cases of `OneCallTests`: the condition, the
#: comments written since the put-off, and the clock of the call that comments.
BROUGHT = (("1 comment", 0, LATER), ("3 comments", 2, LATER), (TOMORROW, 0, CAME))


class OneCallTests(Deferral):
    """A comment that brings put-off work's condition, and a move of the work, in one call.

    The call is one write, and its own move decides where the work stands: taken up,
    closed or put off anew, the condition that move ends or replaces brings nothing
    back -- no return to triage on the way, and no question to the owner, asked and
    ended in the same write or left standing to refuse the move. A comment with no
    move still brings the work back, as the write ends. Each case runs for a count the
    comment reaches (one comment, the last of three) and for a day already passed that
    no pass read yet; for one comment and for two (`comments`); for the person and for
    an agent; and for work under no goal and under the accepted goal G.
    """

    def write(self, who: str, **payload: object) -> dict:
        if who == "person":
            return self.person(APPLY, **payload)
        return self.agent("apply_work_item_changes", AS_A, **payload)

    def put_off(self, until: str, before: int, who: str, under: bool) -> str:
        """An item `who` put off until `until`, with `before` comments of theirs since."""

        t = self.made("t", parent=self.goal if under else None)
        self.defer(t, until=until, meta=None if who == "person" else AS_A)
        for _ in range(before):
            self.write(who, id=t, comment={"body": "Not yet"})
        return t

    def in_one_call(self, change: dict, expected: str, *, agent: bool = True) -> list[str]:
        """Comment and `change` in one call for every case; each item ends in `expected`
        with nothing brought back. `agent=False` leaves out the agent's alone; answers
        the items."""

        made = []
        for until, before, at in BROUGHT:
            for form in ("comment", "comments"):
                for who, under in itertools.product(("person", "agent"), (False, True)):
                    if who == "agent" and not under and not agent:
                        continue
                    with self.subTest(until=until, form=form, who=who, under=under):
                        t = self.put_off(until, before, who, under)
                        said = {"body": "It tips"}
                        sent = said if form == "comment" else [said, {"body": "And more"}]
                        with mock.patch.object(leases, "utc_now", lambda at=at: at):
                            self.write(who, id=t, **{form: sent}, **change)
                        moves = [event[0] for event in self.events(t, "transitioned")]
                        self.assertEqual(
                            (expected, [], [], False),
                            (
                                self.category(t),
                                self.events(t, "returned"),
                                self.returns(t),
                                any(move.startswith("triage") for move in moves),
                            ),
                            "nothing came back, and the owner was asked nothing",
                        )
                        self.holds()
                        made.append(t)
        return made

    def test_taking_the_work_up_in_the_call_of_the_comment(self) -> None:
        self.in_one_call({"transition": {"state": "ready", "acceptance": "assignment"}}, "ready")
        self.in_one_call({"claim": True}, "active")

    def test_cancelling_the_work_in_the_call_of_the_comment(self) -> None:
        dropped = {"done": "Nothing", "next": "Nothing", "why": "not needed"}
        self.in_one_call({"summary": dropped, "transition": {"state": "cancelled"}}, "cancelled")

    def test_completing_the_work_in_the_call_of_the_comment(self) -> None:
        """An agent completes no work that is not accepted, which a comment does not
        change: alone, the item is completed by the person only."""

        self.in_one_call(
            {"summary": DONE, "transition": {"state": "done"}}, "completed", agent=False
        )

    def test_putting_it_off_again_in_the_call_of_the_comment(self) -> None:
        made = self.in_one_call(
            {"defer": {"until": "2026-12-01", "reason": "Still waits"}}, "deferred"
        )
        found = {
            tuple(row)
            for row in self.conn.execute(
                "SELECT until_at, until_comments, until_item_id, reason, reached_at"
                " FROM work_item_deferrals WHERE work_item_id IN (SELECT value FROM json_each(?))",
                (json.dumps([self.identity(t) for t in made]),),
            )
        }
        self.assertEqual(24, len(made))
        self.assertEqual({("2026-12-01T00:00:00Z", None, None, "Still waits", None)}, found)

    def test_a_comment_with_no_move_brings_it_back_as_the_write_ends(self) -> None:
        t = self.put_off("1 comment", 0, "person", False)
        self.person(
            APPLY,
            id=t,
            comment={"body": "It tips"},
            refs=[{"kind": "url", "value": "https://example.com/reply"}],
        )
        self.came_back(t, "comments", "comments 1")
        u = self.put_off("2 comments", 0, "agent", False)
        self.write("agent", id=u, comments=[{"body": "One"}, {"body": "Two"}, {"body": "Three"}])
        self.came_back(u, "comments", "comments 2")


if __name__ == "__main__":
    unittest.main()
