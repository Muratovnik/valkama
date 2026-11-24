"""The report of pauses before model requests: wakes, waits, buckets, shares and the CLI.

Every transcript here is made up (`usage_fixtures`); the hook messages keep the shapes the
clients hand them over in, with invented text after the `keepwarm:` prefix.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import multiprocessing
import sqlite3
import time
import unittest
from pathlib import Path
from unittest import mock

from server import cli
from server.analytics import api, pauses
from server.projects import project_registry
from server.telemetry import usage_pauses
from server.telemetry.usage_steps import NOTICE, NOTIFIED, SERVICE, claude_step, codex_step, is_wake
from tests.registry_fixtures import project_entry
from tests.usage_fixtures import HOUR, MINUTE, ORG_A, ORG_B, Case, CodexRun, epoch, stamp, usage

SESSION = "sess-p"

#: How long `slow_chunk` takes over a chunk: a chunk the pool is still reading at a deadline.
SLOW_SECONDS = 1.5


def slow_chunk(targets: list) -> list:
    """`pauses._chunk_bins` that takes `SLOW_SECONDS` first; a process of the pool imports it."""

    time.sleep(SLOW_SECONDS)
    return pauses._chunk_bins(targets)


def children_gone(within: float = 15.0) -> bool:
    """Whether this process's children have all ended, waiting for them `within` seconds."""

    ends = time.monotonic() + within
    while multiprocessing.active_children():
        if time.monotonic() > ends:
            return False
        time.sleep(0.1)
    return True


#: How each client hands a hook's message to the model, as the module of the steps says.
ASYNC_REWAKE = (
    "<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>\n"
    '<system-reminder>\nStop hook blocking error from command "Stop": {message}\r\n\n'
    "</system-reminder>"
)
STOP_FEEDBACK = "Stop hook feedback:\n{message}"
CODEX_HOOK = '<hook_prompt hook_run_id="stop:1:config.toml">{message}</hook_prompt>'


def _claude_user(text: str, **fields: object) -> dict:
    return {
        "type": "user",
        "timestamp": stamp(0),
        "sessionId": SESSION,
        "message": {"role": "user", "content": text},
        **fields,
    }


class WakeRecognitionTests(unittest.TestCase):
    """A wake is told by the literal prefix, in each shape a client hands it over in."""

    def test_each_shape_with_the_prefix_is_a_wake(self) -> None:
        message = "keepwarm: 2 jobs running; answer in one word"
        rewake = claude_step(
            _claude_user(
                ASYNC_REWAKE.format(message=message),
                origin={"kind": "task-notification", "producer": "session-task"},
            ),
            SESSION,
        )
        enqueued = claude_step(
            {
                "type": "queue-operation",
                "operation": "enqueue",
                "timestamp": stamp(0),
                "sessionId": SESSION,
                "content": ASYNC_REWAKE.format(message=message),
            },
            SESSION,
        )
        blocked = claude_step(
            _claude_user(STOP_FEEDBACK.format(message=message), isMeta=True), SESSION
        )
        codex = codex_step(
            {
                "timestamp": stamp(0),
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": CODEX_HOOK.format(message=message)}],
                },
            },
            {},
        )
        steps = {"rewake": rewake, "enqueued": enqueued, "blocked": blocked, "codex": codex}
        self.assertEqual(dict.fromkeys(steps, True), {n: s.wake for n, s in steps.items()})
        self.assertEqual(
            [NOTICE, NOTIFIED, SERVICE, SERVICE], [step.kind for step in steps.values()]
        )

    def test_a_hook_message_without_the_prefix_is_no_wake(self) -> None:
        for shape in (ASYNC_REWAKE, STOP_FEEDBACK, CODEX_HOOK):
            for message in ("KEEPWARM probe 1: reply ok", "check the job", " keepwarm: late"):
                with self.subTest(shape=shape[:20], message=message):
                    self.assertFalse(is_wake(shape.format(message=message)))

    def test_the_prefix_from_a_person_or_outside_a_hook_is_no_wake(self) -> None:
        person = claude_step(
            _claude_user("keepwarm: what is this?", origin={"kind": "human"}), SESSION
        )
        self.assertFalse(person.wake)
        self.assertFalse(is_wake("keepwarm: a plain message"))
        # The prefix later in a hook's text is that hook's own words, not a wake.
        self.assertFalse(is_wake(STOP_FEEDBACK.format(message="wait; keepwarm: later")))

    def test_an_older_feedback_line_naming_its_hook_is_a_wake(self) -> None:
        self.assertTrue(is_wake("Stop hook feedback:\n- [python hook.py]: keepwarm: one job"))


