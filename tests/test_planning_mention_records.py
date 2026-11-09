"""A comment that names other items in `mentions` tells the work on them; a link in text does not.

The expectations come from the connection contract, "Mentions", and the hook
contract, "Who is told": a person's mention is the person's act on the item it
names, so its holders hear it as they hear any act of a person, it wakes an idle
holder, and it holds a close up until an agent writes there; with nobody holding
the item the record waits on it; a call that proved no session leaves the record
and tells nobody; the comment's own text is never read for numbers.

Another agent's mention is no act of a person: the holders hear it in a block of
its own at their next tool call or prompt, never at `Stop` and never from the
watcher, and it is not lost while it waits; the session that spoke does not hear
it, its subagents included; an agent names at most 5 items in a comment, and one session names one
item at most 3 times an hour.

An agent writes through `mcp_surface.call_tool` with a proved session, a person
through the HTTP boundary as the browser binds it, and the hook answers a payload
shaped like the client's input.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

from server import mcp_surface, store
from server.hooks import notify
from server.planning import (
    api,
    calls,
    mention_records,
    model,
    person_events,
    read_model,
    service,
)

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
CHILD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
ORCHESTRATOR = {"sessionId": SESSION}
SUBAGENT = {"sessionId": SESSION, "threadId": CHILD}
COMMENT = "/api/planning/work-item/comment"
#: A third agent: a second subagent of the session that holds the item.
STRANGER = "019a3c2e-7777-7c11-9e0f-2f4b6d8a1c3e"
#: Another session, the agent that tells the session above.
SPEAKER = "019a3c2e-1111-7c11-9e0f-2f4b6d8a1c3e"
ELSEWHERE = {"sessionId": SPEAKER}
SPEAKER_AGENT = "019a3c2e-2222-7c11-9e0f-2f4b6d8a1c3e"
ELSEWHERE_AGENT = {"sessionId": SPEAKER, "threadId": SPEAKER_AGENT}
SAID = "Decided: keep the new route, marker M-1"
#: What an agents' block begins and ends with, from the hook contract.
AGENTS_HEAD = "Valkama notice from agents, not from a person: another agent mentioned work"
AGENTS_LAST = "Do not answer with a mention unless you have news of your own."
SUMMARY = {"done": "Dropped it", "next": "Nothing"}


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "store", "valkama.sqlite3")
        os.makedirs(os.path.dirname(self.path))
        home = os.path.join(directory.name, "home")
        os.makedirs(home)
        self.environ = {"VALKAMA_DB": self.path, "HOME": home, "USERPROFILE": home}
        patch = mock.patch.dict(os.environ, self.environ)
        patch.start()
        self.addCleanup(patch.stop)
        # A run inside a client session inherits that session's identity.
        for name in ("CLAUDE_CODE_SESSION_ID", "CLAUDE_PID", "VALKAMA_NOTIFY"):
            os.environ.pop(name, None)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="p", name="Quality", key="MAIN")
        #: Where the comment is written, and the item it names.
        self.source = self.item("Decide the route")
        self.target = self.item("Drop the old route")
        self.conn.commit()

    def item(self, title: str) -> str:
        return str(service.create_work_item(self.conn, space="MAIN", title=title)["reference"])

    def agent(self, tool: str, meta: object = ORCHESTRATOR, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, tool, arguments, meta=meta)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def refused_agent(self, tool: str, meta: object = ORCHESTRATOR, **arguments: object) -> dict:
        with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught:
            mcp_surface.call_tool(self.conn, tool, arguments, meta=meta)
        self.conn.rollback()
        error = api.error_response(caught.exception)[1]["error"]
        assert isinstance(error, dict)
        return error

    def person(self, path: str, **payload: object) -> dict:
        with calls.bind(calls.browser(), path):
            answer = api.handle_post(self.conn, path, payload)
        self.conn.commit()
        assert answer is not None
        return answer[1]

    def refused_person(self, **payload: object) -> dict:
        with (
            calls.bind(calls.browser(), COMMENT),
            self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught,
        ):
            api.handle_post(self.conn, COMMENT, payload)
        self.conn.rollback()
        error = api.error_response(caught.exception)[1]["error"]
        assert isinstance(error, dict)
        return error

    def tells(self, body: str = SAID, **extra: object) -> dict:
        """The person's comment on the source, naming the target."""

        return self.person(COMMENT, id=self.source, body=body, mentions=[self.target], **extra)

    def hold(self) -> None:
        """The orchestrator claims the target, and its subagent a step there."""

        self.agent("claim_work_item", id=self.target)
        self.agent("set_work_item_checklist", id=self.target, items=["one"])
        step = service.get_work_item(self.conn, self.target)["checklist"][0]["id"]
        self.agent("claim_work_item_checklist_item", SUBAGENT, id=self.target, item_id=step)

    def hook(
        self, agent_id: str | None = None, event: str = "post-tool-use", client: str = "claude"
    ) -> str | None:
        payload: dict = {"session_id": SESSION}
        if agent_id:
            payload["agent_id"] = agent_id
        answer = notify.deliver(client, event, payload, self.environ)
        if answer is None:
            return None
        return str(json.loads(answer)["hookSpecificOutput"]["additionalContext"])

    def spoken(self, meta: object = ELSEWHERE, body: str = SAID, **extra: object) -> dict:
        """An agent's comment on the source, naming the target."""

        return self.agent(
            "comment_work_item", meta, id=self.source, body=body, mentions=[self.target], **extra
        )

    def marks_path(self) -> str:
        return os.path.join(os.path.dirname(self.path), notify.STATE_DIRECTORY, SESSION + ".marks")

    def window(self, reference: str) -> list[dict]:
        identity = str(service.get_work_item(self.conn, reference)["work_item_id"])
        return person_events.since_last_agent_write(self.conn, identity)

    def events(self, reference: str) -> int:
        identity = str(service.get_work_item(self.conn, reference)["work_item_id"])
        return int(
            self.conn.execute(
                "SELECT COUNT(*) FROM work_item_events WHERE work_item_id = ?"
                " AND action = 'mentioned'",
                (identity,),
            ).fetchone()[0]
        )


