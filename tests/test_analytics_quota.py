"""`GET /api/analytics/quota`: each account's subscription quota windows as they stand now.

The contract held here, stated from the request rather than read from the code: one entry
per account with a quota reading in the last seven days, and one per organization whose
work in that span has no reading, which says it has no source. An account is its
organization and its account's UUID, or the provisional seat a reading without one is on.
Each window gives its latest percent with that reading's time and source, its reset and
start, where steady use would stand now, its readings since its start, and a forecast:
the five-hour window's point answer, and a week only as a range. A window is fresh within
the alerts' fifteen minutes and silent after, and a fresh 0 % is a value. No field is a
sum or a total of percentages, two accounts' percentages are never added, and nothing in
the answer is money.

Every id, time and share is invented. A time is a moment after `analytics_fixtures.START`.
"""

from __future__ import annotations

import datetime as dt
import http.client
import json
import threading
from collections.abc import Iterator

from server import http_surface
from server.analytics import api, quota, usage
from server.quota import names, samples
from tests.analytics_fixtures import START, UsageStore

ORG_A = "org-a"
ORG_B = "org-b"
ORG_C = "org-c"
#: The answer's moment: 2030-03-06 10:00 UTC.
NOW = START + dt.timedelta(days=2, hours=10)
#: The week that began 2030-03-01 09:00 and the five-hour window that began at 08:00.
WEEK_RESET = "2030-03-08T09:00:00Z"
FIVE_RESET = "2030-03-06T13:00:00Z"
EARLIER_FIVE_RESET = "2030-03-06T08:00:00Z"
SEAT = samples.seat_for_week(WEEK_RESET)
#: The week before it, which ended on 2030-03-01 09:00, and the seat its readings named.
ENDED_RESET = "2030-03-01T09:00:00Z"
ENDED_SEAT = samples.seat_for_week(ENDED_RESET)


def at(text: str) -> dt.datetime:
    return dt.datetime.fromisoformat(text)


def ago(**span: float) -> dt.datetime:
    return NOW - dt.timedelta(**span)


def walk(value: object, path: str = "") -> Iterator[tuple[str, object]]:
    """Every key's path and value in an answer, nested ones included."""

    if isinstance(value, dict):
        for key, inner in value.items():
            yield f"{path}.{key}", inner
            yield from walk(inner, f"{path}.{key}")
    elif isinstance(value, list):
        for index, inner in enumerate(value):
            yield from walk(inner, f"{path}[{index}]")


class _Quota(UsageStore):
    def poll(
        self,
        moment: dt.datetime,
        *windows: samples.Window,
        organization: str = ORG_A,
        account: str | None = "acct-a",
        plan: str | None = None,
        seat: str | None = SEAT,
    ) -> None:
        reading = samples.Reading(
            "poll",
            moment.isoformat(),
            windows,
            seat,
            organization=organization,
            account_uuid=account,
            plan=plan,
        )
        with self.conn:
            samples.record(self.conn, reading, now=moment)

    def statusline(
        self, moment: dt.datetime, session: str, *windows: samples.Window, seat: str | None = SEAT
    ) -> None:
        reading = samples.Reading(
            "statusline", moment.isoformat(), windows, seat, session_id=session
        )
        with self.conn:
            samples.record(self.conn, reading, now=moment)

    def working(self, session: str, organization: str, moment: dt.datetime) -> None:
        """A stretch of `session`'s work for `organization` that began at `moment`."""

        seconds = (moment - START).total_seconds()
        self.segment(session, seconds, seconds + 60, organization=organization)

    def quota(self, utc_offset: int = 0) -> dict:
        return quota.read(self.conn, utc_offset, now=NOW)

    def account(self, answer: dict, organization: str, **key: str | None) -> dict:
        found = [
            one
            for one in answer["accounts"]
            if one["organization"] == organization
            and all(one[name] == value for name, value in key.items())
        ]
        self.assertEqual(1, len(found), answer["accounts"])
        return found[0]

    def window(self, account: dict, kind: str, model: str | None = None) -> dict:
        found = [one for one in account["windows"] if (one["kind"], one["model"]) == (kind, model)]
        self.assertEqual(1, len(found), account["windows"])
        return found[0]


def five(percent: float, reset: str = FIVE_RESET) -> samples.Window:
    return samples.Window("five_hour", percent, reset)