class BucketTests(unittest.TestCase):
    """Each edge of the documented table belongs to the bucket it opens."""

    def test_each_edge_opens_its_bucket(self) -> None:
        cases = {
            0: "0-4m",
            4 * MINUTE - 0.001: "0-4m",
            4 * MINUTE: "4-5m",
            5 * MINUTE - 0.001: "4-5m",
            5 * MINUTE: "5-6m",
            6 * MINUTE: "6-30m",
            30 * MINUTE: "30-60m",
            60 * MINUTE - 0.001: "30-60m",
            60 * MINUTE: "60-70m",
            70 * MINUTE: "70m-3h",
            3 * HOUR: "3-12h",
            12 * HOUR - 0.001: "3-12h",
            12 * HOUR: "12h+",
            40 * HOUR: "12h+",
        }
        got = {pause: pauses.BUCKETS[pauses.bucket_of(pause)][0] for pause in cases}
        self.assertEqual(cases, got)


class PausesCase(Case):
    """A store and transcripts, read by the usage reader, then reported on."""

    def report(self, *, start: float = 0, end: float = 40 * HOUR, **options: object) -> dict:
        self.ticks((0, 30 * MINUTE))
        self.read()
        self.reader.row_factory = sqlite3.Row
        return pauses.read(
            self.reader,
            start=epoch(start),
            end=epoch(end),
            reader=pauses.Reader(),
            **options,
        )

    @staticmethod
    def rows(report: dict, **match: object) -> list[dict]:
        return [
            row
            for row in report["rows"]
            if all(row[name] == value for name, value in match.items())
        ]


