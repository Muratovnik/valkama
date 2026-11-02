"""A claim as a lease: who holds an item, and whether anyone is still there.

A claim used to be a name. Nothing said whether the session behind that name
was still working, so a claim outlived its session and the space reported work
in progress that nobody was doing, and two sessions writing under the same
`author` could release each other's claim because the name was all there was to
compare.

Now a claim points at the write call that took it (`work_items.claim_call_id`),
and that call names the session the client proved. The lease state is read from
the call and the session row, every time it is asked for, and never written:

| Checked in order | State |
|---|---|
| no claim | none |
| no call (or no such column, in a scope an earlier build wrote), a call that is not `confirmed`, or a call without a session | `unconfirmed` |
| no session row, a session `ended` or `failed`, or `last_seen` older than `LEASE_PERIOD` | `stale` |
| otherwise | `live` |

Liveness follows the top-level session: a subagent's write names its parent's
session, and the parent's heartbeat is the one that counts. A confirmed Planning
write call is a heartbeat as well as a hook event, so a session that writes here
stays live even when its hooks are silent.

A session that ended may still come back: a client restart ends the session and
resumes it under the same id seconds later. So a lease whose session is `ended`
reads `stale` at once, because nobody is working it, but stays in its grace for
`ENDED_GRACE` after `ended_at`. Within it Valkama does not release the lease on
its own, and the session coming back makes it `live` again without a write. A
session with no `ended_at` has no grace, and neither has a `failed` one, which
only an explicit start reopens.

Expiry is not done here, and it lives with every other write in `service`. A
caller who asks for the item releases a stale lease at once, in its grace or
not. The start-up sweep and the take-next queue release only a lease past it.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from . import calls

#: How long a session may go without a sign of life before its leases lapse.
LEASE_PERIOD = timedelta(days=14)
#: How long an ended session may come back before Valkama releases its leases itself.
ENDED_GRACE = timedelta(hours=12)

LIVE = "live"
STALE = "stale"
UNCONFIRMED = "unconfirmed"

#: Who signs the release of an expired lease, and the call tool it is recorded under.
EXPIRY_AUTHOR = "valkama"
EXPIRY_TOOL = "lease-expiry"
#: What the `released` event of an expired lease says before the holder's name, by
#: cause: the session ended or failed, it has no row, or it went quiet. Everything
#: released before the causes were told apart says `lease-expired`, whatever the cause.
SESSION_ENDED = "session-ended"
SESSION_MISSING = "session-missing"
LEASE_EXPIRED = "lease-expired"
_EXPIRY_REASONS = (SESSION_ENDED, SESSION_MISSING, LEASE_EXPIRED)

_SECOND = "%Y-%m-%dT%H:%M:%S"
_ENDED = ("ended", "failed")


def utc_now() -> datetime:
    """The clock every lease is read against. Tests replace it through this module."""

    return datetime.now(UTC)


@dataclass(frozen=True)
class Lease:
    """One claim as the read model reports it.

    `reason` and `in_grace` are what the writes in `service` need of a `stale`
    lease. They stay out of `as_dict`: that is the wire shape, which readers hold
    strictly.
    """

    holder: str
    state: str
    session_id: str | None
    agent_id: str | None
    source: str | None
    acquired_at: str | None
    last_seen: str | None
    expires_at: str | None
    reason: str = ""
    in_grace: bool = False

    def as_dict(self) -> dict:
        return {
            "holder": self.holder,
            "state": self.state,
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "source": self.source,
            "acquired_at": self.acquired_at,
            "last_seen": self.last_seen,
            "expires_at": self.expires_at,
        }


def _moment(value: object) -> datetime | None:
    """A stored UTC time to the second, or None when it is not one."""

    if not isinstance(value, str) or len(value) < len("YYYY-MM-DDTHH:MM:SS"):
        return None
    try:
        return datetime.strptime(value[:19], _SECOND).replace(tzinfo=UTC)
    except ValueError:
        return None


def _stamp(moment: datetime) -> str:
    return moment.strftime(_SECOND) + "Z"


def _stale_reason(call: sqlite3.Row, seen: datetime | None) -> str:
    """Why nobody stands behind this claim any more; blank while its session does."""

    if call["session_row"] is None:
        return SESSION_MISSING
    if call["status"] in _ENDED:
        return SESSION_ENDED
    return LEASE_EXPIRED if seen is None or seen < utc_now() - LEASE_PERIOD else ""


def _in_grace(call: sqlite3.Row) -> bool:
    """Whether this ended session may still come back before Valkama releases its leases."""

    ended = _moment(call["ended_at"])
    return call["status"] == "ended" and ended is not None and utc_now() < ended + ENDED_GRACE


def lease(conn: sqlite3.Connection, row: sqlite3.Row) -> Lease | None:
    """The lease on this work item row, or None when nobody holds it."""

    holder = str(row["claim_ref"] or "")
    if not holder:
        return None
    call = None
    # An attached scope is read as it is and never migrated, so a store an
    # earlier build wrote has no `claim_call_id`: its claims name no call.
    columns = row.keys()  # `in row` would search a Row's values, not its names
    if "claim_call_id" in columns and row["claim_call_id"] is not None:
        call = conn.execute(
            "SELECT c.identity_state, c.identity_source, c.session_id, c.agent_id, c.received_at,"
            " s.id AS session_row, s.status, s.last_seen, s.ended_at"
            " FROM execution_events c LEFT JOIN sessions s ON s.id = c.session_id"
            " WHERE c.id = ?",
            (int(row["claim_call_id"]),),
        ).fetchone()
    if call is None:
        return Lease(holder, UNCONFIRMED, None, None, None, None, None, None)
    session_id = call["session_id"] or None
    described = {
        "holder": holder,
        "session_id": session_id,
        "agent_id": call["agent_id"] or None,
        "source": call["identity_source"],
        "acquired_at": call["received_at"],
    }
    if call["identity_state"] != calls.CONFIRMED or session_id is None:
        return Lease(state=UNCONFIRMED, last_seen=None, expires_at=None, **described)
    last_seen = call["last_seen"] if call["session_row"] is not None else None
    seen = _moment(last_seen)
    reason = _stale_reason(call, seen)
    if seen is None or reason:
        return Lease(
            state=STALE,
            last_seen=last_seen,
            expires_at=None,
            reason=reason,
            in_grace=_in_grace(call),
            **described,
        )
    return Lease(
        state=LIVE, last_seen=last_seen, expires_at=_stamp(seen + LEASE_PERIOD), **described
    )


def state(conn: sqlite3.Connection, row: sqlite3.Row) -> str | None:
    """Only the state: what a list row carries."""

    found = lease(conn, row)
    return found.state if found is not None else None


def held_by(found: Lease, caller: calls.Identity | None, actor: str) -> bool:
    """Whether the caller of this write is the one holding the lease.

    A lease a confirmed session holds belongs to that session, whatever the
    `author` text or the agent inside it: two sessions that both sign as
    `codex` are two holders, and one session that changes its author is still
    one. A lease nobody confirmed has only its name to go by, so it is compared
    by name, as every claim was before leases.
    """

    if found.state == UNCONFIRMED:
        return found.holder == actor
    return (
        caller is not None
        and caller.state == calls.CONFIRMED
        and caller.session_id is not None
        and caller.session_id == found.session_id
    )


def expiry_detail(found: Lease) -> str:
    """What the `released` event of an expired lease records."""

    return f"{found.reason}: {found.holder}"


def released_holder(detail: str) -> str:
    """The holder a `released` event names, whether a caller or an expiry released it.

    A caller's release records the holder as it was; an expiry records it after
    `expiry_detail`'s prefix. Blank when the release named nobody. The prefixes
    are spelled out rather than split on the first colon, because a holder that
    no session proved is free text.
    """

    for reason in _EXPIRY_REASONS:
        prefix = f"{reason}: "
        if detail.startswith(prefix):
            return detail[len(prefix) :]
    return detail
