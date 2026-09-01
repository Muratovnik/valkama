"""ANA-007: several projects in one reading, without pretending they are one.

The portfolio already existed as a screen and asked the wrong thing of the
server: it fetched a whole dashboard per project to render a strip of state
counts, and the half that distinguishes projects — which backend answered for
each, and how much of each was observed — never reached it at all. A
cross-project mode whose projects all look alike is a list, not a mode.

Combining is done here rather than in the browser because the rule for it is
`coverage_of`, and a second implementation of that rule is a second answer to
the only question this module exists to answer honestly. The client renders
what it is given.

What may be added and what may not is the whole of §14.4 applied one level up:

Counts add. Attempts, deliveries, inventory and wall seconds are quantities of
the same kind measured in each project, and their sums mean what they say.

Coverage does not average. Two projects at `partial` do not make a portfolio at
`partial`; the union is recomputed from how many attempts were observed across
all of them, so one fully-observed project cannot lift an unobserved one.

A mean is weighted or it is wrong. Cycle time is a mean over observations, so
the portfolio's is weighted by how many observations each project contributed.
Averaging the averages would let a project with two closed items outweigh one
with two hundred.
"""

from __future__ import annotations

import sqlite3

from ..telemetry import contracts
from . import projection as analytics_projection

#: How many spaces one portfolio reads. Each one costs a full projection, and a
#: page that quietly stops at some of them is worse than one that says so.
MAX_SPACES = 25


def portfolio(conn: sqlite3.Connection, *, limit: int = MAX_SPACES) -> dict:
    """Every planning space in this store, side by side and added up.

    Only this store. An attached space belongs to another connection with its
    own identity, and reading it here would put two stores' numbers in one
    total under one project's name.
    """

    bounded = max(1, min(int(limit), MAX_SPACES))
    rows = conn.execute(
        "SELECT project_id, name, key FROM planning_spaces ORDER BY project_id, key"
    ).fetchall()
    truncated = len(rows) > bounded
    projects = [_project(conn, row) for row in rows[:bounded]]
    return {
        "interface_version": "dashboard-portfolio",
        "projects": projects,
        "truncated": truncated,
        "totals": _totals(projects),
    }


def _project(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    """One space's headline figures, and who answered for them."""

    # By key. The projection resolves a space by its key and a space's name is
    # a different string — "Alpha Workspace" is keyed `AW` — so passing the
    # name asks for a space that does not exist.
    payload = analytics_projection.project_space(conn, str(row["key"]))
    kpis = payload["kpis"]
    executions = payload["executions"]
    return {
        "project_id": str(row["project_id"]),
        "space_key": str(row["key"]),
        "space_name": str(row["name"]),
        "inventory": int(kpis["inventory"]),
        "completed": int(kpis["completed"]),
        "blocked": int(kpis["blocked"]),
        # The lane counts the portfolio has always shown. Kept per project
        # rather than summed: two spaces may declare different lanes, and a
        # column that means `review` in one and nothing in the other is a
        # column nobody can read.
        "states": [
            {"key": str(state["key"]), "items": int(payload["flow"].get(state["key"], 0))}
            for state in payload["states"]
        ],
        "cycle_seconds": kpis["cycle_seconds"],
        "cycle_observed": int(kpis["cycle_observed"]),
        "attempts": int(executions["attempts"]),
        "delivered": int(executions["delivered"]),
        "ended": int(executions["ended"]),
        "observed_attempts": int(executions["observed_attempts"]),
        "tokens": executions["tokens"]["total"]["value"],
        "tokens_coverage": str(executions["tokens_coverage"]),
        "wall_seconds": executions["execution_wall_time"]["seconds"],
        "wall_observed": int(executions["execution_wall_time"]["observed"]),
        "wall_coverage": str(executions["execution_wall_time"]["coverage"]),
        # Which backend actually answered, which is what makes a mixed
        # portfolio readable. The assignment says what was configured; this
        # says what was read, and only the second one explains a number.
        "adapters": _adapters(executions["attempt_rows"]),
    }


def _adapters(attempt_rows: list[dict]) -> list[str]:
    return sorted(
        {
            str(row["source"]["adapter_id"])
            for row in attempt_rows
            if str(row["source"]["adapter_id"])
        }
    )


def _totals(projects: list[dict]) -> dict:
    """The portfolio as one reading, with every combination stated.

    `unmeasured_seconds` is not here and that is deliberate: planning cycle
    time and execution wall time are different clocks, and a portfolio that
    offered their sum would be inventing a third.
    """

    attempts = sum(item["attempts"] for item in projects)
    observed = sum(item["observed_attempts"] for item in projects)
    wall_observed = sum(item["wall_observed"] for item in projects)
    cycle_observed = sum(item["cycle_observed"] for item in projects)
    weighted = sum(
        item["cycle_seconds"] * item["cycle_observed"]
        for item in projects
        if isinstance(item["cycle_seconds"], int | float)
    )
    tokens = [item["tokens"] for item in projects if isinstance(item["tokens"], int)]
    walls = [item["wall_seconds"] for item in projects if isinstance(item["wall_seconds"], int)]
    return {
        "projects": len(projects),
        "inventory": sum(item["inventory"] for item in projects),
        "completed": sum(item["completed"] for item in projects),
        "blocked": sum(item["blocked"] for item in projects),
        "attempts": attempts,
        "delivered": sum(item["delivered"] for item in projects),
        "ended": sum(item["ended"] for item in projects),
        # Weighted by observations, because a mean of means lets a project with
        # two closed items weigh as much as one with two hundred.
        "cycle_seconds": round(weighted / cycle_observed) if cycle_observed else None,
        "cycle_observed": cycle_observed,
        "tokens": sum(tokens) if tokens else None,
        # Recomputed across every attempt rather than merged from the per-project
        # verdicts: two `partial` projects are not a `partial` portfolio, and one
        # fully-observed project must not lift an unobserved one.
        "tokens_coverage": contracts.coverage_of(observed, attempts),
        "wall_seconds": sum(walls) if walls else None,
        "wall_coverage": contracts.coverage_of(wall_observed, attempts),
        "adapters": sorted({name for item in projects for name in item["adapters"]}),
    }


__all__ = ["MAX_SPACES", "portfolio"]
