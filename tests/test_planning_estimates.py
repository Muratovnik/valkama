"""The estimates: what open work has left, judged by done work like it, and the table.

Items are placed straight in SQL (`planning_tree.Tree`, through `VolumesCase`) and usage
rows are inserted on them: a row of `s` seconds holds `s` input tokens, a tenth as many
output tokens and costs a dollar for each thousand seconds, unless the case says
otherwise. Done work begins on the 6th, after usage was first counted on the 5th. Each
remainder expected is worked out by hand from the rule: the first rung of the ladder (the
task's project and kind sharing a label, then its project and kind, then its project)
holding five done tasks that spent more than the task has, and the mean of what they spent
beyond it, without the tenth that spent the most. The table is checked against the basis
selected here from the tables, described with the standard library. The registry binds
`app` to MAIN and `lib` to ALPHA.
"""

from __future__ import annotations

import json
import math
import statistics
from typing import Any

from tests.test_planning_goal_volumes import GoalCase
from tests.test_planning_volumes import _moment

#: When done work began: after usage was first counted to an item.
BEGUN = "2026-11-06T00:00:00Z"
TOKENS = ("input", "cached_read", "cache_write_5m", "cache_write_1h", "output", "reasoning")
NOTHING = dict.fromkeys(TOKENS, 0)
#: The kinds of token written anew.
ANEW = ("input_tokens", "cache_write_5m_tokens", "cache_write_1h_tokens", "output_tokens")


class EstimatesCase(GoalCase):
    def setUp(self) -> None:
        super().setUp()
        self.segments = 0

    def work(
        self, identity: str, seconds: float, *, cost: float | None = -1.0, cached: int | None = None
    ) -> None:
        """A usage row of `seconds` on the item, with input and output tokens and a cost by them."""

        self.segments += 1
        moment = f"2026-11-05T{self.segments // 60:02d}:{self.segments % 60:02d}:00.000Z"
        self.conn.execute(
            "INSERT INTO usage_segments(run_id, session_id, model, started_at, ended_at, seconds,"
            " work_item_id, input_tokens, cached_read_tokens, output_tokens,"
            " estimated_api_cost_usd, quality) VALUES (?, 's', 'model-a', ?, ?, ?, ?, ?, ?, ?, ?,"
            " 'observed')",
            (
                self.run,
                moment,
                moment,
                seconds,
                identity,
                int(seconds),
                cached,
                int(seconds) // 10,
                seconds / 1000 if cost == -1.0 else cost,
            ),
        )

    def item(
        self,
        name: str,
        *,
        state: str,
        space: str = "MAIN",
        projects: tuple[str, ...] = ("app",),
        kind: str = "task",
        labels: tuple[str, ...] = (),
        parent: str | None = None,
        begun: str = BEGUN,
    ) -> str:
        identity = self.place(space, name, kind=kind, state=state, projects=projects, parent=parent)
        self.conn.execute(
            "UPDATE work_items SET labels = ?, started_at = ?,"
            " accepted_at = CASE WHEN accepted_at IS NULL THEN NULL ELSE ? END"
            " WHERE work_item_id = ?",
            (json.dumps(labels), begun, BEGUN, identity),
        )
        return identity

    def done(self, name: str, *seconds: float, **fields: Any) -> str:
        """A done task that spent these rows."""

        identity = self.item(name, state="done", **fields)
        for part in seconds:
            self.work(identity, part)
        return identity

    def goal(self, name: str) -> str:
        identity = self.place("MAIN", name, kind="goal", state="container")
        self.conn.execute(
            "UPDATE work_items SET accepted_at = ? WHERE work_item_id = ?", (BEGUN, identity)
        )
        return identity

    def remaining(self, *goals: str) -> list[dict | None]:
        self.conn.commit()
        return [
            row["remaining"] for row in self.goal_volumes(*(self.ref(f"MAIN:{g}") for g in goals))
        ]


