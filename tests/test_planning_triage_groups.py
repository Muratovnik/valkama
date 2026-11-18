"""A triage review's group: tasks of the triage stack proposed together as one new goal.

The expectations come from the contract of the step `group` of a creation: the goal is
created in triage and the tasks move under it at once; who decides is read from both
settings the group meets, `finding` and `proposed_goal`, and for `drop` from
`cancel_outside` as well when a task lies outside the agent's own work; the agent's
answer is carried out in the same call, with one mark of the summary of decisions at
`finding`, or waits for the owner on an action of kind `group` and the question
`triage`, which holds the tasks under it from a claim, a move and a label's rule. A
group outside its form or naming a task that does not wait in the stack is refused
whole, with nothing created and no number spent.
"""

from __future__ import annotations

import functools
import json
import unittest

from server.planning import api, calls, participation, pending, service, triage
from tests.test_planning_pending_actions import AGENT, OTHER, REFUSED, SettingHarness

#: Why the agent groups its findings.
WHY = "They are one change to the export"
#: The longest why a group takes, as the contract states it: 386 characters, which is the
#: defer reason's 400 less `agent: later: `. Written as the contract's number on purpose.
LONGEST_WHY = "x" * 386
#: The conditions of a group's goal.
CONDITIONS = ["The export writes every field"]


class GroupHarness(SettingHarness):
    """Findings filed by another session, and the agent's group of them."""

    def findings(self, count: int, by: calls.Identity = OTHER) -> list[str]:
        """`count` tasks with no parent lying in triage, filed by `by`."""

        found = [self.filed(f"Finding {index}", by=by) for index in range(1, count + 1)]
        for reference in found:
            self.assertEqual(("triage", None, None), self.where(reference))
        return found

    def group(self, items: list[str], answer: str = "do", **more: object) -> dict:
        """The agent's goal grouping `items`, through its tool, and the answer."""

        title = more.pop("title", "Export fixes")
        payload: dict[str, object] = {
            "space": "ALPHA",
            "title": title,
            "kind": "goal",
            "checklist": CONDITIONS,
            "group": {"items": items, "answer": answer, "why": WHY, **more.pop("group", {})},
            **more,
        }
        return self.tool("create_work_item", **payload)

    def where(self, reference: str) -> tuple[str | None, str | None, str | None]:
        """The category, the basis and the parent of an item."""

        card = self.card(reference)
        state = None if card["state"] is None else card["state"]["category"]
        basis = card["acceptance"]["basis"] if card["acceptance"] else None
        parent = self.row(reference)["parent_id"]
        return state, basis, None if parent is None else self.card(str(parent))["reference"]

    def refusal(self, write: functools.partial) -> tuple[int, str, str]:
        """The status, code and text a write is refused with."""

        with self.assertRaises(REFUSED) as refused:
            write()
        status, body = api.error_response(refused.exception)
        return status, body["error"]["code"], body["error"]["message"]

    def items(self) -> int:
        return int(self.conn.execute("SELECT COUNT(*) FROM work_items").fetchone()[0])

    def at_values(self, **values: str) -> None:
        """The minimal set with these values of the space changed."""

        participation.write_set(self.conn, self.space, participation.MINIMAL)
        for key, value in values.items():
            participation.write_value(self.conn, self.space, key, value)
        self.conn.commit()


