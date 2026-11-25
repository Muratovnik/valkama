"""The `MessageDisplay` hook endpoint: what the client gets, on a real listener.

The oracle for "a real item" is the `/open` route itself, followed over HTTP, so the
batched read cannot drift from what a click on the link does. The oracle for the list
under a reply is the hook contract's section on it: whose writes, since when, and
what one line holds, with the agents' writes made through the MCP tools as a client
makes them.
"""

from __future__ import annotations

import contextlib
import http.client
import io
import json
import os
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock
from urllib.parse import urlsplit

from server import http_surface, mcp_surface, store
from server.alerts import settings as alert_settings
from server.hooks import ingest, normalize
from server.planning import (
    acknowledgements,
    api,
    calls,
    display_links,
    display_writes,
    interactions,
    service,
)
from tests.test_work_item_link import LinkedStoreCase

MESSAGE_ID = "5b2a9c8e-1f63-4d8a-b7c4-9e0d2a6f1c3b"
#: The session whose own conversation writes the message, and the others around it.
ME = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
OTHER = "019a3c2e-7777-7c11-9e0f-2f4b6d8a1c3e"
CHILD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
#: Codex proves its session in `_meta`, the shortest door in a test; a thread id
#: other than the session is one of its subagents.
AS_ME = {"sessionId": ME}
AS_OTHER = {"sessionId": OTHER}
AS_CHILD = {"sessionId": ME, "threadId": CHILD}
FIELDS = [{"id": "path", "label": "Which path?", "type": "text", "required": True, "options": []}]


def batch(
    delta: str,
    *,
    index: int = 0,
    final: bool = True,
    message_id: str = MESSAGE_ID,
    session_id: str = "abc123",
) -> dict:
    return {
        "session_id": session_id,
        "transcript_path": "C:\\work\\t.jsonl",
        "cwd": "C:\\work",
        "hook_event_name": "MessageDisplay",
        "turn_id": "0c9e6a2f-7d41-4f4e-9a15-3f4f7c2b8d10",
        "message_id": message_id,
        "index": index,
        "final": final,
        "delta": delta,
    }


def shown(delta: str, url: str = "http://u") -> str:
    return delta.replace("MAIN-1", f"[MAIN-1]({url})")


class OpenMessagesTests(unittest.TestCase):
    """The state between batches, without a store: no candidate ever opens one.

    The payloads name no session, so no last batch asks for the list either.
    """

    def setUp(self) -> None:
        self.open_store = mock.Mock(side_effect=AssertionError("the store was opened"))
        self.messages = display_links.OpenMessages(limit=2)

    def answer(self, payload: dict) -> dict:
        payload = {name: value for name, value in payload.items() if name != "session_id"}
        return display_links.answer(
            payload,
            self.open_store,
            "unused",
            messages=self.messages,
            shown=display_writes.ShownCalls(),
        )

    def test_a_text_with_no_candidate_never_opens_the_store(self) -> None:
        for text in ("", "plain text\n", "`MAIN-1`", "```\nMAIN-1\n```\n", "http://x/MAIN-1"):
            with self.subTest(text=text):
                self.assertEqual({}, self.answer(batch(text)))
        self.open_store.assert_not_called()

    def test_the_final_batch_releases_the_message_even_when_empty(self) -> None:
        self.answer(batch("a\n", index=0, final=False))
        self.assertEqual(1, len(self.messages))
        self.answer(batch("", index=1, final=True))
        self.assertEqual(0, len(self.messages))

    def test_the_bound_pushes_out_the_oldest_message(self) -> None:
        for name in ("a", "b", "c"):
            self.answer(batch("x\n", final=False, message_id=name))
        self.assertEqual(2, len(self.messages))
        self.assertIsNone(self.messages.take("a", 1))
        self.assertIsNotNone(self.messages.take("c", 1))

    def test_a_batch_of_a_message_it_never_saw_is_left_alone_to_the_end(self) -> None:
        # A restart: the first batch opened a fence in the process that is gone.
        for index, final in ((1, False), (2, False), (3, True)):
            self.assertEqual({}, self.answer(batch("MAIN-1\n", index=index, final=final)))
        self.assertEqual(0, len(self.messages))
        self.open_store.assert_not_called()

    def test_a_skipped_batch_ends_linking_for_that_message(self) -> None:
        self.answer(batch("```\n", index=0, final=False))
        self.assertEqual({}, self.answer(batch("MAIN-1\n", index=2, final=False)))
        self.assertEqual({}, self.answer(batch("MAIN-1\n", index=3, final=True)))
        self.open_store.assert_not_called()

    def test_a_fence_held_between_batches_protects_the_next_one(self) -> None:
        self.answer(batch("```\n", index=0, final=False))
        self.assertEqual({}, self.answer(batch("MAIN-1\n", index=1, final=False)))
        self.open_store.assert_not_called()

    def test_a_payload_that_is_not_a_batch_answers_nothing(self) -> None:
        for change in (
            {"hook_event_name": "Stop"},
            {"delta": None},
            {"delta": 5},
            {"message_id": None},
            {"message_id": ""},
            {"message_id": "x" * 129},
            {"index": True},
            {"index": -1},
            {"index": "0"},
            {"final": "yes"},
        ):
            with self.subTest(change=change):
                self.assertEqual({}, self.answer({**batch("MAIN-1"), **change}))
        self.open_store.assert_not_called()

    def test_a_batch_with_too_many_candidates_is_left_alone(self) -> None:
        text = " ".join(f"MAIN-{number}" for number in range(1, display_links.MAX_CANDIDATES + 2))
        self.assertEqual({}, self.answer(batch(text)))
        self.open_store.assert_not_called()


