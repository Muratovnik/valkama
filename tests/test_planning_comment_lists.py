"""A list under an agent's comment: a question the person may tick, which nobody waits for.

An agent reporting several findings offers them as a list under its own comment.
The expectations come from the connection contract, "A list on a comment": the
comment and its list are one write; a list is a question of one `multi_choice`
field and reads as one where its item is read; it raises no alert, is not in the
interface's read of what waits for the person, holds no close, freezes with its
item, and goes with its comment in a merge.

An agent writes through `mcp_surface.call_tool` with a proved session, a person
through the HTTP boundary as the browser binds it, and each write is committed as
its surface commits it.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import mcp_surface, store
from server.planning import api, calls, interactions, model, requests, service
from server.planning.routing import PlanningRouting
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_binding, project_entry, registry_bytes

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
CHILD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
AGENT = {"sessionId": SESSION}
SUBAGENT = {"sessionId": SESSION, "threadId": CHILD}
OPTIONS = [
    {"id": "a", "label": "Widen the check", "recommended": True},
    {"id": "b", "label": "Fix the docs", "description": "The two pages that name it."},
]
LIST = {"label": "What to take on", "options": OPTIONS}
SUMMARY = {"done": "Found five places", "next": "The owner ticks what to take on"}
#: The refusals, word for word as the contract gives them.
ON_A_REPLY = "a list stands on a root, and this is a reply"
SHAPE = "list requires label and options and takes nothing else"
CLOSING = (
    "transition: a list on an item this call closes could never be answered;"
    " send it to review, or leave the list out"
)


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.db = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.db})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="p", name="Quality", key="MAIN")
        self.ref = self.item("Check the checks")
        self.conn.commit()

    def item(self, title: str) -> str:
        return str(service.create_work_item(self.conn, space="MAIN", title=title)["reference"])

    def agent(self, tool: str, *, meta: object = AGENT, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, tool, arguments, meta=meta)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def refused(self, tool: str, **arguments: object) -> dict:
        """The error body a surface answers with, after committing what a refusal left."""

        with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught:
            mcp_surface.call_tool(self.conn, tool, arguments, meta=AGENT)
        self.conn.commit()
        error = api.error_response(caught.exception)[1]["error"]
        assert isinstance(error, dict)
        return error

    def person(self, path: str, **payload: object) -> dict:
        with calls.bind(calls.browser(), path):
            answer = api.handle_post(self.conn, path, payload)
        self.conn.commit()
        assert answer is not None
        return answer[1]

    def listed(self, body: str = "Found five places where the check misfires.") -> dict:
        return self.agent("comment_work_item", id=self.ref, body=body, list=LIST)

    def counts(self) -> list[int]:
        """Comments, requests and request events: what a refused list must not leave."""

        return [
            int(self.conn.execute(query).fetchone()[0])
            for query in (
                "SELECT COUNT(*) FROM work_item_comments",
                "SELECT COUNT(*) FROM work_item_requests",
                "SELECT COUNT(*) FROM work_item_events WHERE action = 'request_created'",
            )
        ]

    def request(self, request_id: str) -> dict:
        return requests.get(self.conn, request_id)

    def move(self, state: str) -> None:
        self.person("/api/planning/work-item/transition", id=self.ref, state=state, force=True)


class WritingTests(Harness):
    def test_a_comment_and_its_list_are_one_write_and_the_list_is_a_question(self) -> None:
        written = self.listed()
        record = self.request(written["list_request_id"])
        self.assertEqual(written["comment_id"], record["comment_id"])
        self.assertEqual(("question", "What to take on"), (record["kind"], record["prompt"]))
        self.assertEqual(
            [
                {
                    "id": "items",
                    "label": "What to take on",
                    "type": "multi_choice",
                    "required": False,
                    "options": OPTIONS,
                }
            ],
            record["fields"],
        )
        self.assertEqual("pending", record["status"])
        # One call wrote both: the comment and the question's event name the same call row.
        calls_used = self.conn.execute(
            "SELECT DISTINCT call_id FROM work_item_comments WHERE id = ?"
            " UNION SELECT DISTINCT call_id FROM work_item_events WHERE detail = ?",
            (written["comment_id"], written["list_request_id"]),
        ).fetchall()
        self.assertEqual(1, len(calls_used))

    def test_a_list_refused_after_its_comment_was_written_takes_the_comment_back(self) -> None:
        """The item is closed: the comment goes in first, the list is refused, neither stays."""

        self.move("cancelled")
        before = self.counts()
        error = self.refused("comment_work_item", id=self.ref, body="Findings", list=LIST)
        self.assertEqual("invalid_request", error["code"])
        self.assertIn("a list on a closed item could never be answered", error["message"])
        self.assertEqual(before, self.counts())
        self.agent("comment_work_item", id=self.ref, body="Findings")
        self.assertEqual(before[0] + 1, self.counts()[0], "positive control: a comment alone")

    def test_the_refusals_say_what_the_contract_says_and_write_nothing(self) -> None:
        root = self.agent("comment_work_item", id=self.ref, body="A root")["comment_id"]
        before = self.counts()
        too_many = [{"id": f"o{index}", "label": f"Option {index}"} for index in range(21)]
        cases = {
            "a reply": ({"reply_to": root, "list": LIST}, ON_A_REPLY),
            "21 options": ({"list": {"label": "Many", "options": too_many}}, SHAPE),
            "no options": ({"list": {"label": "None", "options": []}}, SHAPE),
            "a key it does not take": ({"list": {**LIST, "fields": []}}, SHAPE),
            "no label": ({"list": {"options": OPTIONS}}, SHAPE),
        }
        for case, (arguments, message) in cases.items():
            with self.subTest(case):
                error = self.refused("comment_work_item", id=self.ref, body="Findings", **arguments)
                self.assertEqual(("invalid_request", message), (error["code"], error["message"]))
                self.assertEqual(before, self.counts())
        # Twenty is the limit, not past it.
        twenty = self.agent(
            "comment_work_item",
            id=self.ref,
            body="Twenty",
            list={"label": "Many", "options": too_many[:20]},
        )
        self.assertIn("list_request_id", twenty)

    def test_a_report_and_a_summary_carry_a_list_under_themselves(self) -> None:
        reported = self.agent("report_work_item", id=self.ref, report=SUMMARY, list=LIST)
        self.assertEqual(
            reported["comment_id"], self.request(reported["list_request_id"])["comment_id"]
        )
        summarized = self.agent("set_work_item_summary", id=self.ref, summary=SUMMARY, list=LIST)
        self.assertEqual(
            summarized["summary_comment_id"],
            self.request(summarized["list_request_id"])["comment_id"],
        )
        plain = self.agent("report_work_item", id=self.ref, report=SUMMARY)
        self.assertNotIn("list_request_id", plain)

    def test_a_batch_names_the_list_of_each_comment_and_of_its_summary(self) -> None:
        answer = self.agent(
            "apply_work_item_changes",
            id=self.ref,
            comments=[{"body": "First", "list": LIST}, {"body": "Second"}],
            summary={**SUMMARY, "list": LIST},
        )
        first, second = answer["applied"]["comments"]
        self.assertEqual(first["comment_id"], self.request(first["list_request_id"])["comment_id"])
        self.assertNotIn("list_request_id", second)
        summary = answer["applied"]["summary"]
        self.assertEqual(
            summary["summary_comment_id"], self.request(summary["list_request_id"])["comment_id"]
        )
        single = self.agent(
            "apply_work_item_changes", id=self.ref, comment={"body": "One", "list": LIST}
        )["applied"]["comment"]
        self.assertEqual(
            single["comment_id"], self.request(single["list_request_id"])["comment_id"]
        )

    def test_a_list_in_the_call_that_closes_its_item_is_refused_whole(self) -> None:
        before = (self.counts(), service.get_work_item(self.conn, self.ref)["state"]["key"])
        for groups in (
            {"comment": {"body": "Findings", "list": LIST}, "summary": SUMMARY},
            {"comments": [{"body": "Findings", "list": LIST}], "summary": SUMMARY},
            {"summary": {**SUMMARY, "list": LIST}},
        ):
            with self.subTest(groups=sorted(groups)):
                error = self.refused(
                    "apply_work_item_changes",
                    id=self.ref,
                    transition={"state": "cancelled", "force": True},
                    **groups,
                )
                self.assertEqual(("invalid_request", CLOSING), (error["code"], error["message"]))
                self.assertEqual({"group": "transition", "index": 0}, error["step"])
                self.assertEqual(
                    before,
                    (self.counts(), service.get_work_item(self.conn, self.ref)["state"]["key"]),
                )
        moved = self.agent(
            "apply_work_item_changes",
            id=self.ref,
            comment={"body": "Findings", "list": LIST},
            transition={"state": "review", "force": True},
        )
        self.assertEqual("review", moved["state"]["key"], "review keeps it open, and the list")


class WaitsForNobodyTests(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.registry = self.root / "projects.json"
        space_ref = {"data_scope_id": read_store_metadata(self.conn)["data_scope_id"]}
        space_ref["space_key"] = "MAIN"
        self.space_ref = space_ref
        self.registry.write_bytes(
            registry_bytes(
                [
                    project_entry(
                        "p",
                        self.root,
                        bindings=[project_binding("p", planning_space_entity(space_ref))],
                    )
                ]
            )
        )

    def hub(self, **extra: str) -> list[str]:
        """The interface's read of open questions, by request id."""

        routing = PlanningRouting(self.conn, self.db, registry_reader=self.registry.read_bytes)
        parameters = {"status": ["pending"], **{key: [value] for key, value in extra.items()}}
        answer = interactions.request_list(routing, parameters)
        return [entry["request"]["request_id"] for entry in answer["items"]]

    def scoped(self, **extra: str) -> dict[str, str]:
        return {
            "scope_kind": "project",
            "project_id": "p",
            "data_scope_id": self.space_ref["data_scope_id"],
            "space_key": "MAIN",
            **extra,
        }

    def ask(self) -> str:
        field = {"id": "why", "label": "Why", "type": "text", "required": True, "options": []}
        return str(
            self.agent(
                "create_work_item_request",
                id=self.ref,
                kind="question",
                prompt="Why?",
                fields=[field],
            )["request_id"]
        )

    def test_the_read_of_what_waits_leaves_a_list_out_and_the_items_read_keeps_it(self) -> None:
        listed = self.listed()["list_request_id"]
        asked = self.ask()
        self.assertEqual([asked], self.hub(scope_kind="global"))
        self.assertEqual([asked], self.hub(**self.scoped()))
        self.assertEqual(
            sorted([asked, listed]), sorted(self.hub(**self.scoped(reference=self.ref)))
        )
        questions = self.agent("get_work_item", id=self.ref)["questions"]
        self.assertEqual(2, questions["open"], "on its item a pending list counts as open")
        shown = {entry["id"]: entry for entry in questions["items"]}
        self.assertEqual(shown[listed]["comment_id"], self.request(listed)["comment_id"])
        self.assertNotIn("comment_id", shown[asked], "the compact form names it on a list only")
        self.assertIsNone(self.request(asked)["comment_id"], "a whole read says null")

    def test_no_open_row_is_a_list(self) -> None:
        identity = str(service.get_work_item(self.conn, self.ref)["work_item_id"])
        self.listed()
        self.assertEqual([], requests.open_rows(self.conn, identity))
        self.assertEqual([], requests.open_rows(self.conn))
        asked = self.ask()
        self.assertEqual([asked], [row["request_id"] for row in requests.open_rows(self.conn)])

    def test_closing_the_item_passes_freezes_the_list_and_reopening_thaws_it(self) -> None:
        listed = self.listed()["list_request_id"]
        closed = self.agent(
            "apply_work_item_changes",
            id=self.ref,
            summary=SUMMARY,
            transition={"state": "cancelled", "force": True},
        )
        self.assertEqual("cancelled", closed["state"]["key"])
        frozen = self.request(listed)
        self.assertEqual(("expired", "task_closed"), (frozen["status"], frozen["expired_reason"]))
        stored = self.conn.execute(
            "SELECT status FROM work_item_requests WHERE request_id = ?", (listed,)
        ).fetchone()[0]
        self.assertEqual("pending", stored, "nothing is written: it reads expired")
        self.move("dev")
        thawed = self.request(listed)
        self.assertEqual(("pending", None), (thawed["status"], thawed["expired_reason"]))

    def test_an_answered_list_on_a_closed_item_cannot_be_changed(self) -> None:
        listed = self.request(self.listed()["list_request_id"])
        answered = self.person(
            "/api/planning/request/answer",
            id=listed["request_id"],
            expected_revision=listed["revision"],
            answers={"items": ["a"]},
        )
        self.assertEqual({"items": ["a"]}, answered["answers"])
        self.move("cancelled")
        with self.assertRaisesRegex(model.WorkflowGuardError, r"\[task_closed\]"):
            self.person(
                "/api/planning/request/change",
                id=listed["request_id"],
                expected_revision=answered["revision"],
                answers={"items": ["a", "b"]},
            )


