"""One request, one count, in the whole store, by one rule however the files were read.

The same response sits in two transcripts here because a record was written into both,
each under its own session, so the session filter keeps it in both and only the claim
decides. The rule's outcomes are stated by the case: a main transcript's run before a
subagent's, then the earlier first record, then the lower run id.
"""

from __future__ import annotations

import math
import sqlite3
import unittest
from collections.abc import Collection
from unittest import mock

from server import store
from server.hooks import ingest
from server.ops import doctor
from server.telemetry import liveness, usage_claims, usage_collect, usage_rebuild, usage_targets
from server.telemetry.usage_claims import Claimant
from server.telemetry.usage_ledger import request_key
from server.telemetry.usage_store import READING
from tests.usage_fixtures import HOUR, Case, ClaudeRun, stamp, usage

SHARED = "msg_shared"
#: What the shared response spent, and what each file spends of its own.
SHARED_OUTPUT = 1000
OWN_OUTPUT = 5


class ClaimCase(Case):
    def setUp(self) -> None:
        super().setUp()
        self.ticks((0, 2 * HOUR))

    def turn(self, run: ClaudeRun, at: float, *, shared: bool = True) -> None:
        run.prompt(at, origin=None if run.agent else "human")
        if shared:
            run.reply(at + 5, request=SHARED, spent=usage(output=SHARED_OUTPUT))
        run.end_turn(at + 10, spent=usage(output=OWN_OUTPUT))

    def run_of(self, session: str, agent: str = "") -> int:
        return int(self.run_row(session, agent)["id"])

    def owner(self) -> int | None:
        row = self.reader.execute(
            "SELECT run_id FROM usage_requests WHERE request = ?",
            (request_key(SHARED),),
        ).fetchone()
        return None if row is None else int(row[0])

    def output(self) -> int:
        return int(
            self.reader.execute(
                "SELECT COALESCE(SUM(output_tokens), 0) FROM usage_segments"
            ).fetchone()[0]
        )

    def stale(self) -> set[int]:
        return {
            int(row[0])
            for row in self.reader.execute("SELECT id FROM usage_runs WHERE reading = 0")
        }

    def rebuild(self, session: str, agent: str = "") -> None:
        report = usage_rebuild.rebuild(self.reader, self.store_path, session=session, agent=agent)
        self.assertFalse(report.failed, usage_rebuild.render(report))

    def settle(self) -> None:
        """Read every stale run again, as often as one makes another stale."""

        for _ in range(4):
            stale = self.reader.execute(
                "SELECT session_id, agent_id FROM usage_runs WHERE reading = 0 ORDER BY id"
            ).fetchall()
            if not stale:
                return
            for session, agent in stale:
                self.rebuild(str(session), str(agent))
        self.fail("re-reading did not settle")

    def assert_counted_once(self, owner: int, runs: int) -> None:
        self.assertEqual(owner, self.owner())
        self.assertEqual(SHARED_OUTPUT + runs * OWN_OUTPUT, self.output())


class OnceWhicheverFirstTests(ClaimCase):
    """Two main sessions; the one whose first record is earlier counts the response."""

    def read_in(self, first: str) -> None:
        early = self.session("early")
        late = self.session("late")
        files = {"early": (early, 0), "late": (late, 600)}
        for name in (first, *(name for name in files if name != first)):
            run, at = files[name]
            self.turn(run, at)
            self.read()

    def test_counted_once_whichever_file_is_read_first(self) -> None:
        for first in ("early", "late"):
            with self.subTest(first=first):
                self.read_in(first)
                self.assertEqual(self.run_of("early"), self.owner())
                if first == "late":
                    # The claim moved; the run it left still holds the tokens until it is
                    # read again, and is stale for that.
                    self.assertEqual({self.run_of("late")}, self.stale())
                self.settle()
                self.assert_counted_once(self.run_of("early"), 2)
                self.assertEqual({request_key(SHARED)}, self.left("late"))
                self.assertEqual(set(), self.left("early"))
                self.assert_yields_hold()
                self.forget()

    def test_and_after_reading_both_again_in_either_order(self) -> None:
        for order in (("early", "late"), ("late", "early")):
            with self.subTest(order=order):
                self.read_in("late")
                self.settle()
                for session in order:
                    self.rebuild(session)
                self.assertEqual(set(), self.stale())
                self.assert_counted_once(self.run_of("early"), 2)
                self.forget()

    def forget(self) -> None:
        for table in ("usage_yields", "usage_requests", "usage_segments", "usage_runs", "sessions"):
            self.conn.execute(f"DELETE FROM {table}")
        self.conn.commit()
        for name in ("early", "late"):
            (self.root / "projects" / f"{name}.jsonl").unlink()
        self.collector = usage_collect.Collector(self.reader, self.store_path)


