"""What agent work spent in a period, cut by up to two of its dimensions.

The measures are the per-item and per-session reads' (`planning.usage`): seconds, tokens
by kind, the cost estimate with its `cost_basis`, `unpriced_tokens` and the quality of
the time. Of those reads' two times this one gives `agent_seconds`, the sum of the
stretches of work: two agents working one hour side by side spent two. Their union
(`elapsed_seconds` there) is not given, because it does not add up across groups or
steps, and every figure here does: the rows add up to the total, the steps of the series
to the total, and the groups of a step to the step, exactly. The whole store read over a
period that holds all of it is what the per-session reads add up to, to within half a
millisecond and half a millionth of a dollar for each stretch.

A stretch of work that crosses a step boundary or an edge of the period is split in
proportion to its time, with its tokens and its cost, in whole units: a token, a
millisecond, a millionth of a dollar. What a stretch has spent by a moment is its total
times the share of its time before that moment, rounded half up; what it spends between
two moments is the difference. So the part that falls between two moments depends on
those moments alone, never on the other cuts of the same read: a period's total is the
same by the hour, by the day and beside a comparison, and two adjacent periods add up to
the one they make. A stretch with no length counts whole at its moment.

A day is the caller's: the request carries its offset from UTC in minutes, and the server
reads no time-zone database. A period across a change of daylight saving time is cut at
one offset; a caller that minds asks for it in two.

| Dimension | Value | Read from |
| --- | --- | --- |
| `account` | the organization a stretch was billed to | the segment, as stored |
| `project` | the project of the item's planning space; with no item, the project whose root holds the session's working directory | the space, the session and the projects registry |
| `work_item` | the item a stretch is counted to, `null` for work on no item | the segment |
| `executor` | the session a card's holder opens: a subagent's work is its session's | `planning.executors` |
| `launch_class` | how a subagent's run was launched, `null` for a session's own run | the run |
| `model`, `effort`, `environment` | as the segment holds them | the segment |

A value the store does not hold is its own group, `unknown`. Work on no item and a
session's own run, which is launched by no one, are groups of their own too, and are not
unknown: there is nothing to know. Nothing is collected here.
"""

from __future__ import annotations

import bisect
import datetime as dt
import json
import math
import operator
import re
import sqlite3
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from ..planning import executors
from ..planning import usage as item_usage
from ..projects import project_registry

ACCOUNT = "account"
PROJECT = "project"
WORK_ITEM = "work_item"
EXECUTOR = "executor"
LAUNCH_CLASS = "launch_class"
MODEL = "model"
EFFORT = "effort"
ENVIRONMENT = "environment"
DIMENSIONS = (ACCOUNT, PROJECT, WORK_ITEM, EXECUTOR, LAUNCH_CLASS, MODEL, EFFORT, ENVIRONMENT)

#: The length of each step, in seconds. A day is always 24 hours at one offset.
STEPS = {"hour": 3600, "day": 86400}
_SECOND = 1_000_000
_MILLISECOND = 1000
MAX_GROUPS = 2
#: A hundred days by the hour, or six and a half years by the day.
MAX_STEPS = 2400
#: The furthest any zone is from UTC.
MAX_OFFSET_MINUTES = 14 * 60
MAX_FILTER_VALUES = 100
MAX_VALUE_LENGTH = 512

_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.UTC)
_MICRO = dt.timedelta(microseconds=1)
#: The moments a period and its comparison may lie between: nothing is stored before
#: the first, and a date past the second could not be written at every offset.
_EARLIEST = 0
_LATEST = (dt.datetime(9999, 1, 1, tzinfo=dt.UTC) - _EPOCH) // _MICRO
_TOKENS = len(item_usage.TOKEN_KINDS)
#: Where each priced kind sits among the token columns.
_PRICED = tuple(
    index
    for index, (_, column) in enumerate(item_usage.TOKEN_KINDS)
    if column in item_usage.PRICED_COLUMNS
)

