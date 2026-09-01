"""Knowledge Valkama points at and does not own.

The provider under test is deliberately incomplete: a Markdown folder can be
searched and read and cannot be written. These cases are mostly about that
asymmetry staying visible, and about a pointer never resolving outside the root
it belongs to.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import http_surface, store
from server.memory import api as memory_api
from server.memory import contracts, service
from server.memory.markdown import MarkdownKnowledgeProvider
from server.planning import service as planning_service
from tests.registry_fixtures import project_entry, registry_bytes


class MemoryRefTests(unittest.TestCase):
    def test_a_pointer_names_the_connection_that_can_resolve_it(self) -> None:
        # Two providers may both mint `note-14`. An id with no connection is an
        # id that resolves against whichever provider is asked first.
        with self.assertRaises(contracts.KnowledgeError):
            contracts.memory_ref(connection_id="", resource_type="note", external_id="note-14")

    def test_an_unbounded_or_shaped_id_is_refused(self) -> None:
        for value in ("", " ", "x" * 300, "has space", "has\nnewline"):
            with self.subTest(value=value[:20]):
                with self.assertRaises(contracts.KnowledgeError):
                    contracts.memory_ref(
                        connection_id="local", resource_type="note", external_id=value
                    )

    def test_metadata_stays_flat_and_small(self) -> None:
        # Nested structure is where a copy of the record starts, and §16.6
        # forbids the copy rather than the nesting.
        ref = contracts.memory_ref(
            connection_id="local",
            resource_type="note",
            external_id="note-14",
            label="A label",
            metadata={"author": "owner", "nested": {"no": True}, "count": 3},
        )
        self.assertEqual({"author": "owner", "count": "3"}, ref["metadata"])
        self.assertEqual("A label", ref["label"])


class MarkdownProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.root = os.path.join(self._dir.name, "docs")
        os.makedirs(os.path.join(self.root, "decisions"))
        self.write("readme.md", "# Readme\n\nThe cutover is one way.\n")
        self.write("decisions/0001-store.md", "# Store decision\n\nA ratchet only tightens.\n")
        self.write("notes.txt", "cutover but not markdown\n")
        self.provider = MarkdownKnowledgeProvider(self.root)

    def write(self, name: str, body: str) -> None:
        with open(os.path.join(self.root, name), "w", encoding="utf-8", newline="\n") as handle:
            handle.write(body)

    def test_it_declares_what_it_cannot_do(self) -> None:
        # A capability a provider does not declare is one the interface never
        # offers, which is how a read-only source stays visibly read-only.
        self.assertIn("memory.search", MarkdownKnowledgeProvider.CAPABILITIES)
        self.assertNotIn("memory.write", MarkdownKnowledgeProvider.CAPABILITIES)
        self.assertNotIn("memory.attach", MarkdownKnowledgeProvider.CAPABILITIES)

    def test_a_search_finds_by_text_and_by_path_and_titles_the_result(self) -> None:
        answer = self.provider.search("ratchet")
        self.assertEqual(
            ["decisions/0001-store.md"], [item["external_id"] for item in answer["results"]]
        )
        self.assertEqual("Store decision", answer["results"][0]["label"])
        self.assertIn("ratchet", answer["results"][0]["snippet"])

        by_path = self.provider.search("decisions/")
        self.assertEqual(1, len(by_path["results"]))

    def test_only_markdown_is_knowledge_here(self) -> None:
        answer = self.provider.search("cutover")
        self.assertEqual(["readme.md"], [item["external_id"] for item in answer["results"]])

    def test_an_empty_query_is_refused_rather_than_matching_everything(self) -> None:
        with self.assertRaises(contracts.KnowledgeError):
            self.provider.search("   ")

    def test_a_pointer_cannot_escape_its_root(self) -> None:
        outside = os.path.join(self._dir.name, "secret.md")
        with open(outside, "w", encoding="utf-8", newline="\n") as handle:
            handle.write("# Secret\n")
        for pointer in ("../secret.md", "decisions/../../secret.md"):
            with self.subTest(pointer=pointer):
                with self.assertRaises(contracts.KnowledgeError):
                    self.provider.read(pointer)

    def test_a_missing_root_is_unavailable_rather_than_empty(self) -> None:
        # An empty result and an absent source read the same on a screen, and
        # only one of them is worth acting on.
        absent = MarkdownKnowledgeProvider(os.path.join(self._dir.name, "nowhere"))
        self.assertEqual("unavailable", absent.health()[0])
        self.assertEqual("unavailable", absent.search("anything")["health"])

    def test_reading_returns_the_document_and_its_own_pointer(self) -> None:
        answer = self.provider.read("readme.md")
        self.assertEqual("readme.md", answer["ref"]["external_id"])
        self.assertEqual("Readme", answer["ref"]["label"])
        self.assertIn("cutover", answer["markdown"])
        self.assertFalse(answer["truncated"])

    def test_a_snippet_is_cut_at_words_not_at_offsets(self) -> None:
        """A page of snippets makes a bad cut look like a bad document.

        The window is chosen by character count and lands mid-word at both
        ends. One of these in an inspector panel survives it; a list of them
        reads as corrupted text, and nothing tells the reader which it is.
        """

        root = os.path.join(self._dir.name, "wordy")
        os.makedirs(root)
        filler = "alpha bravo charlie delta echo foxtrot golf hotel india juliet "
        with open(os.path.join(root, "long.md"), "w", encoding="utf-8", newline="\n") as handle:
            handle.write(filler * 4 + "RATCHET " + filler * 20)
        (result,) = MarkdownKnowledgeProvider(root).search("ratchet")["results"]
        snippet = result["snippet"]
        self.assertIn("RATCHET", snippet)
        # Both ends are whole words of the source, not fragments of one.
        words = set(filler.split()) | {"RATCHET"}
        self.assertIn(snippet.split()[0], words)
        self.assertIn(snippet.split()[-1], words)

    def test_a_window_with_no_space_in_it_is_kept_rather_than_emptied(self) -> None:
        root = os.path.join(self._dir.name, "unbroken")
        os.makedirs(root)
        with open(os.path.join(root, "wall.md"), "w", encoding="utf-8", newline="\n") as handle:
            handle.write("x" * 200 + "ratchet" + "y" * 400)
        (result,) = MarkdownKnowledgeProvider(root).search("ratchet")["results"]
        self.assertIn("ratchet", result["snippet"])


class MemoryServiceTests(unittest.TestCase):
    """The project's own root, found through the registry that maps it."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.project = os.path.join(self._dir.name, "project")
        os.makedirs(os.path.join(self.project, "docs"))
        with open(
            os.path.join(self.project, "docs", "plan.md"), "w", encoding="utf-8", newline="\n"
        ) as handle:
            handle.write("# Plan\n\nOne migration, verified first.\n")
        self.registry = os.path.join(self._dir.name, "projects.json")
        Path(self.registry).write_bytes(
            registry_bytes(
                [
                    project_entry("sample", self.project, board="Sample"),
                    project_entry(
                        "rootless",
                        os.path.join(self._dir.name, "gone"),
                        board="Rootless",
                        source_hash="b" * 64,
                    ),
                ]
            )
        )
        self.registry_reader = Path(self.registry).read_bytes

    def test_the_root_comes_from_the_registry_that_maps_the_project(self) -> None:
        located = service.knowledge_root("sample", registry_reader=self.registry_reader)
        self.assertEqual("mapped", located["status"])
        self.assertTrue(located["root"].endswith("docs"))

    def test_a_project_with_no_docs_says_so_instead_of_searching_elsewhere(self) -> None:
        # A search that answers from the wrong repository is a worse failure
        # than one that answers nothing.
        answer = service.search("rootless", "migration", registry_reader=self.registry_reader)
        self.assertEqual([], answer["results"])
        self.assertEqual("unavailable", answer["health"])
        # A reason is `{code, message}` everywhere, provider or not. It was
        # plain text on this branch alone, so the view read `reason.message`
        # off a string and printed a generic line in place of the specific one.
        self.assertEqual("knowledge_root_absent", answer["reason"]["code"])
        self.assertIn("docs", answer["reason"]["message"])

    def test_every_registered_project_is_listed_with_whether_it_can_answer(self) -> None:
        """A project that cannot answer is stated, never omitted.

        Leaving it out would read as a project with no knowledge, and the two
        are different facts: one has nothing to say and the other cannot be
        asked. The page exists mostly for the second.
        """

        listing = service.providers(registry_reader=self.registry_reader)["providers"]
        self.assertEqual(["sample", "rootless"], [item["project_id"] for item in listing])
        self.assertEqual("ready", listing[0]["health"])
        self.assertIsNone(listing[0]["reason"])
        self.assertTrue(listing[0]["root"].endswith("docs"))
        self.assertEqual("unavailable", listing[1]["health"])
        self.assertEqual("knowledge_root_absent", listing[1]["reason"]["code"])
        self.assertEqual("", listing[1]["root"])
        for item in listing:
            self.assertNotIn("memory.write", item["capabilities"])

    def test_the_listing_is_worst_last_and_then_by_name(self) -> None:
        # Ready first: this list is read to pick a project to search, and one
        # that cannot answer is not a candidate.
        listing = service.providers(registry_reader=self.registry_reader)["providers"]
        self.assertEqual([False, True], [item["health"] != "ready" for item in listing])

    def test_an_answer_names_the_folder_that_produced_it(self) -> None:
        # Two projects both searching `docs` is the ordinary case here.
        answer = service.search("sample", "migration", registry_reader=self.registry_reader)
        self.assertTrue(answer["root"].endswith("docs"))
        self.assertEqual(
            "", service.search("rootless", "x", registry_reader=self.registry_reader)["root"]
        )

    def test_an_answer_carries_the_provider_and_what_it_can_do(self) -> None:
        answer = service.search("sample", "migration", registry_reader=self.registry_reader)
        self.assertEqual("markdown-knowledge", answer["provider_id"])
        self.assertNotIn("memory.write", answer["capabilities"])
        self.assertEqual(["plan.md"], [item["external_id"] for item in answer["results"]])

    def test_an_unknown_project_is_refused_by_name(self) -> None:
        answer = service.search("nobody", "x", registry_reader=self.registry_reader)
        self.assertEqual("unavailable", answer["health"])


