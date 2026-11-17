"""The `poll` quota source: what it reads, how often it asks, and what it never keeps.

Expected values come from the behaviour the source states (`server.quota.poll`) and the
endpoint's answer shapes as Claude Code's `/usage` reads them, not from the code under
test. Every token, id, time and number is invented. Nothing here reaches the network: the
poll asks through a fake transport, or through the real one pointed at a local server.
"""

from __future__ import annotations

import datetime as dt
import http.client
import http.server
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path
from unittest import mock

from server import store
from server.hooks import ingest
from server.ops import doctor
from server.quota import poll, samples
from server.quota import settings as quota_settings

START = dt.datetime(2030, 3, 5, 12, 0, tzinfo=dt.UTC)
TOKEN = "sk-ant-oat01-SYNTHETIC-test-token-0123456789abcdef"  # noqa: S105 -- synthetic
OTHER_TOKEN = "sk-ant-oat01-SYNTHETIC-second-token-fedcba9876543210"  # noqa: S105 -- synthetic
ORGANIZATION = "6f1c2a8e-0000-4000-8000-000000000001"
ACCOUNT = "0b7d4e19-0000-4000-8000-000000000002"
EMAIL = "someone@example.invalid"
NAME = "Example Person"
WEEK_RESET = "2030-03-08T09:00:00.239425+00:00"
SEAT = "week:2030-03-08T09:00Z"
#: The paces the source states, written out so a changed constant cannot agree with itself.
FIVE_MINUTES = dt.timedelta(minutes=5)
TEN_MINUTES = dt.timedelta(minutes=10)
FIFTEEN_MINUTES = dt.timedelta(minutes=15)

PROFILE = json.dumps(
    {
        "account": {
            "uuid": ACCOUNT,
            "email": EMAIL,
            "display_name": NAME,
            "full_name": NAME,
            "has_claude_max": True,
        },
        "organization": {"uuid": ORGANIZATION, "organization_type": "claude_max"},
    }
).encode()
USAGE = json.dumps(
    {
        "five_hour": {"utilization": 2.0, "resets_at": "2030-03-05T16:00:00+00:00"},
        "seven_day": {"utilization": 81.0, "resets_at": WEEK_RESET},
        "limits": [
            {"kind": "session", "percent": 2, "resets_at": "2030-03-05T16:00:00+00:00"},
            {"kind": "weekly_all", "percent": 81, "resets_at": WEEK_RESET, "is_active": True},
            {
                "kind": "weekly_scoped",
                "percent": 4,
                "resets_at": WEEK_RESET,
                "scope": {"model": {"id": None, "display_name": "Model A"}},
            },
            {"kind": "a_kind_not_known_yet", "percent": 1},
            {"kind": "weekly_all", "percent": "not a number"},
        ],
        "spend": {
            "enabled": True,
            "used": {"amount_minor": 1871, "currency": "USD", "exponent": 2},
            "limit": {"amount_minor": 30000, "currency": "USD", "exponent": 2},
            "percent": 6,
        },
    }
).encode()


def ok(body: bytes) -> poll.Fetched:
    return poll.Fetched(200, body)


class FakeTransport:
    """Answers the two paths from queues the test fills; records what each request carried."""

    def __init__(self) -> None:
        self.asked: list[tuple[str, str]] = []
        self.profile: list[poll.Fetched] = []
        self.usage: list[poll.Fetched] = []
        self.asked_event = threading.Event()

    def __call__(self, path: str, token: str) -> poll.Fetched:
        self.asked.append((path, token))
        self.asked_event.set()
        queue = self.profile if path == poll.PROFILE_PATH else self.usage
        if not queue:
            return ok(PROFILE if path == poll.PROFILE_PATH else USAGE)
        return queue.pop(0) if len(queue) > 1 else queue[0]

    def paths(self) -> list[str]:
        return [path for path, _ in self.asked]


