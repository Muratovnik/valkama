"""The owner warned before a subscription quota window runs out.

The contract held here, stated from the owner's request rather than read from the code: a
week alerts at 75 % and at 90 % spent, per account and window, a model's own week too;
the five-hour window alerts when its forecast says it runs out before its reset. One alert
per level per window, kept in the store so a restart gives none again, and a new reset
starts the levels again. A reading older than fifteen minutes raises nothing. A session's
reading belongs to the organization its transcript names, so it waits, unalerted, until
the transcript reader has read that far, and then alerts once. The toast says the level,
the reset, the data's age and what to do, in the owner's language; the owner can switch
quota alerts off; and the listener's own reader loop delivers them, with no page asked.

Every id, time and share is invented. A time is seconds after `usage_fixtures.START`,
2030-03-04 09:00 UTC.
"""

from __future__ import annotations

import datetime as dt
import re
import sqlite3
import threading
import time
import unittest
from pathlib import Path
from unittest import mock
from xml.etree import ElementTree  # noqa: S405 - parses only what the module built

from server import housekeeping, store
from server.alerts import emit, messages
from server.alerts import quota as quota_alerts
from server.alerts import settings as alert_settings
from server.hooks import ingest
from server.ops import toast
from server.quota import names, samples
from server.telemetry import usage_reread
from tests.usage_fixtures import HOUR, MINUTE, ORG_A, ORG_B, START, Case

WEEK_RESET = "2030-03-08T09:00:00Z"
NEXT_WEEK_RESET = "2030-03-15T09:00:00Z"
#: The five-hour window that began at 08:00 and resets at 13:00.
FIVE_RESET = "2030-03-04T13:00:00Z"
NEXT_FIVE_RESET = "2030-03-04T18:00:00Z"
DAY = 24 * HOUR
EN = {"enabled": True, "content": "title", "locale": "en"}
RU = {**EN, "locale": "ru"}


def moment(seconds: float) -> dt.datetime:
    return START + dt.timedelta(seconds=seconds)


def texts(message: messages.Message) -> list[str]:
    root = ElementTree.fromstring(message["xml"])  # noqa: S314 - the module's own output
    return [element.text or "" for element in root.iter("text")]


class _Quota(Case):
    """A store whose session `sess-1` the reader already knows works for `ORG_A`."""

    def setUp(self) -> None:
        super().setUp()
        self.log = Path(self.root, "valkama-alerts.log")
        self.shown: list[messages.Message] = []
        self.asked: list[tuple[str, bool]] = []
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
        self.working("sess-1", ORG_A)
        self.read()

    def _sees(self, work_item_id: str, *, question: bool) -> bool:
        self.asked.append((work_item_id, question))
        return False

    def working(self, session: str, organization: str | None) -> None:
        """A transcript of `session` making its requests for `organization`, not read yet."""

        run = self.session(session)
        if organization is not None:
            run.credential(0, organization)
        run.prompt(1)
        run.end_turn(30)
        self.ticks((0, HOUR))

    def statusline(
        self,
        at: float,
        *,
        week: float | None = None,
        five: float | None = None,
        session: str = "sess-1",
        week_reset: str = WEEK_RESET,
        five_reset: str = FIVE_RESET,
    ) -> None:
        windows = []
        if five is not None:
            windows.append(samples.Window("five_hour", five, five_reset))
        if week is not None:
            windows.append(samples.Window("week", week, week_reset))
        reading = samples.Reading(
            "statusline",
            moment(at).isoformat(),
            tuple(windows),
            samples.seat_for_week(week_reset),
            session_id=session,
        )
        with self.conn:
            samples.record(self.conn, reading, now=moment(at))

    def poll(self, at: float, *windows: samples.Window, account: str | None = "acct-1") -> None:
        reading = samples.Reading(
            "poll",
            moment(at).isoformat(),
            windows,
            samples.seat_for_week(WEEK_RESET),
            organization=ORG_A,
            account_uuid=account,
        )
        with self.conn:
            samples.record(self.conn, reading, now=moment(at))

    def evaluate(self, at: float) -> list[messages.Message]:
        """One evaluation after a reader's pass, as the listener makes it; what it showed."""

        before = len(self.shown)
        quota_alerts.after_pass(self.reader, now=moment(at))
        emit.EMITTER.flush(5)
        self.assertFalse(self.log.exists() and self.log.read_text(encoding="utf-8"))
        return self.shown[before:]

    def keys(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute(
                "SELECT organization, kind, model, resets_at, level FROM quota_alerts"
                " ORDER BY resets_at, level"
            )
        ]