class PersonMentionTests(Harness):
    def test_the_holder_and_its_orchestrator_each_hear_it_once(self) -> None:
        self.hold()
        self.assertIsNone(self.hook(), "nothing yet")
        self.assertIsNone(self.hook(CHILD), "nothing yet")
        said = self.tells()
        told = self.hook()
        assert told is not None
        self.assertIn("a person acted", told)
        self.assertIn(f"{self.target} «Drop the old route»:", told)
        self.assertIn(f" from {self.source} #{said['comment_id']}: «{SAID}»", told)
        self.assertIsNone(self.hook(), "once for the orchestrator")
        child = self.hook(CHILD)
        assert child is not None
        self.assertIn("marker M-1", child, "the subagent holding a step hears it itself")
        self.assertIsNone(self.hook(CHILD), "once for the subagent")

    def test_the_next_write_says_it_and_a_close_waits_for_that_write(self) -> None:
        self.agent("claim_work_item", id=self.target)
        self.agent("set_work_item_summary", id=self.target, summary=SUMMARY)
        said = self.tells()
        error = self.refused_agent("transition_work_item", id=self.target, state="cancelled")
        self.assertEqual("workflow_guard", error["code"])
        self.assertIn("[person_spoke]", error["message"])
        self.assertIn(SAID, error["message"])
        answer = self.agent("comment_work_item", id=self.target, body="Read it; dropping now")
        [event] = answer["from_person"]
        self.assertEqual(
            {
                "kind": "mentioned",
                "via": "interface",
                "comment_id": said["comment_id"],
                "from": self.source,
                "text": SAID,
            },
            {name: value for name, value in event.items() if name != "at"},
        )
        closed = self.agent("transition_work_item", id=self.target, state="cancelled")
        self.assertEqual("cancelled", closed["state"]["key"])

    def test_the_mention_does_not_move_the_window_of_the_item_written_on(self) -> None:
        """The comment is the person's on the source too, told there as a comment."""

        self.tells()
        self.assertEqual(["comment"], [event["kind"] for event in self.window(self.source)])
        self.assertEqual(["mentioned"], [event["kind"] for event in self.window(self.target)])


class WatcherTests(Harness):
    def test_an_idle_holder_is_woken_by_a_persons_mention(self) -> None:
        for name, value in (("POLL_SECONDS", 0.05), ("GRACE_SECONDS", 0.5)):
            patch = mock.patch.object(notify, name, value)
            patch.start()
            self.addCleanup(patch.stop)
        self.agent("claim_work_item", id=self.target)
        self.assertIsNone(self.hook(event="stop"))  # idle now

        def mention() -> None:
            conn = store.connect()
            try:
                with calls.bind(calls.browser(), COMMENT):
                    api.handle_post(
                        conn,
                        COMMENT,
                        {"id": self.source, "body": "Wake, marker W-9", "mentions": [self.target]},
                    )
                conn.commit()
            finally:
                conn.close()

        timer = threading.Timer(0.2, mention)
        timer.start()
        self.addCleanup(timer.join)
        stderr = io.BytesIO()
        fake = mock.Mock()
        fake.buffer = stderr
        deadline = time.monotonic() + 20
        pause = time.sleep

        def sleep(seconds: float) -> None:
            if time.monotonic() > deadline:
                raise AssertionError("the watcher was still waiting after 20 s")
            pause(seconds)

        with mock.patch.object(sys, "stderr", fake), mock.patch.object(notify.time, "sleep", sleep):
            status = notify.watch({"session_id": SESSION}, self.environ)
        self.assertEqual(notify.WAKE_STATUS, status)
        text = stderr.getvalue().decode("utf-8")
        self.assertIn("- mentioned at", text)
        self.assertIn("marker W-9", text)


