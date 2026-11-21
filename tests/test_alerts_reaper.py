"""What a launch from Valkama owes the owner when it ends: the listener's reaper tells them.

No agent's call is bound here, because the listener's own thread writes, so this is
the one way a failed launch reaches the owner. A launch that delivered moves nothing:
the agent it ran moves its work into review, and that move raises its own toast. A
launch runs against the harness's client that never runs, and the executor is replaced.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
from pathlib import Path
from unittest import mock

from server import http_surface, runner, watchers
from server.alerts import emit
from server.alerts import settings as alert_settings
from server.executions import lifecycle as executions
from server.ops import toast
from server.planning import service as planning
from tests import test_executions


class ReaperHarness(test_executions.LaunchHarness):
    def setUp(self) -> None:
        super().setUp()
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.log = Path(directory.name, "valkama-alerts.log")
        self.shown: list[dict] = []
        self.asked: list[tuple[str, bool]] = []
        self.process_of: dict[str, object] = {}
        for patch in (
            mock.patch.object(toast, "active", return_value=True),
            mock.patch.object(toast, "log_path", return_value=str(self.log)),
            mock.patch.object(toast, "logo_uri", return_value=None),
            mock.patch.object(toast, "show", side_effect=self.shown.append),
            mock.patch.object(toast, "remove"),
            mock.patch.object(emit, "listener_sees", side_effect=self._sees),
            mock.patch.object(emit, "EMITTER", emit.Emitter(window=60.0)),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        alert_settings.write(self.conn, {"locale": "en"})

    def _sees(self, work_item_id: str, *, question: bool) -> bool:
        self.asked.append((work_item_id, question))
        return False

    def launch(self, title: str = "launch me") -> str:
        reference = self.item(title)
        executions.launch_work_item(self.conn, self.packet(reference))
        self.process_of[reference] = self.processes[-1]
        return reference

    def finish(self, reference: str, *, delivered: bool = True, code: int = 0) -> None:
        if delivered:
            runner.RUNNER._running[reference].capture.append(
                json.dumps(
                    {
                        "structured_output": {
                            "outcome": "complete",
                            "expected_effect": "change_required",
                            "delivery": "owned change",
                            "oracle": "focused tests passed",
                            "unresolved": "none",
                        }
                    }
                )
            )
        self.process_of[reference].code = code

    def reap(self) -> None:
        """One pass, as the loop makes it, with its window ended at once."""

        emit.after_reap(self.conn, watchers.reap_finished_launches(self.conn))
        emit.EMITTER.flush(5)

    def state(self, reference: str) -> str:
        return str(planning.get_work_item(self.conn, reference)["state"]["key"])


class ADeliveredLaunchTests(ReaperHarness):
    def test_a_launch_that_delivered_moves_nothing_and_is_nothing(self) -> None:
        # The launched agent moves its work into review, with what the owner is to
        # check; the launch's end moves nothing and owes no review toast.
        reference = self.launch()
        self.finish(reference)
        self.reap()
        self.assertEqual("dev", self.state(reference))
        self.assertEqual([], self.shown)

    def test_a_delivery_is_nothing_with_every_alert_turned_on(self) -> None:
        alert_settings.write(
            self.conn, {"locale": "en", "events": {"review": True, "launchFailed": True}}
        )
        reference = self.launch()
        self.finish(reference)
        self.reap()
        self.assertEqual([], self.shown)


class AFailedLaunchTests(ReaperHarness):
    def fail(self) -> str:
        reference = self.launch("it fails")
        self.finish(reference, delivered=False, code=1)
        return reference

    def test_off_by_default_a_failed_launch_is_nothing(self) -> None:
        self.fail()
        self.reap()
        self.assertEqual([], self.shown)

    def test_a_launch_stopped_by_the_owner_is_nothing(self) -> None:
        alert_settings.write(self.conn, {"locale": "en", "events": {"launchFailed": True}})
        reference = self.launch("stop me")
        executions.stop_work_item(self.conn, reference)
        self.conn.commit()
        self.reap()
        self.assertEqual([], self.shown)

    def test_turned_on_a_failed_launch_is_one_toast(self) -> None:
        alert_settings.write(self.conn, {"locale": "en", "events": {"launchFailed": True}})
        reference = self.fail()
        self.reap()
        (message,) = self.shown
        self.assertEqual(reference, message["tag"])
        self.assertIn("launch failed", message["xml"])

    def test_turned_on_a_second_pass_is_nothing(self) -> None:
        alert_settings.write(self.conn, {"locale": "en", "events": {"launchFailed": True}})
        self.fail()
        self.reap()
        self.shown.clear()
        self.reap()
        self.assertEqual([], self.shown)

    def test_alerts_turned_off_win_over_the_event(self) -> None:
        alert_settings.write(self.conn, {"enabled": False, "events": {"launchFailed": True}})
        self.fail()
        self.reap()
        self.assertEqual([], self.shown)


class TheLoopTests(ReaperHarness):
    def run_loop(self, registry: watchers.Watchers, **options: object) -> None:
        """The loop on a connection of its own to this test's store, as the listener's is."""

        registry.run(interval=0, **options)

    def test_the_loop_tells_the_owner_about_the_launch_it_reaped(self) -> None:
        alert_settings.write(self.conn, {"locale": "en", "events": {"launchFailed": True}})
        reference = self.launch()
        self.finish(reference, delivered=False, code=1)
        self.run_loop(watchers.Watchers(), cycles=5)
        emit.EMITTER.flush(5)
        self.assertEqual([reference], [message["tag"] for message in self.shown])

    def test_a_second_listener_tells_nobody(self) -> None:
        alert_settings.write(self.conn, {"locale": "en", "events": {"launchFailed": True}})
        reference = self.launch()
        self.finish(reference, delivered=False, code=1)
        self.run_loop(watchers.Watchers(), cycles=5, alerts=False)
        emit.EMITTER.flush(5)
        self.assertIn(
            "outcome=",
            planning.get_work_item(self.conn, reference)["comments"][-1]["body"],
            "it still reaps",
        )
        self.assertEqual([], self.shown)

    def test_a_failing_alert_does_not_stop_the_loop_or_the_streams(self) -> None:
        reference = self.launch()
        self.finish(reference)
        registry = watchers.Watchers()
        stream = registry.subscribe()
        reaps: list[int] = []
        real = watchers.reap_finished_launches

        def counted(conn: object) -> list[dict]:
            reaps.append(1)
            return real(conn)

        with (
            mock.patch.object(watchers, "reap_finished_launches", side_effect=counted),
            mock.patch.object(emit, "after_reap", side_effect=RuntimeError("broken")),
            contextlib.redirect_stderr(io.StringIO()) as reported,
        ):
            self.run_loop(registry, cycles=10)

        self.assertEqual(2, len(reaps), "the next cycle ran, so the loop outlived the failure")
        self.assertIn("broken", reported.getvalue(), "and the failure was said")
        self.assertEqual("changed", stream.get_nowait(), "the streams still heard of the launch")

    def test_a_failure_while_deciding_is_a_log_line(self) -> None:
        reference = self.launch()
        self.finish(reference)
        ended = watchers.reap_finished_launches(self.conn)
        with mock.patch.object(emit, "_reap_dues", side_effect=RuntimeError("broken")):
            emit.after_reap(self.conn, ended)
        self.assertIn("alert not decided after a launch", self.log.read_text(encoding="utf-8"))
        self.assertEqual([], self.shown)

    def test_switched_off_nothing_is_read(self) -> None:
        with (
            mock.patch.object(toast, "active", return_value=False),
            mock.patch.object(emit, "_reap_dues", side_effect=AssertionError("read")),
        ):
            emit.after_reap(self.conn, [{"reference": "TST-1"}])


class WhichListenerTests(ReaperHarness):
    """`serve_main` hands the reaper and the usage reader, which raises the quota alerts,
    their answer from the port it really holds."""

    def served_with(self, *, port: int, expected: str) -> tuple[bool, bool]:
        server = mock.Mock(server_port=port)
        started: list[dict] = []
        usage = mock.Mock()

        def thread(**options: object) -> mock.Mock:
            started.append(options)
            return mock.Mock()

        with (
            mock.patch.dict(os.environ, {"VALKAMA_PORT": expected}),
            mock.patch.object(http_surface, "PlatformHTTPServer", return_value=server),
            mock.patch.object(http_surface.threading, "Thread", side_effect=thread),
            mock.patch.object(http_surface.housekeeping, "start_up", return_value=[]),
            mock.patch.object(http_surface.housekeeping, "start_transcript_sweep"),
            mock.patch.object(http_surface.housekeeping, "start_planning_sweep"),
            mock.patch.object(http_surface.housekeeping, "start_pulse"),
            mock.patch.object(http_surface.housekeeping, "start_usage", usage),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            http_surface.serve_main(port)
        (options,) = started
        self.assertEqual(watchers.WATCHERS.run, options["target"])
        return bool(options["kwargs"]["alerts"]), bool(usage.call_args.kwargs["alerts"])

    def test_the_listener_on_the_expected_port_alerts(self) -> None:
        self.assertEqual((True, True), self.served_with(port=18642, expected="18642"))

    def test_a_listener_on_another_port_does_not(self) -> None:
        self.assertEqual((False, False), self.served_with(port=18643, expected="18642"))