def week(percent: float, reset: str = WEEK_RESET) -> samples.Window:
    return samples.Window("week", percent, reset)


class StateTests(_Quota):
    def test_fresh_silent_and_no_source_are_told_apart_and_a_fresh_zero_is_a_value(self) -> None:
        self.poll(ago(hours=2), week(40), five(10, EARLIER_FIVE_RESET))
        self.poll(ago(minutes=5), five(0))
        # Organization B worked this week and nothing read its quota; C was read only
        # eight days ago, which is before the span, and worked yesterday.
        self.working("s-b", ORG_B, ago(days=1))
        self.poll(ago(days=8), week(20, "2030-03-01T09:00:00Z"), organization=ORG_C)
        self.working("s-c", ORG_C, ago(days=1))
        answer = self.quota()

        read = self.account(answer, ORG_A)
        self.assertFalse(read["no_source"])
        fresh = self.window(read, "five_hour")
        self.assertEqual("fresh", fresh["state"])
        self.assertEqual(0.0, fresh["latest"]["used_percent"])
        self.assertIsNotNone(fresh["latest"]["used_percent"])
        silent = self.window(read, "week")
        self.assertEqual("silent", silent["state"])
        self.assertEqual(40.0, silent["latest"]["used_percent"])
        for organization in (ORG_B, ORG_C):
            unread = self.account(answer, organization)
            self.assertTrue(unread["no_source"])
            self.assertEqual([], unread["windows"])
            self.assertEqual((None, None), (unread["account_uuid"], unread["seat"]))
        self.assertEqual(3, len(answer["accounts"]))

    def test_freshness_ends_where_the_alerts_stop_reading(self) -> None:
        # The alerts raise nothing on a reading older than fifteen minutes, so it is fresh
        # at fifteen minutes and silent a millisecond after.
        self.poll(ago(minutes=15), five(12))
        self.poll(ago(minutes=15, milliseconds=1), five(12), account="acct-b")
        answer = self.quota()
        self.assertEqual(900, answer["fresh_for_seconds"])
        self.assertEqual(
            "fresh",
            self.window(self.account(answer, ORG_A, account_uuid="acct-a"), "five_hour")["state"],
        )
        self.assertEqual(
            "silent",
            self.window(self.account(answer, ORG_A, account_uuid="acct-b"), "five_hour")["state"],
        )