class _Profile(unittest.TestCase):
    """A store, a Claude Code home with a sign-in, and a clock the test moves."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        self.claude = self.root / "claude-home"
        self.claude.mkdir()
        environment = mock.patch.dict(
            os.environ, {"VALKAMA_DB": self.path, "CLAUDE_CONFIG_DIR": str(self.claude)}
        )
        environment.start()
        self.addCleanup(environment.stop)
        setup = store.connect()
        setup.close()
        self.conn = ingest.open_light(self.path, store.STORE_SCHEMA_VERSION)
        self.addCleanup(self.conn.close)
        self.now = START
        self.transport = FakeTransport()
        self.sign_in(TOKEN, expires_at=START + dt.timedelta(hours=8))
        self.poller = self.make_poller()

    def open_store(self) -> sqlite3.Connection:
        return ingest.open_light(self.path, store.STORE_SCHEMA_VERSION)

    def make_poller(self, jitter: float = 0.0) -> poll.Poller:
        return poll.Poller(
            transport=self.transport,
            read_login=poll.read_login,
            clock=lambda: self.now,
            jitter=lambda: jitter,
        )

    def sign_in(self, token: str | None, *, expires_at: dt.datetime | None) -> None:
        """What Claude Code writes when it signs in or renews; None removes the file."""

        file = self.claude / ".credentials.json"
        if token is None:
            file.unlink(missing_ok=True)
            return
        oauth: dict[str, object] = {"accessToken": token, "refreshToken": "not-read"}
        if expires_at is not None:
            oauth["expiresAt"] = int(expires_at.timestamp() * 1000)
        file.write_text(json.dumps({"claudeAiOauth": oauth, "mcpOAuth": {}}), encoding="utf-8")

    def advance(self, delta: dt.timedelta) -> None:
        self.now += delta

    def usage_requests(self) -> int:
        return self.transport.paths().count(poll.USAGE_PATH)

    def working(self, session: str, organization: str, at: dt.datetime) -> None:
        """A main-run usage segment of `session`, for `organization`, ending at `at`."""

        stamp = samples.instant(at.isoformat())
        self.conn.execute("BEGIN")
        run = self.conn.execute(
            "INSERT INTO usage_runs(session_id, client, path) VALUES (?,?,?)"
            " ON CONFLICT(session_id, agent_id) DO UPDATE SET path=excluded.path RETURNING id",
            (session, "claude", f"{session}.jsonl"),
        ).fetchone()[0]
        self.conn.execute(
            "INSERT INTO usage_segments(run_id, session_id, started_at, ended_at, seconds,"
            " quality, organization) VALUES (?,?,?,?,0,'observed',?)",
            (run, session, stamp, stamp, organization),
        )
        self.conn.execute("COMMIT")

    def status_line(self, session: str, at: dt.datetime, percent: float) -> None:
        reading = samples.Reading(
            "statusline",
            at.isoformat(),
            (samples.Window("five_hour", percent, "2030-03-05T16:00:00Z"),),
            None,
            session_id=session,
        )
        self.conn.execute("BEGIN")
        samples.record(self.conn, reading, now=self.now)
        self.conn.execute("COMMIT")

    def poll_samples(self) -> list[tuple]:
        return self.conn.execute(
            "SELECT source, organization, account_uuid, seat, kind, model, percent, amount,"
            " currency FROM quota_samples WHERE source = 'poll' ORDER BY kind, model"
        ).fetchall()


class ParseTests(unittest.TestCase):
    def test_a_usage_answer_gives_each_known_window_in_the_store_kinds(self) -> None:
        windows = {(window.kind, window.model): window for window in poll.parse_usage(USAGE)}
        self.assertEqual(
            {
                ("five_hour", None),
                ("week", None),
                ("week_model", "Model A"),
                ("extra_usage", None),
            },
            set(windows),
            "an unknown kind and a percent that is not a number drop only their window",
        )
        week = windows[("week", None)]
        self.assertEqual((81.0, "2030-03-08T09:00:00.239Z"), (week.percent, week.resets_at))
        spend = windows[("extra_usage", None)]
        self.assertEqual((6.0, 18.71, "USD"), (spend.percent, spend.amount, spend.currency))
        self.assertEqual(SEAT, samples.seat_of(windows.values()))

    def test_the_older_buckets_stand_in_when_limits_give_nothing(self) -> None:
        windows = poll.parse_usage(
            b'{"five_hour":{"utilization":96.0,"resets_at":null},"seven_day":{"utilization":"x"}}'
        )
        self.assertEqual((samples.Window("five_hour", 96.0, None),), windows)

    def test_spend_without_a_stated_currency_keeps_none_and_computes_its_share(self) -> None:
        windows = poll.parse_usage(
            b'{"spend":{"enabled":true,"used":{"amount_minor":500},"limit":{"amount_minor":2000}}}'
        )
        self.assertEqual((samples.Window("extra_usage", 25.0, None, amount=5.0),), windows)

    def test_an_answer_that_is_not_a_reading_gives_no_window(self) -> None:
        for body in (b"{}", b"[]", b"<html>", b'{"spend":{"enabled":false}}', b"\xff"):
            with self.subTest(body=body):
                self.assertEqual((), poll.parse_usage(body))

    def test_a_profile_gives_ids_and_a_plan_and_nothing_personal(self) -> None:
        profile = poll.parse_profile(PROFILE)
        self.assertEqual(poll.Profile(ORGANIZATION, ACCOUNT, "Max"), profile)
        self.assertNotIn(EMAIL, json.dumps(asdict(profile)))
        self.assertNotIn(NAME, json.dumps(asdict(profile)))
        # The account's own UUID keys a profile that names no organization.
        self.assertEqual(
            poll.Profile(ACCOUNT, ACCOUNT, None),
            poll.parse_profile(json.dumps({"account": {"uuid": ACCOUNT}}).encode()),
        )
        team = {"account": {"uuid": ACCOUNT}, "organization": {"organization_type": "claude_team"}}
        self.assertEqual("Team", poll.parse_profile(json.dumps(team).encode()).plan)
        self.assertIsNone(poll.parse_profile(b'{"account":{"email":"a@b.c"}}'))

    def test_backoff_doubles_to_half_an_hour_and_honours_a_longer_retry_after(self) -> None:
        minute = dt.timedelta(minutes=1)
        cases = [(1, None, 1), (2, None, 2), (4, None, 8), (10, None, 30), (1, 5, 5), (4, 1, 8)]
        for failures, asked, minutes in cases:
            with self.subTest(failures=failures, asked=asked):
                retry = None if asked is None else asked * minute
                self.assertEqual(minutes * minute, poll.backoff(failures, retry))
        ten = poll.RATE_LIMITED_WAIT
        self.assertEqual(
            [10, 20, 30, 30], [poll.backoff(n, None, ten) // minute for n in range(1, 5)]
        )


class LoginTests(_Profile):
    def test_the_sign_in_gives_its_token_and_expiry_and_never_prints_the_token(self) -> None:
        login = poll.read_login()
        self.assertIsNotNone(login)
        assert login is not None
        self.assertEqual(TOKEN, login.token)
        self.assertEqual(START + dt.timedelta(hours=8), login.expires_at)
        self.assertNotIn(TOKEN, repr(login))
        self.assertNotIn(TOKEN, str(login))
        self.assertNotIn(TOKEN, repr(login.identity))

    def test_a_file_without_a_usable_sign_in_is_no_login(self) -> None:
        file = self.claude / ".credentials.json"
        for text in (
            '{"mcpOAuth":{}}',
            '{"claudeAiOauth":{"accessToken":""}}',
            '{"claudeAiOauth":{"accessToken":42}}',
            '{"claudeAiOauth":{"accessToken":"has a space and\\nnewline"}}',
            "not json",
        ):
            with self.subTest(text=text):
                file.write_text(text, encoding="utf-8")
                self.assertIsNone(poll.read_login())
        file.unlink()
        self.assertIsNone(poll.read_login())

    def test_the_real_transport_asks_api_anthropic_com_over_https(self) -> None:
        connection = poll.HttpsTransport().connect()
        try:
            self.assertIsInstance(connection, http.client.HTTPSConnection)
            self.assertEqual(("api.anthropic.com", 443), (connection.host, connection.port))
        finally:
            connection.close()
        with self.assertRaises(ValueError):
            poll.HttpsTransport()("/v1/messages", TOKEN)


class PollerTests(_Profile):
    def test_a_reading_is_kept_as_the_poll_of_the_organization_and_the_next_waits(self) -> None:
        self.assertTrue(self.poller.step(self.conn))

        self.assertEqual([poll.PROFILE_PATH, poll.USAGE_PATH], self.transport.paths())
        self.assertEqual(poll.OK, self.poller.state)
        self.assertEqual(
            [
                ("poll", ORGANIZATION, ACCOUNT, SEAT, "extra_usage", None, 6.0, 18.71, "USD"),
                ("poll", ORGANIZATION, ACCOUNT, SEAT, "five_hour", None, 2.0, None, None),
                ("poll", ORGANIZATION, ACCOUNT, SEAT, "week", None, 81.0, None, None),
                ("poll", ORGANIZATION, ACCOUNT, SEAT, "week_model", "Model A", 4.0, None, None),
            ],
            self.poll_samples(),
        )
        self.assertEqual(
            [(ORGANIZATION, ACCOUNT, "Max")],
            self.conn.execute("SELECT * FROM quota_accounts").fetchall(),
        )
        # Nobody works for the organization: the idle pace.
        self.assertEqual(START + FIFTEEN_MINUTES, self.poller.next_at)

        self.assertFalse(self.poller.step(self.conn), "not due yet: nothing is asked")
        self.advance(poll.IDLE_INTERVAL)
        self.poller.step(self.conn)
        self.assertEqual(
            [poll.PROFILE_PATH, poll.USAGE_PATH, poll.USAGE_PATH],
            self.transport.paths(),
            "the profile of an unchanged sign-in is asked once",
        )

    def test_an_organization_at_work_is_asked_every_five_minutes(self) -> None:
        self.working("session-1", ORGANIZATION, START - dt.timedelta(minutes=3))
        self.poller.step(self.conn)
        self.assertEqual(START + FIVE_MINUTES, self.poller.next_at)

    def test_the_interval_is_lengthened_by_up_to_a_tenth_at_random(self) -> None:
        self.poller = self.make_poller(jitter=1.0)
        self.poller.step(self.conn)
        self.assertEqual(START + FIFTEEN_MINUTES * 1.1, self.poller.next_at)

    def test_each_request_reads_the_sign_in_again(self) -> None:
        reads: list[str] = []

        def reader() -> poll.Login | None:
            login = poll.read_login()
            reads.append("read")
            return login

        poller = poll.Poller(transport=self.transport, read_login=reader, clock=lambda: self.now)
        poller.step(self.conn)
        self.assertEqual(2, len(reads), "one read for the profile, one for the usage")

    def test_too_many_requests_waits_ten_minutes_then_doubles_and_keeps_the_last_reading(
        self,
    ) -> None:
        self.poller.step(self.conn)
        kept = self.poll_samples()
        self.transport.usage = [poll.Fetched(429, b"", dt.timedelta(0))]

        self.advance(poll.IDLE_INTERVAL)
        self.poller.step(self.conn)
        self.assertEqual(poll.RATE_LIMITED, self.poller.state)
        self.assertEqual(429, self.poller.http_status)
        self.assertEqual(self.now + TEN_MINUTES, self.poller.next_at)
        self.assertEqual(kept, self.poll_samples())

        asked = self.usage_requests()
        self.advance(TEN_MINUTES - dt.timedelta(seconds=1))
        self.poller.step(self.conn)
        self.assertEqual(asked, self.usage_requests(), "the wait is kept")
        self.advance(dt.timedelta(seconds=1))
        self.poller.step(self.conn)
        self.assertEqual(self.now + 2 * TEN_MINUTES, self.poller.next_at)

        self.transport.usage = []
        self.advance(2 * TEN_MINUTES)
        self.poller.step(self.conn)
        self.assertEqual(poll.OK, self.poller.state, "an answer ends the pause")
        self.assertEqual(0, self.poller.failures)

    def test_a_longer_retry_after_is_honoured(self) -> None:
        self.transport.usage = [poll.Fetched(429, b"", dt.timedelta(minutes=25))]
        self.poller.step(self.conn)
        self.assertEqual(self.now + dt.timedelta(minutes=25), self.poller.next_at)

    def test_a_refused_sign_in_is_not_sent_again_until_it_changes(self) -> None:
        self.transport.usage = [poll.Fetched(401, b"{}")]
        self.poller.step(self.conn)
        self.assertEqual((poll.REFUSED, 401), (self.poller.state, self.poller.http_status))
        self.assertEqual(self.now + poll.LOGIN_RECHECK, self.poller.next_at)

        self.advance(poll.IDLE_INTERVAL)
        self.poller.step(self.conn)
        self.assertEqual(1, self.usage_requests(), "the same sign-in in the file is not tried")
        self.assertEqual(poll.REFUSED, self.poller.state)

        # Claude Code signs in again and rewrites the file.
        self.transport.usage = []
        self.sign_in(OTHER_TOKEN, expires_at=START + dt.timedelta(hours=12))
        self.advance(poll.LOGIN_RECHECK)
        self.poller.step(self.conn)
        self.assertEqual(poll.OK, self.poller.state)
        self.assertEqual(
            [poll.PROFILE_PATH, poll.USAGE_PATH],
            [path for path, token in self.transport.asked if token == OTHER_TOKEN],
            "a new sign-in's profile is asked before its usage",
        )

    def test_a_refused_profile_is_a_refused_sign_in_too(self) -> None:
        self.transport.profile = [poll.Fetched(403, b"")]
        self.poller.step(self.conn)
        self.assertEqual(poll.REFUSED, self.poller.state)
        self.assertEqual([poll.PROFILE_PATH], self.transport.paths())

    def test_an_expired_sign_in_is_never_sent_and_its_renewal_is_used(self) -> None:
        self.sign_in(TOKEN, expires_at=START - dt.timedelta(minutes=1))
        self.poller.step(self.conn)
        self.assertEqual(poll.EXPIRED, self.poller.state)
        self.assertEqual([], self.transport.asked)
        self.assertEqual(self.now + poll.LOGIN_RECHECK, self.poller.next_at)

        self.sign_in(OTHER_TOKEN, expires_at=START + dt.timedelta(hours=8))
        self.advance(poll.LOGIN_RECHECK)
        self.poller.step(self.conn)
        self.assertEqual(poll.OK, self.poller.state)
        self.assertEqual({OTHER_TOKEN}, {token for _, token in self.transport.asked})

    def test_a_sign_in_that_expires_after_a_reading_stops_the_requests(self) -> None:
        self.sign_in(TOKEN, expires_at=START + dt.timedelta(minutes=10))
        self.poller.step(self.conn)
        self.advance(poll.IDLE_INTERVAL)
        self.poller.step(self.conn)
        self.assertEqual(poll.EXPIRED, self.poller.state)
        self.assertEqual(1, self.usage_requests())

    def test_no_sign_in_means_no_request(self) -> None:
        self.sign_in(None, expires_at=None)
        self.poller.step(self.conn)
        self.assertEqual(poll.NO_LOGIN, self.poller.state)
        self.assertEqual([], self.transport.asked)

    def test_a_failure_backs_off_from_a_minute(self) -> None:
        self.transport.usage = [poll.Fetched(None, error="ConnectionResetError")]
        self.poller.step(self.conn)
        self.assertEqual(poll.FAILING, self.poller.state)
        self.assertEqual(self.now + poll.FAILURE_WAIT, self.poller.next_at)
        self.transport.usage = [ok(b"<html>")]
        self.advance(poll.FAILURE_WAIT)
        self.poller.step(self.conn)
        self.assertEqual(self.now + 2 * poll.FAILURE_WAIT, self.poller.next_at)
        self.assertEqual([], self.poll_samples())

    def test_a_fresh_status_line_reading_holds_the_poll_to_the_idle_pace(self) -> None:
        self.working("session-1", ORGANIZATION, START - dt.timedelta(minutes=1))
        self.poller.step(self.conn)
        asked_at = self.now
        self.assertEqual(asked_at + poll.ACTIVE_INTERVAL, self.poller.next_at)

        # The session's status line hands in a reading two minutes later.
        self.advance(dt.timedelta(minutes=2))
        self.status_line("session-1", self.now, 3.0)

        self.advance(poll.ACTIVE_INTERVAL - dt.timedelta(minutes=2))
        self.poller.step(self.conn)
        self.assertEqual(1, self.usage_requests(), "the readings cover the five hours")
        self.assertEqual(asked_at + poll.IDLE_INTERVAL, self.poller.next_at)

        self.advance(asked_at + poll.IDLE_INTERVAL - self.now)
        self.poller.step(self.conn)
        self.assertEqual(2, self.usage_requests(), "the idle pace still asks")
        self.assertEqual(self.now + poll.IDLE_INTERVAL, self.poller.next_at)

    def test_a_status_line_of_another_organization_holds_nothing_back(self) -> None:
        self.working("session-1", ORGANIZATION, START - dt.timedelta(minutes=1))
        self.working("session-2", "another-organization", START - dt.timedelta(minutes=1))
        self.poller.step(self.conn)
        self.advance(dt.timedelta(minutes=2))
        self.status_line("session-2", self.now, 3.0)
        self.advance(poll.ACTIVE_INTERVAL - dt.timedelta(minutes=2))
        self.poller.step(self.conn)
        self.assertEqual(2, self.usage_requests())

    def test_a_status_line_reading_older_than_ten_minutes_holds_nothing_back(self) -> None:
        self.working("session-1", ORGANIZATION, START - dt.timedelta(minutes=1))
        self.status_line("session-1", START - poll.FEED_FRESH, 3.0)
        self.poller.step(self.conn)
        self.assertEqual(START + poll.ACTIVE_INTERVAL, self.poller.next_at)


class TokenNeverKeptTests(_Profile):
    """The real transport against a local server, and then every file of the profile."""

    def serve(self, answers: list[tuple[int, bytes]]) -> list[str]:
        """A local server answering in turn; what `Authorization` each request carried."""

        carried: list[str] = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                carried.append(self.headers.get("Authorization", ""))
                if self.path == poll.PROFILE_PATH:
                    status, body = 200, PROFILE
                else:
                    status, body = answers.pop(0) if len(answers) > 1 else answers[0]
                self.send_response(status)
                if status == 429:
                    self.send_header("Retry-After", "0")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args: object) -> None:
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        port = server.server_address[1]
        self.transport = poll.HttpsTransport(  # type: ignore[assignment]
            connect=lambda: http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        )
        return carried

    def files_holding(self, needle: str) -> list[str]:
        found = []
        for path in self.root.rglob("*"):
            if path.is_file():
                data = path.read_bytes()
                if needle.encode() in data or needle.encode("utf-16-le") in data:
                    found.append(str(path.relative_to(self.root)))
        return found

    def test_no_file_of_the_profile_and_no_doctor_answer_holds_the_token(self) -> None:
        carried = self.serve([(200, USAGE), (429, b""), (401, b'{"error":"refused"}')])
        log = self.root / "on-demand.log"
        lines: list[str] = []

        def report(line: str) -> None:
            lines.append(line)
            with open(log, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")

        poller = poll.Poller(
            transport=self.transport, clock=lambda: self.now, jitter=lambda: 0.0, report=report
        )
        with self.conn:
            quota_settings.write(self.conn, {"poll": True})
        for _ in range(4):
            poller.step(self.conn)
            poll.write_status(self.path, poller.status())
            self.advance(poll.MAX_BACKOFF)
        self.assertEqual(poll.REFUSED, poller.state, "it went through a reading, a 429 and a 401")
        self.assertIn(f"Bearer {TOKEN}", carried, "the token did go to the server")
        self.assertTrue(lines, "the report said something")
        spool = Path(self.path).parent / "spool"
        spool.mkdir(exist_ok=True)
        (spool / "unrelated.jsonl").write_text("{}\n", encoding="utf-8")
        self.conn.close()

        self.assertEqual(
            [".credentials.json"],
            [Path(found).name for found in self.files_holding(TOKEN)],
            "only Claude Code's own file holds the token, which shows the search finds it",
        )
        answer = json.dumps(doctor._quota_poll_checks())
        self.assertNotIn(TOKEN, answer)
        self.assertNotIn(EMAIL, answer)
        self.assertEqual([], self.files_holding(EMAIL))
        self.assertEqual([], self.files_holding(NAME))

    def test_a_failed_request_says_its_kind_and_nothing_else(self) -> None:
        class Broken(http.client.HTTPConnection):
            def request(self, *_args: object, **_kwargs: object) -> None:
                raise ConnectionResetError(f"reset while sending Bearer {TOKEN}")

        transport = poll.HttpsTransport(connect=lambda: Broken("127.0.0.1", 9))
        fetched = transport(poll.USAGE_PATH, TOKEN)
        self.assertEqual(poll.Fetched(None, error="ConnectionResetError"), fetched)


class SettingTests(_Profile):
    def test_a_clean_store_reads_off_and_starts_no_poller(self) -> None:
        self.assertEqual({"poll": False}, quota_settings.read(self.conn))
        self.assertIsNone(poll.SUPERVISOR, "no process has a poll it was not given")
        made: list[str] = []
        supervisor = poll.Supervisor(
            self.path,
            lambda _line: None,
            open_store=self.open_store,
            make_poller=lambda _report: made.append("made"),  # type: ignore[func-returns-value]
        )
        supervisor.apply(quota_settings.read(self.conn)["poll"])
        self.assertFalse(supervisor.running)
        self.assertEqual([], made)
        self.assertNotIn(poll.THREAD_NAME, [thread.name for thread in threading.enumerate()])
        self.assertFalse(os.path.exists(poll.status_path(self.path)))

    def test_the_setting_is_held_to_its_shape(self) -> None:
        for payload in ({"poll": "yes"}, {"poll": True, "other": 1}, ["poll"]):
            with self.subTest(payload=payload), self.assertRaises(quota_settings.SettingsError):
                quota_settings.validate(payload)
        self.assertEqual({"poll": True}, quota_settings.write(self.conn, {"poll": True}))
        self.assertEqual({"poll": True}, quota_settings.read(self.conn))
        self.conn.execute("UPDATE quota_settings SET record_json='{\"poll\":1}'")
        self.assertEqual({"poll": False}, quota_settings.read(self.conn), "a broken row is off")


class _Listener(_Profile):
    """A listener on a free port with a supervised poll that asks the fake transport."""

    def setUp(self) -> None:
        super().setUp()
        from server import http_surface

        self.reported: list[str] = []
        supervisor = poll.Supervisor(
            self.path,
            self.reported.append,
            open_store=self.open_store,
            make_poller=lambda said: poll.Poller(
                transport=self.transport, jitter=lambda: 0.0, report=said
            ),
        )
        patch = mock.patch.object(poll, "SUPERVISOR", supervisor)
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(supervisor.stop)
        self.supervisor = supervisor
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        port = mock.patch.dict(os.environ, {"VALKAMA_PORT": str(self.server.server_port)})
        port.start()
        self.addCleanup(port.stop)

    def call(self, method: str, payload: object = None) -> tuple[int, dict]:
        """One request to the settings route, with the browser's credentials."""

        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        headers = {
            "Content-Type": "application/json",
            "Origin": f"http://127.0.0.1:{self.server.server_port}",
            "Sec-Fetch-Site": "same-origin",
            "X-Valkama-Session": self.server.security_context.browser_session_token,
        }
        body = None if payload is None else json.dumps(payload)
        try:
            client.request(method, "/api/quota/settings", body=body, headers=headers)
            response = client.getresponse()
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}
        finally:
            client.close()


