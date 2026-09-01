from __future__ import annotations

import contextlib
import io
import json
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from server import cli, store
from server.planning import migration, model, service, views
from server.platform.contracts import planning_space_entity
from server.platform.scope import read_store_metadata
from tests import board_era
from tests.registry_fixtures import project_binding, project_entry, registry_bytes


def _space_ref(data_scope_id: str, space_key: str) -> dict:
    """The canonical Planning identity Host Runtime projects."""

    return planning_space_entity({"data_scope_id": data_scope_id, "space_key": space_key})


class PlanningMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.build_board_domain()

    def build_board_domain(self) -> None:
        """A board with everything the mapping has to carry.

        Written as rows rather than through the board API, because the module
        that owned that API is gone. Every value below is one the conversion
        reads: a lane, a parent, two link kinds, a claimed and ticked checklist
        step, a comment, a ref, a claim, a summary, and a second board nothing
        registers.
        """

        workbench = board_era.seed(self.conn, "Alpha Workspace")
        elsewhere = board_era.seed(self.conn, "Unregistered Board")
        epic = board_era.add_card(self.conn, workbench, "The epic")
        child = board_era.add_card(
            self.conn,
            workbench,
            "The child",
            parent_id=epic,
            lane="review",
            claimed_by="one",
            checklist=json.dumps(
                [
                    {
                        # The Board era's own id form, which the conversion has
                        # to recognise: `ci_` and 32 hex digits.
                        "id": "ci_3f2a1c4e00004000800000000000abcd",
                        "text": "write it",
                        "done": True,
                        "claimed_by": "one",
                        "done_by": "one",
                    },
                    {
                        "id": "3f2a1c4e-0000-4000-8000-000000000002",
                        "text": "test it",
                        "done": False,
                        "claimed_by": "",
                        "done_by": "",
                    },
                ]
            ),
            summary=json.dumps({"done": "d", "next": "n", "why": "w"}),
        )
        blocker = board_era.add_card(self.conn, workbench, "The blocker")
        self.conn.executemany(
            "INSERT INTO links(from_id,to_id,kind) VALUES(?,?,?)",
            [(blocker, child, "blocks"), (epic, blocker, "discovered_from")],
        )
        self.conn.execute(
            "INSERT INTO comments(card_id,author,body) VALUES(?,?,?)", (child, "one", "a note")
        )
        self.conn.execute(
            "INSERT INTO refs(card_id,kind,value,author) VALUES(?,?,?,?)",
            (child, "commit", "abc1234", "one"),
        )
        self.conn.executemany(
            "INSERT INTO events(card_id,author,action,detail) VALUES(?,?,?,?)",
            [
                (child, "one", "created", "backlog"),
                (child, "one", "claimed", "one"),
                (child, "one", "moved", "dev -> review"),
                (child, "one", "checklist_completed", "write it"),
                (child, "one", "summarized", "d"),
            ],
        )
        board_era.add_card(self.conn, elsewhere, "Elsewhere")
        self.conn.commit()
        self.epic_id = epic
        self.child_id = child
        self.blocker_id = blocker
        self.steps = json.loads(
            self.conn.execute("SELECT checklist FROM cards WHERE id = ?", (child,)).fetchone()[0]
        )

    def migrate(self) -> dict:
        return migration.migrate_board_domain(
            self.conn,
            project_for_space={
                "AW": "example-workspace",
                "UB": "unregistered-workspace",
            },
        )

    # -- what moves ----------------------------------------------------------

    def test_every_row_moves_and_the_counts_are_checked(self) -> None:
        result = self.migrate()
        self.assertEqual(2, result["spaces"])
        self.assertEqual(4, result["work_items"])
        self.assertEqual(2, result["links"])
        self.assertEqual(1, result["comments"])
        self.assertEqual(1, result["refs"])
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0], result["events"]
        )

    def test_a_board_becomes_a_space_only_with_an_explicit_project_binding(self) -> None:
        self.migrate()
        spaces = {space["name"]: space for space in service.list_planning_spaces(self.conn)}
        self.assertEqual("example-workspace", spaces["Alpha Workspace"]["project_id"])
        self.assertEqual("unregistered-workspace", spaces["Unregistered Board"]["project_id"])
        self.assertEqual("AW", spaces["Alpha Workspace"]["key"])

    def test_an_unbound_board_refuses_instead_of_inferring_a_project_from_its_title(self) -> None:
        with self.assertRaisesRegex(
            migration.MigrationRefused,
            "no exact Project binding for planning space UB",
        ):
            migration.migrate_board_domain(
                self.conn,
                project_for_space={"AW": "example-workspace"},
            )

    def test_lanes_become_that_space_workflow_states(self) -> None:
        self.migrate()
        space = service.get_planning_space(self.conn, "Alpha Workspace")
        self.assertEqual(
            ["backlog", "todo", "dev", "review", "done", "blocked"],
            [state["key"] for state in space["workflow"]["states"]],
        )
        moved = service.get_work_item(self.conn, "EX-2")
        self.assertEqual("review", moved["state"]["key"])
        self.assertEqual("review", moved["state"]["category"])

    def test_numbers_follow_the_original_order_within_each_space(self) -> None:
        self.migrate()
        items = service.list_work_items(self.conn, space="AW")
        by_title = {item["title"]: item["reference"] for item in items}
        self.assertEqual("EX-1", by_title["The epic"])
        self.assertEqual("EX-2", by_title["The child"])
        self.assertEqual("EX-3", by_title["The blocker"])
        self.assertEqual("UB-1", service.list_work_items(self.conn, space="UB")[0]["reference"])

    def test_the_next_number_continues_where_the_board_stopped(self) -> None:
        self.migrate()
        created = service.create_work_item(self.conn, space="AW", title="After the migration")
        self.assertEqual("EX-4", created["reference"])

    def test_a_parent_becomes_an_epic_and_keeps_its_child(self) -> None:
        self.migrate()
        epic = service.get_work_item(self.conn, "EX-1")
        child = service.get_work_item(self.conn, "EX-2")
        self.assertEqual("epic", epic["kind"])
        self.assertEqual("task", child["kind"])
        self.assertEqual(epic["work_item_id"], child["parent_id"])

    def test_links_keep_their_direction_and_gain_the_neutral_name(self) -> None:
        self.migrate()
        child = service.get_work_item(self.conn, "EX-2")
        blocker = service.get_work_item(self.conn, "EX-3")
        self.assertEqual(
            [("blocks", "incoming", "EX-3")],
            [(link["kind"], link["direction"], link["reference"]) for link in child["links"]],
        )
        kinds = {link["kind"] for link in blocker["links"]}
        self.assertEqual({"blocks", "discovered-from"}, kinds)

    def test_a_checklist_step_keeps_its_identity_through_the_rename(self) -> None:
        self.migrate()
        child = service.get_work_item(self.conn, "EX-2")
        original = self.steps[0]["id"]
        self.assertTrue(original.startswith("ci_"))
        digits = original[3:]
        expected = "-".join((digits[:8], digits[8:12], digits[12:16], digits[16:20], digits[20:]))
        self.assertEqual(expected, child["checklist"][0]["id"])
        self.assertTrue(child["checklist"][0]["done"])
        self.assertEqual("one", child["checklist"][0]["done_by"])

    def test_a_summary_survives_with_all_three_fields(self) -> None:
        self.migrate()
        child = service.get_work_item(self.conn, "EX-2")
        self.assertEqual({"done": "d", "why": "w", "next": "n"}, child["summary"])

    def test_a_lane_change_reads_as_a_transition_afterwards(self) -> None:
        self.migrate()
        child = service.get_work_item(self.conn, "EX-2")
        actions = [event["action"] for event in child["events"]]
        self.assertIn("transitioned", actions)
        self.assertNotIn("moved", actions)
        self.assertEqual("created", actions[0])

    def test_the_claim_and_the_revision_carry_over(self) -> None:
        self.migrate()
        child = service.get_work_item(self.conn, "EX-2")
        self.assertEqual("one", child["claim_ref"])
        self.assertEqual(0, child["revision"])

    def test_the_read_model_answers_immediately_after_the_migration(self) -> None:
        self.migrate()
        payload = views.planning_payload(self.conn, space="AW")
        self.assertEqual(3, len(payload["work_items"]))
        self.assertEqual(2, len(payload["links"]))
        graph = views.graph_payload(self.conn, space="AW")
        ready = {node["reference"]: node["ready"] for node in graph["nodes"]}
        self.assertFalse(ready["EX-2"])
        self.assertTrue(ready["EX-3"])

    # -- what a real store turned out to hold --------------------------------

    def test_three_checklist_id_schemes_all_survive(self) -> None:
        """The store this migrates from holds all three, and only one is a UUID.

        `ci_` and thirty-two hex digits is a UUID without its dashes, so that
        identity is kept exactly. An older `ci_<card>_<index>` is not a UUID at
        all and derives to one that is the same on every run. A step with no id
        was never referenceable and gets a fresh one.
        """

        self.conn.execute(
            "UPDATE cards SET checklist = ? WHERE id = ?",
            (
                json.dumps(
                    [
                        {"id": "ci_" + "a" * 32, "text": "kept exactly", "done": False},
                        {"id": "ci_44_0", "text": "an older scheme", "done": False},
                        {"id": "", "text": "never referenceable", "done": False},
                    ]
                ),
                self.child_id,
            ),
        )
        self.migrate()
        steps = service.get_work_item(self.conn, "EX-2")["checklist"]
        self.assertEqual("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", steps[0]["id"])
        self.assertEqual(
            migration._step_id("ci_44_0", self.child_id),
            steps[1]["id"],
            "a derived id must be the same on every run",
        )
        self.assertNotEqual(steps[1]["id"], steps[2]["id"])
        for step in steps:
            model.identifier(step["id"], "checklist step id")

    def test_a_checklist_step_longer_than_a_title_survives(self) -> None:
        long_step = "x" * 213
        self.conn.execute(
            "UPDATE cards SET checklist = ? WHERE id = ?",
            (
                json.dumps([{"id": "ci_" + "b" * 32, "text": long_step, "done": False}]),
                self.child_id,
            ),
        )
        self.migrate()
        steps = service.get_work_item(self.conn, "EX-2")["checklist"]
        self.assertEqual(long_step, steps[0]["text"])

    def test_an_author_that_is_not_an_identifier_survives(self) -> None:
        """Real agents named themselves with slashes, spaces and Cyrillic."""

        recorded = "claude (session 2026-08-18, аудит Valkama)"
        self.conn.execute("UPDATE cards SET claimed_by = ? WHERE id = ?", (recorded, self.child_id))
        self.conn.execute(
            "UPDATE events SET author = ? WHERE card_id = ?", ("Codex /task", self.child_id)
        )
        self.conn.execute(
            "UPDATE comments SET author = ? WHERE card_id = ?",
            ("/task/card3_writer", self.child_id),
        )
        self.migrate()
        child = service.get_work_item(self.conn, "EX-2")
        self.assertEqual(recorded, child["claim_ref"])
        self.assertEqual({"Codex /task"}, {event["author"] for event in child["events"]})
        self.assertEqual(["/task/card3_writer"], [note["author"] for note in child["comments"]])

    # -- what it refuses -----------------------------------------------------

    def test_running_it_twice_is_refused(self) -> None:
        self.migrate()
        with self.assertRaisesRegex(migration.MigrationRefused, "one-shot"):
            self.migrate()

    def test_a_launch_packet_stops_the_migration_rather_than_being_dropped(self) -> None:
        self.conn.execute(
            "UPDATE cards SET launch = ? WHERE id = ?",
            (json.dumps({"client": "codex"}), self.child_id),
        )
        with self.assertRaisesRegex(migration.MigrationRefused, "launch packet"):
            self.migrate()
        self.assertEqual(0, self.conn.execute("SELECT COUNT(*) FROM work_items").fetchone()[0])

    def test_a_lane_the_mapping_does_not_know_stops_it(self) -> None:
        # A store whose cards table predates the current CHECK can hold a lane
        # this mapping has never seen, so the fixture is built that way rather
        # than pretending the constraint is not there.
        self.conn.execute("ALTER TABLE cards RENAME TO cards_without_check")
        self.conn.execute(
            "CREATE TABLE cards(id INTEGER PRIMARY KEY, board_id INTEGER NOT NULL, lane TEXT"
            " NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', priority TEXT"
            " NOT NULL DEFAULT 'medium', labels TEXT NOT NULL DEFAULT '[]', position REAL NOT"
            " NULL, source TEXT NOT NULL DEFAULT '', parent_id INTEGER, claimed_by TEXT NOT NULL"
            " DEFAULT '', checklist TEXT NOT NULL DEFAULT '[]', summary TEXT NOT NULL DEFAULT '',"
            " launch TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0, created_at"
            " TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        self.conn.execute(
            "INSERT INTO cards SELECT id,board_id,lane,title,description,priority,labels,position,"
            "source,parent_id,claimed_by,checklist,summary,launch,revision,created_at,updated_at"
            " FROM cards_without_check"
        )
        self.conn.execute("DROP TABLE cards_without_check")
        self.conn.execute("UPDATE cards SET lane = 'parked' WHERE id = ?", (self.blocker_id,))
        with self.assertRaisesRegex(migration.MigrationRefused, "parked"):
            self.migrate()

    def registry(self, *projects: dict) -> object:
        """Supply strict owner bytes through the parser's test seam."""

        return mock.patch.object(
            store.project_registry,
            "_read_registry_bytes",
            return_value=registry_bytes(list(projects)),
        )

    def test_the_project_that_binds_the_exact_space_owns_it(self) -> None:
        """The canonical resource binding decides, not a matching title.

        Two projects name the board `Alpha Workspace`: the umbrella workspace,
        which binds it, and an independent project whose sessions record there
        and which binds nothing.
        """

        data_scope_id = read_store_metadata(self.conn)["data_scope_id"]
        resource_ref = _space_ref(data_scope_id, "AW")
        root = os.path.dirname(self.path)
        with self.registry(
            project_entry(
                "example-workspace",
                root,
                board="Alpha Workspace",
                bindings=[project_binding("example-workspace", resource_ref)],
            ),
            project_entry(
                "sample-project",
                root + "-sample",
                board="Alpha Workspace",
            ),
        ):
            self.assertEqual({"AW": "example-workspace"}, store._project_for_space(data_scope_id))

    def test_competing_exact_space_bindings_reject_the_whole_registry(self) -> None:
        data_scope_id = read_store_metadata(self.conn)["data_scope_id"]
        resource_ref = _space_ref(data_scope_id, "AW")
        root = os.path.dirname(self.path)
        with self.registry(
            project_entry(
                "one",
                root + "-one",
                bindings=[project_binding("one", resource_ref)],
            ),
            project_entry(
                "two",
                root + "-two",
                bindings=[project_binding("two", resource_ref)],
            ),
        ):
            self.assertEqual({}, store._project_for_space(data_scope_id))

    def test_a_binding_for_another_data_scope_cannot_claim_the_space(self) -> None:
        data_scope_id = read_store_metadata(self.conn)["data_scope_id"]
        other_ref = _space_ref("33333333-3333-4333-8333-333333333333", "AW")
        root = os.path.dirname(self.path)
        with self.registry(
            project_entry(
                "one",
                root + "-one",
                bindings=[project_binding("one", other_ref)],
            ),
            project_entry("no-bindings", root + "-unbound"),
        ):
            self.assertEqual({}, store._project_for_space(data_scope_id))

    def test_a_store_with_no_board_domain_is_refused(self) -> None:
        self.conn.execute("DROP TABLE events")
        self.conn.execute("DROP TABLE refs")
        self.conn.execute("DROP TABLE comments")
        self.conn.execute("DROP TABLE links")
        self.conn.execute("DROP TABLE cards")
        with self.assertRaisesRegex(migration.MigrationRefused, "no Board domain"):
            self.migrate()

    def test_a_count_that_disagrees_refuses_instead_of_reporting_success(self) -> None:
        real = migration._verify

        def short(conn, **counted):
            conn.execute(
                "DELETE FROM work_item_events WHERE id = (SELECT MIN(id) FROM work_item_events)"
            )
            return real(conn, **counted)

        with mock.patch.object(migration, "_verify", side_effect=short):
            with self.assertRaisesRegex(migration.MigrationRefused, "counts disagree"):
                self.migrate()

    def test_migration_exposes_no_title_derived_project_fallback(self) -> None:
        self.assertFalse(hasattr(migration, "_slug"))