class AgentGroupTests(GroupHarness):
    """Where the setting leaves findings and proposed goals to the agent, the same call
    carries its answer out."""

    def test_at_agent_the_group_is_carried_out_at_once(self) -> None:
        self.at(participation.MINIMAL)
        tasks = self.findings(3)
        answer = self.group(tasks)
        goal = str(answer["reference"])
        card = self.card(goal)
        self.assertEqual(
            (None, "not_started", "agent"),
            (card["state"], card["container_state"], card["acceptance"]["basis"]),
        )
        for task in tasks:
            self.assertEqual(("ready", "inherited", goal), self.where(task))
        self.assertEqual(
            {"items": tasks, "answer": "do", "carried_out": True}, answer["applied"]["group"]
        )
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual(([], []), (self.waiting_on(goal), self.owners_list()))
        # One mark, at `finding`, on the goal's acceptance; the tasks' acceptances are part
        # of the one decision.
        self.assertEqual([("finding", goal, "group «Export fixes»: do 3 items")], self.decided())
        self.assertEqual([("finding", "accepted", "agent")], self.marked(goal))

    def test_at_agent_later_and_drop_are_carried_out_at_once(self) -> None:
        self.at(participation.MINIMAL)
        later = self.findings(2)
        answer = self.group(later, "later", title="Later fixes", group={"until": "2026-12-01"})
        goal = str(answer["reference"])
        self.assertEqual(("deferred", None, None), self.where(goal))
        self.assertEqual(
            [f"deferred: until 2026-12-01: agent: later: {WHY}"], self.events(goal, "transitioned")
        )
        for task in later:
            self.assertEqual(("triage", None, goal), self.where(task))
        dropped = self.findings(2)
        answer = self.group(dropped, "drop", title="Dropped fixes")
        gone = str(answer["reference"])
        self.assertEqual(("cancelled", None, None), self.where(gone))
        for task in dropped:
            self.assertEqual(("cancelled", None, gone), self.where(task))
            self.assertEqual(
                [f"cancelled: Not to be done: {WHY}"], self.events(task, "transitioned")
            )
        self.assertEqual(
            [
                ("finding", gone, "group «Dropped fixes»: drop 2 items"),
                ("finding", goal, "group «Later fixes»: later 2 items"),
            ],
            self.decided(),
        )
        self.assertEqual(
            [("finding", "transitioned", f"cancelled: Not to be done: {WHY}")], self.marked(gone)
        )
        self.assertEqual([], self.owners_list())

    def test_the_longest_why_is_written_whole_by_later_and_drop(self) -> None:
        self.at(participation.MINIMAL)
        self.assertEqual(386, len(LONGEST_WHY))
        later = self.findings(2)
        answer = self.group(
            later, "later", title="Later fixes", group={"until": "2026-12-01", "why": LONGEST_WHY}
        )
        goal = str(answer["reference"])
        self.assertEqual(
            [f"deferred: until 2026-12-01: agent: later: {LONGEST_WHY}"],
            self.events(goal, "transitioned"),
        )
        dropped = self.findings(2)
        answer = self.group(dropped, "drop", title="Dropped fixes", group={"why": LONGEST_WHY})
        gone = str(answer["reference"])
        for task in dropped:
            self.assertEqual(
                [f"cancelled: Not to be done: {LONGEST_WHY}"], self.events(task, "transitioned")
            )
            summary = json.loads(self.row(task)["summary"])
            self.assertEqual(LONGEST_WHY, summary["why"])
        self.assertEqual(
            [f"cancelled: Not to be done: {LONGEST_WHY}"], self.events(gone, "transitioned")
        )

    def test_the_owners_group_is_their_decision(self) -> None:
        tasks = self.findings(2)
        body = self.person(
            "/api/planning/work-items",
            space="ALPHA",
            title="The owner's group",
            kind="goal",
            checklist=CONDITIONS,
            group={"items": tasks, "answer": "do", "why": WHY},
        )
        goal = str(body["reference"])
        self.assertEqual((None, "owner", None), self.where(goal))
        for task in tasks:
            self.assertEqual(("ready", "inherited", goal), self.where(task))
        self.assertEqual(([], []), (self.owners_list(), self.decided()))


