"""The words the work model retired are refused on every input that took them.

`kind: epic`, `scope: epic`, the categories `backlog` and `queued`, the key
`todo` and the service word `container` were names a caller used. None is read
as its replacement: each is refused, the refusal names what replaces it, and the
refused call writes nothing. The words and what each refusal says are stated
here from the work model, not read from the list in `model`.

Every input is driven with every word it took, through MCP and over HTTP. Every
published MCP argument and every HTTP parameter named kind, scope, category or
state is read off the schemas and the route registries, so one that is added fails
this file until it is driven here, or listed with the reason it takes no such word.

The field `rank`, which placed an item by hand among the items of its state, is
retired the same way: the order of work is computed, and a write naming the field
is refused with what computes it (`tests/test_planning_api.py` and
`tests/test_planning_apply_groups.py` drive it on every write that took it).

What an agent reads does not teach the words either: no tool's schema, no line of
the handshake and no page of the skill Valkama ships names one, nor the field.
"""

from __future__ import annotations

import ast
import inspect
import json
import os
import re
import sqlite3
import tempfile
import textwrap
import unittest
from collections.abc import Callable, Iterator
from pathlib import Path
from unittest import mock

from server import mcp_surface, store
from server.ops import skills
from server.planning import api, model, service

KEY = "RW"
CONTAINER = (
    "container is not a category: an accepted goal or stage shows container_state;"
    " accept one with ready"
)
#: What a refusal that lists a workflow's states says, beside the states it lists.
STATES_LISTED = "its states are triage (triage), deferred (deferred), ready (ready), dev (active)"
CATEGORIES_LISTED = (
    "the categories are triage, deferred, ready, active, review, completed, blocked, cancelled"
)

#: Each retired word, by the input that took it, with what its refusal must say.
RETIRED: dict[str, dict[str, tuple[str, ...]]] = {
    "kind": {"epic": ("kind epic is retired: a container is kind goal, or stage under a parent",)},
    "scope": {
        "epic": ("scope epic is retired: scope tree reads the item and everything under it",)
    },
    "category": {
        "backlog": ("backlog is now triage", CATEGORIES_LISTED),
        "queued": ("queued is now ready", CATEGORIES_LISTED),
        "container": (CONTAINER,),
    },
    "state": {
        "backlog": ("backlog is now triage", "no state named backlog", STATES_LISTED),
        "queued": ("queued is now ready", "no state named queued", STATES_LISTED),
        "todo": ("no state named todo", STATES_LISTED),
        "container": (CONTAINER,),
    },
}

#: Each retired field, with what its refusal says.
RETIRED_FIELDS = {
    "rank": "rank is retired: the order of work is computed — urgent, started, a goal or"
    " stage under way, priority, age",
}

Call = Callable[["RetiredWordTests", str], object]


def _mcp(name: str, build: Callable[[RetiredWordTests, str], dict]) -> Call:
    return lambda case, word: mcp_surface.call_tool(case.conn, name, build(case, word))


def _get(path: str, build: Callable[[RetiredWordTests, str], dict[str, str]]) -> Call:
    def call(case: RetiredWordTests, word: str) -> object:
        query = {key: [value] for key, value in build(case, word).items()}
        return api.handle_get(case.conn, path, query)

    return call


def _post(path: str, build: Callable[[RetiredWordTests, str], dict]) -> Call:
    return lambda case, word: api.handle_post(case.conn, path, build(case, word))


