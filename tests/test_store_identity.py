"""Which store this is: its identity row, and the one way past its owner guard."""

import os
import sqlite3
import tempfile
import unittest

from server.store_identity.metadata import (
    FORMER_OWNER_IDS,
    PLATFORM_OWNER_ID,
    ScopeConflictError,
    ScopeError,
    ensure_store_metadata,
    get_or_create_data_scope_id,
    migrate_store_owner,
    read_store_metadata,
    store_owner_migration_needed,
)
from server.store_identity.primitives import ContractError, UnknownFieldError
from server.store_identity.refs import (
    validate_entity_ref,
    validate_operating_scope,
    validate_planning_space_ref,
    validate_project_ref,
    validate_work_item_ref,
)

UUID = "abcdefab-cdef-4abc-8def-abcdefabcdef"
GOLDEN_IDENTITY_VECTORS = {
    "project": {
        "accept": ["a", "project-1", "a" + "b" * 159],
        "reject": ["", "Project", "1project", "project_name", "a" + "b" * 160],
    },
    "uuid": {
        "accept": [
            "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
            "abcdefab-cdef-4abc-8def-abcdefabcdef",
            "6ba7b811-9dad-51d1-80b4-00c04fd430c8",
        ],
        "reject": [
            "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
            "abcdefab-cdef-0abc-8def-abcdefabcdef",
            "abcdefab-cdef-6abc-8def-abcdefabcdef",
            "abcdefab-cdef-4abc-7def-abcdefabcdef",
            "not-a-uuid",
        ],
    },
}


def work_item_ref(scope=UUID, key="MAIN", number=1):
    return {
        "space_ref": {"data_scope_id": scope, "space_key": key},
        "reference": f"{key}-{number}",
    }


class RefContractTests(unittest.TestCase):
    """The exact identity of an entity inside a store, refused when it is not exact."""

    def test_shared_golden_identity_vectors(self):
        for value in GOLDEN_IDENTITY_VECTORS["project"]["accept"]:
            with self.subTest(contract="project", value=value):
                self.assertEqual(value, validate_project_ref({"project_id": value})["project_id"])
        for value in GOLDEN_IDENTITY_VECTORS["project"]["reject"]:
            with self.subTest(contract="project", value=value), self.assertRaises(ContractError):
                validate_project_ref({"project_id": value})
        for value in GOLDEN_IDENTITY_VECTORS["uuid"]["accept"]:
            with self.subTest(contract="uuid", value=value):
                self.assertEqual(
                    value,
                    validate_planning_space_ref({"data_scope_id": value, "space_key": "MAIN"})[
                        "data_scope_id"
                    ],
                )
        for value in GOLDEN_IDENTITY_VECTORS["uuid"]["reject"]:
            with self.subTest(contract="uuid", value=value), self.assertRaises(ContractError):
                validate_planning_space_ref({"data_scope_id": value, "space_key": "MAIN"})

    def test_operating_scope_is_exact_discriminated_wire(self):
        self.assertEqual({"kind": "global"}, validate_operating_scope({"kind": "global"}))
        self.assertEqual(
            {"kind": "project", "project_ref": {"project_id": "project-a"}},
            validate_operating_scope(
                {"kind": "project", "project_ref": {"project_id": "project-a"}}
            ),
        )
        with self.assertRaises(UnknownFieldError):
            validate_operating_scope({"kind": "global", "project_ref": {"project_id": "project-a"}})
        with self.assertRaises(UnknownFieldError):
            validate_operating_scope(
                {"kind": "project", "project_ref": {"project_id": "project-a", "alias": "a"}}
            )

    def test_entity_discriminants_and_ref_shapes_are_strict(self):
        self.assertEqual(
            "work-item",
            validate_entity_ref({"kind": "work-item", "resource_id": "planning-card-1"})["kind"],
        )
        self.assertEqual(
            "service",
            validate_entity_ref({"kind": "service", "owner_id": "owner", "service_id": "memory"})[
                "kind"
            ],
        )
        with self.assertRaises(UnknownFieldError):
            validate_entity_ref(
                {"kind": "work-item", "resource_id": "planning-card-1", "project_id": "project-a"}
            )
        with self.assertRaises(ContractError):
            validate_planning_space_ref({"data_scope_id": UUID.upper(), "space_key": "MAIN"})
        # A key is uppercase, two to eight characters, and carries no
        # separator: the reference splits on the hyphen, so a key holding one
        # would make `QA-1-2` two readings of the same text.
        for space_key in ("main", "M", "MAIN-2", "TOOLONGKEY", "MA IN", " MAIN"):
            with self.subTest(space_key=space_key), self.assertRaises(ContractError):
                validate_planning_space_ref({"data_scope_id": UUID, "space_key": space_key})
        with self.assertRaises(ContractError):
            validate_work_item_ref({"space_ref": work_item_ref()["space_ref"], "reference": "X-0"})
        with self.assertRaises(ContractError):
            # The reference must belong to the space it is paired with.
            validate_work_item_ref(
                {"space_ref": work_item_ref()["space_ref"], "reference": "OTH-1"}
            )


