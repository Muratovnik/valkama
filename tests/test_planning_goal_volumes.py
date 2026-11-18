"""The rows of goals and stages: what each took, with and without what was cancelled.

Items are placed straight in SQL (`planning_tree.Tree`, through `VolumesCase`) and usage
rows are inserted on them. Every expected number is the item read of usage
(`usage.for_item` with scope `item`) added up here over the items the case names, by
the rule the rows state: a goal's bounds are the items under it now with the goal
itself; `spent` leaves out each item standing cancelled, whose children count by their
own state, and `spent_with_cancelled` holds them all. A row's tasks, sessions and
commits are counted here from the tables the case wrote, each once however many items
of the goal hold it. The registry binds `app` to MAIN and `lib` to ALPHA.
"""

from __future__ import annotations

from server.planning import api, calls, service, usage
from tests.test_planning_volumes import CATEGORIES, VolumesCase

#: The four figures of a number that add up from item to item.
ADDED = ("agent_seconds", "tokens", "estimated_api_cost_usd", "unpriced_tokens")
TOKENS = tuple(kind for kind, _column in usage.TOKEN_KINDS)
#: What a row counts of its items besides what they spent.
COUNTED = (
    "tasks",
    "baseline",
    "baseline_absent",
    "sessions",
    "commits",
    "commits_unknown_repository",
)


def _plus(*parts: dict) -> dict:
    """What some numbers add up to, a kind of token no part reported staying null."""

    found: dict = {
        "agent_seconds": 0.0,
        "tokens": dict.fromkeys(TOKENS),
        "estimated_api_cost_usd": None,
        "unpriced_tokens": 0,
    }
    for part in parts:
        found["agent_seconds"] += part["agent_seconds"]
        for kind, value in part["tokens"].items():
            if value is not None:
                found["tokens"][kind] = (found["tokens"][kind] or 0) + value
        if part["estimated_api_cost_usd"] is not None:
            found["estimated_api_cost_usd"] = (found["estimated_api_cost_usd"] or 0.0) + part[
                "estimated_api_cost_usd"
            ]
        found["unpriced_tokens"] += part["unpriced_tokens"]
    found["agent_seconds"] = round(found["agent_seconds"], 3)
    if found["estimated_api_cost_usd"] is not None:
        found["estimated_api_cost_usd"] = round(found["estimated_api_cost_usd"], 6)
    return found


def _added(number: dict) -> dict:
    return {name: number[name] for name in ADDED}


class GoalCase(VolumesCase):
    def setUp(self) -> None:
        super().setUp()
        self.run = self.conn.execute(
            "INSERT INTO usage_runs(session_id, client, path) VALUES ('s', 'claude', 'p')"
        ).lastrowid
        self.minute = 0

    def spend(
        self,
        identity: str,
        seconds: float,
        *,
        cost: float | None = 0.25,
        quality: str = "observed",
        started: str | None = None,
        session: str = "s",
    ) -> None:
        """A usage row on the item: its seconds, tokens of their own, priced or not."""

        self.minute += 1
        tokens = (int(seconds), 10 * self.minute, self.minute, None, 3, None)
        moment = started or f"2026-11-05T00:{self.minute:02d}:00.000Z"
        self.conn.execute(
            "INSERT INTO usage_segments(run_id, session_id, model, started_at, ended_at,"
            " seconds, work_item_id, input_tokens, cached_read_tokens, cache_write_5m_tokens,"
            " cache_write_1h_tokens, output_tokens, reasoning_tokens, estimated_api_cost_usd,"
            " quality) VALUES (?, ?, 'model-a', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (self.run, session, moment, moment, seconds, identity, *tokens, cost, quality),
        )

    def own(self, *identities: str) -> dict:
        """What the items' own usage rows add up to, as the item read of usage gives each."""

        return _plus(*(usage.for_item(self.conn, identity, "item") for identity in identities))

    def goal_volumes(self, *references: str) -> list[dict]:
        answer = api.handle_get(self.conn, "/api/planning/goal-volumes", {"id": list(references)})
        assert answer is not None
        self.assertEqual(200, answer[0])
        self.assertEqual("valkama-planning-api", answer[1]["interface_version"])
        return answer[1]["goals"]

    def ref(self, name: str) -> str:
        space, _, short = name.partition(":")
        return self.trees[space].refs[short]

    def tasks_of(self, identity: str, within: set[str]) -> dict:
        """The tasks under an item at any depth that `within` holds, counted from the rows."""

        rows = self.rows()
        found = dict.fromkeys(CATEGORIES, 0)
        pending = [identity]
        while pending:
            parent = pending.pop()
            for child, row in rows.items():
                if row["parent_id"] == parent:
                    pending.append(child)
                    if row["kind"] != "container" and child in within:
                        found[row["category"]] += 1
        closed = found["completed"] + found["cancelled"]
        return {
            "total": sum(found.values()),
            "closed": closed,
            "completed": found["completed"],
            "cancelled": found["cancelled"],
            "by_category": found,
        }

    @staticmethod
    def by_reference(rows: list[dict]) -> dict[str, dict]:
        found: dict[str, dict] = {}
        pending = list(rows)
        while pending:
            row = pending.pop()
            found[row["reference"]] = row
            pending.extend(row.get("children", []))
        return found


