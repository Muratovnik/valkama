"""Which agents a work item's card names, and how it knows each one is on the item.

The rule these cases hold: an agent is on an item exactly when it wrote there or
holds a step there, or when its parent session held the item at the moment it
started. A parent holding several items names the agent on each and says how
many, and an agent with neither link is not on any card. Hook events go through
the real ingest path, and claims through the real write path under a bound
identity; only the event's time is set by hand, because the rule is about time.
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from datetime import UTC, datetime
from unittest import mock

from server import mcp_surface, store
from server.hooks import ingest, normalize
from server.planning import agents, calls, service

PARENT = "6f1c2a8e-0000-4000-8000-000000000001"
OTHER_PARENT = "6f1c2a8e-0000-4000-8000-000000000002"
AGENT = "a4d2c8f1e0b3a297"
SIBLING = "b5e3d9a2f1c4b308"


def at(minute: int, second: int = 0) -> str:
    return f"2026-10-31T10:{minute:02d}:{second:02d}.000Z"


def coordinator(session: str = PARENT, client: str = "claude") -> calls.Identity:
    source = calls.CLAUDE_HOOK if client == "claude" else calls.CODEX_META
    return calls.Identity(
        state=calls.CONFIRMED, source=source, session_id=session, tool_use_id="t", client=client
    )


def agent_call(agent_id: str = AGENT, session: str = PARENT) -> calls.Identity:
    return calls.Identity(
        state=calls.CONFIRMED,
        source=calls.CLAUDE_HOOK,
        session_id=session,
        agent_id=agent_id,
        agent_type="Explore",
        tool_use_id="t",
        client="claude",
    )


class AgentsCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        environment = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="agents", name="Agents", key="AG")
        self.item = self.new_item("On the card")
        self.other = self.new_item("Elsewhere")
        self._uid = 0

    def new_item(self, title: str, checklist: list[str] | None = None) -> str:
        created = service.create_work_item(self.conn, space="AG", title=title)
        if checklist:
            service.set_checklist(self.conn, created["reference"], checklist)
        return str(created["reference"])

    def identity(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["work_item_id"])

    def on_card(self, reference: str | None = None) -> list[dict]:
        record = service.get_work_item(self.conn, reference or self.item, agents=True)
        return record["agents"]

    def one(self, reference: str | None = None) -> dict:
        (found,) = self.on_card(reference)
        return found

    # -- what happened, at a time the case names --------------------------------

    def hook(
        self,
        event: str,
        when: str,
        *,
        agent: str = AGENT,
        session: str = PARENT,
        client: str = "claude",
        **fields: object,
    ) -> None:
        self._uid += 1
        record = normalize.lifecycle_event(
            client,
            event,
            {"session_id": session, "agent_id": agent, **fields},
            event_uid=f"00000000-0000-4000-8000-{self._uid:012d}",
            occurred_at=when,
        )
        assert record is not None
        ingest.record(self.conn, record, delivery="direct")

    def started(self, minute: int, **fields: object) -> None:
        fields.setdefault("agent_type", "Explore")
        self.hook("subagent-start", at(minute), **fields)  # type: ignore[arg-type]

    def stopped(self, minute: int, **fields: object) -> None:
        self.hook("subagent-stop", at(minute), **fields)  # type: ignore[arg-type]

    def launched(self, description: str, agent: str = AGENT, session: str = PARENT) -> None:
        self._uid += 1
        record = normalize.lifecycle_event(
            "claude",
            "post-tool-use",
            {
                "session_id": session,
                "tool_name": "Agent",
                "tool_input": {"description": description, "subagent_type": "Plan"},
                "tool_response": {"status": "async_launched", "agentId": agent},
            },
            event_uid=f"00000000-0000-4000-8000-{self._uid:012d}",
            occurred_at=at(0),
        )
        assert record is not None
        ingest.record(self.conn, record, delivery="direct")

    def _last_event_at(self, reference: str, minute: int, second: int = 0) -> None:
        self.conn.execute(
            "UPDATE work_item_events SET created_at = ? WHERE id = (SELECT MAX(id)"
            " FROM work_item_events WHERE work_item_id = ?)",
            (f"2026-10-31T10:{minute:02d}:{second:02d}Z", self.identity(reference)),
        )

    def claim(
        self,
        reference: str,
        minute: int,
        who: calls.Identity | None = None,
        *,
        force: bool = False,
        second: int = 0,
    ) -> None:
        with calls.bind(who or coordinator(), "claim_work_item"):
            service.claim_work_item(self.conn, reference, force=force, move_state=False)
        self._last_event_at(reference, minute, second)

    def release(self, reference: str, minute: int, who: calls.Identity | None = None) -> None:
        with calls.bind(who or coordinator(), "claim_work_item"):
            service.claim_work_item(self.conn, reference, release=True, move_state=False)
        self._last_event_at(reference, minute)

    def write_as(self, who: calls.Identity, reference: str | None = None) -> None:
        with calls.bind(who, "comment_work_item"):
            service.comment_work_item(self.conn, reference or self.item, "a note")


class ExactLinkTests(AgentsCase):
    """An agent that wrote here or holds a step here is known to be here."""

    def test_an_agent_that_wrote_is_on_the_item_with_nobody_holding_it(self) -> None:
        self.started(5)
        self.write_as(agent_call())
        found = self.one()
        self.assertEqual((AGENT, "exact"), (found["agent_id"], found["link"]))
        self.assertIsNone(found["coordinator_items"])
        self.assertEqual([], self.on_card(self.other))

    def test_an_agent_holding_a_step_says_which_steps(self) -> None:
        reference = self.new_item("Steps", checklist=["first", "second"])
        (first, second) = service.get_work_item(self.conn, reference)["checklist"]
        self.started(5)
        with calls.bind(agent_call(), "claim_work_item_checklist_item"):
            service.claim_checklist_item(self.conn, reference, first["id"])
        with calls.bind(agent_call(SIBLING), "claim_work_item_checklist_item"):
            service.claim_checklist_item(self.conn, reference, second["id"])
        by_agent = {entry["agent_id"]: entry for entry in self.on_card(reference)}
        self.assertEqual(
            [{"id": first["id"], "text": "first"}],
            by_agent[AGENT]["steps"],
        )
        self.assertEqual("exact", by_agent[AGENT]["link"])
        self.assertEqual("second", by_agent[SIBLING]["steps"][0]["text"])

    def test_a_step_finished_is_no_longer_held_but_the_link_stays(self) -> None:
        reference = self.new_item("Steps", checklist=["first"])
        (step,) = service.get_work_item(self.conn, reference)["checklist"]
        self.started(5)
        with calls.bind(agent_call(), "claim_work_item_checklist_item"):
            service.claim_checklist_item(self.conn, reference, step["id"])
        with calls.bind(agent_call(), "tick_work_item_checklist_item"):
            service.tick_checklist_item(self.conn, reference, step["id"])
        found = self.one(reference)
        self.assertEqual(([], "exact"), (found["steps"], found["link"]))

    def test_writing_beats_the_coordinators_claim(self) -> None:
        self.claim(self.item, 1)
        self.claim(self.other, 2)
        self.started(5)
        self.write_as(agent_call())
        found = self.one()
        self.assertEqual(("exact", None), (found["link"], found["coordinator_items"]))

    def test_an_unconfirmed_write_names_nobody(self) -> None:
        self.started(5)
        unconfirmed = calls.Identity(
            state=calls.UNCONFIRMED,
            source=calls.CLAUDE_HOOK_MISMATCH,
            session_id=PARENT,
            agent_id=AGENT,
            client="claude",
        )
        self.write_as(unconfirmed)
        self.assertEqual([], self.on_card())


class ClaimLinkTests(AgentsCase):
    """An agent started while its parent held the item stands on that item, and says so."""

    def test_started_while_the_parent_held_the_item(self) -> None:
        self.claim(self.item, 1)
        self.started(5)
        found = self.one()
        self.assertEqual(("claim", 1), (found["link"], found["coordinator_items"]))
        self.assertEqual([], self.on_card(self.other))

    def test_a_claim_and_a_launch_in_one_second_count(self) -> None:
        self.claim(self.item, 5)
        self.started(5)
        self.assertEqual("claim", self.one()["link"])

    def test_started_before_the_claim_is_not_on_it(self) -> None:
        self.started(1)
        self.claim(self.item, 5)
        self.assertEqual([], self.on_card())

    def test_started_after_the_release_is_not_on_it(self) -> None:
        self.claim(self.item, 1)
        self.release(self.item, 3)
        self.started(5)
        self.assertEqual([], self.on_card())

    def test_a_later_release_does_not_take_the_agent_off(self) -> None:
        self.claim(self.item, 1)
        self.started(5)
        self.release(self.item, 9)
        self.assertEqual("claim", self.one()["link"])

    def test_several_items_held_name_the_agent_on_each_and_say_how_many(self) -> None:
        third = self.new_item("Third")
        self.claim(self.item, 1)
        self.claim(self.other, 2)
        self.claim(third, 3)
        self.started(5)
        for reference in (self.item, self.other, third):
            with self.subTest(reference):
                found = self.one(reference)
                self.assertEqual(("claim", 3), (found["link"], found["coordinator_items"]))

    def test_an_agent_that_wrote_elsewhere_stands_only_where_it_wrote(self) -> None:
        """The claim guesses for an agent nothing places; a write has placed this one."""

        self.claim(self.item, 1)
        self.claim(self.other, 2)
        self.started(5)
        self.started(6, agent_id=SIBLING, session_id=PARENT)
        self.write_as(agent_call(), self.other)
        self.assertEqual(
            {AGENT: "exact", SIBLING: "claim"},
            {row["agent_id"]: row["link"] for row in self.on_card(self.other)},
        )
        self.assertEqual(
            [(SIBLING, 2)],
            [(row["agent_id"], row["coordinator_items"]) for row in self.on_card()],
        )

    def test_the_count_is_of_what_was_held_at_the_start_not_ever(self) -> None:
        released_before = self.new_item("Released before")
        taken_after = self.new_item("Taken after")
        self.claim(released_before, 1)
        self.release(released_before, 2)
        self.claim(self.item, 3)
        self.started(5)
        self.claim(taken_after, 7)
        self.assertEqual(1, self.one()["coordinator_items"])
        self.assertEqual([], self.on_card(released_before))
        self.assertEqual([], self.on_card(taken_after))

    def test_another_session_taking_over_ends_the_parents_hold(self) -> None:
        self.claim(self.item, 1)
        self.claim(self.item, 3, coordinator(OTHER_PARENT), force=True)
        self.started(5)
        self.assertEqual([], self.on_card())
        self.started(6, agent=SIBLING, session=OTHER_PARENT)
        found = self.one()
        self.assertEqual((SIBLING, OTHER_PARENT), (found["agent_id"], found["session_id"]))

    def test_a_claim_taken_by_an_agent_is_not_the_coordinators(self) -> None:
        self.started(1, agent=SIBLING)
        self.claim(self.item, 2, agent_call(SIBLING))
        self.started(5)
        found = self.one()
        self.assertEqual((SIBLING, "exact"), (found["agent_id"], found["link"]))

    def test_an_agent_with_no_link_is_on_no_card(self) -> None:
        self.started(5)
        self.write_as(coordinator())
        self.assertEqual([], self.on_card())
        self.assertEqual([], self.on_card(self.other))

    def test_another_sessions_agent_does_not_count(self) -> None:
        self.claim(self.item, 1)
        self.started(5, session=OTHER_PARENT)
        self.assertEqual([], self.on_card())

    def test_an_agent_the_client_ran_for_itself_is_not_one_it_started(self) -> None:
        """Prompt suggestions and side questions report only a stop, with no type."""

        self.claim(self.item, 1)
        self.stopped(5, agent="internal", agent_type="")
        self.assertEqual([], self.on_card())

    def test_a_launch_is_as_good_as_a_start_for_saying_it_was_started(self) -> None:
        self.claim(self.item, 0)
        self.launched("Name it")
        self.assertEqual("claim", self.one()["link"])

    def test_only_claude_is_read_for_now(self) -> None:
        """Codex reports its agents differently, and the card promises nothing for it."""

        self.claim(self.item, 1, coordinator(client="codex"))
        self.hook("subagent-start", at(5), client="codex", agent_type="worker")
        self.assertEqual([], self.on_card())


class RowFactsTests(AgentsCase):
    """What a row says: never more than the record shows."""

    def setUp(self) -> None:
        super().setUp()
        self.claim(self.item, 0)
        root = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(root.cleanup)
        self.root = root.name

    def known_transcript(self) -> None:
        """Record where the parent's transcript is, through its own session start.

        The claim in setUp stamped the parent with the real clock, and a hook only
        advances a row it is not older than, so the parent's last sign is moved onto
        the case's timeline first. The path itself still arrives through the hook.
        """

        self.conn.execute(
            "UPDATE sessions SET last_seen = ? WHERE id = ?", ("2026-10-31T10:00:00Z", PARENT)
        )
        self.hook(
            "session-start",
            at(0),
            agent="",
            transcript_path=os.path.join(self.root, "projects", f"{PARENT}.jsonl"),
        )

    def agent_file(self, minute: int, agent: str = AGENT, second: int = 0) -> None:
        """Write one subagent's transcript, which nothing reads, last changed at the time given."""

        path = os.path.join(self.root, "projects", PARENT, "subagents", f"agent-{agent}.jsonl")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write('{"type": "user", "message": "not read by Valkama"}\n')
        when = datetime(2026, 10, 31, 10, minute, second, tzinfo=UTC).timestamp()
        os.utime(path, (when, when))

    def test_a_row_with_no_label_gives_its_type_and_id_to_stand_in(self) -> None:
        self.started(5)
        found = self.one()
        self.assertEqual("", found["label"])
        self.assertEqual(("Explore", AGENT), (found["agent_type"], found["agent_id"]))

    def test_the_label_comes_from_the_launch(self) -> None:
        self.started(5)
        self.launched("Проверить экспорт")
        self.assertEqual("Проверить экспорт", self.one()["label"])

    def test_nothing_after_the_start_leaves_the_activity_at_the_start(self) -> None:
        self.started(5)
        found = self.one()
        self.assertEqual("2026-10-31T10:05:00Z", found["started_at"])
        self.assertEqual("2026-10-31T10:05:00Z", found["last_activity_at"])
        self.assertIsNone(found["ended_at"])

    def test_the_agents_own_event_moves_its_activity(self) -> None:
        self.started(5)
        self.hook("notification", at(9))
        self.assertEqual("2026-10-31T10:09:00Z", self.one()["last_activity_at"])

    def test_a_write_moves_its_activity_though_it_beats_only_the_parents_row(self) -> None:
        self.started(5)
        self.write_as(agent_call())
        written = self.conn.execute(
            "SELECT received_at FROM execution_events WHERE kind = 'planning_write'"
            " AND agent_id = ?",
            (AGENT,),
        ).fetchone()[0]
        self.assertEqual(written[:19] + "Z", self.one()["last_activity_at"])

    def test_valkamas_own_copy_of_a_transcript_is_not_the_agents_activity(self) -> None:
        self.started(5)
        self.stopped(6)
        self.conn.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " session_id, agent_id, occurred_at) VALUES ('later', 'transcript_archived',"
            " 'confirmed', 'valkama', ?, ?, ?)",
            (PARENT, AGENT, at(50)),
        )
        self.assertEqual("2026-10-31T10:06:00Z", self.one()["last_activity_at"])

    def test_the_parents_report_of_the_launch_is_not_the_agents_activity(self) -> None:
        self.started(5)
        self.launched("Late", agent=AGENT)
        self.assertEqual("2026-10-31T10:05:00Z", self.one()["last_activity_at"])

    def test_finished_only_with_a_record_of_the_end(self) -> None:
        self.started(5)
        self.assertIsNone(self.one()["ended_at"])
        self.stopped(9)
        found = self.one()
        self.assertEqual("2026-10-31T10:09:00Z", found["ended_at"])
        self.assertEqual("2026-10-31T10:09:00Z", found["last_activity_at"])

    def test_a_second_start_reopens_the_agent(self) -> None:
        self.started(5)
        self.stopped(6)
        self.started(8)
        found = self.one()
        self.assertIsNone(found["ended_at"])
        self.assertEqual("2026-10-31T10:05:00Z", found["started_at"])

    def test_the_most_recent_activity_comes_first(self) -> None:
        self.started(1, agent="oldest")
        self.started(3, agent="newest")
        self.started(2, agent="moved")
        self.hook("notification", at(9), agent="moved")
        self.assertEqual(
            ["moved", "newest", "oldest"], [entry["agent_id"] for entry in self.on_card()]
        )

    def test_a_newer_transcript_file_sets_the_activity_when_read(self) -> None:
        self.known_transcript()
        self.started(5)
        self.agent_file(30, second=15)
        found = self.one()
        self.assertEqual("2026-10-31T10:30:15Z", found["last_activity_at"])
        self.assertEqual("2026-10-31T10:05:00Z", found["started_at"])

    def test_an_older_transcript_file_does_not_move_the_activity_back(self) -> None:
        self.known_transcript()
        self.started(5)
        self.hook("notification", at(9))
        self.agent_file(7)
        self.assertEqual("2026-10-31T10:09:00Z", self.one()["last_activity_at"])

    def test_an_agent_with_a_recorded_end_has_its_file_ignored(self) -> None:
        self.known_transcript()
        self.started(5)
        self.stopped(9)
        self.agent_file(30)
        found = self.one()
        self.assertEqual(
            ("2026-10-31T10:09:00Z", "2026-10-31T10:09:00Z"),
            (found["last_activity_at"], found["ended_at"]),
        )

    def test_a_missing_transcript_file_leaves_the_value(self) -> None:
        self.known_transcript()
        self.started(5)
        self.assertEqual("2026-10-31T10:05:00Z", self.one()["last_activity_at"])

    def test_a_parent_with_no_transcript_path_leaves_the_value(self) -> None:
        self.started(5)
        self.agent_file(30)
        self.assertEqual("2026-10-31T10:05:00Z", self.one()["last_activity_at"])

    def test_an_agent_id_that_is_not_a_plain_name_names_no_file(self) -> None:
        """A separator or a dot could reach a file outside the agent's own name."""

        self.known_transcript()
        self.started(5, agent="x/y")
        self.started(5, agent="x.y")
        self.agent_file(30, agent="x/y")
        self.agent_file(30, agent="x.y")
        self.assertEqual(
            {"x/y": "2026-10-31T10:05:00Z", "x.y": "2026-10-31T10:05:00Z"},
            {row["agent_id"]: row["last_activity_at"] for row in self.on_card()},
        )

    def test_a_session_id_that_is_not_a_plain_name_names_no_file(self) -> None:
        parent = "/transcripts/parent.jsonl"
        self.assertEqual("", agents._agent_transcript(parent, "../other", AGENT))
        self.assertNotEqual("", agents._agent_transcript(parent, PARENT, AGENT))

    def test_an_agent_with_a_newer_transcript_ranks_first(self) -> None:
        self.known_transcript()
        self.started(1, agent="quiet")
        self.started(3, agent="busy")
        self.agent_file(40, agent="quiet")
        self.assertEqual(["quiet", "busy"], [entry["agent_id"] for entry in self.on_card()])

    def test_reading_the_card_writes_nothing(self) -> None:
        self.known_transcript()
        self.started(5)
        self.agent_file(30)
        before = (
            service.get_work_item(self.conn, self.item)["revision"],
            self.conn.execute("SELECT COUNT(*) FROM execution_events").fetchone()[0],
        )
        self.one()
        after = (
            service.get_work_item(self.conn, self.item)["revision"],
            self.conn.execute("SELECT COUNT(*) FROM execution_events").fetchone()[0],
        )
        self.assertEqual(before, after)