class WaitTests(PausesCase):
    def test_a_person_a_tool_and_a_wake_each_wait_apart(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(5)
        # A person comes back 65 minutes after the first request was sent.
        run.prompt(65 * MINUTE)
        run.reply(65 * MINUTE + 3, tools=(("t1", "Bash"),))
        # A tool that ran five and a half minutes.
        run.result(65 * MINUTE + 3 + 330, "t1")
        run.end_turn(65 * MINUTE + 340)
        # The asyncRewake hook's wake, enqueued and handed over, 50 minutes on.
        woken = 65 * MINUTE + 333 + 50 * MINUTE
        message = ASYNC_REWAKE.format(message="keepwarm: 1 job running")
        run.raw(
            json.dumps(
                {
                    "type": "queue-operation",
                    "operation": "enqueue",
                    "timestamp": stamp(woken),
                    "sessionId": SESSION,
                    "content": message,
                }
            )
            + "\n"
        )
        run.prompt(woken, message, origin="task-notification")
        run.end_turn(woken + 2)
        report = self.report()
        got = {(row["wait"], row["bucket"]): row["requests"] for row in report["rows"]}
        self.assertEqual(
            {("person", "60-70m"): 1, ("machine", "5-6m"): 1, ("wake", "30-60m"): 1}, got
        )
        self.assertEqual({"main"}, {row["role"] for row in report["rows"]})

    def test_a_question_to_a_person_is_a_person_wait(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.reply(2, tools=(("q1", "AskUserQuestion"),))
        run.result(20 * MINUTE, "q1")
        run.end_turn(20 * MINUTE + 4)
        self.assertEqual(
            [("person", "6-30m")],
            [(row["wait"], row["bucket"]) for row in self.report()["rows"]],
        )

    def test_bookkeeping_around_a_prompt_does_not_hide_the_person(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(3)
        run.system(4, "stop_hook_summary")
        run.prompt(2 * HOUR)
        # Bookkeeping between the prompt and its request changes nothing either.
        run.system(2 * HOUR + 1, "informational")
        run.end_turn(2 * HOUR + 3)
        self.assertEqual(
            [("person", "70m-3h")],
            [(row["wait"], row["bucket"]) for row in self.report()["rows"]],
        )

    def test_a_subagent_held_by_its_stop_hook_is_woken(self) -> None:
        self.session(SESSION)
        agent = self.subagent(SESSION, "agent-1")
        agent.prompt(0, origin=None)
        agent.end_turn(2)
        agent.prompt(
            250,
            STOP_FEEDBACK.format(message="keepwarm: read the job's output"),
            origin=None,
            isMeta=True,
        )
        agent.end_turn(252)
        report = self.report()
        self.assertEqual(
            [("subagent", "wake", "4-5m", 1)],
            [(r["role"], r["wait"], r["bucket"], r["requests"]) for r in report["rows"]],
        )


class MeasureTests(PausesCase):
    def test_shares_are_of_the_rows_tokens_together_and_cold_is_per_request(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(2, spent=usage(input_tokens=10, read=0, write_5m=990))
        # Two requests after pauses of the same bucket: one warm, one rebuilt.
        run.prompt(10 * MINUTE)
        run.end_turn(10 * MINUTE + 2, spent=usage(input_tokens=10, read=890, write_5m=100))
        run.prompt(20 * MINUTE)
        run.end_turn(
            20 * MINUTE + 2, spent=usage(input_tokens=10, read=0, write_5m=0, write_1h=990)
        )
        row = self.rows(self.report(), bucket="6-30m")
        self.assertEqual(1, len(row))
        row = row[0]
        self.assertEqual(2, row["requests"])
        self.assertEqual(2000, row["context_tokens"])
        self.assertEqual(
            (20, 890, 100, 990),
            (
                row["input_tokens"],
                row["cached_read_tokens"],
                row["cache_write_5m_tokens"],
                row["cache_write_1h_tokens"],
            ),
        )
        self.assertEqual(0.445, row["read_share"])
        self.assertEqual(0.545, row["write_share"])
        self.assertEqual(1, row["cold_requests"])

    def test_a_request_written_over_several_records_counts_once(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(2)
        run.prompt(10 * MINUTE)
        request = run.reply(10 * MINUTE + 1, spent=usage(read=500, write_5m=0, output=1))
        run.reply(
            10 * MINUTE + 2, request=request, stop="end_turn", spent=usage(read=500, output=40)
        )
        (row,) = self.report()["rows"]
        self.assertEqual(
            (1, 500, 20), (row["requests"], row["cached_read_tokens"], row["cache_write_5m_tokens"])
        )

    def test_the_first_request_of_a_run_has_no_pause(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(2)
        self.assertEqual([], self.report()["rows"])

    def test_a_price_known_and_unknown(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(2)
        run.prompt(MINUTE)
        run.end_turn(MINUTE + 2)
        run.prompt(2 * MINUTE)
        run.end_turn(2 * MINUTE + 2, model="made-up-model")
        rows = {row["model"]: row for row in self.report()["rows"]}
        self.assertEqual(0, rows["claude-opus-5-5"]["unpriced_requests"])
        self.assertGreater(rows["claude-opus-5-5"]["estimated_api_cost_usd"], 0)
        self.assertEqual(1, rows["made-up-model"]["unpriced_requests"])
        self.assertEqual(0, rows["made-up-model"]["estimated_api_cost_usd"])


class BackgroundTests(PausesCase):
    def test_a_request_while_background_work_runs_is_counted_apart(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.reply(2, tools=(("b1", "Bash"),), background=True)
        run.background_result(3, "b1", "task-1")
        run.end_turn(5)
        # The person writes while the command still runs, then again after its notice.
        run.prompt(10 * MINUTE)
        run.end_turn(10 * MINUTE + 2, spent=usage(read=0, write_5m=500))
        run.notice(15 * MINUTE, task="task-1")
        run.end_turn(15 * MINUTE + 2)
        run.prompt(25 * MINUTE)
        run.end_turn(25 * MINUTE + 2)
        got = {
            (row["wait"], row["bucket"]): (
                row["requests"],
                row["background_requests"],
                row["background_cold_requests"],
            )
            for row in self.report()["rows"]
        }
        self.assertEqual(
            {
                ("person", "6-30m"): (2, 1, 1),
                ("machine", "0-4m"): (1, 1, 0),
                # The notice came 300 s after the person's request: a lower edge, held.
                ("machine", "5-6m"): (1, 0, 0),
            },
            got,
        )

    def test_a_codex_rollout_tells_no_background_work(self) -> None:
        path = self.root / "sessions" / "2030" / "03" / "04" / "rollout-1.jsonl"
        self.session("thread-1", client="codex", path=path)
        rollout = CodexRun(path, "thread-1", originator="codex_vscode")
        rollout.settings(0)
        rollout.started(0)
        rollout.usage_record(5, input_tokens=1000, cached=0, output=5)
        rollout.complete(6)
        rollout.message(40 * MINUTE, role="user", text=CODEX_HOOK.format(message="keepwarm: x"))
        rollout.usage_record(40 * MINUTE + 3, input_tokens=1000, cached=900, output=5)
        rollout.complete(40 * MINUTE + 4)
        (row,) = self.report()["rows"]
        self.assertEqual(
            ("codex", "main", "wake", "30-60m", 0.9, False, None),
            (
                row["client"],
                row["role"],
                row["wait"],
                row["bucket"],
                row["read_share"],
                row["background_known"],
                row["background_requests"],
            ),
        )


class EnvironmentTests(PausesCase):
    def test_an_organization_the_quota_knows_is_a_subscription(self) -> None:
        self.conn.execute(
            "INSERT INTO quota_accounts(organization, account_uuid) VALUES (?, 'acct-1')", (ORG_A,)
        )
        self.conn.commit()
        for session, organization in (("sess-a", ORG_A), ("sess-b", ORG_B)):
            run = self.session(session)
            run.credential(0, organization)
            run.prompt(0)
            run.end_turn(2)
            run.prompt(MINUTE)
            run.end_turn(MINUTE + 2)
        rows = self.report()["rows"]
        self.assertEqual(2, len(rows))
        self.assertEqual({"subscription", None}, {row["auth"] for row in rows})

    def test_a_period_counts_the_hours_it_holds(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(2)
        for hour in (1, 3, 5):
            run.prompt(hour * HOUR + 10)
            run.end_turn(hour * HOUR + 12)
        # From inside the third hour to inside the fifth: the third and fourth whole hours.
        report = self.report(start=3 * HOUR + 30 * MINUTE, end=4 * HOUR + 10)
        self.assertEqual([1], [row["requests"] for row in report["rows"]])
        self.assertEqual(stamp(3 * HOUR).replace(".000Z", "+00:00"), report["from"])
        self.assertEqual(stamp(5 * HOUR).replace(".000Z", "+00:00"), report["to"])


class ReaderTests(PausesCase):
    def test_a_file_is_read_again_only_when_it_changed(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(2)
        run.prompt(MINUTE)
        run.end_turn(MINUTE + 2)
        self.ticks((0, 30 * MINUTE))
        self.read()
        self.reader.row_factory = sqlite3.Row
        reader = pauses.Reader()
        real = usage_pauses.read_requests
        with mock.patch.object(usage_pauses, "read_requests", side_effect=real) as reading:
            first = pauses.read(self.reader, start=epoch(0), end=epoch(HOUR), reader=reader)
            again = pauses.read(self.reader, start=epoch(0), end=epoch(HOUR), reader=reader)
            self.assertEqual(1, reading.call_count)
            run.prompt(2 * MINUTE)
            run.end_turn(2 * MINUTE + 2)
            later = pauses.read(self.reader, start=epoch(0), end=epoch(HOUR), reader=reader)
            self.assertEqual(2, reading.call_count)
        self.assertEqual(first["rows"], again["rows"])
        self.assertEqual([2], [row["requests"] for row in later["rows"]])

    def three_sessions(self, count: int = 3) -> None:
        for number in range(count):
            run = self.session(f"{SESSION}-{number}")
            run.prompt(0)
            run.end_turn(2)
            run.prompt((number + 1) * MINUTE)
            run.end_turn((number + 1) * MINUTE + 2)

    def test_many_runs_read_over_processes_report_what_one_process_reads(self) -> None:
        # Three runs to read with the pool's threshold at two go to a pool of two processes;
        # the oracle is the same store read with the pool out of reach. This process cannot
        # read a transcript while the pool reads, so a read that fell back here would fail.
        self.three_sessions()
        with mock.patch.object(pauses, "POOL_FROM", 10**6):
            alone = self.report(end=HOUR)
        here = AssertionError("read in this process, not the pool's")
        with (
            mock.patch.object(pauses, "POOL_FROM", 2),
            mock.patch.object(pauses, "POOL_WORKERS", 2),
            mock.patch.object(
                pauses.Reader, "_send", autospec=True, side_effect=pauses.Reader._send
            ) as pooled,
            mock.patch.object(usage_pauses, "read_requests", side_effect=here),
        ):
            spread = self.report(end=HOUR)
        self.assertEqual(1, pooled.call_count)
        self.assertEqual(3, len(pooled.call_args.args[1]))
        self.assertEqual(alone, spread)
        self.assertEqual({"read": 3, "missing": 0}, spread["runs"])
        self.assertEqual([3], [row["requests"] for row in spread["rows"]])

    def test_a_read_past_its_deadline_says_how_far_it_got_and_goes_on_from_there(self) -> None:
        # The oracle is the same store read with no deadline. A deadline already past reads no
        # run here; over the pool, it answers before a process could read five of eight. Either
        # way the read asked again with no deadline answers what an unbounded read does.
        self.three_sessions(8)
        alone = self.report(end=HOUR)
        self.reader.row_factory = sqlite3.Row
        for pool_from in (10**6, 2):
            with (
                self.subTest(pool_from=pool_from),
                mock.patch.object(pauses, "POOL_FROM", pool_from),
                mock.patch.object(pauses, "POOL_WORKERS", 2),
                mock.patch.object(pauses, "_CHUNK", 1),
            ):
                reader = pauses.Reader()
                self.addCleanup(reader.close)
                past = time.monotonic() - 1
                with self.assertRaises(pauses.UnfinishedError) as stopped:
                    pauses.read(
                        self.reader, start=epoch(0), end=epoch(HOUR), reader=reader, until=past
                    )
                self.assertEqual(8, stopped.exception.read + stopped.exception.left)
                self.assertGreaterEqual(stopped.exception.left, 5)
                if pool_from > 8:
                    self.assertEqual((0, 8), (stopped.exception.read, stopped.exception.left))
                again = pauses.read(self.reader, start=epoch(0), end=epoch(HOUR), reader=reader)
                self.assertEqual(alone, again)

    def slow_reader(self, count: int) -> pauses.Reader:
        """A reader whose pool takes `SLOW_SECONDS` a chunk, over `count` runs already recorded."""

        self.three_sessions(count)
        self.report(end=HOUR)
        self.reader.row_factory = sqlite3.Row
        reader = pauses.Reader(slow_chunk)
        self.addCleanup(reader.close)
        return reader

    def test_a_read_answers_by_its_deadline_and_the_next_takes_what_the_pool_went_on_reading(
        self,
    ) -> None:
        # Chunks still being read at the deadline are neither waited for nor read again: the read
        # answers by it, and the read asked again takes their results with nothing sent to the
        # pool. Once it has nothing left to read the pool's processes end.
        with (
            mock.patch.object(pauses, "POOL_FROM", 2),
            mock.patch.object(pauses, "POOL_WORKERS", 2),
            mock.patch.object(pauses, "_CHUNK", 1),
        ):
            reader = self.slow_reader(3)
            alone = self.report(end=HOUR)
            began = time.monotonic()
            with self.assertRaises(pauses.UnfinishedError) as stopped:
                pauses.read(
                    self.reader, start=epoch(0), end=epoch(HOUR), reader=reader, until=began + 0.3
                )
            self.assertLess(time.monotonic() - began, SLOW_SECONDS)
            self.assertEqual((0, 3), (stopped.exception.read, stopped.exception.left))
            real = pauses.futures.ProcessPoolExecutor.submit
            with mock.patch.object(
                pauses.futures.ProcessPoolExecutor, "submit", autospec=True, side_effect=real
            ) as sent:
                again = pauses.read(self.reader, start=epoch(0), end=epoch(HOUR), reader=reader)
            self.assertEqual(0, sent.call_count)
        self.assertEqual(alone, again)
        self.assertTrue(children_gone())

    def test_closing_the_reader_ends_its_processes_and_calls_off_what_they_had_not_started(
        self,
    ) -> None:
        with (
            mock.patch.object(pauses, "POOL_FROM", 2),
            mock.patch.object(pauses, "POOL_WORKERS", 2),
            mock.patch.object(pauses, "_CHUNK", 1),
        ):
            reader = self.slow_reader(8)
            with self.assertRaises(pauses.UnfinishedError):
                pauses.read(
                    self.reader,
                    start=epoch(0),
                    end=epoch(HOUR),
                    reader=reader,
                    until=time.monotonic(),
                )
            reader.close()
        # Joined, not left to end: no process of the pool outlives the close.
        self.assertEqual([], multiprocessing.active_children())
        # A pool of two holds at most three chunks past its queue; the other runs were called off.
        self.assertLess(len(reader._kept), 8)

    def test_a_pool_that_cannot_start_reads_here(self) -> None:
        self.three_sessions()
        with (
            mock.patch.object(pauses, "POOL_FROM", 2),
            mock.patch.object(
                pauses.futures, "ProcessPoolExecutor", side_effect=OSError("no process")
            ),
        ):
            report = self.report(end=HOUR)
        self.assertEqual([3], [row["requests"] for row in report["rows"]])


#: The fields the CLI's JSON promises (`docs/guides/commands.md`), each row's and the whole's.
REPORT_FIELDS = {
    "interface_version",
    "from",
    "to",
    "project",
    "buckets",
    "waits",
    "cold_share",
    "runs",
    "rows",
}
ROW_FIELDS = {
    "client",
    "role",
    "model",
    "auth",
    "wait",
    "bucket",
    "requests",
    "context_tokens",
    "input_tokens",
    "cached_read_tokens",
    "cache_write_5m_tokens",
    "cache_write_1h_tokens",
    "read_share",
    "write_share",
    "cold_requests",
    "estimated_api_cost_usd",
    "unpriced_requests",
    "background_known",
    "background_requests",
    "background_cold_requests",
}


class HttpReadTests(PausesCase):
    """The Analytics boundary answers the CLI's report, its period as the usage read's."""

    def test_the_read_answers_the_report_under_its_name(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(2)
        run.prompt(7 * MINUTE)
        run.end_turn(7 * MINUTE + 2)
        self.ticks((0, 30 * MINUTE))
        self.read()
        self.reader.row_factory = sqlite3.Row
        self.assertIn(api.PAUSES_PATH, api.READ_PATHS)
        status, body = api.handle_get(
            self.reader,
            api.PAUSES_PATH,
            {"from": ["2030-03-04"], "to": ["2030-03-05"], "utc_offset": ["120"]},
        )
        self.assertEqual(200, status)
        self.assertEqual(api.ANALYTICS_API_INTERFACE, body["interface_version"])
        report = body["pauses"]
        self.assertEqual(REPORT_FIELDS, set(report))
        # The caller's midnight at two hours east of UTC, as a whole hour of UTC.
        self.assertEqual("2030-03-03T22:00:00+00:00", report["from"])
        self.assertEqual([("person", "6-30m")], [(r["wait"], r["bucket"]) for r in report["rows"]])

    def test_a_read_out_of_time_answers_202_with_how_far_it_got(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(2)
        run.prompt(7 * MINUTE)
        run.end_turn(7 * MINUTE + 2)
        self.ticks((0, 30 * MINUTE))
        self.read()
        self.reader.row_factory = sqlite3.Row
        period = {"from": ["2030-03-04"], "to": ["2030-03-05"], "utc_offset": ["120"]}
        with mock.patch.object(api, "PAUSES_BUDGET_SECONDS", -1.0):
            status, body = api.handle_get(self.reader, api.PAUSES_PATH, period)
        self.assertEqual(202, status)
        self.assertEqual(
            {
                "interface_version": api.ANALYTICS_API_INTERFACE,
                "reading": {"runs_read": 0, "runs_left": 1},
            },
            body,
        )
        status, body = api.handle_get(self.reader, api.PAUSES_PATH, period)
        self.assertEqual(200, status)
        self.assertEqual(1, len(body["pauses"]["rows"]))

    def test_another_parameter_or_no_period_is_refused(self) -> None:
        for parameters in (
            {"from": ["2030-03-04"], "to": ["2030-03-05"], "client": ["codex"]},
            {"from": ["2030-03-04"]},
            {"from": ["2030-03-05"], "to": ["2030-03-04"]},
        ):
            with self.subTest(parameters=parameters):
                try:
                    api.handle_get(self.reader, api.PAUSES_PATH, parameters)
                except Exception as error:  # noqa: BLE001 -- the envelope is what is checked
                    status, body = api.error_response(error)
                else:
                    self.fail("the read was answered")
                self.assertEqual(400, status)
                self.assertEqual("invalid_request", body["error"]["code"])


class ProjectTests(PausesCase):
    """A project's report holds the runs whose work the usage read places in that project."""

    def three_in_two_projects(self) -> dict:
        # Sessions 0 and 2 work under alpha's root, session 1 under beta's; none has a task, so
        # each run's project is the one whose root holds its session's working directory.
        folders = {0: "alpha/web", 1: "beta", 2: "alpha"}
        for number, folder in folders.items():
            run = self.session(f"{SESSION}-{number}")
            run.prompt(0)
            run.end_turn(2)
            run.prompt((number + 1) * MINUTE)
            run.end_turn((number + 1) * MINUTE + 2)
            self.conn.execute(
                "UPDATE sessions SET cwd = ? WHERE id = ?",
                (str(self.root / folder), f"{SESSION}-{number}"),
            )
        self.conn.commit()
        return {"projects": [project_entry(name, self.root / name) for name in ("alpha", "beta")]}

    def test_a_project_counts_only_its_runs_and_no_project_counts_every_run(self) -> None:
        registry = self.three_in_two_projects()
        with mock.patch.object(project_registry, "read_registry", return_value=registry):
            alpha = self.report(end=HOUR, project="alpha")
            beta = self.report(end=HOUR, project="beta")
            every = self.report(end=HOUR)
            none = self.report(end=HOUR, project="gamma")
        self.assertEqual(("alpha", {"read": 2, "missing": 0}), (alpha["project"], alpha["runs"]))
        self.assertEqual([2], [row["requests"] for row in alpha["rows"]])
        self.assertEqual([1], [row["requests"] for row in beta["rows"]])
        self.assertEqual(
            (None, [3]), (every["project"], [row["requests"] for row in every["rows"]])
        )
        self.assertEqual(([], {"read": 0, "missing": 0}), (none["rows"], none["runs"]))

    def test_the_read_and_the_command_take_the_project(self) -> None:
        registry = self.three_in_two_projects()
        self.ticks((0, 30 * MINUTE))
        self.read()
        self.reader.row_factory = sqlite3.Row
        period = {"from": ["2030-03-04"], "to": ["2030-03-05"], "utc_offset": ["0"]}
        with mock.patch.object(project_registry, "read_registry", return_value=registry):
            status, body = api.handle_get(
                self.reader, api.PAUSES_PATH, {**period, "project": ["beta"]}
            )
            stream = io.StringIO()
            with contextlib.redirect_stdout(stream):
                cli.main(
                    [
                        "usage",
                        "pauses",
                        "--json",
                        "--project",
                        "alpha",
                        "--since",
                        "2030-03-04",
                        "--until",
                        "2030-03-05",
                    ]
                )
        self.assertEqual((200, "beta"), (status, body["pauses"]["project"]))
        self.assertEqual({"read": 1, "missing": 0}, body["pauses"]["runs"])
        self.assertEqual({"read": 2, "missing": 0}, json.loads(stream.getvalue())["runs"])


class CommandTests(PausesCase):
    def invoke(self, *argv: str) -> str:
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            cli.main(list(argv))
        return stream.getvalue()

    def store_bytes(self) -> dict[str, str]:
        found = {}
        for suffix in ("", "-wal"):
            path = Path(self.store_path + suffix)
            if path.exists():
                found[suffix] = hashlib.sha256(path.read_bytes()).hexdigest()
        return found

    def test_the_json_keeps_its_contract_and_the_store_is_only_read(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(2)
        run.prompt(7 * MINUTE)
        run.end_turn(7 * MINUTE + 2)
        self.ticks((0, 30 * MINUTE))
        self.read()
        self.conn.commit()
        before = self.store_bytes()
        output = self.invoke(
            "usage", "pauses", "--json", "--since", "2030-03-04", "--until", "2030-03-05"
        )
        self.assertEqual(before, self.store_bytes())
        report = json.loads(output)
        self.assertEqual(REPORT_FIELDS, set(report))
        self.assertEqual("valkama-usage-pauses", report["interface_version"])
        self.assertEqual(
            ["0-4m", "4-5m", "5-6m", "6-30m", "30-60m", "60-70m", "70m-3h", "3-12h", "12h+"],
            [bucket["key"] for bucket in report["buckets"]],
        )
        self.assertEqual(
            {"from_seconds": 0, "to_seconds": 240},
            {name: report["buckets"][0][name] for name in ("from_seconds", "to_seconds")},
        )
        self.assertIsNone(report["buckets"][-1]["to_seconds"])
        self.assertEqual(["machine", "person", "wake"], report["waits"])
        self.assertEqual({"read": 1, "missing": 0}, report["runs"])
        (row,) = report["rows"]
        self.assertEqual(ROW_FIELDS, set(row))
        self.assertEqual(("person", "6-30m", 1), (row["wait"], row["bucket"], row["requests"]))

    def test_text_names_each_environment_and_bucket(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(2)
        run.prompt(7 * MINUTE)
        run.end_turn(7 * MINUTE + 2)
        self.ticks((0, 30 * MINUTE))
        self.read()
        output = self.invoke("usage", "pauses", "--since", "2030-03-04", "--until", "2030-03-05")
        self.assertIn("claude main claude-opus-5-5 (auth unknown), waits on person", output)
        self.assertRegex(output, r"\n  6-30m +1 ")

    def test_a_client_narrows_the_runs_read(self) -> None:
        run = self.session(SESSION)
        run.prompt(0)
        run.end_turn(2)
        run.prompt(MINUTE)
        run.end_turn(MINUTE + 2)
        self.ticks((0, 30 * MINUTE))
        self.read()
        report = json.loads(
            self.invoke(
                "usage",
                "pauses",
                "--json",
                "--since",
                "2030-03-04",
                "--until",
                "2030-03-05",
                "--client",
                "codex",
            )
        )
        self.assertEqual(({"read": 0, "missing": 0}, []), (report["runs"], report["rows"]))

    def test_a_moment_without_its_offset_is_refused(self) -> None:
        stream = io.StringIO()
        with contextlib.redirect_stderr(stream), self.assertRaises(SystemExit) as stopped:
            cli.main(["usage", "pauses", "--since", "2030-03-04T10:00"])
        self.assertEqual(2, stopped.exception.code)
        self.assertIn("a time needs its offset", stream.getvalue())


if __name__ == "__main__":
    unittest.main()
