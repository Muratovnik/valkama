"""Who a card says stands behind its claim, its steps and its agents.

The rule these cases hold: every holder a click could open says which session
that is and in what state, read from the session's own row, and a holder with no
session to open says `none`. A subagent is opened through its parent, so an agent
reads its parent's place. Claims and steps go through the real write path under a
bound identity, and only a session's own columns are set by hand.
"""

from __future__ import annotations

import os
import re
import sqlite3
import tempfile
import unittest
from collections.abc import Callable
from unittest import mock

from server import mcp_surface, sessions
from server.executions import service as execution_service
from server.planning import agents, calls, executors, service
from tests.schema9 import LAST
from tests.test_planning_agents import AGENT, OTHER_PARENT, PARENT, SIBLING, AgentsCase, agent_call

#: Longer than a holder label carries as it is, so the label holds its digest.
LONG_SESSION = "session-" + "x" * 50
NOBODY = {
    "session": None,
    "agent": None,
    "opened_in": "",
    "opened_host": "",
    "family": "",
    "state": "none",
}
#: Any statement that reads the table itself, and not `execution_sessions`.
_NAMES_SESSIONS = re.compile(r"(?<![a-z_])sessions(?![a-z_])")


def session_call(session: str = PARENT, client: str = "claude") -> calls.Identity:
    source = calls.CLAUDE_HOOK if client == "claude" else calls.CODEX_META
    return calls.Identity(
        state=calls.CONFIRMED, source=source, session_id=session, tool_use_id="t", client=client
    )


class ExecutorCase(AgentsCase):
    def setUp(self) -> None:
        super().setUp()
        self.card = self.new_item("The card", checklist=["agent", "person", "digest"])
        self.steps = service.get_work_item(self.conn, self.card)["checklist"]

    def read(self) -> dict:
        return service.get_work_item(self.conn, self.card, agents=True)

    def claim_step(self, index: int, who: calls.Identity) -> None:
        with calls.bind(who, "claim_work_item_checklist_item"):
            service.claim_checklist_item(self.conn, self.card, self.steps[index]["id"])

    def held_by(self, session: str = PARENT) -> dict:
        """The executor of a claim the session takes, read back from the card."""

        with calls.bind(session_call(session), "claim_work_item"):
            service.claim_work_item(self.conn, self.card, force=True, move_state=False)
        return self.read()["claim"]["executor"]

    def session(self, session: str = PARENT, **columns: str) -> None:
        """Set a session's own record: what the hooks and its client would have left."""

        names = ", ".join(f"{name} = ?" for name in columns)
        self.conn.execute(
            f"UPDATE sessions SET {names} WHERE id = ?",
            (*columns.values(), session),
        )

    def placed(self, session: str, opened_in: str, opened_host: str = "") -> None:
        sessions.record_place(
            self.conn,
            session,
            opened_in=opened_in,
            opened_host=opened_host,
            opened_folder="",
            host_session_id="",
            current=True,
        )


