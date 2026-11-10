"""A Codex rollout read into the same rows, its counters made to mean the same."""

from __future__ import annotations

import unittest

from tests.usage_fixtures import HOUR, Case, CodexRun, stamp


class CodexCase(Case):
    def rollout(self, thread: str = "sess-1", folder: str = "2030/03/04", **meta: str) -> CodexRun:
        path = self.root / "codex" / folder / f"rollout-{thread}.jsonl"
        run = CodexRun(path, thread, **meta)
        self.conn.execute(
            "INSERT INTO sessions(id, client, transcript_path, status, started_at, last_seen)"
            " VALUES (?, 'codex', ?, 'active', ?, ?)",
            (thread, str(path), stamp(0), stamp(0)),
        )
        self.conn.commit()
        return run


class CodexTests(CodexCase):
    def test_a_turn_counts_and_the_idle_time_after_it_does_not(self) -> None:
        run = self.rollout()
        self.ticks((0, 2 * HOUR))
        run.settings(1)
        run.started(1)
        run.call(10, "c1")
        run.output(40, "c1")
        run.usage_record(50, input_tokens=1000, cached=800, output=30, reasoning=10)
        run.complete(60)
        run.started(HOUR + 60)
        run.complete(HOUR + 70)
        self.read()
        self.assertEqual(69.0, self.seconds())
        self.assertEqual(HOUR, self.run_row()["human_seconds"])

    def test_a_turn_that_starts_with_no_notice_after_a_silence_is_no_work_before_it(self) -> None:
        run = self.rollout()
        self.ticks((0, 2 * HOUR))
        run.settings(1)
        run.started(1)
        run.complete(60)
        # The next turn writes its settings and goes straight to a call.
        run.settings(HOUR)
        run.call(HOUR + 1, "c1")
        run.output(HOUR + 11, "c1")
        run.complete(HOUR + 21)
        self.read()
        self.assertEqual(59 + 20, self.seconds())
        self.assertEqual(HOUR + 1 - 60, self.run_row()["human_seconds"])

    def test_input_is_made_to_exclude_the_cache(self) -> None:
        run = self.rollout()
        self.ticks((0, HOUR))
        run.settings(1)
        run.started(1)
        run.usage_record(50, input_tokens=1000, cached=800, output=30, reasoning=10)
        run.complete(60)
        self.read()
        self.assertEqual(200, self.tokens("input_tokens"))
        self.assertEqual(800, self.tokens("cached_read_tokens"))
        self.assertEqual(30, self.tokens("output_tokens"))
        self.assertEqual(10, self.tokens("reasoning_tokens"))
        self.assertAlmostEqual(
            (200 * 2 + 800 * 0.10 + 30 * 10) / 1e6,
            sum(r["estimated_api_cost_usd"] for r in self.segments()),
        )

    def test_a_long_prompt_pays_the_long_prices_and_fast_mode_doubles_them(self) -> None:
        run = self.rollout()
        self.ticks((0, HOUR))
        run.settings(1, tier="priority")
        run.started(1)
        run.usage_record(50, input_tokens=300_000, cached=0, output=1_000)
        run.complete(60)
        self.read()
        self.assertAlmostEqual(
            2 * (300_000 * 4 + 1_000 * 15) / 1e6,
            sum(r["estimated_api_cost_usd"] for r in self.segments()),
        )

    def test_an_older_rollout_counts_each_change_of_its_counters_once(self) -> None:
        run = self.rollout()
        self.ticks((0, HOUR))
        run.settings(1)
        run.started(1)
        first = {"input_tokens": 100, "cached_input_tokens": 10, "output_tokens": 1}
        run.token_count(10, first, first)
        run.token_count(11, first, first)
        second = {"input_tokens": 300, "cached_input_tokens": 110, "output_tokens": 3}
        run.token_count(
            20, second, {"input_tokens": 200, "cached_input_tokens": 100, "output_tokens": 2}
        )
        run.complete(30)
        self.read()
        self.assertEqual(90 + 100, self.tokens("input_tokens"))
        self.assertEqual(110, self.tokens("cached_read_tokens"))
        self.assertEqual(3, self.tokens("output_tokens"))

    def test_a_rollout_with_records_ignores_its_token_counts(self) -> None:
        run = self.rollout()
        self.ticks((0, HOUR))
        run.settings(1)
        run.started(1)
        run.usage_record(10, input_tokens=100, cached=0, output=5)
        run.token_count(
            11, {"input_tokens": 100, "output_tokens": 5}, {"input_tokens": 100, "output_tokens": 5}
        )
        run.complete(20)
        self.read()
        self.assertEqual(100, self.tokens("input_tokens"))

    def test_an_unknown_model_has_no_cost(self) -> None:
        run = self.rollout()
        self.ticks((0, HOUR))
        run.settings(1, model="codex-auto-review")
        run.started(1)
        run.usage_record(10, input_tokens=100, cached=0, output=5)
        run.complete(20)
        self.read()
        self.assertEqual(100, self.tokens("input_tokens"))
        self.assertIsNone(self.segments()[0]["estimated_api_cost_usd"])

    def test_a_child_thread_is_found_beside_it_and_the_day_after(self) -> None:
        run = self.rollout()
        self.ticks((0, HOUR))
        run.settings(1)
        run.started(1)
        run.complete(10)
        child = CodexRun(self.root / "codex" / "2030/03/05" / "rollout-kid.jsonl", "kid", "sess-1")
        child.settings(1)
        child.started(1)
        child.usage_record(5, input_tokens=9, cached=0, output=1)
        child.complete(20)
        grand = CodexRun(self.root / "codex" / "2030/03/04" / "rollout-grand.jsonl", "grand", "kid")
        grand.settings(1)
        grand.started(1)
        grand.complete(31)
        other = CodexRun(self.root / "codex" / "2030/03/04" / "rollout-other.jsonl", "other", "x")
        other.started(1)
        other.complete(5)
        self.read()
        self.assertEqual(19.0, self.seconds("sess-1", "kid"))
        self.assertEqual(9, self.tokens("input_tokens", "sess-1", "kid"))
        self.assertEqual(30.0, self.seconds("sess-1", "grand"))
        self.assertEqual([], self.segments("sess-1", "other"))

    def test_a_child_with_a_session_row_of_its_own_is_counted_once(self) -> None:
        run = self.rollout()
        self.ticks((0, HOUR))
        run.settings(1)
        run.started(1)
        run.complete(10)
        path = self.root / "codex" / "2030/03/04" / "rollout-kid.jsonl"
        child = CodexRun(path, "kid", "sess-1")
        child.settings(1)
        child.started(1)
        child.usage_record(5, input_tokens=9, cached=0, output=1)
        child.complete(20)
        self.conn.execute(
            "INSERT INTO sessions(id, client, transcript_path, status, started_at, last_seen)"
            " VALUES ('kid', 'codex', ?, 'active', ?, ?)",
            (str(path), stamp(0), stamp(0)),
        )
        self.conn.commit()
        self.read()
        self.assertEqual(9, self.tokens("input_tokens", "sess-1", "kid"))
        self.assertEqual([], self.segments("kid"))

    def test_a_question_to_a_person_and_a_wait_for_an_agent_are_left_out(self) -> None:
        run = self.rollout()
        self.ticks((0, 3 * HOUR))
        run.settings(1)
        run.started(1)
        run.call(10, "q", "request_user_input")
        run.output(HOUR, "q")
        run.call(HOUR + 10, "w", "wait_agent")
        run.output(2 * HOUR, "w")
        run.complete(2 * HOUR + 5)
        self.read()
        row = self.run_row()
        self.assertEqual(HOUR - 10, row["human_seconds"])
        self.assertEqual(HOUR - 10, row["subagent_seconds"])
        self.assertEqual(9 + 10 + 5, self.seconds())