class AccountTests(_Quota):
    def test_an_account_is_its_uuid_or_the_seat_a_reading_without_one_is_on(self) -> None:
        self.poll(ago(hours=1), week(30), plan="Max")
        # The owner names an organization; its provisional seat has that name too.
        names.write(self.conn, {"names": {ORG_A: "Work", ORG_C: "Lab"}})
        # A session of A on the seat acct-a's poll names is acct-a's.
        self.working("s-a", ORG_A, ago(days=1))
        self.statusline(ago(minutes=2), "s-a", week(31))
        # A session of C on a seat no reading with a UUID names stays on that seat.
        self.working("s-c", ORG_C, ago(days=1))
        self.statusline(ago(minutes=3), "s-c", week(55))
        # A reading with neither a UUID nor a seat names no account.
        self.statusline(ago(minutes=1), "s-c", five(70), seat=None)
        answer = self.quota()

        named = self.account(answer, ORG_A)
        self.assertEqual(
            ("acct-a", None, "Max", "Work"),
            (named["account_uuid"], named["seat"], named["plan"], named["name"]),
        )
        weekly = self.window(named, "week")
        self.assertEqual(
            [("poll", 30.0), ("statusline", 31.0)],
            [(one["source"], one["used_percent"]) for one in weekly["readings"]],
        )
        self.assertEqual("statusline", weekly["latest"]["source"])
        provisional = self.account(answer, ORG_C)
        self.assertEqual(
            (None, SEAT, None, "Lab"),
            (
                provisional["account_uuid"],
                provisional["seat"],
                provisional["plan"],
                provisional["name"],
            ),
        )
        self.assertEqual(["week"], [one["kind"] for one in provisional["windows"]])
        # A name taken away is no name.
        names.write(self.conn, {"names": {ORG_C: ""}})
        self.assertIsNone(self.account(self.quota(), ORG_C)["name"])

    def test_a_provisional_seat_whose_week_has_ended_is_left_out(self) -> None:
        # One machine whose readings name no account, read before and after its week reset
        # on 2030-03-01 09:00: the seat key changes with the week, so the two weeks are two
        # provisional seats. The week that has ended is no account any more, and the
        # organization is not said to have no source, since a source read it.
        self.working("s-c", ORG_C, ago(days=6))
        self.statusline(ago(days=5, hours=2), "s-c", week(96, ENDED_RESET), seat=ENDED_SEAT)
        self.statusline(ago(minutes=3), "s-c", week(12))
        answer = self.quota()
        self.assertEqual([SEAT], [one["seat"] for one in answer["accounts"]])
        current = self.account(answer, ORG_C)
        self.assertFalse(current["no_source"])
        self.assertEqual(12.0, self.window(current, "week")["latest"]["used_percent"])

    def test_a_provisional_seat_of_an_ended_week_alone_is_no_entry(self) -> None:
        # Read only in the week that has ended: nothing of it stands now, and the
        # organization's work was read by a source, so it is not an entry with no source.
        self.working("s-c", ORG_C, ago(days=6))
        self.statusline(ago(days=5, hours=2), "s-c", week(96, ENDED_RESET), seat=ENDED_SEAT)
        self.working("s-c", ORG_C, ago(days=1))
        self.assertEqual([], self.quota()["accounts"])

    def test_a_reading_or_work_dated_after_the_answers_moment_is_not_in_it(self) -> None:
        # A source whose clock runs ahead can date a reading after the moment read.
        self.poll(ago(minutes=-5), five(30))
        self.working("s-b", ORG_B, ago(minutes=-5))
        self.assertEqual([], self.quota()["accounts"])
        self.poll(ago(minutes=5), five(20))
        answer = self.quota()
        self.assertEqual([ORG_A], [one["organization"] for one in answer["accounts"]])
        latest = self.window(self.account(answer, ORG_A), "five_hour")["latest"]
        self.assertEqual(20.0, latest["used_percent"])

    def test_a_session_whose_organization_is_not_read_yet_is_no_account(self) -> None:
        self.statusline(ago(minutes=2), "s-unread", week(31))
        self.assertEqual([], self.quota()["accounts"])


