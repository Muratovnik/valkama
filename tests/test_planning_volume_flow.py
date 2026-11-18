"""The flow of the Volumes read: a scope's work day by day, and its pace.

The registry binds `app` to MAIN and `lib` to ALPHA (`test_planning_volumes`). Items
are placed straight in SQL with the moments each case needs; questions are asked and
answered through the real calls, a person's under the identity the HTTP surface binds
(`calls.browser()`), an agent's through its tool; commits are rows of the commit
tables. Each expected day is counted by hand from the moments written here, on the
clock of a caller three hours east of UTC unless a case says otherwise.
"""

from __future__ import annotations

import unittest
from datetime import UTC, datetime
from unittest import mock

from server import mcp_surface
from server.planning import api, calls, chain
from tests.test_planning_questions import CHOICE
from tests.test_planning_volumes import VolumesCase

#: The days of the period of `PERIOD`, on the caller's clock.
DAYS = tuple(f"2026-11-{day}" for day in range(10, 17))
MEASURES = ("created", "closed", "decisions", "commits")


class FlowCase(VolumesCase):
    def flow(self, space: str = "MAIN", **more: str) -> dict:
        return self.volumes(space, **more)["flow"]

    @staticmethod
    def busy(flow: dict) -> dict[str, dict[str, int]]:
        """The days with anything in them, each with its four counts."""

        return {
            day["day"]: {measure: day[measure] for measure in MEASURES}
            for day in flow["days"]
            if any(day[measure] for measure in MEASURES)
        }

    # -- questions -------------------------------------------------------------

    def ask(self, name: str) -> dict:
        space, _, short = name.partition(":")
        answer = mcp_surface.call_tool(
            self.conn,
            "create_work_item_request",
            {
                "id": self.trees[space].refs[short],
                "kind": "decision",
                "prompt": "Which way?",
                "fields": [CHOICE],
                "author": "asking-agent",
            },
        )
        self.conn.commit()
        return answer

    def by_person(self, operation: str, request: dict, **others: object) -> dict:
        path = f"/api/planning/request/{operation}"
        with calls.bind(calls.browser(), path):
            answer = api.handle_post(
                self.conn,
                path,
                {"id": request["request_id"], "expected_revision": request["revision"], **others},
            )
        self.conn.commit()
        assert answer is not None
        return answer[1]

    def by_agent(self, request: dict, path: str, **others: object) -> dict:
        answer = mcp_surface.call_tool(
            self.conn,
            "answer_work_item_request",
            {
                "id": request["request_id"],
                "answers": {"path": path},
                "expected_revision": request["revision"],
                "author": "an-agent",
                **others,
            },
        )
        self.conn.commit()
        return answer

    def closed_at(self, request: dict, stamp: str) -> None:
        """Put the moment a request was last answered or declined on the day the case needs."""

        self.conn.execute(
            "UPDATE work_item_requests SET resolved_at = ? WHERE request_id = ?",
            (stamp, request["request_id"]),
        )
        self.conn.commit()

    # -- commits ---------------------------------------------------------------

    def commit(
        self,
        project: str | None,
        hash_text: str,
        made: str,
        *,
        attached: tuple[str, ...] = (),
        rewritten_to: int | None = None,
    ) -> int:
        """A commit a session reported, made at `made`, attached to the named items."""

        found = self.conn.execute(
            "INSERT INTO commits(project_id, hash, committed_at, session_id, reported_at,"
            " rewritten_to) VALUES (?, ?, ?, 'sess-a', '2026-11-20T00:00:00Z', ?)",
            (project, hash_text, made, rewritten_to),
        ).lastrowid
        assert found is not None
        for identity in self.ids(*attached):
            self.conn.execute(
                "INSERT INTO work_item_commits(work_item_id, commit_id, attached_by)"
                " VALUES (?, ?, 'manual')",
                (identity, found),
            )
        return found


