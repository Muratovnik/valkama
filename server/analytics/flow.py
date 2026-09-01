"""What the selected work items add up to: lanes, flow, throughput, KPIs.

Each family is its own function over exactly the rows it reads, so one KPI can
be checked without reading the other six. Only a known reconstructed state may
contribute to a flow or KPI count: an item whose state could not be
reconstructed stays in inventory and in history coverage, and never lands in
backlog.
"""

from __future__ import annotations

import itertools
from collections import Counter, defaultdict
from collections.abc import Mapping
from dataclasses import dataclass

from .reading import SpaceReading, Vocabulary
from .scope import Scope
from .selection import Selection
from .timeline import _as_seconds, _event_target, coverage_rollup, iso_time, parse_time


@dataclass(frozen=True)
class LaneTotals:
    """One item's contribution to the per-state time, visits and coverage."""

    durations: dict[str, list[int]]
    visits: Counter[str]
    coverage: dict[str, Counter[str]]


@dataclass(frozen=True)
class HistoryTotals:
    """What one selection of work items adds up to, per family."""

    durations: dict[str, list[int]]
    visits: Counter[str]
    state_coverage: dict[str, Counter[str]]
    throughput: Counter[str]
    agents: Counter[str]
    cycle_values: list[int]
    reopened: int


def _lane_totals(history: Mapping[str, object], vocabulary: Vocabulary, scope: Scope) -> LaneTotals:
    """One item's time in each state, clipped to the window.

    A segment is measured only where it overlaps the window, and only when its
    end is known or its quality says the reconstruction stands behind it. An
    item whose history did not reach a declared state at all still reports
    unknown coverage in every lane, so a chart cannot read incompleteness as
    absence.
    """

    durations: dict[str, list[int]] = defaultdict(list)
    visits: Counter[str] = Counter()
    coverage: dict[str, Counter[str]] = defaultdict(Counter)
    overlapping_segments: list[Mapping[str, object]] = []
    for segment in history["segments"]:
        lane = segment.get("status")
        if lane not in vocabulary.declared:
            continue
        seg_start = parse_time(segment.get("start"))
        raw_seg_end = parse_time(segment.get("end"))
        seg_end = raw_seg_end or scope.as_of
        overlaps = scope.unbounded or (
            seg_start is not None and seg_end > scope.range_start and seg_start < scope.range_end
        )
        if not overlaps:
            continue
        overlapping_segments.append(segment)
        clipped_start = max(seg_start, scope.range_start) if seg_start is not None else None
        clipped_end = min(seg_end, scope.range_end)
        quality = str(segment.get("quality") or "unknown")
        clipped_duration = (
            _as_seconds(clipped_start, clipped_end)
            if raw_seg_end is not None or quality != "unknown"
            else None
        )
        if clipped_duration is not None:
            durations[lane].append(clipped_duration)
        visits[lane] += 1
        if history["coverage"] == "partial" and quality != "unknown":
            quality = "partial"
        coverage[lane][quality] += 1
    if history["coverage"] in ("partial", "unknown") and not any(
        segment.get("status") in vocabulary.declared for segment in overlapping_segments
    ):
        for lane in vocabulary.declared:
            coverage[lane]["unknown"] += 1
    return LaneTotals(durations=dict(durations), visits=visits, coverage=dict(coverage))


def _event_totals(
    events: list[dict], vocabulary: Vocabulary, scope: Scope
) -> tuple[Counter[str], Counter[str]]:
    """Who acted on one item inside the window, and what that closed.

    Every authored event counts towards the agent leaderboard; only a
    transition into a closing state counts towards throughput, on its own day.
    """

    agents: Counter[str] = Counter()
    throughput: Counter[str] = Counter()
    for event in events:
        stamp = parse_time(event.get("created_at"))
        if not scope.admits(stamp):
            continue
        if event.get("author"):
            agents[str(event["author"])] += 1
        target = _event_target(event, vocabulary.states)
        if (
            event.get("action") == "transitioned"
            and target in vocabulary.closing
            and stamp is not None
        ):
            throughput[stamp.date().isoformat()] += 1
    return agents, throughput


def _cycle_seconds(
    history: Mapping[str, object], vocabulary: Vocabulary, scope: Scope
) -> int | None:
    """One item's cycle time, counted only when both of its ends are visible.

    The first active segment and the first closing one both have to fall inside
    the window: a cycle measured from an instant the window excluded would be a
    number the reader cannot check.
    """

    cycle = history.get("cycle_seconds")
    first_dev = next(
        (
            segment
            for segment in history["segments"]
            if vocabulary.categories.get(segment.get("status")) == "active"
        ),
        None,
    )
    first_done = next(
        (segment for segment in history["segments"] if segment.get("status") in vocabulary.closing),
        None,
    )
    if cycle is None or not first_dev or not first_done:
        return None
    dev_stamp = parse_time(first_dev.get("start"))
    done_stamp = parse_time(first_done.get("start"))
    if scope.admits(dev_stamp) and scope.admits(done_stamp):
        return cycle
    return None


def _reopenings(history: Mapping[str, object], vocabulary: Vocabulary, scope: Scope) -> int:
    """How many times one item left a closing state again inside the window."""

    return sum(
        1
        for previous, current_segment in itertools.pairwise(history["segments"])
        if previous.get("status") in vocabulary.closing
        and current_segment.get("status") not in ({None} | vocabulary.closing)
        and scope.admits(parse_time(current_segment.get("start")))
    )