class ScopeTests(AgentsCase):
    def test_a_store_an_earlier_build_wrote_has_no_agents(self) -> None:
        old = sqlite3.connect(":memory:")
        self.addCleanup(old.close)
        old.execute("CREATE TABLE sessions(id TEXT PRIMARY KEY)")
        self.assertEqual([], agents.on_item(old, "any", []))
        self.assertIsNone(agents.signal(old))

    def test_only_the_card_asks_for_agents(self) -> None:
        """The MCP answer stays what its schema says, and carries no label."""

        self.claim(self.item, 1)
        self.started(5)
        self.launched("needle-3f9a")
        self.assertNotIn("agents", service.get_work_item(self.conn, self.item))
        answer = mcp_surface.call_tool(self.conn, "get_work_item", {"id": self.item})
        self.assertNotIn("agents", answer)
        self.assertNotIn("needle-3f9a", json.dumps(answer, ensure_ascii=False))


class SignalTests(AgentsCase):
    def test_it_moves_with_an_agents_event_and_not_with_other_work(self) -> None:
        before = agents.signal(self.conn)
        self.write_as(coordinator())
        self.assertEqual(before, agents.signal(self.conn))
        self.started(5)
        started = agents.signal(self.conn)
        self.assertNotEqual(before, started)
        self.stopped(6)
        stopped = agents.signal(self.conn)
        self.assertNotEqual(started, stopped)
        self.launched("A label is news too")
        self.assertNotEqual(stopped, agents.signal(self.conn))
        self.assertNotEqual(before, agents.signal(self.conn))


if __name__ == "__main__":
    unittest.main()