# The one read of the period's stretches, with what each dimension needs.
_STARTED, _ENDED, _SECONDS, _QUALITY, _COST, _MODEL = range(6)
_FIRST_TOKEN = 6
_ORGANIZATION = _FIRST_TOKEN + _TOKENS
_ITEM, _SESSION, _LAUNCH, _EFFORT, _ENVIRONMENT, _ITEM_PROJECT, _AGENT = range(
    _ORGANIZATION + 1, _ORGANIZATION + 8
)
#: The token columns stand in `TOKEN_KINDS` order.
SEGMENTS = (
    "SELECT s.started_at, s.ended_at, s.seconds, s.quality, s.estimated_api_cost_usd, s.model,"
    " s.input_tokens, s.cached_read_tokens, s.cache_write_5m_tokens, s.cache_write_1h_tokens,"
    " s.output_tokens, s.reasoning_tokens,"
    " s.organization, s.work_item_id, s.session_id, r.launch_class, s.effort, s.environment,"
    " p.project_id, s.agent_id"
    " FROM usage_segments s"
    " LEFT JOIN usage_runs r ON r.id = s.run_id"
    " LEFT JOIN work_items i ON i.work_item_id = s.work_item_id"
    " LEFT JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " WHERE s.started_at < ? AND s.ended_at >= ?"
)
_COLUMN_OF = {
    ACCOUNT: _ORGANIZATION,
    WORK_ITEM: _ITEM,
    EXECUTOR: _SESSION,
    MODEL: _MODEL,
    EFFORT: _EFFORT,
    ENVIRONMENT: _ENVIRONMENT,
}


class _Unknown:
    """A value the store does not hold, in a dimension where `None` is a value of its own."""

    __slots__ = ()

    def __repr__(self) -> str:
        return "UNKNOWN"


UNKNOWN = _Unknown()
#: A dimension's value: a string, `None` for none or, outside `_NONE_IS_A_VALUE`, for one
#: the store does not hold, and `UNKNOWN` for one it does not hold inside it.
Value = str | _Unknown | None
#: Where `None` is a group of its own and not unknown: work on no item, a session's own run.
_NONE_IS_A_VALUE = frozenset({WORK_ITEM, LAUNCH_CLASS})


class UsageQueryError(ValueError):
    """A request this read cannot answer, saying what in it is wrong."""


@dataclass(frozen=True)
class UsageQuery:
    """One request, checked: the period in microseconds since the epoch, and its cuts."""

    start: int
    end: int
    step: str
    utc_offset: int
    group_by: tuple[str, ...] = ()
    #: The values each filtered dimension admits; `None` admits work with none.
    filters: Mapping[str, frozenset[Value]] = field(default_factory=dict)
    compare: bool = False


def _micro(moment: dt.datetime) -> int:
    return (moment - _EPOCH) // _MICRO


def _at(micro: int, zone: dt.tzinfo) -> str:
    return (_EPOCH + micro * _MICRO).astimezone(zone).isoformat()


def _moment(text: str, name: str, zone: dt.tzinfo) -> int:
    """A date as the start of that day in the caller's zone, or a time with its own offset."""

    try:
        if _DATE.fullmatch(text):
            return _micro(dt.datetime.combine(dt.date.fromisoformat(text), dt.time(), zone))
        moment = dt.datetime.fromisoformat(text)
        if moment.tzinfo is None:
            raise UsageQueryError(f"{name} must be a date or a time with its offset")
        return _micro(moment)
    except (ValueError, OverflowError) as error:
        if isinstance(error, UsageQueryError):
            raise
        raise UsageQueryError(f"{name} must be a date or a time with its offset") from error


def _dimensions(names: Iterable[str], parameter: str) -> list[str]:
    found = list(names)
    for name in found:
        if name not in DIMENSIONS:
            raise UsageQueryError(f"{parameter} names no dimension called {name}")
    if len(set(found)) != len(found):
        raise UsageQueryError(f"{parameter} names a dimension twice")
    return found


