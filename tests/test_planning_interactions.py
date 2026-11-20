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

import unittest

from server.planning import api, interactions, participation
from server.planning.routing import PlanningRouting
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


if __name__ == "__main__":
    unittest.main()