def _wait(condition: Callable[[], bool], seconds: float = 10.0) -> bool:
    deadline = threading.Event()
    timer = threading.Timer(seconds, deadline.set)
    timer.start()
    try:
        while not deadline.is_set():
            if condition():
                return True
            deadline.wait(0.02)
        return condition()
    finally:
        timer.cancel()


class SwitchingTests(_Listener):
    def test_switching_on_starts_the_poll_in_the_running_listener_and_off_stops_it(self) -> None:
        self.assertEqual((200, {"poll": False}), self.call("GET"))
        self.assertFalse(self.supervisor.running)

        self.assertEqual((200, {"poll": True}), self.call("PUT", {"poll": True}))
        self.assertTrue(self.transport.asked_event.wait(10), "the poll asked without a restart")
        self.assertTrue(_wait(lambda: self.poll_samples() != []), "and kept its reading")
        self.assertTrue(self.supervisor.running)
        self.assertTrue(_wait(lambda: poll.read_status(self.path) is not None))
        self.assertEqual(poll.OK, poll.read_status(self.path).state)  # type: ignore[union-attr]

        self.assertEqual((200, {"poll": False}), self.call("PUT", {"poll": False}))
        self.assertTrue(_wait(lambda: not self.supervisor.running))
        self.assertTrue(
            _wait(lambda: getattr(poll.read_status(self.path), "state", "") == poll.STOPPED)
        )
        self.assertTrue(
            _wait(lambda: poll.THREAD_NAME not in [thread.name for thread in threading.enumerate()])
        )

    def test_an_unknown_setting_is_a_400_and_writes_nothing(self) -> None:
        status, answer = self.call("PUT", {"poll": True, "interval": 1})
        self.assertEqual(400, status)
        self.assertIn("interval", answer["error"]["message"])
        self.assertEqual((200, {"poll": False}), self.call("GET"))
        self.assertFalse(self.supervisor.running)


