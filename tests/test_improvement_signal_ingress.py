from __future__ import annotations

import hashlib
import http.client
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import http_surface, mcp_surface, sessions, store
from server.improvements import api as improvements_api
from server.improvements import (
    contract,
    evaluation_contract,
    improvements,
    improvements_integration,
    sanitization,
    sidecar_schema,
)
from server.planning import service as planning_service
from tests import SUITE_STORE


class ImprovementSignalIngressTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.primary = str(Path(self.tmp.name) / "primary.sqlite3")
        self.old_db = os.environ.get("VALKAMA_DB")
        os.environ["VALKAMA_DB"] = self.primary
        self.conn = store.connect()
        planning_service.create_planning_space(self.conn, project_id="planning", name="Planning")
        self.conn.commit()
        self.runtime = improvements_integration.ImprovementsRuntime()

    def tearDown(self) -> None:
        self.runtime.stop()
        self.conn.close()
        if self.old_db is None:
            os.environ["VALKAMA_DB"] = SUITE_STORE
        else:
            os.environ["VALKAMA_DB"] = self.old_db
        self.tmp.cleanup()

    def enable(self) -> improvements.ImprovementStore:
        store = improvements_integration.resolve_store(self.primary, "personal")
        profile = improvements.default_profile("personal") | {
            "enabled": True,
            "purpose": "Learn from bounded workflow failures",
            "expected_behavior": "Repeated failures stop recurring",
            "planning_space": "PLA",
        }
        store.put_profile(profile, 0)
        return store

    @staticmethod
    def lesson(pointer: str = "memory:lesson:lesson-01", **changes: object) -> dict:
        return {
            "source_kind": "agentmemory_lesson",
            "pointer": pointer,
            "category": "validator-eval",
            "severity": "high",
            "excerpt": "Validator skipped the required rollback check",
        } | changes

    @staticmethod
    def feedback(pointer: str = "feedback:feedback-01", **changes: object) -> dict:
        return {
            "source_kind": "user_feedback",
            "pointer": pointer,
            "category": "validator-eval",
            "severity": "high",
            "excerpt": "Validator skipped the required rollback check",
        } | changes

    def record(self, *signals: dict, scope: str = "personal") -> tuple[int, dict]:
        response = improvements_api.handle_post(
            self.runtime,
            self.primary,
            "/api/modules/improvements/signals",
            {"scope": scope, "signals": list(signals)},
        )
        self.assertIsNotNone(response)
        return response

    def real_session_signal(self, session_id: str, **changes: object) -> dict:
        event = sessions.op_ingest_session_event(
            self.conn,
            {
                "event": "attention",
                "session_id": session_id,
                "client": "codex",
                "status": "failed",
                "detail": {"summary": "bounded"},
            },
        )
        return {
            "source_kind": "session_event",
            "pointer": f"session:{session_id}/event:{event['id']}",
            "category": "validator-eval",
            "severity": "high",
            "excerpt": "Validator skipped the required rollback check",
            "session_id": session_id,
            "client": "codex",
            "event_type": "attention",
        } | changes

    def test_exact_canonical_versions_and_single_http_and_mcp_ingress_surface(self) -> None:
        self.assertEqual("improvements-api", contract.API_VERSION)
        self.assertEqual("improvements-store", contract.STORE_VERSION)
        self.assertEqual("improvements-events", contract.EVENTS_VERSION)
        self.assertEqual("improvements-eval", evaluation_contract.EVAL_PACK_INTERFACE_VERSION)
        # The published catalogue, not one module's list: the tool moved to the
        # module that owns it, and what a client sees is what has to be single.
        names = [item["name"] for item in mcp_surface.catalogue()]
        self.assertEqual(1, names.count("record_improvement_signal"))
        self.assertEqual(
            ["record_improvement_signal"],
            [
                name
                for name in names
                if "improvement" in name and ("signal" in name or "lesson" in name)
            ],
        )
        self.assertIsNone(
            improvements_api.handle_post(
                self.runtime,
                self.primary,
                "/api/modules/improvements/ingest",
                {"scope": "personal", "signals": []},
            )
        )
        self.enable()
        recorded = mcp_surface.call_tool(
            self.conn,
            "record_improvement_signal",
            {"scope": "personal", "signals": [self.feedback()]},
        )
        self.assertEqual(1, recorded["recorded"])

    def test_every_get_and_sse_read_model_has_exact_sanitized_signal_summary(self) -> None:
        self.enable()
        self.record(self.lesson())
        exact_keys = {"total", "source_counts", "session_count", "last_recorded_at"}
        store = improvements_integration.resolve_store(self.primary, "personal")
        payloads = [store.read_model()]
        for path in (
            "/api/modules/improvements/profile",
            "/api/modules/improvements/cases",
            f"/api/modules/improvements/cases/{store.cases()[0]['id']}",
        ):
            response = improvements_api.handle_get(self.primary, path, {"scope": ["personal"]})
            self.assertIsNotNone(response)
            payloads.append(response[1])
        for payload in payloads:
            summary = payload["signal_summary"]
            self.assertEqual(exact_keys, set(summary))
            self.assertEqual(1, summary["total"])
            self.assertEqual(1, summary["source_counts"]["agentmemory_lesson"])
            self.assertNotIn("excerpt", json.dumps(summary))

    def test_unknown_disabled_and_cross_scope_reject_without_sidecar_creation(self) -> None:
        for scope in ("missing", "personal"):
            with self.subTest(scope=scope), self.assertRaises(improvements.ImprovementError):
                self.record(self.feedback(), scope=scope)
            self.assertFalse(Path(self.tmp.name, "primary.modules").exists())
        bound = improvements.ImprovementStore(self.primary, "personal")
        with self.assertRaises(improvements.ImprovementError) as raised:
            bound.record_signal_packet({"scope": "work", "signals": [self.feedback()]})
        self.assertEqual("scope_mismatch", raised.exception.code)
        self.assertFalse(Path(self.tmp.name, "primary.modules").exists())

    def test_packet_count_excerpt_and_private_or_unknown_fields_reject_before_mutation(
        self,
    ) -> None:
        store = self.enable()
        invalid_packets = [
            {"scope": "personal", "signals": [self.feedback()], "sourceIds": ["private"]},
            {"scope": "personal", "signals": [self.feedback(prompt="private")]},
            {"scope": "personal", "signals": [self.feedback(context={"raw": "private"})]},
            {"scope": "personal", "signals": [self.feedback(excerpt="x" * 1201)]},
            {
                "scope": "personal",
                "signals": [self.feedback(pointer=f"feedback:{i}") for i in range(101)],
            },
            {
                "scope": "personal",
                "signals": [self.feedback(excerpt="x" * 1200, client="c" * 15000)],
            },
        ]
        for packet in invalid_packets:
            with self.subTest(keys=list(packet)), self.assertRaises(improvements.ImprovementError):
                store.record_signal_packet(packet)
            self.assertEqual([], store.cases())

    def test_an_attempt_that_did_not_deliver_is_its_own_kind_of_evidence(self) -> None:
        """IMP-002's missing source, which could not exist before layer 2.

        Until an attempt was a durable row it had no stable id to point at, so a
        failure could only reach Improvements as whatever a session hook
        happened to report. The pointer is the attempt's own id, which is what
        makes the evidence checkable: a reader opens the row and sees the
        packet, the outcome and the Git baseline instead of trusting an excerpt.
        """

        store = self.enable()
        signal = {
            "source_kind": "execution_result",
            "pointer": "execution:exec-0f1e2d3c4b5a69788796a5b4c3d2e1f0",
            "category": "validator-eval",
            "severity": "high",
            "excerpt": "The attempt reported partial with no oracle",
        }
        status, result = self.record(signal)
        self.assertEqual(201, status)
        self.assertEqual(1, result["recorded"])

        case = store.case(result["case_ids"][0])
        evidence = case["evidence"][0]
        self.assertEqual("execution_result", evidence["source_kind"])
        # A tool failing and an attempt not delivering are different evidence
        # about the same run, so this never counts as a session.
        self.assertEqual("", evidence["session_id"])
        self.assertEqual(0, store.read_model()["signal_summary"]["session_count"])
        self.assertEqual(
            1, store.read_model()["signal_summary"]["source_counts"]["execution_result"]
        )

    def test_an_execution_pointer_that_is_not_an_attempt_id_is_refused(self) -> None:
        store = self.enable()
        for pointer in (
            "execution:exec-not-hex",
            "execution:EX-264",
            "exec-0f1e2d3c4b5a69788796a5b4c3d2e1f0",
            "execution:exec-0f1e2d3c",
        ):
            with self.subTest(pointer=pointer):
                with self.assertRaises(improvements.ImprovementError):
                    store.record_signal_packet(
                        {
                            "scope": "personal",
                            "signals": [
                                {
                                    "source_kind": "execution_result",
                                    "pointer": pointer,
                                    "category": "validator-eval",
                                    "severity": "high",
                                    "excerpt": "bounded",
                                }
                            ],
                        }
                    )
        self.assertEqual([], store.cases())

    def test_server_redacts_then_hashes_and_idempotency_is_pointer_plus_server_hash(self) -> None:
        store = self.enable()
        raw = "token=supersecret sk-abcdefghijk\x00 validator failed"
        status, result = self.record(self.feedback(excerpt=raw))
        self.assertEqual(201, status)
        self.assertEqual(1, result["recorded"])
        status, duplicate = self.record(self.feedback(excerpt=raw))
        self.assertEqual(200, status)
        self.assertEqual(0, duplicate["recorded"])
        case = store.case(result["case_ids"][0])
        evidence = case["evidence"][0]
        self.assertEqual("user_feedback", evidence["source_kind"])
        self.assertNotIn("supersecret", evidence["excerpt"])
        self.assertNotIn("sk-abcdefghijk", evidence["excerpt"])
        self.assertEqual(
            hashlib.sha256(evidence["excerpt"].encode("utf-8")).hexdigest(),
            evidence["source_hash"],
        )
        self.assertEqual(1, case["signal_count"])
        read_model = store.read_model()
        self.assertEqual(
            {
                "total": 1,
                "source_counts": {
                    "session_event": 0,
                    # An attempt that did not deliver is its own kind of
                    # evidence, and the summary counts every kind the store
                    # knows rather than only the ones that happened.
                    "execution_result": 0,
                    "agentmemory_lesson": 0,
                    "user_feedback": 1,
                },
                "session_count": 0,
            },
            {
                key: read_model["signal_summary"][key]
                for key in ("total", "source_counts", "session_count")
            },
        )
        self.assertIsNotNone(read_model["signal_summary"]["last_recorded_at"])
        self.assertNotIn("excerpt", json.dumps(read_model["signal_summary"]))

    def test_exact_http_post_surface_and_wire_packet_limit(self) -> None:
        store = self.enable()
        server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0),
            http_surface.Handler,
            token_path=Path(self.tmp.name) / "http-signal-token",
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        write_headers = {
            "Content-Type": "application/json",
            "Origin": f"http://127.0.0.1:{server.server_port}",
            "X-Valkama-Session": server.security_context.browser_session_token,
        }
        try:
            client = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            body = json.dumps({"scope": "personal", "signals": [self.feedback()]})
            client.request(
                "POST",
                "/api/modules/improvements/signals",
                body,
                write_headers,
            )
            response = client.getresponse()
            self.assertEqual(201, response.status)
            self.assertEqual("improvements-api", json.loads(response.read())["interface_version"])
            client.request(
                "POST",
                "/api/modules/improvements/ingest",
                body,
                write_headers,
            )
            alias = client.getresponse()
            self.assertEqual(404, alias.status)
            alias.read()
            client.close()
            client = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            oversized = b"{" + b" " * contract.MAX_SIGNAL_PACKET_BYTES + b"}"
            client.request(
                "POST",
                "/api/modules/improvements/signals",
                oversized,
                write_headers,
            )
            rejected = client.getresponse()
            self.assertEqual(413, rejected.status)
            self.assertEqual("request_too_large", json.loads(rejected.read())["error"]["code"])
            self.assertEqual(1, store.signal_summary()["total"])
            client.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_lessons_never_count_as_sessions_and_remain_collecting(self) -> None:
        self.enable()
        status, result = self.record(
            *[self.lesson(f"memory:lesson:{number}") for number in range(3)]
        )
        self.assertEqual(201, status)
        case = improvements_integration.resolve_store(self.primary, "personal").case(
            result["case_ids"][0]
        )
        self.assertEqual("collecting", case["state"])
        self.assertEqual(3, case["signal_count"])
        self.assertEqual(0, case["session_count"])
        self.assertTrue(all(item["session_id"] == "" for item in case["evidence"]))

    def test_only_referenced_real_session_events_contribute_to_promotion(self) -> None:
        self.enable()
        one = self.real_session_signal("real-a")
        two = self.real_session_signal("real-b")
        three = self.real_session_signal("real-a")
        status, result = self.record(one, two, three)
        self.assertEqual(201, status)
        case = improvements_integration.resolve_store(self.primary, "personal").case(
            result["case_ids"][0]
        )
        self.assertEqual("open", case["state"])
        self.assertEqual(2, case["session_count"])
        forged = dict(one, pointer="session:not-real/event:999", session_id="not-real")
        with self.assertRaises(improvements.ImprovementError):
            self.record(forged)
        self.assertEqual(
            3,
            improvements_integration.resolve_store(self.primary, "personal").case(
                result["case_ids"][0]
            )["signal_count"],
        )

    def test_external_agentmemory_failure_never_reaches_kanban_ingress(self) -> None:
        store = self.enable()
        ingress = mock.Mock(wraps=self.runtime.record_signals)

        def external_relay(fetch_lesson):
            lesson = fetch_lesson()
            return ingress(self.primary, {"scope": "personal", "signals": [lesson]})

        with self.assertRaisesRegex(RuntimeError, "AgentMemory unavailable"):
            external_relay(mock.Mock(side_effect=RuntimeError("AgentMemory unavailable")))
        ingress.assert_not_called()
        self.assertEqual([], store.cases())

    def test_packet_is_atomic_and_change_is_published_only_after_commit(self) -> None:
        store = self.enable()
        original = improvements.ImprovementStore._record_signal_tx
        calls = 0

        def fail_second(bound_store, conn, category, evidence, title, **kwargs):
            nonlocal calls
            calls += 1
            result = original(bound_store, conn, category, evidence, title, **kwargs)
            if calls == 2:
                raise RuntimeError("injected packet failure")
            return result

        with mock.patch.object(improvements.ImprovementStore, "_record_signal_tx", fail_second):
            with self.assertRaisesRegex(RuntimeError, "injected packet failure"):
                store.record_signal_packet(
                    {
                        "scope": "personal",
                        "signals": [self.feedback("feedback:a"), self.feedback("feedback:b")],
                    }
                )
        self.assertEqual([], store.cases())
        observed_totals: list[int] = []
        publishing_runtime = improvements_integration.ImprovementsRuntime(
            lambda _message: observed_totals.append(store.signal_summary()["total"])
        )
        try:
            result = improvements_api.handle_post(
                publishing_runtime,
                self.primary,
                "/api/modules/improvements/signals",
                {"scope": "personal", "signals": [self.feedback()]},
            )
            self.assertEqual(201, result[0])
            self.assertEqual([1], observed_totals)
        finally:
            publishing_runtime.stop()

    def test_existing_store_upgrade_takes_verified_backup_and_can_roll_back(self) -> None:
        path = improvements.sidecar_path(self.primary)
        path.parent.mkdir(parents=True)
        conn = sqlite3.connect(path)
        conn.executescript(sidecar_schema.PRE_SIGNAL_SOURCE_SQL + "PRAGMA user_version=1;")
        now = sanitization.utc_now()
        conn.execute(
            "INSERT INTO profile VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "personal",
                1,
                1,
                "p",
                "e",
                "codex",
                "Planning",
                "manual",
                24,
                30,
                20,
                60000,
                now,
                now,
            ),
        )
        conn.execute(
            "INSERT INTO cases(case_key,fingerprint,title,state,severity,category,first_seen,last_seen,created_at,updated_at)"
            " VALUES('legacy','fp','legacy','collecting','high','validator-eval',?,?,?,?)",
            (now, now, now, now),
        )
        conn.execute(
            "INSERT INTO signals(case_id,pointer,at,client,session_id,event_type,severity,excerpt,source_hash,fingerprint,created_at)"
            " VALUES(1,'session:old/event:1',?,'codex','old','attention','high','safe','hash','fp',?)",
            (now, now),
        )
        conn.commit()
        conn.close()
        backup = sidecar_schema.migrate_sidecar(path)
        self.assertIsNotNone(backup)
        backup_conn = sqlite3.connect(backup)
        self.assertEqual("ok", backup_conn.execute("PRAGMA integrity_check").fetchone()[0])
        backup_conn.close()
        upgraded = sqlite3.connect(path)
        self.assertEqual(
            "improvements-store",
            upgraded.execute(
                "SELECT value FROM store_meta WHERE key='interface_version'"
            ).fetchone()[0],
        )
        self.assertEqual(
            "session_event",
            upgraded.execute("SELECT source_kind FROM signals WHERE id=1").fetchone()[0],
        )
        upgraded.close()
        sidecar_schema.restore_sidecar_backup(path, backup)
        restored = sqlite3.connect(path)
        self.assertEqual(1, restored.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual("legacy", restored.execute("SELECT case_key FROM cases").fetchone()[0])
        with self.assertRaises(sqlite3.OperationalError):
            restored.execute("SELECT source_kind FROM signals")
        restored.close()


if __name__ == "__main__":
    unittest.main()