class RuleTests(ClaimCase):
    """Each level of the rule, with the run it puts last read first."""

    def test_a_main_transcripts_run_before_a_subagents_that_began_earlier(self) -> None:
        self.session("parent")
        worker = self.subagent("parent", "worker")
        main = self.session("main")
        self.turn(worker, 0)
        self.read()
        self.turn(main, 600)
        self.read()
        self.settle()
        self.assert_counted_once(self.run_of("main"), 2)

    def test_between_main_runs_the_earlier_first_record(self) -> None:
        late = self.session("late")
        self.turn(late, 600)
        self.read()
        early = self.session("early")
        self.turn(early, 0)
        self.read()
        # The earlier run is the later one read, so the run id alone would pick the other.
        self.assertLess(self.run_of("late"), self.run_of("early"))
        self.settle()
        self.assert_counted_once(self.run_of("early"), 2)

    def test_with_the_same_first_record_the_lower_run_id(self) -> None:
        first = self.session("first")
        self.turn(first, 0)
        self.read()
        second = self.session("second")
        self.turn(second, 0)
        self.read()
        self.assertLess(self.run_of("first"), self.run_of("second"))
        self.settle()
        self.assert_counted_once(self.run_of("first"), 2)


class HolderThatCannotBeReadAgainTests(ClaimCase):
    def assert_keeps(self, make_unreadable: str | None) -> None:
        late = self.session("late")
        self.turn(late, 600)
        self.read()
        holder = self.run_of("late")
        if make_unreadable is None:
            # The client deleted the file and nothing kept a copy: the reader marks it.
            late.path.unlink()
            self.read()
            self.assertEqual("missing", self.run_row("late")["status"])
        else:
            self.reader.execute(make_unreadable, (holder,))
        early = self.session("early")
        self.turn(early, 0)
        self.read()
        self.assertEqual(holder, self.owner())
        self.assertEqual(set(), self.stale())
        self.assertEqual(SHARED_OUTPUT + 2 * OWN_OUTPUT, self.output())
        self.assertEqual({request_key(SHARED)}, self.left("early"))

    def test_a_holder_not_being_read_keeps_its_claim(self) -> None:
        self.assert_keeps(None)

    def test_a_holder_whose_file_is_gone_keeps_its_claim_though_still_reading(self) -> None:
        late = self.session("late")
        self.turn(late, 600)
        self.read()
        holder = self.run_of("late")
        # The file is gone with no archive, and no reader finds the run again to mark it:
        # its row still says it is being read.
        late.path.unlink()
        real = usage_targets.Finder.targets

        def without_late(finder: usage_targets.Finder, moved: set[str]) -> list:
            return [target for target in real(finder, moved) if target.session != "late"]

        with mock.patch.object(usage_targets.Finder, "targets", without_late):
            early = self.session("early")
            self.turn(early, 0)
            self.read()
        self.assertEqual("reading", self.run_row("late")["status"])
        self.assertEqual(holder, self.owner())
        self.assertEqual(set(), self.stale())
        self.assertEqual(SHARED_OUTPUT + 2 * OWN_OUTPUT, self.output())
        self.assertEqual({request_key(SHARED)}, self.left("early"))

    def test_a_holder_refused_for_the_current_reading_keeps_its_claim(self) -> None:
        self.assert_keeps(
            "UPDATE usage_runs SET reread_refused = 'shorter',"
            f" refused_reading = {READING} WHERE id = ?"
        )