class RemainderTests(EstimatesCase):
    def test_the_remainder_is_what_longer_tasks_still_took(self) -> None:
        for index in range(1, 9):
            self.done(f"ui{index}", 100.0 * index, labels=("ui",))
        # Beside them, work of the same project and kind with no shared label, and a bug.
        for index in range(3):
            self.done(f"plain{index}", 2000.0)
        self.done("bug", 5000.0, kind="bug", labels=("ui",))
        self.goal("G")
        task = self.item("open", state="dev", labels=("ui", "api"), parent="G")
        # It read from the cache more than any done task did: that measure leaves nothing.
        self.work(task, 250.0, cached=1000)
        # Six tasks spent more than 250 s: 300 … 800 s, 50 … 550 s beyond it, 300 s on average.
        self.assertEqual(
            [
                {
                    "agent_seconds": 300.0,
                    "tokens": {**NOTHING, "input": 300, "output": 30},
                    "estimated_api_cost_usd": 0.3,
                    "basis": 6,
                    "estimated": 1,
                    "unestimated": 0,
                }
            ],
            self.remaining("G"),
        )

    def test_the_ladder_takes_the_first_five_that_took_longer(self) -> None:
        # (a) Its project and kind with its label: one shorter than it and four longer.
        for index, seconds in enumerate((50.0, 200.0, 300.0, 400.0, 500.0)):
            self.done(f"a-ui{index}", seconds, projects=("lib",), labels=("ui",))
        for index, seconds in enumerate((600.0, 700.0, 800.0)):
            self.done(f"a-plain{index}", seconds, projects=("lib",))
        for index in range(2):
            self.done(f"a-bug{index}", 1000.0, projects=("lib",), kind="bug")
        self.goal("A")
        self.work(self.item("a", state="dev", projects=("lib",), labels=("ui",), parent="A"), 100.0)
        # (b) Twenty longer than it, 10 … 200 s.
        for index in range(1, 21):
            self.done(f"b{index}", 10.0 * index, projects=("tool",), kind="bug", labels=("api",))
        self.goal("B")
        self.work(
            self.item(
                "b", state="review", projects=("tool",), kind="bug", labels=("api",), parent="B"
            ),
            5.0,
        )
        # (c) Longer than every done task it could be judged by.
        for index in range(1, 7):
            self.done(f"c{index}", 100.0 * index, projects=("kit",))
        self.goal("C")
        self.work(self.item("c", state="dev", projects=("kit",), parent="C"), 700.0)

        first, twenty, longest = self.remaining("A", "B", "C")
        assert first is not None and twenty is not None
        # The second rung: seven of its project and kind spent more than 100 s, 200 … 800 s.
        self.assertEqual(
            (400.0, 7, 1, 0),
            (first["agent_seconds"], first["basis"], first["estimated"], first["unestimated"]),
        )
        # The two with the most left, 200 and 190 s, are not counted: 10 … 180 s less 5 s.
        self.assertEqual(
            (90.0, 18, 1, 0),
            (twenty["agent_seconds"], twenty["basis"], twenty["estimated"], twenty["unestimated"]),
        )
        self.assertEqual(
            {
                "agent_seconds": 0.0,
                "tokens": NOTHING,
                "estimated_api_cost_usd": 0.0,
                "basis": 0,
                "estimated": 0,
                "unestimated": 1,
            },
            longest,
        )

    def test_the_basis_is_completed_fully_measured_work(self) -> None:
        for index in range(1, 6):
            self.done(f"d{index}", 100.0 * index)
        # Each of these would raise the estimate if it were judged by.
        self.work(self.item("cancelled", state="cancelled"), 10000.0)
        self.item("unspent", state="done")
        self.done("early", 10000.0, begun="2026-10-01T00:00:00Z")
        self.work(self.place("MAIN", "done goal", kind="goal", state="done"), 10000.0)
        self.goal("G")
        self.item("open", state="ready", parent="G")
        # Not begun: the five done tasks, 100 … 500 s, are what it has left on average.
        remaining = self.remaining("G")[0]
        assert remaining is not None
        self.assertEqual((300.0, 5), (remaining["agent_seconds"], remaining["basis"]))
        estimates = self.volumes("MAIN")["estimates"]
        self.assertEqual((5, 5), (estimates["basis"], estimates["rows"][0]["tasks"]))

    def test_a_goal_leaves_what_its_open_tasks_leave(self) -> None:
        for index in range(1, 6):
            self.done(f"d{index}", 100.0 * index)
        self.goal("G")
        self.place("MAIN", "S", kind="stage", state="container", parent="G")
        # Under G: one not begun (300 s left), one deferred that spent 50 s (250 s left), one
        # done with nothing spent and one cancelled, which leave nothing.
        self.item("t1", state="ready", parent="G")
        self.work(self.item("t4", state="deferred", parent="G"), 50.0)
        self.item("closed", state="done", parent="G")
        self.item("dropped", state="cancelled", parent="G")
        # Under S: one in triage (300 s left), and one past three of the five, with no estimate.
        self.item("t3", state="triage", parent="S")
        self.work(self.item("t2", state="dev", parent="S"), 250.0)
        # A goal with only closed work, and one whose open task has nothing to be judged by.
        self.goal("H")
        self.item("finished", state="done", parent="H")
        self.goal("E")
        self.item("alone", state="ready", projects=("kit",), parent="E")
        self.conn.commit()

        def shown(row: dict | None) -> tuple | None:
            if row is None:
                return None
            return (row["agent_seconds"], row["basis"], row["estimated"], row["unestimated"])

        rows = self.by_reference(self.volumes("MAIN")["goals"])
        self.assertEqual(
            [(850.0, 5, 3, 1), (300.0, 5, 1, 1), None, (0.0, 0, 0, 1)],
            [shown(rows[self.ref(f"MAIN:{name}")]["remaining"]) for name in ("G", "S", "H", "E")],
        )
        self.assertEqual(
            [(850.0, 5, 3, 1), (300.0, 5, 1, 1)],
            [shown(row) for row in self.remaining("G", "S")],
        )

    def test_groups_are_read_across_the_store(self) -> None:
        # Done work of `lib` stands in ALPHA, which the read of MAIN does not hold.
        for index in range(1, 6):
            self.done(f"l{index}", 100.0 * index, space="ALPHA", projects=("lib",))
        self.goal("G")
        self.item("open", state="ready", projects=("lib",), parent="G")
        self.conn.commit()
        read = self.volumes("MAIN")
        self.assertEqual({"min_basis": 5, "basis": 0, "rows": []}, read["estimates"])
        self.assertEqual(
            (300.0, 5),
            (
                read["goals"][0]["remaining"]["agent_seconds"],
                read["goals"][0]["remaining"]["basis"],
            ),
        )