def _admitted(values: Sequence[str], dimension: str) -> set[Value]:
    if len(values) > MAX_FILTER_VALUES:
        raise UsageQueryError(f"{dimension} takes at most {MAX_FILTER_VALUES} values")
    for value in values:
        if not value or len(value) > MAX_VALUE_LENGTH:
            raise UsageQueryError(f"{dimension} takes values of 1 to {MAX_VALUE_LENGTH} characters")
    return set(values)


def query(
    *,
    start: str,
    end: str,
    step: str = "day",
    utc_offset: int = 0,
    group_by: Sequence[str] = (),
    filters: Mapping[str, Sequence[str]] | None = None,
    none: Sequence[str] = (),
    compare: bool = False,
) -> UsageQuery:
    """A request checked whole, or a refusal naming the first thing wrong in it."""

    if step not in STEPS:
        raise UsageQueryError("step must be hour or day")
    if not -MAX_OFFSET_MINUTES <= utc_offset <= MAX_OFFSET_MINUTES:
        raise UsageQueryError(
            f"utc_offset must be from {-MAX_OFFSET_MINUTES} to {MAX_OFFSET_MINUTES} minutes"
        )
    zone = dt.timezone(dt.timedelta(minutes=utc_offset))
    begins, ends = _moment(start, "from", zone), _moment(end, "to", zone)
    if ends <= begins:
        raise UsageQueryError("to must be later than from")
    if (2 * begins - ends if compare else begins) < _EARLIEST or ends > _LATEST:
        raise UsageQueryError(
            "from and to must lie between 1970 and 9999, and with compare the period before too"
        )
    length, shift = STEPS[step] * _SECOND, utc_offset * 60 * _SECOND
    steps = -(-(ends + shift) // length) - (begins + shift) // length
    if steps > MAX_STEPS:
        raise UsageQueryError(f"the period holds more than {MAX_STEPS} steps of one {step}")
    grouped = _dimensions(group_by, "group_by")
    if len(grouped) > MAX_GROUPS:
        raise UsageQueryError(f"group_by takes at most {MAX_GROUPS} dimensions")
    admitted: dict[str, set[Value]] = {}
    for dimension, values in (filters or {}).items():
        _dimensions([dimension], "a filter")
        admitted[dimension] = _admitted(values, dimension)
    for dimension in _dimensions(none, "none"):
        admitted.setdefault(dimension, set()).add(None)
    return UsageQuery(
        start=begins,
        end=ends,
        step=step,
        utc_offset=utc_offset,
        group_by=tuple(grouped),
        filters={dimension: frozenset(values) for dimension, values in admitted.items()},
        compare=compare,
    )


# -- the pass ------------------------------------------------------------------


@dataclass
class _Tally:
    """What the parts of some stretches add up to, in whole units."""

    milliseconds: int = 0
    estimated: int = 0
    #: By kind, in `TOKEN_KINDS` order; `None` while no part reported that kind.
    tokens: list[int | None] = field(default_factory=lambda: [None] * _TOKENS)
    #: Millionths of a dollar; `None` while no part had a price.
    micro_usd: int | None = None
    unpriced: int = 0

    def add(self, part: _Part) -> None:
        self.milliseconds += part.milliseconds
        self.estimated += part.estimated
        for index, count in enumerate(part.tokens):
            if count is not None:
                held = self.tokens[index]
                self.tokens[index] = count if held is None else held + count
        if part.micro_usd is not None:
            self.micro_usd = (self.micro_usd or 0) + part.micro_usd
        self.unpriced += part.unpriced

    def measures(self) -> dict:
        return {
            "agent_seconds": self.milliseconds / _MILLISECOND,
            "estimated_seconds": self.estimated / _MILLISECOND,
            "quality": item_usage.quality(self.milliseconds - self.estimated, self.estimated),
            "tokens": {
                kind: self.tokens[index] for index, (kind, _) in enumerate(item_usage.TOKEN_KINDS)
            },
            "estimated_api_cost_usd": (
                None if self.micro_usd is None else self.micro_usd / _SECOND
            ),
            "unpriced_tokens": self.unpriced,
        }


@dataclass(frozen=True)
class _Part:
    """What one stretch spends between two moments, in whole units."""

    milliseconds: int
    estimated: int
    tokens: Sequence[int | None]
    micro_usd: int | None
    unpriced: int


def _bounds(request: UsageQuery) -> tuple[list[int], int]:
    """Every moment the stretches are cut at, and which interval is the period's first step.

    With a comparison the interval before the period's first is the preceding period
    of equal length, read whole.
    """

    length, shift = STEPS[request.step] * _SECOND, request.utc_offset * 60 * _SECOND
    edges = [request.start]
    edge = ((request.start + shift) // length + 1) * length - shift
    while edge < request.end:
        edges.append(edge)
        edge += length
    edges.append(request.end)
    if not request.compare:
        return edges, 0
    return [2 * request.start - request.end, *edges], 1


def _intervals(started: int, ended: int, bounds: Sequence[int]) -> range:
    """The intervals a stretch spends time in; one with no length, the one holding it."""

    last = len(bounds) - 1
    first = max(bisect.bisect_right(bounds, started) - 1, 0)
    if ended == started:
        return range(first, first + 1) if bounds[0] <= started < bounds[-1] else range(0)
    return range(first, min(bisect.bisect_left(bounds, ended), last))


def _spent(total: int, moment: int, started: int, ended: int) -> int:
    """How much of a stretch's whole count it has spent by this moment, rounded half up.

    Exact: the share of its time is a ratio of whole microseconds, and the rounding is
    done on integers. A stretch with no length has spent nothing up to its moment and
    everything after it.
    """

    if moment <= started:
        return 0
    if moment >= ended:
        return total
    length = ended - started
    return (2 * total * (moment - started) + length) // (2 * length)


def _whole(value: float) -> int:
    """A stored figure in whole units, rounded half up once per stretch."""

    return math.floor(value + 0.5)


def _parts(row: Sequence, bounds: Sequence[int]) -> list[tuple[int, _Part]]:
    """What a stretch spends in each interval it falls in."""

    started, ended = _stored(str(row[_STARTED])), _stored(str(row[_ENDED]))
    milliseconds = _whole(float(row[_SECONDS]) * _MILLISECOND)
    estimated = milliseconds if row[_QUALITY] == "estimated" else 0
    cost = row[_COST]
    micro_usd = None if cost is None else _whole(float(cost) * _SECOND)
    tokens: list[int | None] = [
        None if count is None else int(count) for count in row[_FIRST_TOKEN:_ORGANIZATION]
    ]
    totals = [milliseconds, estimated, micro_usd, *tokens]
    parts = []
    for interval in _intervals(started, ended, bounds):
        low, high = bounds[interval], bounds[interval + 1]
        if low <= started and ended <= high:
            share: list[int | None] = list(totals)
        else:
            share = [
                None
                if total is None
                else _spent(total, high, started, ended) - _spent(total, low, started, ended)
                for total in totals
            ]
        spent_tokens = share[3:]
        parts.append(
            (
                interval,
                _Part(
                    milliseconds=int(share[0] or 0),
                    estimated=int(share[1] or 0),
                    tokens=spent_tokens,
                    micro_usd=share[2],
                    unpriced=(
                        0
                        if micro_usd is not None
                        else sum(int(spent_tokens[i] or 0) for i in _PRICED)
                    ),
                ),
            )
        )
    return parts


def _stored(text: str) -> int:
    """A moment as the usage rows store it, in microseconds since the epoch."""

    return _micro(dt.datetime.fromisoformat(text))


def _stamp(micro: int, *, up: bool) -> str:
    """A moment in the stored form, to the millisecond, rounded the way that widens a range."""

    milliseconds = -(-micro // _MILLISECOND) if up else micro // _MILLISECOND
    moment = _EPOCH + dt.timedelta(milliseconds=milliseconds)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class _Window:
    """What one period adds up to, in total and by group."""

    total: _Tally = field(default_factory=_Tally)
    groups: dict[tuple[Value, ...], _Tally] = field(default_factory=dict)
    unpriced_models: set[str] = field(default_factory=set)


def _session_projects(
    conn: sqlite3.Connection, sessions: Iterable[str], projects: Sequence[Mapping]
) -> dict[str, str | None]:
    """The project whose root holds each session's working directory, by session id."""

    return {
        str(row["id"]): project_registry.project_holding(
            str(row["cwd"] or row["opened_folder"] or ""), projects
        )
        for row in conn.execute(
            "SELECT id, cwd, opened_folder FROM sessions WHERE id IN (SELECT value FROM json_each(?))",
            (json.dumps(sorted(set(sessions))),),
        )
    }


def _readers(
    conn: sqlite3.Connection, rows: Sequence[Sequence], needed: set[str], projects: Sequence
) -> dict[str, Callable[[Sequence], Value]]:
    """How each needed dimension's value is read off a row."""

    readers: dict[str, Callable[[Sequence], Value]] = {}
    for dimension in needed:
        if dimension in _COLUMN_OF:
            readers[dimension] = operator.itemgetter(_COLUMN_OF[dimension])
    if LAUNCH_CLASS in needed:
        readers[LAUNCH_CLASS] = _launch_class
    if PROJECT in needed:
        held = _session_projects(
            conn, (row[_SESSION] for row in rows if row[_ITEM] is None), projects
        )

        def project(row: Sequence) -> Value:
            if row[_ITEM] is not None:
                return row[_ITEM_PROJECT]
            return held.get(row[_SESSION])

        readers[PROJECT] = project
    return readers


def _launch_class(row: Sequence) -> Value:
    """How the run was launched: none for a session's own run, unknown for a subagent's
    run that does not say."""

    if row[_AGENT] == "":
        return None
    found = row[_LAUNCH]
    return UNKNOWN if found is None else found


# -- the answer ----------------------------------------------------------------

#: What a value of each labelled dimension carries beside its id when nothing names it.
_UNNAMED: dict[str, dict] = {
    WORK_ITEM: {"reference": None, "title": None},
    PROJECT: {"name": None},
    EXECUTOR: {"family": "", "opened_in": "", "opened_host": ""},
}


def _labels(
    conn: sqlite3.Connection, dimension: str, ids: set[str], projects: Sequence[Mapping]
) -> dict[str, dict]:
    """What a person already sees for each of these values: an item's number and title,
    a project's name, where a session was opened. Nothing that changes while it is read,
    so two reads of the same rows give the same answer."""

    if dimension == WORK_ITEM:
        return item_usage.item_names(conn, ids)
    if dimension == PROJECT:
        return {
            str(project["project_id"]): {"name": project["display_name"]}
            for project in projects
            if project["project_id"] in ids
        }
    if dimension == EXECUTOR:
        return {
            session: {name: executor[name] for name in _UNNAMED[EXECUTOR]}
            for session, executor in executors.session_executors(conn, sorted(ids)).items()
        }
    return {}


class _Namer:
    """Turns a group's raw values into the objects the answer carries."""

    def __init__(
        self,
        conn: sqlite3.Connection,
        group_by: Sequence[str],
        keys: Iterable[tuple[Value, ...]],
        projects: Sequence[Mapping],
    ) -> None:
        self.group_by = group_by
        found: list[set[str]] = [set() for _ in group_by]
        for key in keys:
            for index, value in enumerate(key):
                if isinstance(value, str):
                    found[index].add(value)
        self.labels = [
            _labels(conn, dimension, ids, projects) if ids else {}
            for dimension, ids in zip(group_by, found, strict=True)
        ]

    def value(self, index: int, value: Value) -> dict:
        dimension = self.group_by[index]
        named = value if isinstance(value, str) else None
        return {
            "id": named,
            # Work on no item, or a session's own launch class, is a group of its own.
            "unknown": value is UNKNOWN or (value is None and dimension not in _NONE_IS_A_VALUE),
            **_UNNAMED.get(dimension, {}),
            **(self.labels[index].get(named, {}) if named is not None else {}),
        }

    def group(self, key: tuple[Value, ...]) -> dict:
        return {self.group_by[index]: self.value(index, value) for index, value in enumerate(key)}


def _order(entry: tuple[tuple[Value, ...], _Tally]) -> tuple:
    """The most time first, then the most cost, then by value with none and unknown last."""

    key, tally = entry
    return (
        -tally.milliseconds,
        -(tally.micro_usd or 0),
        tuple(
            (not isinstance(value, str), value is UNKNOWN, value if isinstance(value, str) else "")
            for value in key
        ),
    )


def _rows(window: _Window, namer: _Namer) -> list[dict]:
    return [
        {"group": namer.group(key), **tally.measures()}
        for key, tally in sorted(window.groups.items(), key=_order)
    ]


def _total(window: _Window) -> dict:
    return {**window.total.measures(), "unpriced_models": sorted(window.unpriced_models)}


def read(conn: sqlite3.Connection, request: UsageQuery) -> dict:
    """What agent work spent in the period, in total, by group and by step, in one pass."""

    bounds, first = _bounds(request)
    cursor = conn.cursor()
    cursor.row_factory = None
    # Stored to the millisecond: rounded outward, the range holds every stretch that can
    # spend time inside, and `_parts` decides exactly.
    rows = cursor.execute(
        SEGMENTS, (_stamp(bounds[-1], up=True), _stamp(bounds[0], up=False))
    ).fetchall()
    needed = {*request.group_by, *request.filters}
    projects = project_registry.read_registry()["projects"] if PROJECT in needed else []
    readers = _readers(conn, rows, needed, projects)
    grouping = [readers[dimension] for dimension in request.group_by]
    filters = [(readers[dimension], admitted) for dimension, admitted in request.filters.items()]
    main, earlier = _Window(), _Window()
    steps = [_Tally() for _ in range(len(bounds) - 1 - first)]
    by_step: list[dict[Value, _Tally]] = [{} for _ in steps]
    for row in rows:
        if not all(reader(row) in admitted for reader, admitted in filters):
            continue
        parts = _parts(row, bounds)
        if not parts:
            continue
        key = tuple(reader(row) for reader in grouping)
        unpriced_model = (
            row[_MODEL]
            if row[_COST] is None
            and row[_MODEL] is not None
            and any(row[_FIRST_TOKEN:_ORGANIZATION])
            else None
        )
        for interval, part in parts:
            window = earlier if interval < first else main
            window.total.add(part)
            window.groups.setdefault(key, _Tally()).add(part)
            if unpriced_model is not None:
                window.unpriced_models.add(unpriced_model)
            if interval >= first:
                steps[interval - first].add(part)
                if key:
                    by_step[interval - first].setdefault(key[0], _Tally()).add(part)
    namer = _Namer(conn, request.group_by, [*main.groups, *earlier.groups], projects)
    zone = dt.timezone(dt.timedelta(minutes=request.utc_offset))

    def at(moment: int) -> str:
        return _at(moment, zone)

    last = conn.execute("SELECT MAX(last_at) FROM usage_runs").fetchone()[0]
    return {
        "period": {
            "from": at(request.start),
            "to": at(request.end),
            "step": request.step,
            "utc_offset": request.utc_offset,
        },
        "group_by": list(request.group_by),
        "cost_basis": item_usage.COST_BASIS,
        "last_event_at": last,
        "total": _total(main),
        "rows": _rows(main, namer),
        "series": [
            {
                "start": at(bounds[first + index]),
                "end": at(bounds[first + index + 1]),
                **tally.measures(),
                "groups": [
                    {"group": {request.group_by[0]: namer.value(0, value)}, **group.measures()}
                    for (value,), group in sorted(
                        (((value,), group) for value, group in by_step[index].items()), key=_order
                    )
                ],
            }
            for index, tally in enumerate(steps)
        ],
        "comparison": (
            {
                "period": {"from": at(bounds[0]), "to": at(bounds[1])},
                "total": _total(earlier),
                "rows": _rows(earlier, namer),
            }
            if request.compare
            else None
        ),
    }


__all__ = [
    "DIMENSIONS",
    "MAX_GROUPS",
    "MAX_STEPS",
    "SEGMENTS",
    "STEPS",
    "UsageQuery",
    "UsageQueryError",
    "query",
    "read",
]