class StoreMetadataTests(unittest.TestCase):
    def test_store_scope_uuid_is_created_once_and_survives_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "store.sqlite3")
            first = sqlite3.connect(path)
            scope_id = get_or_create_data_scope_id(first, owner_id="valkama-owner")
            first.close()
            reopened = sqlite3.connect(path)
            self.assertEqual(scope_id, read_store_metadata(reopened)["data_scope_id"])
            self.assertEqual(
                scope_id,
                get_or_create_data_scope_id(reopened, owner_id="valkama-owner"),
            )
            with self.assertRaises(ScopeConflictError):
                ensure_store_metadata(reopened, owner_id="forged-owner")
            reopened.close()

    def test_store_metadata_requires_explicit_connection_and_owner(self):
        with self.assertRaises(TypeError):
            ensure_store_metadata(None, owner_id="owner")
        conn = sqlite3.connect(":memory:")
        with self.assertRaises(ScopeError):
            ensure_store_metadata(conn, owner_id="")
        conn.close()


class StoreOwnerRenameTests(unittest.TestCase):
    """The one sanctioned way past the immutable owner: this product's own past.

    The guard exists so a second product cannot adopt someone else's store. A
    rename is the case where the same product legitimately arrives under a new
    name, and it has to be spendable exactly once per former name and no wider.
    """

    def open_store(self, owner_id):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        ensure_store_metadata(conn, owner_id=owner_id)
        return conn

    def test_a_store_left_by_a_former_name_is_carried_over(self):
        for former in FORMER_OWNER_IDS:
            with self.subTest(former=former):
                conn = self.open_store(former)
                scope_id = read_store_metadata(conn)["data_scope_id"]

                self.assertTrue(store_owner_migration_needed(conn))
                migrated = migrate_store_owner(conn)

                self.assertEqual(PLATFORM_OWNER_ID, migrated["owner_id"])
                self.assertEqual(
                    scope_id,
                    migrated["data_scope_id"],
                    "every ref and binding points at this id; a rename must not move it",
                )

    def test_the_migration_is_idempotent_and_leaves_a_current_store_alone(self):
        conn = self.open_store(PLATFORM_OWNER_ID)

        self.assertFalse(store_owner_migration_needed(conn))
        self.assertIsNone(migrate_store_owner(conn))
        self.assertEqual(PLATFORM_OWNER_ID, read_store_metadata(conn)["owner_id"])

    def test_a_store_owned_by_anything_else_is_never_claimed(self):
        conn = self.open_store("some-other-product")

        self.assertFalse(store_owner_migration_needed(conn))
        self.assertIsNone(migrate_store_owner(conn))
        self.assertEqual("some-other-product", read_store_metadata(conn)["owner_id"])

    def test_an_uninitialized_store_is_not_a_migration_subject(self):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)

        self.assertFalse(store_owner_migration_needed(conn))

    def test_the_carried_over_store_opens_without_tripping_the_guard(self):
        conn = self.open_store("kanban")
        migrate_store_owner(conn)

        # What `platform_core.initialize` does on the next start.
        self.assertEqual(
            PLATFORM_OWNER_ID,
            ensure_store_metadata(conn, owner_id=PLATFORM_OWNER_ID)["owner_id"],
        )


if __name__ == "__main__":
    unittest.main()
