"""One driver per client, and what that removed.

These tests are about differences that used to be flattened into shared tables:
one effort vocabulary for two clients that do not share one, and one command
line written twice with the copies already drifted apart.
"""

from __future__ import annotations

import json
import unittest

from server.executions import drivers
from server.executions.drivers import claude, contract
from server.improvements import improvements_integration, job_supervisor


class DriverRegistryTests(unittest.TestCase):
    def test_every_client_has_exactly_one_driver(self) -> None:
        self.assertEqual(("claude", "codex"), drivers.CLIENTS)
        for client in drivers.CLIENTS:
            self.assertEqual(client, drivers.capabilities_for(client).client)

    def test_an_unknown_client_is_refused_by_name(self) -> None:
        with self.assertRaises(drivers.DriverError) as raised:
            drivers.driver_for("cursor")
        self.assertIn("claude", str(raised.exception))
        self.assertIn("codex", str(raised.exception))

    def test_capabilities_survive_the_wire_form_intact(self) -> None:
        for capability in drivers.all_capabilities():
            record = capability.as_dict()
            self.assertEqual(list(capability.efforts), record["efforts"])
            self.assertIsInstance(record["mechanical_executor"], bool)


class EffortVocabularyTests(unittest.TestCase):
    """The two clients do not share one, and the shared tuple was wrong for both."""

    def test_each_client_refuses_the_other_clients_highest_setting(self) -> None:
        # `max` is Claude Code's; `minimal` is Codex's. The tuple these replace
        # accepted `max` for Codex, which that client rejects, and refused
        # `minimal`, which it accepts.
        self.assertIn("max", drivers.capabilities_for("claude").efforts)
        self.assertNotIn("max", drivers.capabilities_for("codex").efforts)
        self.assertIn("minimal", drivers.capabilities_for("codex").efforts)
        self.assertNotIn("minimal", drivers.capabilities_for("claude").efforts)

    def test_an_effort_the_client_would_reject_is_refused_here_instead(self) -> None:
        for client, effort in (("codex", "max"), ("claude", "minimal")):
            with self.subTest(client=client, effort=effort):
                with self.assertRaises(drivers.DriverError) as raised:
                    drivers.driver_for(client).argv(
                        contract.CommandRequest(binary=client, prompt="task", effort=effort)
                    )
                self.assertIn(effort, str(raised.exception))


class CommandLineTests(unittest.TestCase):
    def test_codex_always_announces_its_thread_even_with_no_schema(self) -> None:
        # `--json` is what produces `thread.started`, and that line is the only
        # exact identity a Codex attempt can be correlated by. A command line
        # that omits it runs and finishes and leaves nothing to correlate.
        argv = drivers.driver_for("codex").argv(
            contract.CommandRequest(binary="codex", prompt="task")
        )
        self.assertEqual(["codex", "exec", "--json", "task"], argv)

    def test_claude_carries_the_schema_inline_and_codex_by_path(self) -> None:
        schema = {"type": "object"}
        claude = drivers.driver_for("claude").argv(
            contract.CommandRequest(binary="claude", prompt="task", schema=schema)
        )
        self.assertIn("--json-schema", claude)
        self.assertIn('"type":"object"', claude[claude.index("--json-schema") + 1])

        codex = drivers.driver_for("codex").argv(
            contract.CommandRequest(
                binary="codex", prompt="task", schema=schema, schema_path="s.json", result_path="r"
            )
        )
        self.assertEqual("s.json", codex[codex.index("--output-schema") + 1])
        self.assertEqual("r", codex[codex.index("-o") + 1])

    def test_codex_refuses_a_schema_it_was_given_nowhere_to_read(self) -> None:
        with self.assertRaises(drivers.DriverError):
            drivers.driver_for("codex").argv(
                contract.CommandRequest(binary="codex", prompt="task", schema={"type": "object"})
            )

    def test_delegation_is_removed_only_where_the_command_line_can(self) -> None:
        request = contract.CommandRequest(binary="x", prompt="task", no_delegation=True)
        claude = drivers.driver_for("claude").argv(request)
        self.assertEqual("Agent", claude[claude.index("--disallowedTools") + 1])
        # Codex has no such switch. It ignores the request rather than putting
        # the ban in a prompt, where it would be advice dressed as a contract.
        self.assertNotIn("--disallowedTools", drivers.driver_for("codex").argv(request))
        self.assertFalse(drivers.capabilities_for("codex").mechanical_executor)

    def test_resume_needs_an_exact_identity_on_both_clients(self) -> None:
        for client in drivers.CLIENTS:
            with self.subTest(client=client):
                with self.assertRaises(drivers.DriverError):
                    drivers.driver_for(client).argv(
                        contract.CommandRequest(binary=client, prompt="task", resume=True)
                    )

    def test_codex_options_precede_both_positionals_on_a_resume(self) -> None:
        # `codex exec resume <session> <prompt>` reads its positionals in order,
        # so an option after them is taken for one of them.
        argv = drivers.driver_for("codex").argv(
            contract.CommandRequest(
                binary="codex",
                prompt="task",
                model="gpt-5.5-codex",
                effort="high",
                session_id="thread-1",
                resume=True,
            )
        )
        self.assertLess(argv.index("--model"), argv.index("thread-1"))
        self.assertLess(argv.index("-c"), argv.index("thread-1"))
        self.assertLess(argv.index("thread-1"), argv.index("task"))
        self.assertNotIn("--last", argv)


