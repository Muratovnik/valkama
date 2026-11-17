"""A client hook takes the commit records of its session into the store.

The records are left by the Git hook of a real commit (`commit_fixtures`), and the
client hook is `valkama hook <client> <event>` itself, run in this process with the
input the client sends.
"""

from __future__ import annotations

import io
import json
import os
import sqlite3
import statistics
import time
import unittest
from pathlib import Path
from unittest import mock

from server.hooks import commit_records, entry, git_hook, light, notify

from .commit_fixtures import CALL, CLAUDE, CODEX, PROJECT, CommitPlace

SUBAGENT = "019a3c2e-aaaa-7c11-9e0f-2f4b6d8a1c3e"
#: How many runs each cost figure is the median of.
RUNS = 200


class PickupCase(unittest.TestCase):
    def setUp(self) -> None:
        self.place = CommitPlace(self)
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": str(self.place.store),
                "LOCALAPPDATA": str(self.place.local),
                "HOME": str(self.place.home),
                "USERPROFILE": str(self.place.home),
            },
        )
        patch.start()
        self.addCleanup(patch.stop)

    def committed(self, **variables: str) -> list[Path]:
        """A commit in R from a shell with these client variables, through the Git hook."""

        self.place.commit(
            self.place.repository, f"c{time.time_ns()}", environ=self.place.sessions(**variables)
        )
        return self.place.everywhere()

    def hook(self, client: str, event: str = "post-tool-use", **payload: object) -> tuple:
        """One client hook: its stdout and stderr."""

        stdout = io.BytesIO()
        stderr = io.StringIO()
        with mock.patch("sys.stderr", stderr):
            status = entry.main(
                [client, event], io.BytesIO(json.dumps(payload).encode("utf-8")), stdout
            )
        self.assertEqual(0, status)
        return stdout.getvalue(), stderr.getvalue()

    def rows(self) -> list[tuple]:
        conn = sqlite3.connect(self.place.store)
        try:
            return conn.execute(
                "SELECT project_id, hash, subject, session_id, agent_id, client FROM commits"
                " ORDER BY commit_id"
            ).fetchall()
        finally:
            conn.close()

    def claude(self, session: str = CLAUDE, **extra: object) -> tuple:
        return self.hook(
            "claude", **{"session_id": session, "tool_name": "Bash", "duration_ms": 60_000, **extra}
        )


class FirstSliceTests(PickupCase):
    def test_the_first_slice_reaches_the_store(self) -> None:
        place = self.place
        place.commit(
            place.space,
            "nested",
            environ=place.sessions(CLAUDE_CODE_SESSION_ID=CLAUDE),
            git_c="R",
        )
        [record] = place.beside_the_store()
        self.assertEqual((b"", ""), self.claude())
        self.assertEqual(
            [(PROJECT, place.head(), "feat: nested", CLAUDE, None, "claude")], self.rows()
        )
        self.assertFalse(record.exists(), "the record is deleted once the store has it")

    def test_a_record_waiting_in_the_git_directory_is_taken_too(self) -> None:
        place = self.place
        place.commit(
            place.repository,
            "fallback",
            environ=place.sessions(
                CLAUDE_CODE_SESSION_ID=CLAUDE, VALKAMA_DB=str(place.base / "no" / "v.sqlite3")
            ),
        )
        [record] = place.in_the_git_directory()
        self.claude()
        self.assertEqual([place.head()], [row[1] for row in self.rows()])
        self.assertFalse(record.exists())

    def test_a_record_taken_twice_is_recorded_once(self) -> None:
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        content = record.read_bytes()
        self.claude()
        record.write_bytes(content)
        self.claude()
        self.assertEqual(1, len(self.rows()))
        self.assertFalse(record.exists(), "worked off, and deleted")


