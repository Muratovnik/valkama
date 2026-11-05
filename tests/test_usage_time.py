"""What counts as work: made-up transcripts through the real collector and a real store.

Every expected number follows from the times in the case: the rule is the module
docstring of `usage_clock`, and a time is seconds after a fixed start.
"""

from __future__ import annotations

import itertools
import unittest

from server.telemetry.usage_clock import MODEL_WAIT_LIMIT_SECONDS
from tests.usage_fixtures import HOUR, MINUTE, Case, stamp


class PowerCutTests(Case):
    """A gap is a script or a machine that was off, and only the ticks can tell."""

    def test_a_script_cut_by_a_power_failure_counts_only_to_the_last_record(self) -> None:
        run = self.session()
        run.prompt(0)
        run.reply(10, tools=(("t1", "Bash"),))
        # Power fails five minutes into the script; the owner resumes the next day.
        self.ticks((0, 300), (20 * HOUR, 20 * HOUR + 120))
        run.prompt(20 * HOUR + 60)
        run.end_turn(20 * HOUR + 70)
        self.read()
        # The ten seconds to the call and the ten after the new prompt: nothing is built on
        # a run's end, not even the five minutes the script may have gone on.
        self.assertEqual(20.0, self.seconds())
        row = self.run_row()
        self.assertEqual(20 * HOUR + 60 - 10, round(row["gap_seconds"]))
        self.assertEqual(0, row["human_seconds"])

    def test_a_script_that_survives_a_sleep_counts_except_the_sleep(self) -> None:
        run = self.session()
        run.prompt(0)
        run.reply(10, tools=(("t1", "Bash"),))
        # Asleep from 5 minutes to 2 hours; the script ends a minute after waking.
        self.ticks((0, 5 * MINUTE), (2 * HOUR, 2 * HOUR + 2 * MINUTE))
        run.result(2 * HOUR + MINUTE, "t1")
        run.end_turn(2 * HOUR + MINUTE + 5)
        self.read()
        self.assertEqual(10 + (5 * MINUTE - 10) + MINUTE + 5, self.seconds())
        self.assertEqual(2 * HOUR - 5 * MINUTE, round(self.run_row()["gap_seconds"]))
        self.assertEqual({"observed"}, {row["quality"] for row in self.segments()})

    def test_with_no_tick_for_the_time_a_long_gap_is_cut_and_marked_estimated(self) -> None:
        run = self.session()
        run.prompt(0)
        run.reply(10, tools=(("t1", "Bash"),))
        run.result(3 * HOUR, "t1")
        self.read()
        self.assertEqual(10 + 900, self.seconds())
        self.assertEqual({"estimated"}, {row["quality"] for row in self.segments()})


class PersonTests(Case):
    def test_an_answer_an_hour_later_is_not_work(self) -> None:
        run = self.session()
        self.ticks((0, 2 * HOUR))
        run.prompt(0)
        run.end_turn(30)
        run.prompt(HOUR + 30)
        run.end_turn(HOUR + 60)
        self.read()
        self.assertEqual(60.0, self.seconds())
        self.assertEqual(HOUR, self.run_row()["human_seconds"])

    def test_a_question_to_a_person_stops_the_clock_from_call_to_answer(self) -> None:
        run = self.session()
        self.ticks((0, 2 * HOUR))
        run.prompt(0)
        run.reply(10, tools=(("q1", "AskUserQuestion"),))
        run.result(HOUR + 10, "q1")
        run.end_turn(HOUR + 20)
        self.read()
        self.assertEqual(20.0, self.seconds())
        self.assertEqual(HOUR, self.run_row()["human_seconds"])

    def test_a_permission_request_stops_the_clock_until_the_call_goes_on(self) -> None:
        run = self.session()
        self.ticks((0, 2 * HOUR))
        run.prompt(0)
        run.reply(10, tools=(("t1", "Bash"),))
        run.result(610, "t1")
        self.conn.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " session_id, received_at) VALUES ('a1', 'attention', 'confirmed', 'hook', ?, ?)",
            ("sess-1", stamp(20)),
        )
        self.conn.commit()
        self.read()
        self.assertEqual(20.0, self.seconds())
        self.assertEqual(590, round(self.run_row()["human_seconds"]))

    def test_a_turn_of_bookkeeping_records_adds_nothing(self) -> None:
        run = self.session()
        self.ticks((0, 300))
        run.prompt(0)
        run.bookkeeping()
        run.reply(10)
        run.bookkeeping()
        self.read()
        self.assertEqual(10.0, self.seconds())