#: Every input that took a retired word, by the field it is read as. A key that
#: starts with `mcp ` is the tool and the path of the argument in its schema.
INPUTS: dict[str, dict[str, Call]] = {
    "kind": {
        "mcp create_work_item.kind": _mcp(
            "create_work_item", lambda _case, word: {"space": KEY, "title": "New", "kind": word}
        ),
        "mcp list_work_items.kind": _mcp(
            "list_work_items", lambda _case, word: {"space": KEY, "kind": word}
        ),
        "mcp apply_work_item_changes.update.kind": _mcp(
            "apply_work_item_changes",
            lambda case, word: {"id": case.item, "update": {"kind": word}},
        ),
        "POST /api/planning/work-items": _post(
            "/api/planning/work-items",
            lambda _case, word: {"space": KEY, "title": "New", "kind": word},
        ),
        "POST /api/planning/work-item/update": _post(
            "/api/planning/work-item/update", lambda case, word: {"id": case.item, "kind": word}
        ),
        "POST /api/planning/work-item/apply update": _post(
            "/api/planning/work-item/apply",
            lambda case, word: {"id": case.item, "update": {"kind": word}},
        ),
        "GET /api/planning/work-items": _get(
            "/api/planning/work-items", lambda _case, word: {"space": KEY, "kind": word}
        ),
    },
    "scope": {
        "mcp get_work_item_chain.scope": _mcp(
            "get_work_item_chain", lambda case, word: {"id": case.item, "scope": word}
        ),
        "GET /api/planning/work-item/chain": _get(
            "/api/planning/work-item/chain", lambda case, word: {"id": case.item, "scope": word}
        ),
        "GET /api/planning/work-item/usage": _get(
            "/api/planning/work-item/usage", lambda case, word: {"id": case.item, "scope": word}
        ),
    },
    "category": {
        "mcp list_work_items.category": _mcp(
            "list_work_items", lambda _case, word: {"space": KEY, "category": word}
        ),
        "GET /api/planning/work-items": _get(
            "/api/planning/work-items", lambda _case, word: {"space": KEY, "category": word}
        ),
    },
    "state": {
        "mcp create_work_item.state": _mcp(
            "create_work_item", lambda _case, word: {"space": KEY, "title": "New", "state": word}
        ),
        "mcp list_work_items.state": _mcp(
            "list_work_items", lambda _case, word: {"space": KEY, "state": word}
        ),
        "mcp list_work_items.state, in every space": _mcp(
            "list_work_items", lambda _case, word: {"state": word}
        ),
        "mcp apply_work_item_changes.transition.state": _mcp(
            "apply_work_item_changes",
            lambda case, word: {"id": case.item, "transition": {"state": word}},
        ),
        "POST /api/planning/work-items": _post(
            "/api/planning/work-items",
            lambda _case, word: {"space": KEY, "title": "New", "state": word},
        ),
        "POST /api/planning/work-item/transition": _post(
            "/api/planning/work-item/transition",
            lambda case, word: {"id": case.item, "state": word},
        ),
        "POST /api/planning/work-item/apply transition": _post(
            "/api/planning/work-item/apply",
            lambda case, word: {"id": case.item, "transition": {"state": word}},
        ),
        "GET /api/planning/work-items": _get(
            "/api/planning/work-items", lambda _case, word: {"space": KEY, "state": word}
        ),
    },
}


#: The names the census reads: a caller sends a word under one of them, so each
#: such input is driven above or listed below with the reason it takes no retired word.
CENSUSED = frozenset({"state", "kind", "category", "scope"})

#: Inputs named `kind` that take no work-model word, each with the values it takes.
#: A new input with a census name is driven above or listed here with its reason.
NOT_WORK_MODEL_KINDS: dict[str, str] = {
    "mcp create_work_item.links[].kind": "a link kind",
    "mcp apply_work_item_changes.links[].kind": "a link kind",
    "mcp apply_work_item_changes.refs[].kind": "a ref kind: commit, memory, session or url",
    "mcp apply_work_item_changes.questions[].kind": "a question kind: question or decision",
    "mcp create_work_item_request.kind": "a request kind: question or decision",
    "POST /api/planning/work-items links": "a link kind",
    "POST /api/planning/work-item/apply links": "a link kind",
    "POST /api/planning/work-item/apply refs": "a ref kind",
    "POST /api/planning/work-item/apply questions": "a question kind",
    "POST /api/planning/work-item/link": "a link kind",
    "POST /api/planning/work-item/ref": "a ref kind",
    "POST /api/planning/work-item/request": "a request kind",
}

