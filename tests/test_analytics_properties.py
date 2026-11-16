"""What the Analytics read must give for any stretches of work, checked against a reference.

The reference here is written apart from the read: it cuts a period at the caller's
midnights or hours with `datetime`, and shares each stretch out with `Fraction`, from
the stretches the test wrote rather than from anything the read answered. The rule it
holds the read to is the contract's: what a stretch has spent by a moment is its whole
count times the share of its time before that moment, rounded half up, and what it
spends between two moments is the difference.

A stretch's seat is held to a reference of its own, written from the seat rule as the
contract states it (`quota.seats`) over the samples the test wrote, in milliseconds
rather than the stored text the read compares.

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
from tests.analytics_fixtures import DAY, HOUR, START, UsageStore, day, stamp
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
#: Each agent's run is launched one way, so a stretch's launch class follows its agent:
#: a session's own run has none, and one subagent's run does not say.
LAUNCH = {"": None, "worker": "interactive", "helper": None}
EXAMPLES = settings(
    max_examples=30,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)

STRETCHES = st.lists(
    st.fixed_dictionaries(
        {
            "session": st.sampled_from(["s-1", "s-2", "s-3"]),
            "agent": st.sampled_from(["", "worker", "helper"]),
            # Milliseconds after START, so the stored moment is exactly this one.
            "start": st.integers(min_value=-DAY * 1000, max_value=4 * DAY * 1000),
            "length": st.sampled_from([0, 1, 7, 59_999, 3_600_000, 5_400_001, 30 * 3_600_000]),
            "timed": st.booleans(),
            "on_item": st.booleans(),
            "advisor": st.booleans(),
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
#: Seats whose weeks end inside the stretches' days or after them, as `week:<reset>`.
SEATS = ["week:2030-03-05T09:00Z", "week:2030-03-06T19:00Z", "week:2030-03-12T05:00Z"]
#: Quota samples: a session's, or an organization's poll with an account or not.
QUOTA = st.lists(
    st.fixed_dictionaries(
        {
            "who": st.sampled_from(["s-1", "s-2", "s-3", "org-a", "org-b"]),
            "at": st.integers(min_value=-8 * DAY * 1000, max_value=4 * DAY * 1000),
            "kind": st.sampled_from(["five_hour", "week"]),
            "seat": st.sampled_from(SEATS),
            # Milliseconds after the sample to its window's reset; none says only the seat.
            "resets": st.sampled_from([None, 1, 3_600_000, 18_000_000, 3 * DAY * 1000]),
            "account": st.sampled_from([None, "acct-1", "acct-2"]),
        }
    ),
    max_size=8,
)
#: The longest a sample's seat can hold: a week, and the five minutes its key is rounded by.
LONGEST_HOLD = (7 * DAY + 300) * 1000


def at(local_day: str, offset: int) -> Fraction:
    """Seconds after START of the caller's midnight on this day."""

    zone = dt.timezone(dt.timedelta(minutes=offset))
    moment = dt.datetime.combine(dt.date.fromisoformat(local_day), dt.time(), zone)
    return Fraction((moment - START) // dt.timedelta(microseconds=1), 1_000_000)


def cuts(begin: Fraction, end: Fraction, step: str, offset: int) -> list[Fraction]:
    """The period's edges and each of the caller's full minutes, hours or midnights inside it."""

    zone = dt.timezone(dt.timedelta(minutes=offset))
    moment = (START + dt.timedelta(seconds=float(begin))).astimezone(zone)
    if step == "day":
        length = dt.timedelta(days=1)
        moment = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    elif step == "hour":
        length = dt.timedelta(hours=1)
        moment = moment.replace(minute=0, second=0, microsecond=0)
    else:
        length = dt.timedelta(minutes=1)
        moment = moment.replace(second=0, microsecond=0)
    moment += length
    found = [begin]
    while (edge := Fraction((moment - START) // dt.timedelta(microseconds=1), 1_000_000)) < end:
        found.append(edge)
        moment += length
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


def week_end(seat: str) -> int:
    """Milliseconds after START of the reset a seat's key names."""

    moment = dt.datetime.fromisoformat(seat.removeprefix("week:").replace("Z", "+00:00"))
    return (moment - START) // dt.timedelta(milliseconds=1)


def seat_of(stretch: Mapping, stretches: list[dict], quota: list[dict]) -> tuple[str | None, bool]:
    """The seat value the contract gives a stretch, by the rule of `quota.seats` read anew.

    Of each feed, a session's or an organization's in one window, its latest sample at or
    before the stretch's end (and within the longest hold of its start) is its state. It
    counts while its window has not reset by the start, and when the feed's identity worked
    for the stretch's organization then: an organization's own, and a session's as its
    latest main-run stretch begun by the sample says. The stretch's own session's feeds come
    first; the most recent of those holding names the seat. The account is the naming
    sample's, or else the one account the organization's samples of that seat name.
    """

    organization = stretch["organization"]
    if organization is None:
        return None, True
    start, end = stretch["start"], stretch["start"] + stretch["length"]

    def worked_for(sample: Mapping) -> str | None:
        if sample["who"].startswith("org-"):
            return sample["who"]
        begun = [
            (other["start"], number)
            for number, other in enumerate(stretches)
            if other["session"] == sample["who"]
            and other["agent"] == ""
            and other["start"] <= sample["at"]
        ]
        return stretches[max(begun)[1]]["organization"] if begun else None

    def holds(sample: Mapping) -> bool:
        reset = week_end(sample["seat"])
        if sample["resets"] is not None:
            reset = min(reset, sample["at"] + sample["resets"])
        return reset > start and worked_for(sample) == organization

    latest: dict[tuple[str, str], tuple[int, Mapping]] = {}
    for number, sample in sorted(enumerate(quota), key=lambda pair: (pair[1]["at"], pair[0])):
        if start - LONGEST_HOLD <= sample["at"] <= end:
            latest[sample["who"], sample["kind"]] = (number, sample)
    own = [pair for (who, _), pair in latest.items() if who == stretch["session"]]
    others = [pair for (who, _), pair in latest.items() if who != stretch["session"]]
    for feeds in (own, others):
        holding = [pair for pair in feeds if holds(pair[1])]
        if holding:
            _, naming = max(holding, key=lambda pair: (pair[1]["at"], pair[0]))
            break
    else:
        return None, True
    accounts = {
        sample["account"]
        for sample in quota
        if sample["who"] == organization
        and sample["seat"] == naming["seat"]
        and sample["account"] is not None
    }
    account = naming["account"] if naming["who"].startswith("org-") else None
    if account is None and len(accounts) == 1:
        account = next(iter(accounts))
    return f"{organization}/{account or naming['seat']}", False


def group_of(value: Mapping) -> tuple[str | None, bool]:
    """A group's value as the answer gives it, `id` and `unknown`."""

    return value["id"], value["unknown"]


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
        _, self.item_id = self.item(projects=["alpha"])
        self.session("s-1", self.beta_root / "src")
        self.session("s-2", self.root / "elsewhere")

    def write(self, stretches: list[dict], quota: list[dict]) -> None:
        self.conn.execute("DELETE FROM usage_segments")
        self.conn.execute("DELETE FROM usage_runs")
        self.conn.execute("DELETE FROM quota_samples")
        self.runs.clear()
        self.stretches, self.quota = stretches, quota
        for sample in quota:
            session = None if sample["who"].startswith("org-") else sample["who"]
            self.quota_sample(
                sample["at"] / 1000,
                sample["seat"],
                session=session,
                organization=None if session else sample["who"],
                account=None if session else sample["account"],
                kind=sample["kind"],
                resets_at=None
                if sample["resets"] is None
                else stamp((sample["at"] + sample["resets"]) / 1000),
            )
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
                advisor=stretch["advisor"],
            )

    def value(self, stretch: Mapping, dimension: str) -> tuple[str | None, bool]:
        """A stretch's group in a dimension, as its `id` and whether it is unknown, from what
        the test wrote and the store it set up."""

        if dimension == "project":
            project = "alpha" if stretch["on_item"] else {"s-1": "beta"}.get(stretch["session"])
            return project, project is None
        if dimension == "work_item":
            # Work on no item is a group of its own.
            return (self.item_id if stretch["on_item"] else None), False
        if dimension == "launch_class":
            # A session's own run is launched by no one; a subagent's run may not say how.
            launch = LAUNCH[stretch["agent"]]
            return launch, launch is None and stretch["agent"] != ""
        if dimension == "role":
            # An adviser's segment is the adviser's in whichever run it is.
            if stretch["advisor"]:
                return "advisor", False
            return ("main" if stretch["agent"] == "" else "subagent"), False
        if dimension == "seat":
            return seat_of(stretch, self.stretches, self.quota)
        found = {
            "account": stretch["organization"],
            "executor": stretch["session"],
            "model": stretch["model"],
            "effort": stretch["effort"],
            "environment": stretch["environment"],
        }[dimension]
        return found, found is None

    def test_every_figure_is_the_reference_share_of_its_stretches(self) -> None:
        @EXAMPLES
        @given(
            stretches=STRETCHES,
            quota=QUOTA,
            offset=st.sampled_from([0, 180, -330, 840]),
            step=st.sampled_from(["minute", "hour", "day"]),
            early=st.integers(min_value=0, max_value=59_999),
        )
        def check(
            stretches: list[dict], quota: list[dict], offset: int, step: str, early: int
        ) -> None:
            self.write(stretches, quota)
            begin, end = at(day(0), offset), at(day(3), offset)
            if step == "minute":
                # Three days by the minute are more steps than a period may hold, and the
                # reference below would walk each: two hours, from the middle of a minute.
                begin = at(day(1), offset) + Fraction(early, 1000)
                end = begin + 2 * HOUR
            edges = cuts(begin, end, step, offset)
            period = {"from": stamp(float(begin)), "to": stamp(float(end))}
            for grouping in GROUPINGS:
                read = self.read(
                    **{**period, "step": step, "utc_offset": str(offset)},
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
                                by_step[index].setdefault(key, Figures()).add(stretch, low, high)
                where = f"{step} at {offset} by {grouping}"
                self.assertEqual(total, Figures.of(read["total"]), where)
                self.assertEqual(
                    rows,
                    {
                        tuple(group_of(row["group"][name]) for name in grouping): Figures.of(row)
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
                                tuple(
                                    group_of(group["group"][name]) for name in grouping
                                ): Figures.of(group)
                                for group in point["groups"]
                            }
                            for point in read["series"]
                        ],
                        where,
                    )

        check()

    def test_a_periods_figures_do_not_depend_on_how_it_is_cut(self) -> None:
        @EXAMPLES
        @given(stretches=STRETCHES, quota=QUOTA, offset=st.sampled_from([0, 180, -330]))
        def check(stretches: list[dict], quota: list[dict], offset: int) -> None:
            self.write(stretches, quota)

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
            # By seat beside the period before, each period's seats add up to its total.
            seated = read(1, 2, compare="true", group_by="seat")
            for part in (seated, seated["comparison"]):
                self.assertEqual(
                    Figures.of(part["total"]),
                    Figures.summed(Figures.of(row) for row in part["rows"]),
                    "by seat",
                )
            self.assertEqual(
                Figures.of(read(0, 1)["total"]), Figures.of(seated["comparison"]["total"])
            )
            self.assertEqual(
                whole,
                Figures.summed([Figures.of(read(0, 1)["total"]), Figures.of(read(1, 2)["total"])]),
                "two adjacent days add up to the two",
            )
            hours = [Figures.of(read(0, 2, step="hour")["series"][index]) for index in range(48)]
            self.assertEqual(whole, Figures.summed(hours))
            # A day by the minute: every hour is the sum of its sixty minutes.
            minutes = [Figures.of(point) for point in read(0, 1, step="minute")["series"]]
            self.assertEqual(
                hours[:24],
                [Figures.summed(minutes[hour * 60 : hour * 60 + 60]) for hour in range(24)],
            )

        check()
