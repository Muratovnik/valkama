"""Which run counts a request: one run in the whole store, by one rule.

The same request can sit in two transcripts, when a client copies records of one session
into another's folder. Counting it in both would count its tokens twice, so
`usage_requests` holds one row per request, naming the run that counts it: its claim.

The rule, the same at a first reading and at every reading again: a main transcript's
run before a subagent's; between equals, the run whose first record is earlier, a run
with none last; then the lower run id (`Claimant.key`). The schema-16 upgrade kept one
row of each request by the same order.

- A reading that meets a request no run holds claims it. One that meets a request
  another run holds counts it only when the rule puts it first and the holder can still
  be read again: the claim then moves and the holder becomes stale, so reading it again
  drops those tokens. A holder that cannot be read again (not `reading`, refused for the
  current reading, or with the file it was read from gone or shorter) keeps the claim,
  and the reading yields: otherwise the tokens would stay counted twice for good.
- Whether a request is held elsewhere is asked while parsing, outside the write
  transaction, so the answer is advice. `write` asks again inside it, and a claim lost
  in between fails the whole chunk: it is read again on a later pass, never written
  with tokens nobody may count.
- A run remembers each request it met and left to another (`usage_yields`, one row per
  run and request, naming no holder). A reading again that no longer holds a request it
  held releases the claim, and each run that left that request becomes stale once, so
  the one the request now belongs to can count it.

What makes this settle is the record of yields and the release, not the order: a reading
again can change a run's place in it, since a run whose records are all skipped as
copies ends with no first record. A run that left a request to another keeps a row for
it; whenever a run read again no longer holds a request it held, every run with a row
for that request is read again, and the one the rule now puts first takes it. A reading
again of the same bytes makes the same claims, so once each run has been read under the
current reading nothing moves any more: reading every run again in either order then
changes nothing, which is what the tests hold it to.

Between those readings a request can for a while be counted in no run. A run left it,
then the run holding it was read again and no longer holds it (a copy's run, for
instance), and the request waits until the run that left it is read again. The release
makes that run stale in the same transaction, so the background reader, or the rest of
a rebuild of every run, reads it again and the request is counted once more.

Only a run whose transcript is still there takes a request back, so the rebuild refuses
a reading again that gives a claim up while the bytes of any run that left one of the
requests given up are gone (`usage_rebuild`, which knows the archives, asks `yielders`
and looks): the holder keeps its former rows, and the request stays counted once, in the
run that had it. A run that left only other requests does not count. What is left is a
run that left a request and loses its transcript after the holder gave the claim up and
before it is itself read again: that request is then counted in no run.
"""

from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Collection, Mapping
from dataclasses import dataclass

from .usage_store import READING

_HOLDER = (
    "SELECT claim.run_id, run.id AS present, run.agent_id, run.first_at, run.status,"
    " run.reread_refused, run.refused_reading, run.path, run.read_offset"
    " FROM usage_requests AS claim"
    " LEFT JOIN usage_runs AS run ON run.id = claim.run_id WHERE claim.request = ?"
)
#: The runs that left any request of the JSON array bound first, but the run bound second,
#: and the same runs made stale.
_YIELDERS = (
    "SELECT * FROM usage_runs WHERE id IN (SELECT run_id FROM usage_yields"
    " WHERE request IN (SELECT value FROM json_each(?)) AND run_id != ?)"
)
_RELEASE = (
    "UPDATE usage_runs SET reading = 0, reread_refused = NULL, refused_reading = NULL"
    " WHERE id IN (SELECT run_id FROM usage_yields"
    " WHERE request IN (SELECT value FROM json_each(?)) AND run_id != ?)"
)


@dataclass(frozen=True)
class Claimant:
    """A run as the rule sees it."""

    run_id: int
    subagent: bool
    #: Its first record, as `usage_runs.first_at` stores it; None when it has none.
    first_at: str | None

    def key(self) -> tuple[bool, bool, str, int]:
        return (self.subagent, self.first_at is None, self.first_at or "", self.run_id)


@dataclass(frozen=True)
class _Holder:
    claimant: Claimant
    #: Whether the run still exists.
    present: bool
    #: Whether its row lets it be read again: being read and not refused for this reading.
    readable: bool
    #: The file it was read from, and how far.
    path: str | None
    read_offset: int

    def rereadable(self) -> bool:
        """Whether reading it again can give the claim up: its row allows it and the bytes
        it was read from are still there. A run whose file is gone with no archive keeps
        being read in name only, since no reader finds it again."""

        return (
            self.readable
            and self.path is not None
            and os.path.isfile(self.path)
            and os.path.getsize(self.path) >= self.read_offset
        )


