"""The dashboard as a file, in the normalized shape rather than the provider's.

A person exporting a dashboard is taking a number somewhere else — a note, a
spreadsheet, a message to somebody who does not have Valkama open. Two rules
follow from that and both are the plan's (§14.5, ANA-009).

It is the normalized result, never raw provider data. A journal line or a
provider's own event shape means nothing outside the tool that wrote it, and
exporting one would make Valkama a worse copy of that tool.

Every row carries its coverage. A CSV is the format most likely to be read
without its context — pasted into a message, opened next to another export — so
a figure that leaves here without saying how well it was observed is the same
figure a reader will treat as exact. The column is not optional.
"""

from __future__ import annotations

import csv
import io

#: What a row is: one measurement, its value, and how much of it was observed.
#: Flat on purpose — a CSV with nested groups is a CSV nobody can sort.
COLUMNS = ("section", "metric", "value", "unit", "coverage")


def dashboard_csv(payload: dict) -> str:
    """One row per measurement, with the unit and the coverage beside it."""

    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(COLUMNS)
    for row in _rows(payload):
        writer.writerow(row)
    return buffer.getvalue()


def _rows(payload: dict) -> list[tuple[str, str, object, str, str]]:
    kpis = payload.get("kpis") or {}
    history = payload.get("history_coverage") or {}
    executions = payload.get("executions") or {}
    rows: list[tuple[str, str, object, str, str]] = [
        ("planning", "inventory", kpis.get("inventory"), "work items", _quality(history)),
        ("planning", "completed", kpis.get("completed"), "work items", _quality(history)),
        ("planning", "blocked", kpis.get("blocked"), "work items", _quality(history)),
        ("planning", "reopened", kpis.get("reopened"), "work items", _quality(history)),
        (
            "planning",
            "planning_cycle_time",
            kpis.get("cycle_seconds"),
            "seconds",
            _quality(history),
        ),
    ]

    wall = executions.get("execution_wall_time") or {}
    active = executions.get("execution_active_time") or {}
    rows += [
        ("executions", "attempts", executions.get("attempts"), "attempts", "confirmed"),
        ("executions", "ended", executions.get("ended"), "attempts", "confirmed"),
        ("executions", "delivered", executions.get("delivered"), "attempts", "confirmed"),
        (
            "executions",
            "execution_wall_time",
            wall.get("seconds"),
            "seconds",
            str(wall.get("coverage") or "unknown"),
        ),
        # Exported even though it is always unknown for now: a column that
        # disappears when its value does teaches a reader that the measurement
        # does not exist, rather than that it was not observed.
        (
            "executions",
            "execution_active_time",
            active.get("seconds"),
            "seconds",
            str(active.get("coverage") or "unknown"),
        ),
    ]
    coverage = str(executions.get("tokens_coverage") or "unknown")
    for name, field in (executions.get("tokens") or {}).items():
        rows.append(("tokens", name, (field or {}).get("value"), "tokens", coverage))
    for entry in executions.get("tools") or []:
        rows.append(
            ("tools", str(entry.get("name") or ""), entry.get("calls"), "calls", "confirmed")
        )
        if entry.get("errors"):
            rows.append(
                ("tools", f"{entry.get('name')} errors", entry.get("errors"), "calls", "confirmed")
            )
    # An absent value is an empty cell rather than a zero, for the same reason it
    # is a dash in the interface: a spreadsheet sums a zero.
    return [
        (section, metric, "" if value is None else value, unit, quality)
        for section, metric, value, unit, quality in rows
    ]


def _quality(history: dict) -> str:
    return str(history.get("overall") or "unknown")


__all__ = ["COLUMNS", "dashboard_csv"]
