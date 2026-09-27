"""Public project registration and exact recovery at the inventory boundary."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import cli, store
from server.planning import service as planning_service
from server.platform import scope as platform_scope
from server.platform.contracts import planning_space_entity
from server.projects import project_registry, registry_owner


class RegistryOwnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.project = self.directory / "project"
        self.project.mkdir()
        self.inventory = self.directory / "project-registry.toml"
        self.target = self.directory / "projects.json"
        self.entry = {
            "project_id": "example",
            "display_name": "Example",
            "canonical_root": str(self.project.resolve()),
            "planning_binding": None,
        }

    def test_first_project_then_rollback_restores_absence_exactly(self) -> None:
        self.assertTrue(registry_owner.update(self.inventory, self.target, add=self.entry))
        self.assertEqual([self.entry], json.loads(self.target.read_bytes())["projects"])
        self.assertTrue(registry_owner.check(self.inventory, self.target)["ok"])
        self.assertTrue(registry_owner.rollback(self.inventory, self.target))
        self.assertFalse(self.inventory.exists())
        self.assertFalse(self.target.exists())

    def test_import_preserves_existing_projection_bytes_and_refuses_conflicts(self) -> None:
        source = self.directory / "former.toml"
        source.write_bytes(registry_owner.render_inventory([self.entry]))
        old_bytes = (
            json.dumps({"schema_version": 3, "projects": [self.entry]}, sort_keys=True) + "\n"
        ).encode("utf-8")
        self.target.write_bytes(old_bytes)

        self.assertTrue(registry_owner.update(self.inventory, self.target, source=source))
        self.assertEqual(old_bytes, self.target.read_bytes())
        self.assertTrue(registry_owner.check(self.inventory, self.target)["ok"])
        self.assertFalse(registry_owner.check(self.inventory, self.target)["bytes_match"])

        changed = dict(self.entry, display_name="Different")
        source.write_bytes(registry_owner.render_inventory([changed]))
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "differs"):
            registry_owner.update(self.inventory, self.target, source=source)
        self.assertEqual(old_bytes, self.target.read_bytes())

        self.assertTrue(registry_owner.rollback(self.inventory, self.target))
        self.assertFalse(self.inventory.exists())
        self.assertEqual(old_bytes, self.target.read_bytes())

    def test_apply_after_native_addition_does_not_reimport_former_inventory(self) -> None:
        former = self.directory / "former.toml"
        original = registry_owner.render_inventory([self.entry])
        former.write_bytes(original)
        self.target.write_bytes(registry_owner.render_projection([self.entry]))
        registry_owner.update(self.inventory, self.target, source=former)
        second_root = self.directory / "second"
        second_root.mkdir()
        registry_owner.update(
            self.inventory,
            self.target,
            add={
                "project_id": "second",
                "display_name": "Second",
                "canonical_root": str(second_root),
                "planning_binding": None,
            },
        )
        product_bytes = self.target.read_bytes()
        self.assertFalse(registry_owner.update(self.inventory, self.target))
        self.assertEqual(product_bytes, self.target.read_bytes())
        self.assertEqual(original, former.read_bytes())

    def test_add_refuses_existing_projection_without_inventory(self) -> None:
        original = registry_owner.render_projection([self.entry])
        self.target.write_bytes(original)
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "import it"):
            registry_owner.update(self.inventory, self.target, add=self.entry)
        self.assertEqual(original, self.target.read_bytes())
        self.assertFalse(self.inventory.exists())

    def test_duplicate_json_keys_are_refused_before_any_write(self) -> None:
        original = b'{"schema_version":3,"projects":[],"projects":[]}'
        self.target.write_bytes(original)
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "duplicate key"):
            registry_owner.update(self.inventory, self.target, add=self.entry)
        self.assertEqual(original, self.target.read_bytes())
        self.assertFalse(self.inventory.exists())

    def test_update_and_rollback_restore_both_previous_files_byte_for_byte(self) -> None:
        registry_owner.update(self.inventory, self.target, add=self.entry)
        prior_inventory = self.inventory.read_bytes()
        prior_projection = self.target.read_bytes()
        self.assertTrue(
            registry_owner.update(self.inventory, self.target, edit=("example", "Renamed", None))
        )
        self.assertNotEqual(prior_inventory, self.inventory.read_bytes())
        self.assertNotEqual(prior_projection, self.target.read_bytes())
        self.assertTrue(registry_owner.rollback(self.inventory, self.target))
        self.assertEqual(prior_inventory, self.inventory.read_bytes())
        self.assertEqual(prior_projection, self.target.read_bytes())

    def test_moved_root_can_be_updated_and_last_project_removed(self) -> None:
        registry_owner.update(self.inventory, self.target, add=self.entry)
        self.project.rmdir()
        replacement = self.directory / "replacement"
        replacement.mkdir()
        self.assertTrue(
            registry_owner.update(
                self.inventory,
                self.target,
                edit=("example", None, str(replacement)),
            )
        )
        self.assertEqual(
            str(replacement.resolve()),
            json.loads(self.target.read_bytes())["projects"][0]["canonical_root"],
        )
        replacement.rmdir()
        self.assertTrue(registry_owner.update(self.inventory, self.target, remove="example"))
        self.assertEqual([], json.loads(self.target.read_bytes())["projects"])
        self.assertEqual([], registry_owner.parse_inventory(self.inventory.read_bytes()))
        self.assertTrue(registry_owner.check(self.inventory, self.target)["ok"])

    def test_new_root_must_exist_without_creating_inventory(self) -> None:
        invalid = dict(self.entry, canonical_root=str(self.directory / "missing"))
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "cannot be resolved"):
            registry_owner.update(self.inventory, self.target, add=invalid)
        self.assertFalse(self.inventory.exists())
        self.assertFalse(self.target.exists())

    def test_failed_second_rollback_write_compensates_first_write(self) -> None:
        registry_owner.update(self.inventory, self.target, add=self.entry)
        registry_owner.update(self.inventory, self.target, edit=("example", "Renamed", None))
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

    def test_reparse_lock_and_bad_snapshot_are_rejected_without_mutation(self) -> None:
        lock_path = self.target.with_name(f".{self.target.name}.lock")
        with mock.patch.object(
            registry_owner, "_is_reparse", side_effect=lambda path: path == lock_path
        ):
            with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "regular file"):
                registry_owner.update(self.inventory, self.target, add=self.entry)
        self.assertFalse(self.inventory.exists())
        self.assertFalse(self.target.exists())
        with self.assertRaisesRegex(registry_owner.RegistryOwnerError, "invalid rollback"):
            registry_owner._decode_snapshot(b'{"inventory": [], "projection": null}')

    def test_binding_uses_actual_store_and_project_identity(self) -> None:
        database = self.directory / "valkama.sqlite3"
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(database)}):
            connection = store.connect()
            try:
                planning_service.create_planning_space(
                    connection, project_id="example", name="Example", key="EX"
                )
                connection.commit()
                scope_id = platform_scope.read_store_metadata(connection)["data_scope_id"]
            finally:
                connection.close()
            with mock.patch.object(
                project_registry, "registry_path", return_value=str(self.target)
            ):
                cli.main(
                    ["projects", "add", "example", "--name", "Example", "--root", str(self.project)]
                )
                cli.main(["projects", "bind", "example", "--space", "EX"])
        expected = planning_space_entity({"data_scope_id": scope_id, "space_key": "EX"})
        actual = json.loads(self.target.read_bytes())["projects"][0]["planning_binding"]
        self.assertEqual(expected, actual)


if __name__ == "__main__":
    unittest.main()