class DepthTests(GoalCase):
    """G → S1 → S2, a task at every level and one cancelled under S1; work on every item."""

    def setUp(self) -> None:
        super().setUp()
        main = "MAIN"
        self.items = {
            "G": self.place(main, "G", kind="goal", state="container"),
            "S1": self.place(main, "S1", kind="stage", state="container", parent="G"),
            "S2": self.place(main, "S2", kind="stage", state="container", parent="S1"),
            "a": self.place(main, "a", state="done", parent="G", started=True),
            "b": self.place(main, "b", state="dev", parent="S1", started=True),
            "x": self.place(main, "x", state="cancelled", parent="S1"),
            "c": self.place(main, "c", state="review", parent="S2", started=True),
            "d": self.place(main, "d", state="ready", parent="S2"),
        }
        for index, identity in enumerate(self.items.values()):
            self.spend(identity, 60.0 * (index + 1))
        # A row of no known price, and one whose time no liveness record stands behind.
        self.spend(self.items["b"], 30.0, cost=None)
        self.spend(self.items["c"], 45.0, quality="estimated")
        self.spend(self.items["x"], 15.0, cost=None)
        self.conn.commit()

    def under(self, name: str) -> list[str]:
        """The item and every item under it now, by name."""

        parents = {"S1": "G", "S2": "S1", "a": "G", "b": "S1", "x": "S1", "c": "S2", "d": "S2"}
        found = [name]
        for child, parent in parents.items():
            if parent == name:
                found += self.under(child)
        return found

    def test_a_goal_adds_up_its_cards_at_every_depth(self) -> None:
        through_volumes = self.by_reference(self.volumes("MAIN")["goals"])
        through_goals = {
            row["reference"]: row
            for row in self.goal_volumes(*(self.ref(f"MAIN:{name}") for name in ("G", "S1", "S2")))
        }
        self.assertEqual(
            [self.ref("MAIN:G")], [row["reference"] for row in self.volumes("MAIN")["goals"]]
        )
        tasks = {"G": ["a"], "S1": ["b", "x"], "S2": ["c", "d"]}
        stages = {"G": ["S1"], "S1": ["S2"], "S2": []}
        for read, rows in (("volumes", through_volumes), ("goal-volumes", through_goals)):
            for name in ("G", "S1", "S2"):
                with self.subTest(read=read, row=name):
                    row = rows[self.ref(f"MAIN:{name}")]
                    every = [self.items[found] for found in self.under(name)]
                    kept = [self.items[found] for found in self.under(name) if found != "x"]
                    self.assertEqual(self.own(*every), _added(row["spent_with_cancelled"]))
                    self.assertEqual(self.own(*kept), _added(row["spent"]))
                    self.assertFalse(row["partial"])
                    self.assertIsNone(row["other_space"])
                    if read == "volumes":
                        children = [child["reference"] for child in row["children"]]
                        self.assertEqual(
                            [self.ref(f"MAIN:{stage}") for stage in stages[name]], children
                        )
                    else:
                        self.assertNotIn("children", row)
                    # A row is its own work, its stages' rows and its tasks'.
                    for number, leaves_out in (("spent_with_cancelled", ()), ("spent", ("x",))):
                        self.assertEqual(
                            _added(row[number]),
                            _plus(
                                self.own(self.items[name]),
                                *(
                                    _added(rows[self.ref(f"MAIN:{stage}")][number])
                                    for stage in stages[name]
                                ),
                                *(
                                    self.own(self.items[task])
                                    for task in tasks[name]
                                    if task not in leaves_out
                                ),
                            ),
                            number,
                        )
        whole = usage.for_item(self.conn, self.items["G"], "tree")
        self.assertEqual(
            {name: whole[name] for name in ADDED},
            _added(through_goals[self.ref("MAIN:G")]["spent_with_cancelled"]),
        )
        # Observed and estimated time under the goal: each number says it is a mix.
        goal = through_goals[self.ref("MAIN:G")]
        self.assertEqual(
            ["mixed", "mixed"],
            [goal[number]["quality"] for number in ("spent", "spent_with_cancelled")],
        )

    def test_a_row_says_where_its_goal_or_stage_stands(self) -> None:
        stage = self.goal_volumes(self.ref("MAIN:S2"))[0]
        self.assertEqual(
            {
                "work_item_id": self.items["S2"],
                "reference": self.ref("MAIN:S2"),
                "title": "S2 item",
                "kind": "stage",
                "state": None,
                "container_state": "in_progress",
                "open": True,
                "parent_reference": self.ref("MAIN:S1"),
                "other_space": None,
                "partial": False,
            },
            {
                name: value
                for name, value in stage.items()
                if name not in ("spent", "spent_with_cancelled", *COUNTED)
            },
        )
        self.assertIsNone(self.goal_volumes(self.ref("MAIN:G"))[0]["parent_reference"])