class WeekTests(_Quota):
    def test_a_week_alerts_once_at_75_and_once_at_90(self) -> None:
        self.statusline(60, week=74.9)
        self.assertEqual([], self.evaluate(61))
        self.statusline(120, week=76)
        [first] = self.evaluate(121)
        self.assertEqual("Valkama: the week's quota passed 75%", texts(first)[0])
        self.statusline(180, week=80)
        self.assertEqual([], self.evaluate(181))
        self.statusline(240, week=91)
        [second] = self.evaluate(241)
        self.assertEqual("Valkama: the week's quota passed 90%", texts(second)[0])
        # One toast per account's window: the 90 % one takes the 75 % one's place.
        self.assertEqual(first["tag"], second["tag"])
        self.statusline(300, week=95)
        self.assertEqual([], self.evaluate(301))
        self.assertEqual([], self.asked)

    def test_a_reading_past_both_levels_gives_the_higher_alone_and_keeps_both(self) -> None:
        self.statusline(60, week=92)
        [shown] = self.evaluate(61)
        self.assertIn("90%", texts(shown)[0])
        self.assertEqual(
            [(ORG_A, "week", "", "2030-03-08T09:00:00.000Z", level) for level in ("75", "90")],
            self.keys(),
        )

    def test_a_restart_gives_no_alert_again(self) -> None:
        self.statusline(60, week=80)
        self.assertEqual(1, len(self.evaluate(61)))
        # A new process: a new connection and an emitter holding nothing.
        self.reader.close()
        self.reader = ingest.open_light(self.store_path, store.STORE_SCHEMA_VERSION)
        self.addCleanup(self.reader.close)
        with mock.patch.object(emit, "EMITTER", emit.Emitter(window=60.0)):
            self.assertEqual([], self.evaluate(62))
            self.statusline(120, week=81)
            self.assertEqual([], self.evaluate(121))

    def test_a_new_week_starts_the_levels_again(self) -> None:
        self.statusline(60, week=80)
        self.assertEqual(1, len(self.evaluate(61)))
        later = 4 * DAY + HOUR  # an hour after the first week reset
        self.statusline(later, week=76, week_reset=NEXT_WEEK_RESET)
        self.assertEqual(1, len(self.evaluate(later + 1)))
        # The key of the week that reset can match no reading any more.
        self.assertEqual([(ORG_A, "week", "", "2030-03-15T09:00:00.000Z", "75")], self.keys())

    def test_a_model_week_alerts_on_its_own(self) -> None:
        names.write(self.conn, {"names": {ORG_A: "Team account"}})
        self.poll(
            60,
            samples.Window("week", 50, WEEK_RESET),
            samples.Window("week_model", 76, WEEK_RESET, model="Opus"),
        )
        [model] = self.evaluate(61)
        self.assertEqual("Valkama: the week's Opus quota passed 75%", texts(model)[0])
        self.assertTrue(texts(model)[1].startswith("Team account · 76% used"))
        self.poll(
            120,
            samples.Window("week", 77, WEEK_RESET),
            samples.Window("week_model", 76, WEEK_RESET, model="Opus"),
        )
        [week] = self.evaluate(121)
        self.assertEqual("Valkama: the week's quota passed 75%", texts(week)[0])
        self.assertNotEqual(model["tag"], week["tag"])

    def test_learning_a_provisional_seat_s_account_gives_no_alert_again(self) -> None:
        self.statusline(60, week=80)
        self.assertEqual(1, len(self.evaluate(61)))
        self.poll(120, samples.Window("week", 81, WEEK_RESET))
        self.assertEqual([], self.evaluate(121))


class NameTests(_Quota):
    """The toast names the account by the name the owner gave its organization, or by none."""

    def test_a_session_s_reading_is_named_by_its_organization_s_name(self) -> None:
        # A session's reading names no account's UUID: the name is the organization's.
        names.write(self.conn, {"names": {ORG_A: "Main account", ORG_B: "Side account"}})
        self.statusline(60, week=76)
        [shown] = self.evaluate(61)
        self.assertEqual("Valkama: the week's quota passed 75%", texts(shown)[0])
        self.assertTrue(texts(shown)[1].startswith("Main account · 76% used"), texts(shown)[1])
        self.assertNotIn("Side account", "".join(texts(shown)))

    def test_with_no_name_the_toast_says_what_it_said_before(self) -> None:
        names.write(self.conn, {"names": {ORG_B: "Side account"}})
        self.statusline(60, week=76)
        [shown] = self.evaluate(61)
        self.assertTrue(texts(shown)[1].startswith("76% used"), texts(shown)[1])
        self.assertNotIn("Side account", "".join(texts(shown)))


