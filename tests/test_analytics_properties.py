"""What the Analytics read must give for any stretches of work, checked against a reference.

The reference here is written apart from the read: it cuts a period at the caller's
midnights or hours with `datetime`, and shares each stretch out with `Fraction`, from
the stretches the test wrote rather than from anything the read answered. The rule it
holds the read to is the contract's: what a stretch has spent by a moment is its whole
count times the share of its time before that moment, rounded half up, and what it
spends between two moments is the difference.

Each property is a function made inside its test, so every run builds a new one: one
Hypothesis test shared by every instance unittest makes of the case fails its
`differing_executors` health check the second time the case runs in one process.
"""

from __future__ import annotations

import datetime as dt
import itertools
import math
from collections.abc import Iterable, Mapping
from fractions import Fraction

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from server.analytics import usage
from server.planning import usage as item_usage
from tests.analytics_fixtures import DAY, START, UsageStore, day
from tests.property_settings import use_gate_profile

use_gate_profile()

KINDS = [kind for kind, _ in item_usage.TOKEN_KINDS]
PRICED = [kind for kind, column in item_usage.TOKEN_KINDS if column in item_usage.PRICED_COLUMNS]
GROUPINGS = [
    names
    for size in (0, 1, 2)
    for names in itertools.permutations(usage.DIMENSIONS, size)
    if size < 2 or names[0] < names[1]
]
#: Each agent's run is launched one way, so a stretch's launch class follows its agent.
LAUNCH = {"": None, "worker": "interactive"}
EXAMPLES = settings(
    max_examples=30,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)

STRETCHES = st.lists(
    st.fixed_dictionaries(
        {
            "session": st.sampled_from(["s-1", "s-2", "s-3"]),
            "agent": st.sampled_from(["", "worker"]),
            # Milliseconds after START, so the stored moment is exactly this one.
            "start": st.integers(min_value=-DAY * 1000, max_value=4 * DAY * 1000),
            "length": st.sampled_from([0, 1, 7, 59_999, 3_600_000, 5_400_001, 30 * 3_600_000]),
            "timed": st.booleans(),
            "on_item": st.booleans(),
            "model": st.sampled_from([None, "claude-opus-5-5", "claude-unknown-9"]),
            "tokens": st.tuples(
                *(st.one_of(st.none(), st.integers(min_value=0, max_value=999)) for _ in KINDS)
            ),
            # Millionths of a dollar.
            "cost": st.one_of(st.none(), st.integers(min_value=0, max_value=3_000_000)),
            "quality": st.sampled_from(["observed", "estimated"]),
            "organization": st.sampled_from([None, "org-a", "org-b"]),
            "effort": st.sampled_from([None, "high"]),
            "environment": st.sampled_from([None, "local"]),
        }
    ),
    max_size=10,
)