class CardTests(ExecutorCase):
    """The card the plan names: a claim, three steps and two agents."""

    def setUp(self) -> None:
        super().setUp()
        with calls.bind(session_call(), "claim_work_item"):
            service.claim_work_item(self.conn, self.card, move_state=False)
        self.started(5)
        self.claim_step(0, agent_call())
        self.started(6, agent=SIBLING)
        self.write_sibling()
        service.claim_checklist_item(self.conn, self.card, self.steps[1]["id"], author="the owner")
        self.claim_step(2, session_call(LONG_SESSION))
        self.placed(PARENT, "ide", "vscode")
        self.record = self.read()

    def write_sibling(self) -> None:
        with calls.bind(agent_call(SIBLING), "comment_work_item"):
            service.comment_work_item(self.conn, self.card, "a note")

    def test_the_claim_names_its_session_and_where_it_was_opened(self) -> None:
        self.assertEqual(
            {
                "session": PARENT,
                "agent": None,
                "opened_in": "ide",
                "opened_host": "vscode",
                "family": "claude",
                "state": "live",
            },
            self.record["claim"]["executor"],
        )

    def test_a_step_an_agent_holds_is_its_parent_session_and_names_the_agent(self) -> None:
        self.assertEqual(
            {
                "session": PARENT,
                "agent": AGENT,
                "opened_in": "ide",
                "opened_host": "vscode",
                "family": "claude",
                "state": "live",
            },
            self.record["checklist"][0]["executor"],
        )

    def test_a_step_a_person_holds_has_no_session(self) -> None:
        self.assertEqual("the owner", self.record["checklist"][1]["claimed_by"])
        self.assertEqual(NOBODY, self.record["checklist"][1]["executor"])

    def test_a_step_whose_label_holds_a_digest_has_no_session(self) -> None:
        held = self.record["checklist"][2]["claimed_by"]
        self.assertNotIn(LONG_SESSION, held, "this case must exercise the digest")
        # The session is real and has a row: only the label cannot name it.
        self.assertIsNotNone(
            self.conn.execute("SELECT 1 FROM sessions WHERE id = ?", (LONG_SESSION,)).fetchone()
        )
        self.assertEqual(NOBODY, self.record["checklist"][2]["executor"])

    def test_each_agent_reads_its_parents_place_and_names_itself(self) -> None:
        self.assertEqual(
            {AGENT, SIBLING},
            {entry["agent_id"] for entry in self.record["agents"]},
        )
        for entry in self.record["agents"]:
            with self.subTest(agent=entry["agent_id"]):
                self.assertEqual(
                    {
                        "session": PARENT,
                        "agent": entry["agent_id"],
                        "opened_in": "ide",
                        "opened_host": "vscode",
                        "family": "claude",
                        "state": "live",
                    },
                    entry["executor"],
                )

    def test_the_read_costs_one_statement_more_that_names_sessions(self) -> None:
        def naming_sessions() -> tuple[int, int]:
            seen: list[str] = []
            self.conn.set_trace_callback(seen.append)
            try:
                self.read()
            finally:
                self.conn.set_trace_callback(None)
            return len(seen), sum(bool(_NAMES_SESSIONS.search(sql)) for sql in seen)

        with_executors = naming_sessions()
        with mock.patch.object(executors, "attach"):
            without = naming_sessions()
        self.assertEqual((without[0] + 1, without[1] + 1), with_executors)

    def test_only_the_card_asks(self) -> None:
        """A list, a write's answer and the MCP read stay what their schemas say."""

        plain = service.get_work_item(self.conn, self.card)
        self.assertNotIn("executor", plain["claim"])
        self.assertNotIn("executor", plain["checklist"][0])
        answer = mcp_surface.call_tool(self.conn, "get_work_item", {"id": self.card})
        self.assertNotIn("executor", answer["claim"])
        self.assertNotIn("executor", answer["checklist"][0])


