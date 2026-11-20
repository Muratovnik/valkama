"""The texts the service composes carry the key and values they were composed of.

A question's prompt and a decision's line are written in English for the agents and stored
with a key and its values beside them, which the answers carry as `prompt_message` and
`what_message`; a text an agent wrote carries none.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import store
from server.planning import (
    api,
    calls,
    composed,
    decisions,
    participation,
    read_model,
    service,
    tools,
)

AGENT = calls.Identity(calls.CONFIRMED, calls.CLAUDE_PAIR, session_id="session-a")


class ComposedTextTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Main", key="MAIN")
        self.conn.commit()
        self.space = read_model.space_identity(self.conn, "MAIN")

    def create(self, **fields: object) -> dict:
        with calls.bind(AGENT, "create_work_item"):
            answer = service.create_work_item(self.conn, space="MAIN", **fields)
        self.conn.commit()
        return answer

    def request(self, request_id: str) -> dict:
        status, body = api.handle_get(self.conn, "/api/planning/request", {"id": [request_id]}) or (
            0,
            {},
        )
        self.assertEqual(200, status, body)
        return body["request"]

    def marked(self) -> list[tuple[str, str, object]]:
        return [
            (entry["point"], entry["what"], entry["what_message"])
            for entry in decisions.page(self.conn, space=self.space)["items"]
        ]

    def test_the_question_about_a_goal_an_agent_proposes_carries_its_key(self) -> None:
        answer = self.create(title="Exports", kind="goal")
        reference = str(answer["reference"])
        request = self.request(answer["waits_for_owner"]["question"])
        self.assertEqual(
            f"An agent proposes the goal {reference}: Exports. Take it on, put it off, or drop it.",
            request["prompt"],
        )
        self.assertEqual(
            {"key": "goal_proposed", "values": {"reference": reference, "title": "Exports"}},
            request["prompt_message"],
        )

    def test_a_decision_the_agent_takes_itself_carries_its_key(self) -> None:
        participation.write_set(self.conn, self.space, participation.MINIMAL)
        self.conn.commit()
        goal = str(self.create(title="Exports", kind="goal")["reference"])
        task = str(self.create(title="Export the table", parent=goal)["reference"])
        self.assertEqual(
            [
                (
                    "task_in_goal",
                    f"accepted {task} under {goal}",
                    {
                        "key": "accepted",
                        "values": {"reference": task, "under": goal, "label": None},
                    },
                ),
                (
                    "proposed_goal",
                    f"accepted {goal}",
                    {
                        "key": "accepted",
                        "values": {"reference": goal, "under": None, "label": None},
                    },
                ),
            ],
            self.marked(),
        )

    def test_a_question_an_agent_writes_carries_no_key(self) -> None:
        reference = str(self.create(title="Export the table")["reference"])
        with calls.bind(AGENT, "create_work_item_request"):
            asked = tools.OPS["create_work_item_request"](
                self.conn,
                {
                    "id": reference,
                    "kind": "question",
                    "prompt": "Which table first?",
                    "fields": [
                        {
                            "id": "first",
                            "label": "First",
                            "type": "choice",
                            "required": True,
                            "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
                        }
                    ],
                },
            )
        self.conn.commit()
        request = self.request(str(asked["request_id"]))
        self.assertEqual(
            ("Which table first?", None), (request["prompt"], request["prompt_message"])
        )

    def test_a_key_or_values_it_does_not_define_are_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, "no composed text 'unknown'"):
            composed.question("unknown", "text")
        with self.assertRaisesRegex(ValueError, "group_asked takes the values"):
            composed.question("group_asked", "Group of 2 items: «T»", count=2)
        with self.assertRaisesRegex(ValueError, "closed takes the values"):
            composed.decision("closed", "close MAIN-3", reference="MAIN-3", under=None)


if __name__ == "__main__":
    unittest.main()
