"""What agent work spent in a period, cut by up to two of its dimensions.

The measures are the per-item and per-session reads' (`planning.usage`): seconds, tokens
by kind, the cost estimate with its `cost_basis`, `unpriced_tokens` and the quality of
the time. Of those reads' two times this one gives `agent_seconds`, the sum of the
stretches of work: two agents working one hour side by side spent two. Their union
(`elapsed_seconds` there) is not given, because it does not add up across groups or
steps, and every figure here does: the rows add up to the total, the steps of the series
to the total, and the groups of a step to the step. The whole store read over a period
that holds all of it is what the per-session reads add up to.

A stretch of work that crosses a step boundary or an edge of the period is split in
proportion to its time, and its tokens and cost with it. Tokens stay whole: each kind a
stretch reported is shared out by largest remainder, so its parts add up to it. A stretch
with no length lies where it starts.

A day is the caller's: the request carries its offset from UTC in minutes, and the server
reads no time-zone database. A period across a change of daylight saving time is cut at
one offset; a caller that minds asks for it in two.

| Dimension | Value | Read from |
| --- | --- | --- |
| `account` | the organization a stretch was billed to | the segment, as stored |
| `project` | the project of the item's planning space; with no item, the project whose root holds the session's working directory | the space, the session and the projects registry |
| `work_item` | the item a stretch is counted to, `null` for work on no item | the segment |
| `executor` | the session a card's holder opens: a subagent's work is its session's | `planning.executors` |
| `launch_class` | how the run was launched | the run |
| `model`, `effort`, `environment` | as the segment holds them | the segment |

A value the store does not hold is its own group, `unknown`; work on no item is its own
group too, and is not unknown. Nothing is collected here.
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
from ..telemetry import usage_ledger

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
MAX_GROUPS = 2
#: A hundred days by the hour, or six and a half years by the day.
MAX_STEPS = 2400
#: The furthest any zone is from UTC.
MAX_OFFSET_MINUTES = 14 * 60
MAX_FILTER_VALUES = 100
MAX_VALUE_LENGTH = 512

_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
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
_ITEM, _SESSION, _LAUNCH, _EFFORT, _ENVIRONMENT, _ITEM_PROJECT = range(
    _ORGANIZATION + 1, _ORGANIZATION + 7
)
#: The token columns stand in `TOKEN_KINDS` order.
SEGMENTS = (
    "SELECT s.started_at, s.ended_at, s.seconds, s.quality, s.estimated_api_cost_usd, s.model,"
    " s.input_tokens, s.cached_read_tokens, s.cache_write_5m_tokens, s.cache_write_1h_tokens,"
    " s.output_tokens, s.reasoning_tokens,"
    " s.organization, s.work_item_id, s.session_id, r.launch_class, s.effort, s.environment,"
    " p.project_id"
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
    LAUNCH_CLASS: _LAUNCH,
    MODEL: _MODEL,
    EFFORT: _EFFORT,
    ENVIRONMENT: _ENVIRONMENT,
}

Value = str | None


class UsageQueryError(ValueError):
    """A request this read cannot answer, saying what in it is wrong."""


@dataclass(frozen=True)
class UsageQuery:
    """One request, checked: the period as epoch seconds and what to cut it by."""

    start: float
    end: float
    step: str
    utc_offset: int
    group_by: tuple[str, ...] = ()
    #: The values each filtered dimension admits; `None` admits work with none.
    filters: Mapping[str, frozenset[Value]] = field(default_factory=dict)
    compare: bool = False


def _moment(text: str, name: str, zone: dt.tzinfo) -> float:
    """A date as the start of that day in the caller's zone, or a time with its own offset."""

    try:
        if _DATE.fullmatch(text):
            return dt.datetime.combine(dt.date.fromisoformat(text), dt.time(), zone).timestamp()
        moment = dt.datetime.fromisoformat(text)
    except ValueError as error:
        raise UsageQueryError(f"{name} must be a date or a time with its offset") from error
    if moment.tzinfo is None:
        raise UsageQueryError(f"{name} must be a date or a time with its offset")
    return moment.timestamp()


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
    length, shift = STEPS[step], utc_offset * 60
    steps = math.ceil((ends + shift) / length) - math.floor((begins + shift) / length)
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
    """What the parts of some stretches add up to."""

    seconds: float = 0.0
    estimated: float = 0.0
    #: By kind, in `TOKEN_KINDS` order; `None` while no part reported that kind.
    tokens: list[int | None] = field(default_factory=lambda: [None] * _TOKENS)
    cost: float | None = None
    unpriced: int = 0

    def add(self, part: _Part) -> None:
        self.seconds += part.seconds
        self.estimated += part.estimated
        for index, count in enumerate(part.tokens):
            if count is not None:
                held = self.tokens[index]
                self.tokens[index] = count if held is None else held + count
        if part.cost is not None:
            self.cost = part.cost if self.cost is None else self.cost + part.cost
        self.unpriced += part.unpriced

    def measures(self) -> dict:
        return {
            "agent_seconds": round(self.seconds, 3),
            "estimated_seconds": round(self.estimated, 3),
            "quality": item_usage.quality(self.seconds - self.estimated, self.estimated),
            "tokens": {
                kind: self.tokens[index] for index, (kind, _) in enumerate(item_usage.TOKEN_KINDS)
            },
            "estimated_api_cost_usd": None if self.cost is None else round(self.cost, 6),
            "unpriced_tokens": self.unpriced,
        }


