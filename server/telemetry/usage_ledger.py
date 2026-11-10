"""One run's segments: which item each stretch goes to, and which tokens it carries.

The item depends on what comes next: inside a turn a stretch goes to the agent's next
write, so it is not known when the stretch is measured. Nothing waits for it. Every row
is written at once under the item the rule gives so far, marked `provisional`, and:

- a write moves every provisional row of its turn to its own item and closes them; the
  rows after it start under the same item, since a turn's last write is what they go to
  unless another one follows;
- a new turn closes what is left. A turn with no write has kept the item it started
  with: the agent's last write before it, or else what `fallback` says.

So a row of a turn still running always names an item, and a later pass changes it in
the same transaction that moves the reading place: no row is ever read twice or lost.

Tokens: a request is written as many records, and each holds its usage so far, so what a
record adds is its difference from the previous one, and the sum is what the last one
says. A request seen before and no longer open is a replay and adds nothing.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field

from ..planning import ladder
from . import liveness
from .usage_prices import PRICE_BOOK
from .usage_steps import Part, Step

#: The columns each kind goes to, which is also the order they are written in.
TOKEN_COLUMNS = {
    "input": "input_tokens",
    "cached_read": "cached_read_tokens",
    "cache_write_5m": "cache_write_5m_tokens",
    "cache_write_1h": "cache_write_1h_tokens",
    "output": "output_tokens",
    "reasoning": "reasoning_tokens",
}

#: Requests kept open for more records of theirs. Records of one request come within
#: a few of each other even with tool calls in parallel, and each costs a few counters.
_OPEN_REQUESTS = 16
#: Times are stored to the millisecond, so a row's end read back may differ by less.
_SAME_MOMENT = 0.002

Fallback = Callable[[float], tuple[str | None, str | None]]


def stamp(moment: float) -> str:
    """A moment as `execution_events` stores one."""

    text = dt.datetime.fromtimestamp(moment, dt.UTC).isoformat(timespec="milliseconds")
    return text.replace("+00:00", "Z")


def moment(text: str) -> float:
    return dt.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()


def request_key(request: str) -> int:
    """A request id as the 63-bit number `usage_requests` keeps."""

    digest = hashlib.blake2b(request.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") >> 1


@dataclass(slots=True)
class Row:
    """One segment, as far as this pass knows it."""

    started: float
    ended: float
    seconds: float
    quality: str
    model: str | None = None
    item: str | None = None
    signal: str | None = None
    tokens: dict[str, int] = field(default_factory=dict)
    cost: float | None = None
    book: str | None = None
    provisional: bool = True
    identity: int | None = None


class Ledger:
    """The provisional rows of one run, and what a pass did to them."""

    def __init__(
        self,
        rows: list[Row],
        memo: dict,
        coverage: liveness.Coverage,
        seen: Callable[[int], bool],
        fallback: Fallback,
    ) -> None:
        self.rows = rows
        self.closed: list[Row] = []
        self.model: str | None = memo.get("model")
        self.last_write: str | None = memo.get("last_write")
        self.item: str | None = memo.get("item")
        self.signal: str | None = memo.get("signal")
        self.requests: dict[str, dict] = memo.get("requests", {})
        self.new_requests: set[int] = set()
        self.coverage = coverage
        self.seen = seen
        self.fallback = fallback

    def memo(self) -> dict:
        return {
            "model": self.model,
            "last_write": self.last_write,
            "item": self.item,
            "signal": self.signal,
            "requests": self.requests,
        }

    def new_turn(self, at: float) -> None:
        self.closed.extend(self.rows)
        for row in self.rows:
            row.provisional = False
        self.rows = []
        if self.last_write is not None:
            self.item, self.signal = self.last_write, ladder.EARLIER_WRITE
        else:
            self.item, self.signal = self.fallback(at)

    def retry_fallback(self, at: float) -> None:
        """A label may arrive after its agent's first records, and a turn is not over yet."""

        if self.last_write is None and self.item is None:
            self.item, self.signal = self.fallback(at)
            self._repoint(self.item, self.signal)

    def wrote(self, item: str) -> None:
        self._repoint(item, ladder.NEXT_WRITE)
        self.closed.extend(self.rows)
        for row in self.rows:
            row.provisional = False
        self.rows = []
        self.last_write = item
        self.item, self.signal = item, ladder.LAST_WRITE

    def _repoint(self, item: str | None, signal: str | None) -> None:
        for row in self.rows:
            row.item, row.signal = item, signal

    def _new_row(self, start: float, end: float, quality: str) -> Row:
        return Row(start, end, end - start, quality, self.model, self.item, self.signal)

    def work(self, start: float, end: float, quality: str) -> None:
        tail = self.rows[-1] if self.rows else None
        if (
            tail is not None
            and tail.quality == quality
            and tail.model == self.model
            and abs(tail.ended - start) <= _SAME_MOMENT
        ):
            tail.ended = end
            tail.seconds += end - start
        else:
            self.rows.append(self._new_row(start, end, quality))

    def work_back(self, start: float, end: float, quality: str) -> None:
        """Work found later than it happened, placed behind the row time is still growing."""

        self.rows.insert(max(0, len(self.rows) - 1), self._new_row(start, end, quality))

    def count(self, step: Step) -> None:
        """What one record says its request has spent, as the difference from the last one."""

        if not step.parts:
            return
        before: dict = {}
        key = step.request
        if key is not None:
            known = self.requests.pop(key, None)
            if known is None:
                number = request_key(key)
                if number in self.new_requests or self.seen(number):
                    return
                self.new_requests.add(number)
            else:
                before = known
            self.requests[key] = {part.model: [part.tokens, part.cost] for part in step.parts}
            for stale in list(self.requests)[:-_OPEN_REQUESTS]:
                del self.requests[stale]
        for part in step.parts:
            self._add(part, before.get(part.model), step.at)

    def _add(self, part: Part, before: list | None, at: float) -> None:
        tokens = part.tokens
        cost = part.cost
        if before is not None:
            tokens = {kind: count - before[0].get(kind, 0) for kind, count in tokens.items()}
            if cost is not None and before[1] is not None:
                cost -= before[1]
        if not part.advisor:
            self.model = part.model
        row = self._row_for(part.model, at)
        for kind, count in tokens.items():
            row.tokens[kind] = row.tokens.get(kind, 0) + count
        if cost is not None:
            row.cost = (row.cost or 0.0) + cost
            row.book = PRICE_BOOK

    def _row_for(self, model: str, at: float) -> Row:
        """The row a request's tokens go to: the last one reaching its moment with its model."""

        for row in reversed(self.rows):
            if row.model in (model, None) and row.ended >= at - _SAME_MOMENT:
                row.model = model
                return row
            if row.model != model:
                break
        fresh = Row(at, at, 0.0, self.coverage.quality_at(at), model, self.item, self.signal)
        self.rows.append(fresh)
        return fresh

    def flush(self, conn: sqlite3.Connection, run_id: int, session: str, agent: str) -> None:
        """Write what this pass did, inside the caller's transaction."""

        write_rows(conn, run_id, session, agent, [*self.closed, *self.rows], self.new_requests)