class CancelledTests(GoalCase):
    """G with its own work: a done and a cancelled task, and a cancelled stage over both kinds."""

    def setUp(self) -> None:
        super().setUp()
        main = "MAIN"
        self.items = {
            "G": self.place(main, "G", kind="goal", state="container"),
            "a": self.place(main, "a", state="done", parent="G", started=True),
            "b": self.place(main, "b", state="cancelled", parent="G"),
            "S1": self.place(main, "S1", kind="stage", state="cancelled", parent="G"),
            "c1": self.place(main, "c1", state="done", parent="S1", started=True),
            "c2": self.place(main, "c2", state="cancelled", parent="S1"),
        }
        for index, identity in enumerate(self.items.values()):
            self.spend(identity, 100.0 + index, cost=0.5 * (index + 1))
        self.conn.commit()

    def test_the_main_sum_leaves_out_what_was_cancelled(self) -> None:
        goal, stage = self.goal_volumes(self.ref("MAIN:G"), self.ref("MAIN:S1"))
        items = self.items
        self.assertEqual(self.own(items["G"], items["a"], items["c1"]), _added(goal["spent"]))
        self.assertEqual(self.own(*items.values()), _added(goal["spent_with_cancelled"]))
        self.assertEqual(self.own(items["c1"]), _added(stage["spent"]))
        self.assertEqual(
            self.own(items["S1"], items["c1"], items["c2"]), _added(stage["spent_with_cancelled"])
        )
        self.assertEqual(
            _added(goal["spent"]),
            _plus(self.own(items["G"]), _added(stage["spent"]), self.own(items["a"])),
        )
        self.assertEqual(
            _added(goal["spent_with_cancelled"]),
            _plus(
                self.own(items["G"]),
                _added(stage["spent_with_cancelled"]),
                self.own(items["a"], items["b"]),
            ),
        )
        self.assertEqual("observed", goal["spent"]["quality"])
        self.assertEqual((True, False), (goal["open"], stage["open"]))
        self.assertEqual("cancelled", stage["state"]["category"])