class ClaudeWindowTests(PickupCase):
    def aged(self, path: Path, seconds: float) -> Path:
        """The same record, named as if it were written `seconds` ago."""

        key, _, rest = path.name.partition("--")
        at, _, tail = rest.partition("-")
        older = path.with_name(f"{key}--{int(at) - int(seconds * 1e9)}-{tail}")
        path.rename(older)
        return older

    def test_the_window_is_the_call_s_duration_and_its_slack(self) -> None:
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        record = self.aged(record, 5)
        self.claude(duration_ms=1_000)
        self.assertEqual([], self.rows(), "written before the call began")
        self.assertTrue(record.exists())
        self.claude(duration_ms=4_000)
        self.assertEqual(1, len(self.rows()), "within the duration and two seconds")

    def test_without_a_duration_the_window_is_ten_minutes(self) -> None:
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        record = self.aged(record, 11 * 60)
        self.hook("claude", session_id=CLAUDE, tool_name="Bash")
        self.assertEqual([], self.rows())
        self.assertTrue(record.exists(), "it waits for the leftovers")
        self.aged(record, -2 * 60)
        self.hook("claude", session_id=CLAUDE, tool_name="PowerShell")
        self.assertEqual(1, len(self.rows()))

    def test_only_a_shell_tool_of_the_session_takes_it(self) -> None:
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        self.hook("claude", session_id=CLAUDE, tool_name="Read", duration_ms=60_000)
        self.claude(session=SUBAGENT)
        self.assertEqual([], self.rows())
        self.assertTrue(record.exists())

    def test_a_subagent_s_commit_names_its_agent(self) -> None:
        self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        self.claude(agent_id=SUBAGENT)
        [row] = self.rows()
        self.assertEqual((CLAUDE, SUBAGENT, "claude"), row[3:])

    def test_a_failed_command_takes_its_commits_and_is_no_lifecycle_event(self) -> None:
        self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        conn = sqlite3.connect(self.place.store)
        self.addCleanup(conn.close)
        events = conn.execute("SELECT COUNT(*) FROM execution_events").fetchone()[0]
        answer = self.hook(
            "claude",
            "post-tool-use-failure",
            session_id=CLAUDE,
            tool_name="Bash",
            duration_ms=60_000,
            error="exit 1",
        )
        self.assertEqual((b"", ""), answer, "nothing printed, no complaint on stderr")
        self.assertEqual(1, len(self.rows()))
        self.assertEqual(
            events, conn.execute("SELECT COUNT(*) FROM execution_events").fetchone()[0]
        )


class CodexCallTests(PickupCase):
    def test_codex_takes_the_record_of_its_own_call_only(self) -> None:
        [record] = self.committed(
            CODEX_SESSION_ID=CODEX, CODEX_THREAD_ID=CODEX, CODEX_TOOL_CALL_ID=CALL
        )
        self.hook("codex", session_id=CODEX, tool_use_id="call_another")
        self.assertEqual([], self.rows())
        self.assertTrue(record.exists())
        self.assertEqual((b"", ""), self.hook("codex", session_id=CODEX, tool_use_id=CALL))
        self.assertEqual(
            [(PROJECT, self.place.head(), CODEX, None, "codex")],
            [(row[0], row[1], row[3], row[4], row[5]) for row in self.rows()],
        )
        self.assertFalse(record.exists())

    def test_a_codex_subagent_is_its_thread_or_its_agent_id(self) -> None:
        self.committed(CODEX_SESSION_ID=CODEX, CODEX_THREAD_ID=SUBAGENT, CODEX_TOOL_CALL_ID=CALL)
        self.hook("codex", session_id=CODEX, tool_use_id=CALL)
        self.committed(CODEX_SESSION_ID=CODEX, CODEX_THREAD_ID=SUBAGENT, CODEX_TOOL_CALL_ID="c2")
        self.hook("codex", session_id=CODEX, tool_use_id="c2", agent_id="agent-from-input")
        self.assertEqual([SUBAGENT, "agent-from-input"], [row[4] for row in self.rows()])


class NestedClientTests(PickupCase):
    def test_the_first_client_hook_takes_a_nested_record(self) -> None:
        files = self.committed(
            CLAUDE_CODE_SESSION_ID=CLAUDE,
            CODEX_SESSION_ID=CODEX,
            CODEX_THREAD_ID=CODEX,
            CODEX_TOOL_CALL_ID=CALL,
        )
        by_key = {path.name.split("--")[0]: path for path in files}
        self.assertEqual({CLAUDE, CODEX}, set(by_key))
        self.claude()
        self.assertEqual([(CLAUDE, None, "claude")], [row[3:] for row in self.rows()])
        self.assertFalse(by_key[CLAUDE].exists())
        self.assertTrue(by_key[CODEX].exists())
        conn = sqlite3.connect(self.place.store)
        self.addCleanup(conn.close)
        before = conn.execute("PRAGMA data_version").fetchone()[0]
        self.assertEqual((b"", ""), self.hook("codex", session_id=CODEX, tool_use_id=CALL))
        self.assertEqual(1, len(self.rows()), "the outer hook writes nothing")
        self.assertEqual(before, conn.execute("PRAGMA data_version").fetchone()[0])
        self.assertFalse(by_key[CODEX].exists(), "its worked-off file is deleted")


