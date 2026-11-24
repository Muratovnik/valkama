"""Public project registration and exact recovery at the inventory boundary."""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import cli, store
from server.planning import service as planning_service
from server.projects import project_registry, registry_owner, scopes
from server.store_identity import metadata as store_metadata
from server.store_identity.refs import planning_space_entity

SCOPE = "22222222-2222-4222-8222-222222222222"


def _space(key: str, scope: str = SCOPE) -> dict[str, str]:
    return planning_space_entity({"data_scope_id": scope, "space_key": key})


def _former_inventory(entries: list[dict]) -> bytes:
    """An inventory of format 1, spelled as the writer of that format spelled it."""

    lines = ["schema_version = 1"]
    if not entries:
        lines.append("projects = []")
    for entry in sorted(entries, key=lambda item: item["project_id"]):
        lines += [
            "",
            "[[projects]]",
            f"project_id = {json.dumps(entry['project_id'])}",
            f"display_name = {json.dumps(entry['display_name'])}",
            f"canonical_root = {json.dumps(entry['canonical_root'])}",
        ]
        if entry["planning_binding"]:
            lines += [
                "",
                "[projects.planning_binding]",
                'kind = "planning-space"',
                f"resource_id = {json.dumps(entry['planning_binding']['resource_id'])}",
            ]
    return ("\n".join(lines) + "\n").encode("utf-8")


def _former_projection(entries: list[dict]) -> bytes:
    """A projection of format 3: a binding of exactly kind and resource_id."""

    document = {
        "schema_version": 3,
        "projects": sorted(entries, key=lambda item: item["project_id"]),
    }
    return (json.dumps(document, indent=2, sort_keys=True) + "\n").encode("utf-8")


class RegistryOwnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.project = self.directory / "project"
        self.project.mkdir()
        self.inventory = self.directory / "project-registry.toml"
        self.target = self.directory / "projects.json"
        self.primary_db = self.directory / "valkama.sqlite3"
        self.entry = {
            "project_id": "example",
            "display_name": "Example",
            "canonical_root": str(self.project.resolve()),
            "planning_binding": None,
        }

    def _add(self, project_id: str) -> None:
        root = self.directory / project_id
        root.mkdir(exist_ok=True)
        registry_owner.update(
            self.inventory,
            self.target,
            [
                registry_owner.Add(
                    {
                        "project_id": project_id,
                        "display_name": project_id.title(),
                        "canonical_root": str(root),
                        "planning_binding": None,
                    }
                )
            ],
        )

    def _bind(self, project_id: str, key: str, *, default: bool = False) -> bool:
        return registry_owner.update(
            self.inventory, self.target, [registry_owner.Bind(project_id, _space(key), default)]
        )

    def _check(self) -> dict:
        return registry_owner.check(self.inventory, self.target, self.primary_db)

    def _bindings(self) -> dict[str, tuple[str, bool] | None]:
        listing = project_registry.parse_registry(self.target.read_bytes())
        self.assertEqual("available", listing["status"], listing["reason"])
        self.assertEqual(
            listing["projects"], registry_owner.parse_inventory(self.inventory.read_bytes())
        )
        answer: dict[str, tuple[str, bool] | None] = {}
        for entry in listing["projects"]:
            binding = entry["planning_binding"]
            answer[entry["project_id"]] = (
                None
                if binding is None
                else (registry_owner._space_key(binding["resource_id"]), binding["default"])
            )
        return answer

    def _state(self) -> dict[str, bytes | None]:
        paths = (
            self.inventory,
            self.target,
            registry_owner.rollback_path(self.target),
            registry_owner.upgrade_path(self.target),
        )
        return {path.name: registry_owner._read(path) for path in paths}

    def _former(self, entries: list[dict]) -> tuple[bytes, bytes]:
        inventory = _former_inventory(entries)
        projection = _former_projection(entries)
        self.inventory.write_bytes(inventory)
        self.target.write_bytes(projection)
        return inventory, projection

    # Format 4: the writer's rules, the same as the reader's.

    def test_first_project_then_rollback_restores_absence_exactly(self) -> None:
        self.assertTrue(
            registry_owner.update(self.inventory, self.target, [registry_owner.Add(self.entry)])
        )
        written = json.loads(self.target.read_bytes())
        self.assertEqual(4, written["schema_version"])
        self.assertEqual([self.entry], written["projects"])
        self.assertTrue(self.inventory.read_bytes().startswith(b"schema_version = 2\n"))
        self.assertTrue(self._check()["ok"])
        self.assertTrue(registry_owner.rollback(self.inventory, self.target))
        self.assertFalse(self.inventory.exists())
        self.assertFalse(self.target.exists())

    def test_first_project_on_a_machine_with_no_registry_downgrades_to_no_registry(self) -> None:
        self.assertTrue(
            registry_owner.update(self.inventory, self.target, [registry_owner.Add(self.entry)])
        )
        kept = json.loads(registry_owner.upgrade_path(self.target).read_bytes())
        self.assertEqual(
            {"inventory": None, "projection": None, "rollback": None},
            {name: kept[name] for name in ("inventory", "projection", "rollback")},
        )
        self.assertTrue(registry_owner.downgrade(self.inventory, self.target))
        self.assertEqual(dict.fromkeys(self._state()), self._state())

    def test_one_space_holds_several_projects_with_exactly_one_default(self) -> None:
        entries = []
        for project_id, default in (("alpha", True), ("alpha-tool", False)):
            entries.append(
                dict(
                    self.entry,
                    project_id=project_id,
                    canonical_root=str(self.directory / project_id),
                    planning_binding={**_space("ALPHA"), "default": default},
                )
            )
        rendered = registry_owner.render_inventory(entries)
        self.assertIn(b"default = true", rendered)
        self.assertIn(b"default = false", rendered)
        self.assertEqual(entries, registry_owner.parse_inventory(rendered))
        projection = registry_owner.render_projection(entries)
        self.assertEqual(entries, project_registry.parse_registry(projection)["projects"])
        for defaults in ((True, True), (False, False)):
            wrong = [
                dict(entry, planning_binding=dict(entry["planning_binding"], default=default))
                for entry, default in zip(entries, defaults, strict=True)
            ]
            with self.subTest(defaults=defaults):
                with self.assertRaisesRegex(
                    registry_owner.RegistryOwnerError,
                    "planning space ALPHA must have exactly one default project",
                ):
                    registry_owner.render_inventory(wrong)

    def test_the_writer_refuses_a_binding_without_its_default(self) -> None:
        for binding, message in (
            (_space("EX"), "kind, resource_id and default"),
            ({**_space("EX"), "default": "yes"}, "default must be true or false"),
        ):
            with self.subTest(binding=binding):
                with self.assertRaisesRegex(registry_owner.RegistryOwnerError, message):
                    registry_owner.render_projection([dict(self.entry, planning_binding=binding)])

    def test_an_inventory_of_format_1_is_refused_naming_upgrade(self) -> None:
        self._former([self.entry])
        for call in (
            lambda: self._check(),
            lambda: registry_owner.update(
                self.inventory, self.target, [registry_owner.Remove("example")]
            ),
        ):
            with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "projects upgrade"):
                call()

    def test_duplicate_json_keys_are_refused_before_any_write(self) -> None:
        original = b'{"schema_version":4,"projects":[],"projects":[]}'
        self.target.write_bytes(original)
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "duplicate key"):
            registry_owner.update(self.inventory, self.target, [registry_owner.Add(self.entry)])
        self.assertEqual(original, self.target.read_bytes())
        self.assertFalse(self.inventory.exists())

    # Binding.

    def test_the_first_project_of_a_space_becomes_its_default(self) -> None:
        for project_id in ("alpha", "beta", "gamma"):
            self._add(project_id)
        self.assertTrue(self._bind("alpha", "ALPHA"))
        self.assertTrue(self._bind("beta", "ALPHA"))
        self.assertTrue(self._bind("gamma", "ROVER"))
        self.assertEqual(
            {"alpha": ("ALPHA", True), "beta": ("ALPHA", False), "gamma": ("ROVER", True)},
            self._bindings(),
        )
        self.assertFalse(self._bind("beta", "ALPHA"))

    def test_default_moves_in_one_write_that_rollback_undoes_whole(self) -> None:
        for project_id in ("alpha", "beta"):
            self._add(project_id)
            self._bind(project_id, "ALPHA")
        before = self._state()
        self.assertTrue(self._bind("beta", "ALPHA", default=True))
        self.assertEqual({"alpha": ("ALPHA", False), "beta": ("ALPHA", True)}, self._bindings())
        self.assertTrue(registry_owner.rollback(self.inventory, self.target))
        after = self._state()
        for name in (self.inventory.name, self.target.name):
            self.assertEqual(before[name], after[name])

    def test_the_default_project_does_not_leave_a_space_that_keeps_projects(self) -> None:
        for project_id in ("alpha", "beta", "gamma"):
            self._add(project_id)
            self._bind(project_id, "ALPHA")
        before = self._state()
        expected = "valkama projects bind beta --space ALPHA --default"
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, expected):
            self._bind("alpha", "ROVER")
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, expected):
            registry_owner.update(self.inventory, self.target, [registry_owner.Remove("alpha")])
        self.assertEqual(before, self._state())

        # A project that is not the default changes its home space freely.
        self.assertTrue(self._bind("gamma", "ROVER"))
        self.assertEqual(
            {"alpha": ("ALPHA", True), "beta": ("ALPHA", False), "gamma": ("ROVER", True)},
            self._bindings(),
        )
        # Once another project is the default, the former one may go.
        self._bind("beta", "ALPHA", default=True)
        self.assertTrue(self._bind("alpha", "ROVER"))
        self.assertEqual(
            {"alpha": ("ROVER", False), "beta": ("ALPHA", True), "gamma": ("ROVER", True)},
            self._bindings(),
        )

    def test_the_last_project_leaves_its_space_without_refusal(self) -> None:
        self._add("alpha")
        self._bind("alpha", "ALPHA")
        self.assertTrue(self._bind("alpha", "ROVER"))
        self.assertEqual({"alpha": ("ROVER", True)}, self._bindings())

    # Several changes: one write, one snapshot, refused whole.

    def _update(self, *changes: registry_owner.Change) -> bool:
        return registry_owner.update(self.inventory, self.target, list(changes))

    def test_several_changes_are_one_write_that_rollback_undoes_whole(self) -> None:
        for project_id in ("alpha", "beta", "gamma"):
            self._add(project_id)
        self._bind("alpha", "MAIN")
        before = self._state()
        self.assertTrue(
            self._update(
                registry_owner.Bind("beta", _space("MAIN"), True),
                registry_owner.Bind("gamma", _space("MAIN")),
                registry_owner.Unbind("alpha", _space("MAIN")["resource_id"]),
            )
        )
        self.assertEqual(
            {"alpha": None, "beta": ("MAIN", True), "gamma": ("MAIN", False)}, self._bindings()
        )
        self.assertTrue(registry_owner.rollback(self.inventory, self.target))
        after = self._state()
        for name in (self.inventory.name, self.target.name):
            self.assertEqual(before[name], after[name])

    def test_a_refused_change_among_several_writes_none_of_them(self) -> None:
        for project_id in ("alpha", "beta"):
            self._add(project_id)
        before = self._state()
        with self.assertRaises(registry_owner.RegistryOwnerError) as refused:
            self._update(
                registry_owner.Bind("alpha", _space("MAIN")),
                registry_owner.Bind("nobody", _space("MAIN")),
            )
        self.assertEqual("not_registered", refused.exception.code)
        self.assertEqual(before, self._state())

    def test_unbind_keeps_the_registration_and_the_default_rule(self) -> None:
        for project_id in ("alpha", "beta"):
            self._add(project_id)
            self._bind(project_id, "MAIN")
        main = _space("MAIN")["resource_id"]
        before = self._state()
        with self.assertRaises(registry_owner.RegistryOwnerError) as refused:
            self._update(registry_owner.Unbind("alpha", main))
        self.assertEqual("default_leaving", refused.exception.code)
        self.assertEqual(before, self._state())

        self.assertTrue(self._update(registry_owner.Unbind("beta", main)))
        self.assertEqual({"alpha": ("MAIN", True), "beta": None}, self._bindings())
        # The last project leaves its space freely, and stays registered.
        self.assertTrue(self._update(registry_owner.Unbind("alpha", main)))
        self.assertEqual({"alpha": None, "beta": None}, self._bindings())

    def test_unbind_refuses_a_project_another_writer_moved_meanwhile(self) -> None:
        self._add("alpha")
        self._bind("alpha", "ALPHA")
        before = self._state()
        with self.assertRaises(registry_owner.RegistryOwnerError) as refused:
            self._update(registry_owner.Unbind("alpha", _space("MAIN")["resource_id"]))
        self.assertEqual("not_bound", refused.exception.code)
        self.assertEqual(before, self._state())

    def test_rekey_carries_every_binding_with_its_default(self) -> None:
        for project_id in ("alpha", "beta", "gamma"):
            self._add(project_id)
        self._bind("alpha", "MAIN")
        self._bind("beta", "MAIN")
        self._bind("gamma", "BETA")
        self.assertTrue(
            self._update(
                registry_owner.Rekey(_space("MAIN")["resource_id"], _space("ALPHA")["resource_id"])
            )
        )
        self.assertEqual(
            {"alpha": ("ALPHA", True), "beta": ("ALPHA", False), "gamma": ("BETA", True)},
            self._bindings(),
        )

    def test_preview_refuses_as_update_would_and_writes_nothing(self) -> None:
        self._add("alpha")
        before = self._state()
        projects = registry_owner.preview(
            self.inventory, self.target, [registry_owner.Bind("alpha", _space("MAIN"))]
        )
        self.assertEqual(
            _space("MAIN")["resource_id"], projects[0]["planning_binding"]["resource_id"]
        )
        taken = dict(self.entry, project_id="other", canonical_root=str(self.directory / "alpha"))
        with self.assertRaises(registry_owner.RegistryOwnerError) as refused:
            registry_owner.preview(self.inventory, self.target, [registry_owner.Add(taken)])
        self.assertEqual("root_taken", refused.exception.code)
        missing = dict(self.entry, canonical_root=str(self.directory / "gone"))
        with self.assertRaises(registry_owner.RegistryOwnerError) as refused:
            registry_owner.preview(self.inventory, self.target, [registry_owner.Add(missing)])
        self.assertEqual("root_missing", refused.exception.code)
        self.assertEqual(before, self._state())

    def test_a_held_lock_is_refused_as_busy(self) -> None:
        self._add("alpha")
        before = self._state()
        with registry_owner._lock(self.target):
            with self.assertRaises(registry_owner.RegistryOwnerError) as refused:
                self._bind("alpha", "MAIN")
        self.assertEqual("busy", refused.exception.code)
        self.assertEqual(before, self._state())

    def test_cli_unbind_takes_the_project_out_and_keeps_it_registered(self) -> None:
        self._add("alpha")
        self._bind("alpha", "MAIN")

        def unbind(project_id: str) -> dict:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                cli.main(["projects", "unbind", project_id])
            return json.loads(output.getvalue())

        with mock.patch.object(project_registry, "registry_path", return_value=str(self.target)):
            self.assertEqual({"changed": True, "planning_binding": None}, unbind("alpha"))
            self.assertEqual({"changed": False, "planning_binding": None}, unbind("alpha"))
            with self.assertRaisesRegex(SystemExit, "not registered: nobody"):
                unbind("nobody")
        self.assertEqual({"alpha": None}, self._bindings())

    def test_list_on_a_clean_profile_is_empty_and_writes_nothing(self) -> None:
        profile = self.directory / "clean-profile"
        profile.mkdir()

        def listed() -> dict:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                cli.main(["projects", "list"])
            return json.loads(output.getvalue())

        with mock.patch.dict(os.environ, {"LOCALAPPDATA": str(profile)}):
            self.assertEqual({"projects": []}, listed())
            self.assertEqual([], list(profile.iterdir()))
            with contextlib.redirect_stdout(io.StringIO()):
                cli.main(
                    ["projects", "add", "example", "--name", "Example", "--root", str(self.project)]
                )
            self.assertEqual({"projects": [self.entry]}, listed())

    def test_binding_uses_actual_store_and_project_identity(self) -> None:
        database = self.directory / "valkama.sqlite3"
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(database)}):
            connection = store.connect()
            try:
                planning_service.create_planning_space(connection, name="Example", key="EX")
                connection.commit()
                scope_id = store_metadata.read_store_metadata(connection)["data_scope_id"]
            finally:
                connection.close()
            other = self.directory / "other"
            other.mkdir()
            with mock.patch.object(
                project_registry, "registry_path", return_value=str(self.target)
            ):
                cli.main(
                    ["projects", "add", "example", "--name", "Example", "--root", str(self.project)]
                )
                cli.main(["projects", "add", "other", "--name", "Other", "--root", str(other)])
                cli.main(["projects", "bind", "example", "--space", "EX"])
                # The space's own project id is not consulted: any project may join it.
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    cli.main(["projects", "bind", "other", "--space", "EX", "--default"])
        expected = planning_space_entity({"data_scope_id": scope_id, "space_key": "EX"})
        projects = json.loads(self.target.read_bytes())["projects"]
        self.assertEqual({**expected, "default": False}, projects[0]["planning_binding"])
        self.assertEqual({**expected, "default": True}, projects[1]["planning_binding"])
        self.assertEqual(
            {"changed": True, "planning_binding": {**expected, "default": True}},
            json.loads(output.getvalue()),
        )

    def test_binding_reads_only_the_space_identity_of_a_store_before_migration(self) -> None:
        # A store as an earlier release left it: none of the columns this release
        # adds, and a project id on the space that names some other project.
        database = self.directory / "former.sqlite3"
        with contextlib.closing(sqlite3.connect(database)) as conn:
            conn.executescript(
                "CREATE TABLE planning_spaces (planning_space_id TEXT, project_id TEXT,"
                " name TEXT, key TEXT);"
                "INSERT INTO planning_spaces VALUES ('s1', 'someone-else', 'Agents', 'ALPHA');"
                "CREATE TABLE platform_store_metadata (singleton INTEGER, data_scope_id TEXT,"
                " owner_id TEXT, is_primary INTEGER, is_writable INTEGER, created_at TEXT);"
                f"INSERT INTO platform_store_metadata VALUES (1, '{SCOPE}', 'owner', 1, 1, 'now');"
            )
        before = database.read_bytes()
        with (
            mock.patch.dict(os.environ, {"VALKAMA_DB": str(database)}),
            mock.patch.object(project_registry, "registry_path", return_value=str(self.target)),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            cli.main(
                ["projects", "add", "example", "--name", "Example", "--root", str(self.project)]
            )
            cli.main(["projects", "bind", "example", "--space", "ALPHA"])
            with self.assertRaisesRegex(SystemExit, "no planning space named NONE"):
                cli.main(["projects", "bind", "example", "--space", "NONE"])
        self.assertEqual({"example": ("ALPHA", True)}, self._bindings())
        self.assertEqual(before, database.read_bytes())

    def test_check_names_a_binding_to_a_store_that_is_neither_main_nor_attached(self) -> None:
        work = self.directory / "work.sqlite3"
        scope_of: dict[str, str] = {}
        for database in (self.primary_db, work):
            with mock.patch.dict(os.environ, {"VALKAMA_DB": str(database)}):
                connection = store.connect()
                try:
                    scope_of[database.name] = store_metadata.read_store_metadata(connection)[
                        "data_scope_id"
                    ]
                finally:
                    connection.close()
        scopes.attach(str(self.primary_db), "work", str(work))
        scopes.attach(str(self.primary_db), "lost", str(self.directory / "lost.sqlite3"))
        stray = "9b1c3f0e-6d2a-4e8b-8f57-2c4a1d0e7b93"
        bound = {
            "example": (scope_of[self.primary_db.name], "EX"),
            "worker": (scope_of[work.name], "WK"),
            "stray": (stray, "ZZ"),
        }
        for project_id, (scope, key) in bound.items():
            self._add(project_id)
            registry_owner.update(
                self.inventory,
                self.target,
                [
                    registry_owner.Bind(
                        project_id,
                        planning_space_entity({"data_scope_id": scope, "space_key": key}),
                        True,
                    )
                ],
            )

        check = self._check()

        self.assertTrue(check["ok"])
        self.assertEqual(
            [{"project_id": "stray", "space_key": "ZZ", "data_scope_id": stray}],
            check["foreign_bindings"],
        )
        self.assertEqual(1, check["unreadable_stores"])

    # Upgrade, downgrade and rollback across the change of format.

    def test_upgrade_carries_format_3_to_4_once_and_downgrade_returns_its_bytes(self) -> None:
        second = dict(
            self.entry,
            project_id="second",
            canonical_root=str(self.directory / "second"),
            planning_binding=_space("EX"),
        )
        inventory, projection = self._former([self.entry, second])
        self.assertTrue(registry_owner.upgrade(self.inventory, self.target))
        self.assertEqual({"example": None, "second": ("EX", True)}, self._bindings())
        self.assertEqual(
            {
                "bytes_match": True,
                # No store holds the scope this binding names: none was written here.
                "foreign_bindings": [
                    {
                        "project_id": "second",
                        "space_key": "EX",
                        "data_scope_id": SCOPE,
                    }
                ],
                "ok": True,
                "planning_bindings": 1,
                "projects": 2,
                "unreadable_stores": 1,
            },
            self._check(),
        )
        snapshot = registry_owner.upgrade_path(self.target)
        kept = json.loads(snapshot.read_bytes())
        self.assertEqual(hashlib.sha256(inventory).hexdigest(), kept["inventory_sha256"])
        self.assertEqual(hashlib.sha256(projection).hexdigest(), kept["projection_sha256"])

        upgraded = self._state()
        self.assertFalse(registry_owner.upgrade(self.inventory, self.target))
        self.assertEqual(upgraded, self._state())

        self._add("third")
        self._bind("third", "EX")
        self.assertTrue(registry_owner.downgrade(self.inventory, self.target))
        self.assertEqual(inventory, self.inventory.read_bytes())
        self.assertEqual(projection, self.target.read_bytes())
        self.assertFalse(snapshot.exists())
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "snapshot is missing"):
            registry_owner.downgrade(self.inventory, self.target)

    def test_upgrade_refuses_a_second_snapshot_and_a_split_registry(self) -> None:
        inventory, _projection = self._former([self.entry])
        snapshot = registry_owner.upgrade_path(self.target)
        snapshot.write_bytes(b"kept")
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "already exists"):
            registry_owner.upgrade(self.inventory, self.target)
        self.assertEqual(b"kept", snapshot.read_bytes())
        snapshot.unlink()
        self.target.write_bytes(_former_projection([dict(self.entry, display_name="Other")]))
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "differ"):
            registry_owner.upgrade(self.inventory, self.target)
        self.assertEqual(inventory, self.inventory.read_bytes())
        self.assertFalse(snapshot.exists())

    def test_upgrade_of_a_machine_with_no_registry_writes_the_empty_one(self) -> None:
        self.assertTrue(registry_owner.upgrade(self.inventory, self.target))
        self.assertTrue(self.inventory.read_bytes().startswith(b"schema_version = 2\n"))
        projection = json.loads(self.target.read_bytes())
        self.assertEqual((4, []), (projection["schema_version"], projection["projects"]))
        kept = json.loads(registry_owner.upgrade_path(self.target).read_bytes())
        self.assertEqual(
            {"inventory": None, "projection": None, "rollback": None},
            {name: kept[name] for name in ("inventory", "projection", "rollback")},
        )

        upgraded = self._state()
        self.assertFalse(registry_owner.upgrade(self.inventory, self.target))
        self.assertEqual(upgraded, self._state())

        self.assertTrue(registry_owner.downgrade(self.inventory, self.target))
        self.assertEqual(dict.fromkeys(self._state()), self._state())

    def test_a_projection_without_an_inventory_still_refuses_in_either_format(self) -> None:
        for projection in (_former_projection([]), registry_owner.render_projection([])):
            self.target.write_bytes(projection)
            with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "inventory is missing"):
                registry_owner.upgrade(self.inventory, self.target)
            self.assertEqual(projection, self.target.read_bytes())
            self.assertFalse(self.inventory.exists())
            self.assertFalse(registry_owner.upgrade_path(self.target).exists())

    def test_downgrade_refuses_a_snapshot_whose_hash_does_not_match(self) -> None:
        self._former([self.entry])
        registry_owner.upgrade(self.inventory, self.target)
        snapshot = registry_owner.upgrade_path(self.target)
        kept = json.loads(snapshot.read_bytes())
        kept["inventory_sha256"] = "0" * 64
        snapshot.write_bytes(json.dumps(kept).encode("ascii"))
        before = self._state()
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "SHA-256"):
            registry_owner.downgrade(self.inventory, self.target)
        self.assertEqual(before, self._state())

    def _upgrade_write_and_downgrade(self, former_rollback: bytes | None) -> dict:
        """Upgrade a former registry, write once in the new format, then downgrade."""

        self._former([self.entry])
        if former_rollback is not None:
            registry_owner.rollback_path(self.target).write_bytes(former_rollback)
        before = self._state()
        registry_owner.upgrade(self.inventory, self.target)
        self._bind("example", "EX")
        self.assertTrue(registry_owner.downgrade(self.inventory, self.target))
        return before

    def test_downgrade_returns_the_one_write_snapshot_the_upgrade_found(self) -> None:
        # What the former release's last write left for its own rollback.
        former_rollback = registry_owner._snapshot(_former_inventory([]), _former_projection([]))
        before = self._upgrade_write_and_downgrade(former_rollback)
        digests = {name: registry_owner._digest(raw) for name, raw in self._state().items()}
        self.assertEqual(
            {name: registry_owner._digest(raw) for name, raw in before.items()}, digests
        )
        self.assertIsNone(digests[registry_owner.upgrade_path(self.target).name])

    def test_downgrade_removes_a_one_write_snapshot_the_upgrade_did_not_find(self) -> None:
        before = self._upgrade_write_and_downgrade(None)
        self.assertEqual(before, self._state())
        self.assertFalse(registry_owner.rollback_path(self.target).exists())

    def test_downgrade_refuses_a_rollback_whose_hash_does_not_match(self) -> None:
        self._former([self.entry])
        registry_owner.rollback_path(self.target).write_bytes(
            registry_owner._snapshot(_former_inventory([]), _former_projection([]))
        )
        registry_owner.upgrade(self.inventory, self.target)
        self._bind("example", "EX")
        snapshot = registry_owner.upgrade_path(self.target)
        kept = json.loads(snapshot.read_bytes())
        kept["rollback_sha256"] = "0" * 64
        snapshot.write_bytes(json.dumps(kept).encode("ascii"))
        before = self._state()
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "SHA-256"):
            registry_owner.downgrade(self.inventory, self.target)
        self.assertEqual(before, self._state())

    def test_rollback_undoes_one_write_and_never_crosses_the_upgrade(self) -> None:
        self._former([self.entry])
        # The snapshot of the last write before the upgrade, in the former format.
        registry_owner.rollback_path(self.target).write_bytes(
            registry_owner._snapshot(_former_inventory([]), _former_projection([]))
        )
        registry_owner.upgrade(self.inventory, self.target)
        upgraded = self._state()
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "projects downgrade"):
            registry_owner.rollback(self.inventory, self.target)
        self.assertEqual(upgraded, self._state())

        self._bind("example", "EX")
        self.assertTrue(registry_owner.rollback(self.inventory, self.target))
        self.assertEqual(upgraded[self.inventory.name], self.inventory.read_bytes())
        self.assertEqual(upgraded[self.target.name], self.target.read_bytes())

        registry_owner.rollback_path(self.target).unlink()
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "projects downgrade"):
            registry_owner.rollback(self.inventory, self.target)

    # Import of a former writer's inventory.

    def test_import_of_format_1_writes_inventory_2_and_projection_4_once(self) -> None:
        source = self.directory / "former.toml"
        bound = dict(self.entry, planning_binding=_space("EX"))
        original = _former_inventory([bound])
        source.write_bytes(original)
        self.assertTrue(registry_owner.import_inventory(self.inventory, self.target, source))
        self.assertTrue(self.inventory.read_bytes().startswith(b"schema_version = 2\n"))
        self.assertEqual(4, json.loads(self.target.read_bytes())["schema_version"])
        self.assertEqual({"example": ("EX", True)}, self._bindings())
        self.assertTrue(self._check()["bytes_match"])

        imported = self._state()
        self.assertFalse(registry_owner.import_inventory(self.inventory, self.target, source))
        self.assertEqual(imported, self._state())
        self.assertEqual(original, source.read_bytes())

        source.write_bytes(_former_inventory([dict(bound, display_name="Different")]))
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "differs"):
            registry_owner.import_inventory(self.inventory, self.target, source)
        self.assertEqual(imported, self._state())

    def test_fresh_import_and_later_writes_downgrade_to_no_registry(self) -> None:
        source = self.directory / "former.toml"
        source.write_bytes(_former_inventory([self.entry]))
        self.assertTrue(registry_owner.import_inventory(self.inventory, self.target, source))
        self._bind("example", "EX")
        self._add("second")
        self.assertTrue(registry_owner.downgrade(self.inventory, self.target))
        self.assertEqual(dict.fromkeys(self._state()), self._state())

    def test_rollback_right_after_a_fresh_import_leaves_no_registry(self) -> None:
        source = self.directory / "former.toml"
        source.write_bytes(_former_inventory([self.entry]))
        registry_owner.import_inventory(self.inventory, self.target, source)
        imported = (self.inventory.read_bytes(), self.target.read_bytes())
        self.assertTrue(registry_owner.rollback(self.inventory, self.target))
        self.assertFalse(self.inventory.exists())
        self.assertFalse(self.target.exists())
        # The registry can be taken in again after that.
        self.assertTrue(registry_owner.import_inventory(self.inventory, self.target, source))
        self.assertEqual(imported, (self.inventory.read_bytes(), self.target.read_bytes()))

    def test_import_into_the_empty_registry_upgrade_wrote_takes_its_projects(self) -> None:
        registry_owner.upgrade(self.inventory, self.target)
        source = self.directory / "former.toml"
        source.write_bytes(_former_inventory([dict(self.entry, planning_binding=_space("EX"))]))
        self.assertTrue(registry_owner.import_inventory(self.inventory, self.target, source))
        self.assertEqual({"example": ("EX", True)}, self._bindings())
        self.assertTrue(self._check()["bytes_match"])
        self.assertTrue(registry_owner.downgrade(self.inventory, self.target))
        self.assertEqual(dict.fromkeys(self._state()), self._state())

    def test_import_still_refuses_a_registry_holding_a_project_that_differs(self) -> None:
        registry_owner.upgrade(self.inventory, self.target)
        self._add("second")
        source = self.directory / "former.toml"
        source.write_bytes(_former_inventory([self.entry]))
        before = self._state()
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "differs"):
            registry_owner.import_inventory(self.inventory, self.target, source)
        self.assertEqual(before, self._state())

    def test_import_beside_a_former_projection_carries_it_across_for_downgrade(self) -> None:
        source = self.directory / "former.toml"
        source.write_bytes(_former_inventory([self.entry]))
        projection = _former_projection([self.entry])
        self.target.write_bytes(projection)
        self.assertTrue(registry_owner.import_inventory(self.inventory, self.target, source))
        self.assertEqual({"example": None}, self._bindings())
        self.assertTrue(registry_owner.upgrade_path(self.target).exists())
        self.assertTrue(registry_owner.downgrade(self.inventory, self.target))
        self.assertFalse(self.inventory.exists())
        self.assertEqual(projection, self.target.read_bytes())

    def test_import_refuses_a_source_that_is_not_format_1(self) -> None:
        source = self.directory / "former.toml"
        source.write_bytes(registry_owner.render_inventory([self.entry]))
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "source inventory"):
            registry_owner.import_inventory(self.inventory, self.target, source)
        self.assertFalse(self.inventory.exists())
        self.assertFalse(self.target.exists())

    def test_apply_after_native_addition_does_not_reimport_former_inventory(self) -> None:
        former = self.directory / "former.toml"
        original = _former_inventory([self.entry])
        former.write_bytes(original)
        registry_owner.import_inventory(self.inventory, self.target, former)
        self._add("second")
        product_bytes = self.target.read_bytes()
        self.assertFalse(registry_owner.update(self.inventory, self.target))
        self.assertEqual(product_bytes, self.target.read_bytes())
        self.assertEqual(original, former.read_bytes())

    # The rest of the single writer.

    def test_add_refuses_existing_projection_without_inventory(self) -> None:
        original = registry_owner.render_projection([self.entry])
        self.target.write_bytes(original)
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "import it"):
            registry_owner.update(self.inventory, self.target, [registry_owner.Add(self.entry)])
        self.assertEqual(original, self.target.read_bytes())
        self.assertFalse(self.inventory.exists())

    def test_update_and_rollback_restore_both_previous_files_byte_for_byte(self) -> None:
        registry_owner.update(self.inventory, self.target, [registry_owner.Add(self.entry)])
        prior_inventory = self.inventory.read_bytes()
        prior_projection = self.target.read_bytes()
        self.assertTrue(
            registry_owner.update(
                self.inventory, self.target, [registry_owner.Edit("example", "Renamed", None)]
            )
        )
        self.assertNotEqual(prior_inventory, self.inventory.read_bytes())
        self.assertNotEqual(prior_projection, self.target.read_bytes())
        self.assertTrue(registry_owner.rollback(self.inventory, self.target))
        self.assertEqual(prior_inventory, self.inventory.read_bytes())
        self.assertEqual(prior_projection, self.target.read_bytes())

    def test_moved_root_can_be_updated_and_last_project_removed(self) -> None:
        registry_owner.update(self.inventory, self.target, [registry_owner.Add(self.entry)])
        self.project.rmdir()
        replacement = self.directory / "replacement"
        replacement.mkdir()
        self.assertTrue(
            registry_owner.update(
                self.inventory,
                self.target,
                [registry_owner.Edit("example", None, str(replacement))],
            )
        )
        self.assertEqual(
            str(replacement.resolve()),
            json.loads(self.target.read_bytes())["projects"][0]["canonical_root"],
        )
        replacement.rmdir()
        self.assertTrue(
            registry_owner.update(self.inventory, self.target, [registry_owner.Remove("example")])
        )
        self.assertEqual([], json.loads(self.target.read_bytes())["projects"])
        self.assertEqual([], registry_owner.parse_inventory(self.inventory.read_bytes()))
        self.assertTrue(self._check()["ok"])

    def test_new_root_must_exist_without_creating_inventory(self) -> None:
        invalid = dict(self.entry, canonical_root=str(self.directory / "missing"))
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "cannot be resolved"):
            registry_owner.update(self.inventory, self.target, [registry_owner.Add(invalid)])
        self.assertFalse(self.inventory.exists())
        self.assertFalse(self.target.exists())

    def test_failed_second_rollback_write_compensates_first_write(self) -> None:
        registry_owner.update(self.inventory, self.target, [registry_owner.Add(self.entry)])
        registry_owner.update(
            self.inventory, self.target, [registry_owner.Edit("example", "Renamed", None)]
        )
        before_inventory = self.inventory.read_bytes()
        before_target = self.target.read_bytes()
        original_replace = registry_owner._replace
        failures = 0

        def fail_target_once(path: Path, expected: bytes | None, replacement: bytes | None) -> bool:
            nonlocal failures
            if path == self.target and failures == 0:
                failures += 1
                raise OSError("injected target failure")
            return original_replace(path, expected, replacement)

        with mock.patch.object(registry_owner, "_replace", side_effect=fail_target_once):
            with self.assertRaisesRegex(OSError, "injected"):
                registry_owner.rollback(self.inventory, self.target)
        self.assertEqual(before_inventory, self.inventory.read_bytes())
        self.assertEqual(before_target, self.target.read_bytes())

    def test_failed_upgrade_write_leaves_no_snapshot_and_the_former_bytes(self) -> None:
        before = self._former([self.entry])
        original_replace = registry_owner._replace

        def fail_target(path: Path, expected: bytes | None, replacement: bytes | None) -> bool:
            if path == self.target and replacement != before[1]:
                raise OSError("injected target failure")
            return original_replace(path, expected, replacement)

        with mock.patch.object(registry_owner, "_replace", side_effect=fail_target):
            with self.assertRaisesRegex(OSError, "injected"):
                registry_owner.upgrade(self.inventory, self.target)
        self.assertEqual(before, (self.inventory.read_bytes(), self.target.read_bytes()))
        self.assertFalse(registry_owner.upgrade_path(self.target).exists())

    def test_reparse_lock_and_bad_snapshot_are_rejected_without_mutation(self) -> None:
        lock_path = self.target.with_name(f".{self.target.name}.lock")
        with mock.patch.object(
            registry_owner, "_is_reparse", side_effect=lambda path: path == lock_path
        ):
            with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "regular file"):
                registry_owner.update(self.inventory, self.target, [registry_owner.Add(self.entry)])
        self.assertFalse(self.inventory.exists())
        self.assertFalse(self.target.exists())
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "invalid rollback"):
            registry_owner._decode_snapshot(b'{"inventory": [], "projection": null}')


if __name__ == "__main__":
    unittest.main()
