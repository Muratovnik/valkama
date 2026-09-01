import os
import sqlite3
import tempfile
import unittest

from server.platform.contracts import (
    ContractError,
    planning_space_entity,
    planning_work_item_entity,
)
from server.platform.scope import (
    FORMER_OWNER_IDS,
    PLATFORM_OWNER_ID,
    BindingConflictError,
    ProjectResourceBindingReader,
    ScopeConflictError,
    ScopeError,
    ensure_store_metadata,
    get_or_create_data_scope_id,
    migrate_store_owner,
    read_store_metadata,
    store_owner_migration_needed,
)

UUID = "abcdefab-cdef-4abc-8def-abcdefabcdef"
UUID_2 = "fedcbafe-dcba-4fed-8cba-fedcbafedcba"
HASH_A = "a" * 64
HASH_B = "b" * 64


def space(scope=UUID, key="MAIN"):
    return planning_space_entity({"data_scope_id": scope, "space_key": key})


def binding(
    project="project-a",
    scope=UUID,
    key="MAIN",
    revision=1,
    source_hash=HASH_A,
    owner="workspace",
):
    return {
        "project_id": project,
        "resource_ref": space(scope, key),
        "registry_revision": revision,
        "source_owner": owner,
        "source_hash": source_hash,
    }


def projection(
    *bindings,
    project="project-a",
    revision=1,
    source_hash=HASH_A,
    owner="workspace",
    empty=False,
):
    if bindings and empty:
        raise ValueError("empty projection cannot also contain bindings")
    records = (
        []
        if empty
        else list(bindings)
        or [
            binding(
                project=project,
                revision=revision,
                source_hash=source_hash,
                owner=owner,
            )
        ]
    )
    return {
        "interface_version": "project-resource-binding",
        "project_id": project,
        "source_hash": source_hash,
        "bindings": records,
    }