#: Inputs named `kind` that came after the words were retired: they never took one, and
#: refuse it as they refuse any value that is no kind they take, naming the kinds they do.
KINDS_SINCE_RETIRED: dict[str, str] = {
    "GET /api/planning/volumes": "a filter of tasks: task, bug or improvement"
    " (`tests/test_planning_volumes.py` drives goal, stage, epic and container)",
}

#: The names a route reads from its request; a helper it passes the request to reads them too.
REQUEST_MAPPINGS = frozenset({"payload", "parameters"})


def _mcp_census(schema: dict, path: str) -> Iterator[tuple[str, str]]:
    """Each argument of an input schema, at any depth, that has a census name."""

    for name, sub in schema.get("properties", {}).items():
        where = f"{path}.{name}"
        if name in CENSUSED:
            yield name, where
        yield from _mcp_census(sub, where)
        if isinstance(sub.get("items"), dict):
            yield from _mcp_census(sub["items"], where + "[]")


def _names_read(function: Callable, helpers: dict[str, Callable], seen: set[str]) -> set[str]:
    """The string arguments a route reads from its request, followed through its helpers.

    A route reads a parameter as a literal argument of a call (`_first(parameters,
    "state")`) or a subscript of the request. A helper the request is passed to is
    read the same way, so `_created(conn, payload)` contributes its names; a call
    that passes some other mapping, such as one group's entry, does not.
    """

    tree = ast.parse(textwrap.dedent(inspect.getsource(function)))
    found: set[str] = set()
    called: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            found.update(
                arg.value
                for arg in node.args
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str)
            )
            if isinstance(node.func, ast.Name) and any(
                isinstance(arg, ast.Name) and arg.id in REQUEST_MAPPINGS for arg in node.args
            ):
                called.add(node.func.id)
        elif (
            isinstance(node, ast.Subscript)
            and isinstance(node.value, ast.Name)
            and node.value.id in REQUEST_MAPPINGS
            and isinstance(node.slice, ast.Constant)
            and isinstance(node.slice.value, str)
        ):
            found.add(node.slice.value)
    for name in sorted(called - seen):
        seen.add(name)
        if name in helpers:
            found |= _names_read(helpers[name], helpers, seen)
    return found


def _http_census() -> set[tuple[str, str]]:
    """Each HTTP parameter with a census name, keyed by the route or apply group reading it."""

    helpers = {
        name: value
        for name, value in vars(api).items()
        if inspect.isfunction(value) and value.__module__ == api.__name__
    }
    found: set[tuple[str, str]] = set()
    for method, routes in (("GET", api._READS), ("POST", api._WRITES)):
        for path, handler in routes.items():
            read = _names_read(handler, helpers, set()) & CENSUSED
            found.update((name, f"{method} {path}") for name in read)
    for group, fields in api.APPLY_GROUPS:
        found.update(
            (name, f"POST /api/planning/work-item/apply {group}") for name in fields & CENSUSED
        )
    for group, fields in api.CREATE_GROUPS:
        found.update((name, f"POST /api/planning/work-items {group}") for name in fields & CENSUSED)
    return found


