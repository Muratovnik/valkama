"""What work on an item or in a session took: the two reads of the usage rows.

Time is two numbers on purpose. `elapsed_seconds` is the union of the rows: two agents
working one hour side by side on one item took one hour. `agent_seconds` is their sum:
those two spent two. Between items, an overlap is real parallel work, so a session's
items may add up to more than the session's own `elapsed_seconds`; `agent_seconds`
always adds up.

Tokens and cost are sums: a request sits in exactly one row, so what a session's items
and its row with no item add up to is what the session spent. A kind no request reported
reads `null` rather than 0, and a model with no known price adds nothing to the cost and
stands in `unpriced_models`, so a cost is as complete as that list says. The cost is an
estimate at public API prices, not a bill, which is what its name and `cost_basis` say.

A row of a turn still running may yet move to another item (`usage_ledger`), and it is
read as it stands.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from . import chain, model, read_model

ITEM_SCOPE = "item"
COST_BASIS = (
    "An estimate at public API list prices for each request. A subscription pays differently,"
    " so this is not a bill."
)
_TOKEN_KINDS = (
    ("input", "input_tokens"),
    ("cached_read", "cached_read_tokens"),
    ("cache_write_5m", "cache_write_5m_tokens"),
    ("cache_write_1h", "cache_write_1h_tokens"),
    ("output", "output_tokens"),
    ("reasoning", "reasoning_tokens"),
)
_OBSERVED = "observed"
_ESTIMATED = "estimated"
_MIXED = "mixed"


@dataclass
class _Tally:
    """What some rows add up to."""

    seconds: float = 0.0
    tokens: dict[str, int] = field(default_factory=dict)
    cost: float | None = None

    def add(self, row: sqlite3.Row) -> None:
        self.seconds += float(row["seconds"])
        for kind, column in _TOKEN_KINDS:
            if row[column] is not None:
                self.tokens[kind] = self.tokens.get(kind, 0) + int(row[column])
        if row["estimated_api_cost_usd"] is not None:
            self.cost = (self.cost or 0.0) + float(row["estimated_api_cost_usd"])

    def spent(self) -> dict:
        return {
            "tokens": {kind: self.tokens.get(kind) for kind, _ in _TOKEN_KINDS},
            "estimated_api_cost_usd": round(self.cost, 6) if self.cost is not None else None,
        }


def _elapsed(rows: Iterable[sqlite3.Row]) -> float:
    """The length of the union of these rows' spans."""

    spans = sorted(
        (
            dt.datetime.fromisoformat(str(row["started_at"])).timestamp(),
            dt.datetime.fromisoformat(str(row["ended_at"])).timestamp(),
        )
        for row in rows
        if float(row["seconds"]) > 0
    )
    total = 0.0
    reached = float("-inf")
    for start, end in spans:
        if end > reached:
            total += end - max(start, reached)
            reached = end
    return total


def _time(rows: Sequence[sqlite3.Row], tally: _Tally) -> dict:
    """The two numbers of time. A row's stamps round to the millisecond and its seconds do not."""

    return {
        "elapsed_seconds": round(min(_elapsed(rows), tally.seconds), 3),
        "agent_seconds": round(tally.seconds, 3),
    }


def _breakdown(rows: Sequence[sqlite3.Row], name: str) -> list[tuple[object, _Tally]]:
    """These rows added up by one column, the most time first."""

    tallies: dict[object, _Tally] = {}
    for row in rows:
        tallies.setdefault(row[name], _Tally()).add(row)
    return sorted(tallies.items(), key=lambda entry: -entry[1].seconds)


def _agents(rows: Sequence[sqlite3.Row]) -> list[dict]:
    tallies: dict[tuple[str, str], _Tally] = {}
    for row in rows:
        tallies.setdefault((str(row["session_id"]), str(row["agent_id"])), _Tally()).add(row)
    return [
        {
            "session_id": session,
            "agent_id": agent or None,
            "seconds": round(tally.seconds, 3),
            **tally.spent(),
        }
        for (session, agent), tally in sorted(tallies.items(), key=lambda e: -e[1].seconds)
    ]


def _summary(rows: Sequence[sqlite3.Row]) -> dict:
    whole = _Tally()
    for row in rows:
        whole.add(row)
    estimated = sum(float(row["seconds"]) for row in rows if row["quality"] == _ESTIMATED)
    observed = whole.seconds - estimated
    return {
        **_time(rows, whole),
        **whole.spent(),
        "cost_basis": COST_BASIS,
        "unpriced_models": sorted(
            {
                str(row["model"])
                for row in rows
                if row["estimated_api_cost_usd"] is None
                and row["model"] is not None
                and any(row[column] for _, column in _TOKEN_KINDS)
            }
        ),
        "agents": _agents(rows),
        "models": [
            {"model": name, "seconds": round(tally.seconds, 3), **tally.spent()}
            for name, tally in _breakdown(rows, "model")
        ],
        "signals": [
            {
                "signal": name,
                "seconds": round(tally.seconds, 3),
                "share": round(tally.seconds / whole.seconds, 4) if whole.seconds else 0.0,
            }
            for name, tally in _breakdown(rows, "signal")
        ],
        "quality": _quality(observed, estimated),
        "estimated_seconds": round(estimated, 3),
    }