class CodexSettingsTests(CodexCase):
    """What a rollout says its work ran under: the account and client of the thread, the
    effort of each turn."""

    def test_the_thread_names_its_account_and_client_and_each_turn_its_effort(self) -> None:
        run = self.rollout(originator="Codex Desktop", creator_account_id="acct-0001")
        self.ticks((0, 2 * HOUR))
        run.settings(1, effort="high")
        run.started(1)
        run.call(10, "c1")
        run.output(20, "c1")
        run.usage_record(25, input_tokens=100, cached=0, output=5)
        run.complete(30)
        run.settings(HOUR, effort="low")
        run.started(HOUR)
        run.usage_record(HOUR + 10, input_tokens=100, cached=0, output=5)
        run.complete(HOUR + 20)
        self.read()
        self.assertEqual(
            [("acct-0001", "app", "high", 29.0), ("acct-0001", "app", "low", 20.0)],
            [
                (row["organization"], row["environment"], row["effort"], row["seconds"])
                for row in self.segments()
            ],
        )
        self.assertIsNone(self.run_row()["launch_class"])

    def test_a_turn_context_in_a_running_turn_ends_the_row_at_its_record(self) -> None:
        run = self.rollout(originator="codex_vscode")
        self.ticks((0, HOUR))
        run.settings(1, effort="medium")
        run.started(1)
        run.call(10, "c1")
        run.output(20, "c1")
        run.settings(25, effort="xhigh")
        run.complete(30)
        self.read()
        self.assertEqual(
            [("ide", "medium", 24.0), ("ide", "xhigh", 5.0)],
            [(row["environment"], row["effort"], row["seconds"]) for row in self.segments()],
        )

    def test_a_rollout_that_names_none_of_it_leaves_the_columns_empty(self) -> None:
        run = self.rollout(originator="someone-else")
        self.ticks((0, HOUR))
        run.settings(1)
        run.started(1)
        run.complete(30)
        self.read()
        self.assertEqual(
            [(None, None, None)],
            [(row["organization"], row["environment"], row["effort"]) for row in self.segments()],
        )


if __name__ == "__main__":
    unittest.main()
