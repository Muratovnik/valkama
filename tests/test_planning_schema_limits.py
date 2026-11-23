"""Every length the server holds a tool's text field to is the `maxLength` its schema publishes.

A client validates a call against the schema `tools/list` gives it and sends what
passes. Where the schema said nothing of a length the server refused, a title of
201 characters and a ref label of the same length passed the client and were
refused by the server, after the calls before them in a batch had been written.

So each string field of every planning tool, at any depth, is either bounded in
its schema and probed here through the tool layer — one character over the
published limit refused with that limit, a value at it not refused for its length
— or named below with why the server holds it to no length of its own. A new
string field is in neither until someone decides which, and the test says so.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from collections.abc import Callable, Iterator
from pathlib import Path
from unittest import mock

from server import mcp_surface, store
from server.planning import service, tools

Arguments = dict[str, object]
#: A call that puts `value` at one field: the tool's arguments, and the `_meta` it
#: needs when the field is read only for a proved session.
Build = Callable[[str], tuple[Arguments, dict | None]]

#: The string fields the server holds to no length of its own, each with why.
NO_LENGTH_OF_THEIR_OWN = {
    ("create_work_item", "steps[]"): "names a step of split_from; an unknown one is refused",
    ("apply_work_item_changes", "convert.leftover.steps[]"): "names a step of the item;"
    " an unknown one is refused",
    ("get_work_item", "section"): "names a section; an unknown one is refused",
    ("get_work_item", "section[]"): "names a section; an unknown one is refused",
    ("read_work_item_image", "sha256"): "its pattern fixes 64 hexadecimal digits",
    ("list_work_item_requests", "answered_after"): "read as an ISO timestamp",
    ("create_work_item_request", "expires_at"): "read as an ISO timestamp",
    ("apply_work_item_changes", "questions[].expires_at"): "read as an ISO timestamp",
    ("create_work_item_request", "fields[].under.field"): "names an earlier field's id",
    ("create_work_item_request", "fields[].under.option"): "names an option's id",
    ("apply_work_item_changes", "commits[].repository"): "names a registered project",
    ("apply_work_item_changes", "commits[].hash"): "held to the shape of a hash",
    # The two reasons below are recorded in an event detail of a fixed size, and the
    # room left for them depends on the state or the items the detail also names.
    ("apply_work_item_changes", "transition.reason"): "its room depends on the state's key",
    ("apply_work_item_changes", "move_out.reason"): "its room depends on the items' references",
}

#: Bounded fields this test cannot reach through the tool layer cheaply, each with the
#: limit `commits.attach` holds it to, written out here rather than read from the
#: constant the schema reads: a commit's label is checked only after a registered
#: project's Git repository has resolved the hash.
NOT_PROBED = {("apply_work_item_changes", "commits[].label"): 200}


def string_fields(schema: dict, path: str = "") -> Iterator[tuple[str, dict]]:
    """Each string field of `schema` with its path: `a.b` inside an object, `a[]` in a list."""

    for alternative in schema.get("anyOf", []):
        yield from string_fields(alternative, path)
    if schema.get("type") == "string" and "enum" not in schema:
        yield path, schema
    for name, field in schema.get("properties", {}).items():
        yield from string_fields(field, f"{path}.{name}" if path else name)
    if isinstance(schema.get("items"), dict):
        yield from string_fields(schema["items"], f"{path}[]")


def published() -> dict[tuple[str, str], dict]:
    return {
        (tool["name"], path): field
        for tool in tools.TOOLS
        for path, field in string_fields(tool["inputSchema"])
    }


class SchemaLimitTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": str(Path(directory.name) / "store.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Limits", key="LIM")
        self.one = self.item("First")
        self.two = self.item("Second", priority="high")
        self.three = self.item("Third")
        self.goal = self.item("A goal", kind="goal")
        self.conn.commit()
        self.tool("apply_work_item_changes", id=self.three, checklist={"items": ["A step"]})
        self.step = self.tool("get_work_item", id=self.three)["checklist"][0]["id"]
        asked = self.tool("create_work_item_request", **self.question())
        self.request, self.revision = asked["request_id"], asked["revision"]

    def item(self, title: str, **fields: object) -> str:
        return str(
            service.create_work_item(self.conn, space="LIM", title=title, **fields)["reference"]
        )

    def tool(self, name: str, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, name, arguments)
        self.conn.commit()
        return answer

    def refusal(self, name: str, arguments: Arguments, meta: dict | None) -> str | None:
        """What the server says of the call, which is then undone; None when it took it."""

        try:
            mcp_surface.call_tool(self.conn, name, arguments, meta=meta)
        except Exception as error:  # noqa: BLE001 - every refusal is an answer here
            return str(error)
        finally:
            self.conn.rollback()
        return None

    def question(self, **over: object) -> Arguments:
        return {
            "id": self.one,
            "kind": "question",
            "prompt": "Which way?",
            "fields": [FIELD],
            **over,
        }

    def cases(self) -> dict[tuple[str, str], Build]:
        one, two, three, step = self.one, self.two, self.three, self.step
        request, revision = self.request, self.revision
        proved = {"sessionId": "asking-session", "threadId": "asking-session"}

        def plain(build: Callable[[str], Arguments]) -> Build:
            return lambda value: (build(value), None)

        def new(**fields: object) -> Arguments:
            return {"space": "LIM", "title": "New", **fields}

        def goal(group: dict) -> Arguments:
            grouped = {"items": [two], "answer": "do", "why": "Urgent alone.", **group}
            return new(kind="goal", checklist={"items": ["Done when it ships"]}, group=grouped)

        def batch(**groups: object) -> Arguments:
            return {"id": one, **groups}

        def field(**over: object) -> Arguments:
            return self.question(fields=[{**FIELD, **over}])

        def option(**over: object) -> Arguments:
            return self.question(fields=[{**FIELD, "options": [{**OPTION, **over}]}])

        def ask(**over: object) -> Arguments:
            return batch(
                questions=[{"kind": "question", "prompt": "Which?", "fields": [FIELD], **over}]
            )

        found: dict[tuple[str, str], Build] = {
            ("create_planning_space", "name"): plain(lambda v: {"name": v}),
            ("create_planning_space", "key"): plain(lambda v: {"name": "Other", "key": v}),
            ("get_planning_space", "space"): plain(lambda v: {"space": v}),
            ("create_work_item", "space"): plain(lambda v: new(space=v)),
            ("create_work_item", "title"): plain(lambda v: new(title=v)),
            ("create_work_item", "state"): plain(lambda v: new(state=v)),
            ("create_work_item", "description"): plain(lambda v: new(description=v)),
            ("create_work_item", "labels[]"): plain(lambda v: new(labels=[v])),
            ("create_work_item", "projects[]"): plain(lambda v: new(projects=[v])),
            ("create_work_item", "source"): plain(lambda v: new(source=v)),
            ("create_work_item", "parent"): plain(lambda v: new(parent=v)),
            ("create_work_item", "split_from"): plain(lambda v: new(split_from=v)),
            ("create_work_item", "checklist.items[]"): plain(
                lambda v: new(checklist={"items": [v]})
            ),
            ("create_work_item", "checklist.items[].text"): plain(
                lambda v: new(checklist={"items": [{"text": v}]})
            ),
            ("create_work_item", "links[].other"): plain(
                lambda v: new(links=[{"other": v, "kind": "relates-to"}])
            ),
            ("create_work_item", "group.items[]"): plain(lambda v: goal({"items": [v]})),
            ("create_work_item", "group.until"): plain(
                lambda v: goal({"answer": "later", "until": v})
            ),
            ("create_work_item", "group.why"): plain(lambda v: goal({"why": v})),
            ("create_work_item", "author"): plain(lambda v: new(author=v)),
            ("get_work_item", "id"): plain(lambda v: {"id": v}),
            ("read_work_item_image", "id"): plain(lambda v: {"id": v, "sha256": "0" * 64}),
            ("list_work_items", "space"): plain(lambda v: {"space": v}),
            ("list_work_items", "state"): plain(lambda v: {"space": "LIM", "state": v}),
            ("list_work_items", "owner"): plain(lambda v: {"space": "LIM", "owner": v}),
            ("list_work_items", "parent"): plain(lambda v: {"space": "LIM", "parent": v}),
            ("list_work_items", "project"): plain(lambda v: {"space": "LIM", "project": v}),
            ("get_work_item_chain", "id"): plain(lambda v: {"id": v}),
            ("search_work_items", "query"): plain(lambda v: {"query": v}),
            ("search_work_items", "space"): plain(lambda v: {"query": "first", "space": v}),
            ("claim_work_item", "id"): plain(lambda v: {"id": v}),
            ("claim_work_item", "author"): plain(lambda v: {"id": one, "author": v}),
            ("claim_ready_work_item", "space"): plain(lambda v: {"space": v}),
            ("claim_ready_work_item", "within"): plain(lambda v: {"space": "LIM", "within": v}),
            ("claim_ready_work_item", "label"): plain(lambda v: {"space": "LIM", "label": v}),
            ("claim_ready_work_item", "project"): plain(lambda v: {"space": "LIM", "project": v}),
            ("claim_ready_work_item", "author"): plain(lambda v: {"space": "LIM", "author": v}),
            ("claim_work_item_checklist_item", "id"): plain(lambda v: {"id": v, "item_id": step}),
            ("claim_work_item_checklist_item", "item_id"): plain(
                lambda v: {"id": three, "item_id": v}
            ),
            ("claim_work_item_checklist_item", "author"): plain(
                lambda v: {"id": three, "item_id": step, "author": v}
            ),
            ("merge_work_items", "id"): plain(lambda v: {"id": v, "items": [two]}),
            ("merge_work_items", "items[]"): plain(lambda v: {"id": one, "items": [v]}),
            ("merge_work_items", "reason"): plain(
                lambda v: {"id": one, "items": [two], "reason": v}
            ),
            ("merge_work_items", "author"): plain(
                lambda v: {"id": one, "items": [two], "author": v}
            ),
            ("delete_work_item", "id"): plain(lambda v: {"id": v}),
            ("get_work_item_request", "id"): plain(lambda v: {"id": v}),
            ("list_work_item_requests", "space"): plain(lambda v: {"space": v}),
            ("list_work_item_requests", "id"): plain(lambda v: {"id": v}),
            ("answer_work_item_request", "id"): plain(
                lambda v: {"id": v, "answers": {"path": "keep"}, "expected_revision": revision}
            ),
            ("answer_work_item_request", "note"): plain(
                lambda v: {
                    "id": request,
                    "answers": {"path": "keep"},
                    "note": v,
                    "expected_revision": revision,
                }
            ),
            ("answer_work_item_request", "author"): plain(
                lambda v: {
                    "id": request,
                    "answers": {"path": "keep"},
                    "author": v,
                    "expected_revision": revision,
                }
            ),
            ("expire_work_item_request", "id"): plain(
                lambda v: {"id": v, "expected_revision": revision}
            ),
            ("expire_work_item_request", "author"): plain(
                lambda v: {"id": request, "author": v, "expected_revision": revision}
            ),
            ("create_work_item_request", "id"): plain(lambda v: self.question(id=v)),
            ("create_work_item_request", "prompt"): plain(lambda v: self.question(prompt=v)),
            ("create_work_item_request", "fields[].id"): plain(lambda v: field(id=v)),
            ("create_work_item_request", "fields[].label"): plain(lambda v: field(label=v)),
            ("create_work_item_request", "fields[].description"): plain(
                lambda v: field(description=v)
            ),
            ("create_work_item_request", "fields[].group"): plain(lambda v: field(group=v)),
            ("create_work_item_request", "fields[].why"): plain(
                lambda v: self.question(kind="decision", fields=[{**VERDICT, "why": v}])
            ),
            ("create_work_item_request", "fields[].options[].id"): plain(lambda v: option(id=v)),
            ("create_work_item_request", "fields[].options[].label"): plain(
                lambda v: option(label=v)
            ),
            ("create_work_item_request", "fields[].options[].description"): plain(
                lambda v: option(description=v)
            ),
            ("create_work_item_request", "fields[].options[].why"): plain(
                lambda v: option(recommended=True, why=v)
            ),
            ("create_work_item_request", "author"): plain(lambda v: self.question(author=v)),
            ("create_work_item_request", "execution_id"): plain(
                lambda v: self.question(execution_id=v)
            ),
            ("create_work_item_request", "session_id"): plain(
                lambda v: self.question(session_id=v)
            ),
            ("create_work_item_request", "addressees[]"): lambda v: (
                self.question(addressees=[v]),
                proved,
            ),
        }
        apply = "apply_work_item_changes"
        on_the_batch: dict[str, Callable[[str], Arguments]] = {
            "id": lambda v: {"id": v, "comment": {"body": "A note."}},
            "update.title": lambda v: batch(update={"title": v}),
            "update.description": lambda v: batch(update={"description": v}),
            "update.source": lambda v: batch(update={"source": v}),
            "update.labels[]": lambda v: batch(update={"labels": [v]}),
            "update.labels_add[]": lambda v: batch(update={"labels_add": [v]}),
            "update.labels_remove[]": lambda v: batch(update={"labels_remove": [v]}),
            "update.parent": lambda v: batch(update={"parent": v}),
            "update.projects[]": lambda v: batch(update={"projects": [v]}),
            "update.mentions[]": lambda v: batch(update={"description": "Told.", "mentions": [v]}),
            "convert.leftover.title": lambda v: {
                "id": three,
                "convert": {"to": "goal", "leftover": {"title": v, "steps": [step]}},
            },
            "checklist.items[]": lambda v: batch(checklist={"items": [v]}),
            "checklist.items[].id": lambda v: batch(checklist={"items": [{"id": v, "text": "A"}]}),
            "checklist.items[].text": lambda v: batch(checklist={"items": [{"text": v}]}),
            "checklist_reason": lambda v: batch(checklist={"items": ["A"]}, checklist_reason=v),
            "checklist_ticks[].item_id": lambda v: batch(checklist_ticks=[{"item_id": v}]),
            "refs[].value": lambda v: batch(refs=[{"kind": "memory", "value": v}]),
            "refs[].label": lambda v: batch(
                refs=[{"kind": "memory", "value": "mem_one", "label": v}]
            ),
            "links[].other": lambda v: batch(links=[{"other": v, "kind": "relates-to"}]),
            "resolutions[].resolution": lambda v: batch(
                comment={"body": "A root."}, resolutions=[{"comment_id": 1, "resolution": v}]
            ),
            "questions[].prompt": lambda v: ask(prompt=v),
            "questions[].execution_id": lambda v: ask(execution_id=v),
            "questions[].session_id": lambda v: ask(session_id=v),
            "summary.done": lambda v: batch(summary={"done": v, "next": "Nothing."}),
            "summary.next": lambda v: batch(summary={"done": "All.", "next": v}),
            "summary.why": lambda v: batch(summary={"done": "All.", "next": "None.", "why": v}),
            "summary.friction": lambda v: batch(
                summary={"done": "All.", "next": "None.", "friction": v}
            ),
            "summary.mentions[]": lambda v: batch(
                summary={"done": "All.", "next": "None.", "mentions": [v]}
            ),
            "transition.state": lambda v: batch(transition={"state": v}),
            "transition.to_check": lambda v: batch(transition={"state": "review", "to_check": v}),
            "transition.cancels": lambda v: {
                "id": self.goal,
                "summary": {"done": "Nothing.", "next": "None."},
                "transition": {"state": "cancelled", "cancels": v},
            },
            "transition.following": lambda v: batch(
                transition={"state": "cancelled", "following": v}
            ),
            "defer.until": lambda v: batch(defer={"until": v, "reason": "Later."}),
            "defer.reason": lambda v: batch(defer={"until": "2027-01-01", "reason": v}),
            "author": lambda v: batch(comment={"body": "A note."}, author=v),
        }
        for where, place in (
            ("comment", lambda c: {"comment": c}),
            ("comments[]", lambda c: {"comments": [c]}),
        ):
            on_the_batch.update(
                {
                    f"{where}.body": lambda v, p=place: batch(**p({"body": v})),
                    f"{where}.checklist_item_id": lambda v, p=place: batch(
                        **p({"body": "B", "checklist_item_id": v})
                    ),
                    f"{where}.reply_to_request": lambda v, p=place: batch(
                        **p({"body": "B", "reply_to_request": v})
                    ),
                    f"{where}.mentions[]": lambda v, p=place: batch(
                        **p({"body": "B", "mentions": [v]})
                    ),
                }
            )
        lists: dict[str, Callable[[dict], Arguments]] = {
            "comment": lambda tick: batch(comment={"body": "B", "list": tick}),
            "comments[]": lambda tick: batch(comments=[{"body": "B", "list": tick}]),
            "summary": lambda tick: batch(summary={"done": "D", "next": "N", "list": tick}),
        }
        for where, put in lists.items():
            on_the_batch.update(
                {
                    f"{where}.list.label": lambda v, p=put: p({**LIST, "label": v}),
                    f"{where}.list.options[].id": lambda v, p=put: p(
                        {**LIST, "options": [{**OPTION, "id": v}]}
                    ),
                    f"{where}.list.options[].label": lambda v, p=put: p(
                        {**LIST, "options": [{**OPTION, "label": v}]}
                    ),
                    f"{where}.list.options[].description": lambda v, p=put: p(
                        {**LIST, "options": [{**OPTION, "description": v}]}
                    ),
                    f"{where}.list.options[].why": lambda v, p=put: p(
                        {**LIST, "options": [{**OPTION, "recommended": True, "why": v}]}
                    ),
                }
            )
        found.update({(apply, path): plain(build) for path, build in on_the_batch.items()})
        found[(apply, "questions[].addressees[]")] = lambda v: (ask(addressees=[v]), proved)
        return found

    def test_every_string_field_is_bounded_in_its_schema_or_named_unbounded(self) -> None:
        fields = published()
        bounded = {where for where, field in fields.items() if "maxLength" in field}
        self.assertEqual(set(), set(NO_LENGTH_OF_THEIR_OWN) - set(fields), "named, gone")
        self.assertEqual(
            set(),
            set(fields) - bounded - set(NO_LENGTH_OF_THEIR_OWN),
            "a string field with no maxLength and no reason it has none",
        )
        self.assertEqual(set(), bounded & set(NO_LENGTH_OF_THEIR_OWN), "bounded and unbounded")
        self.assertEqual(
            set(),
            bounded - set(self.cases()) - set(NOT_PROBED),
            "a bounded field this test does not probe",
        )

    def test_the_server_refuses_one_character_over_each_published_limit_and_no_fewer(
        self,
    ) -> None:
        fields = published()
        for (name, path), build in self.cases().items():
            with self.subTest(tool=name, field=path):
                limit = fields[(name, path)].get("maxLength")
                self.assertIsInstance(limit, int, "the schema publishes no maxLength")
                assert isinstance(limit, int)
                says = f"at most {limit}"
                over = self.refusal(name, *build("a" * (limit + 1)))
                self.assertIsNotNone(over, f"{limit + 1} characters were taken")
                self.assertIn(says, str(over))
                at = self.refusal(name, *build("a" * limit))
                self.assertNotIn(says, at or "", f"{limit} characters refused for their length")

    def test_a_field_not_probed_publishes_the_server_limit(self) -> None:
        fields = published()
        for where, limit in NOT_PROBED.items():
            with self.subTest(field=where):
                self.assertEqual(limit, fields[where].get("maxLength"))

    def test_a_title_at_its_limit_is_created_whole_and_one_over_creates_nothing(self) -> None:
        fields = published()
        limit = fields[("create_work_item", "title")].get("maxLength")
        self.assertEqual(200, limit)
        title = "t" * 200
        created = self.tool("create_work_item", space="LIM", title=title)
        self.assertEqual(title, self.tool("get_work_item", id=created["reference"])["title"])
        listed = self.tool("list_work_items", space="LIM")["work_items"]
        refused = self.refusal("create_work_item", {"space": "LIM", "title": "t" * 201}, None)
        self.assertIn("work_item.title must be at most 200 characters", str(refused))
        self.assertEqual(listed, self.tool("list_work_items", space="LIM")["work_items"])

    def test_a_ref_label_at_its_limit_is_attached_whole_and_one_over_attaches_nothing(
        self,
    ) -> None:
        fields = published()
        limit = fields[("apply_work_item_changes", "refs[].label")].get("maxLength")
        self.assertEqual(200, limit)
        label = "l" * 200
        self.tool(
            "apply_work_item_changes",
            id=self.one,
            refs=[{"kind": "url", "value": "https://example.com/a", "label": label}],
        )
        refs = self.tool("get_work_item", id=self.one, parts="refs")["refs"]
        self.assertEqual([label], [ref["label"] for ref in refs])
        refused = self.refusal(
            "apply_work_item_changes",
            {
                "id": self.one,
                "comment": {"body": "Written only with the ref."},
                "refs": [{"kind": "url", "value": "https://example.com/b", "label": "l" * 201}],
            },
            None,
        )
        self.assertIn("work_item_ref.label must be at most 200 characters", str(refused))
        after = self.tool("get_work_item", id=self.one, parts=["refs", "comments"])
        self.assertEqual(refs, after["refs"])
        self.assertEqual([], after["comments"])


OPTION = {"id": "keep", "label": "Keep it"}
FIELD = {
    "id": "path",
    "label": "Which path",
    "type": "choice",
    "required": True,
    "options": [OPTION],
}
VERDICT = {
    "id": "point",
    "label": "Narrow the rule",
    "type": "verdict",
    "required": False,
    "options": [],
    "recommended": "accept",
}
LIST = {"label": "Pick any", "options": [OPTION]}


if __name__ == "__main__":
    unittest.main()
