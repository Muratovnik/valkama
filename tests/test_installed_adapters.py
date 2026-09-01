"""EXT-006: what an installation declares, and what removing one leaves behind.

An external adapter is declared by a file for the same reason a built-in is
declared in code: both then travel the identical seeding path. The cases here
are mostly about the ways a directory anybody can write into goes wrong — an
unreadable file, an address the transport policy refuses, an id that tries to
be a path — because that directory is the one part of this an owner edits by
hand.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

# `store` first: it initialises the Kernel and breaks the platform import
# cycle, and it sorts before `server.platform` so a formatter keeps it there.
from server import cli, store
from server.platform import core as platform_core
from server.platform import external, health, installed, providers
from server.platform.contracts import ContractError
from server.platform.registry import RegistryError
from server.platform.transports import HttpTransport, McpTransport


def manifest_for(adapter_id: str, package_id: str = "example.adapter") -> dict:
    return {
        "contract_version": "valkama-adapter",
        "adapter_id": adapter_id,
        "version": "1.0.0",
        "title_key": "platform.adapters.notes-reference",
        "package_id": package_id,
        "publisher_id": "example",
        "owner_id": "example",
        "configuration_owner": "example",
        "trust_owner": "example",
        "execution": "local_service",
        "supported_service_types": ["notes-reference"],
        "capabilities": ["memory.open"],
        "consumes": [],
        "contributions": [],
        "permissions": [
            {
                "permission_id": "memory.open",
                "connection_mode": "required",
                "entity_kinds": ["adapter-resource"],
                "target_kinds": ["note"],
            }
        ],
        "health_contract": {"timeout_ms": 500, "max_payload_bytes": 131072},
    }


def record_for(adapter_id: str, base_url: str = "http://127.0.0.1:8770") -> dict:
    return {
        "record_version": installed.RECORD_VERSION,
        "manifest": manifest_for(adapter_id),
        "transport": {"kind": "http", "base_url": base_url},
    }


def http_provider(
    adapter_id: str,
    *,
    package_id: str = "example.adapter",
    headers: dict[str, str] | None = None,
    timeout_ms: int = 50,
) -> external.ExternalProvider:
    """One installed adapter reached over loopback HTTP, and nothing listening."""

    return external.ExternalProvider(
        manifest_record=manifest_for(adapter_id, package_id),
        channel=external.HttpChannel(
            HttpTransport(
                base_url="http://127.0.0.1:8770",
                timeout_ms=timeout_ms,
                headers=headers or {},
            )
        ),
    )


def mcp_provider(
    adapter_id: str, source: str, *, timeout_ms: int, package_id: str = "example.adapter"
) -> external.ExternalProvider:
    """One installed adapter reached as an MCP server, written for this test."""

    return external.ExternalProvider(
        manifest_record={**manifest_for(adapter_id, package_id), "execution": "local_process"},
        channel=external.McpChannel(
            McpTransport(command=(sys.executable, "-c", source), timeout_ms=timeout_ms)
        ),
    )


#: Two adapters that are not adapters. The first answers bytes no decoder can
#: read, the second answers nothing at all until it is stopped.
_NOT_UTF8 = 'import sys; sys.stdout.buffer.write(bytes([255, 254]) + b" not utf8")'
_NEVER_ANSWERS = "import time; time.sleep(120)"


def cli_record(adapter_id: str, command: list[str]) -> dict:
    manifest = {**manifest_for(adapter_id), "execution": "local_process"}
    return {
        "record_version": installed.RECORD_VERSION,
        "manifest": manifest,
        "transport": {"kind": "cli", "command": command},
    }


class InstalledTests(unittest.TestCase):
    def setUp(self) -> None:
        self._home = tempfile.TemporaryDirectory()
        self.addCleanup(self._home.cleanup)
        self.home = self._home.name

    def write_raw(self, name: str, content: str) -> Path:
        directory = Path(installed.adapters_path(self.home))
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / name
        path.write_text(content, encoding="utf-8")
        return path

    def test_an_installed_record_becomes_a_provider(self) -> None:
        record = record_for("example-one")
        installed.install(record["manifest"], record["transport"], self.home)
        found = installed.installed_providers(self.home)
        self.assertEqual(["example-one"], [item.adapter_id for item in found])
        self.assertEqual(("memory.open",), found[0].capabilities)

    def test_an_installed_adapter_claims_no_core_ref_kind(self) -> None:
        # Claiming one binds every ref of that kind to it and the Kernel refuses
        # two claimants, so a manifest that could claim `memory` would displace
        # the provider the owner already has, at install time, silently.
        record = record_for("example-one")
        installed.install(record["manifest"], record["transport"], self.home)
        self.assertEqual((), installed.installed_providers(self.home)[0].core_ref_kinds)

    def test_removing_one_stops_it_being_declared(self) -> None:
        record = record_for("example-one")
        installed.install(record["manifest"], record["transport"], self.home)
        self.assertTrue(installed.remove("example-one", self.home))
        self.assertEqual([], installed.installed_providers(self.home))
        # And saying so about one that was never here, rather than pretending.
        self.assertFalse(installed.remove("example-one", self.home))

    def test_nothing_installed_is_not_an_error(self) -> None:
        self.assertEqual(([], []), installed.read_records(self.home))
        self.assertEqual([], installed.installed_providers(self.home))

    def test_one_unreadable_file_does_not_stop_the_others(self) -> None:
        # The failure the doctor already met: a malformed file taking down the
        # thing that exists to survive malformed files.
        good = record_for("good-one")
        installed.install(good["manifest"], good["transport"], self.home)
        self.write_raw("broken.json", "{ not json")
        self.write_raw("wrong.json", json.dumps({"contract_version": "nope"}))
        records, refusals = installed.read_records(self.home)
        self.assertEqual(["good-one"], [item["manifest"]["adapter_id"] for item in records])
        self.assertEqual(2, len(refusals))
        for refusal in refusals:
            self.assertTrue(refusal["reason"], "a refusal with no reason is a silent one")

    def test_an_address_the_policy_refuses_makes_no_provider(self) -> None:
        # Plaintext to a remote host. Half-building it would produce a
        # Connection reporting `unavailable` for a reason nobody can act on.
        remote = record_for("remote-one", "http://adapter.example.com")
        installed.install(remote["manifest"], remote["transport"], self.home)
        records, refusals = installed.read_records(self.home)
        self.assertEqual(1, len(records), "the record itself is still readable")
        self.assertEqual([], refusals)
        self.assertEqual([], installed.installed_providers(self.home))

    def test_a_record_over_the_ceiling_is_refused_by_name(self) -> None:
        self.write_raw("huge.json", " " * (installed.MAX_RECORD_BYTES + 1))
        _, refusals = installed.read_records(self.home)
        self.assertEqual(1, len(refusals))
        self.assertIn("bytes", refusals[0]["reason"])

    def test_an_id_that_tries_to_be_a_path_is_refused(self) -> None:
        for hostile in ("../escape", "a/b", ""):
            with self.subTest(adapter_id=hostile):
                with self.assertRaises(ValueError):
                    installed.record_path(hostile, self.home)

    def test_a_file_that_is_not_json_is_skipped_rather_than_read(self) -> None:
        self.write_raw("notes.txt", "not a record at all")
        self.assertEqual(([], []), installed.read_records(self.home))

    def test_a_record_may_name_a_process_instead_of_an_address(self) -> None:
        # The transport is a separate half precisely so it can hold this: an
        # argv is refused anywhere in a manifest, because a manifest is
        # published to the browser.
        record = cli_record("example-cli", ["python", "-c", "pass"])
        installed.install(record["manifest"], record["transport"], self.home)
        provider = installed.installed_providers(self.home)[0]
        self.assertEqual("local-process", provider.transport)

    def test_a_transport_that_does_not_suit_the_execution_mode_is_refused(self) -> None:
        # A `local_service` reached by argv, or a `local_process` by URL, is two
        # claims about where the adapter lives.
        with self.assertRaises(ContractError):
            installed.install(
                manifest_for("example-one"), {"kind": "cli", "command": ["x"]}, self.home
            )


class StoreCase(unittest.TestCase):
    """One throwaway store, and a Platform over whatever providers a test names."""

    def setUp(self) -> None:
        # `ignore_cleanup_errors` because a command under test opens its own
        # connection and never closes it — the process it normally runs in is
        # about to exit — and Windows will not delete the file underneath it.
        self.directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.directory.cleanup)
        self.db = os.path.join(self.directory.name, "valkama.sqlite3")
        self.registry = os.path.join(self.directory.name, "projects.json")
        Path(self.registry).write_text(json.dumps({"projects": []}), encoding="utf-8")
        self._restore = {"VALKAMA_DB": os.environ.get("VALKAMA_DB")}
        os.environ["VALKAMA_DB"] = self.db
        self.addCleanup(self._restore_environment)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        # Observations are process-wide and keyed by store, so a temporary
        # database cannot inherit another test's answers — but a test that
        # asserts a probe happened wants to start from nothing regardless.
        health.OBSERVED.clear()
        self.notes = providers.NotesReferenceProvider()

    def build(self, *catalog, observe_health: bool = False) -> platform_core.Platform:
        return platform_core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry).read_bytes,
            providers=providers.ProviderCatalog(list(catalog)),
            observe_health=observe_health,
        )

    def _restore_environment(self) -> None:
        for name, value in self._restore.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def rows(self, table: str, column: str) -> list[str]:
        return [
            str(row[0])
            for row in self.conn.execute(f"SELECT {column} FROM {table}")
            if "external" in str(row[0])
        ]

    def keys(self, table: str, column: str) -> list[str]:
        return [str(row[0]) for row in self.conn.execute(f"SELECT {column} FROM {table}")]


class UnregisterTests(StoreCase):
    """Removing a declaration is half of removal; the registry rows are the rest.

    Without this, the rows an earlier start wrote stay as a Connection nobody
    can act on. That is debris rather than the honest `unavailable` a removed
    adapter reads as while something still points at it.
    """

    def setUp(self) -> None:
        super().setUp()
        self.external = http_provider("example-external")
        self.platform = self.build(self.notes, self.external)

    def test_an_installed_adapter_seeds_like_any_other_and_can_be_taken_out(self) -> None:
        self.assertEqual(["example-external"], self.rows("platform_adapters", "adapter_id"))
        outcome = self.platform.unregister_external_adapter("example-external")
        self.assertTrue(outcome["removed"])
        for table, column in (
            ("platform_adapters", "adapter_id"),
            ("platform_services", "service_key"),
            ("platform_connections", "connection_key"),
            ("platform_packages", "package_key"),
        ):
            self.assertEqual([], self.rows(table, column), table)

    def test_a_built_in_cannot_be_unregistered(self) -> None:
        # It is declared in code and would be seeded again on the next start,
        # so deleting its rows is a change that undoes itself.
        outcome = self.platform.unregister_external_adapter("notes-reference")
        self.assertFalse(outcome["removed"])
        self.assertIn("externally installed", outcome["reason"])

    def test_an_adapter_that_is_not_there_says_so(self) -> None:
        outcome = self.platform.unregister_external_adapter("never-existed")
        self.assertFalse(outcome["removed"])
        self.assertIn("no adapter", outcome["reason"])

    def test_removal_keeps_every_row_that_is_not_this_adapter_s(self) -> None:
        """The pattern match this replaced could delete a stranger's Connection.

        `connection_key LIKE '%:<lineage>:%'` reads a composite key as a
        pattern, and an identifier may contain `_`, which LIKE spends as a
        single-character wildcard. So `ex_one` matched `ex-one`, and taking out
        the first adapter deleted the second's Connection — plus, when the
        wildcard fell inside a built-in's lineage, a built-in's, which the next
        start reseeded with `trust: unknown`, quietly discarding an owner's
        explicit trust decision.
        """

        hostile = http_provider("ex_one", package_id="example.hostile")
        neighbour = http_provider("ex-one", package_id="example.neighbour")
        platform = self.build(self.notes, hostile, neighbour)
        promoted = platform.set_connection_trust(self.notes.connection_ref, "trusted")
        self.assertEqual("trusted", promoted["trust"])
        before = set(self.keys("platform_connections", "connection_key"))

        outcome = platform.unregister_external_adapter("ex_one")
        self.assertTrue(outcome["removed"])
        after = set(self.keys("platform_connections", "connection_key"))
        self.assertEqual(
            {platform_core._connection_key(hostile.connection_ref)},
            before - after,
            "exactly the unregistered adapter's Connection, and nothing beside it",
        )
        self.assertIn(platform_core._connection_key(neighbour.connection_ref), after)
        notes_row = self.conn.execute(
            "SELECT record_json FROM platform_connections WHERE connection_key=?",
            (platform_core._connection_key(self.notes.connection_ref),),
        ).fetchone()
        self.assertIsNotNone(notes_row, "the built-in's Connection survived")
        self.assertEqual("trusted", json.loads(notes_row[0])["trust"])

    def test_a_built_in_whose_lineage_the_pattern_would_match_is_untouched(self) -> None:
        # `notes-reference-v_` is a legal adapter id and, as a LIKE pattern,
        # matches `notes-reference-v1`. An installed manifest is endpoint-
        # influenced, so this is not a hostile id so much as an unlucky one.
        impostor = http_provider("notes-reference-v_", package_id="example.impostor")
        platform = self.build(self.notes, impostor)
        platform.set_connection_trust(self.notes.connection_ref, "restricted")
        self.assertTrue(platform.unregister_external_adapter("notes-reference-v_")["removed"])
        notes_row = self.conn.execute(
            "SELECT record_json FROM platform_connections WHERE connection_key=?",
            (platform_core._connection_key(self.notes.connection_ref),),
        ).fetchone()
        self.assertIsNotNone(notes_row)
        self.assertEqual("restricted", json.loads(notes_row[0])["trust"])
        self.assertIsNotNone(
            self.conn.execute(
                "SELECT 1 FROM platform_adapters WHERE adapter_lineage_id='notes-reference-v1'"
            ).fetchone()
        )

    def test_a_live_instance_stops_serving_a_removed_adapter(self) -> None:
        # `PRAGMA data_version` does not move for this connection's own commits,
        # so the registry cache has to be dropped explicitly. Every sibling
        # mutator does it; this one did not, and only the CLI throwing its
        # Platform away immediately hid that.
        def served() -> list[str]:
            payload = self.platform.registry_payload({"scope_kind": ["global"]})["state"]["payload"]
            return [
                item["connection_ref"]["adapter_lineage_id"] for item in payload["connections"]
            ] + [item["adapter_id"] for item in payload["adapters"]]

        self.assertIn("example-external", served())
        self.assertTrue(self.platform.unregister_external_adapter("example-external")["removed"])
        self.assertNotIn("example-external", served())

    def test_a_failure_part_way_through_leaves_the_store_as_it_was(self) -> None:
        # Four deletes and an insert with no fence: whatever failed in the
        # middle used to stay half-done, and a half-removed adapter is a
        # Connection with no adapter behind it.
        before = {
            table: sorted(self.keys(table, column))
            for table, column in (
                ("platform_adapters", "adapter_id"),
                ("platform_services", "service_key"),
                ("platform_connections", "connection_key"),
                ("platform_packages", "package_key"),
            )
        }
        with mock.patch.object(
            platform_core.Platform, "_audit", side_effect=RegistryError("interrupted")
        ):
            with self.assertRaises(RegistryError):
                self.platform.unregister_external_adapter("example-external")
        self.assertFalse(self.conn.in_transaction, "the fence was released")
        self.assertEqual(
            before,
            {
                table: sorted(self.keys(table, column))
                for table, column in (
                    ("platform_adapters", "adapter_id"),
                    ("platform_services", "service_key"),
                    ("platform_connections", "connection_key"),
                    ("platform_packages", "package_key"),
                )
            },
        )

    def test_an_assignment_that_still_selects_it_refuses_with_a_code(self) -> None:
        # The refusal the CLI has to tell apart from "nothing is registered":
        # one leaves both halves in place, the other is a declaration the owner
        # may still delete.
        self.platform.assignment_selection_command(
            {
                "interface_version": "valkama-assignment-selection",
                "operation": "set",
                "capability_id": "memory.open",
                "scope": {"kind": "installation"},
                "connection_ids": [platform_core._connection_key(self.external.connection_ref)],
                "expected_revision": 1,
            }
        )
        outcome = self.platform.unregister_external_adapter("example-external")
        self.assertFalse(outcome["removed"])
        self.assertEqual("assignments-select-it", outcome["code"])
        self.assertEqual(["example-external"], self.rows("platform_adapters", "adapter_id"))

    def test_the_audit_keeps_that_it_was_known(self) -> None:
        # Removed and never-known look identical in a table and different in a
        # history, which is the distinction the module reconcile already needs.
        self.platform.unregister_external_adapter("example-external")
        events = [
            row[0]
            for row in self.conn.execute(
                "SELECT event_kind FROM platform_registry_audit WHERE entity_id=?",
                ("example-external",),
            )
        ]
        self.assertIn("adapter.registered", events)
        self.assertIn("unregistered", events)


class RemoveCommandTests(StoreCase):
    """`adapter remove` is two halves, and the refusable one goes first.

    The declaration used to be deleted before the registry was asked, and the
    registry refuses while an assignment still selects the lineage — leaving
    exactly the debris the paired flow exists to prevent: rows present, and no
    declaration left to reinstall in order to reach them.
    """

    def setUp(self) -> None:
        super().setUp()
        home = mock.patch.dict(
            os.environ, {"USERPROFILE": self.directory.name, "HOME": self.directory.name}
        )
        home.start()
        self.addCleanup(home.stop)
        self.external = http_provider("example-external")
        self.record_path = installed.install(
            self.external.manifest_record,
            {"kind": "http", "base_url": "http://127.0.0.1:8770"},
            self.directory.name,
        )
        self.platform = self.build(self.notes, self.external)

    def invoke(self) -> str:
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            cli.main(["adapter", "remove", "example-external"])
        return stream.getvalue()

    def select_it(self, revision: int) -> None:
        self.platform.assignment_selection_command(
            {
                "interface_version": "valkama-assignment-selection",
                "operation": "set",
                "capability_id": "memory.open",
                "scope": {"kind": "installation"},
                "connection_ids": [platform_core._connection_key(self.external.connection_ref)],
                "expected_revision": revision,
            }
        )

    def test_a_refused_removal_leaves_both_halves_in_place(self) -> None:
        self.select_it(1)
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream), self.assertRaises(SystemExit) as refused:
            cli.main(["adapter", "remove", "example-external"])
        self.assertEqual(1, refused.exception.code)
        self.assertIn("not unregistered", stream.getvalue())
        self.assertTrue(os.path.isfile(self.record_path), "the declaration survived")
        self.assertEqual(["example-external"], self.rows("platform_adapters", "adapter_id"))

    def test_a_successful_removal_takes_both(self) -> None:
        printed = self.invoke()
        self.assertIn("unregistered example-external", printed)
        self.assertIn("removed the declaration", printed)
        self.assertFalse(os.path.isfile(self.record_path))
        self.assertEqual([], self.rows("platform_adapters", "adapter_id"))

    def test_nothing_registered_under_that_id_is_not_a_refusal(self) -> None:
        # Only an assignment still selecting the lineage stops the command. An
        # id nothing knows is answered and the exit stays clean, because there
        # is nothing to leave in place.
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            cli.main(["adapter", "remove", "never-installed"])
        printed = stream.getvalue()
        self.assertIn("no adapter", printed)
        self.assertIn("was not declared here", printed)
        self.assertTrue(os.path.isfile(self.record_path), "another adapter's file is untouched")


class ObservedHealthTests(StoreCase):
    """What a read costs when an adapter is broken, and what it reports instead.

    Every kernel read reconstructs the registry, and the registry used to probe
    every Connection while it did — a child process per installed adapter, on a
    Platform instance that lives one request. One dead MCP adapter therefore
    added its whole probe timeout to every read of the Kernel, forever.
    """

    def connection_health(self, platform: platform_core.Platform) -> dict[str, str]:
        payload = platform.registry_payload({"scope_kind": ["global"]})["state"]["payload"]
        return {
            item["connection_ref"]["adapter_lineage_id"]: item["health"]
            for item in payload["connections"]
        }

    def test_a_read_does_not_wait_on_an_adapter_that_never_answers(self) -> None:
        # `quick` fits the read's allowance and is probed; `slow` declares a
        # ceiling far past it and is not started at all, so the read costs the
        # one probe rather than sixteen seconds of the other.
        quick = mcp_provider("quick-dead", _NEVER_ANSWERS, timeout_ms=200)
        slow = mcp_provider(
            "slow-dead", _NEVER_ANSWERS, timeout_ms=15_000, package_id="example.slow"
        )
        self.assertGreater(slow.probe_ceiling_ms, health.READ_PROBE_BUDGET_MS)
        platform = self.build(self.notes, quick, slow, observe_health=True)
        started = time.monotonic()
        observed = self.connection_health(platform)
        elapsed_ms = (time.monotonic() - started) * 1000
        # Generous enough for a cold interpreter start on the probe that did
        # run, and far short of the timeout the other one would have cost.
        self.assertLess(elapsed_ms, 3_000, "the read waited on the dead adapter")
        self.assertEqual("unavailable", observed["quick-dead"])
        # Never asked is its own state, and it is the honest one: nothing here
        # knows whether that adapter is up.
        self.assertEqual("not-observed", observed["slow-dead"])

    def test_the_unbounded_sweep_observes_what_a_read_could_not_afford(self) -> None:
        # The other half of the bound: health is still observed, off the path
        # where waiting costs somebody a response.
        slow = mcp_provider("slow-dead", _NEVER_ANSWERS, timeout_ms=1_500)
        platform = self.build(self.notes, slow, observe_health=True)
        with mock.patch.object(health, "READ_PROBE_BUDGET_MS", 10):
            self.assertEqual("not-observed", self.connection_health(platform)["slow-dead"])
        report = platform.observe_connection_health()
        self.assertEqual(
            "unavailable", report["connections"]["example:slow-dead:slow-dead:default"]
        )
        self.assertEqual("unavailable", self.connection_health(platform)["slow-dead"])

    def test_an_adapter_answering_bytes_no_decoder_can_read_is_a_typed_state(self) -> None:
        # The escape this closes: a bare `UnicodeDecodeError` out of the MCP
        # stream is not a `TransportError`, so it went through `health` — which
        # promises never to raise — and failed the whole registry read.
        garbage = mcp_provider("garbling", _NOT_UTF8, timeout_ms=5_000)
        platform = self.build(self.notes, garbage, observe_health=True)
        platform.observe_connection_health()
        observed = self.connection_health(platform)
        self.assertEqual("unavailable", observed["garbling"])
        self.assertEqual("ready", observed["notes-reference-v1"], "the read survived it")

    def test_an_adapter_whose_credential_carries_a_line_break_is_a_typed_state(self) -> None:
        # The header value is resolved from the environment at call time, so the
        # manifest's own bounds never see it. `http.client` answers CR or LF
        # with `ValueError`, which escaped the same contract the same way.
        injected = http_provider(
            "injecting",
            headers={"Authorization": "Bearer ${VALKAMA_TEST_INJECTED_TOKEN}"},
            timeout_ms=100,
        )
        platform = self.build(self.notes, injected, observe_health=True)
        with mock.patch.dict(os.environ, {"VALKAMA_TEST_INJECTED_TOKEN": "abc\r\nX-Injected: 1"}):
            platform.observe_connection_health()
            observed = self.connection_health(platform)
        self.assertEqual("unavailable", observed["injecting"])
        self.assertEqual("ready", observed["notes-reference-v1"], "the read survived it")

    def test_a_second_read_serves_what_the_first_observed(self) -> None:
        platform = self.build(self.notes, observe_health=True)
        key = platform_core._connection_key(self.notes.connection_ref)
        self.connection_health(platform)
        first = health.OBSERVED.read(self.db, key)
        self.assertIsNotNone(first)
        with mock.patch.object(
            providers.NotesReferenceProvider, "health", side_effect=AssertionError("probed again")
        ):
            self.assertEqual("ready", self.connection_health(platform)["notes-reference-v1"])
        self.assertEqual(first, health.OBSERVED.read(self.db, key))

    def test_what_was_observed_is_reported_with_when(self) -> None:
        platform = self.build(self.notes, observe_health=True)
        payload = platform.registry_payload({"scope_kind": ["global"]})["state"]["payload"]
        connection = next(
            item
            for item in payload["connections"]
            if item["connection_ref"]["adapter_lineage_id"] == "notes-reference-v1"
        )
        observation = health.OBSERVED.read(
            self.db, platform_core._connection_key(self.notes.connection_ref)
        )
        self.assertIsNotNone(observation)
        # The time the state was observed, not the time this payload was built.
        self.assertEqual(observation.observed_at, connection["last_checked_at"])


class CatalogueTests(unittest.TestCase):
    """The built-ins are unaffected by whether anything is installed."""

    def test_the_catalogue_holds_the_built_ins_and_whatever_is_declared(self) -> None:
        catalog = providers.ProviderCatalog()
        identifiers = [item.adapter_id for item in catalog.all()]
        for expected in ("agentmemory-reference", "codex-execution", "git-artifacts"):
            self.assertIn(expected, identifiers)
        self.assertEqual(len(identifiers), len(set(identifiers)), "one entry per adapter")


if __name__ == "__main__":
    unittest.main()