class StateTests(ExecutorCase):
    def test_an_active_session_is_live(self) -> None:
        self.assertEqual("live", self.held_by()["state"])

    def test_an_ended_session_is_ended_with_its_place(self) -> None:
        self.held_by()
        self.placed(PARENT, "terminal")
        self.session(status="ended")
        found = self.read()["claim"]["executor"]
        self.assertEqual(
            (PARENT, "ended", "terminal"), (found["session"], found["state"], found["opened_in"])
        )

    def test_a_failed_session_counts_as_ended(self) -> None:
        self.held_by()
        self.session(status="failed")
        self.assertEqual("ended", self.read()["claim"]["executor"]["state"])

    def test_an_ended_session_whose_transcript_is_gone_is_gone(self) -> None:
        self.held_by()
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            self.session(status="ended", transcript_path=os.path.join(directory, "no-such.jsonl"))
            self.assertEqual("gone", self.read()["claim"]["executor"]["state"])

    def test_an_ended_session_whose_transcript_is_there_is_not_gone(self) -> None:
        self.held_by()
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            path = os.path.join(directory, "kept.jsonl")
            with open(path, "w", encoding="utf-8"):
                pass
            self.session(status="ended", transcript_path=path)
            self.assertEqual("ended", self.read()["claim"]["executor"]["state"])

    def test_an_ended_session_with_no_transcript_path_is_not_gone(self) -> None:
        self.held_by()
        self.session(status="ended", transcript_path="")
        self.assertEqual("ended", self.read()["claim"]["executor"]["state"])

    def test_a_path_that_cannot_be_read_says_nothing_about_the_file(self) -> None:
        self.held_by()
        self.session(status="ended", transcript_path="kept.jsonl")
        with mock.patch.object(executors.os, "stat", side_effect=PermissionError("denied")):
            self.assertEqual("ended", self.read()["claim"]["executor"]["state"])

    def test_a_live_session_with_no_file_yet_is_live(self) -> None:
        """A client names the path at its start, before it writes the first line."""

        self.held_by()
        self.session(transcript_path=os.path.join("nowhere", "not-yet.jsonl"))
        self.assertEqual("live", self.read()["claim"]["executor"]["state"])

    def test_a_running_session_with_no_window_is_headless(self) -> None:
        self.held_by()
        self.placed(PARENT, "headless")
        self.assertEqual("headless", self.read()["claim"]["executor"]["state"])

    def test_an_ended_session_with_no_window_is_ended(self) -> None:
        """It can be opened again like any other, in the fallback place."""

        self.held_by()
        self.placed(PARENT, "headless")
        self.session(status="ended")
        found = self.read()["claim"]["executor"]
        self.assertEqual(("ended", "headless"), (found["state"], found["opened_in"]))

    def test_an_agent_on_an_ended_parent_reads_the_parents_state(self) -> None:
        self.started(5)
        self.write_as(agent_call(), self.card)
        self.session(status="ended")
        (agent,) = [entry for entry in self.read()["agents"] if entry["agent_id"] == AGENT]
        self.assertEqual(
            (PARENT, "ended"), (agent["executor"]["session"], agent["executor"]["state"])
        )


class AttemptTests(ExecutorCase):
    """A session Valkama ran has no window, and its own hook cannot always say so."""

    def run_as(self, relation: str) -> None:
        identity = execution_service.new_execution_id()
        execution_service.open_execution(
            self.conn,
            execution_id=identity,
            work_item_id=str(service.get_work_item(self.conn, self.card)["work_item_id"]),
            project_id="",
            packet={
                "client": "codex",
                "role": "executor",
                "environment": "workdir",
                "expected_effect": "change_required",
            },
        )
        execution_service.link_session(self.conn, identity, PARENT, relation)

    def test_a_session_an_attempt_launched_or_resumed_is_headless(self) -> None:
        self.held_by()
        for relation in ("launched", "resumed"):
            with self.subTest(relation=relation):
                self.run_as(relation)
                found = self.read()["claim"]["executor"]
                self.assertEqual(("headless", "headless"), (found["state"], found["opened_in"]))
                self.conn.execute("DELETE FROM execution_sessions")

    def test_a_session_a_person_attached_keeps_what_it_says(self) -> None:
        self.held_by()
        self.run_as("attached")
        found = self.read()["claim"]["executor"]
        self.assertEqual(("live", ""), (found["state"], found["opened_in"]))

    def test_a_place_recorded_since_wins_over_the_attempt(self) -> None:
        self.held_by()
        self.run_as("launched")
        self.placed(PARENT, "app", "codex-app")
        found = self.read()["claim"]["executor"]
        self.assertEqual(
            ("live", "app", "codex-app"), (found["state"], found["opened_in"], found["opened_host"])
        )