class WhoHearsTests(Harness):
    def test_the_answer_names_the_holders_and_nobody_holding_leaves_it_on_the_item(self) -> None:
        held = self.item("Held elsewhere")
        self.conn.commit()
        self.agent("claim_work_item", id=held)
        said = self.person(COMMENT, id=self.source, body=SAID, mentions=[held, self.target])
        holder = service.get_work_item(self.conn, held)["claim_ref"]
        self.assertEqual(
            [
                {"reference": held, "holders": [holder]},
                {"reference": self.target, "holders": [], "told": mention_records.NO_HOLDER},
            ],
            said["mentions"],
        )
        self.assertEqual("nobody yet: no holder, it stays on the item", mention_records.NO_HOLDER)
        read = self.agent("get_work_item", id=self.target)
        [record] = read["mentions"]
        self.assertEqual(
            {
                "in": "comment",
                "comment_id": said["comment_id"],
                "from": self.source,
                "by_person": True,
                "author": "user",
                "quote": SAID,
            },
            {name: value for name, value in record.items() if name != "at"},
        )
        self.assertEqual(1, read["mentions_total"])
        source = self.agent("get_work_item", id=self.source)
        [comment] = [entry for entry in source["comments"] if entry["id"] == said["comment_id"]]
        self.assertEqual([held, self.target], comment["mentions"])

    def test_a_closed_item_keeps_the_record_and_hears_nothing(self) -> None:
        self.person(
            "/api/planning/work-item/transition", id=self.target, state="cancelled", force=True
        )
        said = self.tells()
        self.assertEqual(
            [{"reference": self.target, "holders": [], "told": "nobody: closed"}], said["mentions"]
        )
        self.assertEqual(1, self.events(self.target))

    def test_the_speaker_does_not_hear_itself(self) -> None:
        """An agent naming an item it holds: no notice to it, and nothing in `from_person`."""

        self.agent("claim_work_item", id=self.target)
        self.assertIsNone(self.hook())
        said = self.agent(
            "comment_work_item", id=self.source, body="Telling my own work", mentions=[self.target]
        )
        self.assertEqual(1, self.events(self.target), "the record is written")
        self.assertEqual(
            [service.get_work_item(self.conn, self.target)["claim_ref"]],
            said["mentions"][0]["holders"],
        )
        self.assertIsNone(self.hook(), "the one who spoke")
        self.assertEqual([], self.window(self.target), "an agent's words are never a person's")
        answer = self.agent("comment_work_item", id=self.target, body="Next write")
        self.assertNotIn("from_person", answer)

    def test_a_report_and_a_batch_say_who_hears(self) -> None:
        reported = self.agent(
            "report_work_item",
            id=self.source,
            report={"done": SAID, "next": "Drop it"},
            mentions=[self.target],
        )
        self.assertEqual(
            [{"reference": self.target, "holders": [], "told": mention_records.NO_HOLDER}],
            reported["mentions"],
        )
        batch = self.agent(
            "apply_work_item_changes",
            id=self.source,
            comments=[{"body": "One", "mentions": [self.target]}, {"body": "Two"}],
        )
        named, plain = batch["applied"]["comments"]
        self.assertEqual([self.target], [entry["reference"] for entry in named["mentions"]])
        self.assertNotIn("mentions", plain)
        read = self.agent("get_work_item", id=self.target)
        self.assertEqual(2, read["mentions_total"])
        self.assertEqual(SAID, read["mentions"][0]["quote"], "a report is quoted by its done")

    def test_an_unproved_call_keeps_the_record_and_tells_nobody(self) -> None:
        self.hold()
        self.assertIsNone(self.hook())
        said = self.agent(
            "comment_work_item", None, id=self.source, body="Unproved", mentions=[self.target]
        )
        [heard] = said["mentions"]
        self.assertEqual("nobody: this call proved no session", heard["told"])
        self.assertTrue(heard["holders"], "the holders are named all the same")
        self.assertEqual(1, self.agent("get_work_item", id=self.target)["mentions_total"])
        self.assertIsNone(self.hook())
        self.assertIsNone(self.hook(CHILD))
        self.assertEqual([], self.window(self.target))

    def test_a_number_in_the_text_is_a_link_and_tells_nobody(self) -> None:
        self.hold()
        self.assertIsNone(self.hook())
        said = self.person(COMMENT, id=self.source, body=f"{self.target} can drop the old route")
        self.assertNotIn("mentions", said)
        self.assertIsNone(self.hook())
        self.assertEqual([], self.window(self.target))
        read = self.agent("get_work_item", id=self.target)
        self.assertEqual(([], 0), (read["mentions"], read["mentions_total"]))
        self.tells()
        self.assertIsNotNone(self.hook(), "positive control: the same words in mentions")