class FiveHourTests(_Quota):
    def test_a_window_forecast_to_run_out_alerts_once(self) -> None:
        # Spent fast lately: 20 points in the last quarter hour, 50 in the hour.
        self.statusline(HOUR, five=10, week=20)
        self.statusline(HOUR + 45 * MINUTE, five=40, week=20)
        self.statusline(HOUR + 59 * MINUTE, five=60, week=20)
        [shown] = quota_alerts.due(self.reader, now=moment(2 * HOUR), zone=dt.UTC)
        self.assertEqual(
            [
                # The forecast's blend: (20/15 + 50/60) / 2 points a minute leaves the
                # 40 points left 36.9 minutes after 11:00.
                "Valkama: the five-hour quota runs out at about 11:36",
                "60% used · resets at 13:00",
                "Data from 1 min ago. Slow down until the reset, or move work to another account.",
            ],
            texts(shown.message),
        )
        self.statusline(2 * HOUR + MINUTE, five=70, week=20)
        self.assertEqual([], self.evaluate(2 * HOUR + 2 * MINUTE))

    def test_a_window_lasting_to_its_reset_gives_nothing(self) -> None:
        self.statusline(HOUR, five=10, week=20)
        self.statusline(HOUR + 45 * MINUTE, five=11, week=20)
        self.statusline(HOUR + 59 * MINUTE, five=12, week=20)
        self.assertEqual([], self.evaluate(2 * HOUR))
        self.assertEqual([], self.keys())

    def test_a_counter_zeroed_inside_the_window_is_forecast_from_the_restart(self) -> None:
        # The session reads 99, and 37 minutes later 0 under the same reset; another
        # session's 20 under the 99 is a stale reading and restarts nothing. Read from the 99,
        # the window would keep one point and spend none of it; read from the restart, the
        # last quarter hour spent 30 and the 29 minutes since it 60.
        self.working("sess-2", ORG_A)
        self.read()
        self.statusline(HOUR, five=50, week=20)
        self.statusline(HOUR + 20 * MINUTE, five=99, week=20)
        self.statusline(HOUR + 30 * MINUTE, five=20, week=20, session="sess-2")
        self.statusline(HOUR + 57 * MINUTE, five=0, week=20)
        self.statusline(HOUR + 70 * MINUTE, five=30, week=20)
        self.statusline(HOUR + 85 * MINUTE, five=60, week=20)
        [shown] = quota_alerts.due(self.reader, now=moment(HOUR + 86 * MINUTE), zone=dt.UTC)
        # (30/15 + 60/29) / 2 points a minute leaves the 40 points left 19.7 minutes after
        # 11:26.
        self.assertEqual(
            "Valkama: the five-hour quota runs out at about 11:45", texts(shown.message)[0]
        )

    def test_a_spent_window_alerts_and_a_new_window_alerts_again(self) -> None:
        self.statusline(2 * HOUR, five=100, week=20)
        [spent] = self.evaluate(2 * HOUR + MINUTE)
        self.assertEqual("Valkama: the five-hour quota is spent", texts(spent)[0])
        self.assertEqual([], self.evaluate(2 * HOUR + 2 * MINUTE))
        self.statusline(4 * HOUR + 30 * MINUTE, five=100, week=21, five_reset=NEXT_FIVE_RESET)
        self.assertEqual(1, len(self.evaluate(4 * HOUR + 31 * MINUTE)))


class FreshnessTests(_Quota):
    def test_a_reading_within_fifteen_minutes_alerts(self) -> None:
        self.statusline(60, week=80)
        self.assertEqual(1, len(self.evaluate(60 + 14 * MINUTE)))

    def test_a_week_reading_older_than_fifteen_minutes_raises_nothing(self) -> None:
        self.statusline(60, week=80)
        self.assertEqual([], self.evaluate(60 + 16 * MINUTE))
        self.assertEqual([], self.keys())

    def test_a_stale_spent_five_hour_window_raises_nothing(self) -> None:
        self.statusline(2 * HOUR, five=100, week=20)
        self.assertEqual([], self.evaluate(2 * HOUR + 20 * MINUTE))

    def test_the_next_fresh_reading_gives_the_level_a_stale_one_reached(self) -> None:
        self.statusline(60, week=80)
        self.assertEqual([], self.evaluate(60 + 16 * MINUTE))
        self.statusline(HOUR, week=81)
        [shown] = self.evaluate(HOUR + 1)
        self.assertIn("75%", texts(shown)[0])