class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.reader = ProjectResourceBindingReader()

    def test_exact_binding_maps_only_current_store_revision(self):
        self.reader.register_store(UUID, "primary", resources=[space()], registry_revision=3)
        self.reader.ingest_projection(projection(revision=3))
        result = self.reader.resolve("project-a", space())
        self.assertEqual("mapped", result.state)
        self.reader.register_store(UUID, "primary", resources=[space()], registry_revision=4)
        self.assertEqual(
            "stale",
            self.reader.resolve("project-a", space()).state,
        )

    def test_duplicate_space_keys_are_ambiguous_not_inferred(self):
        self.reader.register_store(UUID, "store-a", resources=[space()], registry_revision=1)
        self.reader.register_store(
            UUID_2, "store-b", resources=[space(UUID_2)], registry_revision=1
        )
        self.reader.ingest_projection(
            projection(
                binding(scope=UUID, revision=1),
                binding(scope=UUID_2, revision=1),
            )
        )
        self.assertEqual(
            "ambiguous", self.reader.resolve_planning_space_key("project-a", "MAIN").state
        )

    def test_projection_preserves_per_binding_owner_and_revision(self):
        envelope = projection(
            binding(scope=UUID, key="MAIN", revision=2, owner="owner-a"),
            binding(scope=UUID_2, key="OTHER", revision=9, owner="owner-b"),
        )
        ingested = self.reader.ingest_projection(envelope)
        self.assertEqual(envelope, ingested)
        self.assertEqual(
            [("owner-a", 2), ("owner-b", 9)],
            [
                (record["source_owner"], record["registry_revision"])
                for record in ingested["bindings"]
            ],
        )

    def test_same_board_ref_cannot_have_competing_owner(self):
        self.reader.register_store(UUID, "store-a", resources=[space()], registry_revision=1)
        self.reader.ingest_projection(projection())
        with self.assertRaises(BindingConflictError):
            self.reader.ingest_projection(
                projection(
                    binding(project="project-b", revision=1, source_hash=HASH_B),
                    project="project-b",
                    source_hash=HASH_B,
                )
            )

    def test_alias_reuse_is_ambiguous_and_does_not_change_scope_identity(self):
        self.reader.register_store(UUID, "shared-alias", resources=[space()], registry_revision=1)
        self.reader.register_store(UUID_2, "other", resources=[space(UUID_2)], registry_revision=1)
        self.reader.register_store(
            UUID_2, "shared-alias", resources=[space(UUID_2)], registry_revision=1
        )
        self.reader.ingest_projection(projection())
        self.assertEqual("ambiguous", self.reader.store_for_alias("shared-alias").state)
        self.assertEqual(
            "mapped",
            self.reader.resolve("project-a", space()).state,
        )

    def test_detach_and_reattach_preserve_identity(self):
        self.reader.register_store(UUID, "primary", resources=[space()], registry_revision=1)
        self.reader.ingest_projection(projection())
        self.reader.detach_store(UUID, unavailable=True)
        self.assertEqual(
            "detached",
            self.reader.resolve("project-a", space()).state,
        )
        self.reader.reattach_store(UUID, registry_revision=1, resources=[space()])
        self.assertEqual(
            "mapped",
            self.reader.resolve("project-a", space()).state,
        )

    def test_unbound_space_key_and_scope_mismatch_fail_closed(self):
        self.reader.register_store(UUID, "primary", resources=[space()], registry_revision=1)
        self.reader.ingest_projection(projection())
        self.assertEqual(
            "unbound",
            self.reader.resolve("project-b", space()).state,
        )
        with self.assertRaises(ScopeError):
            self.reader.authorize(
                planning_work_item_entity(
                    {
                        "space_ref": {"data_scope_id": UUID, "space_key": "MAIN"},
                        "reference": "MAIN-1",
                    }
                ),
                "project-b",
            )

    def test_global_project_and_orphan_entities_are_not_implicitly_projected(self):
        self.reader.register_store(UUID, "primary", resources=[space()], registry_revision=1)
        self.reader.ingest_projection(projection())
        self.assertEqual(
            "unbound",
            self.reader.authorize(
                {"kind": "session", "client_family": "codex", "session_id": "session-1"},
                "project-a",
            ).state,
        )
        self.assertEqual(
            "mapped",
            self.reader.authorize(
                {"kind": "project", "project_id": "project-a"}, "project-a"
            ).state,
        )

    def test_forged_binding_revision_and_hash_are_rejected(self):
        for forged in (
            projection(binding(revision=0), revision=0),
            projection(binding(source_hash="A" * 64), source_hash="A" * 64),
            projection(binding(source_hash="hash-a"), source_hash="hash-a"),
            {**projection(), "project_id": "Project-A"},
            {**projection(), "bindings": [{**binding(), "source_owner": "bad owner"}]},
            {**projection(), "bindings": [{**binding(), "source_hash": HASH_B}]},
            {**projection(), "source_owner": "workspace"},
            {**projection(), "registry_revision": 1},
        ):
            with self.subTest(forged=forged), self.assertRaises(ContractError):
                self.reader.ingest_projection(forged)
        self.assertFalse(hasattr(self.reader, "register_binding"))

    def test_projection_ingest_is_atomic_and_only_higher_per_board_revision_replaces_current(self):
        self.reader.register_store(UUID, "primary", resources=[space()], registry_revision=3)
        current = projection(revision=3)
        self.assertEqual(current, self.reader.ingest_projection(current))
        self.assertEqual(current, self.reader.ingest_projection(current))

        for revision in (3, 2):
            with self.subTest(revision=revision), self.assertRaises(BindingConflictError):
                self.reader.ingest_projection(
                    projection(
                        binding(revision=revision, source_hash=HASH_B, owner="other-owner"),
                        source_hash=HASH_B,
                    )
                )
        self.assertEqual(HASH_A, self.reader.projection_for_project("project-a")["source_hash"])
        self.reader.register_store(UUID, "primary", resources=[space()], registry_revision=4)
        updated_binding = binding(revision=4, source_hash=HASH_B)
        self.reader.ingest_projection(projection(updated_binding, source_hash=HASH_B))
        self.assertEqual(
            HASH_B,
            self.reader.resolve("project-a", space())["binding"]["source_hash"],
        )

    def test_same_hash_conflict_and_multi_binding_stale_update_leave_current_projection_intact(
        self,
    ):
        current = projection(
            binding(scope=UUID, key="MAIN", revision=3),
            binding(scope=UUID_2, key="OTHER", revision=5),
        )
        self.reader.ingest_projection(current)
        with self.assertRaises(BindingConflictError):
            self.reader.ingest_projection(projection(empty=True))
        with self.assertRaises(BindingConflictError):
            self.reader.ingest_projection(
                projection(
                    binding(scope=UUID, key="MAIN", revision=4, source_hash=HASH_B),
                    binding(scope=UUID_2, key="OTHER", revision=5, source_hash=HASH_B),
                    source_hash=HASH_B,
                )
            )
        self.assertEqual(current, self.reader.projection_for_project("project-a"))

    def test_empty_shared_projection_is_valid_atomic_replacement(self):
        self.reader.register_store(UUID, "primary", resources=[space()], registry_revision=1)
        self.reader.ingest_projection(projection())
        empty = projection(source_hash=HASH_B, empty=True)
        self.assertEqual(empty, self.reader.ingest_projection(empty))
        self.assertEqual(empty, self.reader.ingest_projection(empty))
        self.assertEqual([], self.reader.bindings_for_project("project-a"))
        self.assertEqual(
            "unbound",
            self.reader.resolve("project-a", space()).state,
        )

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
