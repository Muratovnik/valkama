"""What Valkama records on its own account reaches the work it touches, as Valkama's.

The tree of `test_hooks_tree_notices`: goal G holds stage S1 with tasks T1 and T3 and
stage S2 with task T2, and goal H holds task U. F holds T3 and then goes quiet past its
lease; A holds a step of T3 through its subagent a2; B holds T2 under the same goal; C
holds U under H. The sweep releases F's lapsed claim in a call of Valkama's own.

The expectations come from the hook contract: a record Valkama makes in a call of its
own is told as `by Valkama`, in the block that is not the person's, to whoever hears the
item whole, to a recipient that held it at its last read once more, and through the tree
to whoever works under the goal. It wakes nobody unless its kind is one that asks for a
session (`person_events.SERVER_ASKS`, empty for now), and then it wakes as a person's act
does. A write the server makes inside an agent's call is that agent's.
"""

from __future__ import annotations

import json
import re
import unittest
from unittest import mock

from server.hooks import notify
from server.planning import leases, person_events, service
from tests.test_hooks_tree_notices import (
    AS_A2,
    AS_B,
    AS_C,
    AS_F,
    FROM_AGENTS,
    A,
    B,
    C,
    F,
    Harness,
)

N = "09000000-0000-4000-8000-000000000009"
AS_N = {"sessionId": N}
#: The line of F's lapsed claim, as the sweep records its release.
RELEASED = re.compile(rf"\n- released at \S+ by Valkama: «[^»]*session {F}\)»")
WOKE_FOR_VALKAMA = "it came now because a record of Valkama's here asks for this session."


class Lapsed(Harness):
    def setUp(self) -> None:
        super().setUp()
        answer = self.agent(
            "apply_work_item_changes", AS_F, id=self.t3, claim=True, checklist=["Check it"]
        )
        step = answer["applied"]["checklist"][0]["item_id"]
        self.agent("claim_work_item_checklist_item", AS_A2, id=self.t3, item_id=step)
        self.agent("claim_work_item", AS_B, id=self.t2)
        self.agent("claim_work_item", AS_C, id=self.u)
        self.settle(A, B, C, F)

    def quiet(self, session: str) -> None:
        """The session last seen past its lease: nobody is behind its claim any more."""

        self.conn.execute(
            "UPDATE sessions SET last_seen = ? WHERE id = ?",
            (
                (leases.utc_now() - leases.QUIET_PERIOD).strftime("%Y-%m-%dT%H:%M:%SZ"),
                session,
            ),
        )
        self.conn.commit()

    def sweep(self) -> None:
        self.quiet(F)
        self.assertEqual(1, service.expire_leases(self.conn), "F's claim of T3 lapsed")
        self.conn.commit()


class ReleasedBySweepTests(Lapsed):
    def test_a_lease_that_ran_out_reaches_the_holder_the_one_that_held_and_the_goal(self) -> None:
        self.sweep()
        self.assertIsNone(self.hook(B, "stop"), "Valkama's release continues no turn")
        self.assertEqual((0, ""), self.watch(B, alive=1.0), "and wakes nothing")
        for session, line in (
            (B, self.line(self.t3, self.goal)),
            (A, self.line(self.t3)),
            (F, self.line(self.t3)),
        ):
            with self.subTest(session=session):
                told = self.hook(session)
                assert told is not None, f"{session} hears Valkama's release of T3"
                self.assertTrue(told.startswith(FROM_AGENTS), told)
                self.assertIn(f"\n{line}\n", told)
                self.assertEqual(1, len(RELEASED.findall(told)), told)
                self.assertNotIn("a person acted", told)
                self.assertNotIn(WOKE_FOR_VALKAMA, told)
                self.assertIsNone(self.hook(session), "once")
        self.assertIsNone(self.hook(C), "C works under H only")

    def test_the_person_sees_what_valkama_recorded(self) -> None:
        self.sweep()
        raw = notify.deliver("claude", "post-tool-use", {"session_id": B}, self.environ)
        assert raw is not None
        answer = json.loads(raw)
        language = "ru" if "Valkama передала" in answer["systemMessage"] else "en"
        whose = notify._SHOWN[language]["valkama"]
        self.assertIn(f"{whose} ", answer["systemMessage"])
        told = [("MAIN-3", "T3", {"kind": "released", "via": "valkama", "at": "t"})]
        self.assertEqual(
            "Valkama told the agent what Valkama recorded on MAIN-3 «T3»", notify.shown(told, "en")
        )
        self.assertEqual(
            "Valkama передала агенту запись Valkama по задаче MAIN-3 «T3»",
            notify.shown(told, "ru"),
        )


