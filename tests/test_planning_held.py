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
from server.planning import api, held, model, requests, service
from tests.planning_tree import Tree

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
OTHER = "019a3c2e-6c8e-7c11-9e0f-2f4b6d8a1c3e"
#: A session whose id is the start of `SESSION`'s.
PREFIX = SESSION[:-2]
CHILD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
SIBLING = "019a3c2e-8888-7c11-9e0f-2f4b6d8a1c3e"
#: A session that holds nothing, though a step's text names its label.
STRANGER = "019a3c2e-7777-7c11-9e0f-2f4b6d8a1c3e"
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
        service.create_planning_space(self.conn, name="Held", key="HLD")
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
            "apply_work_item_changes",
            SESSION,
            reference,
            checklist_ticks=[{"item_id": self.step_ids(reference)[0]}],
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

    def test_a_request_asked_of_another_session_is_no_pending_question(self) -> None:
        reference = self.item("Asked of another session")
        self.claim(SESSION, reference)
        self.sql("INSERT INTO sessions(id, client) VALUES(?, 'codex')", OTHER)
        requests.ask_sessions(
            self.conn, reference, sessions=[OTHER], prompt="Agree?", fields=[FIELD]
        )
        self.conn.commit()
        self.assertEqual(0, self.held(SESSION)["items"][0]["pending_questions"])
        requests.create(self.conn, reference, kind="question", prompt="Owner?", fields=[FIELD])
        self.conn.commit()
        self.assertEqual(1, self.held(SESSION)["items"][0]["pending_questions"])

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

    def test_the_answer_on_a_built_tree_holds_still(self) -> None:
        """The whole answer, function and route alike, on every way of holding at once.

        A characterization of the answer as it stands, so a reader built beside it
        on the same candidates and rules is seen to leave it as it was.
        """

        whole = self.item("Claimed whole", ("one", "two"))
        self.claim(SESSION, whole)
        self.agent(
            "apply_work_item_changes",
            SESSION,
            whole,
            checklist_ticks=[{"item_id": self.step_ids(whole)[0]}],
        )
        by_child = self.item("Claimed by the subagent")
        self.claim(SESSION, by_child, thread=CHILD)
        stepped = self.item("Held by a step", ("first", "second", "third"))
        self.claim(OTHER, stepped)
        self.claim_step(SESSION, stepped, 2)
        asked = self.item("Asked twice")
        self.claim(SESSION, asked)
        self.agent(
            "apply_work_item_changes",
            SESSION,
            asked,
            transition={"state": "blocked", "reason": "waits"},
        )
        answered = requests.create(self.conn, asked, kind="question", prompt="One?", fields=[FIELD])
        requests.create(self.conn, asked, kind="question", prompt="Two?", fields=[FIELD])
        requests.resolve(
            self.conn,
            answered["request_id"],
            status="answered",
            expected_revision=answered["revision"],
            answers={"answer": "yes"},
        )
        theirs = self.item("Theirs")
        self.claim(OTHER, theirs)
        named = self.item("Named in a step", (f"tell codex (session {OTHER})",))
        self.claim(PREFIX, named)
        for title, at in (
            ("Claimed whole", "2026-04-01T00:00:00Z"),
            ("Claimed by the subagent", "2026-01-01T00:00:00Z"),
            ("Held by a step", "2026-03-01T00:00:00Z"),
            ("Asked twice", "2026-02-01T00:00:00Z"),
        ):
            self.sql("UPDATE work_items SET updated_at = ? WHERE title = ?", at, title)

        def entry(
            reference: str,
            title: str,
            state: tuple[str, str, str],
            held_as: str,
            steps: tuple[int, int],
            pending: int,
        ) -> dict:
            return {
                "reference": reference,
                "title": title,
                "state": dict(zip(("key", "name", "category"), state, strict=True)),
                "held_as": held_as,
                "steps": {"done": steps[0], "total": steps[1]},
                "pending_questions": pending,
                "url": f"http://127.0.0.1:8642/open/{reference}",
            }

        dev = ("dev", "Dev", "active")
        expected = {
            "session": SESSION,
            "items": [
                entry(whole, "Claimed whole", dev, "claim", (1, 2), 0),
                entry(stepped, "Held by a step", dev, "step", (0, 3), 0),
                entry(asked, "Asked twice", ("blocked", "Blocked", "blocked"), "claim", (0, 0), 1),
                entry(by_child, "Claimed by the subagent", dev, "claim", (0, 0), 0),
            ],
        }
        self.assertEqual(expected, held.held_by_session(self.conn, SESSION))
        self.assertEqual(expected, self.held(SESSION))
        # A suffix written into a step's text is no hold of the session it names.
        self.assertEqual({stepped, theirs}, set(self.references(OTHER)))

    # -- what a resume note is told ------------------------------------------

    def noted(self, session: str, agent: str | None = None) -> dict[str, dict]:
        return {item["reference"]: item for item in held.held_for_note(self.conn, session, agent)}

    def test_recipient(self) -> None:
        """A subagent is told its own holds, its session all of them, and a name in a text nothing."""

        mine = self.item("The session's own")
        self.claim(SESSION, mine)
        agent_claim = self.item("The subagent's claim")
        self.claim(SESSION, agent_claim, thread=CHILD)
        agent_step = self.item("The subagent's step", ("one", "two"))
        self.claim(OTHER, agent_step)
        self.agent(
            "claim_work_item_checklist_item",
            SESSION,
            agent_step,
            thread=CHILD,
            item_id=self.step_ids(agent_step)[1],
        )
        siblings = self.item("Another subagent's claim")
        self.claim(SESSION, siblings, thread=SIBLING)
        named = self.item(
            "Named in its steps",
            (f"ask codex agent {CHILD} (session {SESSION})", f"ask codex (session {STRANGER})"),
        )
        self.claim(PREFIX, named)

        self.assertEqual({agent_claim, agent_step}, set(self.noted(SESSION, CHILD)))
        self.assertEqual({siblings}, set(self.noted(SESSION, SIBLING)))
        self.assertEqual({mine, agent_claim, agent_step, siblings}, set(self.noted(SESSION)))
        self.assertEqual({}, self.noted(STRANGER))
        self.assertEqual({}, self.noted(SESSION, "no-such-agent"))
        # The session's note and its held read take the holds by one rule.
        self.assertEqual(set(self.references(SESSION)), set(self.noted(SESSION)))
        # The subagent's step is its next condition, the session's claim no step of its own.
        self.assertEqual("two", self.noted(SESSION, CHILD)[agent_step]["next_condition"]["text"])
        self.assertEqual("one", self.noted(OTHER)[agent_step]["next_condition"]["text"])

    def test_the_note_tells_the_next_condition_the_answers_and_the_stage_with_its_goal(
        self,
    ) -> None:
        tree = Tree(self.conn, "TR")
        tree.add("G", kind="goal", state="container")
        tree.add("S", kind="stage", state="container", parent="G")
        tree.add("in stage", state="ready", parent="S")
        tree.add("in goal", state="ready", parent="G")
        self.conn.commit()
        staged, under_goal = tree.refs["in stage"], tree.refs["in goal"]
        alone = self.item("Alone", ("only",))
        for reference, steps in (
            (staged, ["one", "two", "three", "four"]),
            (under_goal, ["first", "second"]),
        ):
            service.set_checklist(self.conn, reference, steps)
        self.conn.commit()
        # Written to in this order: alone, staged, under_goal, and alone once more at the end.
        self.claim(SESSION, alone)
        self.agent(
            "apply_work_item_changes",
            SESSION,
            alone,
            checklist_ticks=[{"item_id": self.step_ids(alone)[0]}],
        )
        self.claim(SESSION, staged)
        ids = self.step_ids(staged)
        self.agent(
            "apply_work_item_changes", SESSION, staged, checklist_ticks=[{"item_id": ids[0]}]
        )
        self.agent("claim_work_item_checklist_item", SESSION, staged, item_id=ids[2])
        self.agent(
            "apply_work_item_changes",
            SESSION,
            staged,
            comments=[{"body": "Open root"}, {"body": "Settled root"}],
        )
        settled = self.comment_id("Settled root")
        self.agent(
            "apply_work_item_changes",
            SESSION,
            staged,
            comment={"body": "A reply", "reply_to": self.comment_id("Open root")},
            resolutions=[{"comment_id": settled}],
        )
        before, after, declined, _pending = (
            requests.create(self.conn, staged, kind="question", prompt=f"{name}?", fields=[FIELD])
            for name in ("Before", "After", "Declined", "Pending")
        )
        for request, status in ((before, "answered"), (after, "answered"), (declined, "declined")):
            requests.resolve(
                self.conn,
                request["request_id"],
                status=status,
                expected_revision=request["revision"],
                answers={"answer": "yes"} if status == "answered" else None,
            )
        # Each answer is set a second either side of the session's newest write on the item.
        for request, shift in (
            (before, "-1 second"),
            (after, "+1 second"),
            (declined, "+1 second"),
        ):
            self.sql(
                "UPDATE work_item_requests SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ',"
                " (SELECT MAX(received_at) FROM execution_events WHERE session_id = ?"
                "  AND work_item_id = (SELECT work_item_id FROM work_item_requests"
                "  WHERE request_id = ?)), ?) WHERE request_id = ?",
                SESSION,
                request["request_id"],
                shift,
                request["request_id"],
            )
        self.claim(SESSION, under_goal)
        # A claim no call recorded: the session wrote nothing on this item.
        unwritten = self.item("Claimed with no call")
        self.sql(
            "UPDATE work_items SET claim_ref = ? WHERE title = 'Claimed with no call'",
            f"codex (session {SESSION})",
        )
        asked = requests.create(self.conn, unwritten, kind="question", prompt="?", fields=[FIELD])
        requests.resolve(
            self.conn,
            asked["request_id"],
            status="answered",
            expected_revision=asked["revision"],
            answers={"answer": "yes"},
        )
        # Written to first, `alone` is written to last as well.
        self.agent("apply_work_item_changes", SESSION, alone, comment={"body": "Last word"})
        # The held read's own order, by the last change, is the other way round.
        for title, at in (
            ("in stage item", "2026-04-01T00:00:00Z"),
            ("Claimed with no call", "2026-03-01T00:00:00Z"),
            ("in goal item", "2026-02-01T00:00:00Z"),
            ("Alone", "2026-01-01T00:00:00Z"),
        ):
            self.sql("UPDATE work_items SET updated_at = ? WHERE title = ?", at, title)
        self.assertEqual([staged, unwritten, under_goal, alone], self.references(SESSION))

        found = held.held_for_note(self.conn, SESSION)
        self.assertEqual(
            [alone, under_goal, staged, unwritten], [item["reference"] for item in found]
        )
        told = {item["reference"]: item for item in found}
        note = (
            "next_condition",
            "open_threads",
            "new_answers",
            "to_confirm",
            "stage",
            "goal",
        )
        self.assertEqual(
            {
                staged: (
                    {"text": "three", "done": 1, "total": 4, "flagged": False},
                    1,
                    1,
                    0,
                    tree.refs["S"],
                    tree.refs["G"],
                ),
                under_goal: (
                    {"text": "first", "done": 0, "total": 2, "flagged": False},
                    0,
                    0,
                    0,
                    None,
                    tree.refs["G"],
                ),
                alone: (None, 1, 0, 0, None, None),
                unwritten: (None, 0, 1, 0, None, None),
            },
            {reference: tuple(item[name] for name in note) for reference, item in told.items()},
        )
        self.assertEqual(1, told[staged]["pending_questions"])
        self.assertIsNone(told[unwritten]["last_write"])
        writes = [told[reference]["last_write"] for reference in (alone, under_goal, staged)]
        self.assertEqual(sorted(writes, reverse=True), writes)
        self.assertEqual(len(set(writes)), 3)
        # Every field the held read gives an item, the note gives it as that read does.
        for item in held.held_by_session(self.conn, SESSION)["items"]:
            with self.subTest(item=item["reference"]):
                note_item = told[item["reference"]]
                self.assertEqual(item, {name: note_item[name] for name in item})
                self.assertEqual(
                    set(item) | {*note, "last_write"},
                    set(note_item),
                )

    def test_a_step_a_previous_holder_ticked_is_to_confirm_and_not_done(self) -> None:
        # No write of this build marks a step so; the mark is read where a record has it.
        own = f"codex (session {SESSION})"
        steps = [
            {"text": "ticked", "done": True, "claimed_by": "", "by_previous_holder": False},
            {"text": "to confirm", "done": True, "claimed_by": "", "by_previous_holder": True},
            {"text": "open", "done": False, "claimed_by": ""},
            {"text": "mine", "done": False, "claimed_by": own},
        ]
        suffix = f"(session {SESSION})"
        self.assertEqual(
            {"text": "mine", "done": 1, "total": 4, "flagged": False},
            held.next_condition(steps, suffix),
        )
        self.assertEqual(
            {"text": "to confirm", "done": 1, "total": 4, "flagged": True},
            held.next_condition(steps, "(session nobody)"),
        )
        self.assertIsNone(held.next_condition(steps[:1], suffix))
        self.assertIsNone(held.next_condition([], suffix))

    def comment_id(self, body: str) -> int:
        found = self.conn.execute("SELECT id FROM work_item_comments WHERE body = ?", (body,))
        return int(found.fetchone()[0])

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
