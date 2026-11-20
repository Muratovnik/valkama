"""The summary of agent decisions: a mark on an event, and the read the owner pages through.

The rows each read must give are written out here from the events the case lays down,
by their point, item and time, rather than read back from the module; the session
is spelled as the contract spells a holder.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from collections.abc import Mapping
from unittest import mock

from server import store
from server.planning import (
    api,
    calls,
    decisions,
    item_projects,
    model,
    participation,
    questions,
    read_model,
    service,
    tools,
)
from server.planning import store as planning_store
from tests.web_lists import WEB_API, web_list

PATH = "/api/planning/decisions"
AGENT = calls.Identity(calls.CONFIRMED, calls.CLAUDE_PAIR, session_id="session-a")
#: How the summary names the agent's session: as a holder is named.
SESSION = "claude (session session-a)"
DAY_ONE = "2026-11-15"
DAY_TWO = "2026-11-16"
#: Where the web lists the decision points its strict reader accepts.
WEB_POINTS = WEB_API / "planningDecisionPoints.ts"


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        for name, key in (("Alpha", "ALPHA"), ("Beta", "BETA")):
            service.create_planning_space(self.conn, name=name, key=key)
        self.conn.commit()
        self.ids: dict[str, str] = {}
        self.titles: dict[str, str] = {}

    def item(self, space: str, title: str, projects: list[str]) -> str:
        """A task an agent filed, naming `projects`; answers its reference."""

        with calls.bind(AGENT, "create_work_item"):
            created = service.create_work_item(self.conn, space=space, title=title)
        reference = str(created["reference"])
        self.ids[reference] = str(created["work_item_id"])
        self.titles[reference] = title
        item_projects.replace(self.conn, self.ids[reference], projects)
        self.conn.commit()
        return reference

    def event(self, reference: str, action: str, at: str) -> int:
        """One event on the item at `at`, in the agent's call that filed it."""

        cursor = self.conn.execute(
            "INSERT INTO work_item_events(work_item_id, action, detail, author, created_at,"
            " call_id) SELECT work_item_id, ?, '', 'claude', ?, call_id FROM work_item_events"
            " WHERE work_item_id = ? AND action = 'created'",
            (action, at, self.ids[reference]),
        )
        self.conn.commit()
        return int(cursor.lastrowid or 0)

    def read(self, **query: object) -> dict:
        parameters = {
            name: [str(value) for value in values] if isinstance(values, list) else [str(values)]
            for name, values in query.items()
        }
        status, body = api.handle_get(self.conn, PATH, parameters) or (0, {})
        self.assertEqual(200, status)
        return body

    def refused(self, query: Mapping[str, list[str]]) -> tuple[int, dict]:
        with self.assertRaises(Exception) as caught:
            api.handle_get(self.conn, PATH, query)
        status, body = api.error_response(caught.exception)
        return status, body["error"]

    def marks(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute("SELECT event_id, point, what FROM agent_decisions")
        ]