class DayTests(FlowCase):
    def test_days_count_the_store_in_the_callers_day(self) -> None:
        # Tasks: created and closed on both sides of the caller's midnight, 21:00 UTC.
        self.place("MAIN", "t1", state="triage", created="2026-11-10T21:30:00Z")
        self.place(
            "MAIN",
            "t2",
            state="done",
            created="2026-11-05T10:00:00Z",
            entries=("2026-11-12T20:59:00Z",),
        )
        self.place(
            "MAIN",
            "t3",
            state="cancelled",
            created="2026-11-12T22:00:00Z",
            entries=("2026-11-13T21:00:00Z",),
        )
        # Closed at 23:00 on the 9th for the caller, before the period.
        self.place(
            "MAIN",
            "t4",
            state="done",
            created="2026-11-01T10:00:00Z",
            entries=("2026-11-09T20:00:00Z",),
        )
        # Created at the period's end, which the period does not hold.
        self.place("MAIN", "t5", state="triage", created="2026-11-16T21:00:00Z")
        # A task of another space naming the space's project counts; one naming another does not.
        self.place(
            "ALPHA",
            "u",
            state="done",
            projects=("app",),
            created="2026-11-14T08:00:00Z",
            entries=("2026-11-15T09:00:00Z",),
        )
        self.place("ALPHA", "v", state="triage", projects=("lib",), created="2026-11-14T09:00:00Z")
        # Goals made and closed in the period are no work flowing.
        self.place("MAIN", "G", kind="goal", state="triage", created="2026-11-11T08:00:00Z")
        self.place(
            "MAIN",
            "H",
            kind="goal",
            state="done",
            created="2026-11-11T09:00:00Z",
            entries=("2026-11-12T10:00:00Z",),
        )
        self.conn.commit()

        # Two questions the owner closed in the interface, one an agent answered, and one
        # the owner answered on an item outside the scope.
        answered = self.by_person("answer", self.ask("MAIN:t1"), answers={"path": "keep"})
        self.closed_at(answered, "2026-11-11T12:00:00Z")
        declined = self.by_person("decline", self.ask("MAIN:t1"))
        self.closed_at(declined, "2026-11-13T21:30:00Z")
        by_agent = self.by_agent(self.ask("MAIN:t1"), "keep")
        self.closed_at(by_agent, "2026-11-12T12:00:00Z")
        outside = self.by_person("answer", self.ask("ALPHA:v"), answers={"path": "keep"})
        self.closed_at(outside, "2026-11-12T12:00:00Z")

        # Commits: made at their own offsets, attached, rewritten, of no known repository,
        # on no card of the space's project and of another space's.
        first = self.commit(
            "app", "a1" * 20, "2026-11-12T23:30:00+03:00", attached=("MAIN:t1", "MAIN:t2")
        )
        self.commit("app", "b2" * 20, "2026-11-13T22:00:00+05:00", attached=("ALPHA:u",))
        self.commit(None, "3f2a9c1", "2026-11-12T10:00:00Z", attached=("MAIN:t1",))
        self.commit(
            "app", "c3" * 20, "2026-11-12T10:00:00Z", attached=("MAIN:t1",), rewritten_to=first
        )
        self.commit("app", "d4" * 20, "2026-11-15T10:00:00Z")
        self.commit("lib", "e5" * 20, "2026-11-15T10:00:00Z")
        self.commit("app", "f6" * 20, "2026-11-14T10:00:00Z", attached=("ALPHA:v",))
        self.commit("app", "a7" * 20, "2026-11-09T20:00:00Z", attached=("MAIN:t1",))
        self.conn.commit()

        flow = self.flow()
        self.assertEqual(list(DAYS), [day["day"] for day in flow["days"]])
        quiet = dict.fromkeys(MEASURES, 0)
        self.assertEqual(
            {
                "2026-11-11": {**quiet, "created": 1, "decisions": 1},
                "2026-11-12": {**quiet, "closed": 1, "commits": 1},
                "2026-11-13": {**quiet, "created": 1, "commits": 1},
                "2026-11-14": {**quiet, "created": 1, "closed": 1, "decisions": 1},
                "2026-11-15": {**quiet, "closed": 1, "commits": 1},
            },
            self.busy(flow),
        )
        self.assertEqual({"created": 3, "closed": 3, "decisions": 2, "commits": 3}, flow["totals"])
        self.assertEqual(
            flow["totals"],
            {measure: sum(day[measure] for day in flow["days"]) for measure in MEASURES},
        )
        # Open now: t1 and t5 of the space; u is done, v outside it.
        self.assertEqual(2, flow["pace"]["open"])


class DecisionTests(FlowCase):
    def test_an_agents_answer_and_a_changed_one_are_no_decisions_of_the_owner(self) -> None:
        self.place("MAIN", "t", state="triage", created="2026-11-01T10:00:00Z")
        self.conn.commit()
        # The owner answers and then changes the answer: one decision, not two.
        changed = self.by_person("answer", self.ask("MAIN:t"), answers={"path": "keep"})
        changed = self.by_person("change", changed, answers={"path": "drop"})
        self.closed_at(changed, "2026-11-12T12:00:00Z")
        # An agent answers: no decision of the owner.
        agents = self.by_agent(self.ask("MAIN:t"), "keep")
        self.closed_at(agents, "2026-11-12T12:00:00Z")
        # The owner answers and an agent changes it: the latest call says whose it is.
        taken_over = self.by_person("answer", self.ask("MAIN:t"), answers={"path": "keep"})
        taken_over = self.by_agent(taken_over, "drop", change=True)
        self.closed_at(taken_over, "2026-11-12T12:00:00Z")
        self.assertEqual(
            {"2026-11-12": 1},
            {day["day"]: day["decisions"] for day in self.flow()["days"] if day["decisions"]},
        )


class PaceTests(FlowCase):
    def test_pace_is_the_chains_shape(self) -> None:
        self.place("MAIN", "G", kind="goal", state="container")
        self.place(
            "MAIN",
            "a",
            state="done",
            parent="G",
            created="2026-11-10T08:00:00Z",
            entries=("2026-11-12T23:30:00Z",),
        )
        self.place("MAIN", "b", state="ready", parent="G", created="2026-11-11T08:00:00Z")
        self.place(
            "MAIN",
            "c",
            state="cancelled",
            parent="G",
            created="2026-11-13T08:00:00Z",
            entries=("2026-11-14T08:00:00Z",),
        )
        self.place(
            "MAIN", "d", state="dev", parent="G", started=True, created="2026-11-14T23:30:00Z"
        )
        self.conn.commit()
        with mock.patch.object(chain, "utc_now", lambda: datetime(2026, 11, 15, 12, tzinfo=UTC)):
            read = chain.chain(self.conn, self.trees["MAIN"].refs["G"], "tree")
            pace = self.flow(utc_offset="0")["pace"]
        self.assertEqual(
            {"open": read["open"], "recent": read["recent"], "series": read["series"]}, pace
        )
        self.assertEqual(2, pace["open"])
        self.assertEqual({"days": 7, "created": 4, "closed": 2, "trend": "growing"}, pace["recent"])


if __name__ == "__main__":
    unittest.main()