def _quality(observed: float, estimated: float) -> str | None:
    """`estimated` time has no liveness record behind it: gaps were only cut at a limit."""

    if estimated <= 0:
        return _OBSERVED if observed > 0 else None
    return _ESTIMATED if observed <= 0 else _MIXED


def _names(conn: sqlite3.Connection, items: Iterable[str]) -> dict[str, dict]:
    """The number and title of items that still exist."""

    return {
        str(row["work_item_id"]): {
            "reference": model.human_id(str(row["key"]), int(row["number"])),
            "title": row["title"],
        }
        for row in conn.execute(
            "SELECT i.work_item_id, i.number, i.title, p.key FROM work_items i"
            " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
            " WHERE i.work_item_id IN (SELECT value FROM json_each(?))",
            (json.dumps(sorted(items)),),
        )
    }


def _item_line(item: str | None, names: dict[str, dict], rows: Sequence[sqlite3.Row]) -> dict:
    tally = _Tally()
    for row in rows:
        tally.add(row)
    named = names.get(item, {}) if item is not None else {}
    return {
        "work_item_id": item,
        "reference": named.get("reference"),
        "title": named.get("title"),
        **_time(rows, tally),
        **tally.spent(),
    }


def for_item(conn: sqlite3.Connection, reference: object, scope: str | None = None) -> dict:
    """One item's usage, or with `scope` chain or epic its whole chain's, root first."""

    root = str(read_model.item_row(conn, reference)["work_item_id"])
    order = [root]
    if scope is not None and scope != ITEM_SCOPE:
        order += [str(m["work_item_id"]) for m in chain.chain(conn, reference, scope)["members"]]
    rows = conn.execute(
        "SELECT * FROM usage_segments WHERE work_item_id IN (SELECT value FROM json_each(?))"
        " ORDER BY started_at, id",
        (json.dumps(order),),
    ).fetchall()
    names = _names(conn, order)
    by_item: dict[str, list[sqlite3.Row]] = {item: [] for item in order}
    for row in rows:
        by_item[str(row["work_item_id"])].append(row)
    return {
        "work_item_id": root,
        "reference": names[root]["reference"],
        "title": names[root]["title"],
        "scope": scope or ITEM_SCOPE,
        **_summary(rows),
        "by_item": [_item_line(item, names, by_item[item]) for item in order],
    }


def for_session(conn: sqlite3.Connection, session_id: str) -> dict:
    """One session's usage with its subagents', by item, with what no item took as a line."""

    rows = conn.execute(
        "SELECT * FROM usage_segments WHERE session_id = ? ORDER BY started_at, id", (session_id,)
    ).fetchall()
    runs = conn.execute(
        "SELECT * FROM usage_runs WHERE session_id = ? ORDER BY agent_id", (session_id,)
    ).fetchall()
    grouped: dict[str | None, list[sqlite3.Row]] = {}
    for row in rows:
        grouped.setdefault(row["work_item_id"], []).append(row)
    names = _names(conn, [item for item in grouped if item is not None])
    # The time no item took stands last, however much of it there is.
    lines = sorted(
        (_item_line(item, names, found) for item, found in grouped.items()),
        key=lambda line: (line["work_item_id"] is None, -line["agent_seconds"]),
    )
    first = [str(run["first_at"]) for run in runs if run["first_at"]]
    last = [str(run["last_at"]) for run in runs if run["last_at"]]
    return {
        "session_id": session_id,
        "first_at": min(first) if first else None,
        "last_at": max(last) if last else None,
        **_summary(rows),
        "excluded": _excluded(runs),
        "by_item": lines,
        "runs": [
            {
                "agent_id": str(run["agent_id"]) or None,
                "client": run["client"],
                "status": run["status"],
                "first_at": run["first_at"],
                "last_at": run["last_at"],
                "read_at": run["read_at"],
                "excluded": _excluded((run,)),
            }
            for run in runs
        ],
    }


def _excluded(runs: Iterable[sqlite3.Row]) -> dict:
    """The time left out by class, which together with the work is a run's whole span."""

    found = list(runs)
    return {
        name: round(sum(float(run[f"{name}_seconds"]) for run in found), 3)
        for name in ("human", "subagent", "external", "gap")
    }