@dataclass(frozen=True)
class _Part:
    """The share of one stretch that falls in one step."""

    seconds: float
    estimated: float
    tokens: Sequence[int | None]
    cost: float | None
    unpriced: int


def _bounds(request: UsageQuery) -> tuple[list[float], int]:
    """Every edge the stretches are cut at, and which interval is the period's first step.

    With a comparison the interval before the period's first is the preceding period
    of equal length, read whole.
    """

    length, shift = STEPS[request.step], request.utc_offset * 60
    edges = [request.start]
    edge = (math.floor((request.start + shift) / length) + 1) * length - shift
    while edge < request.end:
        edges.append(edge)
        edge += length
    edges.append(request.end)
    if not request.compare:
        return edges, 0
    return [2 * request.start - request.end, *edges], 1


def _shares(started: float, ended: float, bounds: Sequence[float]) -> list[tuple[int, float]]:
    """Which intervals a stretch falls in, with the share of its length in each."""

    last = len(bounds) - 1
    if ended <= started:
        index = bisect.bisect_right(bounds, started) - 1
        return [(index, 1.0)] if 0 <= index < last else []
    span = ended - started
    found = []
    for index in range(
        max(bisect.bisect_right(bounds, started) - 1, 0),
        min(bisect.bisect_left(bounds, ended), last),
    ):
        inside = min(ended, bounds[index + 1]) - max(started, bounds[index])
        if inside > 0:
            found.append((index, inside / span))
    return found


def _apportion(total: int, shares: Sequence[float]) -> list[int]:
    """A whole count shared out in these proportions by largest remainder.

    What the shares leave over lies outside the period and takes its part of the
    count too, so the parts inside are what lies inside.
    """

    exact = [total * share for share in shares]
    exact.append(total * max(0.0, 1.0 - math.fsum(shares)))
    whole = [math.floor(value) for value in exact]
    left = total - sum(whole)
    for index in sorted(range(len(exact)), key=lambda i: whole[i] - exact[i])[: max(left, 0)]:
        whole[index] += 1
    return whole[:-1]


def _parts(row: Sequence, shares: list[tuple[int, float]]) -> list[_Part]:
    seconds = float(row[_SECONDS])
    estimated = seconds if row[_QUALITY] == "estimated" else 0.0
    cost = row[_COST]
    counts: list[int | None] = list(row[_FIRST_TOKEN:_ORGANIZATION])
    if len(shares) == 1 and shares[0][1] == 1.0:
        split: list[list[int | None]] = [counts]
    else:
        fractions = [share for _, share in shares]
        by_kind = [
            [None] * len(shares) if count is None else _apportion(int(count), fractions)
            for count in counts
        ]
        split = [[kind[index] for kind in by_kind] for index in range(len(shares))]
    parts = []
    for (_, share), tokens in zip(shares, split, strict=True):
        parts.append(
            _Part(
                seconds=seconds * share,
                estimated=estimated * share,
                tokens=tokens,
                cost=None if cost is None else float(cost) * share,
                unpriced=0 if cost is not None else sum(int(tokens[i] or 0) for i in _PRICED),
            )
        )
    return parts


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
        if dimension != PROJECT:
            readers[dimension] = operator.itemgetter(_COLUMN_OF[dimension])
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


# -- the answer ----------------------------------------------------------------

#: What a value of each labelled dimension carries beside its id when nothing names it.
_UNNAMED: dict[str, dict] = {
    WORK_ITEM: {"reference": None, "title": None},
    PROJECT: {"name": None},
    EXECUTOR: {"family": "", "opened_in": "", "opened_host": "", "state": executors.NONE},
}


def _labels(
    conn: sqlite3.Connection, dimension: str, ids: set[str], projects: Sequence[Mapping]
) -> dict[str, dict]:
    """What a person already sees for each of these values: an item's number and title,
    a project's name, a session's place and state."""

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
                if value is not None:
                    found[index].add(value)
        self.labels = [
            _labels(conn, dimension, ids, projects) if ids else {}
            for dimension, ids in zip(group_by, found, strict=True)
        ]

    def value(self, index: int, value: Value) -> dict:
        dimension = self.group_by[index]
        return {
            "id": value,
            # Work on no item is a group of its own, not one the store cannot name.
            "unknown": value is None and dimension != WORK_ITEM,
            **_UNNAMED.get(dimension, {}),
            **(self.labels[index].get(value, {}) if value is not None else {}),
        }

    def group(self, key: tuple[Value, ...]) -> dict:
        return {self.group_by[index]: self.value(index, value) for index, value in enumerate(key)}


def _order(entry: tuple[tuple[Value, ...], _Tally]) -> tuple:
    """The most time first, then the most cost, then by value with the unknown last."""

    key, tally = entry
    return (
        -round(tally.seconds, 3),
        -(tally.cost or 0.0),
        tuple((value is None, value or "") for value in key),
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
    rows = cursor.execute(
        SEGMENTS, (usage_ledger.stamp(bounds[-1]), usage_ledger.stamp(bounds[0]))
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
        shares = _shares(
            usage_ledger.moment(str(row[_STARTED])), usage_ledger.moment(str(row[_ENDED])), bounds
        )
        if not shares:
            continue
        key = tuple(reader(row) for reader in grouping)
        unpriced_model = (
            row[_MODEL]
            if row[_COST] is None
            and row[_MODEL] is not None
            and any(row[_FIRST_TOKEN:_ORGANIZATION])
            else None
        )
        for (interval, _), part in zip(shares, _parts(row, shares), strict=True):
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

    def at(moment: float) -> str:
        return dt.datetime.fromtimestamp(moment, zone).isoformat()

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
