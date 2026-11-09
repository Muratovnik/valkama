"""What a session follows beside the work it holds, and what it mutes there.

A session hears another session's news on the items it holds (`hooks.notify`).
One that depends on an item it does not hold, an item another agent is changing
under it, subscribes to it, and from then on hears other sessions' news there as
a holder would, and a person's acts at its next tool call; it unsubscribes when it no longer needs the item. `false` on an
item the session holds mutes other sessions' news there instead: a person's act
still reaches it, since a holder is who a person's words are for, and so do the
replies to what the session asked there with `awaits_reply`. The mute counts only
while the session holds the item; the row stays, and lapses with the session.

A subscription belongs to the confirmed session and agent of the call that wrote
it, never to the `author` it signed, so a subagent's subscription tells that
subagent and its orchestrator, and the interface, which proves no session, cannot
write one. It is not a change to the item: no event, no revision, nothing anybody
is told; the call has its row, naming the item, as every write's does.

It lapses with its session, by the rule a claim lapses by (`leases`): a session
gone without a row, failed, ended longer ago than `leases.ENDED_GRACE`, or silent
for `leases.LEASE_PERIOD`. A lapsed one is read as gone at once and removed by the
start-up sweep that releases lapsed claims; a session coming back within its
grace finds it standing, as it finds its claims.
"""

from __future__ import annotations

import sqlite3

from . import calls, leases, model

#: What `subscribe` says the session now does about the item.
FOLLOWING = "following"
MUTED = "muted"
NOT_FOLLOWING = "not_following"

_ROW = (
    "SELECT follows FROM work_item_subscriptions"
    " WHERE work_item_id = ? AND session_id = ? AND agent_id = ?"
)


def subscribe(conn: sqlite3.Connection, row: sqlite3.Row, follows: object) -> str:
    """Follow the item of `row`, or stop: mute it while the session holds it, else forget it.

    The caller holds the write and read the row inside it. Asking for what already stands writes nothing more. A change of mind keeps one
    row per session and agent, dated by its newest call.
    """

    if not isinstance(follows, bool):
        raise model.PlanningError("subscribe must be a boolean")
    identity = calls.current()
    if (
        identity is None
        or identity.state != calls.CONFIRMED
        or identity.source in (calls.BROWSER, calls.VALKAMA)
        or not identity.session_id
    ):
        raise model.PlanningError(
            "a subscription belongs to an agent session, and this call proved none"
        )
    item = str(row["work_item_id"])
    session, agent = identity.session_id, identity.agent_id or ""
    call = calls.call_id(conn, item)
    if follows:
        wanted: int | None = 1
    else:
        wanted = 0 if holds(row, session, identity.agent_id) else None
    found = conn.execute(_ROW, (item, session, agent)).fetchone()
    if wanted is None:
        conn.execute(
            "DELETE FROM work_item_subscriptions"
            " WHERE work_item_id = ? AND session_id = ? AND agent_id = ?",
            (item, session, agent),
        )
        return NOT_FOLLOWING
    if found is None or int(found[0]) != wanted:
        conn.execute(
            "INSERT INTO work_item_subscriptions(work_item_id,session_id,agent_id,follows,"
            "call_id,heard_after) VALUES(?,?,?,?,?,?) ON CONFLICT(work_item_id,session_id,"
            "agent_id) DO UPDATE SET follows = excluded.follows, call_id = excluded.call_id,"
            " heard_after = excluded.heard_after, created_at = excluded.created_at",
            (item, session, agent, wanted, call, call),
        )
    return FOLLOWING if wanted else MUTED


def holds(row: sqlite3.Row, session_id: str, agent_id: str | None) -> bool:
    """Whether this session, or this agent of it, holds the item's claim or an open step.

    A holder label ends the way `hooks.notify.holder_suffix` says: the session's
    own suffix finds what its agents hold as well, an agent's only its own.
    """

    suffix = holder_suffix(session_id, agent_id)
    return holds_claim(row, suffix) or holds_step(row, suffix)