class OwnerGroupTests(GroupHarness):
    """Where either setting keeps the decision for the owner, the answer waits."""

    def assert_waits(self, answer: dict, tasks: list[str]) -> tuple[str, dict]:
        """The group waits on the question `triage` and nothing is carried out."""

        goal = str(answer["reference"])
        self.assertEqual(("triage", None, None), self.where(goal))
        for task in tasks:
            self.assertEqual(("triage", None, goal), self.where(task))
        [action] = self.waiting_on(goal)
        waits = answer["waits_for_owner"]
        self.assertEqual(
            {
                "action": action.id,
                "point": "finding",
                "question": waits["question"],
                "what": waits["what"],
            },
            waits,
        )
        self.assertEqual(("finding", "group"), (action.point, action.kind))
        question = self.request(waits["question"])
        self.assertEqual(
            ("triage", action.id, None, "pending"),
            (question["purpose"], question["action_id"], question["addressee"], question["status"]),
        )
        self.assertFalse(answer["applied"]["group"]["carried_out"])
        self.assertEqual([], self.events(goal, "accepted"))
        self.assertEqual([], self.decided())
        return goal, waits

    def test_the_stricter_row_decides(self) -> None:
        # Findings are the agent's, proposed goals the owner's: the group waits.
        self.at_values(finding="agent", proposed_goal="human")
        tasks = self.findings(3)
        _goal, waits = self.assert_waits(self.group(tasks), tasks)
        self.assertEqual("group «Export fixes»: do 3 items", waits["what"])
        # Both the agent's, but cancels outside its own work the owner's: a drop of
        # another session's findings waits too.
        self.at_values(cancel_outside="human")
        others = self.findings(2)
        before = self.counts()
        _dropped, _waits = self.assert_waits(self.group(others, "drop", title="Not to do"), others)
        self.assertNotEqual(before, self.counts())
        self.assertEqual([], self.events(others[0], "transitioned"))
        # The agent's own findings it drops at once at the same setting.
        own = self.findings(2, by=AGENT)
        answer = self.group(own, "drop", title="Its own")
        self.assertTrue(answer["applied"]["group"]["carried_out"])
        self.assertEqual(("cancelled", None, None), self.where(str(answer["reference"])))

    def test_the_question_offers_the_answer_the_items_and_until(self) -> None:
        tasks = self.findings(2)
        self.tool("apply_work_item_changes", id=tasks[1], update={"title": "x" * 200})
        answer = self.group(tasks, "later", group={"until": "2026-12-01"})
        goal, waits = self.assert_waits(answer, tasks)
        question = self.request(waits["question"])
        self.assertEqual("Group of 2 items: «Export fixes»", question["prompt"])
        choice, items, until, cancels = json.loads(question["fields_json"])
        self.assertEqual(
            [("do", "Do", None), ("later", "Later", WHY), ("drop", "Not to do", None)],
            [(option["id"], option["label"], option.get("why")) for option in choice["options"]],
        )
        self.assertEqual(
            ["later"], [option["id"] for option in choice["options"] if option.get("recommended")]
        )
        self.assertEqual(
            ("items", "multi_choice", False), (items["id"], items["type"], items["required"])
        )
        self.assertEqual(
            [tasks[0].lower(), tasks[1].lower()], [option["id"] for option in items["options"]]
        )
        self.assertEqual(f"{tasks[0]} · Finding 1", items["options"][0]["label"])
        self.assertEqual(200, len(items["options"][1]["label"]))
        self.assertTrue(items["options"][1]["label"].endswith("…"))
        self.assertTrue(all(option["recommended"] for option in items["options"]))
        self.assertEqual(
            [("until", False, "later"), ("cancels", False, "drop")],
            [
                (field["id"], field["required"], field["under"]["option"])
                for field in (until, cancels)
            ],
        )
        self.assertIn("2026-12-01", until["description"])
        # The action holds the tasks as they stood, the answer, until and why; the
        # question's `action` shows the conditions and the tasks, and the cancel list.
        [action] = self.waiting_on(goal)
        ids = [self.id(task) for task in tasks]
        self.assertEqual(
            {"items": ids, "answer": "later", "until": "2026-12-01", "why": WHY}, action.params
        )
        self.assertEqual(
            {"items": [{"id": identity, "state": "triage"} for identity in ids]}, action.seen
        )
        part = pending.part(self.conn, action.id, "triage", "claude")
        self.assertEqual(
            {
                "conditions": CONDITIONS,
                "items": [{"reference": task, "title": self.card(task)["title"]} for task in tasks],
                "answer": "later",
                "until": "2026-12-01",
                "why": WHY,
            },
            part["proposed"],
        )
        self.assertEqual(tasks, [entry["reference"] for entry in part["cancel_list"]["cancels"]])
        self.assertIn(("session-a", "", 1), self.followers(goal))

    def test_a_waiting_group_holds_its_cards(self) -> None:
        participation.write_label(self.conn, self.space, "docs", ready=True, description=None)
        self.conn.commit()
        tasks = self.findings(4)
        goal, waits = self.assert_waits(self.group(tasks), tasks)
        before = self.counts()
        for write in (
            functools.partial(self.tool, "claim_work_item", id=tasks[0]),
            functools.partial(
                self.tool, "apply_work_item_changes", id=tasks[0], transition={"state": "ready"}
            ),
        ):
            status, code, message = self.refusal(write)
            self.assertEqual((409, "workflow_guard"), (status, code))
            self.assertIn("[acceptance_question]", message)
        self.assertEqual(before, self.counts(), "nothing written")
        # The label's rule takes no task the group's answer decides.
        self.tool("apply_work_item_changes", id=tasks[1], update={"labels_add": ["docs"]})
        self.assertEqual(("triage", None, goal), self.where(tasks[1]))
        self.assertEqual(["docs"], self.card(tasks[1])["labels"])
        [action] = self.waiting_on(goal)
        self.assertEqual(waits["action"], action.id)
        self.assertEqual("pending", self.request(waits["question"])["status"])
        # Beside the group, the same label takes a finding at once.
        [beside] = self.findings(1)
        self.tool("apply_work_item_changes", id=beside, update={"labels_add": ["docs"]})
        self.assertEqual(("ready", "label_rule", None), self.where(beside))