class FilterTests(EstimatesCase):
    def test_a_filter_narrows_the_table_and_not_the_remainder(self) -> None:
        # Six done bugs and six done tasks of `app` labelled `ui`, 200 … 700 s; three of the
        # bugs carry `api` too.
        for index in range(6):
            seconds = 200.0 + 100.0 * index
            self.done(f"bug{index}", seconds, kind="bug", labels=("ui", "api")[: 1 + index % 2])
            self.done(f"task{index}", seconds, labels=("ui",))
        self.goal("G")
        self.work(self.item("open", state="dev", kind="bug", labels=("ui",), parent="G"), 100.0)
        self.conn.commit()

        def table(read: dict) -> list[tuple]:
            return [
                (row["level"], row["kind"], row["label"], row["tasks"])
                for row in read["estimates"]["rows"]
            ]

        # The six bugs that spent more than 100 s: 100 … 600 s beyond it, 350 s on average.
        left = (350.0, 6, 1, 0)

        def remaining(read: dict) -> tuple:
            found = read["goals"][0]["remaining"]
            return (
                found["agent_seconds"],
                found["basis"],
                found["estimated"],
                found["unestimated"],
            )

        whole = self.volumes("MAIN")
        self.assertEqual(12, whole["estimates"]["basis"])
        self.assertEqual(left, remaining(whole))
        bugs = self.volumes("MAIN", kind="bug")
        self.assertEqual(6, bugs["estimates"]["basis"])
        self.assertEqual(
            [
                ("project_kind", "bug", None, 6),
                ("project_kind_label", "bug", "ui", 6),
                ("project_kind_label", "bug", "api", 3),
            ],
            table(bugs),
        )
        self.assertEqual(left, remaining(bugs))
        # With a label named, the rows of labels are only its own.
        labelled = self.volumes("MAIN", kind="bug", label="ui")
        self.assertEqual(
            [("project_kind", "bug", None, 6), ("project_kind_label", "bug", "ui", 6)],
            table(labelled),
        )
        self.assertEqual(left, remaining(labelled))


