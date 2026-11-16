"""Where a new item lies, and the space a session's folder stands in.

Under a parent an item lies in its parent's space. Else its projects decide by
their home spaces: one home is where it lies, between several `space` names one,
and projects with no home need `space`. Without projects it lies in the space it
names, else in the space of the calling session. Every refusal is `[placement]`
and names the candidates, and a refused creation leaves nothing behind.

The registry is the one `RootsCase` writes: HOME binds `umbrella`, `inner` and
`side`; ROVER binds `rover`; `loose` and `ghost` are bound nowhere. TEST binds none.
"""

from __future__ import annotations

from pathlib import Path

from server import mcp_surface
from server.planning import api, item_projects, model, service
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_entry, registry_bytes
from tests.test_planning_launch_roots import RootsCase

CODEX = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3f"


class PlacementCase(RootsCase):
    def setUp(self) -> None:
        super().setUp()
        self.tool("create_planning_space", name="Testbed", key="TEST")

    def stand(self, folder: Path | None) -> dict:
        """The meta of a Codex session whose folder is `folder`."""

        self.conn.execute(
            "INSERT INTO sessions(id, client, cwd, opened_folder) VALUES (?, 'codex', ?, ?)"
            " ON CONFLICT(id) DO UPDATE SET client = excluded.client, cwd = excluded.cwd,"
            " opened_folder = excluded.opened_folder",
            (CODEX, "" if folder is None else str(folder), ""),
        )
        self.conn.commit()
        return {"sessionId": CODEX}

    def created(self, *, meta: dict | None = None, **arguments: object) -> dict:
        answer = mcp_surface.run_tool_call(
            self.conn,
            "create_work_item",
            {"title": "placed", "acceptance": "assignment", **arguments},
            meta=meta,
        )
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def space_of(self, answer: dict) -> str:
        return str(answer["reference"]).split("-", 1)[0]

    def refused(self, message: str, *, meta: dict | None = None, **arguments: object) -> None:
        """The creation is refused with `message`, and no item and no number is spent."""

        before = self.conn.execute(
            "SELECT (SELECT count(*) FROM work_items),"
            " (SELECT group_concat(next_number) FROM planning_spaces)"
        ).fetchone()
        with self.assertRaises(model.PlanningError) as caught:
            self.created(meta=meta, **arguments)
        self.conn.rollback()
        self.assertEqual(message, str(caught.exception))
        after = self.conn.execute(
            "SELECT (SELECT count(*) FROM work_items),"
            " (SELECT group_concat(next_number) FROM planning_spaces)"
        ).fetchone()
        self.assertEqual(tuple(before), tuple(after))


class ProjectsPlaceTests(PlacementCase):
    def test_an_item_lies_in_the_home_space_of_its_projects(self) -> None:
        # The oracle's four creations, with HOME for the umbrella space.
        self.assertEqual("HOME", self.space_of(self.created(projects=["inner"])))
        self.refused(
            "[placement] projects inner and rover live in HOME and ROVER: name one of them as space",
            projects=["inner", "rover"],
        )
        self.refused(
            "[placement] space TEST is none of the spaces of the item's projects: HOME, ROVER",
            projects=["inner", "rover"],
            space="TEST",
        )
        self.assertEqual(
            "ROVER", self.space_of(self.created(projects=["inner", "rover"], space="ROVER"))
        )

    def test_the_session_does_not_break_a_tie_between_two_homes(self) -> None:
        self.refused(
            "[placement] projects inner and rover live in HOME and ROVER: name one of them as space",
            projects=["rover", "inner"],
            meta=self.stand(self.dirs["rover"]),
        )

    def test_one_home_takes_the_item_wherever_the_session_stands(self) -> None:
        answer = self.created(projects=["rover"], meta=self.stand(self.dirs["side"]))
        self.assertEqual("ROVER", self.space_of(answer))

    def test_a_named_space_must_be_the_one_home(self) -> None:
        self.refused(
            "[placement] space ROVER is none of the spaces of the item's projects: HOME",
            projects=["inner", "side"],
            space="ROVER",
        )
        self.assertEqual(
            "HOME", self.space_of(self.created(projects=["inner", "side"], space="HOME"))
        )

    def test_a_project_without_a_home_leaves_the_others_to_choose(self) -> None:
        self.assertEqual("HOME", self.space_of(self.created(projects=["loose", "inner"])))

    def test_projects_without_a_home_need_the_space_named(self) -> None:
        self.refused(
            "[placement] project loose lives in no space of this store: name the space",
            projects=["loose"],
        )
        self.refused(
            "[placement] projects ghost and loose live in no space of this store: name the space",
            projects=["loose", "ghost"],
            meta=self.stand(self.dirs["rover"]),
        )
        self.assertEqual("TEST", self.space_of(self.created(projects=["loose"], space="TEST")))