class PlanningMigrationVocabularyTests(unittest.TestCase):
    def test_every_board_event_action_has_a_planning_action(self) -> None:
        for action in board_era.EVENT_ACTIONS:
            mapped = migration._ACTION_MAP.get(action, action)
            self.assertIn(mapped, model.EVENT_ACTIONS, action)

    def test_every_stored_board_link_kind_has_a_planning_kind(self) -> None:
        # `blocked_by` is an API spelling the Board layer stores as an inverted
        # `blocks`, so the rows only ever hold the two the CHECK allows.
        stored = {kind for kind in store.LINK_KINDS if kind != "blocked_by"}
        self.assertEqual({"blocks", "discovered_from"}, stored)
        for kind in stored:
            self.assertIn(migration._LINK_MAP[kind], model.LINK_KINDS)

    def test_every_board_lane_has_a_state_key(self) -> None:
        for lane in ("backlog", "todo", "dev", "review", "done", "blocked"):
            self.assertIn(
                migration._LANE_TO_STATE[lane],
                {key for key, _name, _category in model.DEFAULT_STATES},
            )

    def test_every_board_ref_kind_is_a_planning_ref_kind(self) -> None:
        for kind in store.REF_KINDS:
            self.assertIn(kind, model.REF_KINDS)


class PlanningMigrationCommandTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        conn = store.connect()
        try:
            resource_ref = planning_space_entity(
                {
                    "data_scope_id": read_store_metadata(conn)["data_scope_id"],
                    "space_key": "AW",
                }
            )
            registry = registry_bytes(
                [
                    project_entry(
                        "example-workspace",
                        directory.name,
                        board="Presentation only",
                        bindings=[project_binding("example-workspace", resource_ref)],
                    )
                ]
            )
            registry_patch = mock.patch.object(
                store.project_registry, "_read_registry_bytes", return_value=registry
            )
            registry_patch.start()
            self.addCleanup(registry_patch.stop)
            board_id = board_era.seed(conn, "Alpha Workspace")
            board_era.add_card(conn, board_id, "One card")
            conn.commit()
        finally:
            conn.close()

    def counts(self) -> tuple[int, int]:
        """Cards still present, and work items written.

        A converted store has no `cards` table at all, so its absence is the
        answer rather than an error.
        """

        conn = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)
        try:
            tables = {
                row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            cards = (
                conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0] if "cards" in tables else 0
            )
            return (cards, conn.execute("SELECT COUNT(*) FROM work_items").fetchone()[0])
        finally:
            conn.close()

    def test_a_dry_run_reports_what_would_move_and_keeps_the_store(self) -> None:
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            cli.migrate_main("planning-model", dry_run=True)
        reported = json.loads(printed.getvalue())
        self.assertTrue(reported["dry_run"])
        self.assertEqual(1, reported["work_items"])
        # The copy was converted; the store still holds its card and no item.
        self.assertEqual((1, 0), self.counts())

    def test_the_real_run_keeps_what_it_wrote(self) -> None:
        with contextlib.redirect_stdout(io.StringIO()) as printed:
            cli.migrate_main("planning-model")
        self.assertFalse(json.loads(printed.getvalue())["dry_run"])
        self.assertEqual((0, 1), self.counts())

    def test_a_refusal_exits_without_writing(self) -> None:
        with mock.patch.object(
            cli.store.planning_migration,
            "migrate_board_domain",
            side_effect=cli.store.planning_migration.MigrationRefused("a row it cannot express"),
        ):
            with self.assertRaisesRegex(
                cli.store.planning_migration.MigrationRefused, "cannot express"
            ):
                cli.migrate_main("planning-model")
        self.assertEqual((1, 0), self.counts())

    def test_an_unknown_migration_name_is_refused(self) -> None:
        with self.assertRaisesRegex(SystemExit, "unknown migration"):
            cli.migrate_main("something-else")


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