class LeftInPartsTests(ClaimCase):
    """What the reader leaves to another run, one pass at a time."""

    def test_a_reading_in_part_adds_to_what_the_run_left_before(self) -> None:
        early = self.session("early")
        early.prompt(0)
        early.reply(5, request="msg_a", spent=usage(output=SHARED_OUTPUT))
        early.reply(6, request="msg_b", spent=usage(output=SHARED_OUTPUT))
        early.end_turn(10, spent=usage(output=OWN_OUTPUT))
        self.read()
        late = self.session("late")
        late.prompt(600)
        late.reply(605, request="msg_a", spent=usage(output=SHARED_OUTPUT))
        self.read()
        self.assertEqual({request_key("msg_a")}, self.left("late"))
        # A pass later meets only another response the earlier run holds, so the row for
        # the first one is still there only if this part added to what the run left.
        late.reply(607, request="msg_b", spent=usage(output=SHARED_OUTPUT))
        late.end_turn(610, spent=usage(output=OWN_OUTPUT))
        self.read()
        self.assertEqual({request_key("msg_a"), request_key("msg_b")}, self.left("late"))
        self.assertEqual(set(), self.left("early"))
        self.assertEqual(2 * SHARED_OUTPUT + 2 * OWN_OUTPUT, self.output())
        self.assert_yields_hold()


#: Requests by their numbers, as `usage_requests` and `usage_yields` key them.
FIRST, SECOND = 1, 2