class HolderTests(ExecutorCase):
    def test_a_finished_step_names_who_did_it(self) -> None:
        self.claim_step(0, agent_call())
        with calls.bind(agent_call(), "tick_work_item_checklist_item"):
            service.tick_checklist_item(self.conn, self.card, self.steps[0]["id"])
        step = self.read()["checklist"][0]
        self.assertEqual("", step["claimed_by"])
        self.assertEqual((PARENT, AGENT), (step["executor"]["session"], step["executor"]["agent"]))

    def test_a_step_nobody_holds_has_no_session(self) -> None:
        self.assertEqual(NOBODY, self.read()["checklist"][0]["executor"])

    def test_text_a_person_typed_in_a_holders_form_opens_nothing(self) -> None:
        service.claim_checklist_item(
            self.conn, self.card, self.steps[0]["id"], author="claude (session never-seen)"
        )
        self.assertEqual(NOBODY, self.read()["checklist"][0]["executor"])

    def test_an_item_nobody_holds_has_no_claim_to_describe(self) -> None:
        self.assertIsNone(self.read()["claim"])

    def test_a_claim_no_session_proved_has_no_session(self) -> None:
        service.claim_work_item(self.conn, self.card, author="the owner", move_state=False)
        self.assertEqual(NOBODY, self.read()["claim"]["executor"])

    def test_a_claim_an_unconfirmed_call_names_a_session_for_opens_nothing(self) -> None:
        # The session exists, so only the call's being unconfirmed can say no.
        self.claim_step(0, session_call(OTHER_PARENT))
        said = calls.Identity(
            state=calls.UNCONFIRMED, source=calls.CLAUDE_HOOK, session_id=OTHER_PARENT
        )
        with calls.bind(said, "claim_work_item"):
            service.claim_work_item(self.conn, self.card, author="someone", move_state=False)
        self.assertEqual(NOBODY, self.read()["claim"]["executor"])

    def test_a_claim_whose_session_has_no_row_has_no_session(self) -> None:
        self.held_by()
        self.conn.execute("DELETE FROM sessions WHERE id = ?", (PARENT,))
        self.assertEqual(NOBODY, self.read()["claim"]["executor"])

    def test_every_holder_of_one_card_costs_one_statement(self) -> None:
        self.held_by()
        self.claim_step(0, agent_call())
        self.claim_step(1, agent_call(SIBLING))
        self.claim_step(2, session_call(OTHER_PARENT))
        record = {**self.read()}
        seen: list[str] = []
        self.conn.set_trace_callback(seen.append)
        try:
            executors.attach(self.conn, record, recorded=True)
        finally:
            self.conn.set_trace_callback(None)
        self.assertEqual(1, len(seen), seen)

    def test_who_last_held_a_finished_item_costs_no_statement_of_its_own(self) -> None:
        self.held_by()
        self.placed(PARENT, "ide", "vscode")
        service.transition_work_item(self.conn, self.card, "done", force=True, author="agent")
        record = {**self.read()}
        seen: list[str] = []
        self.conn.set_trace_callback(seen.append)
        try:
            executors.attach(self.conn, record, recorded=True)
        finally:
            self.conn.set_trace_callback(None)
        self.assertEqual(1, len(seen), seen)
        self.assertEqual(PARENT, record["last_claim_executor"]["session"])

    def test_a_card_with_no_session_to_name_asks_nothing(self) -> None:
        record = {**self.read()}
        seen: list[str] = []
        self.conn.set_trace_callback(seen.append)
        try:
            executors.attach(self.conn, record, recorded=True)
        finally:
            self.conn.set_trace_callback(None)
        self.assertEqual([], seen)


class PlaceColumnTests(ExecutorCase):
    def test_a_host_the_window_kind_has_left_behind_is_not_named(self) -> None:
        """A call moved how it is open and could not say in what."""

        self.held_by()
        self.placed(PARENT, "app", "claude-desktop")
        sessions.note_opened_in(self.conn, PARENT, "terminal")
        found = self.read()["claim"]["executor"]
        self.assertEqual(("terminal", ""), (found["opened_in"], found["opened_host"]))

    def test_a_value_this_build_does_not_know_reads_as_unknown(self) -> None:
        """A strict reader refuses a whole card for one value it has no word for."""

        self.held_by()
        self.session(opened_in="hologram", opened_host="holodeck")
        found = self.read()["claim"]["executor"]
        self.assertEqual(
            ("live", "", ""), (found["state"], found["opened_in"], found["opened_host"])
        )