class ParentPlaceTests(PlacementCase):
    def test_an_item_lies_in_its_parent_s_space(self) -> None:
        goal = self.created(space="ROVER", kind="goal")
        # The parent decides over the projects' home and over the session.
        answer = self.created(
            parent=goal["reference"], projects=["inner"], meta=self.stand(self.dirs["side"])
        )
        self.assertEqual("ROVER", self.space_of(answer))
        self.assertEqual(
            "ROVER", self.space_of(self.created(parent=goal["reference"], space="ROVER"))
        )
        self.refused(
            "[placement] the parent lies in ROVER: an item lies in its parent's space",
            parent=goal["reference"],
            space="HOME",
        )


class SessionPlaceTests(PlacementCase):
    def test_without_space_or_projects_an_item_lies_in_the_session_s_space(self) -> None:
        inside = self.dirs["rover"] / "web"
        inside.mkdir()
        self.assertEqual("ROVER", self.space_of(self.created(meta=self.stand(inside))))
        self.assertEqual("TEST", self.space_of(self.created(space="TEST", meta=self.stand(inside))))

    def test_without_a_place_to_take_the_creation_is_refused(self) -> None:
        unnamed = item_projects.PLACEMENT_UNNAMED
        self.assertEqual("[placement] name the space, or the projects the item changes", unnamed)
        # No session; a session under a project bound to no space; one under no root.
        self.refused(unnamed)
        self.refused(unnamed, meta=self.stand(self.dirs["loose"]))
        self.refused(unnamed, meta=self.stand(self.root / "elsewhere"))
        self.refused(unnamed, meta=self.stand(None))

    def test_an_unproved_session_places_nothing(self) -> None:
        self.stand(self.dirs["rover"])
        claimed = {"session_id": CODEX, "tool_use_id": "toolu_1"}
        self.refused(item_projects.PLACEMENT_UNNAMED, _identity=claimed)

    def test_the_http_write_takes_no_space_and_places_the_same(self) -> None:
        status, made = api.handle_post(
            self.conn, "/api/planning/work-items", {"title": "routed", "projects": ["rover"]}
        ) or (0, {})
        self.assertEqual((200, "ROVER"), (status, self.space_of(made)))
        with self.assertRaises(model.PlanningError) as caught:
            api.handle_post(self.conn, "/api/planning/work-items", {"title": "nowhere"})
        self.assertEqual(item_projects.PLACEMENT_UNNAMED, str(caught.exception))

    def test_the_service_places_by_projects_without_a_session(self) -> None:
        made = service.create_work_item(self.conn, title="direct", projects=["rover"])
        self.assertEqual("ROVER", self.space_of(made))


class SessionSpaceTests(PlacementCase):
    def spaces(self, meta: dict | None) -> object:
        answer = mcp_surface.run_tool_call(self.conn, "list_planning_spaces", {}, meta=meta)
        assert isinstance(answer, dict)
        return answer["session_space"]

    def test_the_list_names_the_space_the_session_s_folder_stands_in(self) -> None:
        self.assertEqual("ROVER", self.spaces(self.stand(self.dirs["rover"])))
        # The longest root decides: `inner` lies inside `umbrella`, both in HOME.
        self.assertEqual("HOME", self.spaces(self.stand(self.dirs["inner"] / "deep")))
        self.assertIsNone(self.spaces(self.stand(self.dirs["loose"])))
        self.assertIsNone(self.spaces(self.stand(self.root / "elsewhere")))
        self.assertIsNone(self.spaces(None))

    def test_a_registry_not_read_names_no_session_space(self) -> None:
        meta = self.stand(self.dirs["rover"])
        self.registry.write_bytes(b"{ not json")
        self.assertIsNone(self.spaces(meta))

    def test_a_key_the_store_has_no_space_for_is_no_session_space(self) -> None:
        scope = str(read_store_metadata(self.conn)["data_scope_id"])
        entry = project_entry("orphan", self.dirs["loose"])
        space = planning_space_entity({"data_scope_id": scope, "space_key": "GONE"})
        entry["planning_binding"] = {**space, "default": True}
        self.registry.write_bytes(registry_bytes([entry]))
        meta = self.stand(self.dirs["loose"])
        self.assertIsNone(self.spaces(meta))
        self.refused(item_projects.PLACEMENT_UNNAMED, meta=meta)
