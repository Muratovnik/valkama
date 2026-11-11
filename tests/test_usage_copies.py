"""A subagent file copied into a forked session's folder is not the fork's work.

The client copies the original session's subagent transcripts into the fork's folder,
and every record of a copy still names the original session. The original's own folder
keeps the originals, so the copy's run counts neither time nor tokens, whichever of the
two was read first; and a store whose copy counted a request under an older reading
gives it back to the original once both are read again, and stays there.
"""

from __future__ import annotations

import shutil
import unittest
from unittest import mock

from server.ops import doctor
from server.telemetry import usage_collect, usage_rebuild, usage_steps
from server.telemetry.usage_ledger import request_key
from server.telemetry.usage_store import READING
from tests.usage_fixtures import HOUR, Case, ClaudeRun, usage

ORIGIN = "origin"
FORK = "forked"
WORKER = "worker"
OUTPUT = 70
#: The worker's time: from its prompt to its answer.
WORKED = 40.0
#: A response two main sessions of their own both hold, apart from the fork.
OTHER = "msg_other"


class ForkedCopyCase(Case):
    def setUp(self) -> None:
        super().setUp()
        self.ticks((0, 2 * HOUR))
        projects = self.root / "projects"
        # The original session's subagent ran and wrote its file; the store does not know
        # either session yet.
        self.original = projects / ORIGIN / "subagents" / f"agent-{WORKER}.jsonl"
        worker = ClaudeRun(self.original, ORIGIN, WORKER)
        worker.prompt(0, "go", origin=None)
        worker.end_turn(WORKED, request="msg_worker_reply", spent=usage(output=OUTPUT))
        self.copy = projects / FORK / "subagents" / f"agent-{WORKER}.jsonl"

    def know_the_original(self) -> None:
        main = self.session(ORIGIN)
        main.prompt(0)
        main.end_turn(60, spent=usage(output=1))
        self.subagent(ORIGIN, WORKER)

    def know_the_fork(self) -> None:
        main = self.session(FORK)
        main.prompt(HOUR)
        main.end_turn(HOUR + 30, spent=usage(output=2))
        self.copy.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self.original, self.copy)

    def read_in(self, first: str) -> None:
        steps = (self.know_the_original, self.know_the_fork)
        for step in steps if first == ORIGIN else reversed(steps):
            step()
            self.read()

    def assert_the_original_alone(self) -> None:
        self.assertEqual(WORKED, self.seconds(ORIGIN, WORKER))
        self.assertEqual(OUTPUT, self.tokens("output_tokens", ORIGIN, WORKER))
        self.assertEqual(0.0, self.seconds(FORK, WORKER))
        self.assertIsNone(self.tokens("output_tokens", FORK, WORKER))
        owner = self.reader.execute(
            "SELECT run_id FROM usage_requests WHERE request = ?",
            (request_key("msg_worker_reply"),),
        ).fetchone()[0]
        self.assertEqual(self.run_row(ORIGIN, WORKER)["id"], owner)


class CopiedRowsTests(ForkedCopyCase):
    def test_the_copy_counts_nothing_when_the_original_was_read_first(self) -> None:
        self.read_in(ORIGIN)
        self.assert_the_original_alone()

    def test_the_copy_counts_nothing_when_it_was_read_first(self) -> None:
        self.read_in(FORK)
        self.assert_the_original_alone()

    def test_the_forks_own_work_is_still_counted(self) -> None:
        self.read_in(FORK)
        self.assertEqual(30.0, self.seconds(FORK))
        self.assertEqual(2, self.tokens("output_tokens", FORK))


def _older_reading(row: object, own: str) -> usage_steps.Step | None:
    """How a reading before this one took a subagent file's records: all as its own."""

    assert isinstance(row, dict)
    return usage_steps.claude_step(row, str(row.get("sessionId", own)))


