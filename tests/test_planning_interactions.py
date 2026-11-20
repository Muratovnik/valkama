"""The read of the questions waiting for the owner, narrowed as a space's board holds it.

The registry binds `app` to MAIN and `lib` to ALPHA (`test_planning_volumes`). A question
waits on each of: MAIN's card naming `app`, MAIN's card naming `lib`, MAIN's card naming
no project, ALPHA's card naming `app` (MAIN's project) and ALPHA's card naming none. A
card of each space waits in triage with no question, ALPHA's naming `app`, and one card in
the stack is enough for a space's line that its triage is due. The
Volumes read counts «Waiting for me» over what the space's board holds, narrowed by the
project; the questions window opened from that number reads `other_spaces=true` and the
project, and each expected set is counted here from the tables by the rule the contract
states, never taken from the read under test.
"""

from __future__ import annotations

import json
import os
import sqlite3
import unittest
from contextlib import closing
from unittest import mock

from server import store
from server.planning import api, interactions, participation
from server.planning.routing import PlanningRouting
from server.projects import scopes
from tests.planning_tree import Tree
from tests.test_planning_volumes import VolumesCase


class SpaceQuestionsTests(VolumesCase):
    def setUp(self) -> None:
        super().setUp()
        self.place("MAIN", "app", projects=("app",))
        self.place("MAIN", "lib", projects=("lib",))
        self.place("MAIN", "none")
        self.place("ALPHA", "app", projects=("app",))
        self.place("ALPHA", "none")
        self.place("MAIN", "quiet")
        self.place("ALPHA", "quiet", projects=("app",))
        participation.write_value(self.conn, None, "triage_count", 1)
        self.asked = {
            name: self.question(name, f"2026-11-0{day}T09:00:00.000Z")
            for day, name in enumerate(
                ("MAIN:app", "MAIN:lib", "MAIN:none", "ALPHA:app", "ALPHA:none"), start=1
            )
        }
        self.conn.commit()

    def listed(self, space: str | None, **narrowed: str) -> dict:
        """The window's read of the open questions, every space's or one space's."""

        routing = PlanningRouting(self.conn, str(self.primary))
        parameters = {"scope_kind": "global", "status": "pending"}
        if space is not None:
            parameters |= {"scope_kind": "space", "data_scope_id": self.scope_id}
            parameters |= {"space_key": space, **narrowed}
        return interactions.request_list(
            routing, {key: [value] for key, value in parameters.items()}
        )

    def names(self, answer: dict) -> set[str]:
        by_id = {identity: name for name, identity in self.asked.items()}
        return {by_id[entry["request"]["request_id"]] for entry in answer["items"]}

    def expected(self, space: str | None, project: str | None = None) -> set[str]:
        """The questions on what the space's board holds, chosen from the tables."""

        held = self.board_set(space, project)
        return {name for name in self.asked if self.ids(name) <= held}

    def test_the_window_lists_exactly_the_questions_the_number_counts(self) -> None:
        for space, project in (
            ("MAIN", None),
            ("MAIN", "app"),
            ("MAIN", "lib"),
            ("ALPHA", None),
            ("ALPHA", "lib"),
        ):
            with self.subTest(space=space, project=project):
                narrowed = {"other_spaces": "true"}
                if project is not None:
                    narrowed["project_id"] = project
                answer = self.listed(space, **narrowed)
                counted = self.volumes(space, project)["counts"]["waiting_owner"]["count"]
                self.assertEqual(self.expected(space, project), self.names(answer))
                self.assertEqual(counted, answer["total"])
        # The case is what it says: MAIN's board holds ALPHA's card naming its project, and
        # narrowed to `app` it leaves out MAIN's own card of `lib`; a project of another
        # space that MAIN's cards name keeps MAIN's own card alone.
        self.assertEqual(
            {"MAIN:app", "MAIN:lib", "MAIN:none", "ALPHA:app"},
            self.names(self.listed("MAIN", other_spaces="true")),
        )
        self.assertEqual(
            {"MAIN:app", "ALPHA:app"},
            self.names(self.listed("MAIN", other_spaces="true", project_id="app")),
        )
        self.assertEqual(
            {"MAIN:lib"}, self.names(self.listed("MAIN", other_spaces="true", project_id="lib"))
        )

    def test_every_space_is_every_question_and_a_space_alone_its_own_cards(self) -> None:
        everywhere = self.listed(None)
        self.assertEqual(set(self.asked), self.names(everywhere))
        self.assertEqual(self.volumes()["counts"]["waiting_owner"]["count"], everywhere["total"])
        # Without the narrowing a space is read as a source: the questions on its own cards.
        self.assertEqual({"MAIN:app", "MAIN:lib", "MAIN:none"}, self.names(self.listed("MAIN")))
        self.assertEqual({"MAIN:app"}, self.names(self.listed("MAIN", project_id="app")))

    def test_a_card_of_another_space_is_that_spaces_to_open(self) -> None:
        answer = self.listed("MAIN", other_spaces="true")
        targets = {
            self.names({"items": [entry]}).pop(): entry["target"]["space_ref"]
            for entry in answer["items"]
        }
        own = {"data_scope_id": self.scope_id, "space_key": "MAIN"}
        self.assertEqual(own, targets["MAIN:none"])
        self.assertEqual(
            {"data_scope_id": self.scope_id, "space_key": "ALPHA"}, targets["ALPHA:app"]
        )
        # The source the read names is the space asked for, and its triage line is its own:
        # the stack of MAIN's own cards, whole, however the questions beside it are narrowed.
        self.assertEqual([own], [entry["space_ref"] for entry in answer["coverage"]])
        line = self.listed("MAIN")["triage_due"]
        self.assertEqual([(own, 1)], [(entry["space_ref"], entry["count"]) for entry in line])
        narrowed = self.listed("MAIN", other_spaces="true", project_id="app")
        for read in (answer, narrowed):
            self.assertEqual(line, read["triage_due"])

    def test_a_narrowing_that_cannot_be_read_is_refused(self) -> None:
        for narrowed in (
            {"other_spaces": "false"},
            {"other_spaces": "true", "reference": "MAIN-1"},
            {"project_id": ""},
        ):
            with (
                self.subTest(narrowed=narrowed),
                self.assertRaises(api.PlanningHttpError) as caught,
            ):
                self.listed("MAIN", **narrowed)
            self.assertEqual(400, caught.exception.status)