class DoctorTests(_Profile):
    def check(self) -> dict:
        (found,) = doctor._quota_poll_checks()
        return found

    def switch_on(self) -> None:
        quota_settings.write(self.conn, {"poll": True})

    def status(self, state: str, http_status: int | None = None) -> None:
        poll.write_status(
            self.path,
            poll.Status(
                state, "2030-03-05T12:00:00.000Z", "2030-03-05T12:10:00.000Z", None, http_status
            ),
        )

    def test_off_on_a_clean_store_says_how_to_switch_it_on_and_what_it_means(self) -> None:
        found = self.check()
        self.assertEqual(("ok", "quota-poll-off"), (found["status"], found["presentation"]["code"]))
        self.assertIn("off", found["detail"])
        self.assertIn("undocumented", found["fix"])

    def test_working(self) -> None:
        self.switch_on()
        self.status(poll.OK, 200)
        found = self.check()
        self.assertEqual(("ok", "quota-poll-ok"), (found["status"], found["presentation"]["code"]))
        self.assertIn("working", found["detail"])

    def test_paused_after_429(self) -> None:
        self.switch_on()
        self.status(poll.RATE_LIMITED, 429)
        found = self.check()
        self.assertEqual(
            ("warn", "quota-poll-rate-limited"), (found["status"], found["presentation"]["code"])
        )
        self.assertIn("429", found["detail"])
        self.assertIn("2030-03-05T12:10:00.000Z", found["detail"], "says when it asks again")
        self.assertTrue(found["fix"])

    def test_sign_in_refused_after_401_and_after_expiry(self) -> None:
        self.switch_on()
        for state, code in ((poll.REFUSED, 401), (poll.EXPIRED, None)):
            with self.subTest(state=state):
                self.status(state, code)
                found = self.check()
                self.assertEqual("warn", found["status"])
                self.assertIn("sign-in refused", found["detail"])
                self.assertIn("Claude Code", found["fix"])

    def test_each_state_the_poll_writes_reports_a_code_of_its_own(self) -> None:
        self.switch_on()
        codes = {}
        for state in poll.STATES:
            with self.subTest(state=state):
                self.status(state)
                codes[state] = self.check()["presentation"]["code"]
        self.assertEqual("quota-poll-not-running", codes.pop(poll.STOPPED))
        self.assertEqual(len(codes), len(set(codes.values())), codes)
        self.assertEqual("quota-poll-no-login", codes[poll.NO_LOGIN])

    def test_switched_on_with_no_listener_polling(self) -> None:
        self.switch_on()
        found = self.check()
        self.assertEqual(
            ("unknown", "quota-poll-not-running"), (found["status"], found["presentation"]["code"])
        )
        self.status(poll.STOPPED)
        self.assertEqual("quota-poll-not-running", self.check()["presentation"]["code"])

    def test_the_doctor_reports_the_group_under_capabilities(self) -> None:
        with mock.patch.object(doctor, "_runtime_checks", return_value=[]):
            report = doctor.diagnose(probe=False)
        (capabilities,) = [level for level in report["levels"] if level["id"] == "capabilities"]
        self.assertIn("quota-poll", [check["id"] for check in capabilities["checks"]])


class StatusWriteTests(unittest.TestCase):
    """A status write lands while a reader has the file open, as the doctor may at any moment.

    Windows refuses to replace a file another handle holds open; a write that gave up then lost
    the state it carried, the last one a stopped poll writes among them.
    """

    def test_every_write_lands_while_a_reader_keeps_reading(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            path = str(Path(root) / "valkama.sqlite3")
            poll.write_status(path, poll.Status(poll.OK, "2030-03-05T12:00:00.000Z"))
            done = threading.Event()

            def read() -> None:
                while not done.is_set():
                    poll.read_status(path)

            reader = threading.Thread(target=read, daemon=True)
            reader.start()
            try:
                for n in range(200):
                    poll.write_status(path, poll.Status(poll.OK, f"2030-03-05T12:00:{n % 60:02}Z"))
                poll.write_status(path, poll.Status(poll.STOPPED, "2030-03-05T12:10:00.000Z"))
            finally:
                done.set()
                reader.join(5)
            self.assertEqual(poll.STOPPED, getattr(poll.read_status(path), "state", None))


if __name__ == "__main__":
    unittest.main()
