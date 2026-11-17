"""The rows of goals and stages: what each took, with and without what was cancelled.

Items are placed straight in SQL (`planning_tree.Tree`, through `VolumesCase`) and usage
rows are inserted on them. Every expected number is the item read of usage
(`usage.for_item` with scope `item`) added up here over the items the case names, by
the rule the rows state: a goal's bounds are the items under it now with the goal
itself; `spent` leaves out each item standing cancelled, whose children count by their
own state, and `spent_with_cancelled` holds them all. The registry binds `app` to MAIN
and `lib` to ALPHA.
"""

from __future__ import annotations

from server.planning import api, usage
from tests.test_planning_volumes import VolumesCase

#: The four figures of a number that add up from item to item.
ADDED = ("agent_seconds", "tokens", "estimated_api_cost_usd", "unpriced_tokens")
TOKENS = tuple(kind for kind, _column in usage.TOKEN_KINDS)


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
    ) -> None:
        """A usage row on the item: its seconds, tokens of their own, priced or not."""

        self.minute += 1
        tokens = (int(seconds), 10 * self.minute, self.minute, None, 3, None)
        moment = started or f"2026-11-05T00:{self.minute:02d}:00.000Z"
        self.conn.execute(
            "INSERT INTO usage_segments(run_id, session_id, model, started_at, ended_at,"
            " seconds, work_item_id, input_tokens, cached_read_tokens, cache_write_5m_tokens,"
            " cache_write_1h_tokens, output_tokens, reasoning_tokens, estimated_api_cost_usd,"
            " quality) VALUES (?, 's', 'model-a', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (self.run, moment, moment, seconds, identity, *tokens, cost, quality),
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
                if name not in ("spent", "spent_with_cancelled")
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


class StatementTests(GoalCase):
    def test_a_read_takes_the_usage_rows_in_one_statement(self) -> None:
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

        def reading_usage() -> list[str]:
            found = [text for text in statements if "usage_segments" in text]
            statements.clear()
            return found

        self.goal_volumes(*references)
        self.assertEqual(1, len(reading_usage()))
        self.assertEqual(3, len(self.volumes("MAIN")["goals"]))
        found = reading_usage()
        # The frame's first counted moment, and every goal's rows at once.
        self.assertEqual(2, len(found))
        self.assertEqual(1, len([text for text in found if "GROUP BY work_item_id" in text]))


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