#: A segment's columns as `segment_values` gives them, which is also how `_INSERT` and
#: `_UPDATE` name them.
SEGMENT_COLUMNS = (
    "model",
    "started_at",
    "ended_at",
    "seconds",
    "work_item_id",
    "signal",
    *TOKEN_COLUMNS.values(),
    "estimated_api_cost_usd",
    "price_book",
    "quality",
    "provisional",
)


def segment_values(row: Row) -> tuple:
    """One row as the store keeps it, in the order of `SEGMENT_COLUMNS`."""

    return (
        row.model,
        stamp(row.started),
        stamp(row.ended),
        row.seconds,
        row.item,
        row.signal,
        *(row.tokens.get(kind) for kind in TOKEN_COLUMNS),
        row.cost,
        row.book,
        row.quality,
        int(row.provisional),
    )


def write_rows(
    conn: sqlite3.Connection,
    run_id: int,
    session: str,
    agent: str,
    rows: list[Row],
    requests: set[int],
) -> None:
    """Insert the new rows and update the ones read back, inside the caller's transaction."""

    for row in rows:
        values = segment_values(row)
        if row.identity is None:
            conn.execute(_INSERT, (run_id, session, agent, *values))
        else:
            conn.execute(_UPDATE, (*values, row.identity))
    conn.executemany(
        "INSERT OR IGNORE INTO usage_requests(run_id, request) VALUES (?, ?)",
        ((run_id, number) for number in requests),
    )


_INSERT = (
    "INSERT INTO usage_segments(run_id, session_id, agent_id, model, started_at, ended_at,"
    " seconds, work_item_id, signal, input_tokens, cached_read_tokens, cache_write_5m_tokens,"
    " cache_write_1h_tokens, output_tokens, reasoning_tokens, estimated_api_cost_usd,"
    " price_book, quality, provisional) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
)
_UPDATE = (
    "UPDATE usage_segments SET model = ?, started_at = ?, ended_at = ?, seconds = ?,"
    " work_item_id = ?, signal = ?, input_tokens = ?, cached_read_tokens = ?,"
    " cache_write_5m_tokens = ?, cache_write_1h_tokens = ?, output_tokens = ?,"
    " reasoning_tokens = ?, estimated_api_cost_usd = ?, price_book = ?, quality = ?,"
    " provisional = ? WHERE id = ?"
)
SELECT_PROVISIONAL = "SELECT * FROM usage_segments WHERE run_id = ? AND provisional = 1 ORDER BY id"


def row_from(record: sqlite3.Row) -> Row:
    """A provisional row back from the store."""

    return Row(
        moment(str(record["started_at"])),
        moment(str(record["ended_at"])),
        float(record["seconds"]),
        str(record["quality"]),
        record["model"],
        record["work_item_id"],
        record["signal"],
        {
            kind: int(record[column])
            for kind, column in TOKEN_COLUMNS.items()
            if record[column] is not None
        },
        record["estimated_api_cost_usd"],
        record["price_book"],
        True,
        int(record["id"]),
    )