class RetiredWordTests(unittest.TestCase):
    conn: sqlite3.Connection
    item: str

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": str(Path(directory.name) / "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Retired", key=KEY)
        self.item = str(service.create_work_item(self.conn, space=KEY, title="Work")["reference"])
        self.conn.commit()

    def store_as_it_stands(self) -> list[str]:
        """Everything the store holds, as this connection reads it before any rollback."""

        return list(self.conn.iterdump())

    def test_every_input_refuses_every_word_it_took_naming_the_replacement(self) -> None:
        for field, words in RETIRED.items():
            for word, told in words.items():
                for where, call in INPUTS[field].items():
                    with self.subTest(field=field, word=word, input=where):
                        before = self.store_as_it_stands()
                        with self.assertRaises(Exception) as refused:
                            call(self, word)
                        status, body = api.error_response(refused.exception)
                        self.assertEqual(400, status)
                        self.assertEqual("invalid_request", body["error"]["code"])
                        for text in told:
                            self.assertIn(text, body["error"]["message"])
                        self.assertEqual(before, self.store_as_it_stands(), "nothing is written")
                        self.conn.rollback()

    def test_the_retired_fields_are_the_ones_the_model_lists(self) -> None:
        self.assertEqual(RETIRED_FIELDS, model.RETIRED_FIELDS)

    def test_the_list_in_the_model_is_the_one_every_refusal_reads(self) -> None:
        self.assertEqual(
            {field: set(words) for field, words in RETIRED.items()},
            {field: set(words) for field, words in model.RETIRED_WORDS.items()},
        )

    def test_every_published_argument_named_for_a_word_is_driven_or_listed(self) -> None:
        published = {
            (name, f"mcp {where}")
            for tool in mcp_surface.catalogue()
            for name, where in _mcp_census(tool["inputSchema"], tool["name"])
        } | _http_census()
        driven = {
            (field, where.split(",")[0]) for field, inputs in INPUTS.items() for where in inputs
        }
        listed = driven | {
            ("kind", where) for where in (*NOT_WORK_MODEL_KINDS, *KINDS_SINCE_RETIRED)
        }
        self.assertEqual(set(), published - listed, "published but neither driven nor listed")
        self.assertEqual(set(), listed - published, "driven or listed but not published")

    def test_the_replacements_are_taken(self) -> None:
        """The words a refusal offers are ones the same input reads."""

        goal = mcp_surface.call_tool(
            self.conn, "create_work_item", {"space": KEY, "title": "Goal", "kind": "goal"}
        )
        self.assertEqual("goal", goal["kind"])
        chain = api.handle_get(
            self.conn, "/api/planning/work-item/chain", {"id": [self.item], "scope": ["tree"]}
        )
        assert chain is not None
        self.assertEqual("tree", chain[1]["chain"]["scope"])
        for category in ("triage", "ready"):
            with self.subTest(category=category):
                listed = mcp_surface.call_tool(
                    self.conn, "list_work_items", {"space": KEY, "category": category}
                )
                self.assertIn("work_items", listed)
        listed = mcp_surface.call_tool(
            self.conn, "list_work_items", {"space": KEY, "state": "ready"}
        )
        self.assertIn("work_items", listed)


#: Where the skill Valkama ships lives in this checkout.
SKILL = Path(__file__).resolve().parent.parent.joinpath(*skills.SOURCE_PARTS)
#: A retired word as a word of its own: `container_state` is not `container`.
RETIRED_WORD = re.compile(
    r"\b("
    + "|".join(sorted({word for words in RETIRED.values() for word in words} | set(RETIRED_FIELDS)))
    + r")\b",
    re.IGNORECASE,
)


class WhatAnAgentReadsTests(unittest.TestCase):
    def assert_names_no_retired_word(self, where: str, text: str) -> None:
        found = sorted({match.group(0) for match in RETIRED_WORD.finditer(text)})
        self.assertEqual([], found, f"{where} names a retired word")

    def test_no_tool_schema_names_a_retired_word(self) -> None:
        for tool in mcp_surface.catalogue():
            with self.subTest(tool=tool["name"]):
                self.assert_names_no_retired_word(tool["name"], json.dumps(tool))

    def test_the_handshake_names_no_retired_word(self) -> None:
        self.assert_names_no_retired_word("the handshake", mcp_surface.PLANNING_INSTRUCTIONS)

    def test_the_skill_names_no_retired_word(self) -> None:
        pages = sorted(SKILL.rglob("*.md"))
        self.assertIn(SKILL / "SKILL.md", pages)
        for page in pages:
            with self.subTest(page=page.relative_to(SKILL).as_posix()):
                self.assert_names_no_retired_word(page.name, page.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
