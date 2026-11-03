"""What a launch from Valkama owes the owner when it ends: the listener's reaper tells them.

No agent's call is bound here, because the listener's own thread writes, so this is
the one way a move to review or a failure reaches the owner. A launch runs against
the harness's client that never runs, and the executor is replaced.
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
from server.alerts import emit, messages
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


class ReviewAfterALaunch(ReaperHarness):
    def test_a_launch_that_moved_its_item_to_review_is_one_toast(self) -> None:
        reference = self.launch()
        self.finish(reference)
        self.reap()

        self.assertEqual("review", self.state(reference))
        (message,) = self.shown
        self.assertEqual(reference, message["tag"])
        self.assertIn("ready for review", message["xml"])
        self.assertIn(f"valkama://open/{reference}", message["xml"])
        item_id = str(planning.get_work_item(self.conn, reference)["work_item_id"])
        self.assertEqual([(item_id, False)], self.asked, "only its card silences a review")

    def test_a_second_pass_over_the_same_launch_is_nothing(self) -> None:
        reference = self.launch()
        self.finish(reference)
        self.reap()
        self.shown.clear()
        self.reap()
        self.assertEqual([], self.shown)

    def test_a_launch_that_changed_nothing_is_nothing(self) -> None:
        reference = self.launch()
        self.finish(reference, delivered=False)
        self.reap()
        self.assertEqual("dev", self.state(reference), "the item did not move")
        self.assertEqual([], self.shown)

    def test_an_item_already_moved_out_of_active_is_nothing(self) -> None:
        reference = self.launch()
        planning.transition_work_item(self.conn, reference, "review", author="agent")
        self.conn.commit()
        self.finish(reference)
        self.reap()
        self.assertEqual([], self.shown, "whoever moved it was the one to raise it")

    def test_a_guard_that_refuses_the_move_is_nothing(self) -> None:
        reference = self.launch()
        self.finish(reference)
        with mock.patch.object(
            executions.planning_service,
            "transition_work_item",
            side_effect=executions.planning_model.WorkflowGuardError("no"),
        ):
            self.reap()
        self.assertEqual("dev", self.state(reference))
        self.assertEqual([], self.shown)

    def test_review_turned_off_is_nothing(self) -> None:
        alert_settings.write(self.conn, {"events": {"review": False}})
        reference = self.launch()
        self.finish(reference)
        self.reap()
        self.assertEqual("review", self.state(reference), "the move itself still happened")
        self.assertEqual([], self.shown)

    def test_two_launches_ending_in_one_pass_are_one_summary(self) -> None:
        first, second = self.launch("first"), self.launch("second")
        self.finish(first)
        self.finish(second)
        self.reap()
        self.assertEqual(["review", "review"], [self.state(first), self.state(second)])
        (message,) = self.shown
        self.assertEqual(messages.SUMMARY_TAG, message["tag"])
        self.assertIn(first, message["xml"])
        self.assertIn(second, message["xml"])


class AFailedLaunch(ReaperHarness):
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


class TheLoop(ReaperHarness):
    def run_loop(self, registry: watchers.Watchers, **options: object) -> None:
        """The loop on this test's connection: its own stays open by design, for its life."""

        with mock.patch.object(watchers, "connect", return_value=self.conn):
            registry.run(interval=0, **options)

    def test_the_loop_tells_the_owner_about_the_launch_it_reaped(self) -> None:
        reference = self.launch()
        self.finish(reference)
        self.run_loop(watchers.Watchers(), cycles=5)
        emit.EMITTER.flush(5)
        self.assertEqual([reference], [message["tag"] for message in self.shown])

    def test_a_second_listener_tells_nobody(self) -> None:
        reference = self.launch()
        self.finish(reference)
        self.run_loop(watchers.Watchers(), cycles=5, alerts=False)
        emit.EMITTER.flush(5)
        self.assertEqual("review", self.state(reference), "it still reaps")
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


class WhichListener(ReaperHarness):
    """`serve_main` hands the reaper its answer from the port it really holds."""

    def served_with(self, *, port: int, expected: str) -> bool:
        server = mock.Mock(server_port=port)
        started: list[dict] = []

        def thread(**options: object) -> mock.Mock:
            started.append(options)
            return mock.Mock()

        with (
            mock.patch.dict(os.environ, {"VALKAMA_PORT": expected}),
            mock.patch.object(http_surface, "PlatformHTTPServer", return_value=server),
            mock.patch.object(http_surface.threading, "Thread", side_effect=thread),
            mock.patch.object(http_surface.housekeeping, "start_up", return_value=[]),
            mock.patch.object(http_surface.housekeeping, "start_sweep"),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            http_surface.serve_main(port)
        (options,) = started
        self.assertEqual(watchers.WATCHERS.run, options["target"])
        return bool(options["kwargs"]["alerts"])

    def test_the_listener_on_the_expected_port_alerts(self) -> None:
        self.assertTrue(self.served_with(port=18642, expected="18642"))

    def test_a_listener_on_another_port_does_not(self) -> None:
        self.assertFalse(self.served_with(port=18643, expected="18642"))