class WriteTests(Case):
    """What one chunk's write leaves in `usage_requests` and `usage_yields`.

    The runs are rows of their own, each with a file that is there, so the rule alone
    decides between them: the run whose first record is earlier comes first.
    """

    def add_run(self, session: str, first_at: str) -> Claimant:
        transcript = self.root / f"{session}.jsonl"
        transcript.write_bytes(b"{}\n")
        cursor = self.reader.execute(
            "INSERT INTO usage_runs(session_id, client, path, first_at, reading)"
            " VALUES (?, 'claude', ?, ?, ?)",
            (session, str(transcript), first_at, READING),
        )
        return Claimant(int(cursor.lastrowid or 0), False, first_at)

    def hold(self, run: Claimant, *requests: int) -> None:
        self.reader.executemany(
            "INSERT INTO usage_requests(request, run_id) VALUES (?, ?)",
            [(request, run.run_id) for request in requests],
        )

    def refuse(self, run: Claimant, refused: bool) -> None:
        """Refuse the run for the current reading, or take the refusal back."""

        self.reader.execute(
            "UPDATE usage_runs SET reread_refused = ?, refused_reading = ? WHERE id = ?",
            ("shorter", READING, run.run_id) if refused else (None, None, run.run_id),
        )

    def chunk(
        self, me: Claimant, counted: Collection[int], yielded: Collection[int], *, whole: bool
    ) -> bool:
        """Write a chunk as the reader does: all of it, or nothing when the write refuses."""

        self.reader.execute("BEGIN IMMEDIATE")
        if usage_claims.write(self.reader, me, dict.fromkeys(counted), yielded, whole=whole):
            self.reader.execute("COMMIT")
            return True
        self.reader.execute("ROLLBACK")
        return False

    def holder(self, request: int) -> int:
        return int(
            self.reader.execute(
                "SELECT run_id FROM usage_requests WHERE request = ?", (request,)
            ).fetchone()[0]
        )

    def stale(self, run: Claimant) -> bool:
        row = self.reader.execute("SELECT reading FROM usage_runs WHERE id = ?", (run.run_id,))
        return int(row.fetchone()[0]) == 0

    def test_a_whole_reading_replaces_what_the_run_left_before(self) -> None:
        holder = self.add_run("holder", stamp(0))
        me = self.add_run("me", stamp(HOUR))
        self.hold(holder, FIRST, SECOND)
        self.assertTrue(self.chunk(me, (), {FIRST}, whole=True))
        self.assertEqual({FIRST}, self.left("me"))
        # The file read from its start again meets only the second request now.
        self.assertTrue(self.chunk(me, (), {SECOND}, whole=True))
        self.assertEqual({SECOND}, self.left("me"))
        self.assert_yields_hold()

    def test_a_reading_in_part_drops_the_row_for_a_request_it_now_counts(self) -> None:
        holder = self.add_run("holder", stamp(HOUR))
        me = self.add_run("me", stamp(0))
        self.hold(holder, FIRST, SECOND)
        # Refused for the current reading, the holder keeps both though it comes later.
        self.refuse(holder, True)
        self.assertTrue(self.chunk(me, (), {FIRST, SECOND}, whole=False))
        self.assertEqual({FIRST, SECOND}, self.left("me"))
        # It can be read again now, so the next part counts the first request again met.
        self.refuse(holder, False)
        self.assertTrue(self.chunk(me, {FIRST}, (), whole=False))
        self.assertEqual(me.run_id, self.holder(FIRST))
        self.assertEqual({SECOND}, self.left("me"))
        self.assert_yields_hold()

    def test_a_request_counted_and_left_by_one_reading_is_counted_when_the_run_comes_first(
        self,
    ) -> None:
        for whole in (False, True):
            with self.subTest(whole=whole):
                holder = self.add_run(f"holder-{whole}", stamp(HOUR))
                me = self.add_run(f"me-{whole}", stamp(0))
                request = FIRST + 10 * whole
                self.hold(holder, request)
                self.assertTrue(self.chunk(me, {request}, {request}, whole=whole))
                self.assertEqual(me.run_id, self.holder(request))
                self.assertEqual(set(), self.left(f"me-{whole}"))
                # The run it moved from becomes stale, so reading it again drops the tokens.
                self.assertTrue(self.stale(holder))
                self.assert_yields_hold()

    def test_a_request_counted_and_left_by_one_reading_fails_the_chunk_when_the_holder_wins(
        self,
    ) -> None:
        for whole in (False, True):
            with self.subTest(whole=whole):
                holder = self.add_run(f"holder-{whole}", stamp(0))
                me = self.add_run(f"me-{whole}", stamp(HOUR))
                request = FIRST + 10 * whole
                self.hold(holder, request)
                self.assertFalse(self.chunk(me, {request}, {request}, whole=whole))
                self.assertEqual(holder.run_id, self.holder(request))
                self.assertEqual(set(), self.left(f"me-{whole}"))
                self.assertFalse(self.stale(holder))


class YieldsFollowTheirRunTests(Case):
    """A row of `usage_yields` lives only as long as the run it names.

    The table's key references `usage_runs` with `ON DELETE CASCADE`, which SQLite
    enforces only on a connection that turned foreign keys on: both connections the store
    is written through do.
    """

    def test_deleting_a_run_deletes_its_rows_and_a_row_needs_a_run(self) -> None:
        for name, conn in (("store", self.conn), ("reader", self.reader)):
            with self.subTest(connection=name):
                run_id = conn.execute(
                    "INSERT INTO usage_runs(session_id, client, path) VALUES (?, 'claude', '')",
                    (name,),
                ).lastrowid
                conn.execute("INSERT INTO usage_yields(run_id, request) VALUES (?, 1)", (run_id,))
                conn.execute("DELETE FROM usage_runs WHERE id = ?", (run_id,))
                conn.commit()
                self.assertEqual(
                    [],
                    conn.execute(
                        "SELECT request FROM usage_yields WHERE run_id = ?", (run_id,)
                    ).fetchall(),
                )
                with self.assertRaises(sqlite3.IntegrityError):
                    conn.execute(
                        "INSERT INTO usage_yields(run_id, request) VALUES (?, 1)", (run_id,)
                    )
                conn.rollback()