def totals(selection: Selection, reading: SpaceReading, scope: Scope) -> HistoryTotals:
    """Walk the selected items once, merging each family's own contribution."""

    vocabulary = reading.vocabulary
    durations: dict[str, list[int]] = defaultdict(list)
    visits: Counter[str] = Counter()
    state_coverage: dict[str, Counter[str]] = {name: Counter() for name in vocabulary.declared}
    throughput: Counter[str] = Counter()
    agents: Counter[str] = Counter()
    cycle_values: list[int] = []
    reopened = 0
    for item in selection.work_items:
        history = item["status_history"]
        lanes = _lane_totals(history, vocabulary, scope)
        for lane, values in lanes.durations.items():
            durations[lane].extend(values)
        visits.update(lanes.visits)
        for lane, counts in lanes.coverage.items():
            state_coverage[lane].update(counts)
        item_agents, item_throughput = _event_totals(
            reading.events_by_item.get(reading.item_ids[item["id"]], []), vocabulary, scope
        )
        agents.update(item_agents)
        throughput.update(item_throughput)
        cycle = _cycle_seconds(history, vocabulary, scope)
        if cycle is not None:
            cycle_values.append(cycle)
        reopened += _reopenings(history, vocabulary, scope)
    return HistoryTotals(
        durations=dict(durations),
        visits=visits,
        state_coverage=state_coverage,
        throughput=throughput,
        agents=agents,
        cycle_values=cycle_values,
        reopened=reopened,
    )


def status_time(vocabulary: Vocabulary, history: HistoryTotals) -> dict:
    """Per-state time and visits, each with how confident that figure is.

    A visit count is withheld rather than shown as zero when the coverage for
    that lane is partial or unknown: nothing was observed there, and a zero
    would be read as an observation.
    """

    answer = {}
    for lane in vocabulary.declared:
        counts = history.state_coverage[lane]
        lane_quality = coverage_rollup(
            quality
            for quality in ("confirmed", "inferred", "partial", "unknown")
            for _ in range(counts.get(quality, 0))
        )
        lane_visits = history.visits.get(lane, 0)
        answer[lane] = {
            "seconds": sum(history.durations.get(lane, []))
            if history.durations.get(lane)
            else None,
            "visits": lane_visits
            if lane_visits or lane_quality not in ("partial", "unknown")
            else None,
            "observed_cards": len(history.durations.get(lane, [])),
            "coverage": lane_quality,
            "coverage_counts": {
                key: counts.get(key, 0) for key in ("confirmed", "inferred", "partial", "unknown")
            },
        }
    return answer


def non_containers(work_items: list[dict]) -> list[dict]:
    """The selected items that are work rather than a place to put work.

    A container is not work. Being somebody's parent is what makes an item
    one, which is a fact about the data rather than about a declared kind.
    """

    return [
        item
        for item in work_items
        if not any(other["parent_id"] == item["id"] for other in work_items)
    ]


def flow_counts(items: list[dict], vocabulary: Vocabulary) -> dict:
    """How many of the items sit in each declared state, plus the unknown ones."""

    current = Counter(
        item["status_history"]["current_status"]
        if item["status_history"]["current_status"] in vocabulary.declared
        else "unknown"
        for item in items
    )
    return {
        **{name: current.get(name, 0) for name in vocabulary.declared},
        "unknown": current.get("unknown", 0),
    }


def _by_category(items: list[dict], categories: dict[str, str], category: str) -> int:
    """How many items currently sit in a state of one category."""

    return sum(
        1
        for item in items
        if categories.get(item["status_history"].get("current_status")) == category
    )


def kpis(items: list[dict], vocabulary: Vocabulary, history: HistoryTotals) -> dict:
    """The headline numbers, over the items that are work."""

    return {
        "inventory": len(items),
        # Counted by category rather than by state name: the Board era
        # compared against the six lane names, so a space that renamed a
        # lane silently reported zero completed work.
        "completed": _by_category(items, vocabulary.categories, "completed"),
        "cycle_seconds": round(sum(history.cycle_values) / len(history.cycle_values))
        if history.cycle_values
        else None,
        "cycle_observed": len(history.cycle_values),
        "blocked": _by_category(items, vocabulary.categories, "blocked"),
        "reopened": history.reopened,
        "throughput": sum(history.throughput.values()) if history.throughput else None,
        "unknown_status": sum(
            1 for item in items if item["status_history"].get("current_status") is None
        ),
    }


def longest_open_rows(items: list[dict], vocabulary: Vocabulary) -> list[dict]:
    """The ten open items that have sat in their current state longest.

    An item whose current segment could not be measured sorts last rather than
    first: an unmeasured wait is not evidence of a short one.
    """

    open_items = [
        item
        for item in items
        if item["status_history"].get("current_status") not in vocabulary.closing
    ]
    longest = sorted(
        open_items,
        key=lambda item: (
            item["status_history"].get("current_seconds") is None,
            -(item["status_history"].get("current_seconds") or 0),
        ),
    )[:10]
    return [
        {
            "id": item["id"],
            "title": item["title"],
            "column": item["column"],
            # The row carries its state's category as well as its key, so a
            # reader can tone the state without a table of state names.
            "state_category": vocabulary.categories.get(item["column"], "backlog"),
            "seconds": item["status_history"].get("current_seconds"),
            "current_segment_seconds": item["status_history"].get("current_seconds"),
            "quality": item["status_history"].get("coverage", "unknown"),
            "lower_bound": item["status_history"].get("lower_bound", False),
        }
        for item in longest
    ]


def history_coverage(work_items: list[dict], scope: Scope) -> dict:
    """How much of the selected lifecycle history was observed, and over what."""

    return {
        "overall": coverage_rollup(item["status_history"]["coverage"] for item in work_items),
        "states": dict(Counter(item["status_history"]["coverage"] for item in work_items)),
        "work_items": len(work_items),
        "intervals": sum(len(item["status_history"]["segments"]) for item in work_items),
        "as_of": iso_time(scope.as_of),
    }