class ProjectTests(GoalCase):
    """G of MAIN over work of `app` and of `lib`; H of ALPHA over work of `app` and of none."""

    def setUp(self) -> None:
        super().setUp()
        self.items = {
            "G": self.place("MAIN", "G", kind="goal", state="container"),
            "g1": self.place(
                "MAIN", "g1", state="dev", parent="G", started=True, projects=("app",)
            ),
            "g2": self.place("MAIN", "g2", state="ready", parent="G", projects=("app",)),
            "g3": self.place(
                "MAIN", "g3", state="dev", parent="G", started=True, projects=("lib",)
            ),
            "H": self.place("ALPHA", "H", kind="goal", state="container"),
            "h1": self.place(
                "ALPHA", "h1", state="dev", parent="H", started=True, projects=("app",)
            ),
            "h2": self.place("ALPHA", "h2", state="dev", parent="H", started=True),
        }
        for index, identity in enumerate(self.items.values()):
            self.spend(identity, 50.0 * (index + 1))
        self.conn.commit()

    def test_a_project_reads_its_part_of_a_goal(self) -> None:
        items = self.items
        for project in ("app", None):
            with self.subTest(project=project):
                rows = {row["reference"]: row for row in self.volumes("MAIN", project)["goals"]}
                self.assertEqual({self.ref("MAIN:G"), self.ref("ALPHA:H")}, set(rows))
                goal, other = rows[self.ref("MAIN:G")], rows[self.ref("ALPHA:H")]
                if project is None:
                    self.assertEqual(
                        self.own(items["G"], items["g1"], items["g2"], items["g3"]),
                        _added(goal["spent"]),
                    )
                    self.assertFalse(goal["partial"])
                else:
                    self.assertEqual(
                        self.own(items["G"], items["g1"], items["g2"]), _added(goal["spent"])
                    )
                    self.assertTrue(goal["partial"])
                self.assertIsNone(goal["other_space"])
                self.assertEqual(self.own(items["H"], items["h1"]), _added(other["spent"]))
                self.assertEqual(
                    self.own(items["H"], items["h1"]), _added(other["spent_with_cancelled"])
                )
                self.assertEqual({"key": "ALPHA", "name": "Space ALPHA"}, other["other_space"])
                self.assertTrue(other["partial"])
        # Read whole, each goal is all of its own and names no space.
        whole = self.goal_volumes(self.ref("ALPHA:H"), self.ref("MAIN:G"))
        self.assertEqual(
            [self.ref("ALPHA:H"), self.ref("MAIN:G")], [row["reference"] for row in whole]
        )
        self.assertEqual(self.own(items["H"], items["h1"], items["h2"]), _added(whole[0]["spent"]))
        self.assertEqual([False, False], [row["partial"] for row in whole])
        self.assertEqual([None, None], [row["other_space"] for row in whole])
        # Every space read: one scope, so no goal is another space's.
        every = self.volumes()["goals"]
        self.assertEqual([None, None], [row["other_space"] for row in every])
        self.assertEqual([False, False], [row["partial"] for row in every])