def holder_suffix(session_id: str, agent_id: str | None = None) -> str:
    """How every holder label of this session, or of this agent of it, ends."""

    suffix = f"(session {calls.label_id(session_id)})"
    return f" agent {calls.label_id(agent_id)} {suffix}" if agent_id else suffix


def holds_claim(row: sqlite3.Row, suffix: str) -> bool:
    """Whether the item's claim is held under a label ending in `suffix`."""

    return str(row["claim_ref"] or "").endswith(suffix)


def holds_step(row: sqlite3.Row, suffix: str) -> bool:
    """Whether a step not yet done is held under a label ending in `suffix`."""

    return any(
        str(step["claimed_by"] or "").endswith(suffix)
        for step in model.checklist(row["checklist"])
        if not step["done"]
    )


#: Each row with its call's columns named as in `leases.CALL`, so `leases.of_call` reads it.
_LISTED = (
    "SELECT u.work_item_id, u.session_id AS follower, u.agent_id AS follower_agent,"
    " u.created_at AS since, c.client, c.identity_state, c.identity_source, c.session_id,"
    " c.agent_id, c.received_at, s.id AS session_row, s.status, s.last_seen, s.ended_at"
    " FROM work_item_subscriptions u JOIN execution_events c ON c.id = u.call_id"
    " LEFT JOIN sessions s ON s.id = c.session_id"
)


def subscribers(conn: sqlite3.Connection, work_item_id: str) -> list[dict]:
    """Who follows the item now, oldest first: `session`, `client`, `agent`, `label`, `since`.

    `label` is the holder a claim of that session, or of that agent of it, records,
    read from the channel that proved the subscribing call (`calls.channel_holder`)
    and not from the client its handshake named, so a reader tells the holder among
    the subscribers by comparing it with `claim_ref`. A row is live only through a
    confirmed call with a session, which only a channel proves, so none is unlabelled.

    A mute is the holder's own matter and is not listed; nor is a lapsed row.
    """

    rows = conn.execute(
        _LISTED + " WHERE u.work_item_id = ? AND u.follows = 1"
        " ORDER BY u.created_at, u.session_id, u.agent_id",
        (work_item_id,),
    ).fetchall()
    listed = []
    for row in rows:
        if _lapsed(row):
            continue
        session, agent = str(row["follower"]), str(row["follower_agent"]) or None
        label = calls.channel_holder(str(row["identity_source"]), session, agent)
        if label is None:
            continue
        listed.append(
            {
                "session": session,
                "client": row["client"],
                "agent": agent,
                "label": label,
                "since": str(row["since"]),
            }
        )
    return listed


def expire(conn: sqlite3.Connection) -> int:
    """Remove every subscription and mute whose session has lapsed; how many went."""

    gone = [
        (str(row["work_item_id"]), str(row["follower"]), str(row["follower_agent"]))
        for row in conn.execute(_LISTED)
        if _lapsed(row)
    ]
    conn.executemany(
        "DELETE FROM work_item_subscriptions"
        " WHERE work_item_id = ? AND session_id = ? AND agent_id = ?",
        gone,
    )
    return len(gone)


def carry(conn: sqlite3.Connection, merged_id: str, survivor_id: str) -> None:
    """A merge takes what follows the work along; a row the survivor has already stays.

    A carried row hears the survivor from the merge on: what was written there
    before was written on an item its session did not follow. The merge's own call
    is the first it hears, so the row starts after the call before it.
    """

    merge = calls.call_id(conn, survivor_id)
    if merge is None:
        merge = int(
            conn.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM execution_events").fetchone()[0]
        )
    conn.execute(
        "UPDATE OR IGNORE work_item_subscriptions SET work_item_id = ?, heard_after = ?"
        " WHERE work_item_id = ?",
        (survivor_id, merge - 1, merged_id),
    )
    conn.execute("DELETE FROM work_item_subscriptions WHERE work_item_id = ?", (merged_id,))


def _lapsed(row: sqlite3.Row) -> bool:
    """Whether a claim the same call took would be released now: stale past its grace."""

    found = leases.of_call("", row)
    return found.state != leases.LIVE and not found.in_grace