def _holder(conn: sqlite3.Connection, number: int) -> _Holder | None:
    row = conn.execute(_HOLDER, (number,)).fetchone()
    if row is None:
        return None
    run_id, present, agent, first_at, status, refused, refused_reading, path, offset = tuple(row)
    claimant = Claimant(int(run_id), bool(agent), first_at)
    refused_now = refused is not None and (refused_reading or 0) >= READING
    return _Holder(
        claimant,
        present is not None,
        status == "reading" and not refused_now,
        path,
        int(offset or 0),
    )


def _takes(me: Claimant, holder: _Holder) -> bool:
    """Whether `me` takes the claim from its holder."""

    if not holder.present:
        return True
    # The file is looked at only when the rule would move the claim: rarely.
    return me.key() < holder.claimant.key() and holder.rereadable()


def counts(conn: sqlite3.Connection, me: Claimant, number: int) -> bool:
    """Whether `me` counts a request: as advice, read outside any transaction."""

    holder = _holder(conn, number)
    return holder is None or holder.claimant.run_id == me.run_id or _takes(me, holder)


def write(
    conn: sqlite3.Connection,
    me: Claimant,
    counted: Mapping[int, int | None],
    yielded: Collection[int],
    *,
    whole: bool,
) -> bool:
    """Claim what a reading counted, inside the caller's transaction; False when one is lost.

    `counted` maps each request the reading counted to its `request_id`, `yielded` holds
    the ones it left to another run; one it counted as well is counted, not left. A
    request another run took meanwhile, or one left to a run that no longer holds it, is
    a chunk read on stale advice: the caller rolls back. `whole` says the reading began
    at the start of the file, so `yielded` replaces what the run left before; otherwise
    it adds to it, and the run no longer leaves what it now counts.
    """

    for number, request_id in counted.items():
        holder = _holder(conn, number)
        if holder is None:
            conn.execute(
                "INSERT INTO usage_requests(request, run_id, request_id) VALUES (?, ?, ?)",
                (number, me.run_id, request_id),
            )
        elif holder.claimant.run_id == me.run_id or _takes(me, holder):
            conn.execute(
                "UPDATE usage_requests SET run_id = ?, request_id = ? WHERE request = ?",
                (me.run_id, request_id, number),
            )
            if holder.claimant.run_id != me.run_id and holder.present:
                conn.execute(
                    "UPDATE usage_runs SET reading = 0 WHERE id = ?", (holder.claimant.run_id,)
                )
        else:
            return False
    left = sorted(number for number in yielded if number not in counted)
    for number in left:
        holder = _holder(conn, number)
        if holder is None or holder.claimant.run_id == me.run_id:
            return False
    if whole:
        conn.execute("DELETE FROM usage_yields WHERE run_id = ?", (me.run_id,))
    elif counted:
        conn.execute(
            "DELETE FROM usage_yields WHERE run_id = ?"
            " AND request IN (SELECT value FROM json_each(?))",
            (me.run_id, json.dumps(list(counted))),
        )
    if left:
        conn.execute(
            "INSERT OR IGNORE INTO usage_yields(run_id, request) SELECT ?, value FROM json_each(?)",
            (me.run_id, json.dumps(left)),
        )
    return True


def held(conn: sqlite3.Connection, run_id: int) -> set[int]:
    """The requests a run counts."""

    return {
        int(row[0])
        for row in conn.execute("SELECT request FROM usage_requests WHERE run_id = ?", (run_id,))
    }


def yielders(
    conn: sqlite3.Connection, run_id: int, former: set[int], kept: Collection[int]
) -> list[sqlite3.Row]:
    """The runs that could take back a request a reading again of `run_id` gives up.

    Every other run that left a request of `former` not in `kept`; none when there is no
    such request.
    """

    given_up = _given_up(former, kept)
    if given_up is None:
        return []
    return conn.execute(_YIELDERS, (given_up, run_id)).fetchall()


def release(conn: sqlite3.Connection, run_id: int, former: set[int], kept: Collection[int]) -> None:
    """After a reading again: when the run no longer holds a request it held, the runs
    that left one of those become stale once, so the one each request now belongs to
    counts it.

    Inside the caller's transaction, after the run's claims were replaced.
    """

    given_up = _given_up(former, kept)
    if given_up is not None:
        conn.execute(_RELEASE, (given_up, run_id))


def _given_up(former: set[int], kept: Collection[int]) -> str | None:
    """The requests of `former` not in `kept`, as a JSON array; None when there are none.

    A fork's copy can give up thousands at once, so they go to SQLite as one value.
    """

    given_up = former - set(kept)
    return json.dumps(sorted(given_up)) if given_up else None
