"""A work item read by parts: the card by default, and every other part by its name.

The card is what an agent reads first: the item's fields, its own text and a table
of contents counting every other part. These read one item that has something in
each part and hold the card, the table and each part to the full record a screen
reads over HTTP, which the reads by part leave as it was.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
import uuid
from unittest import mock

from server import mcp_surface, store
from server.planning import api, images, model, read_model, requests, service, tools
from tests.test_planning_images import png

HOLDER = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
FOLLOWER = "019a3c2e-7777-7c11-9e0f-2f4b6d8a1c3e"
#: The card's fields as the contract names them.
CARD = frozenset(
    {
        "reference", "title", "kind", "priority", "revision", "created_at", "updated_at",
        "labels", "source", "state", "open", "container_state", "acceptance", "started_at",
        "waits_for", "workable", "withheld", "projects", "claim_ref", "claim_state",
        "last_claim_ref", "closed_at", "lapsed_claim", "url", "parent", "description",
        "checklist", "summary",
    }
)  # fmt: skip
#: Fields a later build adds to the record, which the card carries only when it does.
AHEAD = ("withheld", "projects", "lapsed_claim")
#: Fields the card makes itself rather than takes from the record.
OWN = ("url", "parent")


def compact(value: object) -> str:
    """An answer as the MCP surface writes it (`mcp_surface._compact`)."""

    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class CardCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Cards", key="CRD")
        self.conn.commit()

    def agent(self, tool: str, session: str = HOLDER, **arguments: object) -> dict:
        answer = mcp_surface.run_tool_call(self.conn, tool, arguments, meta={"sessionId": session})
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def read(self, **arguments: object) -> dict:
        answer = tools.OPS["get_work_item"](self.conn, {"id": self.ref, **arguments})
        assert isinstance(answer, dict)
        return answer

    def http(self, **parameters: str) -> dict:
        answer = api.handle_get(
            self.conn,
            "/api/planning/work-item",
            {"id": [self.ref], **{name: [value] for name, value in parameters.items()}},
        )
        assert answer is not None
        return dict(answer[1]["work_item"])

    def item(self, title: str, **fields: object) -> str:
        return str(
            service.create_work_item(self.conn, space="CRD", title=title, **fields)["reference"]
        )


class FullItemCase(CardCase):
    """One item under a goal with something in every part this build has."""

    def setUp(self) -> None:
        super().setUp()
        goal = self.item("Goal", kind="goal")
        self.ref = self.item("Every part", parent=goal, description="What to do.", labels=["one"])
        other = self.item("Other")
        self.agent(
            "apply_work_item_changes",
            id=self.ref,
            claim=True,
            checklist=["first", "second"],
            refs=[{"kind": "commit", "value": "abc1234"}],
            links=[{"other": other, "kind": "relates-to"}],
            comment={"body": "a root"},
            summary={"done": "half", "next": "the rest"},
        )
        root = int(service.get_work_item(self.conn, self.ref)["comments"][0]["id"])
        self.agent(
            "apply_work_item_changes", id=self.ref, comment={"body": "a reply", "reply_to": root}
        )
        self.agent(
            "apply_work_item_changes", id=other, comment={"body": "see", "mentions": [self.ref]}
        )
        self.agent("apply_work_item_changes", FOLLOWER, id=self.ref, subscribe=True)
        self.agent(
            "create_work_item_request",
            id=self.ref,
            kind="question",
            prompt="Proceed?",
            fields=[
                {"id": "go", "label": "Go", "type": "boolean", "required": True, "options": []}
            ],
        )
        images.store(self.conn, self.ref, png(1))
        self.conn.commit()

    def full(self) -> dict:
        """The full record over HTTP, with the sessions a read may add to it."""

        return self.http(sessions="true")

    def part_size(self, name: str, answer: dict) -> dict[str, int]:
        """What a part read says of its size, in the table of contents' terms."""

        if name == "comments":
            return {
                "count": answer["comments_total"],
                "threads": answer["threads_total"],
                "unresolved": answer["unresolved_total"],
            }
        if name == "events":
            return {"count": answer["events_total"]}
        if name == "mentions":
            return {"count": answer["mentions_total"]}
        if name == "questions":
            questions = answer["questions"]
            return {
                "count": questions["total"],
                "open": questions["open"],
                "addressed_open": questions["addressed_open"],
            }
        if name == "claim":
            return {"count": 0 if answer["claim"] is None else 1}
        return {"count": len(answer.get(name) or [])}


