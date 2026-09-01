"""Carrying a store off the former product name, once.

The kernel names the module platform now: `platform_*` tables and `valkama-*`
interface ids. A store written before that contract migration still holds the
former names, and the code reads only the current ones -- so without this the
store would open next to fifteen empty tables and report an empty registry,
which looks exactly like losing every grant, assignment and link.

Three maps, because the rename reached three depths: the catalog (tables and
indexes), the keys rows are addressed by, and the strings the store wrote down
inside its JSON records. A record still naming the old interface would be
refused by its own validator on the next read, so the values travel with the
tables rather than after them.
"""

from __future__ import annotations

import sqlite3

# What a store written before the rename calls these tables. The code reads only
# the current names; this list exists so an existing board survives the rename
# rather than waking up next to fifteen empty tables.
_RENAMED_TABLES = (
    ("hub_store_metadata", "platform_store_metadata"),
    ("hub_adapter_links", "platform_adapter_links"),
    ("hub_modules", "platform_modules"),
    ("hub_services", "platform_services"),
    ("hub_adapters", "platform_adapters"),
    ("hub_connections", "platform_connections"),
    ("hub_assignments", "platform_assignments"),
    ("hub_grants", "platform_grants"),
    ("hub_actions", "platform_actions"),
    ("hub_action_inputs", "platform_action_inputs"),
    ("hub_core_ref_bindings", "platform_core_ref_bindings"),
    ("hub_packages", "platform_packages"),
    ("hub_known_stores", "platform_known_stores"),
    ("hub_registry_meta", "platform_registry_meta"),
    ("hub_registry_audit", "platform_registry_audit"),
    ("hub_ui_prefs", "platform_ui_prefs"),
)

_RENAMED_INDEXES = (
    ("hub_registry_audit_entity", "platform_registry_audit_entity"),
    ("hub_adapter_links_card", "platform_adapter_links_card"),
)

# Strings the store holds inside its JSON records: the interface ids it stamped
# on every payload, and the two built-in identities the registry keys rows by.
# A record still naming the old interface would be refused by its own validator
# on the next read, so these travel with the tables.
_REWRITTEN_VALUES = (
    ("hub-action-command-v1", "valkama-action-command"),
    ("hub-action-result-v1", "valkama-action-result"),
    ("hub-actions-v1", "valkama-actions"),
    ("hub-adapter-v1", "valkama-adapter"),
    ("hub-assignment-activation-v1", "valkama-assignment-activation"),
    ("hub-card-v1", "valkama-card"),
    ("hub-context-v1", "valkama-context"),
    ("hub-contributions-v1", "valkama-contributions"),
    ("hub-grant-revoke-v1", "valkama-grant-revoke"),
    ("hub-modules-v2", "valkama-modules"),
    ("hub-planning-v1", "valkama-planning"),
    ("hub-registry-v1", "valkama-registry"),
    ("hub-relation-command-v1", "valkama-relation-command"),
    ("hub-relation-result-v1", "valkama-relation-result"),
    ("hub-relations-v1", "valkama-relations"),
    ("hub-ui-prefs-v1", "valkama-ui-prefs"),
    ("hub-ui-state-v1", "valkama-ui-state"),
    ("hub.notes-reference-adapter", "valkama.notes-reference-adapter"),
    ("hub-notes", "valkama-notes"),
    ("hub-built-in", "platform-built-in"),
)

# Where those strings live: a table and the columns that may carry one.
_REWRITTEN_COLUMNS = (
    ("platform_modules", ("record_json",)),
    ("platform_services", ("service_key", "record_json")),
    ("platform_adapters", ("record_json",)),
    ("platform_connections", ("connection_key", "record_json")),
    ("platform_assignments", ("record_json",)),
    ("platform_grants", ("record_json",)),
    ("platform_actions", ("action_id", "record_json")),
    ("platform_action_inputs", ("action_id", "record_json")),
    ("platform_core_ref_bindings", ("record_json",)),
    ("platform_packages", ("package_key", "record_json")),
    ("platform_ui_prefs", ("record_json",)),
    ("platform_registry_audit", ("entity_id", "detail_json")),
    ("platform_adapter_links", ("service_owner_id", "provenance_json")),
)


def predates_rename(conn: sqlite3.Connection) -> bool:
    """True when this store still holds a table under the former name."""

    names = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','index')")
    }
    return any(old in names for old, _ in (*_RENAMED_TABLES, *_RENAMED_INDEXES))


def migrate_off_former_name(conn: sqlite3.Connection) -> None:
    """Carry tables, indexes and stored strings onto the current names.

    Runs before ``executescript(SCHEMA)``: that would otherwise create the
    current tables empty beside the populated ones, and the rename would then
    have nowhere to land.
    """

    names = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table','index')")
    }
    for old, new in _RENAMED_INDEXES:
        if old in names and new not in names:
            conn.execute(f"DROP INDEX {old}")
    for old, new in _RENAMED_TABLES:
        if old in names and new not in names:
            conn.execute(f"ALTER TABLE {old} RENAME TO {new}")
    present = {
        row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    for table, columns in _REWRITTEN_COLUMNS:
        if table not in present:
            continue
        for column in columns:
            expression = column
            for old, new in _REWRITTEN_VALUES:
                expression = f"replace({expression},'{old}','{new}')"
            # Every name interpolated here comes from the literal tuples above,
            # and the statement carries no caller value at all.
            conn.execute(f"UPDATE {table} SET {column} = {expression}")  # noqa: S608
    # A session opened by the platform itself recorded `hub` as its client, and
    # a job cancelled by a restart recorded `hub_restarted`. Both are read back
    # and displayed, so both move with the rename.
    if "sessions" in present:
        conn.execute("UPDATE sessions SET client='platform' WHERE client='hub'")
