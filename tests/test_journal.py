"""Pure/temp-store checks for the read-only analytics projection."""

from __future__ import annotations

import json
import os
import pathlib
import tempfile
import time
import unittest
from unittest import mock

from server.telemetry import journal as analytics


class JournalTests(unittest.TestCase):
    def _write_codex_journal(self, path: str, session_id: str, input_tokens: int = 2) -> None:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "type": "session_meta",
                        "payload": {"id": session_id},
                    }
                )
                + "\n"
            )
            handle.write(
                json.dumps(
                    {
                        "timestamp": "2026-01-01T00:00:00Z",
                        "type": "event_msg",
                        "payload": {
                            "token_count": {
                                "total_token_usage": {
                                    "input_tokens": input_tokens,
                                    "output_tokens": 1,
                                }
                            }
                        },
                    }
                )
                + "\n"
            )

    def test_local_usage_dedupes_codex_cumulative_and_claude_message_ids(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            codex = os.path.join(directory, "rollout-codex.jsonl")
            with open(codex, "w", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        {
                            "session_id": "codex",
                            "type": "event_msg",
                            "payload": {
                                "token_count": {
                                    "total_token_usage": {"input_tokens": 2, "output_tokens": 1}
                                }
                            },
                        }
                    )
                    + "\n"
                )
                handle.write(
                    json.dumps(
                        {
                            "session_id": "codex",
                            "type": "event_msg",
                            "payload": {
                                "token_count": {
                                    "total_token_usage": {"input_tokens": 5, "output_tokens": 3}
                                }
                            },
                        }
                    )
                    + "\n"
                )
            usage = analytics.LocalJournalUsageProvider(codex_roots=[codex]).usage_for_session(
                "codex", "codex"
            )
            self.assertEqual({"input_tokens": 5, "output_tokens": 3}, usage["tokens"])

            claude = os.path.join(directory, "claude.jsonl")
            with open(claude, "w", encoding="utf-8") as handle:
                handle.writelines(
                    json.dumps(
                        {
                            "type": "assistant",
                            "message": {
                                "id": "m1",
                                "model": "x",
                                "usage": {"input_tokens": count},
                            },
                            "cost_usd": count / 2,
                        }
                    )
                    + "\n"
                    for count in (2, 4)
                )
                handle.write(
                    json.dumps(
                        {
                            "type": "assistant",
                            "message": {"id": "m2", "model": "x", "usage": {"input_tokens": 3}},
                            "cost_usd": 3,
                        }
                    )
                    + "\n"
                )
            usage = analytics.LocalJournalUsageProvider(claude_roots=[claude]).usage_for_session(
                "claude", "claude"
            )
            self.assertEqual(7, usage["tokens"]["input_tokens"])
            self.assertIsNone(usage["cost"])
            self.assertEqual("unknown", usage["cost_quality"])

    def test_codex_rollout_session_meta_identity_is_exact_and_observed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            session_id = "123e4567-e89b-12d3-a456-426614174000"
            rollout = os.path.join(
                directory,
                f"rollout-2026-08-07T00-46-21-{session_id}.jsonl",
            )
            with open(rollout, "w", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        {
                            "type": "session_meta",
                            "payload": {"id": session_id.upper(), "cwd": directory},
                        }
                    )
                    + "\n"
                )
                handle.write(
                    json.dumps(
                        {
                            "type": "event_msg",
                            "payload": {
                                "token_count": {
                                    "total_token_usage": {"input_tokens": 11, "output_tokens": 7}
                                }
                            },
                        }
                    )
                    + "\n"
                )
            usage = analytics.LocalJournalUsageProvider(
                codex_roots=[directory],
            ).usage_for_session(session_id, "codex")
            self.assertTrue(usage["observed"])
            self.assertEqual({"input_tokens": 11, "output_tokens": 7}, usage["tokens"])
            self.assertEqual("local_journal", usage["source"])
            self.assertEqual("derived/internal", usage["quality"])

    def test_ambiguous_journal_match_stays_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = os.path.join(directory, "one", "session.jsonl")
            second = os.path.join(directory, "two", "session.jsonl")
            os.makedirs(os.path.dirname(first))
            os.makedirs(os.path.dirname(second))
            for path in (first, second):
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write(
                        json.dumps(
                            {
                                "session_id": "shared",
                                "type": "event_msg",
                                "payload": {
                                    "token_count": {"total_token_usage": {"input_tokens": 1}}
                                },
                            }
                        )
                        + "\n"
                    )
            usage = analytics.LocalJournalUsageProvider(codex_roots=[directory]).usage_for_session(
                "shared", "codex"
            )
            self.assertFalse(usage["observed"])
            self.assertIsNone(usage["tokens"])

    def test_codex_daily_deltas_are_positive_and_reset_is_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "codex.jsonl")
            rows = [
                {
                    "timestamp": "2026-01-01T00:00:00Z",
                    "payload": {
                        "token_count": {
                            "total_token_usage": {"input_tokens": 2, "output_tokens": 1}
                        }
                    },
                },
                {
                    "timestamp": "2026-01-01T01:00:00Z",
                    "payload": {
                        "token_count": {
                            "total_token_usage": {"input_tokens": 5, "output_tokens": 3}
                        }
                    },
                },
                {
                    "timestamp": "2026-01-02T00:00:00Z",
                    "payload": {
                        "token_count": {
                            "total_token_usage": {"input_tokens": 1, "output_tokens": 1}
                        }
                    },
                },
                {
                    "timestamp": "2026-01-02T01:00:00Z",
                    "payload": {
                        "token_count": {
                            "total_token_usage": {"input_tokens": 4, "output_tokens": 2}
                        }
                    },
                },
                {
                    "timestamp": "2026-01-03T00:00:00Z",
                    "payload": {
                        "token_count": {
                            "total_token_usage": {"input_tokens": 9, "output_tokens": 5}
                        }
                    },
                },
            ]
            with open(path, "w", encoding="utf-8") as handle:
                handle.writelines(json.dumps(row) + "\n" for row in rows)
            usage = analytics.LocalJournalUsageProvider(codex_roots=[path]).usage_for_session(
                "codex", "codex", as_of="2026-01-02T12:00:00Z"
            )
            by_day = {row["date"]: row for row in usage["daily"]}
            self.assertEqual(
                {"input_tokens": 3, "output_tokens": 2}, by_day["2026-01-01"]["tokens"]
            )
            self.assertTrue(by_day["2026-01-01"]["unknown"])
            self.assertTrue(by_day["2026-01-02"]["unknown"])
            self.assertNotIn("2026-01-03", by_day)
            self.assertTrue(usage["daily_unknown"])

    def test_claude_daily_series_dedupes_message_ids_and_marks_cost_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "claude.jsonl")
            rows = [
                {
                    "timestamp": "2026-01-01T00:00:00Z",
                    "type": "assistant",
                    "message": {"id": "m1", "model": "x", "usage": {"input_tokens": 2}},
                    "cost_usd": 1,
                },
                {
                    "timestamp": "2026-01-01T00:01:00Z",
                    "type": "assistant",
                    "message": {"id": "m1", "model": "x", "usage": {"input_tokens": 4}},
                    "cost_usd": 2,
                },
                {
                    "timestamp": "2026-01-02T00:00:00Z",
                    "type": "assistant",
                    "message": {"id": "m2", "model": "x", "usage": {"input_tokens": 3}},
                    "cost_usd": 3,
                },
            ]
            with open(path, "w", encoding="utf-8") as handle:
                handle.writelines(json.dumps(row) + "\n" for row in rows)
            usage = analytics.LocalJournalUsageProvider(claude_roots=[path]).usage_for_session(
                "claude", "claude"
            )
            self.assertEqual(7, usage["tokens"]["input_tokens"])
            self.assertIsNone(usage["cost"])
            self.assertTrue({row["date"]: row for row in usage["daily"]}["2026-01-01"]["unknown"])

    def test_repeated_identity_projection_does_not_rescan_jsonl(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "journal.jsonl")
            self._write_codex_journal(path, "session-one")
            provider = analytics.LocalJournalUsageProvider(codex_roots=[directory])
            original = analytics.LocalJournalUsageProvider._identity_values_uncached
            calls: list[str] = []

            def counted(cls, candidate: pathlib.Path):
                calls.append(str(candidate))
                return original.__func__(cls, candidate)

            with mock.patch.object(
                analytics.LocalJournalUsageProvider,
                "_identity_values_uncached",
                classmethod(counted),
            ):
                first = provider.usage_for_session("session-one", "codex")
                second = provider.usage_for_session("session-one", "codex")
            self.assertTrue(first["observed"])
            self.assertEqual(first["tokens"], second["tokens"])
            self.assertEqual(1, len(calls))

    def test_one_journal_stat_change_invalidates_only_that_identity_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first_path = os.path.join(directory, "first.jsonl")
            second_path = os.path.join(directory, "second.jsonl")
            self._write_codex_journal(first_path, "session-one")
            self._write_codex_journal(second_path, "session-two")
            provider = analytics.LocalJournalUsageProvider(codex_roots=[directory])
            original = analytics.LocalJournalUsageProvider._identity_values_uncached
            calls: list[str] = []

            def counted(cls, candidate: pathlib.Path):
                calls.append(str(candidate))
                return original.__func__(cls, candidate)

            with mock.patch.object(
                analytics.LocalJournalUsageProvider,
                "_identity_values_uncached",
                classmethod(counted),
            ):
                provider.usage_for_session("session-one", "codex")
                provider.usage_for_session("session-two", "codex")
                calls.clear()
                with open(first_path, "a", encoding="utf-8") as handle:
                    handle.write("{}\n")
                os.utime(first_path, ns=(time.time_ns(), time.time_ns()))
                fresh_provider = analytics.LocalJournalUsageProvider(codex_roots=[directory])
                fresh_provider.usage_for_session("session-one", "codex")
                fresh_provider.usage_for_session("session-two", "codex")
            self.assertEqual([os.path.realpath(first_path)], calls)

    def test_nested_journal_changes_invalidate_index_without_rescanning_unrelated_roots(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory) / "journals"
            nested = root / "nested"
            nested.mkdir(parents=True)
            first_path = nested / "first.jsonl"
            self._write_codex_journal(str(first_path), "session-one")
            provider = analytics.LocalJournalUsageProvider(codex_roots=[str(root)])
            self.assertTrue(provider.usage_for_session("session-one", "codex")["observed"])

            second_path = nested / "second.jsonl"
            self._write_codex_journal(str(second_path), "session-two")
            self.assertTrue(provider.usage_for_session("session-two", "codex")["observed"])

            first_path.unlink()
            self.assertFalse(provider.usage_for_session("session-one", "codex")["observed"])

    def test_fresh_provider_discovers_a_direct_journal_root_created_after_empty_index(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            journal = pathlib.Path(directory) / "late-session.jsonl"
            first = analytics.LocalJournalUsageProvider(codex_roots=[str(journal)])
            self.assertFalse(first.usage_for_session("late-session", "codex")["observed"])

            self._write_codex_journal(str(journal), "late-session")
            fresh = analytics.LocalJournalUsageProvider(codex_roots=[str(journal)])
            self.assertTrue(fresh.usage_for_session("late-session", "codex")["observed"])


if __name__ == "__main__":
    unittest.main()