#: The cards of the filter's case: their kind and labels, and the projects they name.
CARDS = {
    "MAIN:t": ("task", ("ui", "api"), ()),
    "MAIN:b": ("bug", ("ui",), ()),
    "MAIN:c": ("bug", (), ()),
    "MAIN:G": ("goal", ("ui",), ()),
    "ALPHA:x": ("bug", ("ui",), ("app",)),
    "ALPHA:y": ("task", ("ui",), ()),
}


class TaskFilterQuestionsTests(VolumesCase):
    """A question waits on each card of `CARDS`: tasks that match a filter and tasks that do
    not, a goal labelled as a matching task is, and ALPHA's cards, one of which MAIN's board
    holds by naming its project. Under the Volumes page's kind and label the window reads
    the page's filter too; each expected set is chosen here from `CARDS` by the filter's
    rule, never taken from the read under test."""

    def setUp(self) -> None:
        super().setUp()
        self.asked: dict[str, str] = {}
        for day, (name, (kind, labels, projects)) in enumerate(CARDS.items(), start=1):
            space, _, short = name.partition(":")
            self.place(space, short, kind=kind, projects=projects)
            self.conn.execute(
                "UPDATE work_items SET labels = ? WHERE work_item_id = ?",
                (json.dumps(labels), *self.ids(name)),
            )
            self.asked[name] = self.question(name, f"2026-11-0{day}T09:00:00.000Z")
        self.conn.commit()

    def listed(self, space: str | None, *, board: bool = True, **narrowed: str | list[str]) -> dict:
        """The window's read, of every space or of one as its board holds it (`board`)."""

        routing = PlanningRouting(self.conn, str(self.primary))
        parameters: dict[str, str | list[str]] = {"scope_kind": "global", "status": "pending"}
        if space is not None:
            parameters |= {"scope_kind": "space", "data_scope_id": self.scope_id}
            parameters |= {"space_key": space}
            if board:
                parameters["other_spaces"] = "true"
        parameters |= narrowed
        return interactions.request_list(
            routing,
            {
                key: value if isinstance(value, list) else [value]
                for key, value in parameters.items()
            },
        )

    def names(self, answer: dict) -> set[str]:
        by_id = {identity: name for name, identity in self.asked.items()}
        return {by_id[entry["request"]["request_id"]] for entry in answer["items"]}

    def expected(self, space: str | None, kinds: list[str], labels: list[str]) -> set[str]:
        held = self.board_set(space)
        return {
            name
            for name, (kind, carried, _projects) in CARDS.items()
            if self.ids(name) <= held
            and kind in (kinds or ("task", "bug", "improvement"))
            and set(labels) <= set(carried)
        }

    def test_the_window_lists_the_questions_the_filtered_number_counts(self) -> None:
        for kinds, labels in (
            (["bug"], []),
            ([], ["ui"]),
            (["bug"], ["ui"]),
            (["bug", "task"], ["ui", "api"]),
        ):
            for space in ("MAIN", None):
                with self.subTest(space=space, kinds=kinds, labels=labels):
                    answer = self.listed(space, task_kind=kinds, task_label=labels)
                    read = self.volumes(space, kind=kinds, label=labels)
                    self.assertEqual(self.expected(space, kinds, labels), self.names(answer))
                    self.assertEqual(read["counts"]["waiting_owner"]["count"], answer["total"])
        # The case is what it says: the goal carries `ui` and is never kept, a task without
        # the label is left out, and MAIN's board holds ALPHA's bug naming its project.
        self.assertEqual(
            {"MAIN:t", "MAIN:b", "ALPHA:x"}, self.names(self.listed("MAIN", task_label="ui"))
        )
        self.assertEqual(
            {"MAIN:b", "MAIN:c", "ALPHA:x"}, self.names(self.listed("MAIN", task_kind="bug"))
        )

    def test_a_label_no_card_carries_keeps_nothing(self) -> None:
        self.assertEqual(set(), self.names(self.listed("MAIN", task_label="absent")))
        self.assertEqual(set(), self.names(self.listed(None, task_label="absent")))

    def test_a_space_read_as_a_source_keeps_its_own_cards_under_the_filter(self) -> None:
        self.assertEqual(
            {"MAIN:b", "MAIN:c"}, self.names(self.listed("MAIN", board=False, task_kind="bug"))
        )

    def test_a_filter_that_cannot_be_read_is_refused(self) -> None:
        for space, narrowed in (
            ("MAIN", {"task_kind": "goal"}),
            ("MAIN", {"task_label": ""}),
            ("MAIN", {"task_kind": "bug", "reference": "MAIN-1"}),
            (None, {"task_kind": "epic"}),
        ):
            with (
                self.subTest(space=space, narrowed=narrowed),
                self.assertRaises(api.PlanningHttpError) as caught,
            ):
                self.listed(space, board=False, **narrowed)
            self.assertEqual(400, caught.exception.status)