class ListenerCase(LinkedStoreCase):
    def setUp(self) -> None:
        super().setUp()
        # The listener keeps each session's place in this module; every test starts afresh.
        shown = mock.patch.object(display_writes, "SHOWN", display_writes.ShownCalls())
        shown.start()
        self.addCleanup(shown.stop)

    def post(
        self,
        payload: object,
        *,
        host: str | None = None,
        headers: dict[str, str] | None = None,
        path: str = display_links.HOOK_PATH,
    ) -> http.client.HTTPResponse:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        self.addCleanup(client.close)
        client.putrequest("POST", path, skip_host=True, skip_accept_encoding=True)
        client.putheader("Host", host or f"127.0.0.1:{self.server.server_port}")
        sent = {"Content-Type": "application/json", **(headers or {})}
        for name, value in sent.items():
            client.putheader(name, value)
        client.putheader("Content-Length", str(len(body)))
        client.endheaders(body)
        return client.getresponse()


class AnswerTests(ListenerCase):
    def displayed(self, payload: dict) -> str | None:
        response = self.post(payload)
        body = response.read()
        self.assertEqual(200, response.status)
        if not body:
            return None
        answer = json.loads(body)
        self.assertEqual({"hookSpecificOutput"}, set(answer))
        self.assertEqual("MessageDisplay", answer["hookSpecificOutput"]["hookEventName"])
        return answer["hookSpecificOutput"]["displayContent"]

    def test_a_real_item_comes_back_as_the_link_a_tool_hands_out(self) -> None:
        url = acknowledgements.work_item_url("MAIN-1")
        self.assertEqual(
            f"См. [MAIN-1]({url}) и UTF-8.\n", self.displayed(batch("См. MAIN-1 и UTF-8.\n"))
        )

    def test_no_real_item_answers_an_empty_body_with_a_success_status(self) -> None:
        self.assertIsNone(self.displayed(batch("UTF-8 SHA-256 MAIN-99999 XMAIN-1 NOPE-1\n")))
        self.assertIsNone(self.displayed(batch("nothing here\n")))

    def test_a_batch_is_linked_when_its_reference_is_outside_the_code_around_it(self) -> None:
        self.assertEqual(
            f"```\nMAIN-1\n```\n`MAIN-1` [MAIN-1]({acknowledgements.work_item_url('MAIN-1')})\n",
            self.displayed(batch("```\nMAIN-1\n```\n`MAIN-1` MAIN-1\n")),
        )

    def test_a_link_is_offered_exactly_where_the_route_leads_to_a_card(self) -> None:
        # MAIN-2 is only in the attached store, LOOSE-1 is in a space no project binds.
        for reference in ("MAIN-1", "MAIN-2", "DOCS-1", "LOOSE-1", "MAIN-3", "DOCS-2", "NOPE-1"):
            with self.subTest(reference=reference):
                response = self.get(f"/open/{reference}?in=browser")
                response.read()
                expected = response.status == 302
                self.assertEqual(
                    f"[{reference}](" in (self.displayed(batch(f"{reference}\n")) or ""), expected
                )

    def test_the_link_a_batch_gets_opens_that_card(self) -> None:
        content = self.displayed(batch("MAIN-1\n"))
        assert content is not None
        address = content[content.index("(") + 1 : content.index(")")]
        self.assert_leads_to(urlsplit(address).path, "example-project", self.main, "MAIN-1")

    def test_a_message_in_parts_keeps_its_fence_across_requests(self) -> None:
        self.assertIsNone(self.displayed(batch("```\n", index=0, final=False)))
        self.assertIsNone(self.displayed(batch("MAIN-1\n", index=1, final=False)))
        self.assertIsNone(self.displayed(batch("```\n", index=2, final=False)))
        self.assertIn("[MAIN-1](", self.displayed(batch("MAIN-1", index=3, final=True)) or "")

    def test_many_candidates_cost_one_read_of_the_items(self) -> None:
        statements: list[str] = []

        def traced() -> sqlite3.Connection:
            conn = store.open_read_only()
            conn.set_trace_callback(statements.append)
            return conn

        references = " ".join(f"MAIN-{number}" for number in range(1, 51))
        answer = display_links.answer(
            batch(references), traced, store.db_path(), messages=display_links.OpenMessages()
        )
        self.assertIn("[MAIN-1](", str(answer))
        self.assertEqual(1, sum("work_items" in statement for statement in statements), statements)

    def test_an_attached_store_is_not_opened_for_a_key_only_the_primary_holds(self) -> None:
        with mock.patch.object(interactions.scopes, "open_readonly") as opened:
            self.assertIn("[DOCS-1](", self.displayed(batch("DOCS-1\n")) or "")
        opened.assert_not_called()

    def test_an_attached_store_that_cannot_be_read_costs_only_its_own_links(self) -> None:
        with mock.patch.object(
            interactions.scopes, "open_readonly", side_effect=sqlite3.OperationalError("gone")
        ):
            self.assertEqual(
                f"[MAIN-1]({acknowledgements.work_item_url('MAIN-1')}) MAIN-2\n",
                self.displayed(batch("MAIN-1 MAIN-2\n")),
            )


