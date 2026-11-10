"""Reading transcripts into usage rows, a bounded amount at a time, in the background.

One pass takes what `usage_targets` finds and reads what is new. Sessions still open come
first, so a live item's numbers stay fresh while history fills in behind them, and it
stops starting anything when `PASS_SECONDS` is spent; the rest is the next pass's. Nothing
here runs on a hook's path, and what a hook writes is only read.

How it stays exact across restarts: the place a run was read to and everything the clock
needs to go on are one row, updated in the transaction that writes the segments, and the
update names the offset it read from. So a process dying between two chunks loses
nothing, and a second listener on the same store loses the race and writes nothing.
Reading and parsing happen outside the transaction, so it holds the write lock only for
its few rows, and a hook waiting on it gives up after a second.

Only ids, times, counters and an item id are kept. A file that is gone or got shorter
marks its run and costs the pass nothing.
"""

from __future__ import annotations

import json
import math
import os
import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from .. import transcripts
from ..planning import agents, calls, ladder
from . import liveness, usage_claims
from .usage_claims import Claimant
from .usage_clock import EXTERNAL, GAP, HUMAN, SUBAGENT, Clock
from .usage_ledger import SELECT_PROVISIONAL, Fallback, Ledger, Row, moment, row_from, stamp
from .usage_prices import PRICE_BOOK
from .usage_steps import Step, claude_step, codex_step, worth_parsing
from .usage_store import READING
from .usage_targets import CLAUDE, CODEX, Finder, Target

#: How long one pass may keep starting work. The server has more to do than this: a
#: second of parsing in six is what its other threads can spare, and the whole history
#: of a busy machine, seven gigabytes at 200 MB/s, is minutes of that.
PASS_SECONDS = 1.0
#: How much of one file is read and committed at a time.
CHUNK_BYTES = 8 * 1024 * 1024
#: A longer line is skipped unread: every one measured is a request body nobody needs.
_MOST_LINE_BYTES = 64 * 1024 * 1024
#: How many requests a run left to others it remembers between chunks, so the records of
#: one request on both sides of a chunk's end count as one yield.
_RECENT_YIELDS = 16


@dataclass
class _Pass:
    """What one pass reads once."""

    coverage: liveness.Coverage
    deadline: float
    steps: dict[str, str] | None = None
    holds: dict[str, dict] = field(default_factory=dict)
    backlog: bool = False
    #: The sessions that had something new.
    moved: set[str] = field(default_factory=set)


@dataclass
class Progress:
    """Where the reading of one run stands between two chunks: all the next one starts from."""

    state: dict = field(default_factory=dict)
    packet_item: str | None = None
    events_after: int = 0
    #: The rows a later write of the same turn may still move.
    provisional: list[Row] = field(default_factory=list)

    @classmethod
    def stored(cls, conn: sqlite3.Connection, run: sqlite3.Row) -> Progress:
        """Where a run's row says it stands."""

        return cls(
            json.loads(run["state"]),
            run["packet_item"],
            int(run["events_after"]),
            [row_from(row) for row in conn.execute(SELECT_PROVISIONAL, (int(run["id"]),))],
        )


@dataclass
class Parsed:
    """What one chunk made of a run, before anything is written."""

    progress: Progress
    #: `closed` holds the rows this chunk finished, `rows` the provisional ones, and
    #: `new_requests` what it counted.
    ledger: Ledger
    clock: Clock
    #: The run as `usage_claims`' rule sees it, and the requests it left to another run.
    claimant: Claimant
    yielded: set[int] = field(default_factory=set)


@dataclass
class Reading:
    """A run read again from the start of its file, in memory."""

    #: Every segment, the closed ones first and the provisional ones of the last turn after.
    rows: list[Row]
    #: Every request counted, each with the hash of the client's own request id.
    requests: dict[int, int | None]
    #: What the last chunk left, for the run's row; None when there was nothing to read.
    last: Parsed | None
    #: Every request left to another run.
    yielded: set[int] = field(default_factory=set)