class OrganizationTests(_Quota):
    def test_a_reading_waits_for_its_organization_and_then_alerts_once(self) -> None:
        self.working("sess-2", ORG_B)
        self.statusline(60, week=80, session="sess-2")
        self.assertEqual([], self.evaluate(61))
        self.assertEqual([], self.keys())
        self.read()  # the reader's next pass reaches the session's `credential_org`
        self.assertEqual(1, len(self.evaluate(62)))
        self.assertEqual([], self.evaluate(63))
        self.assertEqual([(ORG_B, "week", "", "2030-03-08T09:00:00.000Z", "75")], self.keys())

    def test_a_session_whose_organization_stays_unknown_raises_nothing(self) -> None:
        self.working("sess-3", None)
        self.read()
        self.statusline(60, week=95, session="sess-3")
        self.assertEqual([], self.evaluate(61))
        self.assertEqual([], self.keys())


class SettingsTests(_Quota):
    def test_quota_alerts_turned_off_give_and_keep_nothing(self) -> None:
        alert_settings.write(self.conn, {"locale": "en", "events": {"quota": False}})
        self.statusline(60, week=80)
        self.assertEqual([], self.evaluate(61))
        self.assertEqual([], self.keys())
        alert_settings.write(self.conn, {"locale": "en"})
        self.assertEqual(1, len(self.evaluate(62)))

    def test_alerts_turned_off_as_a_whole_give_nothing(self) -> None:
        alert_settings.write(self.conn, {"locale": "en", "enabled": False})
        self.statusline(60, week=80)
        self.assertEqual([], self.evaluate(61))

    def test_with_toasts_switched_off_nothing_is_read_or_kept(self) -> None:
        self.statusline(60, week=80)
        with mock.patch.object(toast, "active", return_value=False):
            self.assertEqual([], self.evaluate(61))
        self.assertEqual([], self.keys())

    def test_the_stored_language_writes_the_toast(self) -> None:
        alert_settings.write(self.conn, {"locale": "ru"})
        self.statusline(60, week=80)
        [shown] = self.evaluate(61)
        self.assertEqual("Valkama: недельная квота перешла 75%", texts(shown)[0])


class DeliveryTests(_Quota):
    def test_a_quota_toast_beside_an_item_s_is_its_own_and_asks_no_page(self) -> None:
        settings = alert_settings.read(self.conn)
        item = messages.build("review", reference="MAIN-1", title="Work", settings=settings)
        self.statusline(60, week=80)
        dues = quota_alerts.due(self.reader, now=moment(61))
        emit.send([emit.Show("MAIN-1", item, "item-1", settings), *dues])
        emit.EMITTER.flush(5)
        self.assertCountEqual([item, dues[0].message], self.shown)
        self.assertEqual([("item-1", False)], self.asked)

    def test_a_decision_that_fails_is_a_log_line(self) -> None:
        with mock.patch.object(quota_alerts, "_dues", side_effect=sqlite3.OperationalError("busy")):
            quota_alerts.after_pass(self.reader, now=moment(61))
        self.assertIn("quota alert not decided", self.log.read_text(encoding="utf-8"))


class ListenerLoopTests(_Quota):
    """The reader's loop in the listener, on today's clock, with no page and no window."""

    def setUp(self) -> None:
        super().setUp()
        for name, value in (("USAGE_START_SECONDS", 0.0), ("USAGE_PAUSE_SECONDS", 0.01)):
            patch = mock.patch.object(housekeeping, name, value)
            patch.start()
            self.addCleanup(patch.stop)
        now = dt.datetime.now(dt.UTC)
        reading = samples.Reading(
            "poll",
            (now - dt.timedelta(minutes=1)).isoformat(),
            (samples.Window("week", 80, (now + dt.timedelta(days=3)).isoformat()),),
            samples.seat_for_week((now + dt.timedelta(days=3)).isoformat()),
            organization=ORG_A,
        )
        with self.conn:
            samples.record(self.conn, reading, now=now)

    def test_the_owner_s_listener_loop_alerts_with_no_page_open(self) -> None:
        with mock.patch.object(emit, "EMITTER", emit.Emitter(window=0.0)):
            stop = housekeeping.start_usage(self.said.append, alerts=True)
            self.addCleanup(stop.set)
            deadline = time.monotonic() + 20
            while not self.shown and time.monotonic() < deadline:
                time.sleep(0.05)
            stop.set()
            emit.EMITTER.flush(5)
        self.assertEqual(1, len(self.shown))
        self.assertEqual("Valkama: the week's quota passed 75%", texts(self.shown[0])[0])
        self.assertEqual([], self.asked)
        self.assertEqual([], self.said)

    def test_a_loop_started_without_alerts_gives_none(self) -> None:
        passes = threading.Semaphore(0)
        run_pass = usage_reread.Reader.run_pass

        def counted(reader: usage_reread.Reader, report: object, seconds: float = 1.0) -> bool:
            answer = run_pass(reader, report, seconds)  # type: ignore[arg-type]
            passes.release()
            return answer

        with (
            mock.patch.object(usage_reread.Reader, "run_pass", counted),
            mock.patch.object(emit, "EMITTER", emit.Emitter(window=0.0)),
        ):
            stop = housekeeping.start_usage(self.said.append)
            self.addCleanup(stop.set)
            for _ in range(3):
                self.assertTrue(passes.acquire(timeout=20), "the reader made no pass")
            stop.set()
            emit.EMITTER.flush(5)
        self.assertEqual([], self.shown)
        self.assertEqual([], self.keys())