class Writes:
    """Writes as they reach a store: an agent's through its tools, a person's through the
    interface's boundary, a prompt through the hook that records it."""

    conn: sqlite3.Connection

    def tool(self, name: str, meta: object = AS_ME, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, name, arguments, meta=meta)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def create(self, title: str, meta: object = AS_ME) -> str:
        return str(self.tool("create_work_item", meta, space="MAIN", title=title)["reference"])

    def comment(self, reference: str, meta: object = AS_ME) -> None:
        self.tool("apply_work_item_changes", meta, id=reference, comment={"body": "A note"})

    def person_comments(self, reference: str) -> None:
        path = "/api/planning/work-item/comment"
        with calls.bind(calls.browser(), path):
            api.handle_post(self.conn, path, {"id": reference, "body": "A person's note"})
        self.conn.commit()

    def prompt(self, session_id: str = ME) -> None:
        event = normalize.lifecycle_event(
            "claude",
            "user-prompt-submit",
            {"session_id": session_id, "hook_event_name": "UserPromptSubmit"},
            event_uid=str(uuid.uuid4()),
            occurred_at="2026-11-01T10:00:00.000Z",
        )
        assert event is not None
        ingest.record(self.conn, event, delivery="direct")
        self.conn.commit()


def line(reference: str, title: str, done: str = "") -> str:
    """One line of the list as the hook contract spells it."""

    return f"- [{reference}]({acknowledgements.work_item_url(reference)}) «{title}»{done}"