class RefusalTests(GroupHarness):
    """A group outside its form, or naming a task that does not wait in the stack."""

    def test_what_a_group_refuses(self) -> None:
        tasks = self.findings(21)
        unaccepted = self.filed("A goal nobody accepted", kind="goal")
        waiting = self.group(tasks[19:21])
        held = str(waiting["applied"]["group"]["items"][0])
        service.create_planning_space(self.conn, name="Beta", key="BETA")
        with calls.bind(OTHER, "create_work_item"):
            elsewhere = service.create_work_item(self.conn, space="BETA", title="Elsewhere")
        self.conn.commit()
        ready = self.filed("Ready work", by=calls.browser())
        form = "[group] a group is a new goal without a parent, with its conditions in checklist and 2 to 20 items: "
        cases = {
            "one item": ({"group": {"items": tasks[:1]}}, 400, form + "items names 1"),
            "21 items": ({"group": {"items": tasks}}, 400, form + "items names 21"),
            "a parent": ({"parent": str(waiting["reference"])}, 400, form + "parent is named"),
            "no checklist": ({"checklist": None}, 400, form + "checklist names no condition"),
            "acceptance": ({"acceptance": "assignment"}, 400, form + "acceptance is named"),
            "a why of 387": (
                {"group": {"why": "x" * 387}},
                400,
                form + "why is one line of at most 386 characters",
            ),
            "a goal": (
                {"group": {"items": [tasks[0], unaccepted]}},
                409,
                f"[group] {unaccepted} is not waiting for a triage review: it is a goal or stage",
            ),
            "a task of the group": (
                {"group": {"items": [tasks[0], held]}},
                409,
                f"[group] {held} is not waiting for a triage review: it lies under"
                f" {waiting['reference']}",
            ),
            "another space": (
                {"group": {"items": [tasks[0], elsewhere["reference"]]}},
                409,
                f"[group] {elsewhere['reference']} is not waiting for a triage review: it is in"
                " another space",
            ),
            "not in triage": (
                {"group": {"items": [tasks[0], ready]}},
                409,
                f"[group] {ready} is not waiting for a triage review: it is not in triage",
            ),
        }
        before = (self.counts(), self.items())
        for name, (change, status, message) in cases.items():
            with self.subTest(name):
                payload: dict[str, object] = {
                    "space": "ALPHA",
                    "title": "Refused",
                    "kind": "goal",
                    "checklist": CONDITIONS,
                    "group": {"items": tasks[:2], "answer": "do", "why": WHY},
                }
                for key, value in change.items():
                    if key == "group":
                        payload["group"] = {**payload["group"], **value}  # type: ignore[dict-item]
                    elif value is None:
                        del payload[key]
                    else:
                        payload[key] = value
                said = self.refusal(functools.partial(self.tool, "create_work_item", **payload))
                code = "invalid_request" if status == 400 else "workflow_guard"
                self.assertEqual((status, code), said[:2])
                self.assertIn(message, said[2])
                self.assertEqual(before, (self.counts(), self.items()), "nothing created")
        # No number was spent: the next item takes the one after the last created.
        created = self.filed("After the refusals")
        named = (*tasks, ready, unaccepted, str(waiting["reference"]))
        last = max(int(reference.split("-")[1]) for reference in named)
        self.assertEqual(f"ALPHA-{last + 1}", created)