class MessageTests(unittest.TestCase):
    """The toast's words, from its inputs alone."""

    NOW = dt.datetime(2030, 3, 4, 11, 0, tzinfo=dt.UTC)

    def week(self, settings: dict, **fields: object) -> messages.Message:
        values: dict = {
            "tag": "quota-1",
            "window": "week",
            "percent": 77.9,
            "resets_at": dt.datetime(2030, 3, 8, 9, 0, tzinfo=dt.UTC),
            "sample_at": self.NOW - dt.timedelta(minutes=3),
            "now": self.NOW,
            "settings": settings,
            "account": "Team account",
        }
        values.update(fields)
        return messages.quota("75", **values)

    def test_a_week_says_level_share_reset_age_and_action_in_english(self) -> None:
        self.assertEqual(
            [
                "Valkama: the week's quota passed 75%",
                "Team account · 77% used · resets on Mar 8 at 09:00",
                "Data from 3 min ago. Pace the rest of the week, or move work to another account.",
            ],
            texts(self.week(EN)),
        )

    def test_a_week_says_the_same_in_russian(self) -> None:
        self.assertEqual(
            [
                "Valkama: недельная квота перешла 75%",
                "Team account · Израсходовано 77% · обновится 8 марта в 09:00",
                "Данные получены 3 мин назад. Распределите остаток до конца недели"
                " или перенесите работу на другой аккаунт.",
            ],
            texts(self.week(RU)),
        )

    def test_the_five_hour_window_in_russian(self) -> None:
        message = messages.quota(
            "exhausted",
            tag="quota-2",
            window="five_hour",
            percent=60,
            resets_at=dt.datetime(2030, 3, 4, 13, 0, tzinfo=dt.UTC),
            sample_at=self.NOW,
            now=self.NOW,
            settings=RU,
            runs_out_at=dt.datetime(2030, 3, 4, 11, 36, 55, tzinfo=dt.UTC),
        )
        self.assertEqual(
            [
                "Valkama: пятичасовая квота кончится около 11:36",
                "Израсходовано 60% · обновится в 13:00",
                "Данные получены только что. Сбавьте темп до обновления"
                " или перенесите работу на другой аккаунт.",
            ],
            texts(message),
        )

    def test_generic_content_leaves_the_account_out(self) -> None:
        self.assertNotIn("Team account", self.week({**EN, "content": "generic"})["xml"])

    def test_the_toast_opens_nothing_and_leaves_at_the_reset(self) -> None:
        message = self.week(EN)
        self.assertIsNone(re.search(r"\blaunch=", message["xml"]))
        self.assertEqual("2030-03-08T09:00:00Z", message["expires_at"])
        self.assertEqual(("quota-1", messages.GROUP), (message["tag"], message["group"]))

    def test_a_level_the_window_has_not_is_refused(self) -> None:
        for window, level, model in (
            ("week", "exhausted", None),
            ("five_hour", "75", None),
            ("week_model", "75", None),
            ("week", "75", "Opus"),
        ):
            with self.subTest(window=window, level=level), self.assertRaises(ValueError):
                messages.quota(
                    level,
                    tag="quota-3",
                    window=window,
                    percent=80,
                    resets_at=self.NOW,
                    sample_at=self.NOW,
                    now=self.NOW,
                    settings=EN,
                    model=model,
                )