class ReadingTests(Harness):
    def test_an_agent_reads_the_newest_five_whole_reads_all_and_http_fifty(self) -> None:
        written = [self.tells(body=f"Mention {index}")["comment_id"] for index in range(7)]
        read = self.agent("get_work_item", id=self.target)
        self.assertEqual(written[2:], [entry["comment_id"] for entry in read["mentions"]])
        self.assertEqual(7, read["mentions_total"])
        whole = self.agent("get_work_item", id=self.target, full=True)
        self.assertEqual(written, [entry["comment_id"] for entry in whole["mentions"]])
        self.assertNotIn("mentions_total", whole)
        answer = api.handle_get(self.conn, "/api/planning/work-item", {"id": [self.target]})
        assert answer is not None
        http = answer[1]["work_item"]
        self.assertEqual(written, [entry["comment_id"] for entry in http["mentions"]])
        self.assertEqual(7, http["mentions_total"])
        self.assertEqual(50, read_model.HTTP_MENTIONS)

    def test_a_write_answers_with_the_comments_that_named_the_item(self) -> None:
        self.tells()
        claimed = self.person("/api/planning/work-item/claim", id=self.target, author="one")
        updated = self.agent("update_work_item", id=self.target, priority="high", verbose=True)
        for answer in (claimed, updated):
            self.assertEqual(1, answer["mentions_total"])
            self.assertEqual(
                [self.source],
                [entry["from"] for entry in answer["mentions"]],
                "named by the source",
            )

    def test_a_long_comment_is_quoted_short_and_a_deleted_one_by_nothing(self) -> None:
        self.tells(body="x" * 400)
        [record] = self.agent("get_work_item", id=self.target)["mentions"]
        self.assertEqual("x" * 299 + "…", record["quote"])
        service.delete_work_item(self.conn, self.source)
        self.conn.commit()
        [record] = self.agent("get_work_item", id=self.target)["mentions"]
        self.assertEqual((None, None), (record["from"], record["quote"]))

    def test_a_comment_moved_by_a_merge_names_the_survivor(self) -> None:
        survivor = self.item("The survivor")
        self.conn.commit()
        self.tells()
        # The person's comment on the source is unread there, so the merge carries it over.
        self.agent(
            "merge_work_items", id=survivor, items=[self.source], reason="One change", force=True
        )
        [record] = self.agent("get_work_item", id=self.target)["mentions"]
        self.assertEqual(survivor, record["from"])


UPDATE = "/api/planning/work-item/update"
SUMMARY_PATH = "/api/planning/work-item/summary"