class AttachedStoreQuestionsTests(VolumesCase):
    """A question waits on a bug labelled `ui` in the primary store's MAIN, and on a bug
    labelled `ui` and a task without a label in BETA, a space of a store attached beside it.
    «Waiting for me» at the top of Volumes opens the questions window at the top, under the
    page's kind and label or with none: the window lists what the number counts."""

    def setUp(self) -> None:
        super().setUp()
        main = self.place("MAIN", "b", kind="bug")
        self.label(self.conn, main)
        self.question("MAIN:b", "2026-11-01T09:00:00.000Z")
        self.side = self.root / "side.sqlite3"
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.side)}):
            other = store.connect()
        try:
            beta = Tree(other, "BETA")
            bug = beta.add("b", kind="bug")
            self.label(other, bug)
            for day, identity in ((2, bug), (3, beta.add("t"))):
                other.execute(
                    "INSERT INTO work_item_requests(request_id, work_item_id, kind, prompt,"
                    " fields_json, status, author, created_at)"
                    " VALUES (?, ?, 'question', 'Which way?', '[]', 'pending', 'asking-agent', ?)",
                    (f"side-{day}", identity, f"2026-11-0{day}T09:00:00.000Z"),
                )
            other.commit()
        finally:
            other.close()
        scopes.attach(str(self.primary), "side", str(self.side))
        self.conn.commit()

    @staticmethod
    def label(conn: sqlite3.Connection, identity: str) -> None:
        conn.execute(
            "UPDATE work_items SET labels = ? WHERE work_item_id = ?",
            (json.dumps(["ui"]), identity),
        )

    def listed(self, **narrowed: list[str]) -> dict:
        """The window's read at the top, as the page opens it under its kind and label."""

        routing = PlanningRouting(self.conn, str(self.primary))
        kept = {name: values for name, values in narrowed.items() if values}
        parameters = {"scope_kind": ["global"], "status": ["pending"], **kept}
        return interactions.request_list(routing, parameters)

    # The two reads part here: the number counts the store this service writes, the window
    # every source. Which set «every space» is at the top waits for the owner's choice.
    @unittest.expectedFailure
    def test_the_window_at_the_top_lists_what_the_number_counts(self) -> None:
        # The case is what it says: the attached store holds open questions of its own.
        with closing(sqlite3.connect(self.side)) as side:
            waiting = side.execute(
                "SELECT COUNT(*) FROM work_item_requests WHERE status = 'pending'"
            ).fetchone()[0]
        self.assertEqual(2, waiting)
        for kinds, labels in (([], []), (["bug"], []), ([], ["ui"])):
            with self.subTest(kinds=kinds, labels=labels):
                answer = self.listed(task_kind=kinds, task_label=labels)
                read = self.volumes(kind=kinds, label=labels)
                self.assertEqual(read["counts"]["waiting_owner"]["count"], answer["total"])


if __name__ == "__main__":
    unittest.main()