class SelectionTests(GoalCase):
    def test_the_goals_are_the_open_ones_and_those_closed_in_the_period(self) -> None:
        self.place("MAIN", "open", kind="goal")
        self.place("MAIN", "accepted", kind="goal", state="container")
        self.place("MAIN", "in", kind="goal", state="done", entries=("2026-11-12T00:00:00Z",))
        self.place("MAIN", "before", kind="goal", state="done", entries=("2026-11-01T00:00:00Z",))
        self.place(
            "MAIN", "after", kind="goal", state="cancelled", entries=("2026-11-20T00:00:00Z",)
        )
        self.place("MAIN", "stage", kind="stage", state="container", parent="accepted")
        self.place("MAIN", "task")
        self.assertEqual(
            [self.ref(f"MAIN:{name}") for name in ("open", "accepted", "in")],
            [row["reference"] for row in self.volumes("MAIN")["goals"]],
        )

    def test_a_task_begun_before_counting_is_partly_measured(self) -> None:
        goal = self.place("MAIN", "G", kind="goal", state="container")
        early = self.place("MAIN", "early", state="dev", parent="G", started=True)
        self.place("MAIN", "late", state="cancelled", parent="G")
        self.conn.execute(
            "UPDATE work_items SET started_at = '2026-10-01T00:00:00Z' WHERE work_item_id = ?",
            (early,),
        )
        # The cancelled task has no start, and was created before counting began too.
        self.conn.execute(
            "UPDATE work_items SET created_at = '2026-10-02T00:00:00Z' WHERE parent_id = ?"
            " AND work_item_id != ?",
            (goal, early),
        )
        self.spend(early, 10.0, started="2026-10-17T16:03:29.000Z")
        row = self.goal_volumes(self.ref("MAIN:G"))[0]
        self.assertEqual(
            (1, 2),
            (row["spent"]["partly_measured"], row["spent_with_cancelled"]["partly_measured"]),
        )


class TaskTests(GoalCase):
    """G over a task moved out, a cancelled one, a stage with a `bug` and an `improvement`,
    and a task in triage; H of ALPHA over a task of `app` and one of none."""

    def setUp(self) -> None:
        super().setUp()
        main = "MAIN"
        self.items = {
            "G": self.place(main, "G", kind="goal", state="container"),
            "a": self.place(main, "a", state="dev", parent="G", started=True, projects=("app",)),
            "b": self.place(main, "b", state="cancelled", parent="G", projects=("app",)),
            "S": self.place(main, "S", kind="stage", state="container", parent="G"),
            "c": self.place(
                main, "c", kind="bug", state="done", parent="S", started=True, projects=("app",)
            ),
            "d": self.place(
                main, "d", kind="improvement", state="ready", parent="S", projects=("lib",)
            ),
            "e": self.place(main, "e", parent="G", projects=("app",)),
            "H": self.place("ALPHA", "H", kind="goal", state="container"),
            "h1": self.place(
                "ALPHA", "h1", state="dev", parent="H", started=True, projects=("app",)
            ),
            "h2": self.place("ALPHA", "h2", state="review", parent="H", started=True),
        }
        for name in ("G", "a", "b", "c"):
            self.spend(self.items[name], 100.0)
        self.trees["MAIN"].leave("a")
        self.conn.commit()

    def test_moved_out_work_leaves_and_cancelled_work_stands_apart(self) -> None:
        items = self.items
        goal = self.goal_volumes(self.ref("MAIN:G"))[0]
        stays = ("G", "S", "c", "d", "e")
        self.assertEqual(
            self.own(*(items[name] for name in (*stays, "b"))), _added(goal["spent_with_cancelled"])
        )
        self.assertEqual(self.own(*(items[name] for name in stays)), _added(goal["spent"]))
        # a left with what it spent; b, cancelled, is among the tasks and closed.
        self.assertEqual(
            {
                "total": 4,
                "closed": 2,
                "completed": 1,
                "cancelled": 1,
                "by_category": {
                    **dict.fromkeys(CATEGORIES, 0),
                    "triage": 1,
                    "ready": 1,
                    "completed": 1,
                    "cancelled": 1,
                },
            },
            goal["tasks"],
        )

    def test_a_row_counts_the_tasks_its_scope_holds(self) -> None:
        reads = [
            (space, project) for space in ("MAIN", "ALPHA") for project in (None, "app", "lib")
        ]
        for space, project in [*reads, (None, None)]:
            with self.subTest(space=space, project=project):
                within = self.board_set(space, project)
                rows = self.by_reference(self.volumes(space, project)["goals"])
                self.assertTrue(rows)
                for row in rows.values():
                    self.assertEqual(
                        self.tasks_of(row["work_item_id"], within), row["tasks"], row["reference"]
                    )
        whole = self.goal_volumes(self.ref("MAIN:G"), self.ref("MAIN:S"), self.ref("ALPHA:H"))
        for row in whole:
            self.assertEqual(self.tasks_of(row["work_item_id"], set(self.rows())), row["tasks"])