class TextMentionTests(Harness):
    """A summary and a description tell as a comment does, and a re-edit wakes nobody twice.

    From the owner's decision that `@` makes a mention wherever a person writes about
    work, and its recorded default: saving a summary or a description again tells only
    the items its previous text did not name.
    """

    def records(self, reference: str) -> list[dict]:
        return list(self.agent("get_work_item", id=reference, full=True)["mentions"])

    def describe(self, text: str, mentions: list[str], **extra: object) -> dict:
        """The person saves the source's description, naming `mentions`."""

        return self.person(UPDATE, id=self.source, description=text, mentions=mentions, **extra)

    def test_a_summary_tells_and_its_record_is_the_summary_comment(self) -> None:
        said = {"done": f"Kept the new route; {self.target} can drop the old one", "next": "None"}
        answer = self.agent(
            "set_work_item_summary", ELSEWHERE, id=self.source, summary=said, mentions=[self.target]
        )
        self.assertEqual(
            [{"reference": self.target, "holders": [], "told": mention_records.NO_HOLDER}],
            answer["mentions"],
        )
        [record] = self.records(self.target)
        self.assertEqual(
            {
                "in": "summary",
                "comment_id": answer["summary_comment_id"],
                "from": self.source,
                "by_person": False,
                "quote": said["done"],
            },
            {name: record[name] for name in ("in", "comment_id", "from", "by_person", "quote")},
        )
        summary = self.agent("get_work_item", id=self.source)
        [comment] = [
            entry for entry in summary["comments"] if entry["id"] == answer["summary_comment_id"]
        ]
        self.assertEqual([self.target], comment["mentions"])

    def test_a_summary_written_again_tells_only_what_the_last_one_did_not_name(self) -> None:
        other = self.item("Another route")
        self.conn.commit()
        first = {"done": f"Ask {self.target}", "next": "Wait"}
        self.agent(
            "set_work_item_summary",
            ELSEWHERE,
            id=self.source,
            summary=first,
            mentions=[self.target],
        )
        # One session, four saves of the same words: the hour counts only what told.
        for _ in range(3):
            again = self.agent(
                "set_work_item_summary",
                ELSEWHERE,
                id=self.source,
                summary=first,
                mentions=[self.target],
            )
            self.assertNotIn("mentions", again, "nobody hears it twice")
        both = {"done": f"Ask {self.target} and {other}", "next": "Wait"}
        answer = self.agent(
            "set_work_item_summary",
            ELSEWHERE,
            id=self.source,
            summary=both,
            mentions=[self.target, other],
        )
        self.assertEqual([other], [entry["reference"] for entry in answer["mentions"]])
        self.assertEqual((1, 1), (self.events(self.target), self.events(other)))
        # A report made current replaces the summary as well; one that is not is a comment.
        self.agent(
            "report_work_item",
            ELSEWHERE,
            id=self.source,
            report=both,
            make_current=True,
            expected_revision=answer["revision"],
            mentions=[other],
        )
        self.assertEqual(1, self.events(other))
        self.agent("report_work_item", ELSEWHERE, id=self.source, report=both, mentions=[other])
        self.assertEqual(2, self.events(other))
        # Words that stopped naming it make the next save that names it news again.
        plain = {"done": "Nothing to ask", "next": "Wait"}
        self.person(SUMMARY_PATH, id=self.source, summary=plain)
        told = self.person(SUMMARY_PATH, id=self.source, summary=first, mentions=[self.target])
        self.assertEqual([self.target], [entry["reference"] for entry in told["mentions_told"]])
        self.assertEqual(2, self.events(self.target))

    def test_a_description_tells_and_its_record_quotes_the_line_that_names_it(self) -> None:
        text = f"Why this exists.\n\nDrop the old route with {self.target} first.\nThen the rest."
        answer = self.describe(text, [self.target])
        self.assertEqual(
            [{"reference": self.target, "holders": [], "told": mention_records.NO_HOLDER}],
            answer["mentions_told"],
        )
        self.assertEqual([], answer["mentions"], "the item's own records, of texts naming it")
        [record] = self.records(self.target)
        self.assertEqual(
            {
                "in": "description",
                "comment_id": None,
                "from": self.source,
                "by_person": True,
                "author": "user",
                "quote": f"Drop the old route with {self.target} first.\nThen the rest.",
            },
            {name: value for name, value in record.items() if name != "at"},
        )
        self.assertEqual(text, service.get_work_item(self.conn, self.source)["description"])
        service.delete_work_item(self.conn, self.source)
        self.conn.commit()
        [record] = self.records(self.target)
        self.assertEqual(
            ("description", None, None), (record["in"], record["from"], record["quote"])
        )

    def test_a_description_saved_again_tells_nobody_twice(self) -> None:
        other = self.item("Another route")
        self.conn.commit()
        text = f"Drop it with {self.target}."
        self.describe(text, [self.target])
        again = self.describe(text, [self.target])
        self.assertNotIn("mentions_told", again, "the same words, saved again")
        longer = self.describe(f"{text} And {other}.", [self.target, other])
        self.assertEqual([other], [entry["reference"] for entry in longer["mentions_told"]])
        self.assertEqual((1, 1), (self.events(self.target), self.events(other)))
        self.describe("Nothing named.", [])
        self.describe(text, [self.target])
        self.assertEqual(2, self.events(self.target), "no longer in the text it replaced")

    def test_a_description_is_held_to_a_comments_checks_and_a_refusal_writes_nothing(
        self,
    ) -> None:
        before = service.get_work_item(self.conn, self.source)["revision"]
        cases = {
            "no description": ({"title": "Renamed"}, [self.target], "invalid_request"),
            "itself": ({"description": "Me"}, [self.source], "invalid_request"),
            "twice": ({"description": "Two"}, [self.target, self.target], "invalid_request"),
            "missing": ({"description": "Gone"}, ["MAIN-99"], "not_found"),
        }
        for case, (fields, mentions, code) in cases.items():
            with self.subTest(case):
                with (
                    calls.bind(calls.browser(), UPDATE),
                    self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught,
                ):
                    api.handle_post(
                        self.conn, UPDATE, {"id": self.source, **fields, "mentions": mentions}
                    )
                self.conn.rollback()
                self.assertEqual(code, api.error_response(caught.exception)[1]["error"]["code"])
        self.assertEqual(before, service.get_work_item(self.conn, self.source)["revision"])
        many = [self.item(f"Item {index}") for index in range(6)]
        self.conn.commit()
        error = self.refused_agent(
            "update_work_item", id=self.source, description=" ".join(many), mentions=many
        )
        self.assertEqual("mentions holds at most 5 items", error["message"])
        self.assertEqual(0, self.events(self.target))

    def test_a_persons_description_mention_is_the_persons_act_on_the_item_named(self) -> None:
        self.hold()
        self.assertIsNone(self.hook())
        self.describe(f"Intro\n{self.target} can drop the old route", [self.target])
        [event] = self.window(self.target)
        self.assertEqual(
            ("mentioned", "description", self.source),
            (event["kind"], event["in"], event["from"]),
        )
        told = self.hook()
        assert told is not None
        self.assertIn("a person acted", told)
        self.assertIn(
            f" in the description of {self.source}: «{self.target} can drop the old route»", told
        )

    def test_an_agents_description_mention_reaches_the_holder_and_a_batch_says_who_hears(
        self,
    ) -> None:
        self.hold()
        self.assertIsNone(self.hook())
        other = self.item("Another route")
        self.conn.commit()
        batch = self.agent(
            "apply_work_item_changes",
            ELSEWHERE,
            id=self.source,
            update={"description": f"{self.target} goes first", "mentions": [self.target]},
            summary={"done": f"Asked {other}", "next": "Wait", "mentions": [other]},
        )
        self.assertEqual([self.target], [entry["reference"] for entry in batch["mentions"]])
        self.assertEqual(["description"], batch["applied"]["update"])
        self.assertEqual(
            [other], [entry["reference"] for entry in batch["applied"]["summary"]["mentions"]]
        )
        told = self.hook()
        assert told is not None
        self.assertIn(AGENTS_HEAD, told)
        self.assertIn(
            f" by session {SPEAKER}, in the description of {self.source}: «{self.target} goes"
            " first»",
            told,
        )
        self.assertEqual([], self.window(self.target), "an agent's words are never a person's")

    def test_a_write_that_names_nothing_says_nobody_hears(self) -> None:
        """A summary's answer used to carry the item's own records under `mentions`."""

        self.tells()
        summary = self.agent("set_work_item_summary", id=self.target, summary=SUMMARY)
        report = self.agent("report_work_item", id=self.target, report=SUMMARY)
        edit = self.agent("update_work_item", id=self.target, description="Plain")
        for answer in (summary, report, edit):
            self.assertNotIn("mentions", answer)