class BackgroundTests(Case):
    def test_a_background_command_counts_to_its_notice_though_the_turn_ended(self) -> None:
        run = self.session()
        self.ticks((0, 2 * HOUR))
        run.prompt(0)
        run.reply(10, tools=(("b1", "Bash"),), background=True)
        run.background_result(12, "b1", "task-1")
        run.end_turn(20)
        run.system(21, "stop_hook_summary")
        run.enqueue(HOUR, tool="b1", task="task-1")
        run.notice(HOUR + 1, tool="b1", task="task-1")
        run.end_turn(HOUR + 11)
        self.read()
        self.assertEqual(HOUR + 11 - 1, round(self.seconds()))
        self.assertEqual(0, round(self.run_row()["human_seconds"]))

    def test_a_person_talking_while_it_runs_changes_nothing(self) -> None:
        run = self.session()
        self.ticks((0, 3 * HOUR))
        run.prompt(0)
        run.reply(10, tools=(("b1", "Bash"),), background=True)
        run.background_result(12, "b1", "task-1")
        run.end_turn(20)
        # A person answers after half an hour, and the command is still running.
        run.prompt(1800)
        run.end_turn(1830)
        run.enqueue(HOUR, tool="b1", task="task-1")
        self.read()
        self.assertEqual(HOUR, round(self.seconds()))
        self.assertEqual(0, round(self.run_row()["human_seconds"]))
        spans = sorted((row["started_at"], row["ended_at"]) for row in self.segments())
        for (_, ended), (started, _) in itertools.pairwise(spans):
            self.assertLessEqual(ended, started)

    def test_a_command_that_never_notifies_counts_for_nothing_past_the_turn(self) -> None:
        run = self.session()
        self.ticks((0, 3 * HOUR))
        run.prompt(0)
        run.reply(10, tools=(("b1", "Bash"),), background=True)
        run.background_result(12, "b1", "task-1")
        run.end_turn(20)
        run.prompt(2 * HOUR)
        run.end_turn(2 * HOUR + 10)
        self.read()
        self.assertEqual(30.0, self.seconds())
        self.assertEqual(2 * HOUR - 20, round(self.run_row()["human_seconds"]))

    def test_a_background_wait_through_a_machine_off_counts_only_the_ticked_part(self) -> None:
        run = self.session()
        self.ticks((0, 10 * MINUTE), (3 * HOUR, 3 * HOUR + 10 * MINUTE))
        run.prompt(0)
        run.reply(10, tools=(("b1", "Bash"),), background=True)
        run.background_result(12, "b1", "task-1")
        run.end_turn(20)
        run.enqueue(3 * HOUR + 5 * MINUTE, tool="b1", task="task-1")
        self.read()
        self.assertEqual(10 * MINUTE + 5 * MINUTE, self.seconds())
        self.assertEqual(3 * HOUR - 10 * MINUTE, round(self.run_row()["gap_seconds"]))

    def test_a_monitor_counts_up_to_its_last_event(self) -> None:
        run = self.session()
        self.ticks((0, 3 * HOUR))
        run.prompt(0)
        run.reply(10, tools=(("m1", "Monitor"),))
        run.result(11, "m1", taskId="mon-1", timeoutMs=1000, persistent=False)
        run.end_turn(20)
        run.enqueue(1000, task="mon-1", status=None)
        run.prompt(2000)
        self.read()
        self.assertEqual(1000.0, self.seconds())
        self.assertEqual(1000, round(self.run_row()["human_seconds"]))