class CommitTests(GoalCase):
    def commit(self, project: str | None, hash_text: str, rewritten_to: int | None = None) -> int:
        found = self.conn.execute(
            "INSERT INTO commits(project_id, hash, reported_at, rewritten_to)"
            " VALUES (?, ?, '2026-11-12T10:00:00Z', ?)",
            (project, hash_text, rewritten_to),
        ).lastrowid
        assert found is not None
        return found

    def attach(self, identity: str, *commits: int) -> None:
        for commit in commits:
            self.conn.execute(
                "INSERT INTO work_item_commits(work_item_id, commit_id, attached_by)"
                " VALUES (?, ?, 'manual')",
                (identity, commit),
            )

    def test_commits_of_no_known_repository_stand_apart(self) -> None:
        goal = self.place("MAIN", "G", kind="goal", state="container")
        a = self.place("MAIN", "a", state="dev", parent="G", started=True)
        b = self.place("MAIN", "b", state="dev", parent="G", started=True)
        known = self.commit("app", "a1" * 20)
        self.attach(a, known, self.commit("app", "b2" * 20, rewritten_to=known))
        self.attach(goal, known)
        # One commit of no known repository, written under two abbreviations.
        self.attach(b, self.commit(None, "3f2a9c1"), self.commit(None, "3f2a9c1d"))
        self.conn.commit()
        row = self.goal_volumes(self.ref("MAIN:G"))[0]
        self.assertEqual((1, 2), (row["commits"], row["commits_unknown_repository"]))
        # The flow counts the known commit once on the day it was made, and neither the
        # rewritten one nor the records of no known repository.
        flow = self.volumes("MAIN")["flow"]
        self.assertEqual(
            {"2026-11-12": 1},
            {day["day"]: day["commits"] for day in flow["days"] if day["commits"]},
        )
        self.assertEqual(1, flow["totals"]["commits"])


class SessionTests(GoalCase):
    def write(self, session: str, reference: str) -> None:
        """A confirmed write of `session` to the item."""

        identity = calls.Identity(
            state=calls.CONFIRMED,
            source=calls.CLAUDE_HOOK,
            session_id=session,
            agent_id=None,
            client="claude",
        )
        with calls.bind(identity, "comment_work_item"):
            service.comment_work_item(self.conn, reference, "a note")
        self.conn.commit()

    def test_a_goal_counts_each_session_once(self) -> None:
        self.place("MAIN", "G", kind="goal", state="container")
        a = self.place("MAIN", "a", state="dev", parent="G", started=True)
        b = self.place("MAIN", "b", state="dev", parent="G", started=True)
        self.spend(a, 10.0, session="sess-x")
        self.spend(b, 10.0, session="sess-x")
        self.spend(a, 10.0, session="sess-y")
        self.conn.commit()
        self.write("sess-z", self.ref("MAIN:b"))
        # Each task's own read counts two; their sum would count sess-x twice.
        self.assertEqual(
            [2, 2], [usage.for_item(self.conn, task, "item")["sessions"] for task in (a, b)]
        )
        self.assertEqual(3, self.goal_volumes(self.ref("MAIN:G"))[0]["sessions"])