class ReadAgainTests(ForkedCopyCase):
    """A store an older reading left with the copy counting, read again by this one."""

    def setUp(self) -> None:
        super().setUp()
        with mock.patch.object(usage_collect, "claude_step", _older_reading):
            self.read_in(FORK)
        # The older reading counted the request in the copy, which came first and has the
        # lower id, and the original left it there.
        self.assertEqual(OUTPUT, self.tokens("output_tokens", FORK, WORKER))
        self.assertIsNone(self.tokens("output_tokens", ORIGIN, WORKER))
        self.assertEqual({request_key("msg_worker_reply")}, self.left(ORIGIN, WORKER))
        # A new reading makes every run stale.
        self.reader.execute("UPDATE usage_runs SET reading = 0")
        # Both sessions are over, as history is: a reader that has looked at them once
        # does not look again.
        self.conn.execute("UPDATE sessions SET status = 'ended'")
        self.conn.commit()

    def read_again(self, *runs: tuple[str, str]) -> None:
        for session, agent in runs:
            report = usage_rebuild.rebuild(
                self.reader, self.store_path, session=session, agent=agent
            )
            self.assertFalse(report.failed, usage_rebuild.render(report))

    def stale(self) -> list[tuple[str, str]]:
        return [
            (str(row[0]), str(row[1]))
            for row in self.reader.execute(
                "SELECT session_id, agent_id FROM usage_runs WHERE reading = 0 ORDER BY id"
            )
        ]

    def assert_goes_back(self, copy_first: bool) -> None:
        runs = self.stale()
        self.read_again(*(runs if copy_first else reversed(runs)))
        passes = 1
        while self.stale():
            # Released by the copy: the run that left the request is read again, once.
            self.assertEqual([(ORIGIN, WORKER)], self.stale())
            self.read_again(*self.stale())
            passes += 1
        self.assertLessEqual(passes, 2)
        self.assert_the_original_alone()
        # The original counts it, and the copy skips the original's records unread.
        self.assertEqual(set(), self.left(ORIGIN, WORKER))
        self.assertEqual(set(), self.left(FORK, WORKER))
        # Reading everything again in either order changes nothing: no ping-pong.
        every = [(ORIGIN, ""), (ORIGIN, WORKER), (FORK, ""), (FORK, WORKER)]
        for again in (every, list(reversed(every))):
            self.read_again(*again)
            self.assertEqual([], self.stale())
            self.assert_the_original_alone()
            self.assert_yields_hold()

    def test_the_request_goes_back_to_the_original_read_again_after_the_copy(self) -> None:
        self.assert_goes_back(copy_first=True)

    def test_the_request_goes_back_to_the_original_read_again_before_the_copy(self) -> None:
        self.assert_goes_back(copy_first=False)

    def test_the_copy_keeps_the_request_while_the_original_cannot_be_read_again(self) -> None:
        # The original left the request to the copy and has lost its transcript since: read
        # again, the copy would give the request up and no run could take it back.
        self.original.unlink()
        rows = [tuple(row) for row in self.segments(FORK, WORKER)]
        claims = self.claims(FORK, WORKER)
        report = usage_rebuild.rebuild(self.reader, self.store_path, session=FORK, agent=WORKER)
        self.assertEqual(
            [(usage_rebuild.REFUSED, "stranded")],
            [(line.outcome, line.reason) for line in report.runs],
        )
        # Counted once, where it was: the copy keeps its former rows and claims.
        self.assertEqual(rows, [tuple(row) for row in self.segments(FORK, WORKER)])
        self.assertEqual(claims, self.claims(FORK, WORKER))
        self.assertEqual(OUTPUT, self.tokens("output_tokens", FORK, WORKER))
        self.assertIsNone(self.tokens("output_tokens", ORIGIN, WORKER))
        copy = self.run_row(FORK, WORKER)
        self.assertEqual(copy["id"], self.holder())
        # Kept with the run, so it is not tried again at every pass.
        self.assertEqual("stranded", copy["reread_refused"])

    def test_an_original_left_only_in_the_archive_still_takes_the_request_back(self) -> None:
        # The client deleted the original; Valkama's copy of it is there, and no reader has
        # passed since, so the run's row still names the deleted file.
        archived = self.root / "transcripts" / ORIGIN / f"agent-{WORKER}.jsonl"
        archived.parent.mkdir(parents=True)
        archived.write_bytes(self.original.read_bytes())
        self.original.unlink()
        self.conn.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " session_id, agent_id, archive_path) VALUES"
            " ('x', 'transcript_archived', 'confirmed', 'valkama', ?, ?, ?)",
            (ORIGIN, WORKER, f"{ORIGIN}/agent-{WORKER}.jsonl"),
        )
        self.conn.commit()
        self.assertEqual(str(self.original), self.run_row(ORIGIN, WORKER)["path"])
        self.read_again((FORK, WORKER))
        self.assertEqual([(ORIGIN, WORKER)], [run for run in self.stale() if run[1] == WORKER])
        self.read_again((ORIGIN, WORKER))
        self.assert_the_original_alone()

    def test_a_refusal_that_says_nothing_of_the_originals_bytes_strands_nothing(self) -> None:
        # The original's last reading again failed for a passing reason; its file is there.
        self.reader.execute(
            "UPDATE usage_runs SET reread_refused = 'failed', refused_reading = ?"
            " WHERE session_id = ? AND agent_id = ?",
            (READING, ORIGIN, WORKER),
        )
        self.read_again((FORK, WORKER))
        self.read_again((ORIGIN, WORKER))
        self.assert_the_original_alone()

    def holder(self) -> int:
        return self.reader.execute(
            "SELECT run_id FROM usage_requests WHERE request = ?",
            (request_key("msg_worker_reply"),),
        ).fetchone()[0]

    def claims(self, session: str, agent: str) -> list[tuple]:
        return [
            tuple(row)
            for row in self.reader.execute(
                "SELECT request, request_id FROM usage_requests WHERE run_id ="
                " (SELECT id FROM usage_runs WHERE session_id = ? AND agent_id = ?)"
                " ORDER BY request",
                (session, agent),
            )
        ]

    def owner_of(self, request: str) -> int:
        return self.reader.execute(
            "SELECT run_id FROM usage_requests WHERE request = ?", (request_key(request),)
        ).fetchone()[0]

    def other_pair(self) -> ClaudeRun:
        """Two main sessions of their own that both hold `OTHER`, read by the reader: the
        later one leaves it to the earlier, and is returned."""

        runs = {}
        for name, at in (("early", 0), ("late", 600)):
            runs[name] = run = self.session(name)
            run.prompt(at)
            run.reply(at + 5, request=OTHER, spent=usage(output=3))
            run.end_turn(at + 10, spent=usage(output=1))
            self.read()
        self.assertEqual(self.run_row("early")["id"], self.owner_of(OTHER))
        self.assertEqual(READING, self.run_row("late")["reading"])
        return runs["late"]

    def test_a_run_that_left_another_request_strands_nothing(self) -> None:
        # The later of the other pair left `OTHER` and has lost its transcript since. The
        # copy gives up a request the original left, not that one: nothing is stranded.
        late = self.other_pair()
        late.path.unlink()
        self.read()
        self.assertEqual("missing", self.run_row("late")["status"])
        report = usage_rebuild.rebuild(self.reader, self.store_path, session=FORK, agent=WORKER)
        self.assertEqual(
            [(usage_rebuild.REBUILT, None)], [(line.outcome, line.reason) for line in report.runs]
        )
        self.assertEqual([(ORIGIN, WORKER)], [run for run in self.stale() if run[1] == WORKER])
        self.read_again((ORIGIN, WORKER))
        self.assert_the_original_alone()
        self.assertEqual(self.run_row("early")["id"], self.owner_of(OTHER))
        self.assertEqual({request_key(OTHER)}, self.left("late"))
        self.assert_yields_hold()

    def test_giving_a_request_up_makes_stale_only_the_runs_that_left_it(self) -> None:
        self.other_pair()
        self.read_again((FORK, WORKER))
        self.assertEqual(0, self.run_row(ORIGIN, WORKER)["reading"])
        self.assertEqual(
            READING, self.run_row("late")["reading"], "it left another request: it stays current"
        )

    def test_the_left_requests_hold_after_mixed_readings(self) -> None:
        # Readings by the reader, a refusal, a release and every run read again in either
        # order: no run leaves a request it counts, and the doctor says what is left.
        self.other_pair()
        self.reader.execute(
            "UPDATE usage_runs SET status = 'unreadable' WHERE session_id = ? AND agent_id = ?",
            (ORIGIN, WORKER),
        )
        report = usage_rebuild.rebuild(self.reader, self.store_path, session=FORK, agent=WORKER)
        self.assertEqual(["stranded"], [line.reason for line in report.runs])
        self.assert_yields_hold()
        self.reader.execute(
            "UPDATE usage_runs SET status = 'reading' WHERE session_id = ? AND agent_id = ?",
            (ORIGIN, WORKER),
        )
        self.read_again((FORK, WORKER), (ORIGIN, WORKER))
        self.assert_yields_hold()
        every = [(ORIGIN, ""), (ORIGIN, WORKER), (FORK, ""), (FORK, WORKER)]
        every += [("early", ""), ("late", "")]
        for again in (every, list(reversed(every))):
            self.read_again(*again)
            self.assert_yields_hold()
        self.assert_the_original_alone()
        self.assertEqual({request_key(OTHER)}, self.left("late"))
        for session, agent in every[:-1]:
            with self.subTest(session=session, agent=agent):
                self.assertEqual(set(), self.left(session, agent))
        (check,) = [check for check in doctor._store_checks() if check["id"] == "usage-copies"]
        self.assertEqual({"requests": 1, "runs": 1}, check["presentation"]["parameters"])

    def test_the_copy_keeps_the_request_while_the_reader_cannot_open_the_original(self) -> None:
        # A rebuild of the original would be refused for its status, so it could not take
        # the request back, though its file is there.
        self.reader.execute(
            "UPDATE usage_runs SET status = 'unreadable' WHERE session_id = ? AND agent_id = ?",
            (ORIGIN, WORKER),
        )
        report = usage_rebuild.rebuild(self.reader, self.store_path, session=FORK, agent=WORKER)
        self.assertEqual(["stranded"], [line.reason for line in report.runs])
        self.assertEqual(self.run_row(FORK, WORKER)["id"], self.holder())
        self.assertEqual(OUTPUT, self.tokens("output_tokens", FORK, WORKER))
        # Once the original can be read, the command rebuilds the copy and the request
        # goes back.
        self.reader.execute(
            "UPDATE usage_runs SET status = 'reading' WHERE session_id = ? AND agent_id = ?",
            (ORIGIN, WORKER),
        )
        self.read_again((FORK, WORKER), (ORIGIN, WORKER))
        self.assert_the_original_alone()

    def test_a_run_that_gives_no_request_up_is_read_again_all_the_same(self) -> None:
        self.original.unlink()
        self.read_again((FORK, ""))
        self.assertNotIn((FORK, ""), self.stale())


if __name__ == "__main__":
    unittest.main()
