"""What the doctor says, and whether it is worth acting on.

Every check here exists because the failure it names has actually happened, so
these cases are mostly about the shape of the answer rather than the plumbing: a
status a script can branch on, and a fix a person can follow without reading
source.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import cli, processes, store
from server.executions import service as execution_service
from server.ops import configuration, doctor, setup
from server.planning import service as planning
from tests import SUITE_STORE


def checks_of(report: dict) -> list[dict]:
    """Every check in the report, in level order.

    The report answers in levels, so a test that wants all of them flattens
    rather than reading a second flat copy that could disagree with the first.
    """

    return [check for level in report["levels"] for check in level["checks"]]


class DoctorShapeTests(unittest.TestCase):
    def test_every_check_has_a_stable_ui_presentation(self) -> None:
        report = doctor.diagnose(probe=False)
        self.assertTrue(report["checked_at"].endswith("Z"))
        for check in checks_of(report):
            with self.subTest(check=check["id"]):
                self.assertTrue(check["presentation"]["code"])
                self.assertIsInstance(check["presentation"]["parameters"], dict)

    def test_every_check_that_is_not_ok_says_what_to_do(self) -> None:
        # §19.4: an actionable fix, not only a red status. A check that cannot
        # say what to do makes somebody read source at the worst moment.
        report = doctor.diagnose(probe=False)
        for check in checks_of(report):
            with self.subTest(check=check["id"]):
                self.assertIn(check["status"], doctor.STATUSES)
                self.assertTrue(check["detail"], check["id"])
                if check["status"] in ("fail", "warn"):
                    self.assertTrue(check["fix"], f"{check['id']} has no fix")

    def test_the_whole_installation_is_judged_by_its_worst_check(self) -> None:
        # Nine greens and one failure is a failure, not 90%.
        report = doctor.diagnose(probe=False)
        worst = (
            "fail"
            if report["summary"]["fail"]
            else "warn"
            if report["summary"]["warn"]
            else "unknown"
            if report["summary"]["unknown"]
            else "ok"
        )
        self.assertEqual(worst, report["status"])

    def test_the_rendering_puts_the_worst_first_inside_a_level(self) -> None:
        rendered = doctor.render(
            {
                "status": "fail",
                "levels": [
                    {
                        "id": "installation",
                        "title": "Installation",
                        "status": "fail",
                        "checks": [
                            {"id": "a", "title": "Fine", "status": "ok", "detail": "d", "fix": ""},
                            {
                                "id": "b",
                                "title": "Broken",
                                "status": "fail",
                                "detail": "d",
                                "fix": "do it",
                            },
                        ],
                    }
                ],
            }
        )
        self.assertLess(rendered.index("Broken"), rendered.index("Fine"))
        self.assertIn("fix: do it", rendered)

    def test_the_levels_keep_their_order_even_when_the_last_one_is_the_red_one(self) -> None:
        """Worst-first is right inside a level and wrong across them.

        The order is causal: a store that cannot be opened makes every
        capability underneath it unknowable. Sorting the levels by severity
        would put the symptom above the cause and invite somebody to start at
        the end.
        """

        rendered = doctor.render(
            {
                "status": "fail",
                "levels": [
                    {"id": "installation", "title": "Installation", "status": "ok", "checks": []},
                    {
                        "id": "connections",
                        "title": "Connections",
                        "status": "fail",
                        "checks": [
                            {
                                "id": "c",
                                "title": "Adapter",
                                "status": "fail",
                                "detail": "d",
                                "fix": "f",
                            }
                        ],
                    },
                ],
            }
        )
        self.assertLess(rendered.index("Installation"), rendered.index("Connections"))

    def test_every_check_belongs_to_exactly_one_level(self) -> None:
        # A group no level names would not appear at all, and a diagnostic that
        # silently stops asking a question looks like one that asked and passed.
        report = doctor.diagnose(probe=False)
        self.assertEqual(
            [identifier for identifier, _, _ in doctor.LEVELS],
            [level["id"] for level in report["levels"]],
        )
        every = checks_of(report)
        self.assertEqual(len(every), len({id(check) for check in every}))
        self.assertEqual(len(every), sum(report["summary"].values()))

    def test_a_level_is_judged_by_its_worst_check_and_an_empty_one_answers_nothing(self) -> None:
        self.assertEqual("ok", doctor.worst_of([{"status": "ok"}, {"status": "ok"}]))
        self.assertEqual("warn", doctor.worst_of([{"status": "ok"}, {"status": "warn"}]))
        self.assertEqual("fail", doctor.worst_of([{"status": "warn"}, {"status": "fail"}]))
        # Nothing was asked, so nothing passed.
        self.assertEqual("unknown", doctor.worst_of([]))


class DoctorListenerTests(unittest.TestCase):
    """The check that would have caught a stale listener twice over."""

    def test_a_listener_serving_another_build_is_a_failure_with_a_fix(self) -> None:
        class Answer:
            def read(self, _limit):
                return json.dumps({"identity": "another-build"}).encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        with mock.patch("server.ops.doctor.request.urlopen", return_value=Answer()):
            check = doctor._listener_check(8642, {"identity": "this-checkout"})
        self.assertEqual("fail", check["status"])
        # The consequence is what makes it worth acting on: a green screenshot
        # against a stale listener proves the bundle the build replaced.
        self.assertIn("replaced", check["fix"])

    def test_nothing_listening_is_a_warning_naming_the_command(self) -> None:
        with mock.patch("server.ops.doctor.request.urlopen", side_effect=OSError("refused")):
            check = doctor._listener_check(8642, {"identity": "this-checkout"})
        self.assertEqual("warn", check["status"])
        self.assertIn("serve --port 8642", check["fix"])

    def test_a_matching_identity_passes(self) -> None:
        class Answer:
            def read(self, _limit):
                return json.dumps({"identity": "this-checkout"}).encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        with mock.patch("server.ops.doctor.request.urlopen", return_value=Answer()):
            check = doctor._listener_check(8642, {"identity": "this-checkout"})
        self.assertEqual("ok", check["status"])


class DoctorStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        os.environ["VALKAMA_DB"] = os.path.join(self._dir.name, "test.sqlite3")
        self.addCleanup(lambda: os.environ.__setitem__("VALKAMA_DB", SUITE_STORE))
        self.conn = store.connect()
        planning.create_planning_space(self.conn, project_id="test", name="Test", key="TST")
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()

    def test_an_attempt_with_no_end_is_reported_with_what_closes_it(self) -> None:
        record = planning.create_work_item(self.conn, space="TST", title="left open", state="todo")
        self.conn.commit()
        execution_service.open_execution(
            self.conn,
            execution_id=execution_service.new_execution_id(),
            work_item_id=str(record["work_item_id"]),
            project_id="test",
            packet={
                "client": "claude",
                "role": "executor",
                "environment": "workdir",
                "expected_effect": "change_required",
            },
        )
        self.conn.commit()

        check = doctor._open_execution_check()
        self.assertEqual("warn", check["status"])
        self.assertIn("1 attempt", check["detail"])
        self.assertIn("closes attempts", check["fix"])

    def test_a_store_with_no_open_attempt_passes(self) -> None:
        self.assertEqual("ok", doctor._open_execution_check()["status"])


class DoctorCommandTests(unittest.TestCase):
    def test_the_command_prints_a_report_and_exits_zero_on_a_warning(self) -> None:
        # A warning is not a failure: an unconfigured optional source is what a
        # normal installation looks like, and a doctor that exits non-zero for
        # one is a doctor nobody puts in a script.
        report = {"status": "warn", "levels": [], "summary": {}}
        with mock.patch("server.ops.doctor.diagnose", return_value=report):
            cli.main(["doctor", "--no-probe"])

    def test_a_failure_exits_non_zero_so_a_script_can_branch(self) -> None:
        report = {"status": "fail", "levels": [], "summary": {}}
        with mock.patch("server.ops.doctor.diagnose", return_value=report):
            with self.assertRaises(SystemExit) as raised:
                cli.main(["doctor"])
        self.assertEqual(1, raised.exception.code)


class DoctorConfigurationTests(unittest.TestCase):
    """§19.4 lists missing secrets among what a doctor checks.

    An unresolved reference is one: the value is not blank, it is text that
    looks like a path and is not. Nothing else in the product would notice —
    a store path of `${VALKAMA_DB_PATH}` is a filename SQLite will create.
    """

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.path = os.path.join(self._dir.name, "config.json")
        patch = mock.patch.object(configuration, "config_path", return_value=self.path)
        patch.start()
        self.addCleanup(patch.stop)

    def write(self, content: str) -> None:
        pathlib.Path(self.path).write_text(content, encoding="utf-8", newline="\n")

    def check(self) -> dict:
        return next(
            item
            for item in checks_of(doctor.diagnose(probe=False))
            if item["id"] == "configuration"
        )

    def test_no_file_is_a_pass_that_says_which_layers_are_in_play(self) -> None:
        answer = self.check()
        self.assertEqual("ok", answer["status"])
        self.assertIn("defaults and environment only", answer["detail"])

    def test_a_file_that_cannot_be_read_is_a_failure_with_a_way_out(self) -> None:
        self.write("{ not json")
        answer = self.check()
        self.assertEqual("fail", answer["status"])
        self.assertIn("valid JSON", answer["detail"])
        self.assertTrue(answer["fix"].strip())

    def test_an_unresolved_reference_is_a_failure_naming_the_setting(self) -> None:
        self.write(json.dumps({"store": "${VALKAMA_STORE_PATH}"}))
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("VALKAMA_STORE_PATH", None)
            os.environ.pop("VALKAMA_DB", None)
            answer = self.check()
        self.assertEqual("fail", answer["status"])
        self.assertIn("store", answer["detail"])
        self.assertIn("VALKAMA_STORE_PATH", answer["detail"])

    def test_a_resolved_file_passes_and_names_what_it_sets(self) -> None:
        self.write(json.dumps({"document_roots": "C:/docs"}))
        answer = self.check()
        self.assertEqual("ok", answer["status"])
        self.assertIn("document_roots", answer["detail"])


class SetupTests(unittest.TestCase):
    """What an installation needs, judged against the stable launcher.

    Nothing here edits a client's configuration file. Both clients own their
    registration through their own CLI, so this reads through them and writes
    through them — and the default run writes nothing at all.
    """

    def setUp(self) -> None:
        self.launcher_command = str(
            (pathlib.Path(tempfile.gettempdir()) / "Valkama" / "bin" / "valkama.cmd").resolve()
        )

    def result(self, stdout: str = "", *, returncode: int = 0, stderr: str = ""):
        return processes.TextResult(returncode=returncode, stdout=stdout, stderr=stderr)

    def launcher_state(self, **changes) -> dict:
        state = {
            "state": "installed",
            "command": self.launcher_command,
            "args": ["mcp"],
            "source_script": setup.entry_point_path(),
            "detail": None,
        }
        state.update(changes)
        return state

    def environment(self, client: str) -> dict[str, str]:
        return dict(setup.CLIENT_ENVIRONMENTS[client])

    def codex_listing(
        self,
        command: str,
        *,
        args: list[str] | None = None,
        environment: dict[str, str] | None = None,
    ) -> str:
        return json.dumps(
            [
                {
                    "name": "other",
                    "transport": {
                        "type": "stdio",
                        "command": "elsewhere",
                        "args": ["elsewhere.py"],
                    },
                },
                {
                    "name": "valkama",
                    "transport": {
                        "type": "stdio",
                        "command": command,
                        "args": args if args is not None else ["mcp"],
                        "env": environment
                        if environment is not None
                        else self.environment("codex"),
                    },
                },
            ]
        )

    def claude_listing(
        self,
        command: str,
        *,
        args: str = "mcp",
        environment: dict[str, str] | None = None,
        scope: str = "User config (available in all your projects)",
    ) -> str:
        values = environment if environment is not None else self.environment("claude")
        rendered_environment = "\n".join(f"    {key}={value}" for key, value in values.items())
        return (
            "valkama:\n"
            f"  Scope: {scope}\n"
            "  Status: Connected\n"
            "  Type: stdio\n"
            f"  Command: {command}\n"
            f"  Args: {args}\n"
            "  Environment:\n"
            f"{rendered_environment}\n"
        )

    def inspect(self, answers: dict, *, launcher_state: dict | None = None) -> dict:
        def runner(argv):
            client = pathlib.Path(argv[0]).stem.casefold()
            return answers.get(client, self.result(returncode=1, stderr="unexpected"))

        with (
            mock.patch.object(setup, "_tool", side_effect=lambda name: f"C:/bin/{name}.exe"),
            mock.patch.object(
                setup.launcher, "status", return_value=launcher_state or self.launcher_state()
            ),
        ):
            return setup.inspect(runner=runner)

    def finding(self, reading: dict, identifier: str) -> dict:
        return next(item for item in reading["findings"] if item["id"] == identifier)

    def test_a_registration_naming_the_stable_launcher_passes_through_escaped_json(self) -> None:
        """The live run's false finding, kept as a case.

        `codex mcp list --json` escapes every backslash, so searching the raw
        output for the launcher path and normalising the separator turned
        `C:\\Users` into `C://Users` and matched nothing. It reported a correct
        registration as pointing somewhere else — confident, specific, wrong.
        """

        reading = self.inspect(
            {
                "codex": self.result(self.codex_listing(self.launcher_command)),
                "claude": self.result(self.claude_listing(self.launcher_command)),
            }
        )
        self.assertEqual("ok", self.finding(reading, "launcher")["status"])
        self.assertEqual("ok", self.finding(reading, "codex")["status"])
        self.assertEqual("ok", self.finding(reading, "claude")["status"])
        self.assertEqual([], reading["commands"])

    def test_a_checkout_registration_is_replaced_instead_of_added_over(self) -> None:
        # Absent is easy to notice. This one is not, and the product has
        # shipped it: a rename left the tray looking beside the wrong module.
        old_entry = "D:/elsewhere/valkama.py"
        python = "C:/Python/python.exe"
        reading = self.inspect(
            {
                "codex": self.result(
                    self.codex_listing(
                        python,
                        args=[old_entry, "mcp"],
                        environment={"VALKAMA_AUTHOR": "codex"},
                    )
                ),
                "claude": self.result(
                    self.claude_listing(
                        python,
                        args=f"{old_entry} mcp",
                        environment={"VALKAMA_AUTHOR": "claude"},
                    )
                ),
            }
        )
        codex = self.finding(reading, "codex")
        claude = self.finding(reading, "claude")
        self.assertEqual("fail", codex["status"])
        self.assertEqual("fail", reading["status"])
        self.assertEqual(["codex", "mcp", "remove", "valkama"], codex["commands"][0])
        self.assertEqual(["claude", "mcp", "remove", "valkama"], claude["commands"][0])
        self.assertEqual(self.launcher_command, codex["commands"][1][-2])
        self.assertEqual(self.launcher_command, claude["commands"][1][-2])
        self.assertNotIn(old_entry, [part for command in reading["commands"] for part in command])

    def test_no_registration_proposes_the_exact_command(self) -> None:
        reading = self.inspect(
            {
                "codex": self.result("[]"),
                "claude": self.result(returncode=1, stderr="No MCP server found"),
            }
        )
        codex = self.finding(reading, "codex")
        self.assertEqual("warn", codex["status"])
        self.assertEqual(["codex", "mcp", "add"], codex["command"][:3])
        self.assertEqual(self.launcher_command, codex["command"][-2])
        for key, value in setup.CLIENT_ENVIRONMENTS["codex"]:
            self.assertIn(f"{key}={value}", codex["command"])
        claude = self.finding(reading, "claude")
        self.assertEqual(["claude", "mcp", "add", "valkama"], claude["command"][:4])
        self.assertIn("user", claude["command"])
        self.assertEqual(self.launcher_command, claude["command"][-2])
        for key, value in setup.CLIENT_ENVIRONMENTS["claude"]:
            self.assertIn(f"{key}={value}", claude["command"])

    def test_missing_launcher_is_reported_and_installed_before_client_changes(self) -> None:
        missing = self.launcher_state(state="missing", source_script=None)
        reading = self.inspect(
            {"codex": self.result("[]"), "claude": self.result("No MCP server found")},
            launcher_state=missing,
        )
        finding = self.finding(reading, "launcher")
        self.assertEqual("warn", finding["status"])
        self.assertEqual(
            [sys.executable, setup.entry_point_path(), "launcher", "install"], finding["command"]
        )
        self.assertEqual(finding["command"], reading["commands"][0])

    def test_launcher_for_an_old_checkout_is_reinstalled(self) -> None:
        reading = self.inspect(
            {
                "codex": self.result(self.codex_listing(self.launcher_command)),
                "claude": self.result(self.claude_listing(self.launcher_command)),
            },
            launcher_state=self.launcher_state(source_script="D:/old/valkama.py"),
        )
        finding = self.finding(reading, "launcher")
        self.assertEqual("fail", finding["status"])
        self.assertEqual(
            [sys.executable, setup.entry_point_path(), "launcher", "install"], finding["command"]
        )

    def test_missing_utf8_environment_replaces_an_otherwise_stable_registration(self) -> None:
        reading = self.inspect(
            {
                "codex": self.result(
                    self.codex_listing(
                        self.launcher_command,
                        environment={"VALKAMA_AUTHOR": "codex"},
                    )
                ),
                "claude": self.result(self.claude_listing(self.launcher_command)),
            }
        )
        codex = self.finding(reading, "codex")
        self.assertEqual("fail", codex["status"])
        self.assertIn("PYTHONUTF8", codex["detail"])
        self.assertEqual("remove", codex["commands"][0][2])
        self.assertEqual("add", codex["commands"][1][2])

    def test_a_client_that_is_not_installed_is_unknown_rather_than_a_failure(self) -> None:
        with (
            mock.patch.object(
                setup, "_tool", side_effect=lambda name: "" if name == "codex" else f"C:/bin/{name}"
            ),
            mock.patch.object(setup.launcher, "status", return_value=self.launcher_state()),
        ):
            reading = setup.inspect(
                runner=lambda _argv: self.result(self.claude_listing(self.launcher_command))
            )
        self.assertEqual("unknown", self.finding(reading, "codex")["status"])
        self.assertEqual([], self.finding(reading, "codex")["command"])

    def test_a_client_that_cannot_answer_is_a_warning_carrying_its_own_words(self) -> None:
        reading = self.inspect(
            {
                "codex": self.result(returncode=1, stderr="config.toml is malformed"),
                "claude": self.result(self.claude_listing(self.launcher_command)),
            }
        )
        codex = self.finding(reading, "codex")
        self.assertEqual("warn", codex["status"])
        self.assertIn("config.toml is malformed", codex["detail"])

    def test_the_default_run_changes_nothing(self) -> None:
        """The rule the whole command is built around.

        §19.3 asks for a configuration diff and for a tool never to be trusted
        without confirmation, and both come down to this.
        """

        reading = self.inspect(
            {"codex": self.result("[]"), "claude": self.result("No MCP server found")}
        )
        self.assertTrue(reading["commands"])
        rendered = setup.render(reading)
        self.assertIn("Nothing was changed", rendered)
        self.assertIn("--apply", rendered)

    def test_apply_runs_what_was_shown_and_nothing_else(self) -> None:
        reading = self.inspect(
            {"codex": self.result("[]"), "claude": self.result("No MCP server found")}
        )
        ran = []

        def runner(argv):
            ran.append(list(argv))
            return self.result("Added valkama")

        with (
            mock.patch.object(setup, "_tool", side_effect=lambda name: f"C:/bin/{name}.exe"),
            mock.patch.object(setup.launcher, "status", return_value=self.launcher_state()),
        ):
            applied = setup.apply(reading, runner=runner)
        self.assertEqual(2, applied["changed"])
        self.assertEqual("ok", applied["launcher_verification"]["status"])
        self.assertEqual(len(reading["commands"]), len(ran))
        for command, argv in zip(reading["commands"], ran, strict=True):
            self.assertEqual([str(part) for part in command[1:]], argv[1:])

    def test_apply_does_not_replace_clients_when_launcher_verification_fails(self) -> None:
        missing = self.launcher_state(state="missing", source_script=None)
        reading = self.inspect(
            {"codex": self.result("[]"), "claude": self.result("No MCP server found")},
            launcher_state=missing,
        )
        ran = []

        def runner(argv):
            ran.append(list(argv))
            return self.result(returncode=1, stderr="launcher install failed")

        with (
            mock.patch.object(setup, "_tool", side_effect=lambda name: f"C:/bin/{name}.exe"),
            mock.patch.object(setup.launcher, "status", return_value=missing),
        ):
            applied = setup.apply(reading, runner=runner)
        self.assertEqual(1, len(ran), "only the launcher install may run before verification")
        self.assertEqual(0, applied["changed"])
        skipped = [item for item in applied["applied"] if item["returncode"] == 126]
        self.assertEqual(2, len(skipped))
        self.assertTrue(all("not run" in item["detail"] for item in skipped))


if __name__ == "__main__":
    unittest.main()
