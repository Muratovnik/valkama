"""What one attempt cost, and how much of that is actually known.

Mode A of the telemetry layer reads what is already on this machine: the
clients' own journals and the session events Valkama's hooks wrote. These tests
are mostly about the second half of every answer — a number here says how it was
obtained, and the cases below are the ones where that distinction is the whole
value.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import sessions, store
from server.analytics import LocalJournalUsageProvider
from server.executions import service as execution_service
from server.planning import service as planning
from server.platform import providers as platform_providers
from server.telemetry import contracts, projections
from tests import SUITE_STORE


class VocabularyTests(unittest.TestCase):
    def test_a_value_cannot_claim_to_be_observed_and_carry_nothing(self) -> None:
        # The failure this prevents: a field that says `observed` with no value,
        # which every reader rounds to zero.
        self.assertEqual(
            {"value": None, "quality": "unknown"}, contracts.quantity(None, "observed")
        )
        self.assertEqual({"value": 5, "quality": "observed"}, contracts.quantity(5, "observed"))

    def test_unsupported_survives_an_absent_value(self) -> None:
        # "This source does not carry the field" is a different answer from
        # "this source carries it and saw nothing", and only one of them is a
        # reason to stop asking.
        self.assertEqual(
            {"value": None, "quality": "unsupported"}, contracts.quantity(None, "unsupported")
        )

    def test_nothing_asked_is_unknown_rather_than_confirmed(self) -> None:
        self.assertEqual("unknown", contracts.coverage_of(0, 0))
        self.assertEqual("unknown", contracts.coverage_of(0, 3))
        self.assertEqual("partial", contracts.coverage_of(1, 3))
        self.assertEqual("confirmed", contracts.coverage_of(3, 3))

    def test_one_vocabulary_decides_what_a_tool_error_is(self) -> None:
        self.assertEqual("ok", contracts.tool_outcome("completed"))
        self.assertEqual("error", contracts.tool_outcome("FAILED"))
        self.assertEqual("unknown", contracts.tool_outcome(""))
        self.assertEqual("unknown", contracts.tool_outcome(None))


class ExecutionUsageTests(unittest.TestCase):
    """The projection over one attempt, against real journal files."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        os.environ["VALKAMA_DB"] = os.path.join(self._dir.name, "test.sqlite3")
        self.addCleanup(lambda: os.environ.__setitem__("VALKAMA_DB", SUITE_STORE))
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        planning.create_planning_space(self.conn, project_id="test", name="Test", key="TST")
        self.conn.commit()

    def item(self, title: str) -> dict:
        record = planning.create_work_item(self.conn, space="TST", title=title, state="todo")
        self.conn.commit()
        return record

    def attempt(self, work_item_id: str) -> str:
        execution_id = execution_service.new_execution_id()
        execution_service.open_execution(
            self.conn,
            execution_id=execution_id,
            work_item_id=work_item_id,
            project_id="test",
            packet={
                "client": "claude",
                "role": "executor",
                "environment": "workdir",
                "expected_effect": "change_required",
            },
        )
        self.conn.commit()
        return execution_id

    def session(self, session_id: str, client: str) -> None:
        sessions.op_ingest_session_event(
            self.conn,
            {"session_id": session_id, "client": client, "event": "session_start", "cwd": "/x"},
        )

    def codex_journal(self, session_id: str, **counts: int) -> str:
        path = os.path.join(self._dir.name, f"rollout-{session_id}.jsonl")
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(
                json.dumps(
                    {
                        "session_id": session_id,
                        "type": "event_msg",
                        "payload": {"token_count": {"total_token_usage": dict(counts)}},
                    }
                )
                + "\n"
            )
        return path

    def catalog(self, path: str) -> platform_providers.ProviderCatalog:
        """A registry whose telemetry adapters read this test's journal only.

        The provider's roots are constructor arguments for exactly this reason:
        nothing here crawls a home directory, so a test never reads the owner's
        real transcripts.
        """

        provider = LocalJournalUsageProvider(codex_roots=[path], claude_roots=[path])
        original = platform_providers.LocalJournalUsageProvider
        platform_providers.LocalJournalUsageProvider = lambda: provider  # type: ignore[assignment]
        self.addCleanup(lambda: setattr(platform_providers, "LocalJournalUsageProvider", original))
        return platform_providers.ProviderCatalog()

    def test_an_attempt_nobody_observed_reports_unknown_and_never_zero(self) -> None:
        record = self.item("unobserved")
        usage = projections.execution_usage(self.conn, self.attempt(record["work_item_id"]))

        self.assertEqual("unknown", usage["coverage"]["tokens"])
        self.assertEqual("unknown", usage["coverage"]["tools"])
        for name in contracts.TOKEN_FIELDS:
            self.assertIsNone(usage["tokens"][name]["value"], name)
            self.assertEqual("unknown", usage["tokens"][name]["quality"], name)
        # And it still says who was asked, which is the diagnosis a reader acts on.
        self.assertEqual("unknown", usage["provenance"]["source_quality"])

    def test_a_running_attempt_has_no_wall_time_yet_and_no_active_time_ever(self) -> None:
        record = self.item("running")
        usage = projections.execution_usage(self.conn, self.attempt(record["work_item_id"]))
        self.assertIsNone(usage["duration"]["wall_ms"]["value"])
        self.assertEqual("partial", usage["coverage"]["time"])
        # A journal says what a client wrote, not how long it was busy: an idle
        # hour and a working hour look identical in a transcript.
        self.assertEqual("unsupported", usage["duration"]["active_ms"]["quality"])

    def test_the_journal_answers_through_the_adapter_for_that_client(self) -> None:
        record = self.item("observed")
        execution_id = self.attempt(record["work_item_id"])
        path = self.codex_journal(
            "codex-1", input_tokens=5, cached_input_tokens=2, output_tokens=3, total_tokens=10
        )
        self.session("codex-1", "codex")
        execution_service.link_session(self.conn, execution_id, "codex-1", "launched")
        self.conn.commit()

        usage = projections.execution_usage(
            self.conn, execution_id, catalog=self.catalog(os.path.dirname(path))
        )
        self.assertEqual("confirmed", usage["coverage"]["tokens"])
        # The client's own field names are normalised: `cached_input_tokens`
        # here, `cache_read_input_tokens` on the other client, one name in the
        # projection.
        self.assertEqual(5, usage["tokens"]["input"]["value"])
        self.assertEqual(2, usage["tokens"]["cached_read"]["value"])
        # Codex reports no cache write at all, and an absent field is absent.
        self.assertIsNone(usage["tokens"]["cache_write"]["value"])
        self.assertEqual(10, usage["tokens"]["total"]["value"])
        self.assertEqual("observed", usage["tokens"]["input"]["quality"])
        # Nothing reported reasoning, so it stays absent rather than zero.
        self.assertIsNone(usage["tokens"]["reasoning"]["value"])
        self.assertEqual("codex-rollout-telemetry", usage["provenance"]["adapter_id"])
        self.assertEqual("confirmed", usage["provenance"]["source_quality"])

    def test_a_session_with_no_journal_makes_the_total_partial(self) -> None:
        record = self.item("half observed")
        execution_id = self.attempt(record["work_item_id"])
        path = self.codex_journal("codex-2", input_tokens=4, output_tokens=1)
        self.session("codex-2", "codex")
        self.session("codex-3", "codex")
        execution_service.link_session(self.conn, execution_id, "codex-2", "launched")
        execution_service.link_session(self.conn, execution_id, "codex-3", "resumed")
        self.conn.commit()

        usage = projections.execution_usage(
            self.conn, execution_id, catalog=self.catalog(os.path.dirname(path))
        )
        # The sum is real and it is not the whole, and the payload says which.
        self.assertEqual(4, usage["tokens"]["input"]["value"])
        self.assertEqual("partial", usage["coverage"]["tokens"])
        self.assertEqual("partial", usage["provenance"]["source_quality"])
        unobserved = [item for item in usage["sessions"] if not item["observed"]]
        self.assertEqual(["codex-3"], [item["session_id"] for item in unobserved])
        self.assertTrue(unobserved[0]["reason"])

    def test_an_unknown_client_is_not_read_with_the_wrong_parser(self) -> None:
        record = self.item("unknown client")
        execution_id = self.attempt(record["work_item_id"])
        self.session("mystery-1", "gemini")
        execution_service.link_session(self.conn, execution_id, "mystery-1", "attached")
        self.conn.commit()

        usage = projections.execution_usage(self.conn, execution_id)
        self.assertFalse(usage["sessions"][0]["observed"])
        self.assertIn("other", usage["sessions"][0]["reason"])
        self.assertEqual("unknown", usage["coverage"]["tokens"])

    def test_tools_are_counted_by_outcome_and_carry_no_token_attribution(self) -> None:
        record = self.item("tools")
        execution_id = self.attempt(record["work_item_id"])
        self.session("codex-4", "codex")
        execution_service.link_session(self.conn, execution_id, "codex-4", "launched")
        self.conn.commit()
        for tool, status in (("Read", "ok"), ("Read", "ok"), ("Read", "error"), ("Edit", "")):
            sessions.op_ingest_session_event(
                self.conn,
                {
                    "session_id": "codex-4",
                    "client": "codex",
                    "event": "tool_end",
                    "tool": tool,
                    "server": "builtin",
                    "status": status,
                },
            )

        usage = projections.execution_usage(self.conn, execution_id)
        by_name = {entry["name"]: entry for entry in usage["tools"]}
        self.assertEqual(3, by_name["Read"]["calls"])
        self.assertEqual(1, by_name["Read"]["errors"])
        self.assertEqual(1, by_name["Edit"]["unknown"])
        self.assertEqual("confirmed", usage["coverage"]["tools"])
        # A hook says a tool ran and how it ended. Splitting an attempt's tokens
        # across its calls would be arithmetic presented as observation.
        self.assertNotIn("tokens", by_name["Read"])

    def test_another_attempts_tools_are_not_counted_here(self) -> None:
        record = self.item("scoped")
        mine = self.attempt(record["work_item_id"])
        theirs = self.attempt(record["work_item_id"])
        self.session("codex-5", "codex")
        self.session("codex-6", "codex")
        execution_service.link_session(self.conn, mine, "codex-5", "launched")
        execution_service.link_session(self.conn, theirs, "codex-6", "launched")
        self.conn.commit()
        for session_id in ("codex-5", "codex-6"):
            sessions.op_ingest_session_event(
                self.conn,
                {
                    "session_id": session_id,
                    "client": "codex",
                    "event": "tool_end",
                    "tool": "Read",
                    "status": "ok",
                },
            )

        usage = projections.execution_usage(self.conn, mine)
        self.assertEqual([1], [entry["calls"] for entry in usage["tools"]])

    def test_an_execution_nobody_recorded_is_refused_by_name(self) -> None:
        with self.assertRaises(ValueError):
            projections.execution_usage(self.conn, "exec-does-not-exist")


if __name__ == "__main__":
    unittest.main()