def at(local_day: str, offset: int) -> Fraction:
    """Seconds after START of the caller's midnight on this day."""

    zone = dt.timezone(dt.timedelta(minutes=offset))
    moment = dt.datetime.combine(dt.date.fromisoformat(local_day), dt.time(), zone)
    return Fraction((moment - START) // dt.timedelta(microseconds=1), 1_000_000)


def cuts(begin: Fraction, end: Fraction, step: str, offset: int) -> list[Fraction]:
    """The period's edges and every one of the caller's full hours or midnights inside it."""

    zone = dt.timezone(dt.timedelta(minutes=offset))
    moment = (START + dt.timedelta(seconds=float(begin))).astimezone(zone)
    if step == "day":
        moment = moment.replace(hour=0, minute=0, second=0, microsecond=0) + dt.timedelta(days=1)
    else:
        moment = moment.replace(minute=0, second=0, microsecond=0) + dt.timedelta(hours=1)
    found = [begin]
    while (edge := Fraction((moment - START) // dt.timedelta(microseconds=1), 1_000_000)) < end:
        found.append(edge)
        moment += dt.timedelta(days=1) if step == "day" else dt.timedelta(hours=1)
    return [*found, end]


def spent(total: int, moment: Fraction, stretch: Mapping) -> int:
    """What a stretch has spent of `total` by this moment."""

    start = Fraction(stretch["start"], 1000)
    length = Fraction(stretch["length"], 1000)
    share = (
        (Fraction(0) if moment <= start else Fraction(1))
        if length == 0
        else min(max((moment - start) / length, Fraction(0)), Fraction(1))
    )
    return math.floor(total * share + Fraction(1, 2))


def falls_in(stretch: Mapping, low: Fraction, high: Fraction) -> bool:
    start = Fraction(stretch["start"], 1000)
    end = start + Fraction(stretch["length"], 1000)
    return low <= start < high if start == end else start < high and end > low


class Figures:
    """The units a measure block is published in: milliseconds, micro-dollars, tokens."""

    def __init__(self) -> None:
        self.milliseconds = 0
        self.estimated = 0
        self.micro_usd: int | None = None
        self.tokens: dict[str, int | None] = dict.fromkeys(KINDS)
        self.unpriced = 0

    @classmethod
    def of(cls, measures: Mapping) -> Figures:
        found = cls()
        found.milliseconds = round(measures["agent_seconds"] * 1000)
        found.estimated = round(measures["estimated_seconds"] * 1000)
        cost = measures["estimated_api_cost_usd"]
        found.micro_usd = None if cost is None else round(cost * 1_000_000)
        found.tokens = dict(measures["tokens"])
        found.unpriced = measures["unpriced_tokens"]
        return found

    @classmethod
    def summed(cls, parts: Iterable[Figures]) -> Figures:
        found = cls()
        for part in parts:
            found.join(part)
        return found

    def join(self, other: Figures) -> None:
        self.milliseconds += other.milliseconds
        self.estimated += other.estimated
        if other.micro_usd is not None:
            self.micro_usd = (self.micro_usd or 0) + other.micro_usd
        for kind, count in other.tokens.items():
            if count is not None:
                self.tokens[kind] = (self.tokens[kind] or 0) + count
        self.unpriced += other.unpriced

    def add(self, stretch: Mapping, low: Fraction, high: Fraction) -> None:
        def part(total: int) -> int:
            return spent(total, high, stretch) - spent(total, low, stretch)

        milliseconds = stretch["length"] if stretch["timed"] else 0
        self.milliseconds += part(milliseconds)
        if stretch["quality"] == "estimated":
            self.estimated += part(milliseconds)
        if stretch["cost"] is not None:
            self.micro_usd = (self.micro_usd or 0) + part(stretch["cost"])
        for kind, count in zip(KINDS, stretch["tokens"], strict=True):
            if count is not None:
                self.tokens[kind] = (self.tokens[kind] or 0) + part(count)
                if stretch["cost"] is None and kind in PRICED:
                    self.unpriced += part(count)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Figures) and vars(self) == vars(other)

    __hash__ = None  # type: ignore[assignment]

    def __repr__(self) -> str:
        return repr(vars(self))


class ReferenceTests(UsageStore):
    def setUp(self) -> None:
        super().setUp()
        _, self.item_id = self.item()
        self.session("s-1", self.beta_root / "src")
        self.session("s-2", self.root / "elsewhere")

    def write(self, stretches: list[dict]) -> None:
        self.conn.execute("DELETE FROM usage_segments")
        self.conn.execute("DELETE FROM usage_runs")
        self.runs.clear()
        for stretch in stretches:
            begin = stretch["start"] / 1000
            self.segment(
                stretch["session"],
                begin,
                begin + stretch["length"] / 1000,
                agent=stretch["agent"],
                seconds=stretch["length"] / 1000 if stretch["timed"] else 0.0,
                item=self.item_id if stretch["on_item"] else None,
                model=stretch["model"],
                tokens=stretch["tokens"],
                cost=None if stretch["cost"] is None else stretch["cost"] / 1_000_000,
                quality=stretch["quality"],
                organization=stretch["organization"],
                effort=stretch["effort"],
                environment=stretch["environment"],
                launch_class=LAUNCH[stretch["agent"]],
            )

    def value(self, stretch: Mapping, dimension: str) -> str | None:
        """A stretch's value in a dimension, from what the test wrote and the store it set up."""

        if dimension == "project":
            if stretch["on_item"]:
                return "alpha"
            return {"s-1": "beta"}.get(stretch["session"])
        return {
            "account": stretch["organization"],
            "work_item": self.item_id if stretch["on_item"] else None,
            "executor": stretch["session"],
            "launch_class": LAUNCH[stretch["agent"]],
            "model": stretch["model"],
            "effort": stretch["effort"],
            "environment": stretch["environment"],
        }[dimension]

    def test_every_figure_is_the_reference_share_of_its_stretches(self) -> None:
        @EXAMPLES
        @given(
            stretches=STRETCHES,
            offset=st.sampled_from([0, 180, -330, 840]),
            step=st.sampled_from(["hour", "day"]),
        )
        def check(stretches: list[dict], offset: int, step: str) -> None:
            self.write(stretches)
            begin, end = at(day(0), offset), at(day(3), offset)
            edges = cuts(begin, end, step, offset)
            for grouping in GROUPINGS:
                read = self.read(
                    **{"from": day(0), "to": day(3), "step": step, "utc_offset": str(offset)},
                    **({"group_by": ",".join(grouping)} if grouping else {}),
                )
                total, rows = Figures(), dict[tuple, Figures]()
                series = [Figures() for _ in edges[1:]]
                by_step: list[dict] = [{} for _ in edges[1:]]
                for stretch in stretches:
                    if not falls_in(stretch, begin, end):
                        continue
                    key = tuple(self.value(stretch, name) for name in grouping)
                    total.add(stretch, begin, end)
                    rows.setdefault(key, Figures()).add(stretch, begin, end)
                    for index, (low, high) in enumerate(itertools.pairwise(edges)):
                        if falls_in(stretch, low, high):
                            series[index].add(stretch, low, high)
                            if grouping:
                                by_step[index].setdefault(key[0], Figures()).add(stretch, low, high)
                where = f"{step} at {offset} by {grouping}"
                self.assertEqual(total, Figures.of(read["total"]), where)
                self.assertEqual(
                    rows,
                    {
                        tuple(row["group"][name]["id"] for name in grouping): Figures.of(row)
                        for row in read["rows"]
                    },
                    where,
                )
                self.assertEqual(series, [Figures.of(point) for point in read["series"]], where)
                if grouping:
                    self.assertEqual(
                        by_step,
                        [
                            {
                                group["group"][grouping[0]]["id"]: Figures.of(group)
                                for group in point["groups"]
                            }
                            for point in read["series"]
                        ],
                        where,
                    )

        check()

    def test_a_periods_figures_do_not_depend_on_how_it_is_cut(self) -> None:
        @EXAMPLES
        @given(stretches=STRETCHES, offset=st.sampled_from([0, 180, -330]))
        def check(stretches: list[dict], offset: int) -> None:
            self.write(stretches)

            def read(begin: int, end: int, **more: str) -> dict:
                return self.read(
                    **{"from": day(begin), "to": day(end), "utc_offset": str(offset)}, **more
                )

            whole = Figures.of(read(0, 2)["total"])
            self.assertEqual(whole, Figures.of(read(0, 2, step="hour")["total"]))
            compared = read(1, 2, compare="true", group_by="model,account")
            self.assertEqual(
                Figures.of(read(1, 2)["total"]), Figures.of(compared["total"]), "with compare"
            )
            # The day before, read beside the second day, is what reading it alone gives.
            self.assertEqual(
                Figures.of(read(0, 1)["total"]), Figures.of(compared["comparison"]["total"])
            )
            self.assertEqual(
                Figures.of(compared["comparison"]["total"]),
                Figures.summed(Figures.of(row) for row in compared["comparison"]["rows"]),
            )
            self.assertEqual(
                whole,
                Figures.summed([Figures.of(read(0, 1)["total"]), Figures.of(read(1, 2)["total"])]),
                "two adjacent days add up to the two",
            )
            hours = [Figures.of(read(0, 2, step="hour")["series"][index]) for index in range(48)]
            self.assertEqual(whole, Figures.summed(hours))

        check()