class LimitTests(Harness):
    def test_a_person_names_at_most_twenty_items(self) -> None:
        many = [self.item(f"Item {index}") for index in range(21)]
        self.conn.commit()
        error = self.refused_person(id=self.source, body="All of them", mentions=many)
        self.assertEqual(
            ("invalid_request", "mentions holds at most 20 items"),
            (error["code"], error["message"]),
        )
        self.assertEqual(0, self.events(many[0]))
        said = self.person(COMMENT, id=self.source, body="Twenty", mentions=many[:20])
        self.assertEqual(many[:20], [entry["reference"] for entry in said["mentions"]])

    def test_the_refusals_name_what_is_wrong_and_write_nothing(self) -> None:
        before = self.conn.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0]
        cases = {
            "twice": (
                [self.target, self.target],
                "invalid_request",
                f"mentions names {self.target} twice",
            ),
            "itself": ([self.source], "invalid_request", "an item does not mention itself"),
            "missing": (["MAIN-99"], "not_found", "no work item MAIN-99"),
            "not a list": (self.target, "invalid_request", "mentions must be a list of work items"),
        }
        for case, (mentions, code, message) in cases.items():
            with self.subTest(case):
                error = self.refused_person(id=self.source, body="Told", mentions=mentions)
                self.assertEqual((code, message), (error["code"], error["message"]))
                self.assertEqual(
                    before,
                    self.conn.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0],
                )
        self.assertEqual(0, self.events(self.target))