class OwnerAnswerTests(GroupHarness):
    """The owner's answer to the question `triage`, given through Valkama's HTTP route and
    carried out in the write that gives it: the tasks left unticked go back to the stack,
    a ticked one that left the group takes no part, and the answer acts on the goal."""

    def waiting_group(self, count: int = 4, answer: str = "do") -> tuple[str, list[str], str]:
        """A group of `count` findings waiting for the owner: the goal, its tasks and the
        question."""

        tasks = self.findings(count)
        written = self.group(tasks, answer)
        return str(written["reference"]), tasks, str(written["waits_for_owner"]["question"])

    def owner_answers(self, question: str, answer: str, items: list[str], **more: object) -> dict:
        """The owner's answer through the HTTP route, ticking `items`: the answer's record."""

        path = "/api/planning/request/answer"
        payload = {
            "id": question,
            "expected_revision": int(self.request(question)["revision"]),
            "answers": {"answer": answer, "items": [item.lower() for item in items], **more},
            "author": "user",
        }
        try:
            with calls.bind(calls.browser(), path):
                written = api.handle_post(self.conn, path, payload)
        except BaseException:
            self.conn.rollback()
            raise
        self.conn.commit()
        assert written is not None
        return written[1]

    def test_a_card_taken_out_returns_to_the_stack(self) -> None:
        goal, tasks, question = self.waiting_group()
        [action] = self.waiting_on(goal)
        kept = [tasks[0], tasks[2], tasks[3]]
        record = self.owner_answers(question, "do", kept)
        self.assertEqual(
            {"answer": "do", "moved_out": [tasks[1]], "skipped": []}, record["carried_out"]
        )
        card = self.card(goal)
        self.assertEqual(
            (None, "not_started", "owner"),
            (card["state"], card["container_state"], card["acceptance"]["basis"]),
        )
        for task in kept:
            self.assertEqual(("ready", "inherited", goal), self.where(task))
        # The task taken out stands at the top level in triage, back in the stack, unmarked,
        # having entered it with the answer that moved it out.
        self.assertEqual(("triage", None, None), self.where(tasks[1]))
        self.assertEqual([f"{tasks[1]}: owner: not in this group"], self.events(goal, "child_left"))
        moved = self.conn.execute(
            "SELECT created_at, detail FROM work_item_events WHERE work_item_id = ?"
            " AND action = 'transitioned' ORDER BY id DESC LIMIT 1",
            (self.id(tasks[1]),),
        ).fetchone()
        self.assertEqual(f"triage: moved out of {goal}: owner: not in this group", moved["detail"])
        [waiting] = triage.waiting(self.conn, self.space, items=[self.id(tasks[1])])
        self.assertEqual((moved["created_at"], None), (waiting.entered_at, waiting.seen_at))
        # The answer is the agent's, so the action ends carried out, and the question with it.
        self.assertEqual("carried_out", self.action(action.id)["outcome"])
        self.assertEqual("answered", self.request(question)["status"])
        self.assertEqual(([], []), (self.waiting_on(goal), self.owners_list()))
        self.assertEqual([], self.decided(), "the owner's answer is no agent's decision")

    def test_an_answer_that_cannot_be_carried_out_is_refused(self) -> None:
        goal, tasks, question = self.waiting_group()
        before = (self.counts(), self.items())
        cases = (
            ("do", [], {}, "[triage] tick what is to be done, or answer drop"),
            (
                "later",
                tasks,
                {},
                "[triage] later needs until: a date (2026-12-01) or an item reference",
            ),
        )
        for answer, items, more, message in cases:
            with self.subTest(answer=answer):
                status, code, said = self.refusal(
                    functools.partial(self.owner_answers, question, answer, items, **more)
                )
                self.assertEqual((400, "invalid_request", message), (status, code, said))
                self.assertEqual(before, (self.counts(), self.items()), "nothing written")
                self.assertEqual("pending", self.request(question)["status"])
                for task in tasks:
                    self.assertEqual(("triage", None, goal), self.where(task))

    def test_a_card_put_under_the_group_later_is_moved_out(self) -> None:
        goal, tasks, question = self.waiting_group()
        [later] = self.findings(1)
        self.tool("apply_work_item_changes", id=later, update={"parent": goal})
        self.assertEqual(("triage", None, goal), self.where(later))
        record = self.owner_answers(question, "do", tasks)
        self.assertEqual(
            {"answer": "do", "moved_out": [later], "skipped": []}, record["carried_out"]
        )
        self.assertEqual(("triage", None, None), self.where(later))
        self.assertEqual([f"{later}: owner: not in this group"], self.events(goal, "child_left"))
        for task in tasks:
            self.assertEqual(("ready", "inherited", goal), self.where(task))

    def test_an_answer_left_with_nothing_to_do_is_dropped(self) -> None:
        # The one task kept was taken out of the group meanwhile: the answer moves the
        # rest out, skips it, and no longer applies; the goal stays in triage.
        goal, tasks, question = self.waiting_group(2)
        [action] = self.waiting_on(goal)
        self.person("/api/planning/work-item/move-out", id=tasks[0], reason="it is its own")
        record = self.owner_answers(question, "do", [tasks[0]])
        self.assertEqual(
            {"answer": "do", "moved_out": [tasks[1]], "skipped": [tasks[0]]},
            record["carried_out"],
        )
        self.assertEqual("dropped", self.action(action.id)["outcome"])
        self.assertEqual(
            ["finding: no item ticked lies under the goal in triage"],
            self.events(goal, "action_dropped"),
        )
        self.assertEqual(("triage", None, None), self.where(goal))
        for task in tasks:
            self.assertEqual(("triage", None, None), self.where(task))
        self.assertEqual("answered", self.request(question)["status"])


if __name__ == "__main__":
    unittest.main()
