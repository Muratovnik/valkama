"""One resolution for the public configuration, and what it refuses."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import documents, store
from server.analytics import journal
from server.ops import configuration


class ConfigurationFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.path = os.path.join(self._dir.name, "config.json")

    def write(self, value: object) -> None:
        Path(self.path).write_text(
            value if isinstance(value, str) else json.dumps(value),
            encoding="utf-8",
            newline="\n",
        )

    def test_an_absent_file_is_an_empty_configuration_rather_than_a_failure(self) -> None:
        self.assertEqual({}, configuration.read_file(os.path.join(self._dir.name, "nothing.json")))

    def test_a_malformed_file_is_refused_rather_than_ignored(self) -> None:
        """Ignoring it would let a typo read as "no file at all".

        The owner then watches the product use a default they believe they have
        replaced, which is the one failure a configuration file must not have.
        """

        for content in ("{ not json", '"a string"', "[1, 2]"):
            self.write(content)
            with self.assertRaises(configuration.ConfigurationError):
                configuration.read_file(self.path)

    def test_an_unknown_setting_is_refused_and_named(self) -> None:
        # Named, because the likely cause is a guess at the key rather than a
        # setting that does not exist, and the message is what corrects it.
        self.write({"database": "C:/guessed.sqlite3"})
        with self.assertRaises(configuration.ConfigurationError) as raised:
            configuration.read_file(self.path)
        self.assertIn("database", str(raised.exception))

    def test_a_value_that_is_not_text_is_refused(self) -> None:
        self.write({"store": 5})
        with self.assertRaises(configuration.ConfigurationError):
            configuration.read_file(self.path)

    def test_a_file_larger_than_the_bound_is_refused(self) -> None:
        self.write({"store": "x" * (configuration.MAX_CONFIG_BYTES + 10)})
        with self.assertRaises(configuration.ConfigurationError):
            configuration.read_file(self.path)


class ResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.path = os.path.join(self._dir.name, "config.json")

    def write(self, value: dict) -> None:
        Path(self.path).write_text(json.dumps(value), encoding="utf-8", newline="\n")

    def configured(self, environ: dict) -> str | None:
        return configuration.configured("store", environ=environ, path=self.path)

    def test_the_environment_beats_the_file(self) -> None:
        # Automation and a development shell reach for the environment, and
        # neither should have to edit a file to override one run.
        self.write({"store": "C:/from/file.sqlite3"})
        self.assertEqual(
            "C:/from/env.sqlite3", self.configured({"VALKAMA_DB": "C:/from/env.sqlite3"})
        )
        self.assertEqual("C:/from/file.sqlite3", self.configured({}))

    def test_nothing_set_anywhere_is_nothing_rather_than_a_default(self) -> None:
        # The caller owns its own default. Moving those here would put the
        # store's path in a module the store imports.
        self.assertIsNone(self.configured({}))

    def test_a_reference_resolves_through_the_environment(self) -> None:
        self.write({"store": "${VALKAMA_STORE_PATH}"})
        self.assertEqual(
            "C:/ref.sqlite3", self.configured({"VALKAMA_STORE_PATH": "C:/ref.sqlite3"})
        )

    def test_a_reference_may_carry_its_own_default(self) -> None:
        self.write({"store": "${NOT_SET:-C:/fallback.sqlite3}"})
        self.assertEqual("C:/fallback.sqlite3", self.configured({}))

    def test_an_unresolved_reference_keeps_its_text_and_says_why(self) -> None:
        """Blanking it would be indistinguishable from nobody setting it.

        This is the behaviour the neighbouring tool already has for `.mcp.json`,
        and copying it means one syntax with one failure mode across the two
        files an owner edits.
        """

        self.write({"store": "${VALKAMA_STORE_PATH}"})
        reading = configuration.report({}, environ={}, path=self.path)
        row = next(item for item in reading["settings"] if item["key"] == "store")
        self.assertFalse(row["resolved"])
        self.assertEqual("${VALKAMA_STORE_PATH}", row["value"])
        self.assertIn("VALKAMA_STORE_PATH", row["reason"])

    def test_a_reference_expands_inside_a_larger_value(self) -> None:
        """Anywhere in the value, not only as the whole of it.

        A narrower rule wearing the same syntax would be worse than a different
        one: it reads as familiar and silently leaves `${USERPROFILE}/.claude`
        as a literal path. The neighbouring file's own example is an inline
        reference with a tail after it.
        """

        answer = configuration.resolve_reference(
            "${USERPROFILE}/.claude/projects", environ={"USERPROFILE": "C:/Users/operator"}
        )
        self.assertEqual("C:/Users/operator/.claude/projects", answer["value"])
        self.assertTrue(answer["resolved"])
        self.assertEqual("${USERPROFILE}/.claude/projects", answer["reference"])

    def test_one_unresolved_reference_among_several_is_reported_and_left_alone(self) -> None:
        answer = configuration.resolve_reference("${A}-${B}", environ={"A": "x"})
        self.assertEqual("x-${B}", answer["value"])
        self.assertFalse(answer["resolved"])
        self.assertIn("B", answer["reason"])
        self.assertNotIn("A ", answer["reason"])

    def test_an_inline_reference_may_carry_its_own_default(self) -> None:
        answer = configuration.resolve_reference("${NOT_SET:-fallback}/tail", environ={})
        self.assertEqual("fallback/tail", answer["value"])
        self.assertTrue(answer["resolved"])

    def test_a_literal_is_never_touched_by_the_reference_syntax(self) -> None:
        for literal in ("C:/plain/path.sqlite3", "${incomplete", "$NOT_A_REFERENCE", ""):
            with self.subTest(literal=literal):
                answer = configuration.resolve_reference(literal, environ={})
                self.assertEqual(literal, answer["value"])
                self.assertEqual("", answer["reference"])
                self.assertTrue(answer["resolved"])

    def test_the_report_names_the_layer_and_the_value_actually_in_use(self) -> None:
        self.write({"store": "C:/from/file.sqlite3"})
        reading = configuration.report(
            {"store": "C:/effective.sqlite3"}, environ={}, path=self.path
        )
        self.assertTrue(reading["present"])
        row = next(item for item in reading["settings"] if item["key"] == "store")
        self.assertEqual("file", row["source"])
        self.assertEqual("C:/from/file.sqlite3", row["value"])
        # The effective value comes from the module that owns the setting, so
        # the report can disagree with the file — which is the whole point.
        self.assertEqual("C:/effective.sqlite3", row["effective"])
        self.assertEqual("VALKAMA_DB", row["environment"])

    def test_every_declared_setting_appears_in_the_report(self) -> None:
        reading = configuration.report({}, environ={}, path=self.path)
        self.assertEqual(
            list(configuration.SETTING_KEYS), [item["key"] for item in reading["settings"]]
        )
        for item in reading["settings"]:
            self.assertTrue(item["environment"].strip())
            self.assertTrue(item["description"].strip())

    def test_a_one_shot_safety_switch_is_not_a_setting(self) -> None:
        """A durable file is where a cutover permission must not be able to live."""

        overrides = {item["environment"] for item in configuration.SETTINGS}
        self.assertNotIn("VALKAMA_CUTOVER", overrides)
        self.assertNotIn("VALKAMA_PROTECTED_STORE", overrides)


class ConsumerTests(unittest.TestCase):
    """Every caller reads the one resolution, including the one that did not."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.path = os.path.join(self._dir.name, "config.json")
        Path(self.path).write_text(
            json.dumps(
                {
                    "document_roots": "C:/configured/docs",
                    "claude_session_root": "C:/configured/claude",
                    "codex_rollout_root": "C:/configured/codex",
                }
            ),
            encoding="utf-8",
            newline="\n",
        )
        patch = mock.patch.object(configuration, "config_path", return_value=self.path)
        patch.start()
        self.addCleanup(patch.stop)

    def test_the_registry_is_not_a_public_override(self) -> None:
        self.assertNotIn("projects_registry", configuration.SETTING_KEYS)

    def test_document_roots_and_journal_roots_read_the_same_file(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            for name in (
                "VALKAMA_DOC_ROOTS",
                "VALKAMA_CLAUDE_SESSION_ROOT",
                "VALKAMA_CODEX_ROLLOUT_ROOT",
            ):
                os.environ.pop(name, None)
            self.assertEqual(["C:/configured/docs"], documents.doc_roots())
            provider = journal.LocalJournalUsageProvider()
            self.assertEqual(
                [str(Path("C:/configured/claude")), str(Path("C:/configured/codex"))],
                [provider.claude_roots[0], provider.codex_roots[0]],
            )

    def test_the_store_path_is_configurable_and_the_environment_still_wins(self) -> None:
        Path(self.path).write_text(
            json.dumps({"store": "C:/configured/valkama.sqlite3"}), encoding="utf-8", newline="\n"
        )
        with mock.patch.dict(os.environ, {"VALKAMA_DB": "C:/env/valkama.sqlite3"}):
            self.assertEqual("C:/env/valkama.sqlite3", store.db_path())
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("VALKAMA_DB", None)
            self.assertEqual("C:/configured/valkama.sqlite3", store.db_path())


if __name__ == "__main__":
    unittest.main()