class AskingRecordTests(Lapsed):
    """The same release, as if its kind were one that asks for a session."""

    def setUp(self) -> None:
        super().setUp()
        patch = mock.patch.object(person_events, "SERVER_ASKS", frozenset({"released"}))
        patch.start()
        self.addCleanup(patch.stop)

    def test_it_wakes_the_goal_and_continues_the_holders_turn_once(self) -> None:
        self.sweep()
        continued = self.hook(A, "stop")
        assert continued is not None, "A's turn goes on with what asks for it"
        self.assertEqual(1, len(RELEASED.findall(continued)), continued)
        self.assertIn(WOKE_FOR_VALKAMA, continued)
        self.assertNotIn("another agent's news asks", continued)
        self.assertIsNone(self.hook(A), "A is told once")
        status, text = self.watch(B)
        self.assertEqual(notify.WAKE_STATUS, status, "B works under the goal and is woken")
        self.assertIn(f"\n{self.line(self.t3, self.goal)}\n", text)
        self.assertEqual(1, len(RELEASED.findall(text)), text)
        self.assertIn(WOKE_FOR_VALKAMA, text)
        self.assertIsNone(self.hook(B), "B is told once")
        self.assertIsNone(self.hook(C), "C works under H only")

    def test_the_hourly_limit_of_other_sessions_wakes_does_not_hold_it_back(self) -> None:
        with mock.patch.object(notify, "MOST_WAKES", 0):
            self.sweep()
            status, text = self.watch(B)
            self.assertEqual(notify.WAKE_STATUS, status, text)
            self.assertNotIn("would have woken", text)
            continued = self.hook(A, "stop")
            self.assertEqual(1, len(RELEASED.findall(continued or "")), continued)


class WhoseRecordTests(Lapsed):
    def calls_of(self, reference: str, action: str) -> list[tuple[str, str | None]]:
        return [
            (str(row[0]), row[1])
            for row in self.conn.execute(
                "SELECT c.identity_source, c.session_id FROM work_item_events e"
                " JOIN execution_events c ON c.id = e.call_id"
                " JOIN work_items w ON w.work_item_id = e.work_item_id"
                " WHERE w.number = ? AND e.action = ? ORDER BY e.id",
                (int(reference.rsplit("-", 1)[1]), action),
            )
        ]

    def test_a_release_met_by_a_claim_is_valkamas_and_the_claim_is_the_callers(self) -> None:
        """N takes T3 by number past F's lease: the release is Valkama's own call inside N's."""

        self.quiet(F)
        self.agent("claim_work_item", AS_N, id=self.t3)
        self.assertEqual([("valkama", None)], self.calls_of(self.t3, "released"))
        self.assertEqual(N, self.calls_of(self.t3, "claimed")[-1][1], "the claim is N's")
        told = self.hook(B)
        assert told is not None
        self.assertEqual(1, len(RELEASED.findall(told)), told)

    def test_what_the_server_writes_inside_an_agents_call_is_that_agents(self) -> None:
        """B lets T2 go: the server moves it back to the queue in B's own call."""

        self.agent("claim_work_item", AS_B, id=self.t2, release=True)
        self.assertEqual(B, self.calls_of(self.t2, "transitioned")[-1][1], "B's call wrote it")
        told = self.hook(A)
        assert told is not None, "A works under the goal and hears where T2 stands"
        self.assertRegex(told, rf"\n- status at \S+ by session {B}: «")
        self.assertNotIn("by Valkama", told)


if __name__ == "__main__":
    unittest.main()
