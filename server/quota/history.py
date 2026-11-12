"""Quota history from a file: one sample a line, in a form no other program owns.

`valkama quota import --source FILE` reads it. Each line is a JSON object for one window
of one reading of one organization:

    {"organization": "…", "at": "2030-03-04T09:00:00.000Z", "kind": "week",
     "percent": 42, "resets_at": "2030-03-08T09:00:00Z", "seat": "week:2030-03-08T09:00Z"}

`organization`, `at` and `kind` are required; `percent`, `resets_at`, `seat`, `model`,
`amount` and `currency` may be left out or `null`, under the rules of `samples.Window`.
A seat is kept as the line gives it and never derived here: a line without one belongs
to no seat's series. Any other field, a line that is no such object, or a value the
store cannot keep refuses the whole file before anything is written; an empty line is
skipped.

The lines are written oldest first through `samples.record` as the `import` source, in
one transaction, so a second import of the same file keeps nothing, and neither does a
line equal to the sample before it in its series.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass, field

from . import samples

_REQUIRED = ("organization", "at", "kind")
_OPTIONAL = ("percent", "resets_at", "seat", "model", "amount", "currency")


@dataclass
class Organization:
    """What one organization's lines held and what of them was kept."""

    lines: int = 0
    added: int = 0
    first_at: str = ""
    last_at: str = ""


@dataclass
class Report:
    """What one import read and kept.

    `unchanged` lines matched the sample before them in their series, the same file's
    earlier import included; `expired` lines were past the retention.
    """

    lines: int = 0
    added: int = 0
    unchanged: int = 0
    expired: int = 0
    organizations: dict[str, Organization] = field(default_factory=dict)

    def as_dict(self) -> dict[str, object]:
        return {
            "lines": self.lines,
            "added": self.added,
            "unchanged": self.unchanged,
            "expired": self.expired,
            "organizations": {
                organization: vars(counts)
                for organization, counts in sorted(self.organizations.items())
            },
        }


def _text(value: object, name: str) -> str | None:
    if value is None or isinstance(value, str):
        return value
    raise samples.SampleError(f"`{name}` is not text")


def _reading(line: str) -> samples.Reading:
    try:
        parsed = json.loads(line)
    except json.JSONDecodeError as error:
        raise samples.SampleError(f"not JSON: {error.msg}") from error
    if not isinstance(parsed, dict):
        raise samples.SampleError("not a JSON object")
    unknown = sorted(set(parsed) - set(_REQUIRED) - set(_OPTIONAL))
    if unknown:
        raise samples.SampleError(f"unknown field {unknown[0]!r}")
    missing = [name for name in _REQUIRED if not isinstance(parsed.get(name), str)]
    if missing:
        raise samples.SampleError(f"`{missing[0]}` is required text")
    window = samples.Window(
        kind=parsed["kind"],
        percent=parsed.get("percent"),
        resets_at=_text(parsed.get("resets_at"), "resets_at"),
        model=_text(parsed.get("model"), "model"),
        amount=parsed.get("amount"),
        currency=_text(parsed.get("currency"), "currency"),
    )
    return samples.Reading(
        source="import",
        at=parsed["at"],
        windows=(window,),
        seat=_text(parsed.get("seat"), "seat"),
        organization=parsed["organization"],
    )


def import_lines(
    conn: sqlite3.Connection, lines: Iterable[str], *, now: dt.datetime | None = None
) -> Report:
    """Import every line, all or none, in one transaction of its own; what was kept.

    `conn` must be outside any transaction. A line that cannot be kept raises
    `SampleError` naming its number, and nothing is written.
    """

    clock = now or dt.datetime.now(dt.UTC)
    read: list[tuple[str, int, samples.Reading]] = []
    for number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            reading = _reading(line)
            at = samples.instant(reading.at)
        except samples.SampleError as error:
            raise samples.SampleError(f"line {number}: {error}") from error
        read.append((at, number, reading))
    read.sort(key=lambda entry: (entry[0], entry[1]))
    report = Report()
    retained_from = samples.retained_from(clock)
    conn.execute("BEGIN IMMEDIATE")
    try:
        for at, number, reading in read:
            organization = str(reading.organization)
            counts = report.organizations.setdefault(organization, Organization())
            try:
                added = samples.record(conn, reading, now=clock)
            except samples.SampleError as error:
                raise samples.SampleError(f"line {number}: {error}") from error
            report.lines += 1
            counts.lines += 1
            counts.first_at = counts.first_at or at
            counts.last_at = at
            report.added += added
            counts.added += added
            if at < retained_from:
                report.expired += 1
            elif not added:
                report.unchanged += 1
    except BaseException:
        conn.rollback()
        raise
    conn.commit()
    return report


__all__ = ["Organization", "Report", "import_lines"]