class StoreAccessTests(PickupCase):
    def test_without_records_the_store_is_not_opened_for_writing(self) -> None:
        refused = mock.patch.object(light, "open_light", side_effect=AssertionError("opened"))
        with refused as opened:
            self.assertEqual((b"", ""), self.claude())
            self.assertEqual((b"", ""), self.hook("codex", session_id=CODEX, tool_use_id=CALL))
            self.assertEqual(
                (b"", ""), self.hook("claude", "post-tool-use-failure", session_id=CLAUDE)
            )
        opened.assert_not_called()

    def test_a_busy_store_keeps_the_record(self) -> None:
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        writer = sqlite3.connect(self.place.store, isolation_level=None)
        self.addCleanup(writer.close)
        writer.execute("BEGIN IMMEDIATE")
        self.assertEqual((b"", ""), self.claude(), "nothing said about the commit")
        writer.execute("ROLLBACK")
        self.assertTrue(record.exists())
        self.assertEqual([], self.rows())
        self.claude()
        self.assertEqual(1, len(self.rows()), "the next hook takes it")
        self.assertFalse(record.exists())

    def test_a_store_of_another_schema_keeps_the_record(self) -> None:
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        with mock.patch("server.store.STORE_SCHEMA_VERSION", 0):
            self.claude()
        self.assertTrue(record.exists())
        self.assertEqual([], self.rows())


class CostTests(PickupCase):
    def median_ms(self, payload: dict) -> float:
        times = []
        for _run in range(RUNS):
            started = time.perf_counter_ns()
            entry._commits("claude", payload)
            times.append(time.perf_counter_ns() - started)
        return statistics.median(times) / 1e6

    def test_with_no_record_the_look_costs_at_most_two_milliseconds(self) -> None:
        """What the look for records adds to a hook that finds none: the directory listings
        and the registry, read as a file."""

        payload = {"session_id": CLAUDE, "tool_name": "Bash", "duration_ms": 1}
        # Records of another session lie in both places and are not read.
        self.committed(CLAUDE_CODE_SESSION_ID=SUBAGENT)
        self.place.commit(
            self.place.repository,
            "fallback",
            environ=self.place.sessions(
                CLAUDE_CODE_SESSION_ID=SUBAGENT,
                VALKAMA_DB=str(self.place.base / "no" / "v.sqlite3"),
            ),
        )
        self.assertEqual(2, len(self.place.everywhere()))
        self.assertLessEqual(self.median_ms(payload), 2.0)
        self.assertEqual([], self.rows())


class RecordFileTests(unittest.TestCase):
    def test_a_file_of_another_shape_is_not_a_record(self) -> None:
        key = commit_records.file_key(CLAUDE)
        good = f"{key}--1763000000000000000-0123456789abcdef.json"
        self.assertEqual(1763000000000000000, commit_records.occurred_ns(good, key))
        for name in (
            f"{key}--x-0123456789abcdef.json",
            f"{key}--1-0123456789ABCDEF.json",
            f"{key}--1-0123.json",
            f".{good}.4242.tmp",
            f"{key}--other--1-0123456789abcdef.json",
        ):
            with self.subTest(name=name):
                self.assertIsNone(commit_records.occurred_ns(name, key))

    def test_a_record_is_written_as_the_json_it_reads_back_as(self) -> None:
        record = {
            "commits": [{"hash": "a" * 40, "parents": [], "subject": 'fix: «ключ» "q"\\\n'}],
            "rewrite": None,
            "version": 1,
            "flag": True,
        }
        encoded = commit_records.encode(record)
        self.assertEqual(record, json.loads(encoded.decode("ascii")))
        self.assertEqual(record, notify.loads(encoded.decode("ascii")), "as the hook reads it")
        with self.assertRaises(TypeError):
            commit_records.encode({"at": 1.5})

    def test_the_hook_command_name_follows_the_event(self) -> None:
        self.assertEqual(
            {
                "post-commit": "valkama-commit",
                "post-rewrite": "valkama-rewrite",
                "post-merge": "valkama-merge",
            },
            git_hook.NAMES,
        )


if __name__ == "__main__":
    unittest.main()