class DefaultReadTests(FullItemCase):
    def test_default_read_is_the_card(self) -> None:
        card = self.read()
        full = self.full()
        self.assertEqual(CARD, set(read_model.CARD_FIELDS))
        wanted = {name for name in CARD if name in full or name in OWN or name == "summary"}
        self.assertEqual(wanted | {"parts"}, set(card))
        for name in AHEAD:
            with self.subTest(ahead=name):
                self.assertEqual(name in full, name in card)
        # The record's own fields come over as the record has them.
        for name in wanted - {"state", "checklist", "url", "parent", "summary"}:
            with self.subTest(field=name):
                self.assertEqual(full[name], card[name])
        self.assertEqual(
            {name: full["state"][name] for name in ("key", "name", "category")}, card["state"]
        )
        self.assertEqual(full["summary"], card["summary"])
        self.assertEqual("CRD-1", card["parent"])
        self.assertEqual(f"http://127.0.0.1:8642/open/{self.ref}", card["url"])
        # A step carries a holder's name only when it has one.
        self.assertEqual(
            [{"id": step["id"], "text": step["text"], "done": False} for step in full["checklist"]],
            card["checklist"],
        )

    def test_the_table_of_contents_counts_each_part_as_its_read_does(self) -> None:
        contents = self.read()["parts"]
        named = set(read_model.PARTS) - {"card", "sections", "participants"}
        self.assertEqual(named, set(contents), "this item has something in each part")
        for name in read_model.PARTS[1:]:
            with self.subTest(part=name):
                if name == "participants":
                    # Only a goal or a stage has them; this item is a task.
                    with self.assertRaisesRegex(
                        model.PlanningError, "unknown part 'participants'; a task's parts are"
                    ):
                        self.read(parts=[name])
                    continue
                answer = self.read(parts=[name])
                size = self.part_size(name, answer)
                # A short description is read whole, so the card does not name its sections.
                if size["count"] == 0 or name == "sections":
                    self.assertNotIn(name, contents)
                    continue
                self.assertEqual(size, {key: contents[name][key] for key in size})
        whole = service.get_work_item(self.conn, self.ref)
        # The summary is a report: its size is the record a reader gets.
        self.assertEqual(
            sum(
                len(comment["body"]) + (len(compact(comment["report"])) if comment["report"] else 0)
                for comment in whole["comments"]
            ),
            contents["comments"]["chars"],
        )
        self.assertEqual(
            sum(len(event["detail"]) for event in whole["events"]), contents["events"]["chars"]
        )

    def test_every_field_of_the_full_record_is_on_the_card_a_part_or_named_off_it(self) -> None:
        fields: set[str] = set()
        for parameters in ({}, {"sessions": "true", "threads": "5", "events": "10"}):
            fields |= set(self.http(**parameters))
        fields |= set(self.http(unresolved="true"))
        placed = set(read_model.CARD_FIELDS) | set(read_model.PARTS) | set(read_model.OFF_CARD)
        self.assertEqual(set(), fields - placed)
        self.assertEqual(set(), set(read_model.CARD_FIELDS) & set(read_model.PARTS))

    def test_a_card_costs_the_same_however_long_the_history(self) -> None:
        def statements() -> tuple[int, int]:
            seen: list[str] = []
            self.conn.set_trace_callback(seen.append)
            try:
                size = len(compact(self.read()))
            finally:
                self.conn.set_trace_callback(None)
            return len(seen), size

        before, short = statements()
        for number in range(40):
            service.comment_work_item(self.conn, self.ref, f"note {number}")
        self.conn.commit()
        after, long = statements()
        self.assertEqual(before, after)
        self.assertLess(long - short, 100, "only the counts grow")


