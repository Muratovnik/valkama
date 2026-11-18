"""How work flowed through a scope day by day, and its pace: the flow of the Volumes read.

Each day of the period, a day of the caller's clock, counts four things:

- `created`: the scope's tasks created that day;
- `closed`: the tasks whose present entry into completed or cancelled fell on it;
- `decisions`: the owner's decisions, each a request of an item of the scope that was
  answered or declined that day by a call from the interface. The latest call that
  closed or changed a request says whose it is (`questions.with_by_person`), so an
  agent's answer is no decision and a changed answer is still one;
- `commits`: the commits of a known repository made that day that are attached now to
  an item of the scope (`read_model.ATTACHED_OF`), or stand on no card of the scope's
  projects (`commits.made_on_no_card`), each once. A commit of no known repository is
  kept as its hash was written, so one commit may be two records: it stays out.

Goals and stages are not counted as created or closed: making or closing a plan is not
work flowing. `totals` adds the days up. `pace` is the shape a chain's pace is read
from (`chain.series`, `chain.recent`): the open tasks, the last `chain.RECENT_DAYS`
days up to today on the caller's clock, whatever the period, and every day with a
change. A day is read from a UTC time the way a chain reads it (`chain.day_of`).
"""

from __future__ import annotations

import sqlite3
from collections import Counter
from collections.abc import Iterable, Sequence
from datetime import date, timedelta

from . import chain, commits, model, questions, read_model, usage

#: The scope's requests closed with an answer or a decline, and when.
_CLOSED_REQUESTS = (
    "SELECT r.request_id, r.resolved_at FROM work_item_requests r"
    " JOIN work_items i ON i.work_item_id = r.work_item_id"
    " WHERE r.status IN ('answered', 'declined') AND r.resolved_at IS NOT NULL AND {where}"
)
#: The commits of a known repository attached now to an item of the scope, and when made.
_ATTACHED = (
    f"SELECT DISTINCT c.commit_id, {commits.MADE_UTC}{{attached}} AND c.project_id IS NOT NULL"
)
#: The measures of a day, in the order the answer gives them.
MEASURES = ("created", "closed", "decisions", "commits")


def flow(
    conn: sqlite3.Connection,
    tasks: Sequence[sqlite3.Row],
    *,
    where: str,
    parameters: Sequence[object],
    projects: Sequence[str] | None,
    begins: int,
    ends: int,
    utc_offset: int,
) -> dict:
    """The flow of a scope over a period from `begins` up to `ends`, read at `utc_offset`.

    `tasks` are the scope's tasks, each with its `created_at`, its `category` and
    `since`, when it came to stand there. `where` and `parameters` keep the scope's
    items as conditions on `work_items i`; `projects` are those whose commits on no
    card it holds, every known repository's with None.
    """

    def in_period(stamps: Iterable[object]) -> Counter[str]:
        return Counter(
            chain.day_of(stamp, utc_offset)
            for stamp in stamps
            if isinstance(stamp, str) and begins <= usage.stored_micro(stamp) < ends
        )

    found = [
        {
            "created_at": row["created_at"],
            "closed_at": row["since"] if row["category"] in model.TERMINAL_CATEGORIES else None,
        }
        for row in tasks
    ]
    counted = {
        "created": in_period(task["created_at"] for task in found),
        "closed": in_period(task["closed_at"] for task in found),
        "decisions": in_period(_decisions(conn, where, parameters)),
        "commits": in_period(_commits(conn, where, parameters, projects)),
    }
    days = [
        {"day": day, **{measure: counted[measure][day] for measure in MEASURES}}
        for day in _days(begins, ends, utc_offset)
    ]
    today = (chain.utc_now() + timedelta(minutes=utc_offset)).date()
    return {
        "days": days,
        "totals": {measure: sum(row[measure] for row in days) for measure in MEASURES},
        "pace": {
            "open": sum(1 for task in found if task["closed_at"] is None),
            "recent": chain.recent(found, today, utc_offset),
            "series": chain.series(found, utc_offset),
        },
    }


def _days(begins: int, ends: int, utc_offset: int) -> list[str]:
    """Every day of the caller's clock the period touches, oldest first."""

    zone = usage.caller_zone(utc_offset)
    first = date.fromisoformat(usage.at(begins, zone)[:10])
    last = date.fromisoformat(usage.at(ends - 1, zone)[:10])
    return [
        (first + timedelta(days=offset)).isoformat() for offset in range((last - first).days + 1)
    ]


def _decisions(conn: sqlite3.Connection, where: str, parameters: Sequence[object]) -> list[str]:
    """When each of the scope's requests the owner closed from the interface was closed."""

    closed = [
        {"request_id": str(row[0]), "resolved_at": str(row[1])}
        for row in conn.execute(_CLOSED_REQUESTS.format(where=where), tuple(parameters))
    ]
    return [
        record["resolved_at"]
        for record in questions.with_by_person(conn, closed)
        if record["by_person"] is True
    ]


def _commits(
    conn: sqlite3.Connection,
    where: str,
    parameters: Sequence[object],
    projects: Sequence[str] | None,
) -> list[str | None]:
    """When each commit of a known repository the scope holds was made, each commit once."""

    items = f"IN (SELECT i.work_item_id FROM work_items i WHERE {where})"  # noqa: S608 - the scope's fixed clauses
    attached = read_model.ATTACHED_OF.format(items=items)
    made = dict(conn.execute(_ATTACHED.format(attached=attached), tuple(parameters)).fetchall())
    made.update(commits.made_on_no_card(conn, projects))
    return list(made.values())