@dataclass
class Rereading:
    """A reading again in progress: where it stands, kept in memory between passes.

    `end` is the `read_offset` it started from and reads to; `offset` how far it has got.
    Nothing of it is in the store, so a process that stops loses it and starts over.
    """

    target: Target
    path: str
    end: int
    run_id: int
    work: _Pass
    offset: int = 0
    progress: Progress = field(default_factory=Progress)
    rows: list[Row] = field(default_factory=list)
    counted: dict[int, int | None] = field(default_factory=dict)
    yielded: set[int] = field(default_factory=set)
    last: Parsed | None = None

    @classmethod
    def start(
        cls, target: Target, path: str, end: int, coverage: liveness.Coverage, run_id: int
    ) -> Rereading:
        """A reading of `path` from its start to `end`, not begun."""

        return cls(target, path, end, run_id, _Pass(coverage, math.inf))

    @property
    def done(self) -> bool:
        return self.offset >= self.end

    def reading(self) -> Reading:
        """What the whole reading gave, once `done`."""

        return Reading(
            [*self.rows, *self.progress.provisional], self.counted, self.last, self.yielded
        )


def source(target: Target) -> str | None:
    """The file a run is read from: its own path while it is there, else Valkama's archive."""

    path = target.path if target.path and os.path.isfile(target.path) else target.archive
    return path if path and os.path.isfile(path) else None


def _read_lines(path: str, offset: int, limit: int) -> tuple[list[bytes], int, bool]:
    """Whole lines from `offset`, about `limit` bytes of them; where they end; whether more."""

    lines: list[bytes] = []
    with open(path, "rb") as handle:
        handle.seek(offset)
        position = offset
        while position - offset < limit:
            line = handle.readline(_MOST_LINE_BYTES)
            if not line:
                return lines, position, False
            if line.endswith(b"\n"):
                lines.append(line)
                position += len(line)
            elif len(line) == _MOST_LINE_BYTES:
                while line and not line.endswith(b"\n"):
                    position += len(line)
                    line = handle.readline(_MOST_LINE_BYTES)
                position += len(line)
            else:
                # The client is still writing this one, or it fell writing it.
                return lines, position, False
    return lines, position, True