class AgentMentionTests(Harness):
    """Another session's agent names an item this session holds."""

    def test_the_holder_hears_it_at_its_next_tool_call_and_never_at_stop(self) -> None:
        self.agent("claim_work_item", id=self.target)
        self.agent("set_work_item_summary", id=self.target, summary=SUMMARY)
        self.assertIsNone(self.hook(), "nothing yet")
        said = self.spoken()
        idle = os.path.join(os.path.dirname(self.marks_path()), SESSION + ".idle")
        self.assertIsNone(self.hook(event="stop"), "a notice at Stop would continue the turn")
        self.assertTrue(os.path.exists(idle), "the turn ends and the session is idle")

        told = self.hook()
        assert told is not None, "the Stop read past it, and it still arrives"
        self.assertTrue(told.startswith(f"{AGENTS_HEAD} this session holds."), told)
        self.assertNotIn("a person acted", told)
        self.assertIn(f"{self.target} «Drop the old route»:", told)
        self.assertIn(
            f" by session {SPEAKER}, from {self.source} #{said['comment_id']}: «{SAID}»", told
        )
        self.assertTrue(told.endswith(AGENTS_LAST), told)
        self.assertIsNone(self.hook(), "once")

        self.assertEqual([], self.window(self.target), "not in from_person")
        closed = self.agent("transition_work_item", id=self.target, state="cancelled")
        self.assertEqual("cancelled", closed["state"]["key"], "no person_spoke for an agent")

    def test_a_prompt_carries_it_for_claude_and_codex(self) -> None:
        self.agent("claim_work_item", id=self.target)
        for client in ("claude", "codex"):
            with self.subTest(client):
                self.assertIsNone(self.hook(event="user-prompt-submit", client=client))
                self.spoken(body=f"For {client}")
                told = self.hook(event="user-prompt-submit", client=client)
                self.assertIn(AGENTS_HEAD, told or "")
                self.assertIn(f"«For {client}»", told or "")

    def test_a_subagent_on_a_step_hears_it_itself_another_does_not_the_orchestrator_once(
        self,
    ) -> None:
        self.hold()
        # The second subagent wrote on the item, so only holding decides.
        self.agent(
            "comment_work_item",
            {"sessionId": SESSION, "threadId": STRANGER},
            id=self.target,
            body="Looked at it",
        )
        for agent in (None, CHILD, STRANGER):
            self.assertIsNone(self.hook(agent), f"nothing yet: {agent}")
        self.spoken()

        child = self.hook(CHILD)
        assert child is not None
        self.assertTrue(child.startswith(f"{AGENTS_HEAD} you hold."), child)
        self.assertIn("marker M-1", child)
        self.assertIsNone(self.hook(CHILD), "once for the subagent")
        self.assertIsNone(self.hook(STRANGER), "a subagent holding nothing there")
        told = self.hook()
        assert told is not None
        self.assertTrue(told.startswith(f"{AGENTS_HEAD} this session holds."), told)
        self.assertEqual(1, told.count("- mentioned at"))
        self.assertIsNone(self.hook(), "once for the orchestrator")

    def test_its_own_session_never_hears_it_and_signing_user_changes_nothing(self) -> None:
        self.hold()
        for agent in (None, CHILD):
            self.assertIsNone(self.hook(agent), f"nothing yet: {agent}")
        self.spoken(SUBAGENT, body="From the step")
        self.assertIsNone(self.hook(CHILD), "the subagent that spoke")
        self.assertIsNone(self.hook(), "nor its orchestrator: one session is one speaker")
        self.spoken(ORCHESTRATOR, body="From the orchestrator")
        self.assertIsNone(self.hook(), "the orchestrator that spoke")
        self.assertIsNone(self.hook(CHILD), "nor its subagent holding a step")

        said = self.spoken(ELSEWHERE_AGENT, body="From another session's agent", author="user")
        told = self.hook()
        assert told is not None, "another session's agent is heard"
        self.assertTrue(told.startswith(AGENTS_HEAD), "signed user, it is still an agent")
        self.assertNotIn("a person acted", told)
        self.assertNotIn("From the step", told)
        self.assertIn(
            f" by agent {notify.label_id(SPEAKER_AGENT)} of session {SPEAKER},"
            f" from {self.source} #{said['comment_id']}: «From another session's agent»",
            told,
        )
        self.assertEqual([], self.window(self.target))
        records = self.agent("get_work_item", id=self.target)["mentions"]
        [record] = [entry for entry in records if entry["comment_id"] == said["comment_id"]]
        self.assertEqual((False, "user"), (record["by_person"], record["author"]))

    def test_an_unproved_call_keeps_the_record_and_tells_nobody(self) -> None:
        self.hold()
        for agent in (None, CHILD):
            self.assertIsNone(self.hook(agent), f"nothing yet: {agent}")
        [heard] = self.spoken(None, body="Unproved")["mentions"]
        self.assertEqual(mention_records.UNPROVED, heard["told"])
        self.assertEqual(1, self.events(self.target), "the record is written")
        for agent in (None, CHILD):
            self.assertIsNone(self.hook(agent), f"told nobody: {agent}")
        self.spoken(body="Proved")
        told = self.hook()
        assert told is not None, "positive control: the same mention from a proved session"
        self.assertNotIn("Unproved", told)

    def test_with_no_holder_it_waits_on_the_item_and_only_later_news_is_told(self) -> None:
        said = self.spoken(body="Before anyone took it")
        self.assertEqual(
            [{"reference": self.target, "holders": [], "told": mention_records.NO_HOLDER}],
            said["mentions"],
        )
        [record] = self.agent("get_work_item", id=self.target)["mentions"]
        self.assertEqual(
            (said["comment_id"], False, "Before anyone took it"),
            (record["comment_id"], record["by_person"], record["quote"]),
        )
        self.agent("claim_work_item", id=self.target)
        self.assertIsNone(self.hook(), "what came before the claim is read on the item")
        self.spoken(body="After the claim")
        told = self.hook()
        assert told is not None
        self.assertIn("«After the claim»", told)
        self.assertNotIn("Before anyone took it", told)


class AgentWatcherTests(Harness):
    def test_an_idle_session_is_not_woken_and_the_next_tool_call_hears_it(self) -> None:
        for name, value in (("POLL_SECONDS", 0.05), ("GRACE_SECONDS", 0.2)):
            patch = mock.patch.object(notify, name, value)
            patch.start()
            self.addCleanup(patch.stop)
        self.agent("claim_work_item", id=self.target)
        self.assertIsNone(self.hook(event="stop"))  # idle now
        self.spoken(body="While you wait, marker W-10")
        # The client process ends the watch: an agent's mention never does.
        client = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        self.addCleanup(client.kill)
        timer = threading.Timer(1.0, client.kill)
        timer.start()
        self.addCleanup(timer.join)
        stderr = io.BytesIO()
        fake = mock.Mock()
        fake.buffer = stderr
        with mock.patch.object(sys, "stderr", fake):
            status = notify.watch(
                {"session_id": SESSION}, {**self.environ, "CLAUDE_PID": str(client.pid)}
            )
        self.assertEqual((0, b""), (status, stderr.getvalue()), "not woken")

        identity = str(service.get_work_item(self.conn, self.target)["work_item_id"])
        self.assertTrue(
            notify.read_marks(self.marks_path())[identity][4],
            "the watcher read the item and left the mention waiting",
        )
        told = self.hook()
        assert told is not None, "not lost"
        self.assertTrue(told.startswith(AGENTS_HEAD), told)
        self.assertIn("marker W-10", told)


