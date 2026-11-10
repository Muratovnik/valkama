"""The sessions the live-work frame lists beside its items, as `live_sessions` reads them.

Which sessions: one at work or waiting that was given a prompt, or is at work without
one, and none of whose work is a row. What a row says: its state as `live_work` reads
the session, when that began, how many subagents run, where it is open, and the name
its client wrote into its transcript, which is read from the file's tail, a person's
name before the client's own, and again only when the file changed.

The cases reach the rows through `live_frame.frame`, where a consumer finds them. No
project is registered, so every session is under no space.
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from unittest import mock

from server.planning import executors, live_frame, live_sessions
from server.projects import project_registry
from tests.registry_fixtures import registry_bytes
from tests.test_planning_live_work import LiveWorkCase, ago, second


class SessionsCase(LiveWorkCase):
    def setUp(self) -> None:
        super().setUp()
        registry = mock.patch.object(
            project_registry, "_read_registry_bytes", return_value=registry_bytes([])
        )
        registry.start()
        self.addCleanup(registry.stop)
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.directory = directory.name
        live_sessions._titles.clear()
        self.addCleanup(live_sessions._titles.clear)
        self.clock = 0.0
        clock = mock.patch.object(live_sessions, "_clock", side_effect=lambda: self.clock)
        clock.start()
        self.addCleanup(clock.stop)

    def opened(self, *, folder: str = "", transcript: str = "", minutes: float = 30) -> str:
        """A session opened that long ago, with no prompt yet."""

        session = str(uuid.uuid4())
        fields = {"cwd": folder, "transcript_path": transcript}
        self.hook(
            session,
            "session-start",
            ago(minutes=minutes),
            **{name: value for name, value in fields.items() if value},
        )
        return session

    def listed(self) -> list[dict]:
        frame = live_frame.frame(self.conn)
        self.assertEqual([], frame["spaces"])
        return list(frame["elsewhere"])

    def transcript(self, *records: dict) -> str:
        path = os.path.join(self.directory, f"{uuid.uuid4()}.jsonl")
        self.write(path, *records)
        return path

    def write(self, path: str, *records: dict) -> None:
        with open(path, "ab") as handle:
            for record in records:
                handle.write(json.dumps(record).encode("utf-8") + b"\n")


class ListedTests(SessionsCase):
    def test_a_row_carries_every_field_the_contract_names(self) -> None:
        folder = os.path.join(self.directory, "project")
        session = self.opened(folder=folder)
        self.hook(session, "user-prompt-submit", ago(minutes=10))
        self.hook(session, "subagent-start", ago(minutes=3), agent="a1")
        (row,) = self.listed()
        executor = row.pop("executor")
        self.assertEqual(
            {
                "session": session,
                "title": None,
                "folder": "project",
                "state": "working",
                "long": False,
                "asks": False,
                "agents": 1,
                "since": second(minutes=10),
            },
            row,
        )
        self.assertEqual(executors.session_executors(self.conn, [session])[session], executor)
        self.assertEqual(
            (session, None, "claude", "live"),
            (executor["session"], executor["agent"], executor["family"], executor["state"]),
        )

    def test_a_session_opened_and_given_no_prompt_is_not_listed(self) -> None:
        self.opened()
        self.assertEqual([], self.listed())

    def test_a_session_waits_since_its_turn_ended_and_long_past_four_hours(self) -> None:
        session = self.opened(minutes=400)
        self.hook(session, "user-prompt-submit", ago(minutes=350))
        self.hook(session, "stop", ago(minutes=300))
        (row,) = self.listed()
        self.assertEqual(
            ("waiting", True, second(minutes=300)), (row["state"], row["long"], row["since"])
        )

    def test_a_session_asks_since_the_notice_in_its_turn(self) -> None:
        session = self.opened()
        self.hook(session, "user-prompt-submit", ago(minutes=10))
        self.hook(session, "notification", ago(minutes=4))
        (row,) = self.listed()
        self.assertEqual(
            ("waiting", True, second(minutes=4)), (row["state"], row["asks"], row["since"])
        )

    def test_a_subagents_event_does_not_move_since(self) -> None:
        session = self.opened()
        self.hook(session, "user-prompt-submit", ago(minutes=10))
        self.hook(session, "stop", ago(minutes=8))
        self.hook(session, "subagent-start", ago(minutes=2), agent="a1")
        (row,) = self.listed()
        self.assertEqual(
            ("working", 1, second(minutes=8)), (row["state"], row["agents"], row["since"])
        )

    def test_a_session_silent_for_over_a_day_or_ended_is_not_listed(self) -> None:
        silent, ended = self.opened(), self.opened()
        for session in (silent, ended):
            self.hook(session, "user-prompt-submit", ago(minutes=10))
        self.seen(silent, second(days=1, seconds=1))
        self.hook(ended, "session-end", ago(minutes=1))
        self.assertEqual([], self.listed())

    def test_rows_come_freshest_first_and_two_of_one_second_by_id(self) -> None:
        older, newer, twin = self.opened(), self.opened(), self.opened()
        self.hook(older, "user-prompt-submit", ago(minutes=20))
        for session in (newer, twin):
            self.hook(session, "user-prompt-submit", ago(minutes=5))
        self.assertEqual([*sorted((newer, twin)), older], [row["session"] for row in self.listed()])

    def test_an_unchanged_store_lists_the_same_rows(self) -> None:
        session = self.opened(transcript=self.transcript({"type": "ai-title", "aiTitle": "One"}))
        self.hook(session, "user-prompt-submit", ago(minutes=10))
        self.assertEqual(self.listed(), self.listed())


class TitleTests(SessionsCase):
    def titled(self, path: str) -> str:
        session = self.opened(transcript=path)
        self.hook(session, "user-prompt-submit", ago(minutes=10))
        return session

    def title(self) -> str | None:
        (row,) = self.listed()
        return row["title"]

    def test_the_last_name_the_client_made_names_the_session(self) -> None:
        self.titled(
            self.transcript(
                {"type": "ai-title", "aiTitle": "First"},
                {"type": "user", "message": {"content": '{"type":"ai-title","aiTitle":"Quoted"}'}},
                {"type": "ai-title", "aiTitle": "Second"},
            )
        )
        self.assertEqual("Second", self.title())

    def test_a_name_a_person_gave_wins_over_a_later_one_the_client_made(self) -> None:
        self.titled(
            self.transcript(
                {"type": "custom-title", "customTitle": "Mine"},
                {"type": "ai-title", "aiTitle": "Its own"},
            )
        )
        self.assertEqual("Mine", self.title())

    def test_a_title_is_one_line_of_printable_text_of_bounded_length(self) -> None:
        self.titled(self.transcript({"type": "ai-title", "aiTitle": " a\n\tb\x00c " + "x" * 300}))
        title = self.title() or ""
        self.assertEqual("a b c", title[:5])
        self.assertEqual(200, len(title))

    def test_what_is_no_title_names_nothing(self) -> None:
        for record in (
            {"type": "ai-title", "aiTitle": ""},
            {"type": "ai-title", "aiTitle": 7},
            {"type": "ai-title"},
            {"type": "summary", "aiTitle": "Not a title record"},
        ):
            with self.subTest(record):
                session = self.titled(self.transcript(record))
                self.assertIsNone(self.title())
                self.hook(session, "session-end", ago(seconds=1))

    def test_a_missing_file_and_a_line_that_is_not_json_name_nothing(self) -> None:
        missing = self.titled(os.path.join(self.directory, "absent.jsonl"))
        self.assertIsNone(self.title())
        self.hook(missing, "session-end", ago(seconds=1))
        path = self.transcript()
        with open(path, "ab") as handle:
            handle.write(b'{"type":"ai-title","aiTitle":"cut off\n')
        self.titled(path)
        self.assertIsNone(self.title())

    def test_only_the_files_tail_is_read(self) -> None:
        path = self.transcript({"type": "ai-title", "aiTitle": "Far behind"})
        with open(path, "ab") as handle:
            handle.write(b" " * live_sessions._TAIL_BYTES + b"\n")
        self.titled(path)
        self.assertIsNone(self.title())

    def test_another_clients_transcript_is_not_read(self) -> None:
        path = self.transcript({"type": "ai-title", "aiTitle": "Named"})
        session = self.titled(path)
        self.conn.execute("UPDATE sessions SET client = 'codex' WHERE id = ?", (session,))
        with mock.patch.object(live_sessions, "_title") as read:
            self.assertIsNone(self.title())
        read.assert_not_called()

    def test_a_file_is_read_again_only_when_it_changed_and_not_sooner_than_the_pause(self) -> None:
        path = self.transcript({"type": "ai-title", "aiTitle": "Before"})
        self.titled(path)
        with mock.patch.object(live_sessions, "_title_in", wraps=live_sessions._title_in) as read:
            self.assertEqual("Before", self.title())
            self.clock += live_sessions._REREAD_SECONDS * 10
            self.assertEqual("Before", self.title(), "unchanged, however long ago it was read")
            self.assertEqual(1, read.call_count)
            self.write(path, {"type": "ai-title", "aiTitle": "After"})
            self.assertEqual("After", self.title(), "changed, and last read long ago")
            self.assertEqual(2, read.call_count)
            self.write(path, {"type": "ai-title", "aiTitle": "Again"})
            self.clock += live_sessions._REREAD_SECONDS - 1
            self.assertEqual("After", self.title(), "changed, and read too recently")
            self.assertEqual(2, read.call_count)
            self.clock += 1
            self.assertEqual("Again", self.title())
            self.assertEqual(3, read.call_count)

    def test_a_tail_that_lost_the_title_keeps_the_last_one_known(self) -> None:
        path = self.transcript({"type": "ai-title", "aiTitle": "Known"})
        self.titled(path)
        self.assertEqual("Known", self.title())
        with open(path, "ab") as handle:
            handle.write(b" " * live_sessions._TAIL_BYTES + b"\n")
        self.clock += live_sessions._REREAD_SECONDS
        self.assertEqual("Known", self.title())

    def test_the_title_is_not_written_to_the_store(self) -> None:
        self.titled(self.transcript({"type": "ai-title", "aiTitle": "Only in the frame 4217"}))
        before = self.conn.total_changes
        self.assertEqual("Only in the frame 4217", self.title())
        self.assertEqual(before, self.conn.total_changes)
        dumped = "\n".join(self.conn.iterdump())
        self.assertNotIn("Only in the frame 4217", dumped)