class Collector:
    """The reader of one store, and what it remembers between its passes."""

    def __init__(self, conn: sqlite3.Connection, store_path: str) -> None:
        conn.row_factory = sqlite3.Row
        self.conn = conn
        self.store_path = store_path
        self.finder = Finder(conn, transcripts.directory(store_path))

    def run_pass(self, report: Callable[[str], None], seconds: float = PASS_SECONDS) -> bool:
        """Read what is new, for about `seconds`; whether anything was left for the next pass."""

        work = _Pass(
            liveness.Coverage(liveness.intervals(self.store_path)), time.monotonic() + seconds
        )
        for target in self.finder.targets(work.moved):
            if time.monotonic() >= work.deadline:
                return True
            try:
                self._read(target, work)
            except OSError:
                self._mark(target, "unreadable")
            except Exception as error:  # noqa: BLE001 -- one run must not cost the others
                report(f"usage reader skipped a run: {type(error).__name__}")
        return work.backlog

    # -- reading one ----------------------------------------------------------

    def _run(self, target: Target, path: str) -> sqlite3.Row:
        """This run's row. Only a new row or a new path writes: most looks find nothing new."""

        conn = self.conn
        select = (
            "SELECT * FROM usage_runs WHERE session_id = ? AND agent_id = ?",
            (target.session, target.agent),
        )
        found = conn.execute(*select).fetchone()
        if found is not None and found["path"] == path:
            return found
        # A new run's rows are all this reading's own, read with this price table.
        conn.execute(
            "INSERT INTO usage_runs(session_id, agent_id, client, path, reading, priced_with)"
            " VALUES (?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(session_id, agent_id) DO UPDATE SET path = excluded.path",
            (target.session, target.agent, target.client, path, READING, PRICE_BOOK),
        )
        return conn.execute(*select).fetchone()

    def _mark(self, target: Target, status: str) -> None:
        """Say a run cannot be read now. Only a change is written."""

        run = self._run(target, target.path or target.archive)
        if run["status"] != status:
            self.conn.execute("UPDATE usage_runs SET status = ? WHERE id = ?", (status, run["id"]))

    def _read(self, target: Target, work: _Pass) -> None:
        path = source(target)
        if path is None:
            self._mark(target, "missing")
            return
        size = os.path.getsize(path)
        run = self._run(target, path)
        offset = int(run["read_offset"])
        if size < offset:
            self._mark(target, "truncated")
            return
        if size == offset:
            if run["status"] != "reading":
                self._mark(target, "reading")
            return
        work.moved.add(target.session)
        while True:
            if time.monotonic() >= work.deadline:
                work.backlog = True
                return
            lines, reached, more = _read_lines(path, offset, CHUNK_BYTES)
            if reached == offset:
                return
            run = self._run(target, path)
            if int(run["read_offset"]) != offset or not self._apply(
                run, target, lines, reached, work
            ):
                return
            offset = reached
            if not more:
                return

    def _apply(
        self, run: sqlite3.Row, target: Target, lines: list[bytes], reached: int, work: _Pass
    ) -> bool:
        """Turn one chunk into rows and move the reading place, as one transaction."""

        conn = self.conn
        run_id = int(run["id"])
        parsed = self.parse(
            target,
            Progress.stored(conn, run),
            lines,
            work,
            lambda number: (
                conn.execute(
                    "SELECT 1 FROM usage_requests WHERE request = ? AND run_id = ?",
                    (number, run_id),
                ).fetchone()
                is not None
            ),
            run_id,
        )
        conn.execute("BEGIN IMMEDIATE")
        try:
            # A claim lost since parsing fails the chunk; the next pass reads it again.
            if not self.record(run_id, run["read_offset"], reached, parsed) or not (
                usage_claims.write(
                    conn,
                    parsed.claimant,
                    parsed.ledger.new_requests,
                    parsed.yielded,
                    whole=False,
                )
            ):
                conn.execute("ROLLBACK")
                return False
            parsed.ledger.flush(conn, run_id, target.session, target.agent)
            conn.execute("COMMIT")
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        return True

    def read_more(self, again: Rereading, deadline: float) -> bool:
        """Go on with a reading again, chunk by chunk, until it is done or `deadline` passed.

        The file is read from its start to the reading's `end` as this reader reads it,
        writing nothing: in the chunks `_read` takes, each through `parse`, with what one
        leaves for the next kept in memory rather than in the store. A request counts as
        seen only when an earlier chunk of this reading counted it, never because the
        store says so. At least one chunk per call, so a reading always gets on. False
        when the bytes no longer end a line where they should: the reading is then of no
        use.
        """

        while not again.done:
            offset, end = again.offset, again.end
            lines, reached, _more = _read_lines(again.path, offset, min(CHUNK_BYTES, end - offset))
            if reached == offset or reached > end:
                return False
            last = self.parse(
                again.target,
                again.progress,
                lines,
                again.work,
                again.counted.__contains__,
                again.run_id,
            )
            again.rows.extend(last.ledger.closed)
            again.counted |= last.ledger.new_requests
            again.yielded |= last.yielded
            again.progress, again.last, again.offset = last.progress, last, reached
            if time.monotonic() >= deadline:
                break
        return True

    def parse(
        self,
        target: Target,
        start: Progress,
        lines: list[bytes],
        work: _Pass,
        seen: Callable[[int], bool],
        run_id: int,
    ) -> Parsed:
        """Turn one chunk into rows in memory, from where `start` says the run stands.

        The only path from transcript bytes to segments: the background reader feeds it a
        chunk at a time from the store, and a rebuild (`usage_rebuild`) the same chunks
        from the start of the file, keeping what one chunk leaves for the next in memory.
        `seen` says whether this run already counted a request before this chunk; one
        another run counts is left to it as `usage_claims` advises. Nothing is written
        here.
        """

        state = start.state
        packet = {"item": start.packet_item}
        recent: list[int] = state.setdefault("yielded", [])
        yielded: set[int] = set()

        def claimant() -> Claimant:
            first = stamp(clock.first) if clock.first is not None else None
            return Claimant(run_id, bool(target.agent), first)

        def counted_before(number: int) -> bool:
            if seen(number):
                return True
            if usage_claims.counts(self.conn, claimant(), number):
                return False
            if number not in recent:
                recent.append(number)
                del recent[:-_RECENT_YIELDS]
                yielded.add(number)
            return True

        ledger = Ledger(
            start.provisional,
            state.get("ledger", {}),
            work.coverage,
            counted_before,
            self._fallback(target, packet, work),
        )
        clock = Clock(state.get("clock", {}), work.coverage, ledger, self._keeps(target))
        steps = self._steps(lines, target, state)
        events = self._events(target, start.events_after)
        cursor, after = 0, start.events_after
        for step in steps:
            if step.packet and target.agent and not state.get("packet_read"):
                state["packet_read"] = True
                packet["item"] = ladder.first_named_item(self.conn, step.packet)
            step.packet = None
            while cursor < len(events) and events[cursor][0] <= step.at:
                self._mark_event(clock, events[cursor])
                after = events[cursor][1]
                cursor += 1
            clock.feed(step)
        if clock.high is not None:
            # A turn placed by `fallback` is placed again at the latest moment read.
            ledger.place_open_turn(clock.high)
        state["clock"], state["ledger"] = clock.state(), ledger.memo()
        return Parsed(
            Progress(state, packet["item"], after, ledger.rows), ledger, clock, claimant(), yielded
        )

    def record(self, run_id: int, read_from: object, reached: int, parsed: Parsed) -> bool:
        """Move a run's row to what `parsed` leaves, inside the caller's transaction.

        Only while the row still stands at `read_from`: whether it moved. A reader that
        lost a race to another, or a rebuild that a reader overtook, writes nothing.
        """

        clock = parsed.clock
        return (
            self.conn.execute(
                "UPDATE usage_runs SET read_offset = ?, events_after = ?, state = ?, status = ?,"
                " packet_item = COALESCE(?, packet_item), human_seconds = ?,"
                " subagent_seconds = ?, external_seconds = ?, gap_seconds = ?, first_at = ?,"
                " last_at = ?, read_at = ? WHERE id = ? AND read_offset = ?",
                (
                    reached,
                    parsed.progress.events_after,
                    json.dumps(parsed.progress.state, separators=(",", ":")),
                    "reading",
                    parsed.progress.packet_item,
                    clock.left_out[HUMAN],
                    clock.left_out[SUBAGENT],
                    clock.left_out[EXTERNAL],
                    clock.left_out[GAP],
                    stamp(clock.first) if clock.first is not None else None,
                    stamp(clock.high) if clock.high is not None else None,
                    stamp(time.time()),
                    run_id,
                    read_from,
                ),
            ).rowcount
            == 1
        )

    def _steps(self, lines: list[bytes], target: Target, state: dict) -> list[Step]:
        steps: list[Step] = []
        memo = state.setdefault("codex", {}) if target.client == CODEX else {}
        for line in lines:
            if not worth_parsing(line):
                continue
            try:
                row = json.loads(line)
            except (ValueError, RecursionError):
                continue
            if not isinstance(row, dict):
                continue
            step = (
                claude_step(row, target.session)
                if target.client == CLAUDE
                else codex_step(row, memo)
            )
            if step is not None:
                steps.append(step)
        return steps

    def _events(self, target: Target, after: int) -> list[tuple[float, int, str, str | None]]:
        """What the store knows of this run since last time: writes and permission requests.

        A Codex child thread reports under its own id as its session, since no hook names
        it as a subagent.
        """

        session, agent = (
            (target.agent, "")
            if target.client == CODEX and target.agent
            else (target.session, target.agent)
        )
        return [
            (moment(str(row["at"])), int(row["id"]), str(row["kind"]), row["work_item_id"])
            for row in self.conn.execute(
                "SELECT id, kind, work_item_id, COALESCE(occurred_at, received_at) AS at"
                " FROM execution_events WHERE session_id = ? AND id > ?"
                " AND COALESCE(agent_id, '') = ? AND ((kind = ? AND identity_state = ?"
                " AND work_item_id IS NOT NULL) OR kind = 'attention') ORDER BY id",
                (session, after, agent, calls.KIND, calls.CONFIRMED),
            )
        ]

    @staticmethod
    def _mark_event(clock: Clock, event: tuple[float, int, str, str | None]) -> None:
        at, _identity, kind, item = event
        if kind == calls.KIND and item is not None:
            clock.mark_write(at, item)
        elif kind == "attention":
            clock.mark_attention(at)

    # -- what places a stretch of work ----------------------------------------

    def _holds_of(self, session: str, work: _Pass) -> dict:
        if session not in work.holds:
            work.holds[session] = agents.session_holds(self.conn, session)
        return work.holds[session]

    def _fallback(self, target: Target, packet: dict, work: _Pass) -> Fallback:
        """What a turn with no write goes to, from the signals under the writes."""

        session = target.session

        def single_hold(at: float) -> tuple[str | None, str | None]:
            moment_text = stamp(at)
            held = agents.single_hold(self._holds_of(session, work), moment_text)
            return (held, ladder.SINGLE_HOLD) if held is not None else (None, None)

        if not target.agent:
            return single_hold

        def for_agent(at: float) -> tuple[str | None, str | None]:
            if work.steps is None:
                work.steps = ladder.held_steps(self.conn)
            holder = calls.holder_label(target.client, session, target.agent)
            held = work.steps.get(holder)
            if held is not None:
                return held, ladder.HELD_STEP
            if packet["item"] is not None:
                return str(packet["item"]), ladder.PACKET_NUMBER
            row = self.conn.execute(
                "SELECT label FROM sessions WHERE parent_session_id = ? AND agent_id = ?",
                (session, target.agent),
            ).fetchone()
            named = ladder.first_named_item(self.conn, str(row[0] or "")) if row else None
            return (named, ladder.LABEL_NUMBER) if named is not None else single_hold(at)

        return for_agent

    def _keeps(self, target: Target) -> Callable[[str], bool]:
        """Whether a subagent this run started keeps a transcript of its own.

        Its time is then counted in its own run and is left out of this one. The client's
        file says so while it is there; after the client deleted it, Valkama's archived
        copy does, and after that the segments its run already holds. Without the last
        two, reading this run again after a deletion would count the subagent's time in
        both runs.
        """

        known: dict[str, bool] = {}

        def keeps(agent: str) -> bool:
            if target.client != CLAUDE or not target.parent:
                return True
            if agent not in known:
                path = agents.agent_transcript(target.parent, target.session, agent)
                archive = self.finder.archives.get(target.session, {}).get(agent, "")
                known[agent] = (
                    (bool(path) and os.path.isfile(path))
                    or (bool(archive) and os.path.isfile(archive))
                    or self.conn.execute(
                        "SELECT 1 FROM usage_segments WHERE session_id = ? AND agent_id = ?"
                        " LIMIT 1",
                        (target.session, agent),
                    ).fetchone()
                    is not None
                )
            return known[agent]

        return keeps