class MemoryLinkTests(unittest.TestCase):
    """Attached pointers, which are Valkama's own record and need no provider."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.path = os.path.join(self._dir.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        planning_service.create_planning_space(
            self.conn, project_id="sample", name="Sample", key="SMP"
        )
        self.item = planning_service.create_work_item(
            self.conn, space="Sample", title="One work item"
        )

    def attach(self, value: str, label: str) -> None:
        planning_service.attach_ref(
            self.conn, self.item["work_item_id"], "memory", value, label=label
        )

    def test_a_pointer_reads_by_its_stored_label_and_names_its_work_item(self) -> None:
        """The label is stored, not resolved, which is why this still reads.

        AgentMemory is a one-way pointer: nothing here can open the record. A
        row that had to resolve one would be blank exactly when the source is
        unreachable, which is when a reader needs it.
        """

        self.attach("memory://record/abc123", "Why the cutover was one-way")
        answer = service.linked(self.conn, "sample")
        self.assertFalse(answer["truncated"])
        (link,) = answer["links"]
        self.assertEqual("memory://record/abc123", link["value"])
        self.assertEqual("Why the cutover was one-way", link["label"])
        self.assertEqual("SMP-1", link["work_item_key"])
        self.assertEqual("SMP", link["space_key"])
        self.assertEqual("One work item", link["work_item_title"])

    def test_another_project_is_not_this_project(self) -> None:
        self.attach("memory://record/abc123", "Ours")
        self.assertEqual([], service.linked(self.conn, "other")["links"])

    def test_only_memory_refs_are_memory(self) -> None:
        planning_service.attach_ref(
            self.conn, self.item["work_item_id"], "commit", "0f1e2d3", label="a commit"
        )
        self.assertEqual([], service.linked(self.conn, "sample")["links"])

    def test_the_page_is_bounded_and_says_when_it_cut(self) -> None:
        for index in range(service.MAX_LINKED + 3):
            self.attach(f"memory://record/{index:04d}", f"Record {index}")
        answer = service.linked(self.conn, "sample")
        self.assertEqual(service.MAX_LINKED, len(answer["links"]))
        self.assertTrue(answer["truncated"])


class MemoryRouteTests(unittest.TestCase):
    def test_every_memory_path_is_owned_and_dispatched(self) -> None:
        """A handler nobody routes to answers a bare 404, as layer 1 shipped."""

        for path in memory_api.READ_PATHS:
            self.assertEqual("memory", http_surface._HTTP_ROUTE_MODULES[("GET", path)], path)
            # Asked of the dispatch table rather than of the file's text: what
            # answers a request is the row that claims the path, so that is what
            # a test about routing has to resolve.
            boundary = http_surface._boundary(http_surface._GET_BOUNDARIES, path)
            self.assertIsNotNone(boundary, path)
            assert boundary is not None
            self.assertIs(http_surface._memory_read, boundary.handler, path)

    def test_the_boundary_has_no_write(self) -> None:
        # The provider behind it cannot write, and a boundary that offered one
        # would be the interface pretending a read-only source is another one.
        self.assertFalse(hasattr(memory_api, "WRITE_PATHS"))

    def test_a_request_that_names_no_project_is_refused(self) -> None:
        with self.assertRaises(memory_api.MemoryHttpError) as raised:
            memory_api.handle_get(None, "/api/memory/search", {"q": ["x"]})
        self.assertEqual(400, raised.exception.status)
        status, body = memory_api.error_response(raised.exception)
        self.assertEqual(400, status)
        self.assertEqual("invalid_request", body["error"]["code"])


if __name__ == "__main__":
    unittest.main()