class ClaimLostMeanwhileTests(ClaimCase):
    """A claim made by another connection between parsing a chunk and writing it."""

    def test_the_chunk_fails_whole_and_both_runs_stay_consistent(self) -> None:
        self.session("parent")
        worker = self.subagent("parent", "worker")
        main = self.session("main")
        self.turn(worker, 0)
        self.turn(main, 600)
        other_conn = ingest.open_light(self.store_path, store.STORE_SCHEMA_VERSION)
        other_conn.execute("PRAGMA busy_timeout = 5000")
        self.addCleanup(other_conn.close)
        other = usage_collect.Collector(other_conn, self.store_path)
        real = usage_collect.Collector.parse
        done: list[bool] = []

        def parse_then_lose(collector: usage_collect.Collector, target, *rest):  # type: ignore[no-untyped-def]
            parsed = real(collector, target, *rest)
            if collector is self.collector and target.agent == "worker" and not done:
                done.append(True)
                found = [t for t in other.finder.targets(set()) if t.session == "main"]
                coverage = liveness.Coverage(liveness.intervals(self.store_path))
                other._read(found[0], usage_collect._Pass(coverage, math.inf))
            return parsed

        with mock.patch.object(usage_collect.Collector, "parse", parse_then_lose):
            # The worker's file comes first in this reader's pass, the main session's last.
            self.conn.execute("UPDATE sessions SET status = 'ended' WHERE id = 'main'")
            self.conn.commit()
            self.read()
        self.assertEqual([True], done)
        self.assertEqual(0, self.run_row("parent", "worker")["read_offset"])
        self.assertEqual([], self.segments("parent", "worker"))
        self.assertEqual(self.run_of("main"), self.owner())
        self.read()
        self.assertGreater(self.run_row("parent", "worker")["read_offset"], 0)
        self.assertEqual(self.run_of("main"), self.owner())
        self.assertEqual(set(), self.stale())
        self.assertEqual(SHARED_OUTPUT + 2 * OWN_OUTPUT, self.output())


class CopiesCheckTests(Case):
    """`doctor` counts the requests met in more than one run, from the yields recorded."""

    def check(self) -> dict:
        (found,) = [check for check in doctor._store_checks() if check["id"] == "usage-copies"]
        return found

    def test_silent_when_every_request_is_in_one_run(self) -> None:
        run = self.session("one")
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(10, request="msg_once")
        self.read()
        check = self.check()
        self.assertEqual(
            ("ok", "usage-copies-none"), (check["status"], check["presentation"]["code"])
        )

    def test_warns_with_the_requests_and_runs_when_one_is_in_two(self) -> None:
        self.ticks((0, HOUR))
        for name, at in (("early", 0), ("late", 600)):
            run = self.session(name)
            run.prompt(at)
            run.end_turn(at + 10, request="msg_twice")
            self.read()
        check = self.check()
        self.assertEqual("warn", check["status"])
        self.assertEqual({"requests": 1, "runs": 1}, check["presentation"]["parameters"])
        self.assertIn("1 request(s)", check["detail"])

    def test_counts_a_request_once_however_many_runs_left_it(self) -> None:
        self.ticks((0, HOUR))
        for name, at in (("early", 0), ("late", 600), ("later", 1200)):
            run = self.session(name)
            run.prompt(at)
            run.end_turn(at + 10, request="msg_thrice")
            self.read()
        check = self.check()
        self.assertEqual({"requests": 1, "runs": 2}, check["presentation"]["parameters"])


if __name__ == "__main__":
    unittest.main()
