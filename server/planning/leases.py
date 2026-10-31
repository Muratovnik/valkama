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
| no call, a call that is not `confirmed`, or a call without a session | `unconfirmed` |
| no session row, a session `ended` or `failed`, or `last_seen` older than `LEASE_PERIOD` | `stale` |
| otherwise | `live` |

Liveness follows the top-level session: a subagent's write names its parent's
session, and the parent's heartbeat is the one that counts. A confirmed Planning
write call is a heartbeat as well as a hook event, so a session that writes here
stays live even when its hooks are silent.

Expiry is not done here. A stale lease is released by the first write that meets
it, and that write lives with every other write in `service`.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from . import calls

#: How long a session may go without a sign of life before its leases lapse.
LEASE_PERIOD = timedelta(days=14)

LIVE = "live"
STALE = "stale"
UNCONFIRMED = "unconfirmed"
#: The values `claim_state` takes when there is a claim.
STATES = (LIVE, STALE, UNCONFIRMED)

#: Who signs the release of an expired lease, and the call tool it is recorded under.
EXPIRY_AUTHOR = "valkama"
EXPIRY_TOOL = "lease-expiry"
#: What the `released` event of an expired lease says before the holder's name.
EXPIRY_REASON = "lease-expired"

_SECOND = "%Y-%m-%dT%H:%M:%S"
_ENDED = ("ended", "failed")


def utc_now() -> datetime:
    """The clock every lease is read against. Tests replace it through this module."""

    return datetime.now(UTC)


@dataclass(frozen=True)
class Lease:
    """One claim as the read model reports it."""

    holder: str
    state: str
    session_id: str | None
    agent_id: str | None
    source: str | None
    acquired_at: str | None
    last_seen: str | None
    expires_at: str | None

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


def lease(conn: sqlite3.Connection, row: sqlite3.Row) -> Lease | None:
    """The lease on this work item row, or None when nobody holds it."""

    holder = str(row["claim_ref"] or "")
    if not holder:
        return None
    call = None
    if row["claim_call_id"] is not None:
        call = conn.execute(
            "SELECT c.identity_state, c.identity_source, c.session_id, c.agent_id, c.received_at,"
            " s.id AS session_row, s.status, s.last_seen"
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
    if seen is None or call["status"] in _ENDED or seen < utc_now() - LEASE_PERIOD:
        return Lease(state=STALE, last_seen=last_seen, expires_at=None, **described)
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

    return f"{EXPIRY_REASON}: {found.holder}"