class SummaryTests(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.a1 = self.item("ALPHA", "One table for both scopes", ["app"])
        self.a2 = self.item("ALPHA", "Retire the old route", ["lib"])
        self.b1 = self.item("BETA", "Pages for the open questions", ["app"])
        #: Each point, the item, the action it marks, when, and what the point wrote.
        laid = [
            ("finding", self.a1, "accepted", f"{DAY_ONE}T09:00:00Z", "accepted the finding"),
            ("proposed_goal", self.a2, "accepted", f"{DAY_ONE}T10:00:00Z", "accepted the goal"),
            ("task_in_goal", self.b1, "accepted", f"{DAY_ONE}T11:00:00Z", "accepted in the goal"),
            ("decision", self.a1, "request_answered", f"{DAY_ONE}T12:00:00Z", "chose one table"),
            ("cancel_outside", self.a2, "transitioned", f"{DAY_ONE}T13:00:00Z", "cancel it"),
            ("cancel_shared", self.b1, "transitioned", f"{DAY_TWO}T09:00:00Z", "cancel the goal"),
            ("condition", self.a1, "checklist_replaced", f"{DAY_TWO}T10:00:00Z", "removed step"),
            ("goal_close", self.a2, "transitioned", f"{DAY_TWO}T11:00:00Z", "closed the goal"),
            ("goal_defer", self.b1, "transitioned", f"{DAY_TWO}T12:00:00Z", "put off the goal"),
            ("assignment", self.a1, "accepted", f"{DAY_TWO}T13:00:00Z", "accepted as assigned"),
        ]
        self.rows: dict[str, dict] = {}
        for point, reference, action, at, what in laid:
            event = self.event(reference, action, at)
            decisions.mark(self.conn, event, point, what)
            self.rows[point] = {
                "at": at,
                "point": point,
                "item": {
                    "reference": reference,
                    "title": self.titles[reference],
                    "space": reference.split("-")[0],
                    "projects": ["app"] if reference in (self.a1, self.b1) else ["lib"],
                },
                "session": SESSION,
                "what": what,
                "event_id": event,
            }
        self.conn.commit()
        # A later event of the same session that no point marked.
        self.event(self.a1, "transitioned", f"{DAY_TWO}T14:00:00Z")

    def points(self, body: Mapping[str, list[dict]]) -> list[str]:
        return [str(row["point"]) for row in body["items"]]

    def test_every_decision_an_agent_took_is_in_the_summary(self) -> None:
        newest_first = [
            "assignment",
            "goal_defer",
            "goal_close",
            "condition",
            "cancel_shared",
            "cancel_outside",
            "decision",
            "task_in_goal",
            "proposed_goal",
            "finding",
        ]
        everything = self.read()
        self.assertEqual(
            {
                "items": [self.rows[point] for point in newest_first],
                "total": 10,
                "has_more": False,
            },
            everything,
        )
        in_alpha = [point for point in newest_first if point not in self.points_of(self.b1)]
        self.assertEqual(in_alpha, self.points(self.read(space="ALPHA")))
        self.assertEqual(7, self.read(space="ALPHA")["total"])
        # Each filter narrows what the space gives.
        self.assertEqual(
            ["assignment", "condition", "decision", "finding"],
            self.points(self.read(space="ALPHA", project="app")),
        )
        self.assertEqual(
            [
                "assignment",
                "goal_defer",
                "condition",
                "cancel_shared",
                "decision",
                "task_in_goal",
                "finding",
            ],
            self.points(self.read(project="app")),
        )
        self.assertEqual(
            ["condition", "decision"],
            self.points(self.read(space="ALPHA", point=["decision", "condition"])),
        )
        self.assertEqual(
            ["assignment", "goal_close", "condition"],
            self.points(self.read(space="ALPHA", **{"from": DAY_TWO})),
        )
        self.assertEqual(
            ["cancel_outside", "decision", "proposed_goal", "finding"],
            self.points(self.read(space="ALPHA", to=DAY_ONE)),
        )
        # A timestamp names its moment, in any timezone; both ends are taken in.
        self.assertEqual(
            ["assignment", "goal_close"],
            self.points(self.read(space="ALPHA", **{"from": f"{DAY_TWO}T14:00:00+03:00"})),
        )
        self.assertEqual(
            ["decision", "proposed_goal", "finding"],
            self.points(self.read(space="ALPHA", to=f"{DAY_ONE}T12:00:00Z")),
        )
        self.assertEqual(
            ["decision"],
            self.points(
                self.read(
                    space="ALPHA",
                    project="app",
                    **{"from": f"{DAY_ONE}T10:00:00Z", "to": f"{DAY_ONE}T12:00:00Z"},
                )
            ),
        )
        # Pages, newest first, and whether more follow.
        pages = [self.read(space="ALPHA", limit=3, offset=offset) for offset in (0, 3, 6)]
        self.assertEqual(
            [
                (["assignment", "goal_close", "condition"], 7, True),
                (["cancel_outside", "decision", "proposed_goal"], 7, True),
                (["finding"], 7, False),
            ],
            [(self.points(page), page["total"], page["has_more"]) for page in pages],
        )
        # The full record of the item: a marked event carries its point, any other none.
        status, body = api.handle_get(self.conn, "/api/planning/work-item", {"id": [self.a1]}) or (
            0,
            {},
        )
        self.assertEqual(200, status)
        events = body["work_item"]["events"]
        self.assertEqual(
            [
                ("created", None),
                ("accepted", "finding"),
                ("request_answered", "decision"),
                ("checklist_replaced", "condition"),
                ("accepted", "assignment"),
                ("transitioned", None),
            ],
            [(event["action"], event.get("point", None)) for event in events],
        )
        unmarked = [event for event in events if event["action"] in ("created", "transitioned")]
        self.assertTrue(all("point" not in event for event in unmarked))

    def points_of(self, reference: str) -> set[str]:
        return {point for point, row in self.rows.items() if row["item"]["reference"] == reference}

    def test_a_mark_goes_with_its_event_and_its_item(self) -> None:
        marked = self.rows["goal_close"]["event_id"]
        self.conn.execute("DELETE FROM work_item_events WHERE id = ?", (marked,))
        self.conn.commit()
        self.assertNotIn("goal_close", self.points(self.read()))
        self.assertEqual(9, len(self.marks()))
        with calls.bind(calls.browser(), "delete"):
            service.delete_work_item(self.conn, self.a1)
        self.conn.commit()
        self.assertEqual(
            ["goal_defer", "cancel_shared", "cancel_outside", "task_in_goal", "proposed_goal"],
            self.points(self.read()),
        )
        self.assertEqual(5, len(self.marks()))

    def test_the_read_refuses_what_it_cannot_answer(self) -> None:
        self.assertEqual(10, len(self.read(limit=200)["items"]))
        self.assertEqual(
            {"items": [], "total": 10, "has_more": False}, self.read(limit=1, offset=10)
        )
        for query, message in (
            ({"limit": ["0"]}, "limit must be from 1 to 200"),
            ({"limit": ["201"]}, "limit must be from 1 to 200"),
            ({"limit": ["many"]}, "limit must be an integer"),
            ({"offset": ["-1"]}, "offset must be a non-negative integer"),
            ({"point": ["decision", "choice"]}, "point must be one of"),
            ({"from": ["yesterday"]}, "from must be a day or an ISO timestamp"),
            ({"to": ["2026-02-30"]}, "to must be a day or an ISO timestamp"),
            ({"from": [f"{DAY_ONE}T10:00:00"]}, "from must include a timezone"),
            ({"space": ["ALPHA", "BETA"]}, "space must occur at most once"),
            ({"space": ["GAMMA"]}, "no planning space named GAMMA"),
        ):
            with self.subTest(query=query):
                status, error = self.refused(query)
                self.assertEqual((400, "invalid_request"), (status, error["code"]))
                self.assertIn(message, error["message"])


class MarkTests(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.reference = self.item("ALPHA", "One table for both scopes", ["app"])
        self.accepted = self.event(self.reference, "accepted", f"{DAY_ONE}T09:00:00Z")

    def test_a_mark_stands_only_on_the_event_its_point_marks(self) -> None:
        created = int(
            self.conn.execute(
                "SELECT id FROM work_item_events WHERE action = 'created'"
            ).fetchone()[0]
        )
        for event, point, what in (
            (created, "proposed_goal", "accepted the goal"),
            (self.accepted, "decision", "chose one table"),
            (self.accepted, "queue", "took the next"),
            (self.accepted + 100, "proposed_goal", "accepted the goal"),
            (self.accepted, "proposed_goal", "   "),
        ):
            with self.subTest(point=point, event=event, what=what):
                with self.assertRaises(ValueError):
                    decisions.mark(self.conn, event, point, what)
        self.assertEqual([], self.marks())
        decisions.mark(self.conn, self.accepted, "proposed_goal", "accepted the goal")
        with self.assertRaises(sqlite3.IntegrityError):
            decisions.mark(self.conn, self.accepted, "assignment", "accepted as assigned")
        self.assertEqual([(self.accepted, "proposed_goal", "accepted the goal")], self.marks())

    def test_a_long_what_is_cut_to_its_limit(self) -> None:
        decisions.mark(self.conn, self.accepted, "finding", "removed step " + "x" * 400)
        [(_event, _point, what)] = self.marks()
        self.assertEqual(300, len(what))
        self.assertEqual("removed step " + "x" * 286 + "…", what)


#: A decision with a recommendation in every required field: a choice, a verdict, an
#: optional multi_choice that recommends two of its options, an optional text that
#: recommends nothing, and an optional choice under the option not recommended.
DECISION = [
    {
        "id": "scope",
        "label": "Scope",
        "type": "choice",
        "required": True,
        "options": [
            {"id": "small", "label": "Small"},
            {"id": "full", "label": "One table for both scopes", "recommended": True},
        ],
    },
    {
        "id": "check",
        "label": "The migration check",
        "type": "verdict",
        "required": True,
        "options": [],
        "recommended": "accept",
    },
    {
        "id": "extras",
        "label": "Extras",
        "type": "multi_choice",
        "required": False,
        "options": [
            {"id": "docs", "label": "Docs", "recommended": True},
            {"id": "bench", "label": "Bench"},
            {"id": "probe", "label": "Probe", "recommended": True},
        ],
    },
    {"id": "remark", "label": "Remark", "type": "text", "required": False, "options": []},
    {
        "id": "size",
        "label": "Size",
        "type": "choice",
        "required": False,
        "options": [{"id": "s", "label": "S", "recommended": True}, {"id": "m", "label": "M"}],
        "under": {"field": "scope", "option": "small"},
    },
]
#: What the recommendations answer: every field shown that recommends something.
RECOMMENDED = {"scope": "full", "check": "accept", "extras": ["docs", "probe"]}
NOTE = "Decided by its recommendation: the owner's setting leaves this choice to the agent."
CHOSE = "chose «One table for both scopes», «The migration check: accept», «Docs», «Probe»"


class DecisionRowTests(Harness):
    """An agent's decision for the owner: answered by its recommendation where the owner's
    setting leaves decisions to the agent, waiting for the owner where it does not, and
    refused at any setting while a required field recommends nothing."""

    def setUp(self) -> None:
        super().setUp()
        self.space = read_model.space_identity(self.conn, "ALPHA")
        self.reference = self.item("ALPHA", "One table for both scopes", ["app"])

    def at(self, name: str) -> None:
        participation.write_set(self.conn, self.space, name)
        self.conn.commit()

    def tool(self, name: str, **arguments: object) -> dict:
        try:
            with calls.bind(AGENT, name):
                answer = tools.OPS[name](self.conn, arguments)
        except BaseException:
            self.conn.rollback()
            raise
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def decide(self, fields: list[dict] = DECISION, kind: str = "decision") -> dict:
        return self.tool(
            "create_work_item_request",
            id=self.reference,
            kind=kind,
            prompt="How far does the change go?",
            fields=fields,
        )

    def owners_list(self) -> list[str]:
        return [str(row["request_id"]) for row in questions.open_rows(self.conn)]

    def decided(self) -> list[tuple[str, str, str]]:
        return [
            (entry["point"], entry["item"]["reference"], entry["what"])
            for entry in decisions.page(self.conn, space=self.space)["items"]
        ]

    def counts(self) -> tuple[int, int, int]:
        return tuple(  # type: ignore[return-value]
            int(self.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            for table in ("work_item_requests", "work_item_events", "agent_decisions")
        )

    def test_a_decision_the_agent_may_take_is_answered_by_its_recommendation(self) -> None:
        self.at(participation.MINIMAL)
        record = self.decide()
        self.assertEqual(
            ("answered", RECOMMENDED, NOTE, SESSION, 1),
            tuple(
                record[name]
                for name in ("status", "answers", "note", "answered_by", "answer_version")
            ),
        )
        self.assertEqual([], self.owners_list())
        self.assertEqual([("decision", self.reference, CHOSE)], self.decided())
        # The mark stands on the event that recorded the answer, in the agent's call.
        [entry] = decisions.page(self.conn, space=self.space)["items"]
        marked = self.conn.execute(
            "SELECT action, detail FROM work_item_events WHERE id = ?", (entry["event_id"],)
        ).fetchone()
        self.assertEqual(("request_answered", record["request_id"]), tuple(marked))
        self.assertEqual(SESSION, entry["session"])
        # Asked in a batch, it comes back answered in the batch's questions too.
        answer = self.tool(
            "apply_work_item_changes",
            id=self.reference,
            questions=[{"kind": "decision", "prompt": "And the second?", "fields": DECISION}],
        )
        [asked] = answer["applied"]["questions"]
        self.assertEqual(
            ("answered", RECOMMENDED, NOTE),
            (asked["status"], asked["answers"], asked["note"]),
        )
        self.assertEqual([], self.owners_list())
        self.assertEqual(2, len(self.decided()))

    def test_a_decision_waits_for_the_owner_by_default(self) -> None:
        record = self.decide()
        self.assertEqual(
            ("pending", None, None), (record["status"], record["answers"], record["note"])
        )
        self.assertEqual([record["request_id"]], self.owners_list())
        self.assertEqual([], self.decided())
        answer = self.tool(
            "apply_work_item_changes",
            id=self.reference,
            questions=[{"kind": "decision", "prompt": "And the second?", "fields": DECISION}],
        )
        [asked] = answer["applied"]["questions"]
        self.assertEqual({"request_id", "revision"}, set(asked))
        self.assertEqual(2, len(self.owners_list()))

    def test_a_decision_without_a_recommendation_is_refused_at_any_setting(self) -> None:
        unrecommended = [
            {"id": "ship", "label": "Ship it", "type": "boolean", "required": True, "options": []},
            DECISION[0],
            {**DECISION[0], "id": "road", "options": [{"id": "a", "label": "A"}]},
            {**DECISION[1], "id": "verdict"},
        ]
        del unrecommended[3]["recommended"]
        for name in (participation.MINIMAL, participation.DEFAULT):
            self.at(name)
            before = self.counts()
            with self.subTest(set=name):
                with self.assertRaises(model.PlanningError) as refused:
                    self.decide(unrecommended)
                status, body = api.error_response(refused.exception)
                self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))
                self.assertEqual(
                    "[decision] a decision recommends an answer in every required field:"
                    " ship, road, verdict; ask a question when there is nothing to recommend",
                    body["error"]["message"],
                )
                self.assertEqual(before, self.counts())
        # The rule is the decision's: a question with the same fields is asked.
        self.assertEqual("pending", self.decide(unrecommended, kind="question")["status"])


class WebPointTests(unittest.TestCase):
    def test_the_web_lists_every_decision_point_the_store_holds(self) -> None:
        # The web's strict reader refuses a `point` its list lacks, so the two lists move together.
        self.assertEqual(
            set(planning_store.DECISION_POINTS), set(web_list(WEB_POINTS, "DECISION_POINTS"))
        )


if __name__ == "__main__":
    unittest.main()
