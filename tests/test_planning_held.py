"""Which open work items one agent session holds: `GET /api/planning/held`.

The holds are taken the way an agent takes them, through the MCP tools with the
`_meta` a Codex client sends, so every label is the one a confirmed session
records. A state no current write leaves behind -- a done step still carrying its
holder, a closed item still carrying its claim -- is written into the store
directly, because those are what the read's own rules have to keep out.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import mcp_surface, store
from server.planning import api, model, requests, service

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
OTHER = "019a3c2e-6c8e-7c11-9e0f-2f4b6d8a1c3e"
#: A session whose id is the start of `SESSION`'s.
PREFIX = SESSION[:-2]
CHILD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
FIELD = {"id": "answer", "label": "Answer", "type": "text", "required": True, "options": []}


class HeldTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3"),
                "VALKAMA_PORT": "8642",
                "HOME": directory.name,
                "USERPROFILE": directory.name,
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="held", name="Held", key="HLD")
        self.conn.commit()

    # -- helpers -------------------------------------------------------------

    def item(self, title: str, steps: tuple[str, ...] = ()) -> str:
        reference = str(service.create_work_item(self.conn, space="HLD", title=title)["reference"])
        if steps:
            service.set_checklist(self.conn, reference, list(steps))
        self.conn.commit()
        return reference

    def step_ids(self, reference: str) -> list[str]:
        return [step["id"] for step in service.get_work_item(self.conn, reference)["checklist"]]

    def agent(
        self,
        tool: str,
        session: str,
        reference: str,
        thread: str | None = None,
        **arguments: object,
    ) -> dict:
        meta = {"sessionId": session, "threadId": thread or session}
        answer = mcp_surface.call_tool(self.conn, tool, {"id": reference, **arguments}, meta=meta)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def claim(self, session: str, reference: str, thread: str | None = None) -> None:
        self.agent("claim_work_item", session, reference, thread)

    def claim_step(self, session: str, reference: str, index: int) -> None:
        self.agent(
            "claim_work_item_checklist_item",
            session,
            reference,
            item_id=self.step_ids(reference)[index],
        )

    def held(self, session: str) -> dict:
        status, body = api.handle_get(self.conn, "/api/planning/held", {"session": [session]})
        self.assertEqual(200, status)
        return body

    def references(self, session: str) -> list[str]:
        return [item["reference"] for item in self.held(session)["items"]]

    def refusal(self, parameters: dict[str, list[str]]) -> tuple[int, dict]:
        with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught:
            api.handle_get(self.conn, "/api/planning/held", parameters)
        return api.error_response(caught.exception)

    def sql(self, statement: str, *parameters: object) -> None:
        self.conn.execute(statement, parameters)
        self.conn.commit()

    # -- what counts as held -------------------------------------------------

    def test_a_claimed_item_is_answered_with_its_state_steps_questions_and_address(self) -> None:
        reference = self.item("Held whole", ("one", "two", "three"))
        self.claim(SESSION, reference)
        self.agent(
            "tick_work_item_checklist_item",
            SESSION,
            reference,
            item_id=self.step_ids(reference)[0],
        )
        self.assertEqual(
            {
                "session": SESSION,
                "items": [
                    {
                        "reference": reference,
                        "title": "Held whole",
                        "state": {"key": "dev", "name": "Dev", "category": "active"},
                        "held_as": "claim",
                        "steps": {"done": 1, "total": 3},
                        "pending_questions": 0,
                        "url": f"http://127.0.0.1:8642/open/{reference}",
                    }
                ],
            },
            self.held(SESSION),
        )

    def test_an_open_step_holds_the_item_without_its_claim(self) -> None:
        reference = self.item("Split", ("one", "two"))
        self.claim(OTHER, reference)
        self.claim_step(SESSION, reference, 1)
        [item] = self.held(SESSION)["items"]
        self.assertEqual((reference, "step"), (item["reference"], item["held_as"]))
        # The claim's own session holds it as its claim, not as a step.
        [claimed] = self.held(OTHER)["items"]
        self.assertEqual("claim", claimed["held_as"])

    def test_a_done_step_still_carrying_the_sessions_label_holds_nothing(self) -> None:
        reference = self.item("Finished step", ("one",))
        self.claim_step(SESSION, reference, 0)
        self.assertEqual([reference], self.references(SESSION))
        # A tick clears the holder; a step stored done with its holder kept is
        # what an older write or a replaced checklist can leave behind.
        [step] = service.get_work_item(self.conn, reference)["checklist"]
        self.sql(
            "UPDATE work_items SET checklist = ? WHERE work_item_id ="
            " (SELECT work_item_id FROM work_items WHERE title = 'Finished step')",
            model.dumps([{**step, "done": True}]),
        )
        self.assertEqual([], self.references(SESSION))

    def test_what_a_subagent_holds_is_its_sessions(self) -> None:
        claimed = self.item("By the subagent")
        self.claim(SESSION, claimed, thread=CHILD)
        label = service.get_work_item(self.conn, claimed)["claim_ref"]
        self.assertEqual(f"codex agent {CHILD} (session {SESSION})", label)
        self.assertEqual([claimed], self.references(SESSION))

    def test_another_sessions_holds_are_left_out_even_when_its_id_starts_the_same(self) -> None:
        mine = self.item("Mine")
        theirs = self.item("Theirs", ("one",))
        prefixed = self.item("Prefixed")
        self.claim(SESSION, mine)
        self.claim(OTHER, theirs)
        self.claim_step(OTHER, theirs, 0)
        self.claim(PREFIX, prefixed)
        self.assertEqual([mine], self.references(SESSION))
        self.assertEqual([prefixed], self.references(PREFIX))
        self.assertEqual([theirs], self.references(OTHER))

    def test_an_item_in_a_terminal_state_is_left_out_whatever_it_still_carries(self) -> None:
        reference = self.item("Closed", ("one",))
        self.claim(SESSION, reference)
        self.claim_step(SESSION, reference, 0)
        self.assertEqual([reference], self.references(SESSION))
        # A close releases every hold, so a closed item still holding one is
        # a store an older write left that way.
        self.sql(
            "UPDATE work_items SET state_id ="
            " (SELECT state_id FROM workflow_states WHERE key = 'done') WHERE title = 'Closed'"
        )
        self.assertEqual("done", service.get_work_item(self.conn, reference)["state"]["key"])
        self.assertEqual([], self.references(SESSION))

    def test_a_lapsed_claim_holds_nothing_and_neither_do_the_lapsed_sessions_steps(
        self,
    ) -> None:
        claimed = self.item("Claimed long ago")
        stepped = self.item("Stepped long ago", ("one",))
        self.claim(OTHER, claimed)
        self.claim_step(OTHER, stepped, 0)
        self.assertEqual({claimed, stepped}, set(self.references(OTHER)))
        self.sql("UPDATE sessions SET last_seen = '2020-01-01T00:00:00Z' WHERE id = ?", OTHER)
        self.assertEqual("stale", service.get_work_item(self.conn, claimed)["claim_state"])
        self.assertEqual([], self.references(OTHER))

    def test_an_ended_session_reads_stale_as_the_item_read_does(self) -> None:
        reference = self.item("Ended")
        self.claim(OTHER, reference)
        self.sql(
            "UPDATE sessions SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')"
            " WHERE id = ?",
            OTHER,
        )
        self.assertEqual("stale", service.get_work_item(self.conn, reference)["claim_state"])
        self.assertEqual([], self.references(OTHER))

    # -- what each item says -------------------------------------------------

    def test_pending_questions_count_and_answered_ones_do_not(self) -> None:
        reference = self.item("Asked")
        self.claim(SESSION, reference)
        answered = requests.create(
            self.conn, reference, kind="question", prompt="First?", fields=[FIELD]
        )
        requests.create(self.conn, reference, kind="question", prompt="Second?", fields=[FIELD])
        requests.create(self.conn, reference, kind="question", prompt="Third?", fields=[FIELD])
        self.conn.commit()
        self.assertEqual(3, self.held(SESSION)["items"][0]["pending_questions"])
        requests.resolve(
            self.conn,
            answered["request_id"],
            status="answered",
            expected_revision=answered["revision"],
            answers={"answer": "yes"},
        )
        self.conn.commit()
        self.assertEqual(2, self.held(SESSION)["items"][0]["pending_questions"])

    def test_the_most_recently_changed_item_comes_first(self) -> None:
        older = self.item("Older")
        newer = self.item("Newer")
        middle = self.item("Middle", ("one",))
        self.claim(SESSION, older)
        self.claim(SESSION, newer)
        self.claim_step(SESSION, middle, 0)
        for title, at in (
            ("Older", "2026-01-01T00:00:00Z"),
            ("Newer", "2026-03-01T00:00:00Z"),
            ("Middle", "2026-02-01T00:00:00Z"),
        ):
            self.sql("UPDATE work_items SET updated_at = ? WHERE title = ?", at, title)
        self.assertEqual([newer, middle, older], self.references(SESSION))

    # -- what the request must say -------------------------------------------

    def test_a_missing_or_blank_session_is_refused_as_invalid(self) -> None:
        for parameters in ({}, {"session": [""]}, {"session": ["   "]}):
            with self.subTest(parameters=parameters):
                status, body = self.refusal(parameters)
                self.assertEqual(400, status)
                self.assertEqual("invalid_request", body["error"]["code"])
                self.assertIn("session", body["error"]["message"])

    def test_a_session_nothing_names_holds_no_items(self) -> None:
        self.claim(SESSION, self.item("Somebody else's"))
        self.assertEqual({"session": "no-such-session", "items": []}, self.held("no-such-session"))


if __name__ == "__main__":
    unittest.main()
