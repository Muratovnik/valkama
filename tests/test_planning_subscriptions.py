"""A session follows an item it does not hold, mutes one it holds, and lets both go.

These drive the write the way an agent makes it, through `apply_work_item_changes`
with a proved session, and read back what the card will draw from: who follows the
item. What a subscription makes the hook tell is in `test_hooks_agent_notices`.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import housekeeping, mcp_surface, store
from server.planning import api, calls, model, service, subscriptions

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
CHILD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
OTHER = "019a3c2e-7777-7c11-9e0f-2f4b6d8a1c3e"
ORCHESTRATOR = {"sessionId": SESSION}
SUBAGENT = {"sessionId": SESSION, "threadId": CHILD}
ELSEWHERE = {"sessionId": OTHER}


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.space = service.create_planning_space(self.conn, project_id="p", name="Crew")
        self.ref = self.item("Watched")
        self.conn.commit()

    def item(self, title: str) -> str:
        return str(
            service.create_work_item(self.conn, space=self.space["key"], title=title)["reference"]
        )

    def agent(self, tool: str, meta: object = ORCHESTRATOR, **arguments: object) -> dict:
        answer = mcp_surface.run_tool_call(self.conn, tool, arguments, meta=meta)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def subscribe(
        self, follows: object, meta: object = ORCHESTRATOR, ref: str | None = None
    ) -> str:
        answer = self.agent("apply_work_item_changes", meta, id=ref or self.ref, subscribe=follows)
        return str(answer["applied"]["subscribe"])

    def refused(self, meta: object, **groups: object) -> dict:
        with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught:
            mcp_surface.run_tool_call(
                self.conn, "apply_work_item_changes", {"id": self.ref, **groups}, meta=meta
            )
        self.conn.rollback()
        error = api.error_response(caught.exception)[1]["error"]
        assert isinstance(error, dict)
        return error

    def followers(self, ref: str | None = None) -> list[dict]:
        return service.get_work_item(self.conn, ref or self.ref)["subscribers"]

    def rows(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute(
                "SELECT session_id, agent_id, follows FROM work_item_subscriptions"
                " ORDER BY session_id, agent_id"
            )
        ]


class WriteTests(Harness):
    def test_a_subscription_is_listed_with_its_session_client_agent_and_time(self) -> None:
        before = service.get_work_item(self.conn, self.ref)
        self.assertEqual([], before["subscribers"])
        self.assertEqual(subscriptions.FOLLOWING, self.subscribe(True))
        self.assertEqual(subscriptions.FOLLOWING, self.subscribe(True, SUBAGENT))
        [mine, child] = self.followers()
        self.assertEqual(
            ({"session": SESSION, "client": "codex", "agent": None}, CHILD),
            ({key: mine[key] for key in ("session", "client", "agent")}, child["agent"]),
        )
        self.assertRegex(mine["since"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        after = service.get_work_item(self.conn, self.ref)
        self.assertEqual(
            (before["revision"], len(before["events"])),
            (after["revision"], len(after["events"])),
            "not a change to the item: no revision, no event",
        )

    def test_asking_again_writes_nothing_and_another_session_stands_apart(self) -> None:
        self.subscribe(True)
        self.conn.execute("UPDATE work_item_subscriptions SET created_at = '2026-01-01T00:00:00Z'")
        self.conn.commit()
        self.subscribe(True)
        self.assertEqual("2026-01-01T00:00:00Z", self.followers()[0]["since"])
        self.subscribe(True, ELSEWHERE)
        self.assertEqual([SESSION, OTHER], [entry["session"] for entry in self.followers()])

    def test_false_forgets_an_item_not_held_and_mutes_one_held(self) -> None:
        self.subscribe(True)
        self.assertEqual(subscriptions.NOT_FOLLOWING, self.subscribe(False))
        self.assertEqual([], self.rows())
        self.agent("claim_work_item", id=self.ref)
        self.assertEqual(subscriptions.MUTED, self.subscribe(False))
        self.assertEqual([(SESSION, "", 0)], self.rows())
        self.assertEqual([], self.followers(), "a mute is not a subscriber")
        self.assertEqual(subscriptions.FOLLOWING, self.subscribe(True), "a mute is lifted")
        self.assertEqual([(SESSION, "", 1)], self.rows())

    def test_a_subagent_mutes_only_what_it_holds_itself(self) -> None:
        self.agent("set_work_item_checklist", id=self.ref, items=["one"])
        step = service.get_work_item(self.conn, self.ref)["checklist"][0]["id"]
        self.agent("claim_work_item_checklist_item", SUBAGENT, id=self.ref, item_id=step)
        self.assertEqual(subscriptions.MUTED, self.subscribe(False, SUBAGENT))
        self.assertEqual(subscriptions.MUTED, self.subscribe(False), "its session holds the step")
        self.assertEqual(subscriptions.NOT_FOLLOWING, self.subscribe(False, ELSEWHERE))
        self.assertEqual([(SESSION, "", 0), (SESSION, CHILD, 0)], self.rows())

    def test_only_a_proved_agent_session_subscribes(self) -> None:
        error = self.refused(None, subscribe=True)
        self.assertIn("proved none", error["message"])
        with calls.bind(calls.browser(), "/api/planning/work-item/apply"):
            with self.assertRaises((model.PlanningError, api.PlanningHttpError)):
                api.handle_post(
                    self.conn, "/api/planning/work-item/apply", {"id": self.ref, "subscribe": True}
                )
        self.conn.rollback()
        error = self.refused(ORCHESTRATOR, subscribe="yes")
        self.assertEqual("subscribe must be a boolean", error["message"])
        self.assertEqual([], self.rows())

    def test_a_refused_step_after_it_takes_the_subscription_back(self) -> None:
        self.refused(ORCHESTRATOR, subscribe=True, checklist_ticks=[{"item_id": "nope"}])
        self.assertEqual([], self.rows())


class LifetimeTests(Harness):
    def ended(self, hours: float) -> None:
        self.conn.execute(
            "UPDATE sessions SET status = 'ended',"
            " ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now',?) WHERE id = ?",
            (f"-{int(hours * 60)} minutes", SESSION),
        )
        self.conn.commit()

    def sweep(self) -> None:
        housekeeping.expire_leases(self.conn)

    def test_a_session_ended_within_its_grace_still_follows(self) -> None:
        self.subscribe(True)
        self.ended(1)
        self.sweep()
        self.assertEqual([SESSION], [entry["session"] for entry in self.followers()])

    def test_a_lapsed_session_is_read_as_gone_and_swept_with_the_claims(self) -> None:
        self.subscribe(True)
        self.agent("claim_work_item", id=self.ref)
        self.subscribe(False, ref=self.ref)
        other = self.item("Followed elsewhere")
        self.conn.commit()
        self.subscribe(True, ELSEWHERE, ref=other)
        self.ended(13)
        self.assertEqual([], self.followers(), "read as gone before any sweep")
        self.sweep()
        self.assertEqual([(OTHER, "", 1)], self.rows(), "the mute went too; the live one stays")
        self.assertEqual("", service.get_work_item(self.conn, self.ref)["claim_ref"])

    def test_a_silent_session_lapses_after_the_lease_period(self) -> None:
        self.subscribe(True)
        self.conn.execute(
            "UPDATE sessions SET last_seen = strftime('%Y-%m-%dT%H:%M:%SZ','now','-15 days')"
        )
        self.conn.commit()
        self.assertEqual([], self.followers())
        self.sweep()
        self.assertEqual([], self.rows())

    def test_a_merge_carries_it_to_the_survivor_and_the_item_takes_it_away(self) -> None:
        survivor = self.item("Survivor")
        self.conn.commit()
        self.subscribe(True)
        self.subscribe(True, ELSEWHERE)
        self.subscribe(True, ELSEWHERE, ref=survivor)
        self.agent("merge_work_items", id=survivor, items=[self.ref])
        self.assertEqual([], self.followers())
        self.assertEqual([SESSION, OTHER], [entry["session"] for entry in self.followers(survivor)])
        service.delete_work_item(self.conn, survivor)
        self.conn.commit()
        self.assertEqual([], self.rows())


if __name__ == "__main__":
    unittest.main()