class MergeTests(Harness):
    def test_a_list_goes_with_its_comment_and_a_reports_list_stays_with_the_report(self) -> None:
        survivor = self.item("The survivor")
        self.conn.commit()
        rooted = self.listed()
        reply = self.person(
            "/api/planning/work-item/comment",
            id=self.ref,
            body="Why b?",
            reply_to_request=rooted["list_request_id"],
        )
        reported = self.agent("report_work_item", id=self.ref, report=SUMMARY, list=LIST)
        on_report = self.person(
            "/api/planning/work-item/comment",
            id=self.ref,
            body="And the report's list?",
            reply_to_request=reported["list_request_id"],
        )
        asked = self.agent(
            "create_work_item_request",
            id=self.ref,
            kind="question",
            prompt="Which?",
            fields=[{"id": "w", "label": "W", "type": "text", "required": True, "options": []}],
        )
        merged = self.agent("merge_work_items", id=survivor, items=[self.ref], reason="One change")
        survivor_id = str(service.get_work_item(self.conn, survivor)["work_item_id"])
        merged_id = str(service.get_work_item(self.conn, self.ref)["work_item_id"])

        def where_request(request_id: str) -> str:
            return str(self.request(request_id)["work_item_id"])

        def where_comment(comment_id: int) -> str:
            return str(
                self.conn.execute(
                    "SELECT work_item_id FROM work_item_comments WHERE id = ?", (comment_id,)
                ).fetchone()[0]
            )

        self.assertEqual(survivor_id, where_request(rooted["list_request_id"]))
        self.assertEqual(survivor_id, where_comment(rooted["comment_id"]))
        self.assertEqual(survivor_id, where_comment(reply["comment_id"]))
        self.assertEqual(merged_id, where_request(reported["list_request_id"]))
        self.assertEqual(merged_id, where_comment(reported["comment_id"]))
        self.assertEqual(merged_id, where_comment(on_report["comment_id"]))
        self.assertEqual(survivor_id, where_request(asked["request_id"]), "a question moves")
        # The warning counts what waits on the survivor: the question, not the list.
        self.assertIn(
            f"{self.ref}'s 1 pending request(s) now wait on {survivor}", merged["warnings"]
        )


if __name__ == "__main__":
    unittest.main()