def _figure(value: float, places: int) -> float:
    return round(value, places) if places else math.floor(value + 0.5)


def _described(values: list[float], places: int) -> dict:
    """The median, the quartiles by linear interpolation between the values in order, and the
    mean; one value is all four."""

    ordered = sorted(values)
    low = high = ordered[0]
    if len(ordered) > 1:
        low, _median, high = statistics.quantiles(ordered, n=4, method="inclusive")
    return {
        "median": _figure(statistics.median(ordered), places),
        "q1": _figure(low, places),
        "q3": _figure(high, places),
        "mean": _figure(statistics.fmean(ordered), places),
    }


class TableTests(EstimatesCase):
    """Done work of `app` in both spaces, of several projects, of none in both spaces, and of
    `lib` in ALPHA, with labels; work that is no basis beside it."""

    def setUp(self) -> None:
        super().setUp()
        for space, name, parts, projects, kind, labels in (
            ("MAIN", "t1", (100.0, 50.0), ("app",), "task", ("ui",)),
            ("MAIN", "t2", (400.0,), ("app",), "task", ("ui", "api")),
            ("MAIN", "t3", (250.0,), ("app",), "task", ()),
            ("MAIN", "b1", (600.0,), ("app",), "bug", ("api",)),
            ("MAIN", "b2", (30.0, 30.0, 30.0), ("app",), "bug", ()),
            ("MAIN", "n1", (80.0,), (), "task", ()),
            ("MAIN", "n2", (160.0,), (), "task", ("ui",)),
            ("MAIN", "v1", (500.0,), ("app", "lib"), "bug", ()),
            ("MAIN", "e1", (70.0,), ("app",), "improvement", ("ui",)),
            ("ALPHA", "o1", (300.0,), ("app",), "task", ("ui",)),
            ("ALPHA", "o2", (200.0,), (), "task", ()),
            ("ALPHA", "l1", (350.0,), ("lib",), "task", ()),
            ("ALPHA", "l2", (450.0,), ("lib",), "task", ("api",)),
        ):
            self.done(name, *parts, space=space, projects=projects, kind=kind, labels=labels)
        # A row of no known price: the task costs what its priced rows cost.
        self.work(self.done("t4", 90.0), 40.0, cost=None)
        self.work(self.item("x1", state="cancelled"), 999.0)
        self.work(self.item("x2", state="dev"), 999.0)
        self.done("x3", 999.0, begun="2026-10-01T00:00:00Z")
        self.item("x4", state="done")
        self.conn.commit()

    def basis_directly(self, within: set[str]) -> list[dict]:
        """The done tasks within the set that spent time and began after counting did."""

        first = _moment(
            self.conn.execute(
                "SELECT MIN(started_at) FROM usage_segments WHERE work_item_id IS NOT NULL"
            ).fetchone()[0]
        )
        projects: dict[str, set[str]] = {}
        for identity, project in self.conn.execute(
            "SELECT work_item_id, project_id FROM work_item_projects"
        ):
            projects.setdefault(str(identity), set()).add(str(project))
        anew = " + ".join(f"COALESCE(g.{column}, 0)" for column in ANEW)
        found = []
        for row in self.conn.execute(
            "SELECT i.work_item_id, i.kind, i.labels, p.key, COALESCE(i.started_at, i.created_at),"
            f" SUM(g.seconds), SUM({anew}), TOTAL(g.estimated_api_cost_usd)"
            " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
            " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
            " JOIN usage_segments g ON g.work_item_id = i.work_item_id"
            " WHERE s.category = 'completed' AND i.kind != 'container' GROUP BY i.work_item_id"
        ):
            identity = str(row[0])
            if row[5] <= 0 or _moment(str(row[4])) < first or identity not in within:
                continue
            named = projects.get(identity, set())
            project = next(iter(named)) if len(named) == 1 else "several" if named else None
            found.append(
                {
                    "group": (project, None if len(named) == 1 else str(row[3]), str(row[1])),
                    "labels": json.loads(row[2]),
                    "measures": (float(row[5]), float(row[6]), float(row[7])),
                }
            )
        return found

    def described_directly(self, within: set[str]) -> dict[tuple, dict]:
        rows: dict[tuple, dict] = {}
        basis = self.basis_directly(within)
        keys = {(task["group"], None) for task in basis} | {
            (task["group"], label) for task in basis for label in task["labels"]
        }
        for group, label in keys:
            members = [
                task["measures"]
                for task in basis
                if task["group"] == group and (label is None or label in task["labels"])
            ]
            rows[(*group, label)] = {
                "tasks": len(members),
                "agent_seconds": _described([found[0] for found in members], 3),
                "tokens_anew": _described([found[1] for found in members], 0),
                "estimated_api_cost_usd": _described([found[2] for found in members], 6),
            }
        return rows

    @staticmethod
    def described_by_read(estimates: dict) -> dict[tuple, dict]:
        rows = {}
        for row in estimates["rows"]:
            project = row["project"]
            named = "several" if project["combinations"] is not None else project["id"]
            space = None if row["space"] is None else row["space"]["key"]
            level = "project_kind" if row["label"] is None else "project_kind_label"
            assert row["level"] == level, row
            rows[(named, space, row["kind"], row["label"])] = {
                name: row[name]
                for name in ("tasks", "agent_seconds", "tokens_anew", "estimated_api_cost_usd")
            }
        return rows

    def test_the_table_is_the_basis_described(self) -> None:
        for space, project in (("MAIN", None), ("MAIN", "app"), ("ALPHA", None), (None, None)):
            with self.subTest(space=space, project=project):
                within = self.board_set(space, project)
                estimates = self.volumes(space, project)["estimates"]
                self.assertEqual(self.described_directly(within), self.described_by_read(estimates))
                self.assertEqual(
                    (5, len(self.basis_directly(within))),
                    (estimates["min_basis"], estimates["basis"]),
                )
                # Each row of a project and kind comes before the rows of its labels.
                pairs = [row["label"] is None for row in estimates["rows"]]
                self.assertTrue(pairs and pairs[0])
        # By hand: `app` tasks in MAIN's read are 150, 400, 250, 130 and 300 s (t1, t2, t3, t4
        # and ALPHA's o1), writing 165, 440, 275, 143 and 330 tokens anew; t4's cost is its
        # priced row's, 0.09.
        row = self.described_by_read(self.volumes("MAIN")["estimates"])[("app", None, "task", None)]
        self.assertEqual(
            {
                "tasks": 5,
                "agent_seconds": {"median": 250.0, "q1": 150.0, "q3": 300.0, "mean": 246.0},
                "tokens_anew": {"median": 275, "q1": 165, "q3": 330, "mean": 271},
                "estimated_api_cost_usd": {"median": 0.25, "q1": 0.15, "q3": 0.3, "mean": 0.238},
            },
            row,
        )
