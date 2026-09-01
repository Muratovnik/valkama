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
`LEGACY_LAYOUTS`, `platform_scope.FORMER_OWNER_IDS`, the stale backup names in
`tests/test_store_migration.py`'s `build_legacy_root` fixture, and
`OPERATING_SCOPE_INTERFACE = "project-resource-binding"`. A concrete namespace
owned by an external provider belongs only in local configuration and is neither
enumerated nor inferred here. The operating-scope interface id discriminates an envelope the workspace
projects registry authors and this product only reads, so spelling it
`valkama-project-resource-binding` would rename nothing and stop matching the
documents on disk.

Runtime state lives at `%USERPROFILE%\.valkama`. `store.adopt_legacy_store()`
walks `LEGACY_LAYOUTS` newest-first, moves the whole directory once, and refuses
loudly rather than opening an empty board. The store's `owner_id` is immutable
by design so a second product cannot claim someone else's board;
`platform_scope.migrate_store_owner()` is the one sanctioned way past it and spends
only this product's own former names, never an arbitrary value.
