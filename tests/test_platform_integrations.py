from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store
from server.analytics import LocalJournalUsageProvider
from server.platform import core
from server.platform.capabilities import CAPABILITY_DEFINITIONS
from server.platform.providers import (
    AgentMemoryReferenceProvider,
    BuiltinCapabilityProvider,
    NotesReferenceProvider,
    ProviderCatalog,
)
from tests.registry_fixtures import project_entry, registry_bytes

REQUIRED_LINEAGES = {
    "claude-code-execution",
    "codex-execution",
    "claude-journal-telemetry",
    "codex-rollout-telemetry",
    "agentmemory-reference-v1",
    "codex-skills",
    "claude-skills",
    "git-artifacts",
}


class PlatformIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db = os.path.join(self.directory.name, "valkama.sqlite3")
        self.registry = os.path.join(self.directory.name, "projects.json")
        roots = {
            project_id: Path(self.directory.name) / project_id for project_id in ("alpha", "beta")
        }
        for root in roots.values():
            root.mkdir()
        Path(self.registry).write_bytes(
            registry_bytes(
                [
                    project_entry(
                        project_id,
                        roots[project_id],
                        board=project_id,
                        source_hash=character * 64,
                    )
                    for project_id, character in (("alpha", "a"), ("beta", "b"))
                ]
            )
        )
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.db})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(lambda: self.conn.close())

    def platform(self, *, observe_health: bool = False) -> core.Platform:
        return core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry).read_bytes,
            observe_health=observe_health,
        )

    def _connection(self, lineage: str) -> dict:
        row = self.conn.execute(
            "SELECT record_json FROM platform_connections WHERE connection_key LIKE ?",
            (f"%:{lineage}:%",),
        ).fetchone()
        self.assertIsNotNone(row)
        return json.loads(row[0])

    def test_fresh_catalog_defaults_and_reopen_are_stable(self) -> None:
        platform = self.platform()
        payload = platform.registry_payload({"scope_kind": ["global"]})["state"]["payload"]
        self.assertEqual(
            REQUIRED_LINEAGES,
            {item["connection_ref"]["adapter_lineage_id"] for item in payload["connections"]},
        )
        self.assertNotIn("notes-reference-v1", json.dumps(payload))
        self.assertEqual(10, len(payload["assignments"]))
        self.assertEqual(
            set(CAPABILITY_DEFINITIONS),
            {item["capability"]["capability_id"] for item in payload["capabilities"]},
        )
        declared = {
            capability for adapter in payload["adapters"] for capability in adapter["capabilities"]
        }
        self.assertTrue(declared <= set(CAPABILITY_DEFINITIONS))
        counts = {
            table: self.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "platform_services",
                "platform_adapters",
                "platform_connections",
                "platform_assignments",
            )
        }
        self.conn.close()
        self.conn = store.connect()
        self.platform()
        self.assertEqual(
            counts,
            {
                table: self.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in counts
            },
        )

    def test_connection_projection_is_browser_safe_and_probe_is_deferred(self) -> None:
        with mock.patch.object(BuiltinCapabilityProvider, "health") as probe:
            self.conn.close()
            self.conn = store.connect()
            self.assertEqual(0, probe.call_count)
        diagnostic = {"code": "bounded_probe", "message": "x" * 512}
        with (
            mock.patch.object(
                BuiltinCapabilityProvider,
                "health",
                return_value=("degraded", diagnostic),
            ),
            mock.patch.object(
                AgentMemoryReferenceProvider,
                "health",
                return_value=("ready", None),
            ),
        ):
            payload = self.platform(observe_health=True).registry_payload(
                {"scope_kind": ["global"]}
            )["state"]["payload"]
        for connection in payload["connections"]:
            self.assertEqual(connection["applicability"], connection["scope"])
            self.assertIn(
                connection["transport"],
                {"built-in", "local-file", "local-process", "loopback-http"},
            )
            self.assertIsInstance(connection["name"], str)
            self.assertEqual(
                connection["connection_ref"]["service_ref"]["service_id"],
                connection["service"]["service_id"],
            )
            self.assertIsNotNone(connection["last_checked_at"])
            self.assertIsNotNone(connection["observed_at"])
            if "diagnostics" in connection:
                self.assertLessEqual(len(connection["diagnostics"]["message"]), 512)

    def test_project_override_dispatch_and_reset_use_exact_provider(self) -> None:
        platform = self.platform()
        claude = self._connection("claude-journal-telemetry")
        codex = self._connection("codex-rollout-telemetry")
        command = {
            "interface_version": "valkama-assignment-selection",
            "operation": "set",
            "capability_id": "telemetry.query",
            "scope": {"kind": "project", "project_id": "alpha"},
            "connection_ids": [core._connection_key(claude["connection_ref"])],
            "expected_revision": 0,
        }
        selected = platform.assignment_selection_command(command)
        self.assertEqual("project", selected["effective"]["source"])
        self.assertEqual(
            "claude-journal-telemetry",
            selected["effective"]["connections"][0]["connection_ref"]["adapter_lineage_id"],
        )
        beta = platform.registry().resolve_capability("telemetry.query", "beta")
        self.assertEqual("installation", beta["source"])
        self.assertEqual(
            "codex-rollout-telemetry",
            beta["connections"][0]["connection_ref"]["adapter_lineage_id"],
        )

        def observed(_provider, session_id, client=None, path=None, **_dates):
            return {"session_id": session_id, "client": client, "path": path, "observed": True}

        with mock.patch.object(LocalJournalUsageProvider, "usage_for_session", new=observed):
            alpha_result = platform.dispatch_capability(
                "telemetry.query", {"session_id": "session-alpha"}, project_id="alpha"
            )
            beta_result = platform.dispatch_capability(
                "telemetry.query", {"session_id": "session-beta"}, project_id="beta"
            )
        self.assertEqual("claude", alpha_result["observation"]["client"])
        self.assertEqual("codex", beta_result["observation"]["client"])

        with self.assertRaisesRegex(core.PlatformHttpError, "revision"):
            platform.assignment_selection_command(command)
        self.assertFalse(self.conn.in_transaction)
        reset = platform.assignment_selection_command(
            {
                "interface_version": "valkama-assignment-selection",
                "operation": "reset",
                "capability_id": "telemetry.query",
                "scope": {"kind": "project", "project_id": "alpha"},
                "expected_revision": 1,
            }
        )
        self.assertIsNone(reset["assignment"])
        self.assertEqual("installation", reset["effective"]["source"])
        self.assertEqual(
            core._connection_key(codex["connection_ref"]),
            reset["effective"]["assignment"]["connection_ids"][0],
        )

    def test_selection_refuses_incompatible_connection_and_global_reset(self) -> None:
        platform = self.platform()
        git = self._connection("git-artifacts")
        with self.assertRaises(core.PermissionDeniedError):
            platform.assignment_selection_command(
                {
                    "interface_version": "valkama-assignment-selection",
                    "operation": "set",
                    "capability_id": "telemetry.query",
                    "scope": {"kind": "project", "project_id": "alpha"},
                    "connection_ids": [core._connection_key(git["connection_ref"])],
                    "expected_revision": 0,
                }
            )
        self.assertFalse(self.conn.in_transaction)
        with self.assertRaises(core.ContractError):
            platform.assignment_selection_command(
                {
                    "interface_version": "valkama-assignment-selection",
                    "operation": "reset",
                    "capability_id": "telemetry.query",
                    "scope": {"kind": "installation"},
                    "expected_revision": 1,
                }
            )

    def test_persisted_notes_survives_default_catalog_reopen(self) -> None:
        notes = NotesReferenceProvider()
        core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry).read_bytes,
            providers=ProviderCatalog([notes]),
            observe_health=False,
        )
        self.assertIsNotNone(
            self.conn.execute(
                "SELECT 1 FROM platform_connections WHERE connection_key LIKE '%:notes-reference-v1:%'"
            ).fetchone()
        )
        self.conn.close()
        self.conn = store.connect()
        payload = self.platform().registry_payload({"scope_kind": ["global"]})["state"]["payload"]
        self.assertIn("notes-reference-v1", json.dumps(payload))


if __name__ == "__main__":
    unittest.main()
