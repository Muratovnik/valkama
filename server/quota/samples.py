"""The one way a quota sample is written, the seat rule, and the samples' retention.

Every source -- the status line command, the mod, the poll and the history import --
hands `record` a `Reading`: what it saw at one moment, window by window, and what the
reading is identified by. `record` keeps a window only when it differs from the reading
before it in its series (`store`), so a gap between two samples reads as "unchanged
since". It inserts and never updates: a sample row is never rewritten, and a later sample
changes nothing about an earlier one.

The seat of a reading is the week's reset, to the nearest ten minutes (`seat_for_week`):
two seats of one organization spend separate limits, and the reset of the week is what
tells them apart in a reading. A source that sees the week passes `seat_of(windows)`; a
reading with no week, or history that says none, passes `None`, and such a sample belongs
to no seat's series.
"""

from __future__ import annotations

import datetime as dt
import math
import re
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass

from . import store as quota_store

#: What each live source calls a window, and the kind it is here. The status line and
#: the mod name the client's `rate_limits` windows; the poll names the usage endpoint's
#: `limits[].kind` (`weekly_scoped` carries the model apart), its older `five_hour` and
#: `seven_day` buckets, and its `spend` object. Imported history names the kinds as here.
SOURCE_WINDOWS: dict[str, dict[str, str]] = {
    "statusline": {"five_hour": "five_hour", "seven_day": "week", "spend_limit": "spend_limit"},
    "mod": {"five_hour": "five_hour", "seven_day": "week"},
    "poll": {
        "session": "five_hour",
        "five_hour": "five_hour",
        "weekly_all": "week",
        "seven_day": "week",
        "weekly_scoped": "week_model",
        "spend": "extra_usage",
    },
}

#: An organization or a session id: a short plain token, as the usage rows keep ids.
_TOKEN = re.compile(r"[A-Za-z0-9._:-]{1,128}")
#: A model as a source names it, an id or a display name such as `Opus 4`.
_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._:-]{0,63}")
#: A plan's short name, such as `Team` or `Max`.
_PLAN = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}")
_SEAT = re.compile(r"week:\d{4}-\d{2}-\d{2}T\d{2}:\d0Z")
_CURRENCY = re.compile(r"[A-Z]{3}")
_EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.UTC)
#: How far ahead of the clock a reading may be dated: a source's clock is this one's.
_AHEAD = dt.timedelta(minutes=5)


class SampleError(ValueError):
    """A reading this store cannot keep as it was given; nothing of it was written."""


@dataclass(frozen=True)
class Window:
    """One window of a reading, in this store's kinds (`store.KINDS`).

    `percent` is required except for `extra_usage`, which may carry only `amount`;
    `model` is required for `week_model` and refused for every other kind; `amount` and
    `currency` belong to the two money kinds alone.
    """

    kind: str
    percent: float | None = None
    resets_at: str | None = None
    model: str | None = None
    amount: float | None = None
    currency: str | None = None


@dataclass(frozen=True)
class Reading:
    """What one source saw at one moment.

    `organization` for `poll` and `import`, `session_id` for `statusline` and `mod`, and
    never both. `at` and every `resets_at` are ISO 8601 times with an offset. `seat` is
    given, even when it is `None`, so no caller leaves the seat to a default. `plan` is the
    plan a profile named, for an organization's reading with a seat.
    """

    source: str
    at: str
    windows: tuple[Window, ...]
    seat: str | None
    organization: str | None = None
    session_id: str | None = None
    plan: str | None = None


def instant(text: str) -> str:
    """An ISO 8601 time with an offset, as the store keeps it: UTC to the millisecond."""

    try:
        parsed = dt.datetime.fromisoformat(text)
    except (TypeError, ValueError) as error:
        raise SampleError(f"not an ISO 8601 time: {text!r}") from error
    if parsed.tzinfo is None:
        raise SampleError(f"a time without an offset: {text!r}")
    stamped = parsed.astimezone(dt.UTC).isoformat(timespec="milliseconds")
    return stamped.replace("+00:00", "Z")


def seat_for_week(resets_at: str) -> str:
    """The seat a week's reset names: `week:` and the reset to the nearest ten minutes.

    Whole seconds, then ten-minute steps, a half step going to the even one: the rule the
    imported readings were keyed by, so the imported history and a live source
    name one seat alike.
    """

    moment = dt.datetime.fromisoformat(instant(resets_at))
    seconds = (moment - _EPOCH) // dt.timedelta(seconds=1)
    rounded = _EPOCH + dt.timedelta(seconds=round(seconds / 600) * 600)
    return "week:" + rounded.strftime("%Y-%m-%dT%H:%MZ")


def seat_of(windows: Iterable[Window]) -> str | None:
    """The seat of a reading: its week's reset, or `None` when it shows no week with one."""

    for window in windows:
        if window.kind == "week" and window.resets_at is not None:
            return seat_for_week(window.resets_at)
    return None


def retained_from(now: dt.datetime) -> str:
    """The oldest sample time the store keeps at `now`."""

    return instant((now - dt.timedelta(days=quota_store.RETENTION_DAYS)).isoformat())