class StdoutDialectTests(unittest.TestCase):
    """Reading a client's stdout is that client's driver's job, not the runner's.

    The runner used to know that `thread.started` carries a Codex thread id and
    that `structured_output` is one of three keys Claude Code may wrap a result
    in — two clients' private words in the module whose charter says it knows
    nothing about either.
    """

    def test_codex_announces_its_identity_and_leaves_the_result_to_its_file(self) -> None:
        reading = drivers.driver_for("codex").read_stdout_event(
            {"type": "thread.started", "thread_id": "thread-7"}
        )
        self.assertEqual("thread-7", reading.session_id)
        self.assertIsNone(reading.result, "codex writes its result where -o pointed")
        quiet = drivers.driver_for("codex").read_stdout_event({"type": "item.completed"})
        self.assertEqual("", quiet.session_id)

    def test_claude_carries_its_result_in_whichever_envelope_key_it_used(self) -> None:
        result = {"outcome": "complete", "expected_effect": "change_required"}
        for key in claude.RESULT_KEYS:
            with self.subTest(key=key):
                reading = drivers.driver_for("claude").read_stdout_event(
                    {"session_id": "abc", key: result}
                )
                self.assertEqual("abc", reading.session_id)
                self.assertEqual(result, reading.result)
        # The same result as text, which is how the client sends it when the
        # field is a string rather than an object.
        wrapped = drivers.driver_for("claude").read_stdout_event({"result": json.dumps(result)})
        self.assertEqual(result, wrapped.result)

    def test_a_wrapped_object_that_is_not_a_delivery_is_not_read_as_one(self) -> None:
        reading = drivers.driver_for("claude").read_stdout_event(
            {"sessionId": "abc", "result": {"usage": {"input_tokens": 10}}}
        )
        self.assertEqual("abc", reading.session_id)
        self.assertIsNone(reading.result)

    def test_a_session_identity_longer_than_an_identity_is_bounded(self) -> None:
        reading = drivers.driver_for("claude").read_stdout_event({"session_id": "x" * 500})
        self.assertEqual(contract.MAX_SESSION_ID_CHARS, len(reading.session_id))


class SecondCopyTests(unittest.TestCase):
    """The analyzer used to carry its own copy of the command line, already drifted."""

    def test_the_analyzer_gets_the_flag_its_private_copy_had_dropped(self) -> None:
        argv = improvements_integration.analyzer_client_argv("codex", "prompt", binary="codex")
        self.assertIn("--json", argv)

    def test_the_analyzer_refuses_an_effort_through_the_same_driver(self) -> None:
        with self.assertRaises(job_supervisor.JobError) as raised:
            improvements_integration.analyzer_client_argv(
                "codex", "prompt", effort="max", binary="codex"
            )
        self.assertIn("max", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