class SubagentTests(Case):
    def test_waiting_for_a_subagent_is_its_time_and_not_the_coordinators(self) -> None:
        run = self.session()
        self.ticks((0, 3 * HOUR))
        run.prompt(0)
        run.reply(10, tools=(("a1", "Agent"),))
        run.agent_launched(10, "a1", "worker")
        run.end_turn(20)
        run.system(21, "stop_hook_summary")
        worker = self.subagent("sess-1", "worker")
        worker.prompt(13, "build MAIN-1", origin=None)
        worker.reply(14, tools=(("s1", "Bash"),))
        worker.result(HOUR - 1, "s1")
        worker.end_turn(HOUR)
        run.enqueue(HOUR + 1, tool="a1", task="worker")
        run.notice(HOUR + 2, tool="a1", task="worker")
        run.end_turn(HOUR + 12)
        self.read()
        self.assertEqual(21 + 10, self.seconds())
        self.assertEqual(HOUR + 2 - 21, round(self.run_row()["subagent_seconds"]))
        self.assertEqual(HOUR - 13, self.seconds("sess-1", "worker"))

    def test_a_subagent_with_no_transcript_leaves_the_wait_with_its_coordinator(self) -> None:
        run = self.session()
        self.ticks((0, 3 * HOUR))
        run.prompt(0)
        run.reply(10, tools=(("a1", "Agent"),))
        run.result(HOUR, "a1", status="completed", agentId="gone")
        run.end_turn(HOUR + 10)
        self.read()
        self.assertEqual(HOUR + 10, self.seconds())
        self.assertEqual(0, self.run_row()["subagent_seconds"])

    def test_a_foreground_subagent_with_a_transcript_is_not_counted_twice(self) -> None:
        run = self.session()
        self.ticks((0, 3 * HOUR))
        worker = self.subagent("sess-1", "worker")
        worker.prompt(11, "go", origin=None)
        worker.end_turn(HOUR)
        run.prompt(0)
        run.reply(10, tools=(("a1", "Agent"),))
        run.result(HOUR, "a1", status="completed", agentId="worker")
        run.end_turn(HOUR + 10)
        self.read()
        self.assertEqual(20.0, self.seconds())
        self.assertEqual(HOUR - 10, self.run_row()["subagent_seconds"])

    def test_a_subagent_waiting_for_its_coordinator_is_not_working(self) -> None:
        self.session()
        self.ticks((0, 3 * HOUR))
        worker = self.subagent("sess-1", "worker")
        worker.prompt(0, "go", origin=None)
        worker.end_turn(100)
        worker.prompt(2 * HOUR, "more", origin="coordinator", isMeta=True)
        worker.end_turn(2 * HOUR + 50)
        self.read()
        self.assertEqual(150.0, self.seconds("sess-1", "worker"))
        self.assertEqual(2 * HOUR - 100, self.run_row("sess-1", "worker")["subagent_seconds"])


class FailureTests(Case):
    def test_an_api_error_until_the_next_reply_is_external(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(10)
        run.system(20, "api_error")
        run.system(60, "api_error")
        run.end_turn(100)
        self.read()
        self.assertEqual(20.0, self.seconds())
        self.assertEqual(80, self.run_row()["external_seconds"])

    def test_a_model_wait_past_the_limit_is_external_and_up_to_it_is_work(self) -> None:
        run = self.session()
        self.ticks((0, 3 * HOUR))
        run.prompt(0)
        run.end_turn(MODEL_WAIT_LIMIT_SECONDS)
        run.prompt(MODEL_WAIT_LIMIT_SECONDS + 1)
        run.end_turn(2 * MODEL_WAIT_LIMIT_SECONDS + 2)
        self.read()
        self.assertEqual(MODEL_WAIT_LIMIT_SECONDS, self.seconds())
        self.assertEqual(MODEL_WAIT_LIMIT_SECONDS + 1, self.run_row()["external_seconds"])
        # The tokens of the long request still count: it was spent whatever the wait.
        self.assertEqual(2, len([r for r in self.segments() if r["output_tokens"]]))

    def test_a_synthetic_reply_costs_nothing_and_is_no_model(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(10)
        run.reply(40, stop="stop_sequence", model="<synthetic>", spent={}, isApiErrorMessage=True)
        self.read()
        self.assertEqual(10.0, self.seconds())
        self.assertEqual({"claude-opus-5-5"}, {row["model"] for row in self.segments()})


if __name__ == "__main__":
    unittest.main()