class AgentLimitTests(Harness):
    def test_an_agent_names_at_most_five_items(self) -> None:
        many = [self.item(f"Item {index}") for index in range(6)]
        self.conn.commit()
        error = self.refused_agent(
            "comment_work_item", id=self.source, body="All of them", mentions=many
        )
        self.assertEqual(
            ("invalid_request", "mentions holds at most 5 items"),
            (error["code"], error["message"]),
        )
        self.assertEqual(0, self.events(many[0]))
        said = self.agent("comment_work_item", id=self.source, body="Five", mentions=many[:5])
        self.assertEqual(many[:5], [entry["reference"] for entry in said["mentions"]])

    def test_a_fourth_mention_of_one_item_within_an_hour_is_refused(self) -> None:
        # A session's subagents count with it.
        for meta in (ORCHESTRATOR, SUBAGENT, ORCHESTRATOR):
            self.spoken(meta)
        comments = self.conn.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0]
        error = self.refused_agent(
            "comment_work_item", SUBAGENT, id=self.source, body="Again", mentions=[self.target]
        )
        self.assertEqual(
            (
                "mention_limit",
                f"{self.target} was mentioned 3 times in the last hour by this session;"
                " write once there, or wait",
            ),
            (error["code"], error["message"]),
        )
        self.assertEqual(3, self.events(self.target))
        self.assertEqual(
            comments, self.conn.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0]
        )
        self.assertEqual(429, api.error_response(model.MentionLimitError("x"))[0])

        self.spoken(ELSEWHERE, body="Another session counts apart")
        self.tells(body="A person is not counted")
        self.conn.execute(
            "UPDATE work_item_events SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ','now',"
            "'-61 minutes') WHERE id = (SELECT MIN(id) FROM work_item_events"
            " WHERE action = 'mentioned')"
        )
        self.conn.commit()
        self.spoken(ORCHESTRATOR, body="An hour after the first")
        self.assertEqual(6, self.events(self.target))


class AgentMarksTests(Harness):
    def test_a_version_2_place_is_read_and_tells_no_news_again(self) -> None:
        """An installed release meets every running session's file: no old news for them."""

        self.agent("claim_work_item", id=self.target)
        self.tells()
        self.assertIsNotNone(self.hook())
        path = self.marks_path()
        with open(path, "rb") as handle:
            self.assertEqual(b"v4\n", handle.read(3))
        marks = notify.read_marks(path)
        lines = [
            f"{item} {mark[0]} {mark[1][0]} {mark[1][1]} {mark[1][2]} {int(mark[2])}"
            for item, mark in marks.items()
        ]
        with open(path, "wb") as handle:
            handle.write(("\n".join(["v2", *lines]) + "\n").encode("ascii"))
        self.assertEqual(
            {item: (mark[0], mark[1], mark[2], mark[0], False) for item, mark in marks.items()},
            notify.read_marks(path),
            "the agents' place is where everything else was read to, and nothing waits",
        )
        self.assertIsNone(self.hook(), "the person's mention is not told again")
        self.spoken()
        told = self.hook()
        assert told is not None
        self.assertTrue(told.startswith(AGENTS_HEAD), "only the agent's news is new")
        self.assertNotIn("a person acted", told)


class AgentNoticeTextTests(unittest.TestCase):
    def test_both_blocks_keep_their_heading_and_closing_lines_within_the_bound(self) -> None:
        person = [
            {"kind": "comment", "via": "interface", "at": "t", "text": f"Person {n} " + "x" * 290}
            for n in range(12)
        ]
        agents = [
            {
                "kind": "mentioned",
                "via": "agent",
                "at": "t",
                "comment_id": n,
                "from": "MAIN-12",
                "session": SPEAKER,
                "agent": None,
                "text": f"Agent {n} " + "y" * 290,
            }
            for n in range(12)
        ]
        text = notify.render(
            [("MAIN-14", "Widen the check", person + agents)], orchestrator=True, wake=False
        )
        self.assertLessEqual(len(text), notify.MOST_CHARACTERS)
        start = text.index(AGENTS_HEAD)
        self.assertLess(text.index("a person acted"), start, "the person's block first")
        self.assertIn("not permission for an irreversible action", text[:start])
        self.assertTrue(text.endswith(AGENTS_LAST), text)
        self.assertIn("«Person 11 ", text, "the newest of each")
        self.assertIn("«Agent 11 ", text)
        self.assertEqual(2, text.count(" earlier, in the history of the item."))
        self.assertLessEqual(text.count("- comment at") + text.count("- mentioned at"), 8)


if __name__ == "__main__":
    unittest.main()