class BaselineTests(GoalCase):
    def test_a_missing_count_at_acceptance_names_its_reason(self) -> None:
        main = "MAIN"
        self.place(main, "T", kind="goal")
        self.place(main, "C", kind="goal", state="cancelled", entries=("2026-11-12T00:00:00Z",))
        self.place(main, "E", kind="goal", state="container")
        # From before the work model, with nothing under it started.
        self.place(main, "M", kind="goal", state="container", basis="migrated")
        goal = self.place(main, "G", kind="goal", state="container")
        for name, project in (("g1", "app"), ("g2", "app"), ("g3", "lib")):
            self.place(main, name, state="ready", parent="G", projects=(project,))
        self.conn.execute(
            "INSERT INTO work_item_baselines(work_item_id, tasks, basis, taken_at)"
            " VALUES (?, 3, 'accepted', '2026-11-11T09:00:00Z')",
            (goal,),
        )
        self.conn.commit()
        count = {"tasks": 3, "basis": "accepted", "taken_at": "2026-11-11T09:00:00Z"}

        def shown(rows: list[dict]) -> dict[str, tuple]:
            return {row["reference"]: (row["baseline"], row["baseline_absent"]) for row in rows}

        self.assertEqual(
            {
                self.ref("MAIN:T"): (None, "not_accepted"),
                self.ref("MAIN:C"): (None, "not_accepted"),
                self.ref("MAIN:E"): (None, "not_started"),
                self.ref("MAIN:M"): (None, "migrated"),
                self.ref("MAIN:G"): (count, None),
            },
            shown(self.volumes(main)["goals"]),
        )
        # Read through a project, G is a part of itself, which its count is not of.
        self.assertEqual(
            {self.ref("MAIN:G"): (None, "partial")}, shown(self.volumes(main, "app")["goals"])
        )
        self.assertEqual(
            {self.ref("MAIN:G"): (count, None)}, shown(self.goal_volumes(self.ref("MAIN:G")))
        )


#: The tables each part of a row is read from, besides the items themselves.
PARTS = {
    "usage rows": "GROUP BY work_item_id",
    "sessions": "execution_events",
    "commits": "work_item_commits",
    "counts at acceptance": "work_item_baselines",
}


class StatementTests(GoalCase):
    def test_a_read_takes_each_part_in_one_statement(self) -> None:
        references = []
        for index in range(3):
            goal = self.place("MAIN", f"G{index}", kind="goal", state="container")
            self.place("MAIN", f"S{index}", kind="stage", state="container", parent=f"G{index}")
            task = self.place("MAIN", f"t{index}", state="dev", parent=f"S{index}", started=True)
            self.spend(goal, 10.0)
            self.spend(task, 20.0)
            references += [self.ref(f"MAIN:G{index}"), self.ref(f"MAIN:S{index}")]
        statements: list[str] = []
        self.conn.set_trace_callback(statements.append)
        self.addCleanup(self.conn.set_trace_callback, None)

        def reading() -> dict[str, int]:
            found = {
                part: len([text for text in statements if marker in text])
                for part, marker in PARTS.items()
            }
            found["of usage"] = len([text for text in statements if "usage_segments" in text])
            statements.clear()
            return found

        # Every part once for six rows; the usage rows and the sessions read usage.
        once = {**dict.fromkeys(PARTS, 1), "of usage": 2}
        self.goal_volumes(*references)
        self.assertEqual(once, reading())
        self.assertEqual(3, len(self.volumes("MAIN")["goals"]))
        # The frame's first counted moment reads usage too, the flow reads the scope's commits
        # twice, those attached to its items and those on no card, whatever its goals, and the
        # counts take how many stand on no card in one more.
        self.assertEqual({**once, "of usage": 3, "commits": 4}, reading())


class RefusalTests(GoalCase):
    def refused(self, references: list[str]) -> tuple[int, str]:
        with self.assertRaises(Exception) as caught:
            api.handle_get(self.conn, "/api/planning/goal-volumes", {"id": references})
        status, body = api.error_response(caught.exception)
        return status, f"{body['error']['code']}: {body['error']['message']}"

    def test_goal_volumes_names_what_it_cannot_read(self) -> None:
        self.place("MAIN", "G", kind="goal", state="container")
        task = self.place("MAIN", "t", parent="G")
        refused = "invalid_request: id takes 1 to 100 goals or stages"
        self.assertEqual((400, refused), self.refused([]))
        self.assertEqual((400, refused), self.refused([self.ref("MAIN:G")] * 101))
        self.assertEqual(
            (
                400,
                f"invalid_request: {self.ref('MAIN:t')} is a task: goal volumes read goals and stages",
            ),
            self.refused([self.ref("MAIN:G"), task]),
        )
        self.assertEqual((404, "not_found: no work item MAIN-99"), self.refused(["MAIN-99"]))
        self.assertEqual(100, len(self.goal_volumes(*[self.ref("MAIN:G")] * 100)))
