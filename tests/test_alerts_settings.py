"""The owner's alert settings: one row in the store, read by whichever process alerts.

The sender is the process that wrote the event, not a page, so the settings
cannot live in a browser's storage. What this suite holds: a store without the
row answers the defaults, an unknown key is refused rather than kept, a missing
one takes its default, a write is read back by the same connection, and a row
that no longer validates falls back to the defaults instead of breaking the
write that wanted to alert. The default values are the ones the settings screen
promises, stated here rather than read from the module.
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from server import store
from server.alerts import settings

DEFAULTS_RU = {
    "enabled": True,
    "events": {"question": True, "review": True, "launchFailed": False},
    "content": "title",
    "locale": "ru",
}


def russian() -> str:
    return "ru"


def english() -> str:
    return "en"


class AlertSettingsStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)

    def test_a_fresh_store_has_the_table_and_no_row(self) -> None:
        columns = [
            str(row[1]) for row in self.conn.execute("PRAGMA table_info(owner_alert_settings)")
        ]
        self.assertEqual(["key", "record_json", "updated_at"], columns)
        self.assertEqual(
            0, self.conn.execute("SELECT COUNT(*) FROM owner_alert_settings").fetchone()[0]
        )

    def test_no_row_reads_as_the_defaults_in_the_system_language(self) -> None:
        self.assertEqual(DEFAULTS_RU, settings.read(self.conn, language=russian))
        self.assertEqual(
            {**DEFAULTS_RU, "locale": "en"}, settings.read(self.conn, language=english)
        )

    def test_a_write_is_read_back_by_the_same_connection(self) -> None:
        wanted = {
            "enabled": False,
            "events": {"question": True, "review": False, "launchFailed": True},
            "content": "prompt",
            "locale": "en",
        }
        self.assertEqual(wanted, settings.write(self.conn, wanted, language=russian))
        self.assertEqual(wanted, settings.read(self.conn, language=russian))
        row = self.conn.execute("SELECT key, record_json, updated_at FROM owner_alert_settings")
        [(key, record, updated_at)] = [tuple(found) for found in row]
        self.assertEqual("settings", key)
        self.assertEqual(wanted, json.loads(record))
        self.assertRegex(updated_at, r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")

    def test_a_second_write_replaces_the_one_row(self) -> None:
        settings.write(self.conn, {"content": "generic"}, language=russian)
        settings.write(self.conn, {"enabled": False}, language=english)
        self.assertEqual(
            1, self.conn.execute("SELECT COUNT(*) FROM owner_alert_settings").fetchone()[0]
        )
        # A missing key takes its default, not what the previous write said.
        self.assertEqual(
            {**DEFAULTS_RU, "enabled": False, "locale": "en"},
            settings.read(self.conn, language=russian),
        )

    def test_a_refused_write_leaves_the_stored_row(self) -> None:
        settings.write(self.conn, {"content": "generic"}, language=russian)
        with self.assertRaises(settings.SettingsError):
            settings.write(self.conn, {"content": "everything"}, language=russian)
        self.assertEqual("generic", settings.read(self.conn, language=russian)["content"])

    def test_a_row_that_no_longer_validates_reads_as_the_defaults(self) -> None:
        for record in ('{"enabled": "yes"}', "not json", '["settings"]'):
            with self.subTest(record=record):
                self.conn.execute(
                    "INSERT INTO owner_alert_settings(key, record_json, updated_at)"
                    " VALUES('settings', ?, '2026-11-03T00:00:00Z')"
                    " ON CONFLICT(key) DO UPDATE SET record_json=excluded.record_json",
                    (record,),
                )
                self.assertEqual(DEFAULTS_RU, settings.read(self.conn, language=russian))

    def test_the_table_holds_only_the_one_key(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                "INSERT INTO owner_alert_settings VALUES('other', '{}', '2026-11-03T00:00:00Z')"
            )


class AlertSettingsValidationTests(unittest.TestCase):
    def test_an_empty_payload_is_the_defaults(self) -> None:
        self.assertEqual(DEFAULTS_RU, settings.validate({}, language=russian))

    def test_a_partial_events_object_keeps_the_other_defaults(self) -> None:
        result = settings.validate({"events": {"review": False}}, language=russian)
        self.assertEqual(
            {"question": True, "review": False, "launchFailed": False}, result["events"]
        )

    def test_every_content_and_locale_the_screen_offers_is_accepted(self) -> None:
        for content in ("generic", "title", "prompt"):
            for locale in ("ru", "en"):
                with self.subTest(content=content, locale=locale):
                    result = settings.validate(
                        {"content": content, "locale": locale}, language=russian
                    )
                    self.assertEqual((content, locale), (result["content"], result["locale"]))

    def test_what_is_refused(self) -> None:
        cases = {
            "not an object": ["enabled"],
            "an unknown key": {"sound": True},
            "an unknown event": {"events": {"itemCompleted": True}},
            "events not an object": {"events": ["question"]},
            "a switch that is not a boolean": {"enabled": 1},
            "an event that is not a boolean": {"events": {"question": "on"}},
            "an unknown content": {"content": "everything"},
            "an unknown locale": {"locale": "de"},
            "a locale that is not text": {"locale": None},
        }
        for name, payload in cases.items():
            with self.subTest(name), self.assertRaises(settings.SettingsError):
                settings.validate(payload, language=russian)

    def test_an_event_is_wanted_only_when_alerts_and_that_event_are_on(self) -> None:
        on = settings.validate({}, language=russian)
        off = settings.validate({"enabled": False}, language=russian)
        self.assertTrue(settings.wants(on, "question"))
        self.assertTrue(settings.wants(on, "review"))
        self.assertFalse(settings.wants(on, "launchFailed"))
        for event in settings.EVENTS:
            with self.subTest(event=event):
                self.assertFalse(settings.wants(off, event))
        with self.assertRaises(settings.SettingsError):
            settings.wants(on, "itemCompleted")


class SystemLanguageTests(unittest.TestCase):
    """The rule the desktop start page uses: Russian when the system is, else English."""

    def test_the_windows_ui_language_decides(self) -> None:
        for language_id, expected in ((0x0419, "ru"), (0x0819, "ru"), (0x0409, "en"), (None, "en")):
            with (
                self.subTest(language_id=language_id),
                mock.patch.object(settings.sys, "platform", "win32"),
                mock.patch.object(settings, "_windows_ui_language", return_value=language_id),
            ):
                self.assertEqual(expected, settings.system_language())

    def test_elsewhere_the_locale_decides(self) -> None:
        for name, expected in (("ru_RU", "ru"), ("en_US", "en"), (None, "en")):
            with (
                self.subTest(name=name),
                mock.patch.object(settings.sys, "platform", "linux"),
                mock.patch.object(settings.locale, "getlocale", return_value=(name, "UTF-8")),
            ):
                self.assertEqual(expected, settings.system_language())

    def test_the_real_probe_answers_one_of_the_two(self) -> None:
        self.assertIn(settings.system_language(), ("ru", "en"))


if __name__ == "__main__":
    unittest.main()
