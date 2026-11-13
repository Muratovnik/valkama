"""The word index: every write keeps it current, and what a word search finds.

Each kind of write is found by a word only it wrote, read back through
`search_work_items`, so a write path that forgot to mark its item, or an index
that kept a word an edit removed, fails here.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import store
from server.planning import requests, service, words


def field(label: str) -> dict:
    return {"id": "reply", "label": label, "type": "text", "required": True, "options": []}


class _Store(unittest.TestCase):
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
        service.create_planning_space(self.conn, project_id="words", name="Words", key="WRD")

    def item(self, title: str, **fields: object) -> dict:
        return service.create_work_item(self.conn, space="WRD", title=title, **fields)

    def found(self, query: str, **options: object) -> list[str]:
        return [
            item["reference"]
            for item in service.search_work_items(self.conn, query, **options)  # type: ignore[arg-type]
        ]


class EveryWriteKeepsTheIndexTests(_Store):
    def test_each_kind_of_write_is_found_by_a_word_it_wrote(self) -> None:
        first = self.item("Calibrate the anemometer", description="Mounted on the mast")
        second = self.item("Another item")
        reference = first["reference"]
        self.assertEqual([reference], self.found("anemometer"))  # a title
        self.assertEqual([reference], self.found("mast"))  # a description
        service.update_work_item(
            self.conn,
            reference,
            title="Calibrate the barometer",
            description="Mounted in the hangar",
            labels=["meteorology"],
            source="docs/weather.md#calibration",
        )
        for word in ("barometer", "hangar", "meteorology", "weather"):
            with self.subTest(edited=word):
                self.assertEqual([reference], self.found(word))
        # An edit takes the words it replaced out of the index.
        for word in ("anemometer", "mast"):
            with self.subTest(replaced=word):
                self.assertEqual([], self.found(word))
        comment = service.comment_work_item(self.conn, reference, "Spoke to the harbourmaster")
        self.assertEqual([reference], self.found("harbourmaster"))
        service.resolve_comment(
            self.conn, reference, comment["comment_id"], resolution="Moved to the lighthouse"
        )
        self.assertEqual([reference], self.found("lighthouse"))
        service.set_summary(
            self.conn, reference, {"done": "Recorded the isobars", "next": "Compare them"}
        )
        self.assertEqual([reference], self.found("isobars"))
        # A summary is read as its fields' text, not their names.
        self.assertEqual([], self.found("done"))
        request = requests.create(
            self.conn,
            second["reference"],
            kind="question",
            prompt="Which observatory?",
            fields=[field("Name the telescope")],
        )
        self.assertEqual([second["reference"]], self.found("observatory"))
        self.assertEqual([second["reference"]], self.found("telescope"))
        requests.resolve(
            self.conn,
            request["request_id"],
            status="answered",
            expected_revision=0,
            answers={"reply": "The refractor"},
        )
        self.assertEqual([second["reference"]], self.found("refractor"))
        self.assertEqual(
            0,
            self.conn.execute(
                "SELECT COUNT(*) FROM work_item_search_rows WHERE stale = 1"
            ).fetchone()[0],
        )

    def test_a_merge_carries_the_words_said_under_an_item_to_the_survivor(self) -> None:
        survivor = self.item("Survivor")
        merged = self.item("Folded away")
        service.comment_work_item(self.conn, merged["reference"], "about a narwhal")
        self.assertEqual([merged["reference"]], self.found("narwhal"))
        service.merge_work_items(self.conn, survivor["reference"], [merged["reference"]])
        self.assertEqual([survivor["reference"]], self.found("narwhal"))

    def test_a_writer_outside_the_service_marks_what_it_moves(self) -> None:
        """An older build, or any statement, moving a comment marks both of its items."""

        source = self.item("Source")
        target = self.item("Target")
        service.comment_work_item(self.conn, source["reference"], "about an okapi")
        self.conn.execute(
            "UPDATE work_item_comments SET work_item_id = ? WHERE work_item_id = ?",
            (target["work_item_id"], source["work_item_id"]),
        )
        self.assertEqual(
            sorted([(source["work_item_id"], 1), (target["work_item_id"], 1)]),
            sorted(
                tuple(row)
                for row in self.conn.execute(
                    "SELECT work_item_id, stale FROM work_item_search_rows"
                )
            ),
        )
        words.bring_current(self.conn)
        self.assertEqual([target["reference"]], self.found("okapi"))

    def test_a_deleted_item_leaves_the_index(self) -> None:
        doomed = self.item("Ephemeral platypus")
        service.delete_work_item(self.conn, doomed["reference"])
        self.assertEqual([], self.found("platypus"))
        self.assertEqual(
            (0, 0),
            self.conn.execute(
                "SELECT (SELECT COUNT(*) FROM work_item_search_rows),"
                " (SELECT COUNT(*) FROM work_item_search)"
            ).fetchone()[:],
        )


class WordSearchTests(_Store):
    def test_a_title_hit_ranks_above_a_description_hit(self) -> None:
        described = self.item("Unrelated heading", description="The gearbox rattles")
        titled = self.item("Gearbox rattles", description="Seen on the test bench")
        # The description hit is the newer change, which ordered the substring search.
        service.update_work_item(self.conn, described["reference"], priority="high")
        self.assertEqual([titled["reference"], described["reference"]], self.found("gearbox"))

    def test_three_words_standing_apart_find_the_item(self) -> None:
        wanted = self.item("Index the comments", description="Searches must read what agents wrote")
        service.comment_work_item(self.conn, wanted["reference"], "ranking by bm25 later")
        self.item("Index the titles only")
        # Words in other forms, apart, across the title, the description and a comment.
        self.assertEqual([wanted["reference"]], self.found("searching comment rankings"))

    def test_a_russian_word_meets_its_other_forms_and_yo_meets_ie(self) -> None:
        # "Poisk po slovam" with a description "yolka"; asked for as "poiska slov" and
        # as "yelka", the spelling with ie for yo.
        wanted = self.item("Поиск по словам", description="ёлка")
        self.assertEqual([wanted["reference"]], self.found("поиска слов"))
        self.assertEqual([wanted["reference"]], self.found("елка"))

    def test_a_hit_says_which_comment_question_or_summary_holds_the_words(self) -> None:
        item = self.item("Plain title")
        service.comment_work_item(self.conn, item["reference"], "the flux capacitor hums")
        service.comment_work_item(self.conn, item["reference"], "unrelated")
        [hit] = service.search_work_items(self.conn, "capacitor flux")
        self.assertEqual("the flux capacitor hums", hit["comment_hit"])
        self.assertNotIn("question_hit", hit)
        self.assertNotIn("summary_hit", hit)

    def test_a_space_scopes_the_word_search(self) -> None:
        service.create_planning_space(self.conn, project_id="other", name="Other", key="OTH")
        here = self.item("Shared wording")
        service.create_work_item(self.conn, space="OTH", title="Shared wording")
        self.assertEqual([here["reference"]], self.found("wording", space="WRD"))
        self.assertEqual(2, len(self.found("wording")))

    def test_without_the_index_a_query_is_read_as_one_phrase(self) -> None:
        item = self.item("Two words", description="apart then together: words two")
        self.assertEqual([item["reference"]], self.found("two words"))
        self.conn.execute("DROP TABLE work_item_search")
        self.assertEqual([item["reference"]], self.found("words two"))
        self.assertEqual([], self.found("two together"))


class SimilarTests(_Store):
    def create(self, **arguments: object) -> dict:
        from server import mcp_surface

        answer = mcp_surface.call_tool(self.conn, "create_work_item", {"space": "WRD", **arguments})
        assert isinstance(answer, dict)
        return answer

    def test_a_new_item_names_the_open_items_reading_like_it(self) -> None:
        close = self.item("Search finds nothing for three words")
        nearer = self.item("Search finds nothing for three words or two")
        closed = self.item("Search finds nothing for three words, closed")
        service.transition_work_item(self.conn, closed["reference"], "cancelled", force=True)
        for number in range(3):
            self.item(f"Search unrelated {number}")
        self.item("Something else entirely")
        answer = self.create(title="Search finds nothing for three words or more")
        references = [entry["reference"] for entry in answer["similar"]]
        self.assertEqual(words.SIMILAR_LIMIT, len(references))
        self.assertEqual({nearer["reference"], close["reference"]}, set(references[:2]))
        self.assertNotIn(closed["reference"], references)
        self.assertNotIn(answer["reference"], references)
        self.assertEqual(
            {"reference", "title"}, {key for entry in answer["similar"] for key in entry}
        )

    def test_a_linked_item_or_another_space_is_not_news(self) -> None:
        linked = self.item("Calibrate the hygrometer")
        service.create_planning_space(self.conn, project_id="other", name="Other", key="OTH")
        service.create_work_item(self.conn, space="OTH", title="Calibrate the hygrometer")
        answer = self.create(
            title="Calibrate the hygrometer again",
            links=[{"other": linked["reference"], "kind": "discovered-from"}],
        )
        self.assertEqual([], answer["similar"])

    def test_nothing_alike_names_nothing_and_creates_anyway(self) -> None:
        self.item("Calibrate the hygrometer")
        answer = self.create(title="Paint the fence")
        self.assertEqual([], answer["similar"])
        self.assertEqual(
            "Paint the fence", service.get_work_item(self.conn, answer["reference"])["title"]
        )

    def test_a_short_title_borrows_the_description_words(self) -> None:
        wanted = self.item("Quarterly reconciliation of the ledger")
        answer = self.create(title="Ledger", description="quarterly reconciliation is late")
        self.assertEqual([wanted["reference"]], [entry["reference"] for entry in answer["similar"]])


if __name__ == "__main__":
    unittest.main()