class LastHolderTests(ExecutorCase):
    """A close ends the claim, and the card can still reach whoever held it."""

    def close(self) -> dict:
        service.transition_work_item(self.conn, self.card, "done", force=True, author="agent")
        return self.read()

    def test_a_finished_item_names_who_held_it_and_where_it_was_opened(self) -> None:
        self.held_by()
        self.placed(PARENT, "app", "claude-desktop")
        self.session(status="ended")
        record = self.close()
        self.assertIsNone(record["claim"])
        self.assertEqual(
            {
                "session": PARENT,
                "agent": None,
                "opened_in": "app",
                "opened_host": "claude-desktop",
                "family": "claude",
                "state": "ended",
            },
            record["last_claim_executor"],
        )

    def test_a_session_since_deleted_is_gone(self) -> None:
        self.held_by()
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            self.session(status="ended", transcript_path=os.path.join(directory, "deleted.jsonl"))
            self.assertEqual("gone", self.close()["last_claim_executor"]["state"])

    def test_an_item_closed_unheld_has_nobody_to_open(self) -> None:
        self.assertEqual(NOBODY, self.close()["last_claim_executor"])

    def test_a_person_who_held_it_has_no_session(self) -> None:
        service.claim_work_item(self.conn, self.card, author="the owner", move_state=False)
        self.assertEqual(NOBODY, self.close()["last_claim_executor"])

    def test_open_work_has_nobody_before_its_holder(self) -> None:
        self.held_by()
        self.assertEqual(NOBODY, self.read()["last_claim_executor"])


class OlderStoreTests(unittest.TestCase):
    def record(self, session: str = PARENT) -> dict:
        return {
            "work_item_id": "any",
            "last_claim_ref": None,
            "claim": {"state": "live", "session_id": session, "agent_id": None},
            "checklist": [
                {
                    "done": False,
                    "claimed_by": calls.holder_label("claude", session),
                    "done_by": "",
                },
            ],
        }

    def read_on(self, prepare: Callable[[sqlite3.Connection], None]) -> dict:
        old = sqlite3.connect(":memory:")
        self.addCleanup(old.close)
        old.row_factory = sqlite3.Row
        prepare(old)
        record = self.record()
        agents.on_card(old, record)
        return record

    def test_a_store_with_no_agents_recorded_names_no_session(self) -> None:
        record = self.read_on(lambda old: old.execute("CREATE TABLE sessions(id TEXT PRIMARY KEY)"))
        self.assertEqual(NOBODY, record["claim"]["executor"])
        self.assertEqual(NOBODY, record["checklist"][0]["executor"])

    def test_a_store_with_no_session_table_names_no_session(self) -> None:
        record = self.read_on(lambda _old: None)
        self.assertEqual(NOBODY, record["claim"]["executor"])

    def test_a_schema_9_store_has_no_place_and_still_says_the_state(self) -> None:
        """An attached store is read as it is, and the last schema-9 build wrote no place."""

        def schema_nine(old: sqlite3.Connection) -> None:
            old.executescript(LAST.read_text(encoding="utf-8"))
            old.execute("INSERT INTO sessions(id, client) VALUES (?, 'claude')", (PARENT,))

        record = self.read_on(schema_nine)
        self.assertEqual(
            {
                "session": PARENT,
                "agent": None,
                "opened_in": "",
                "opened_host": "",
                "family": "claude",
                "state": "live",
            },
            record["claim"]["executor"],
        )


class LabelTests(unittest.TestCase):
    def test_a_holder_label_reads_back_as_it_was_written(self) -> None:
        for name in ("claude", "codex"):
            for agent in (None, AGENT):
                with self.subTest(name=name, agent=agent):
                    self.assertEqual(
                        (PARENT, agent),
                        calls.holder_ids(calls.holder_label(name, PARENT, agent)),
                    )

    def test_anything_else_is_no_holder_label(self) -> None:
        for text in (
            "",
            "the owner",
            "user",
            "(session abc)",
            "gemini (session abc)",
            "claude (session a b)",
            "claude agent  (session abc)",
            "not claude (session abc)",
        ):
            with self.subTest(text=text):
                self.assertIsNone(calls.holder_ids(text))