class WrittenListTests(Writes, unittest.TestCase):
    """The list under the last batch of a message, on a store the tools wrote to."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        environment = mock.patch.dict(
            os.environ, {"VALKAMA_DB": str(Path(directory.name) / "store.sqlite3")}
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="p", name="Main", key="MAIN")
        alert_settings.write(self.conn, {"locale": "en"})
        self.conn.commit()
        # This store has no project registry; which numbers lead to a card is the
        # listener cases' subject, so here every listed one does.
        every = mock.patch.object(
            display_links, "existing_references", lambda _conn, _db, references: set(references)
        )
        every.start()
        self.addCleanup(every.stop)
        self.shown = display_writes.ShownCalls()
        self.messages = display_links.OpenMessages()
        self.opened = 0

    def open_store(self) -> sqlite3.Connection:
        self.opened += 1
        return store.open_read_only()

    def answer(self, payload: dict) -> str | None:
        answer = display_links.answer(
            payload, self.open_store, store.db_path(), messages=self.messages, shown=self.shown
        )
        if not answer:
            return None
        content = answer["hookSpecificOutput"]
        assert isinstance(content, dict)
        return str(content["displayContent"])

    def reply(self, delta: str = "Done.\n", **payload: object) -> str | None:
        return self.answer({**batch(delta, session_id=ME), **payload})

    def test_the_last_batch_lists_what_the_conversation_wrote_since_the_prompt(self) -> None:
        self.prompt()
        reference = self.create("Fix the parser")
        self.comment(reference)
        self.assertIsNone(self.reply("Working on it\n", index=0, final=False))
        self.assertEqual(0, self.opened, "a batch that is not the last reads no store")
        self.assertEqual(
            f"Done.\n\n---\n{line(reference, 'Fix the parser', ' — created, comment added')}",
            self.reply("Done.\n", index=1, final=True),
        )

    def test_a_subagent_or_a_payload_without_a_session_gets_no_list(self) -> None:
        self.prompt()
        self.create("Fix the parser")
        for change in ({"agent_id": "a1"}, {"session_id": None}, {"session_id": ""}):
            with self.subTest(change=change):
                self.assertIsNone(self.answer({**batch("Done.\n", session_id=ME), **change}))
        self.assertEqual(0, len(self.shown))

    def test_only_this_conversations_own_writes_are_listed(self) -> None:
        self.prompt()
        self.prompt(OTHER)
        own = self.create("Own")
        theirs = self.create("Another session's", AS_OTHER)
        child = self.create("A subagent's", AS_CHILD)
        persons = self.create("Written on by a person", AS_OTHER)
        self.person_comments(persons)
        self.person_comments(own)
        self.comment(theirs, AS_OTHER)
        self.comment(own, AS_OTHER)
        self.comment(child, AS_CHILD)
        self.assertEqual(
            f"Done.\n\n---\n{line(own, 'Own', ' — created')}",
            self.reply(),
        )

    def test_the_other_end_of_a_link_or_a_mention_gets_no_line(self) -> None:
        other = self.create("Theirs", AS_OTHER)
        self.prompt()
        own = str(
            self.tool(
                "create_work_item",
                space="MAIN",
                title="Own",
                links=[{"other": other, "kind": "relates-to"}],
            )["reference"]
        )
        self.tool("apply_work_item_changes", id=own, comment={"body": f"Follows {other}"})
        self.assertEqual(
            f"Done.\n\n---\n{line(own, 'Own', ' — created, comment added')}", self.reply()
        )

    def test_the_next_message_lists_only_what_came_after_the_last_list(self) -> None:
        self.prompt()
        first = self.create("First")
        self.assertIn(first, self.reply() or "")
        second = self.create("Second")
        self.assertEqual(
            f"Done.\n\n---\n{line(second, 'Second', ' — created')}",
            self.reply(message_id="second"),
        )
        self.assertIsNone(self.reply(message_id="third"))

    def test_with_no_place_kept_the_list_starts_after_the_latest_prompt(self) -> None:
        before = self.create("Before the prompt")
        self.prompt()
        after = self.create("After the prompt")
        content = self.reply() or ""
        self.assertNotIn(before, content)
        self.assertIn(line(after, "After the prompt", " — created"), content)

    def test_with_no_prompt_either_it_lists_nothing_and_starts_from_there(self) -> None:
        self.create("Before any prompt")
        self.assertIsNone(self.reply())
        later = self.create("Later")
        self.assertEqual(
            f"Done.\n\n---\n{line(later, 'Later', ' — created')}",
            self.reply(message_id="second"),
        )

    def everything(self, reference: str) -> None:
        self.tool(
            "apply_work_item_changes",
            id=reference,
            summary={"done": "The change", "next": "Nothing"},
            questions=[{"kind": "question", "prompt": "Which path?", "fields": FIELDS}],
            comment={"body": "A note"},
            checklist=["One step"],
            transition={"state": "todo"},
        )

    def steps(self, reference: str, *texts: str) -> list[str]:
        """Set *reference*'s steps and answer their ids."""

        applied = self.tool("apply_work_item_changes", id=reference, checklist=list(texts))
        return [str(step["item_id"]) for step in applied["applied"]["checklist"]]

    def test_each_phrase_in_its_fixed_order(self) -> None:
        self.prompt()
        busy = self.create("Everything")
        self.everything(busy)
        expected = (
            " — created, moved to Todo, steps changed, comment added,"
            " question put to the owner, summary written"
        )
        self.assertEqual(f"Done.\n\n---\n{line(busy, 'Everything', expected)}", self.reply())

    def test_an_item_no_phrase_fits_is_said_to_have_changed(self) -> None:
        labelled = self.create("Labels")
        referred = self.create("Only a ref")
        self.prompt()
        self.tool("apply_work_item_changes", id=labelled, update={"labels": ["x"]})
        self.tool(
            "apply_work_item_changes",
            id=referred,
            refs=[{"kind": "url", "value": "https://example.com/a"}],
        )
        self.assertEqual(
            "Done.\n\n---\n"
            + line(labelled, "Labels", " — labels changed")
            + "\n"
            + line(referred, "Only a ref", " — changed"),
            self.reply(),
        )

    def test_steps_say_what_was_done_to_them_and_to_how_many(self) -> None:
        ticked = self.create("Ticked")
        one, two, three = self.steps(ticked, "One", "Two", "Three")
        relisted = self.create("Relisted")
        self.prompt()
        self.tool(
            "apply_work_item_changes",
            id=ticked,
            checklist_ticks=[{"item_id": one}, {"item_id": two}, {"item_id": three}],
        )
        self.tool(
            "apply_work_item_changes", id=ticked, checklist_ticks=[{"item_id": two, "done": False}]
        )
        self.steps(relisted, "Another")
        self.assertEqual(
            "Done.\n\n---\n"
            + line(ticked, "Ticked", " — steps ticked: 3, steps reopened: 1")
            + "\n"
            + line(relisted, "Relisted", " — steps changed"),
            self.reply(),
        )

    def test_a_claim_says_the_move_it_made_and_a_later_move_is_said_too(self) -> None:
        started = self.create("Started")
        finished = self.create("Finished")
        self.prompt()
        self.tool("apply_work_item_changes", id=started, claim=True)
        self.tool("apply_work_item_changes", id=finished, claim=True)
        self.tool("apply_work_item_changes", id=finished, transition={"state": "todo"})
        self.assertEqual(
            "Done.\n\n---\n"
            + line(started, "Started", " — claimed")
            + "\n"
            + line(finished, "Finished", " — claimed, moved to Todo"),
            self.reply(),
        )

    def test_a_resolved_thread_has_a_phrase_of_its_own(self) -> None:
        discussed = self.create("Discussed")
        thread = self.tool("apply_work_item_changes", id=discussed, comment={"body": "A note"})
        self.prompt()
        self.tool(
            "apply_work_item_changes",
            id=discussed,
            resolutions=[{"comment_id": thread["applied"]["comment"]["comment_id"]}],
        )
        self.assertEqual(
            f"Done.\n\n---\n{line(discussed, 'Discussed', ' — discussion resolved')}", self.reply()
        )

    def test_a_link_made_from_another_item_adds_nothing_to_this_ones_line(self) -> None:
        self.prompt()
        first = self.create("First")
        self.comment(first)
        second = self.tool(
            "create_work_item",
            space="MAIN",
            title="Second",
            links=[{"other": first, "kind": "relates-to"}],
        )
        self.assertEqual(
            "Done.\n\n---\n"
            + line(first, "First", " — created, comment added")
            + "\n"
            + line(str(second["reference"]), "Second", " — created"),
            self.reply(),
        )

    def test_what_a_new_item_is_made_with_is_said_by_created_alone(self) -> None:
        other = self.create("Theirs", AS_OTHER)
        self.prompt()
        made = self.tool(
            "create_work_item",
            space="MAIN",
            title="Made whole",
            labels=["x"],
            checklist=["One step"],
            links=[{"other": other, "kind": "relates-to"}],
        )
        later = self.create("Linked later")
        self.tool(
            "apply_work_item_changes", id=later, links=[{"other": other, "kind": "relates-to"}]
        )
        self.assertEqual(
            "Done.\n\n---\n"
            + line(str(made["reference"]), "Made whole", " — created")
            + "\n"
            + line(later, "Linked later", " — created, links changed"),
            self.reply(),
        )

    def test_a_moved_item_is_named_by_the_state_it_is_in_now(self) -> None:
        reference = self.create("Moved twice")
        self.prompt()
        self.tool("apply_work_item_changes", id=reference, transition={"state": "todo"})
        self.tool(
            "apply_work_item_changes", AS_OTHER, id=reference, transition={"state": "backlog"}
        )
        self.assertEqual(
            f"Done.\n\n---\n{line(reference, 'Moved twice', ' — moved to Backlog')}", self.reply()
        )

    def test_a_question_in_a_comments_list_is_the_comments_alone(self) -> None:
        reference = self.create("Listed")
        self.prompt()
        options = [{"id": "a", "label": "Widen the check"}]
        self.tool(
            "apply_work_item_changes",
            id=reference,
            comment={"body": "Findings", "list": {"label": "What to take on", "options": options}},
        )
        self.assertEqual(
            f"Done.\n\n---\n{line(reference, 'Listed', ' — comment added')}", self.reply()
        )

    def test_a_title_is_folded_cut_and_shown_literally(self) -> None:
        self.prompt()
        odd = self.create("#  [x](y)   *b*\n`c` <d> | e_f")
        long = self.create("a" * 100)
        self.assertEqual(
            "Done.\n\n---\n"
            + line(odd, r"\# \[x\]\(y\) \*b\* \`c\` \<d\> \| e\_f", " — created")
            + "\n"
            + line(long, "a" * 79 + "…", " — created"),
            self.reply(),
        )

    def test_twelve_lines_then_one_counting_the_rest(self) -> None:
        self.prompt()
        made = [self.create(f"Item {number}") for number in range(14)]
        content = self.reply() or ""
        self.assertEqual(
            [
                line(reference, f"Item {number}", " — created")
                for number, reference in enumerate(made[:12])
            ]
            + ["- and 2 more items"],
            content.split("\n---\n", 1)[1].split("\n"),
        )
        for number in range(13):
            self.create(f"More {number}")
        self.assertTrue((self.reply(message_id="next") or "").endswith("\n- and 1 more item"))

    def test_russian_words_and_counts(self) -> None:
        alert_settings.write(self.conn, {"locale": "ru"})
        self.conn.commit()
        self.prompt()
        lasts = []
        for message, count in enumerate((13, 14, 17)):
            made = [self.create(f"Задача {number}") for number in range(count)]
            self.comment(made[0])
            lines = (self.reply(message_id=str(message)) or "").split("\n---\n", 1)[1].split("\n")
            self.assertEqual(
                line(made[0], "Задача 0", " — создана, добавлен комментарий"), lines[0]
            )
            lasts.append(lines[-1])
        self.assertEqual(["- и ещё 1 задача", "- и ещё 2 задачи", "- и ещё 5 задач"], lasts)
        whole = self.create("Всё сразу")
        self.assertIn(whole, self.reply(message_id="made") or "")
        self.tool("apply_work_item_changes", id=whole, claim=True, update={"labels": ["x"]})
        self.everything(whole)
        (step,) = self.steps(whole, "Один шаг")
        self.tool("apply_work_item_changes", id=whole, checklist_ticks=[{"item_id": step}])
        self.tool(
            "apply_work_item_changes", id=whole, checklist_ticks=[{"item_id": step, "done": False}]
        )
        self.assertEqual(
            "Done.\n\n---\n"
            + line(
                whole,
                "Всё сразу",
                " — взята в работу, переведена в Todo, изменён список шагов, отмечено шагов: 1,"
                " возвращено шагов: 1, добавлен комментарий, задан вопрос владельцу,"
                " записан итог, изменены метки",
            ),
            self.reply(message_id="whole"),
        )
        self.assertEqual(
            ["задача", "задачи", "задач", "задач", "задача", "задач"],
            [
                display_writes._plural(("задача", "задачи", "задач"), count, "ru")
                for count in (1, 2, 5, 11, 21, 112)
            ],
        )

    def test_a_message_that_ends_inside_a_fence_leaves_the_list_to_the_next(self) -> None:
        self.prompt()
        reference = self.create("Deferred")
        self.assertIsNone(self.reply("```\ncode\n"))
        self.assertEqual(
            f"Done.\n\n---\n{line(reference, 'Deferred', ' — created')}",
            self.reply(message_id="next"),
        )

    def test_an_unseen_batch_leaves_the_list_to_the_next_message(self) -> None:
        self.prompt()
        reference = self.create("Deferred")
        self.assertIsNone(self.reply(index=2, final=True))
        self.assertIn(reference, self.reply(message_id="next") or "")

    def test_the_rule_stands_past_a_blank_line_whatever_the_text_ends_with(self) -> None:
        self.prompt()
        reference = self.create("Rule")
        rule = f"---\n{line(reference, 'Rule', ' — created')}"
        for delta, shown in (
            ("Done.", "Done.\n\n"),
            ("Done.\n", "Done.\n\n"),
            ("Done.\n\n", "Done.\n\n"),
            ("", "\n"),
        ):
            with self.subTest(delta=delta):
                self.shown = display_writes.ShownCalls()
                self.assertEqual(shown + rule, self.reply(delta, message_id=delta or "empty"))

    def test_nothing_written_or_only_a_deleted_item_answers_nothing(self) -> None:
        self.prompt()
        self.assertIsNone(self.reply())
        reference = self.create("Gone")
        self.tool("delete_work_item", id=reference)
        self.assertIsNone(self.reply(message_id="second"))

    def test_the_session_place_is_bounded(self) -> None:
        shown = display_writes.ShownCalls(limit=2)
        for session_id in ("a", "b", "c"):
            shown.keep(session_id, 1)
        self.assertEqual((2, None, 1), (len(shown), shown.since("a"), shown.since("c")))