class WindowTests(_Quota):
    def test_a_window_gives_its_start_its_pace_tick_and_its_readings_since_the_start(
        self,
    ) -> None:
        self.poll(at("2030-03-06T07:30:00+00:00"), five(90, EARLIER_FIVE_RESET))
        self.poll(at("2030-03-06T08:30:00+00:00"), five(5))
        self.poll(at("2030-03-06T09:50:00+00:00"), five(25))
        window = self.window(self.account(self.quota(utc_offset=180), ORG_A), "five_hour")
        self.assertEqual("2030-03-06T16:00:00.000+03:00", window["resets_at"])
        self.assertEqual("2030-03-06T11:00:00.000+03:00", window["started_at"])
        # Two of its five hours have gone: steady use would have spent 40 % by now.
        self.assertAlmostEqual(40.0, window["even_percent"])
        self.assertEqual(
            {"at": "2030-03-06T12:50:00.000+03:00", "source": "poll", "used_percent": 25.0},
            window["latest"],
        )
        self.assertEqual(
            [
                {"at": "2030-03-06T11:30:00.000+03:00", "used_percent": 5.0, "source": "poll"},
                {"at": "2030-03-06T12:50:00.000+03:00", "used_percent": 25.0, "source": "poll"},
            ],
            window["readings"],
        )

    def test_the_five_hour_forecast_is_its_point_answer(self) -> None:
        self.poll(at("2030-03-06T09:00:00+00:00"), five(20))
        self.poll(at("2030-03-06T09:40:00+00:00"), five(40))
        self.poll(at("2030-03-06T09:55:00+00:00"), five(50))
        found = self.window(self.account(self.quota(), ORG_A), "five_hour")["forecast"]
        # The last quarter hour spent 10 points (40 an hour), the last hour 30: the blend is
        # 35 an hour, and the 50 points left last 1 h 25 m 42.857 s from 10:00.
        self.assertEqual(
            {
                "outcome": "runs_out",
                "runs_out_at": "2030-03-06T11:25:42.857+00:00",
                "at_reset_percent": None,
                "basis": "blend",
            },
            found,
        )

    def test_five_hours_that_last_say_the_share_spent_by_the_reset(self) -> None:
        reset = "2030-03-06T12:20:00Z"
        self.poll(at("2030-03-06T09:00:00+00:00"), five(20, reset))
        self.poll(at("2030-03-06T09:40:00+00:00"), five(25, reset))
        self.poll(at("2030-03-06T09:55:00+00:00"), five(26, reset))
        found = self.window(self.account(self.quota(), ORG_A), "five_hour")["forecast"]
        # The last quarter hour spent 1 point (4 an hour), the last hour 6: the blend is 5 an
        # hour, and the 2 h 20 m to the reset add 35/3 to the 26 spent, to the hundredth.
        self.assertEqual(
            {"outcome": "lasts", "runs_out_at": None, "at_reset_percent": 37.67, "basis": "blend"},
            found,
        )

    def test_a_spent_five_hours_names_no_share_at_the_reset(self) -> None:
        self.poll(ago(minutes=3), five(100))
        found = self.window(self.account(self.quota(), ORG_A), "five_hour")["forecast"]
        self.assertEqual(
            {"outcome": "spent", "runs_out_at": None, "at_reset_percent": None, "basis": None},
            found,
        )

    def test_a_week_forecast_is_a_range_and_never_a_point(self) -> None:
        self.poll(at("2030-03-05T09:00:00+00:00"), week(30))
        self.poll(at("2030-03-06T09:00:00+00:00"), week(40))
        found = self.window(self.account(self.quota(), ORG_A), "week")["forecast"]
        # 47 hours to the reset. The last day's pace, 10 points in 24 hours, ends the week
        # at 40 + 47 * 10 / 24; the average since its start, 40 points in 121 hours, at
        # 40 + 47 * 40 / 121.
        self.assertEqual({"low_percent", "high_percent"}, set(found))
        self.assertAlmostEqual(40 + 47 * 40 / 121, found["low_percent"], places=2)
        self.assertAlmostEqual(40 + 47 * 10 / 24, found["high_percent"], places=2)

    def test_a_model_week_is_its_own_window(self) -> None:
        self.poll(
            ago(minutes=3),
            week(30),
            samples.Window("week_model", 70, WEEK_RESET, model="claude-opus-5-5"),
        )
        read = self.account(self.quota(), ORG_A)
        self.assertEqual(
            [("week", None, 30.0), ("week_model", "claude-opus-5-5", 70.0)],
            [(one["kind"], one["model"], one["latest"]["used_percent"]) for one in read["windows"]],
        )


class SumTests(_Quota):
    def build(self) -> dict:
        self.poll(ago(minutes=4), five(13), week(29))
        self.poll(
            ago(minutes=4),
            five(17),
            week(31),
            samples.Window(
                "extra_usage", None, "2030-04-01T00:00:00Z", amount=12.5, currency="USD"
            ),
            organization=ORG_B,
            account="acct-b",
        )
        self.working("s-b", ORG_B, ago(days=1))
        self.statusline(
            ago(minutes=2),
            "s-b",
            samples.Window("spend_limit", 44, None, amount=7.25, currency="USD"),
        )
        return self.quota()

    def test_no_field_is_a_sum_or_a_total_of_percentages(self) -> None:
        answer = self.build()
        for path, _ in walk(answer):
            key = path.rsplit(".", 1)[-1].casefold()
            with self.subTest(path):
                self.assertNotIn("total", key)
                self.assertNotIn("sum", key)

    def test_two_accounts_percentages_are_never_added(self) -> None:
        answer = self.build()
        first = self.account(answer, ORG_A)
        second = self.account(answer, ORG_B)
        percents = {
            (kind, account["organization"]): self.window(account, kind)["latest"]["used_percent"]
            for account in (first, second)
            for kind in ("five_hour", "week")
        }
        self.assertEqual({13.0, 29.0, 17.0, 31.0}, set(percents.values()))
        added = {
            percents[kind, ORG_A] + percents[kind, ORG_B] for kind in ("five_hour", "week")
        } | {percents["five_hour", ORG_A] + percents["week", ORG_A]}
        numbers = {value for _, value in walk(answer) if isinstance(value, int | float)}
        self.assertFalse(added & numbers, sorted(added & numbers))
        self.assertEqual(2, len(answer["accounts"]))

    def test_spend_windows_are_their_own_kind_with_no_percent_and_no_money(self) -> None:
        answer = self.build()
        account = self.account(answer, ORG_B)
        for kind in ("extra_usage", "spend_limit"):
            with self.subTest(kind):
                window = self.window(account, kind)
                self.assertEqual({"kind", "model", "state", "resets_at", "latest"}, set(window))
                self.assertEqual({"at", "source"}, set(window["latest"]))
        numbers = {value for _, value in walk(answer) if isinstance(value, int | float)}
        self.assertFalse({12.5, 7.25, 44.0} & numbers)
        texts = {str(value) for _, value in walk(answer)}
        self.assertNotIn("USD", texts)
        for path, _ in walk(answer):
            key = path.rsplit(".", 1)[-1].casefold()
            for word in ("amount", "currency", "usd", "cost", "price"):
                self.assertNotIn(word, key, path)


