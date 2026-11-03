"""What a person does on an item reaches the agent working it.

The owner works through one orchestrating agent and its subagents, and wants what
changes on a card to reach whoever is doing that work, without going to a chat to
say "check the tracker". So what counts is decided by how a write came in, never
by who it was signed as: an agent may sign `user`, and a person's write may carry
any name.

Everything here goes through the two doors a real caller uses: an agent through
`mcp_surface.call_tool`, a person through the HTTP boundary bound as the browser
surface binds it. Each write is committed as the surface commits it, so an agent's
next write sees what the last one left.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import mcp_surface, store
from server.planning import api, calls, leases, model, person_events, service

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
CHILD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
ROOT = Path(__file__).resolve().parent.parent
#: A call with a proved session: the orchestrator.
AGENT = {"sessionId": SESSION}
#: Inside that session, a subagent's own thread.
SUBAGENT = {"sessionId": SESSION, "threadId": CHILD}
QUESTION = [
    {
        "id": "which",
        "label": "Which way",
        "type": "choice",
        "required": True,
        "options": [{"id": "a", "label": "The long road"}, {"id": "b", "label": "The short road"}],
    }
]


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.space = service.create_planning_space(self.conn, project_id="p", name="Quality Crew")
        self.item = service.create_work_item(
            self.conn, space=self.space["key"], title="Do the work", author="filer"
        )
        self.conn.commit()
        self.ref = str(self.item["reference"])
        self.id = str(self.item["work_item_id"])

    def agent(self, tool: str, *, meta: object = AGENT, **arguments: object) -> dict:
        """One tool call as the MCP surface runs and commits it."""

        answer = mcp_surface.call_tool(self.conn, tool, arguments, meta=meta)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def refused_agent(self, tool: str, *, meta: object = AGENT, **arguments: object) -> str:
        """A tool call that must be refused; what it said, after the surface rolls it back."""

        with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught:
            mcp_surface.call_tool(self.conn, tool, arguments, meta=meta)
        self.conn.rollback()
        return str(caught.exception)

    def person(self, path: str, **payload: object) -> dict:
        """One write as the browser surface binds and commits it."""

        with calls.bind(calls.browser(), path):
            answer = api.handle_post(self.conn, path, payload)
        self.conn.commit()
        assert answer is not None
        return answer[1]

    def says(self, body: str = "Use the other library") -> dict:
        return self.person("/api/planning/work-item/comment", id=self.ref, body=body)

    def window(self) -> list[dict]:
        return person_events.since_last_agent_write(self.conn, self.id)

    def kinds(self) -> list[str]:
        return [event["kind"] for event in self.window()]

    def summary(self) -> None:
        self.agent(
            "set_work_item_summary",
            id=self.ref,
            summary={"done": "Did the work", "next": "Nothing"},
        )

    def status(self) -> str:
        return str(service.get_work_item(self.conn, self.ref)["state"]["key"])

    def ask(self) -> dict:
        return self.agent(
            "create_work_item_request",
            id=self.ref,
            kind="question",
            prompt="Which road do we take?",
            fields=QUESTION,
        )


class WhatCountsTests(Harness):
    def test_every_action_a_store_can_hold_is_decided_one_way(self) -> None:
        """A new action has to be sorted here before a person's write of it is told or not."""

        told, untold = set(person_events.KINDS), set(person_events.NOT_TOLD)
        self.assertEqual(set(), told & untold)
        self.assertEqual(set(model.EVENT_ACTIONS), told | untold)

    def test_the_browser_and_kind_spellings_are_the_call_rows_own(self) -> None:
        self.assertEqual(calls.BROWSER, person_events.BROWSER)
        self.assertEqual(calls.VALKAMA, person_events.VALKAMA)
        self.assertEqual(calls.KIND, person_events.KIND)

    def test_a_comment_says_what_it_said_and_where_it_came_from(self) -> None:
        said = self.says()
        event = self.window()[0]
        self.assertEqual("comment", event["kind"])
        self.assertEqual("interface", event["via"])
        self.assertEqual(said["comment_id"], event["comment_id"])
        self.assertEqual("Use the other library", event["text"])
        self.assertRegex(event["at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertNotIn("author", event)

    def test_a_long_text_is_cut_at_its_limit_and_read_whole_from_the_item(self) -> None:
        whole = "x" * 301
        self.says(whole)
        text = self.window()[0]["text"]
        self.assertEqual(300, len(text))
        self.assertTrue(text.endswith("…"))
        self.assertEqual(whole, service.get_work_item(self.conn, self.ref)["comments"][-1]["body"])

    def test_text_of_exactly_the_limit_is_left_whole(self) -> None:
        self.says("y" * 300)
        self.assertEqual("y" * 300, self.window()[0]["text"])

    def test_an_answer_quotes_the_choice_and_the_note(self) -> None:
        asked = self.ask()
        self.person(
            "/api/planning/request/answer",
            id=asked["request"]["request_id"] if "request" in asked else asked["request_id"],
            answers={"which": "b"},
            note="Mind the bridge",
            expected_revision=0,
        )
        event = self.window()[0]
        self.assertEqual("question_answered", event["kind"])
        self.assertEqual(asked.get("request_id"), event["request_id"])
        self.assertIn("The short road", event["text"])
        self.assertIn("Mind the bridge", event["text"])

    def test_declining_and_withdrawing_a_question_quote_the_question(self) -> None:
        for path, kind in (
            ("/api/planning/request/decline", "question_declined"),
            ("/api/planning/request/expire", "question_withdrawn"),
        ):
            with self.subTest(kind):
                asked = self.ask()
                self.person(path, id=asked["request_id"], expected_revision=0)
                event = self.window()[0]
                self.assertEqual(kind, event["kind"])
                self.assertEqual(asked["request_id"], event["request_id"])
                self.assertEqual("Which road do we take?", event["text"])

    def test_each_thing_a_person_does_to_the_item_is_told(self) -> None:
        steps = self.agent("set_work_item_checklist", id=self.ref, items=["One", "Two"])
        one = steps["checklist"][0]["item_id"]
        ref = self.ref
        other = service.create_work_item(self.conn, space=self.space["key"], title="Other")
        self.conn.commit()
        cases: list[tuple[str, dict, list[str]]] = [
            ("/api/planning/work-item/transition", {"state": "todo"}, ["status"]),
            ("/api/planning/work-item/claim", {}, ["claimed", "status"]),
            ("/api/planning/work-item/claim", {"release": True}, ["released", "status"]),
            ("/api/planning/work-item/checklist/claim", {"item_id": one}, ["step_claimed"]),
            (
                "/api/planning/work-item/checklist/claim",
                {"item_id": one, "release": True},
                ["step_released"],
            ),
            ("/api/planning/work-item/checklist/tick", {"item_id": one}, ["step_completed"]),
            (
                "/api/planning/work-item/checklist/tick",
                {"item_id": one, "done": False},
                ["step_reopened"],
            ),
            (
                "/api/planning/work-item/checklist",
                {"items": ["One", "Two", "Three"]},
                ["steps_edited"],
            ),
            (
                "/api/planning/work-item/link",
                {"other": other["reference"], "kind": "relates-to"},
                ["linked"],
            ),
            ("/api/planning/work-item/update", {"title": "A better title"}, ["edited"]),
            ("/api/planning/work-item/update", {"description": "A brief"}, ["edited"]),
        ]
        for path, payload, kinds in cases:
            with self.subTest(path=path, payload=payload):
                self.agent("comment_work_item", id=ref, body="moving the boundary")
                self.person(path, id=ref, **payload)
                self.assertEqual(kinds, self.kinds())

    def test_a_takeover_names_who_it_took_from(self) -> None:
        self.agent("claim_work_item", id=self.ref)
        self.person("/api/planning/work-item/claim", id=self.ref, force=True)
        event = self.window()[0]
        self.assertEqual("taken_over", event["kind"])
        self.assertIn(SESSION, event["text"])

    def test_an_edit_names_its_fields_and_quotes_them_as_they_read_now(self) -> None:
        self.person(
            "/api/planning/work-item/update",
            id=self.ref,
            title="A better title",
            description="A longer brief",
        )
        event = self.window()[0]
        self.assertEqual(["title", "description"], event["fields"])
        self.assertIn("title: A better title", event["text"])
        self.assertIn("description: A longer brief", event["text"])

    def test_a_card_dragged_within_its_column_says_nothing(self) -> None:
        service.create_work_item(self.conn, space=self.space["key"], title="Neighbour")
        self.conn.commit()
        self.person("/api/planning/work-item/update", id=self.ref, rank="last")
        self.assertEqual([], self.window())

    def test_an_edit_that_changes_nothing_says_nothing(self) -> None:
        self.person("/api/planning/work-item/update", id=self.ref, title="Do the work")
        self.assertEqual([], self.window())

    def test_a_report_a_person_makes_current_is_one_event(self) -> None:
        self.person(
            "/api/planning/work-item/summary",
            id=self.ref,
            summary={"done": "Decided against it", "next": "Nothing"},
        )
        events = self.window()
        self.assertEqual(["report"], [event["kind"] for event in events])
        self.assertEqual("Decided against it", events[0]["text"])

    def test_selecting_an_earlier_report_is_told_on_its_own(self) -> None:
        reported = self.agent(
            "report_work_item", id=self.ref, report={"done": "First", "next": "Second"}
        )
        self.person(
            "/api/planning/work-item/summary/select",
            id=self.ref,
            comment_id=reported["comment_id"],
            expected_revision=reported["revision"],
        )
        self.assertEqual(["summary_selected"], self.kinds())

    def test_a_person_filing_an_item_is_not_news_about_it(self) -> None:
        filed = self.person(
            "/api/planning/work-items", space=self.space["key"], title="Filed by hand"
        )
        self.assertEqual(
            [], person_events.since_last_agent_write(self.conn, str(filed["work_item_id"]))
        )


class WhoCountsTests(Harness):
    def test_an_agent_signing_as_user_is_still_an_agent(self) -> None:
        said = self.agent(
            "apply_work_item_changes",
            meta=None,
            id=self.ref,
            comment={"body": "Signed"},
            checklist={"items": ["A"]},
            author="user",
        )
        self.assertNotIn("from_person", said)
        self.agent("comment_work_item", meta=None, id=self.ref, body="Signed", author="user")
        self.assertEqual([], self.window())
        self.agent("claim_work_item", id=self.ref)
        self.summary()
        self.agent(
            "apply_work_item_changes",
            id=self.ref,
            comment={"body": "Closing, signed as the owner"},
            transition={"state": "cancelled"},
            author="user",
        )
        self.assertEqual("cancelled", self.status())

    def test_a_person_signing_anything_is_still_a_person(self) -> None:
        self.person(
            "/api/planning/work-item/comment", id=self.ref, body="From me", author="claude-desk"
        )
        self.person("/api/planning/work-item/transition", id=self.ref, state="todo", author="agent")
        self.assertEqual(["comment", "status"], self.kinds())

    def test_a_launch_writing_under_the_interface_is_not_a_person_speaking(self) -> None:
        with calls.bind(calls.browser(), "/api/execution/launch"):
            service.claim_work_item(self.conn, self.ref, author="codex:worker")
            service.comment_work_item(self.conn, self.ref, "started", author="codex:worker")
        self.conn.commit()
        self.assertEqual([], self.window())

    def test_a_lapsed_claim_released_by_valkama_does_not_end_the_window(self) -> None:
        self.says()
        with calls.bind(calls.valkama(), leases.EXPIRY_TOOL):
            service.comment_work_item(self.conn, self.ref, "note", author="valkama")
            service.claim_work_item(self.conn, self.ref, author="valkama")
        self.conn.commit()
        self.assertEqual(["comment"], self.kinds())

    def test_a_write_with_no_call_is_on_neither_side(self) -> None:
        """The runner in the background: nobody got an answer, and nobody proved a person."""

        self.says()
        service.comment_work_item(self.conn, self.ref, "reaped", author="runner")
        self.conn.commit()
        self.assertEqual(["comment"], self.kinds())


class TheWindowTests(Harness):
    def test_what_a_person_said_before_the_claim_comes_back_with_the_claim(self) -> None:
        self.says()
        claimed = self.agent("claim_work_item", id=self.ref)
        self.assertEqual(["comment"], [event["kind"] for event in claimed["from_person"]])
        self.assertEqual([], self.window())

    def test_after_the_claim_only_what_is_newer_than_it_counts(self) -> None:
        self.says("Before")
        self.agent("claim_work_item", id=self.ref)
        self.says("After")
        self.assertEqual(["After"], [event["text"] for event in self.window()])

    def test_an_agents_write_moves_it_and_each_event_is_told_once(self) -> None:
        self.agent("claim_work_item", id=self.ref)
        self.says("First")
        told = self.agent("comment_work_item", id=self.ref, body="Working")
        self.assertEqual(["First"], [event["text"] for event in told["from_person"]])
        again = self.agent("comment_work_item", id=self.ref, body="Still working")
        self.assertNotIn("from_person", again)
        self.says("Second")
        third = self.agent("comment_work_item", id=self.ref, body="And now")
        self.assertEqual(["Second"], [event["text"] for event in third["from_person"]])

    def test_several_events_come_oldest_first(self) -> None:
        self.agent("claim_work_item", id=self.ref)
        self.says("One")
        self.person("/api/planning/work-item/update", id=self.ref, title="Two")
        self.person("/api/planning/work-item/transition", id=self.ref, state="review", force=True)
        self.says("Three")
        self.assertEqual(["comment", "edited", "status", "comment"], self.kinds())

    def test_an_agents_write_that_logs_no_event_moves_it_too(self) -> None:
        for name, arguments in (
            ("update_work_item", {"title": "Renamed by the agent"}),
            ("attach_work_item_ref", {"kind": "commit", "value": "abc1234"}),
        ):
            with self.subTest(name):
                self.says()
                told = self.agent(name, id=self.ref, **arguments)
                self.assertEqual(1, len(told["from_person"]))
                self.assertEqual([], self.window())

    def test_a_person_editing_after_such_a_write_is_told(self) -> None:
        self.agent("update_work_item", id=self.ref, title="Agent's title")
        self.person("/api/planning/work-item/update", id=self.ref, title="Person's title")
        self.assertEqual(["edited"], self.kinds())

    def test_a_refused_write_leaves_the_window_where_it_was(self) -> None:
        self.says()
        self.refused_agent("claim_work_item_checklist_item", id=self.ref, item_id=model.new_id())
        self.assertEqual(["comment"], self.kinds())

    def test_a_link_does_not_spend_the_news_of_the_item_at_its_far_end(self) -> None:
        other = service.create_work_item(self.conn, space=self.space["key"], title="Far end")
        self.conn.commit()
        self.person(
            "/api/planning/work-item/comment", id=other["reference"], body="About the far end"
        )
        self.agent("link_work_items", id=self.ref, other=other["reference"], kind="relates-to")
        told = person_events.since_last_agent_write(self.conn, str(other["work_item_id"]))
        self.assertEqual(["About the far end"], [event["text"] for event in told])

    def test_two_items_have_two_windows(self) -> None:
        other = service.create_work_item(self.conn, space=self.space["key"], title="Elsewhere")
        self.conn.commit()
        self.says()
        told = self.agent("comment_work_item", id=other["reference"], body="Over here")
        self.assertNotIn("from_person", told)
        self.assertEqual(["comment"], self.kinds())

    def test_it_reads_on_a_read_only_connection_with_no_row_factory(self) -> None:
        """What a client hook has: its own connection, and nothing the store set up."""

        self.agent("claim_work_item", id=self.ref)
        self.says("Read me")
        self.person("/api/planning/work-item/update", id=self.ref, title="Renamed")
        hook = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)
        self.addCleanup(hook.close)
        events = person_events.since_last_agent_write(hook, self.id)
        self.assertEqual(["comment", "edited"], [event["kind"] for event in events])
        self.assertFalse(hook.in_transaction)

    def test_a_malformed_stored_answer_reads_as_no_text_rather_than_a_refusal(self) -> None:
        asked = self.ask()
        self.person(
            "/api/planning/request/answer",
            id=asked["request_id"],
            answers={"which": "a"},
            expected_revision=0,
        )
        self.conn.execute("UPDATE work_item_requests SET answers_json = 'not json'")
        self.conn.commit()
        self.assertNotIn("text", self.window()[0])

    def test_importing_it_stays_light(self) -> None:
        """A hook starts a process per event, so this may not pull the server in."""

        code = (
            "import sys; import server.planning.person_events;"
            "print(' '.join(sorted(m for m in sys.modules if m.startswith('server'))))"
        )
        loaded = subprocess.run(
            [sys.executable, "-c", code],
            cwd=ROOT,
            capture_output=True,
            check=True,
        ).stdout.decode()
        self.assertEqual(
            {
                "server",
                "server.planning",
                "server.planning.model",
                "server.planning.person_events",
                "server.planning.request_model",
            },
            set(loaded.split()),
        )


class ToldOnWriteTests(Harness):
    def test_every_write_to_an_item_carries_it(self) -> None:
        other = service.create_work_item(self.conn, space=self.space["key"], title="Merge me")
        self.conn.commit()
        steps = self.agent("set_work_item_checklist", id=self.ref, items=["One", "Two"])
        step = steps["checklist"][0]["item_id"]
        report = self.agent(
            "report_work_item", id=self.ref, report={"done": "Earlier", "next": "Later"}
        )
        asked = [self.ask()["request_id"] for _ in range(3)]
        current = lambda: int(service.get_work_item(self.conn, self.ref)["revision"])  # noqa: E731
        cases: list[tuple[str, dict]] = [
            ("update_work_item", {"id": self.ref, "priority": "high"}),
            ("transition_work_item", {"id": self.ref, "state": "todo"}),
            ("claim_work_item", {"id": self.ref}),
            ("set_work_item_checklist", {"id": self.ref, "items": ["One", "Two", "Three"]}),
            ("claim_work_item_checklist_item", {"id": self.ref, "item_id": step}),
            ("tick_work_item_checklist_item", {"id": self.ref, "item_id": step}),
            ("link_work_items", {"id": self.ref, "other": other["reference"], "kind": "blocks"}),
            ("attach_work_item_ref", {"id": self.ref, "kind": "commit", "value": "abc1234"}),
            (
                "set_work_item_summary",
                {"id": self.ref, "summary": {"done": "Done", "next": "Next"}},
            ),
            ("report_work_item", {"id": self.ref, "report": {"done": "Done", "next": "Next"}}),
            ("comment_work_item", {"id": self.ref, "body": "Noted"}),
            ("apply_work_item_changes", {"id": self.ref, "comment": {"body": "Noted"}}),
            (
                "create_work_item_request",
                {"id": self.ref, "kind": "question", "prompt": "Well?", "fields": QUESTION},
            ),
            ("merge_work_items", {"id": self.ref, "items": [other["reference"]]}),
            ("decline_work_item_request", {"id": asked[0], "expected_revision": 0}),
            ("expire_work_item_request", {"id": asked[1], "expected_revision": 0}),
            (
                "answer_work_item_request",
                {"id": asked[2], "answers": {"which": "a"}, "expected_revision": 0},
            ),
        ]
        for name, arguments in cases:
            with self.subTest(name):
                self.says(f"Before {name}")
                answer = self.agent(name, **arguments)
                self.assertEqual(
                    [f"Before {name}"],
                    [
                        event["text"]
                        for event in answer["from_person"]
                        if event["kind"] == "comment"
                    ],
                )
                self.assertNotIn(
                    "from_person",
                    self.agent("comment_work_item", id=self.ref, body="Moving on"),
                )
        self.says("Before select")
        selected = self.agent(
            "select_work_item_summary",
            id=self.ref,
            comment_id=report["comment_id"],
            expected_revision=current(),
        )
        self.assertEqual("Before select", selected["from_person"][0]["text"])

    def test_the_next_item_of_the_queue_comes_with_what_was_said_on_it(self) -> None:
        self.says()
        taken = self.agent("claim_ready_work_item", space=self.space["key"])
        self.assertEqual(self.ref, taken["work_item"]["reference"])
        self.assertEqual("Use the other library", taken["from_person"][0]["text"])

    def test_a_write_with_nothing_to_tell_has_no_key(self) -> None:
        for name, arguments in (
            ("claim_work_item", {"id": self.ref}),
            ("comment_work_item", {"id": self.ref, "body": "Hello"}),
            ("apply_work_item_changes", {"id": self.ref, "comment": {"body": "Hello"}}),
            ("update_work_item", {"id": self.ref, "priority": "low"}),
        ):
            with self.subTest(name):
                self.assertNotIn("from_person", self.agent(name, **arguments))

    def test_a_verbose_answer_carries_it_too(self) -> None:
        self.says()
        answer = self.agent("claim_work_item", id=self.ref, verbose=True)
        self.assertEqual("Use the other library", answer["from_person"][0]["text"])

    def test_it_is_counted_before_this_write_lands(self) -> None:
        self.says("From the person")
        answer = self.agent(
            "apply_work_item_changes",
            id=self.ref,
            claim=True,
            comment={"body": "From the agent"},
        )
        self.assertEqual(["From the person"], [event["text"] for event in answer["from_person"]])

    def test_a_long_window_names_the_newest_and_counts_the_rest(self) -> None:
        for index in range(person_events.MOST_SHOWN + 3):
            self.says(f"Word {index}")
        answer = self.agent("comment_work_item", id=self.ref, body="Reading")
        self.assertEqual(person_events.MOST_SHOWN, len(answer["from_person"]))
        self.assertEqual(3, answer["from_person_omitted"])
        self.assertEqual(f"Word {person_events.MOST_SHOWN + 2}", answer["from_person"][-1]["text"])

    def test_a_person_writing_gets_no_such_key(self) -> None:
        self.says("Mine")
        answer = self.person("/api/planning/work-item/comment", id=self.ref, body="Mine again")
        self.assertNotIn("from_person", answer)
        moved = self.person("/api/planning/work-item/transition", id=self.ref, state="todo")
        self.assertNotIn("from_person", moved)

    def test_a_tool_outside_any_call_answers_as_it_did(self) -> None:
        from server.planning import tools

        self.says()
        answer = tools.OPS["comment_work_item"](self.conn, {"id": self.ref, "body": "Direct"})
        self.assertNotIn("from_person", answer)

    def test_a_write_touching_no_item_answers_as_it_did(self) -> None:
        space = self.agent("create_planning_space", project_id="q", name="Elsewhere")
        self.assertNotIn("from_person", space)
        self.assertNotIn(
            "from_person", self.agent("claim_ready_work_item", space=space["planning_space_id"])
        )


class CloseGuardTests(Harness):
    def worked(self) -> None:
        self.agent("claim_work_item", id=self.ref)
        self.summary()

    def test_a_close_over_unread_words_is_refused_naming_them(self) -> None:
        self.worked()
        self.says("Hold on, the requirement changed")
        message = self.refused_agent("transition_work_item", id=self.ref, state="done")
        self.assertIn("[person_spoke]", message)
        self.assertIn("Hold on, the requirement changed", message)
        self.assertEqual("dev", self.status())
        self.assertEqual(["comment"], self.kinds())

    def test_every_terminal_state_is_guarded_and_no_open_one_is(self) -> None:
        self.worked()
        self.says()
        self.assertIn(
            "[person_spoke]", self.refused_agent("transition_work_item", id=self.ref, state="done")
        )
        self.assertIn(
            "[person_spoke]",
            self.refused_agent("transition_work_item", id=self.ref, state="cancelled"),
        )
        answer = self.agent("transition_work_item", id=self.ref, state="review")
        self.assertEqual("review", answer["state"]["key"])

    def test_force_carries_it_and_records_the_override(self) -> None:
        self.worked()
        self.says()
        answer = self.agent("transition_work_item", id=self.ref, state="done", force=True)
        self.assertEqual("done", answer["state"]["key"])
        self.assertEqual(["person_spoke"], answer["overridden"])
        self.assertEqual("Use the other library", answer["from_person"][0]["text"])
        history = service.get_work_item(self.conn, self.ref)["events"]
        self.assertIn(
            ("overridden", "person_spoke"),
            [(event["action"], event["detail"]) for event in history],
        )

    def test_another_write_first_lets_the_close_through(self) -> None:
        self.worked()
        self.says()
        self.refused_agent("transition_work_item", id=self.ref, state="done")
        told = self.agent("comment_work_item", id=self.ref, body="Read it, changed the plan")
        self.assertEqual(1, len(told["from_person"]))
        answer = self.agent("transition_work_item", id=self.ref, state="done")
        self.assertEqual("done", answer["state"]["key"])
        self.assertNotIn("overridden", answer)

    def test_a_batch_is_one_write_so_its_own_groups_do_not_clear_the_way(self) -> None:
        self.agent("claim_work_item", id=self.ref)
        self.says("Not so fast")
        message = self.refused_agent(
            "apply_work_item_changes",
            id=self.ref,
            comment={"body": "All done"},
            summary={"done": "Did it", "next": "Nothing"},
            transition={"state": "done"},
        )
        self.assertIn("transition:", message)
        self.assertIn("[person_spoke]", message)
        self.assertIn("Not so fast", message)
        self.assertEqual("dev", self.status())
        self.assertEqual(["comment"], self.kinds())

    def test_a_batch_with_force_closes_and_carries_the_words(self) -> None:
        self.agent("claim_work_item", id=self.ref)
        self.says("Not so fast")
        answer = self.agent(
            "apply_work_item_changes",
            id=self.ref,
            summary={"done": "Did it", "next": "Nothing"},
            transition={"state": "done", "force": True},
        )
        self.assertEqual(["person_spoke"], answer["overridden"])
        self.assertEqual("Not so fast", answer["from_person"][0]["text"])

    def test_a_close_with_an_empty_window_is_not_refused(self) -> None:
        self.worked()
        self.assertEqual(
            "done", self.agent("transition_work_item", id=self.ref, state="done")["state"]["key"]
        )

    def test_a_person_closing_is_not_guarded(self) -> None:
        self.worked()
        self.says("I will close this myself")
        answer = self.person("/api/planning/work-item/transition", id=self.ref, state="done")
        self.assertEqual("done", answer["state"]["key"])
        self.assertNotIn("overridden", answer)

    def test_the_runner_closing_outside_any_call_is_not_guarded(self) -> None:
        self.worked()
        self.says()
        closed = service.transition_work_item(self.conn, self.ref, "done", author="runner")
        self.conn.commit()
        self.assertEqual("done", closed["state"]["key"])

    def test_words_landing_after_the_guard_read_still_come_back_with_the_close(self) -> None:
        """A comment moves no revision, so a close can pass just before one; it is not lost."""

        self.worked()
        other = store.connect()
        self.addCleanup(other.close)
        landed: list[bool] = []

        def race(sql: str) -> None:
            if not landed and sql.startswith("UPDATE work_items"):
                landed.append(True)
                with calls.bind(calls.browser(), "/api/planning/work-item/comment"):
                    service.comment_work_item(other, self.ref, "Too late?", author="user")
                other.commit()

        self.conn.set_trace_callback(race)
        answer = self.agent("transition_work_item", id=self.ref, state="done")
        self.conn.set_trace_callback(None)
        self.assertEqual([True], landed)
        self.assertEqual("done", answer["state"]["key"])
        self.assertEqual("Too late?", answer["from_person"][0]["text"])

    def test_merging_an_item_a_person_moved_is_refused_until_forced(self) -> None:
        other = service.create_work_item(self.conn, space=self.space["key"], title="Merge me")
        self.conn.commit()
        self.person("/api/planning/work-item/transition", id=other["reference"], state="todo")
        message = self.refused_agent("merge_work_items", id=self.ref, items=[other["reference"]])
        self.assertIn("[person_spoke]", message)
        answer = self.agent("merge_work_items", id=self.ref, items=[other["reference"]], force=True)
        self.assertEqual([f"{other['reference']}: person_spoke"], answer["overridden"])

    def test_a_comment_on_a_merged_item_is_named_before_it_moves_out_of_sight(self) -> None:
        """Moved to a survivor an agent wrote to since, it would sit behind that boundary."""

        other = service.create_work_item(self.conn, space=self.space["key"], title="Merge me")
        self.conn.commit()
        self.person("/api/planning/work-item/comment", id=other["reference"], body="Keep this")
        self.agent("comment_work_item", id=self.ref, body="Working the survivor")
        message = self.refused_agent("merge_work_items", id=self.ref, items=[other["reference"]])
        self.assertIn("[person_spoke]", message)
        self.assertIn("Keep this", message)
        answer = self.agent("merge_work_items", id=self.ref, items=[other["reference"]], force=True)
        self.assertEqual([f"{other['reference']}: person_spoke"], answer["overridden"])
        history = service.get_work_item(self.conn, other["reference"])["events"]
        self.assertEqual(
            1,
            [(event["action"], event["detail"]) for event in history].count(
                ("overridden", "person_spoke")
            ),
        )


class AfterAPersonClosedTests(Harness):
    def test_the_next_write_on_a_cancelled_item_says_so_once(self) -> None:
        self.agent("claim_work_item", id=self.ref)
        steps = self.agent("set_work_item_checklist", id=self.ref, items=["One"])
        self.person(
            "/api/planning/work-item/summary",
            id=self.ref,
            summary={"done": "Not needed: we dropped it", "next": "Nothing"},
        )
        self.person("/api/planning/work-item/transition", id=self.ref, state="cancelled")
        answer = self.agent(
            "tick_work_item_checklist_item", id=self.ref, item_id=steps["checklist"][0]["item_id"]
        )
        told = answer["from_person"]
        self.assertEqual(["report", "status", "released"], [event["kind"] for event in told])
        self.assertTrue(told[1]["text"].startswith("cancelled"))
        self.assertIn("Not needed: we dropped it", told[0]["text"])
        self.assertNotIn(
            "from_person", self.agent("comment_work_item", id=self.ref, body="Understood")
        )

    def test_a_refused_write_on_it_keeps_the_news_for_the_next_one(self) -> None:
        self.agent("claim_work_item", id=self.ref)
        self.person(
            "/api/planning/work-item/summary",
            id=self.ref,
            summary={"done": "Dropped", "next": "Nothing"},
        )
        self.person("/api/planning/work-item/transition", id=self.ref, state="cancelled")
        message = self.refused_agent("transition_work_item", id=self.ref, state="done")
        self.assertIn("[person_spoke]", message)
        answer = self.agent("comment_work_item", id=self.ref, body="Seen")
        self.assertIn("status", [event["kind"] for event in answer["from_person"]])


class OneItemTwoAgentsTests(Harness):
    def test_the_subagent_writing_first_is_told_and_the_orchestrator_is_not_told_again(
        self,
    ) -> None:
        self.agent("claim_work_item", id=self.ref)
        self.says("For whoever does this")
        told = self.agent("comment_work_item", meta=SUBAGENT, id=self.ref, body="On it")
        self.assertEqual(["For whoever does this"], [e["text"] for e in told["from_person"]])
        after = self.agent("comment_work_item", id=self.ref, body="Checking in")
        self.assertNotIn("from_person", after)

    def test_the_orchestrator_writing_first_is_told_and_then_the_subagent_is_not(self) -> None:
        self.agent("claim_work_item", meta=SUBAGENT, id=self.ref)
        self.says("For whoever does this")
        told = self.agent("comment_work_item", id=self.ref, body="Passing it on")
        self.assertEqual(["For whoever does this"], [e["text"] for e in told["from_person"]])
        after = self.agent("comment_work_item", meta=SUBAGENT, id=self.ref, body="Understood")
        self.assertNotIn("from_person", after)

    def test_either_of_them_closing_answers_to_the_same_window(self) -> None:
        self.agent("claim_work_item", id=self.ref)
        self.summary()
        self.says()
        self.assertIn(
            "[person_spoke]",
            self.refused_agent("transition_work_item", meta=SUBAGENT, id=self.ref, state="done"),
        )
        self.assertIn(
            "[person_spoke]", self.refused_agent("transition_work_item", id=self.ref, state="done")
        )
        self.agent("comment_work_item", meta=SUBAGENT, id=self.ref, body="Handled")
        self.assertEqual(
            "done", self.agent("transition_work_item", id=self.ref, state="done")["state"]["key"]
        )


if __name__ == "__main__":
    unittest.main()