class ListAndLinksTests(Writes, ListenerCase):
    def test_links_and_the_list_come_in_one_answer(self) -> None:
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        alert_settings.write(self.conn, {"locale": "en"})
        self.prompt()
        self.comment("MAIN-1")
        response = self.post(batch("See MAIN-1.\n", session_id=ME))
        content = json.loads(response.read())["hookSpecificOutput"]["displayContent"]
        url = acknowledgements.work_item_url("MAIN-1")
        self.assertEqual(
            f"See [MAIN-1]({url}).\n\n---\n{line('MAIN-1', 'MAIN item 0', ' — comment added')}",
            content,
        )

    def test_an_item_in_a_space_no_project_binds_is_listed_without_a_link(self) -> None:
        # Its address leads to no card, so the number stays plain, as a mention of it does.
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        alert_settings.write(self.conn, {"locale": "en"})
        self.prompt()
        self.comment("LOOSE-1")
        self.comment("MAIN-1")
        response = self.post(batch("Done.\n", session_id=ME))
        content = json.loads(response.read())["hookSpecificOutput"]["displayContent"]
        self.assertEqual(
            "Done.\n\n---\n- LOOSE-1 «LOOSE item 0» — comment added\n"
            + line("MAIN-1", "MAIN item 0", " — comment added"),
            content,
        )