class PartTests(FullItemCase):
    def test_each_part_reads_its_field(self) -> None:
        full = self.full()
        identity = str(full["work_item_id"])
        beside = {"reference": self.ref, "revision": full["revision"]}
        whole = {
            **full,
            "questions": requests.item_questions(self.conn, identity),
            "images": images.of_item(self.conn, identity),
        }
        own = {
            "comments": {"comments_total", "threads_total", "unresolved_total", "truncated"},
            "events": {"events_total", "events_truncated"},
            "mentions": {"mentions_total"},
            # The description's sections, which no field of the full record holds.
            "sections": set(),
        }
        for name in read_model.PARTS[1:]:
            with self.subTest(part=name):
                if name == "participants":
                    continue  # a task has no such part, and naming it is refused
                answer = self.read(parts=[name])
                self.assertEqual(beside, {key: answer[key] for key in beside})
                fields = set(answer) - set(beside)
                if name in own:
                    self.assertEqual({name} | own[name], fields)
                    continue
                # A part this build's record does not hold answers with nothing.
                self.assertEqual({name} if name in whole else set(), fields)
                if name in whole:
                    self.assertEqual(whole[name], answer[name])
        self.assertEqual(full["mentions"], self.read(parts="mentions")["mentions"])
        self.assertEqual(full["events"][-10:], self.read(parts="events")["events"])

    def test_the_card_part_is_the_default_read_and_parts_join(self) -> None:
        self.assertEqual(self.read(), self.read(parts="card"))
        self.assertEqual(self.read(), self.read(parts=["card"]))
        joined = self.read(parts=["card", "links", "card"])
        self.assertEqual({**self.read(), "links": self.full()["links"]}, joined)

    def test_http_reads_parts_as_the_tool_does(self) -> None:
        self.assertEqual(self.read(parts=["card", "refs"]), self.http(parts="card,refs"))
        newest = self.http(parts="events", events="2")
        self.assertEqual(self.read(events=2), newest)
        self.assertEqual(self.full()["events"][-2:], newest["events"])
        for value in ("0", "1001", "two"):
            with self.subTest(events=value), self.assertRaises(model.PlanningError) as caught:
                self.http(parts="events", events=value)
            self.assertEqual("events must be between 1 and 1000", str(caught.exception))

    def test_a_part_the_item_lacks_is_refused_with_the_parts(self) -> None:
        for parts in ("history", ["card", "full"], ["card,links"]):
            with self.subTest(parts=parts), self.assertRaises(model.PlanningError) as caught:
                self.read(parts=parts)
            self.assertIn("; parts are card, comments, events, links, refs,", str(caught.exception))
        with self.assertRaises(model.PlanningError):
            self.read(parts=[])

    def test_a_goal_reads_who_works_on_it_as_a_part_its_card_counts(self) -> None:
        goal = self.read()["parent"]
        part = tools.OPS["get_work_item"](self.conn, {"id": goal, "parts": "participants"})
        answer = api.handle_get(self.conn, "/api/planning/work-item", {"id": [goal]})
        assert isinstance(part, dict) and answer is not None
        self.assertEqual(answer[1]["work_item"]["participants"], part["participants"])
        self.assertEqual([HOLDER], [entry["session"] for entry in part["participants"]])
        card = tools.OPS["get_work_item"](self.conn, {"id": goal})
        assert isinstance(card, dict)
        self.assertNotIn("participants", card, "the card counts them and leaves them out")
        self.assertEqual({"count": 1}, card["parts"]["participants"])

    def test_a_comment_mode_beside_parts_without_comments_is_refused(self) -> None:
        with self.assertRaises(model.PlanningError) as caught:
            self.read(parts=["card"], thread=1)
        self.assertEqual(
            "thread reads the comments part: add comments to parts or leave parts out",
            str(caught.exception),
        )
        thread = self.read(parts=["comments"], thread=1)["comments"]
        self.assertEqual(["a root", "a reply"], [comment["body"] for comment in thread])


class SizeTests(unittest.TestCase):
    def test_what_the_card_adds(self) -> None:
        """The table with every part at nine digits, and the frame of a flagged step."""

        most = 999_999_999
        counts: dict[str, dict[str, int]] = {name: {"count": most} for name in read_model.PARTS}
        counts["comments"] |= {"threads": most, "unresolved": most, "chars": most}
        counts["events"] |= {"chars": most}
        counts["questions"] |= {"open": most, "addressed_open": most}
        # An item has one lease or none.
        counts["claim"] = {"count": 1}
        contents = read_model.table_of_contents(counts)
        self.assertEqual(list(read_model.PARTS[1:]), list(contents))
        self.assertLessEqual(len(compact(contents)), 490)
        step = {
            "id": str(uuid.uuid4()),
            "text": "",
            "done": True,
            "claimed_by": "a",
            "done_by": "b",
            "by_previous_holder": True,
        }
        shown = read_model.card_step(step)
        self.assertEqual(list(step), list(shown))
        self.assertLessEqual(len(compact(shown)) - len("ab"), 125)
        bare = read_model.card_step(
            {**step, "claimed_by": "", "done_by": "", "by_previous_holder": False}
        )
        self.assertEqual({"id", "text", "done"}, set(bare))

    def test_an_empty_part_is_left_out_of_the_table(self) -> None:
        self.assertEqual(
            {"links": {"count": 2}},
            read_model.table_of_contents({"links": {"count": 2}, "refs": {"count": 0}}),
        )


if __name__ == "__main__":
    unittest.main()
