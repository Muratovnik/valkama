"""What one dashboard request asked for, resolved once.

The selection and every aggregate behind it read the same instant, the same
window and the same dimension filters. Resolving them here rather than at each
use is what keeps a KPI from disagreeing with the chart above it, and it is
also where the request is echoed back to the client — as it was written, not as
it was normalised.
"""

from __future__ import annotations

import datetime as _dt
from collections.abc import Mapping
from dataclasses import dataclass

from .timeline import RUNTIME_ENVIRONMENTS, _in_time_window, iso_time, parse_time

#: The lower bound an open-ended window falls back to, so an overlap test can
#: compare against a real instant instead of branching on ``None``.
_BEGINNING = _dt.datetime.min.replace(tzinfo=_dt.UTC)


@dataclass(frozen=True)
class Scope:
    """One instant, one window, and the dimension filters, all normalised.

    ``epic``, ``status``, ``environment`` and ``tool`` are the forms used as
    predicates. ``requested_environment`` and ``requested_tool`` keep what the
    caller wrote, because the payload states the request back and a caller who
    typed a runtime that does not exist has to see their own word in it.
    """

    as_of: _dt.datetime
    start: _dt.datetime | None
    finish: _dt.datetime | None
    epic: str | None
    status: str | None
    client: str | None
    agent: str | None
    environment: str | None
    tool: str | None
    requested_environment: str
    requested_tool: str

    @classmethod
    def resolve(
        cls,
        *,
        as_of: object = None,
        date_from: object = None,
        date_to: object = None,
        epic: int | str | None = None,
        client: str | None = None,
        agent: str | None = None,
        environment: str | None = None,
        tool: str | None = None,
        status: str | None = None,
        declared_states: list[str],
    ) -> Scope:
        """Normalise one request against the states the space actually declares.

        A status the space never declared is dropped rather than matched, and a
        window end past ``as_of`` is clipped to it: the projection is read-only
        and cannot answer for time that has not happened.
        """

        as_of_time = parse_time(as_of, default=_dt.datetime.now(_dt.UTC))
        # Unreachable for the same reason as in daily_activity: the default is
        # not None, so this only states the narrowing.
        assert as_of_time is not None  # noqa: S101
        wanted_environment = str(environment or "").strip().lower() or None
        if wanted_environment and wanted_environment not in RUNTIME_ENVIRONMENTS:
            # A runtime no session can report, so the filter selects nothing
            # rather than silently selecting everything.
            wanted_environment = "__invalid__"
        finish = parse_time(date_to)
        if finish is not None and finish > as_of_time:
            finish = as_of_time
        return cls(
            as_of=as_of_time,
            start=parse_time(date_from),
            finish=finish,
            # An epic is named by its reference, the way a person writes it.
            epic=str(epic).strip().upper() or None if epic not in (None, "") else None,
            status=str(status) if status in declared_states else None,
            client=client,
            agent=agent,
            environment=wanted_environment,
            tool=str(tool or "").strip() or None,
            requested_environment=environment or "",
            requested_tool=tool or "",
        )

    @property
    def unbounded(self) -> bool:
        """Whether the request named no window at all."""

        return self.start is None and self.finish is None

    @property
    def range_start(self) -> _dt.datetime:
        """The window's lower bound, open-ended windows included."""

        return self.start or _BEGINNING

    @property
    def range_end(self) -> _dt.datetime:
        """The window's upper bound, which never runs past ``as_of``."""

        return self.finish or self.as_of

    @property
    def narrows_dimensions(self) -> bool:
        """Whether any non-time filter was named.

        Evidence that is not linked to a selected card is dropped entirely once
        one was: a client, agent, runtime or tool filter is a claim about work
        in this space, and an unlinked row cannot be said to satisfy it.
        """

        return bool(self.client or self.agent or self.environment or self.tool)

    def admits(self, stamp: _dt.datetime | None) -> bool:
        """Apply the dashboard's inclusive-as_of, half-open date window."""

        return _in_time_window(stamp, as_of=self.as_of, date_from=self.start, date_to=self.finish)

    def overlaps(self, history: Mapping[str, object]) -> bool:
        """Whether any of one item's status segments falls inside the window."""

        if self.unbounded:
            return True
        range_end = self.range_end
        if self.start is not None and self.start >= range_end:
            return False
        for segment in history.get("segments", []):
            seg_start = parse_time(segment.get("start"))
            seg_end = parse_time(segment.get("end")) or self.as_of
            if seg_start is None:
                continue
            if seg_end > self.range_start and seg_start < range_end:
                return True
        return False

    def filters(self) -> dict:
        """The one canonical request the payload states back to the client.

        Missing values are ``None`` rather than empty strings: this object is
        both the committed screen selection and the input an export replays.
        A second spelling or a display-only empty value would make those two
        requests observably different.
        """

        return {
            "epic": self.epic,
            "client": self.client,
            "agent": self.agent,
            "environment": self.requested_environment or None,
            "tool": self.requested_tool or None,
            "status": self.status,
            "date_from": iso_time(self.start),
            "date_to": iso_time(self.finish),
            "as_of": iso_time(self.as_of),
        }