class NothingReachesTheReaderTests(ListenerCase):
    def assert_empty_success(self, response: http.client.HTTPResponse) -> None:
        self.assertEqual((200, b""), (response.status, response.read()))

    def test_an_internal_error_answers_as_if_nothing_changed_and_logs_no_text(self) -> None:
        reply = "PRIVATE-TEXT MAIN-1"
        error = RuntimeError(reply)
        stderr = io.StringIO()
        with (
            mock.patch.object(display_links, "answer", side_effect=error),
            contextlib.redirect_stderr(stderr),
        ):
            self.assert_empty_success(self.post(batch(reply)))
        self.assertEqual("message display hook: RuntimeError\n", stderr.getvalue())

    def test_a_store_that_will_not_open_answers_as_if_nothing_changed(self) -> None:
        failure = sqlite3.OperationalError("unable to open database file")
        with (
            mock.patch.object(http_surface, "open_read_only", side_effect=failure),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assert_empty_success(self.post(batch("MAIN-1\n")))

    def test_a_malformed_registry_links_nothing_and_a_missing_one_too(self) -> None:
        self.registry.write_bytes(b"{")
        self.assert_empty_success(self.post(batch("MAIN-1\n")))
        self.registry.unlink()
        self.assert_empty_success(self.post(batch("MAIN-1\n")))

    def test_the_text_is_written_nowhere_and_no_call_is_recorded(self) -> None:
        marker = "UNIQUEMARKER MAIN-1 UNIQUEMARKER"
        conn = store.connect()
        self.addCleanup(conn.close)
        tables = [
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]

        def counts() -> dict[str, int]:
            return {
                table: conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                for table in tables
            }

        before = counts()
        self.post(batch(marker)).read()
        self.assertEqual(before, counts())
        for path in self.root.rglob("*"):
            if path.is_file():
                with self.subTest(path=path.name):
                    self.assertNotIn(b"UNIQUEMARKER", path.read_bytes())


class GuardTests(ListenerCase):
    def assert_refused(self, status: int, code: str, response: http.client.HTTPResponse) -> None:
        body = response.read()
        self.assertEqual(status, response.status)
        self.assertEqual(code, json.loads(body)["error"]["code"])
        self.assertNotIn(b"MAIN-1", body)
        self.assertIsNone(response.getheader("Access-Control-Allow-Origin"))

    def test_a_page_of_any_site_is_refused_before_the_text_is_read(self) -> None:
        with mock.patch.object(display_links, "answer") as answered:
            for headers in (
                {"Origin": "https://evil.example"},
                {"Origin": "null"},
                {"Origin": f"http://127.0.0.1:{self.server.server_port}"},
                {"Sec-Fetch-Site": "cross-site"},
                {"Sec-Fetch-Site": "same-origin"},
                {"Sec-Fetch-Site": "none"},
            ):
                with self.subTest(headers=headers):
                    self.assert_refused(
                        403, "origin_refused", self.post(batch("MAIN-1"), headers=headers)
                    )
        answered.assert_not_called()

    def test_a_foreign_host_is_refused(self) -> None:
        response = self.post(batch("MAIN-1"), host="evil.example")
        self.assert_refused(400, "invalid_host", response)

    def test_localhost_is_a_foreign_host_so_the_registration_must_name_the_address(self) -> None:
        port = self.server.server_port
        self.assert_refused(400, "invalid_host", self.post(batch("x"), host=f"localhost:{port}"))

    def test_only_framed_json_is_read(self) -> None:
        response = self.post(batch("MAIN-1"), headers={"Content-Type": "text/plain"})
        self.assert_refused(415, "unsupported_media_type", response)

    def test_a_larger_message_than_the_bound_is_refused_and_shows_as_it_was(self) -> None:
        response = self.post(batch("x" * (1024 * 1024 + 1)))
        self.assert_refused(413, "request_too_large", response)

    def test_a_long_message_within_the_bound_is_answered(self) -> None:
        response = self.post(batch("MAIN-1\n" + "x" * 900_000))
        self.assertEqual(200, response.status)
        self.assertIn("[MAIN-1](", response.read().decode("utf-8"))

    def test_the_answer_carries_no_cors_header_a_page_could_read_it_by(self) -> None:
        response = self.post(batch("MAIN-1"))
        response.read()
        self.assertEqual(200, response.status)
        self.assertFalse(
            [name for name, _ in response.getheaders() if "access-control" in name.lower()]
        )

    def test_the_browser_credential_routes_are_unchanged_for_the_same_caller(self) -> None:
        # What lets the hook in must let nothing else in.
        response = self.post({"text": "MAIN-1"}, path="/api/planning/comment")
        response.read()
        self.assertEqual(403, response.status)


class OpenReadOnlyTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = self.root / "deep" / "store.sqlite3"
        environment = mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.path)})
        environment.start()
        self.addCleanup(environment.stop)

    def test_a_missing_store_is_refused_and_nothing_is_created(self) -> None:
        self.path.parent.mkdir()
        with self.assertRaises(sqlite3.OperationalError):
            store.open_read_only()
        self.assertEqual([], list(self.path.parent.iterdir()))

    def test_a_missing_directory_stays_missing(self) -> None:
        with self.assertRaises(sqlite3.OperationalError):
            store.open_read_only()
        self.assertFalse(self.path.parent.exists())

    def test_it_cannot_write(self) -> None:
        store.connect().close()
        conn = store.open_read_only()
        self.addCleanup(conn.close)
        with self.assertRaises(sqlite3.OperationalError):
            conn.execute("CREATE TABLE x(y)")

    def test_a_store_at_another_schema_is_refused(self) -> None:
        store.connect().close()
        for offset in (-1, 1):
            conn = sqlite3.connect(self.path)
            conn.execute(f"PRAGMA user_version={store.STORE_SCHEMA_VERSION + offset}")
            conn.commit()
            conn.close()
            with self.subTest(offset=offset), self.assertRaises(sqlite3.OperationalError):
                store.open_read_only()

    def test_a_path_with_uri_characters_opens_the_right_file(self) -> None:
        odd = self.root / "a%20b#c?d" / "store.sqlite3"
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(odd)}):
            if os.name == "nt":
                self.skipTest("'?' cannot be in a Windows path")
            store.connect().close()
            store.open_read_only().close()


if __name__ == "__main__":
    unittest.main()
