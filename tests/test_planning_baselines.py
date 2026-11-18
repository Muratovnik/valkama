"""How many tasks stood under a goal or stage when it was accepted, kept as it happens.

The oracle is the work model's rule for the count: a goal or stage accepted with tasks
under it takes their number, `accepted`; one accepted empty takes it when the first
task under it, at any depth, starts, `started`; entering deferred drops it and the next
acceptance takes it anew; an acceptance the work-model migration gave takes none, nor
does a task accepted so and turned into a goal. Every write here goes through the
person's or an agent's route, and after each one the table holds rows only for goals
and stages accepted on a basis other than `migrated`, read straight from the store.
"""

from __future__ import annotations

from server.planning import service
from tests.test_planning_closing import AS_A, AS_B, Tree

#: Every row of the table, by item: its count and basis.
ROWS = "SELECT work_item_id, tasks, basis FROM work_item_baselines"
#: The rows whose item is no goal or stage, stands unaccepted or was accepted migrated.
STRAY = (
    "SELECT b.work_item_id FROM work_item_baselines b"
    " JOIN work_items i ON i.work_item_id = b.work_item_id"
    " WHERE i.kind <> 'container' OR i.acceptance IS NULL OR i.acceptance = 'migrated'"
)


class Baselines(Tree):
    # -- writes, each followed by the invariant ---------------------------------------

    def person(self, path: str, **payload: object) -> dict:
        answer = super().person(path, **payload)
        self.holds_only_where_accepted()
        return answer

    def agent(self, tool: str, meta: object, **arguments: object) -> dict:
        answer = super().agent(tool, meta, **arguments)
        self.holds_only_where_accepted()
        return answer

    def agents_item(self, title: str, kind: str = "task", parent: str | None = None) -> str:
        """An item an agent filed with no basis: under nothing accepted it stands in triage."""

        arguments: dict = {"space": "MAIN", "title": title, "kind": kind}
        if parent is not None:
            arguments["parent"] = parent
        return str(self.agent("create_work_item", AS_B, **arguments)["reference"])

    def accept(self, reference: str) -> None:
        self.person("/api/planning/work-item/apply", id=reference, transition={"state": "ready"})

    def migrated(self, reference: str) -> None:
        """Stand the item accepted as the work-model migration left one from 2.9."""

        self.conn.execute(
            "UPDATE work_items SET acceptance = 'migrated' WHERE work_item_id = ?",
            (self.identity(reference),),
        )
        self.conn.commit()

    # -- reads ----------------------------------------------------------------------

    def record(self, reference: str) -> dict:
        return service.get_work_item(self.conn, reference)

    def basis(self, reference: str) -> str | None:
        found = self.conn.execute(
            "SELECT acceptance FROM work_items WHERE work_item_id = ?", (self.identity(reference),)
        ).fetchone()
        return None if found[0] is None else str(found[0])

    def holds_only_where_accepted(self) -> None:
        """The invariant after every write: no row but a goal's or stage's accepted not migrated."""

        self.assertEqual([], [str(row[0]) for row in self.conn.execute(STRAY)])

    def counts(self) -> dict[str, tuple[int, str]]:
        """Each row, by the reference of its goal or stage."""

        found = {}
        for identity, tasks, basis in self.conn.execute(ROWS):
            record = self.conn.execute(
                "SELECT p.key, i.number FROM work_items i"
                " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
                " WHERE i.work_item_id = ?",
                (identity,),
            ).fetchone()
            found[f"{record[0]}-{record[1]}"] = (int(tasks), str(basis))
        return found


class BaselineTests(Baselines):
    def test_a_goal_accepted_with_three_tasks_counts_them_at_its_acceptance(self) -> None:
        """(a): K = 3, `accepted`; a task filed later and a close leave it as it was."""

        goal = self.agents_item("H", "goal")
        tasks = [self.agents_item(f"h{number}", parent=goal) for number in (1, 2, 3)]
        self.assertEqual({}, self.counts(), "nothing is accepted yet")

        self.accept(goal)

        self.assertEqual({goal: (3, "accepted")}, self.counts())
        self.made("h4", parent=goal)
        for task in tasks:
            self.close(AS_A, task)
        self.assertEqual({goal: (3, "accepted")}, self.counts())

    def test_a_goal_accepted_empty_counts_its_tasks_when_the_first_starts(self) -> None:
        """(b): the owner's goal G is accepted empty; five tasks, then the first started."""

        tasks = [self.made(f"g{number}", parent=self.goal) for number in range(1, 6)]
        self.assertEqual({}, self.counts(), "accepted empty and nothing started")

        self.agent("claim_work_item", AS_A, id=tasks[0])

        self.assertEqual({self.goal: (5, "started")}, self.counts())
        self.agent("claim_work_item", AS_B, id=tasks[1])
        self.assertEqual({self.goal: (5, "started")}, self.counts(), "taken once")

    def test_a_task_started_under_a_stage_starts_the_goal_over_it_as_well(self) -> None:
        """(b), nested: G accepted empty, stage S under it, three tasks under S."""

        stage = self.made("S", "stage", parent=self.goal)
        tasks = [self.made(f"s{number}", parent=stage) for number in (1, 2, 3)]
        self.assertEqual({}, self.counts())

        # Started by a move rather than a claim: the person records it done.
        self.person(
            "/api/planning/work-item/apply",
            id=tasks[0],
            summary={"done": "Done as asked", "next": "Nothing"},
            transition={"state": "done"},
        )

        self.assertEqual({stage: (3, "started"), self.goal: (3, "started")}, self.counts())

    def test_a_goal_put_off_loses_its_count_and_takes_it_anew_when_accepted_again(
        self,
    ) -> None:
        """(c): accepted with one task, put off, a second task, accepted again: K = 2."""

        goal = self.agents_item("H", "goal")
        self.agents_item("h1", parent=goal)
        self.accept(goal)
        self.assertEqual({goal: (1, "accepted")}, self.counts())

        self.person(
            "/api/planning/work-item/apply",
            id=goal,
            defer={"until": "2026-12-01", "reason": "waits for the vendor's reply"},
        )
        self.assertEqual({}, self.counts(), "put off, it is not accepted")
        self.agents_item("h2", parent=goal)
        self.accept(goal)

        self.assertEqual({goal: (2, "accepted")}, self.counts())

    def test_what_the_migration_accepted_takes_no_count_even_turned_into_a_goal(self) -> None:
        """(d): a goal from 2.9, and a task accepted `migrated` converted with its rest."""

        old = self.made("Old", "goal")
        self.migrated(old)
        under = [self.made(f"o{number}", parent=old) for number in (1, 2)]
        self.agent("claim_work_item", AS_A, id=under[0])
        task = self.made("t")
        self.migrated(task)
        self.agent("claim_work_item", AS_A, id=task)

        answer = self.agent(
            "apply_work_item_changes", AS_A, id=task, convert={"to": "goal", "force": True}
        )

        self.assertEqual("goal", self.record(task)["kind"])
        self.assertIsNotNone(answer["converted"]["leftover"])
        self.assertEqual("migrated", self.basis(task))
        self.assertEqual({}, self.counts())
        # Work started under the goal from 2.9 takes none either.
        self.agent("claim_work_item", AS_B, id=under[1])
        self.assertEqual({}, self.counts())