def _number(value: float | None, what: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise SampleError(f"{what} is not a finite number")
    if value < 0:
        raise SampleError(f"{what} is below zero")
    return float(value)


def _window(window: Window) -> Window:
    """The window as the store keeps it, or `SampleError`."""

    if window.kind not in quota_store.KINDS:
        raise SampleError(f"no window kind {window.kind!r}; the kinds are {quota_store.KINDS}")
    if (window.kind == "week_model") != (window.model is not None):
        raise SampleError("a model belongs to a `week_model` window and to no other")
    if window.model is not None and not _MODEL.fullmatch(window.model):
        raise SampleError(f"not a model name: {window.model!r}")
    percent = _number(window.percent, "percent")
    amount = _number(window.amount, "amount")
    money = window.kind in quota_store.MONEY_KINDS
    if not money and (amount is not None or window.currency is not None):
        raise SampleError(f"a `{window.kind}` window carries no money")
    if window.currency is not None and (amount is None or not _CURRENCY.fullmatch(window.currency)):
        raise SampleError("a currency is three capital letters beside an amount")
    if percent is None and (window.kind != "extra_usage" or amount is None):
        raise SampleError(f"a `{window.kind}` window needs its percent")
    resets_at = None if window.resets_at is None else instant(window.resets_at)
    return Window(window.kind, percent, resets_at, window.model, amount, window.currency)


def _validated(reading: Reading, now: dt.datetime) -> Reading:
    """The reading as the store keeps it, or `SampleError` before anything is written."""

    if reading.source not in quota_store.SOURCES:
        raise SampleError(f"no source {reading.source!r}; the sources are {quota_store.SOURCES}")
    by_organization = reading.source in quota_store.BY_ORGANIZATION
    named = reading.organization if by_organization else reading.session_id
    other = reading.session_id if by_organization else reading.organization
    if named is None or other is not None:
        wanted = "an organization" if by_organization else "a session"
        raise SampleError(f"a `{reading.source}` reading is identified by {wanted} alone")
    if not _TOKEN.fullmatch(named):
        raise SampleError(f"not an id: {named!r}")
    if reading.seat is not None and not _SEAT.fullmatch(reading.seat):
        raise SampleError(f"not a seat: {reading.seat!r}")
    if reading.plan is not None and (
        not by_organization or reading.seat is None or not _PLAN.fullmatch(reading.plan)
    ):
        raise SampleError("a plan is a short name given with an organization's seat")
    at = instant(reading.at)
    if dt.datetime.fromisoformat(at) > now + _AHEAD:
        raise SampleError(f"a reading dated ahead of this clock: {at}")
    if not reading.windows:
        raise SampleError("a reading with no window")
    windows = tuple(_window(window) for window in reading.windows)
    series = [(window.kind, window.model) for window in windows]
    if len(set(series)) != len(series):
        raise SampleError("a reading names one window twice")
    return Reading(
        reading.source,
        at,
        windows,
        reading.seat,
        reading.organization,
        reading.session_id,
        reading.plan,
    )


#: The latest sample of a series at or before a moment, for each kind of identity.
_LATEST = (
    "SELECT percent, resets_at, amount, currency FROM quota_samples WHERE {} = ?"
    " AND seat IS ? AND kind = ? AND model IS ? AND at <= ? ORDER BY at DESC, id DESC LIMIT 1"
)
_LATEST_OF_ORGANIZATION = _LATEST.format("organization")
_LATEST_OF_SESSION = _LATEST.format("session_id")


def record(conn: sqlite3.Connection, reading: Reading, *, now: dt.datetime | None = None) -> int:
    """Keep the windows of `reading` that changed in their series; how many were kept.

    Runs inside the caller's transaction. A reading that cannot be kept raises
    `SampleError` before it writes anything; one older than the retention keeps nothing.
    A window is compared with the latest sample of its series at or before the reading,
    so a reading given twice, or history imported again, keeps nothing the second time.
    """

    clock = now or dt.datetime.now(dt.UTC)
    kept = _validated(reading, clock)
    if kept.at < retained_from(clock):
        return 0
    by_organization = kept.organization is not None
    query = _LATEST_OF_ORGANIZATION if by_organization else _LATEST_OF_SESSION
    value = kept.organization if by_organization else kept.session_id
    added = 0
    for window in kept.windows:
        latest = conn.execute(
            query, (value, kept.seat, window.kind, window.model, kept.at)
        ).fetchone()
        if latest is not None and tuple(latest) == (
            window.percent,
            window.resets_at,
            window.amount,
            window.currency,
        ):
            continue
        conn.execute(
            "INSERT INTO quota_samples(at, source, organization, session_id, seat, kind, model,"
            " percent, resets_at, amount, currency) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                kept.at,
                kept.source,
                kept.organization,
                kept.session_id,
                kept.seat,
                window.kind,
                window.model,
                window.percent,
                window.resets_at,
                window.amount,
                window.currency,
            ),
        )
        added += 1
    if kept.organization is not None and kept.seat is not None:
        conn.execute(
            "INSERT INTO quota_accounts(organization, seat, plan) VALUES (?,?,?)"
            " ON CONFLICT(organization, seat) DO UPDATE SET plan = excluded.plan"
            " WHERE excluded.plan IS NOT NULL",
            (kept.organization, kept.seat, kept.plan),
        )
    return added


def prune(conn: sqlite3.Connection, *, now: dt.datetime | None = None) -> int:
    """Delete the samples older than the retention, in the caller's transaction; how many."""

    cutoff = retained_from(now or dt.datetime.now(dt.UTC))
    return conn.execute("DELETE FROM quota_samples WHERE at < ?", (cutoff,)).rowcount


__all__ = [
    "SOURCE_WINDOWS",
    "Reading",
    "SampleError",
    "Window",
    "instant",
    "prune",
    "record",
    "retained_from",
    "seat_for_week",
    "seat_of",
]
