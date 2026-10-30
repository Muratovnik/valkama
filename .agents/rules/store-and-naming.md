# The store, the platform names, and what the former names still own

Routed from `AGENTS.md`. Read this before touching a table name, an interface
id, `LEGACY_LAYOUTS`, or anything under `%USERPROFILE%\.valkama`.

The kernel no longer carries a former product name. What it names is the module
platform, so `server/platform/` is the package, `platform_*` the tables, and
`platform.*` the i18n key space; what it publishes is the product's contract, so
the interface ids are `valkama-*`. None of them carry a version suffix — the
improvements and skills contracts never did, and a `-v1` that no second version
was ever going to join read as a promise nobody had made.

That was a contract migration, which is why it is written down here. A store
written before it keeps its rows: `store_rename.migrate_off_former_name()`
renames the tables and rewrites the interface ids inside the records once,
stamped by `STORE_SCHEMA_VERSION`, and `tests/test_store_rename_migration.py`
proves the carry-over against a throwaway store. The public literals deliberately
still spelled the old way name what earlier generations wrote on real disks:
`LEGACY_LAYOUTS`, `store_identity.metadata.FORMER_OWNER_IDS`, and the stale
backup names in `tests/test_store_migration.py`'s `build_legacy_root` fixture.
A concrete namespace owned by an external provider belongs only in local
configuration and is neither enumerated nor inferred here.

Schema 9 dropped the extension registry's tables (`platform_services`,
`platform_adapters`, `platform_connections`, `platform_assignments`,
`platform_grants`, `platform_actions`, `platform_action_inputs`,
`platform_packages`, `platform_core_ref_bindings`, `platform_known_stores`,
`platform_registry_meta`, `platform_adapter_links`), the module rows
(`platform_modules`) with their audit (`platform_registry_audit`), and
`integration_settings`. What a store at 9 holds of the Kernel is
`platform_store_metadata` and `platform_ui_prefs`, declared in
`platform/core.py`. The dropped tables keep their names and DDL in
`platform/migrations.py`, frozen as schema 8 declared them (the Board-era
cutover in `platform/relations.py` also keeps the adapter-link table text it
rebuilds from): `store.connect()`
gives a store older than 9 that catalog before the historical migrations run,
and drops it in the step that ends the chain, after a verified snapshot
labelled `preschema9` (or `preproductmodel` for a store older than 8).
`store_rename` still renames those tables and rewrites the registry's former
interface ids inside them, because the historical migrations between the
rename and the drop read and validate them under the current names.

Runtime state lives at `%USERPROFILE%\.valkama`. `store.adopt_legacy_store()`
walks `LEGACY_LAYOUTS` newest-first, moves the whole directory once, and refuses
loudly rather than opening an empty board. The store's `owner_id` is immutable
by design so a second product cannot claim someone else's board;
`store_identity.metadata.migrate_store_owner()` is the one sanctioned way past it
and spends only this product's own former names, never an arbitrary value.
