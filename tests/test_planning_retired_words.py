"""The words the work model retired are refused on every input that took them.

`kind: epic`, `scope: epic`, the categories `backlog` and `queued`, the key
`todo` and the service word `container` were names a caller used. None is read
as its replacement: each is refused, the refusal names what replaces it, and the
refused call writes nothing. The words and what each refusal says are stated
here from the work model, not read from the list in `model`.

Every input is driven with every word it took, through MCP and over HTTP. The MCP
inputs are also read off the published schemas, so a tool that starts taking a
kind, a scope, a category or a state fails this file until it is driven here.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from collections.abc import Callable, Iterator
from pathlib import Path
from unittest import mock

from server import mcp_surface, store
from server.planning import api, model, service, tools

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


def _fields(properties: dict, path: str) -> Iterator[tuple[str, str]]:
    """Each argument of a schema that names a kind, a scope, a category or a state."""

    for name, schema in properties.items():
        where = f"{path}.{name}"
        named = set(schema.get("enum", ()))
        if name == "kind" and "task" in named:
            yield "kind", where
        elif name == "scope" and "tree" in named:
            yield "scope", where
        elif name == "category" and "triage" in named:
            yield "category", where
        elif name == "state" and schema is tools._STATE:
            yield "state", where
        for inner in (schema.get("properties"), schema.get("items", {}).get("properties")):
            if inner:
                yield from _fields(inner, where)


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
        service.create_planning_space(self.conn, project_id="rw", name="Retired", key=KEY)
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

    def test_the_list_in_the_model_is_the_one_every_refusal_reads(self) -> None:
        self.assertEqual(
            {field: set(words) for field, words in RETIRED.items()},
            {field: set(words) for field, words in model.RETIRED_WORDS.items()},
        )

    def test_every_published_argument_that_takes_such_a_word_is_driven(self) -> None:
        published = {
            (field, f"mcp {tool['name']}{path}")
            for tool in tools.TOOLS
            for field, path in _fields(tool["inputSchema"]["properties"], "")
        }
        driven = {
            (field, where.split(",")[0])
            for field, inputs in INPUTS.items()
            for where in inputs
            if where.startswith("mcp ")
        }
        self.assertEqual(published, driven)

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


if __name__ == "__main__":
    unittest.main()
