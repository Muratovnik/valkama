"""Store identity: which store this is, and how an entity inside it is named.

`metadata` owns the one row that names a store — its `data_scope_id` and the
product that owns it. `refs` owns the exact identity of an entity inside a
store: a planning space by its key, a work item by its reference, a project,
an operating scope. `primitives` is the vocabulary both are checked in.

This package sits beneath everything that routes by identity — Planning, the
app shell and the platform modules alike — and imports none of them. The
table keeps its `platform_` name and the refs keep their encoding, because
every binding and relation on disk already points at them.
"""
