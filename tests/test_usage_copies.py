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

from server.telemetry import usage_collect, usage_rebuild, usage_steps
from server.telemetry.usage_ledger import request_key
from tests.usage_fixtures import HOUR, Case, ClaudeRun, usage

ORIGIN = "origin"
FORK = "forked"
WORKER = "worker"
OUTPUT = 70
#: The worker's time: from its prompt to its answer.
WORKED = 40.0


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
        self.assertEqual(1, self.run_row(ORIGIN, WORKER)["yielded"])
        # A new reading makes every run stale.
        self.reader.execute("UPDATE usage_runs SET reading = 0")

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
            # Released by the copy: the runs that yielded are read again, once.
            self.assertEqual([(ORIGIN, WORKER)], self.stale())
            self.read_again(*self.stale())
            passes += 1
        self.assertLessEqual(passes, 2)
        self.assert_the_original_alone()
        self.assertEqual(0, self.run_row(ORIGIN, WORKER)["yielded"])
        # Reading everything again in either order changes nothing: no ping-pong.
        every = [(ORIGIN, ""), (ORIGIN, WORKER), (FORK, ""), (FORK, WORKER)]
        for again in (every, list(reversed(every))):
            self.read_again(*again)
            self.assertEqual([], self.stale())
            self.assert_the_original_alone()

    def test_the_request_goes_back_to_the_original_read_again_after_the_copy(self) -> None:
        self.assert_goes_back(copy_first=True)

    def test_the_request_goes_back_to_the_original_read_again_before_the_copy(self) -> None:
        self.assert_goes_back(copy_first=False)

    def test_the_copy_keeps_the_request_while_the_original_cannot_be_read_again(self) -> None:
        # The original left the request to the copy and has lost its transcript since: read
        # again, the copy would give the request up and no run could take it back.
        self.original.unlink()
        report = usage_rebuild.rebuild(self.reader, self.store_path, session=FORK, agent=WORKER)
        self.assertEqual(
            [(usage_rebuild.REFUSED, "stranded")],
            [(line.outcome, line.reason) for line in report.runs],
        )
        # Counted once, where it was.
        self.assertEqual(OUTPUT, self.tokens("output_tokens", FORK, WORKER))
        self.assertIsNone(self.tokens("output_tokens", ORIGIN, WORKER))
        owner = self.reader.execute(
            "SELECT run_id FROM usage_requests WHERE request = ?",
            (request_key("msg_worker_reply"),),
        ).fetchone()[0]
        copy = self.run_row(FORK, WORKER)
        self.assertEqual(copy["id"], owner)
        # Kept with the run, so it is not tried again at every pass.
        self.assertEqual("stranded", copy["reread_refused"])

    def test_a_run_that_gives_no_request_up_is_read_again_all_the_same(self) -> None:
        self.original.unlink()
        self.read_again((FORK, ""))
        self.assertNotIn((FORK, ""), self.stale())


if __name__ == "__main__":
    unittest.main()