class ConventionTests(_Quota):
    def answer_of(self, path: str, parameters: dict[str, list[str]]) -> tuple[int, dict]:
        try:
            found = api.handle_get(self.conn, path, parameters)
        except (api.AnalyticsHttpError, usage.UsageQueryError) as error:
            return api.error_response(error)
        assert found is not None
        return found

    def test_an_empty_store_answers_no_account(self) -> None:
        status, body = self.answer_of(api.QUOTA_PATH, {})
        self.assertEqual(200, status, body)
        self.assertEqual(api.ANALYTICS_API_INTERFACE, body["interface_version"])
        self.assertEqual([], body["quota"]["accounts"])
        self.assertEqual(0, body["quota"]["utc_offset"])
        self.assertTrue(body["quota"]["now"].endswith("+00:00"), body["quota"]["now"])

    def test_times_are_at_the_callers_offset(self) -> None:
        status, body = self.answer_of(api.QUOTA_PATH, {"utc_offset": ["-150"]})
        self.assertEqual(200, status, body)
        self.assertTrue(body["quota"]["now"].endswith("-02:30"), body["quota"]["now"])
        self.assertEqual(-150, body["quota"]["utc_offset"])

    def test_a_request_the_usage_read_refuses_is_refused_alike(self) -> None:
        period = {"from": ["2030-03-04"], "to": ["2030-03-05"]}
        for parameters, message in (
            ({"colour": ["red"]}, "colour is not a parameter"),
            ({"utc_offset": ["east"]}, "utc_offset must be a whole number of minutes"),
            ({"utc_offset": ["900"]}, "utc_offset must be from -840 to 840 minutes"),
            ({"utc_offset": ["60", "120"]}, None),
        ):
            with self.subTest(parameters):
                status, body = self.answer_of(api.QUOTA_PATH, parameters)
                self.assertEqual(400, status, body)
                self.assertEqual("invalid_request", body["error"]["code"])
                if message is not None:
                    self.assertEqual(message, body["error"]["message"])
                self.assertEqual(
                    (status, body), self.answer_of(api.USAGE_PATH, {**period, **parameters})
                )
        # The usage read's own parameters are not this read's.
        status, body = self.answer_of(api.QUOTA_PATH, period)
        self.assertEqual((400, "from is not a parameter"), (status, body["error"]["message"]))


class HttpTests(_Quota):
    def setUp(self) -> None:
        super().setUp()
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 3)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def get(self, path: str) -> tuple[int, dict]:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        try:
            client.request("GET", path, headers={"Host": f"127.0.0.1:{self.server.server_port}"})
            response = client.getresponse()
            return response.status, json.loads(response.read())
        finally:
            client.close()

    def test_the_route_answers_under_the_analytics_interface_and_refuses_as_it_does(
        self,
    ) -> None:
        moment = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=1)
        self.poll(moment, five(12, (moment + dt.timedelta(hours=2)).isoformat()))
        status, body = self.get(f"{api.QUOTA_PATH}?utc_offset=180")
        self.assertEqual(200, status, body)
        self.assertEqual(api.ANALYTICS_API_INTERFACE, body["interface_version"])
        window = self.window(self.account(body["quota"], ORG_A), "five_hour")
        self.assertEqual(("fresh", 12.0), (window["state"], window["latest"]["used_percent"]))
        status, body = self.get(f"{api.QUOTA_PATH}?step=day")
        self.assertEqual(400, status, body)
        self.assertEqual("invalid_request", body["error"]["code"])
