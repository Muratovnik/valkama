"""What an installation declares, and how an installed adapter's health reads.

An external adapter is declared by a file the owner controls. The cases here
are mostly about the ways a directory anybody can write into goes wrong -- an
unreadable file, an address the transport policy refuses, an id that tries to
be a path, a record in a shape this contract no longer has -- because that
directory is the one part of this an owner edits by hand.
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

from server import cli
from server.platform import external, installed
from server.platform.transports import HttpTransport, McpTransport
from server.store_identity.primitives import ContractError, UnknownFieldError


def manifest_for(adapter_id: str) -> dict:
    return {
        "contract_version": "valkama-adapter",
        "adapter_id": adapter_id,
        "version": "1.0.0",
        "capabilities": ["memory.open"],
    }


def record_for(adapter_id: str, base_url: str = "http://127.0.0.1:8770") -> dict:
    return {
        "record_version": installed.RECORD_VERSION,
        "manifest": manifest_for(adapter_id),
        "transport": {"kind": "http", "base_url": base_url},
    }


def cli_record(adapter_id: str, command: list[str]) -> dict:
    return {
        "record_version": installed.RECORD_VERSION,
        "manifest": manifest_for(adapter_id),
        "transport": {"kind": "cli", "command": command},
    }


def mcp_provider(adapter_id: str, source: str, *, timeout_ms: int) -> external.ExternalProvider:
    """One installed adapter reached as an MCP server, written for this test."""

    return external.ExternalProvider(
        manifest_record=manifest_for(adapter_id),
        channel=external.McpChannel(
            McpTransport(command=(sys.executable, "-c", source), timeout_ms=timeout_ms)
        ),
    )


#: Two adapters that are not adapters. The first answers bytes no decoder can
#: read, the second answers nothing at all until it is stopped.
_NOT_UTF8 = 'import sys; sys.stdout.buffer.write(bytes([255, 254]) + b" not utf8")'
_NEVER_ANSWERS = "import time; time.sleep(120)"


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

    def test_what_is_written_is_exactly_the_record(self) -> None:
        record = record_for("example-one")
        path = installed.install(record["manifest"], record["transport"], self.home)
        self.assertEqual(record, json.loads(Path(path).read_text(encoding="utf-8")))

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

    def test_a_record_in_the_former_long_shape_is_refused_by_name(self) -> None:
        # A record written while the manifest still carried its registry fields
        # is not half-read: the owner is told which field this contract does
        # not name, and the adapter is not declared.
        former = record_for("former-one")
        former["manifest"] = {
            **former["manifest"],
            "title_key": "platform.adapters.notes-reference",
            "execution": "local_service",
        }
        self.write_raw("former-one.json", json.dumps(former))
        records, refusals = installed.read_records(self.home)
        self.assertEqual([], records)
        self.assertIn("title_key", refusals[0]["reason"])
        with self.assertRaises(UnknownFieldError):
            installed.install(former["manifest"], former["transport"], self.home)

    def test_a_record_carrying_a_field_of_its_own_is_refused(self) -> None:
        with self.assertRaises(ValueError) as refused:
            installed.validate_record({**record_for("example-one"), "trust": "trusted"})
        self.assertIn("trust", str(refused.exception))

    def test_an_address_the_policy_refuses_makes_no_provider(self) -> None:
        # Plaintext to a remote host. Half-building it would produce a provider
        # reporting `unavailable` for a reason nobody can act on.
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
        # argv is refused anywhere in a manifest.
        record = cli_record("example-cli", ["python", "-c", "pass"])
        installed.install(record["manifest"], record["transport"], self.home)
        provider = installed.installed_providers(self.home)[0]
        self.assertIsInstance(provider.channel, external.CliChannel)

    def test_a_transport_that_is_both_an_address_and_a_process_is_refused(self) -> None:
        with self.assertRaises(ContractError):
            installed.install(
                manifest_for("example-one"),
                {"kind": "cli", "command": ["x"], "base_url": "http://127.0.0.1:1"},
                self.home,
            )


class RemoveCommandTests(unittest.TestCase):
    """`adapter remove` deletes the declaration, which is all there is."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.home = directory.name
        home = mock.patch.dict(os.environ, {"USERPROFILE": self.home, "HOME": self.home})
        home.start()
        self.addCleanup(home.stop)
        record = record_for("example-external")
        self.record_path = installed.install(record["manifest"], record["transport"], self.home)

    def invoke(self, adapter_id: str) -> str:
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            cli.main(["adapter", "remove", adapter_id])
        return stream.getvalue()

    def test_removal_deletes_the_declaration(self) -> None:
        printed = self.invoke("example-external")
        self.assertIn("removed the declaration of example-external", printed)
        self.assertFalse(os.path.isfile(self.record_path))

    def test_an_id_that_was_never_declared_is_answered_without_a_refusal(self) -> None:
        # Nothing to delete is an answer, not an error: the exit stays clean.
        printed = self.invoke("never-installed")
        self.assertIn("never-installed was not declared here", printed)
        self.assertTrue(os.path.isfile(self.record_path), "another adapter's file is untouched")


class ProviderHealthTests(unittest.TestCase):
    """`health` never raises, whatever a broken adapter does.

    The doctor reads every installed adapter's health in one sweep, so one
    adapter's failure escaping as an exception would take the whole report with
    it. Each way an adapter can fail is a typed `unavailable` instead.
    """

    def test_an_adapter_that_never_answers_is_stopped_at_its_own_timeout(self) -> None:
        started = time.monotonic()
        state, diagnostics = mcp_provider("never", _NEVER_ANSWERS, timeout_ms=200).health()
        # Generous enough for a cold interpreter start, and far short of the
        # two minutes the child would otherwise sleep.
        self.assertLess(time.monotonic() - started, 10)
        self.assertEqual("unavailable", state)
        self.assertEqual("provider_unavailable", (diagnostics or {})["code"])

    def test_an_adapter_answering_bytes_no_decoder_can_read_is_a_typed_state(self) -> None:
        # The escape this closes: a bare `UnicodeDecodeError` out of the MCP
        # stream is not a `TransportError`, so it went through `health`.
        state, diagnostics = mcp_provider("garbling", _NOT_UTF8, timeout_ms=5_000).health()
        self.assertEqual("unavailable", state)
        self.assertEqual("provider_unavailable", (diagnostics or {})["code"])

    def test_an_adapter_whose_credential_carries_a_line_break_is_a_typed_state(self) -> None:
        # The header value is resolved from the environment at call time, so the
        # record's own bounds never see it. `http.client` answers CR or LF with
        # `ValueError`, which escaped the same contract the same way.
        provider = external.ExternalProvider(
            manifest_record=manifest_for("injecting"),
            channel=external.HttpChannel(
                HttpTransport(
                    base_url="http://127.0.0.1:8770",
                    timeout_ms=100,
                    headers={"Authorization": "Bearer ${VALKAMA_TEST_INJECTED_TOKEN}"},
                )
            ),
        )
        with mock.patch.dict(os.environ, {"VALKAMA_TEST_INJECTED_TOKEN": "abc\r\nX-Injected: 1"}):
            state, _ = provider.health()
        self.assertEqual("unavailable", state)


if __name__ == "__main__":
    unittest.main()
