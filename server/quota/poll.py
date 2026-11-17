"""The `poll` quota source: the usage endpoint asked for the account Claude Code signs in to.

Off until the owner of the installation switches it on (`quota.settings`): the endpoint
is undocumented, and Anthropic's terms do not explicitly permit this use of it. Only the
listener runs it, in a thread of its own that `Supervisor` starts when the setting is on
and stops when it is switched off, so a clean install never starts it.

The sign-in. Claude Code keeps its login in `.credentials.json` in its home
(`CLAUDE_CONFIG_DIR`, else `~/.claude`): `claudeAiOauth.accessToken`, and `expiresAt` in
milliseconds. The file is read again for every request and the token is held only for
that request: it goes into one `Authorization` header, to `api.anthropic.com` over HTTPS,
and nowhere else -- not the store, the status file, a report line or an exception's text.
The poll never refreshes or rewrites a login; an expired one waits for Claude Code to
refresh it. The Claude desktop app's own login is not read.

Between requests a login is known by its file's modification time and size and the
expiry it states, never by the token or anything made from it. That is enough to ask a
new login's profile once and to leave a refused login alone until the file changes.

The profile gives the organization, which is what the usage rows and every other source
key an account by, the account's UUID and the plan. It also names an e-mail address and a
name; neither is read out of the answer, so neither can reach the store.

The pace follows what the endpoint was seen to tolerate: a request a minute was answered
for about twenty minutes before it refused with 429 and a `Retry-After` of zero, and
refusals then mixed with answers for tens of minutes even at a fifth of that rate. So:

- five minutes while the account works (a usage segment of its organization ended in the
  last ten minutes), fifteen while it does not, each lengthened by up to a tenth at random
  so that two installations do not keep step;
- after a 429, ten minutes, doubled for each refusal in a row up to half an hour, or what
  the server's `Retry-After` asks when that is longer; after any other failure the same
  from one minute;
- a refused sign-in (401 or 403), an expired one or none at all: the file is read again
  each minute, and only a changed login is tried.

While a status line or the mod hands in readings for a session of the organization (one
in the last ten minutes), those already cover the five hours and the week, so the poll
waits out the idle interval from its last request; it then adds a model's week and the
extra usage, which only it reads.

What the poll is doing is written beside the store (`status_path`) for `valkama doctor`,
which runs in another process: the state, when it was reached, when the next request is
due, the last reading's time and the last HTTP status. Nothing in it names the account.
"""

from __future__ import annotations

import datetime as dt
import http.client
import json
import math
import os
import random
import re
import sqlite3
import ssl
import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from email.utils import parsedate_to_datetime
from pathlib import Path

from ..ops import skills
from . import samples, seats
from . import settings as quota_settings

HOST = "api.anthropic.com"
USAGE_PATH = "/api/oauth/usage"
PROFILE_PATH = "/api/oauth/profile"
#: The beta header Claude Code's own `/usage` sends to these two endpoints.
_BETA = "oauth-2025-04-20"
TIMEOUT_SECONDS = 20.0
#: The most of an answer, or of the credentials file, that is read.
_MOST_BYTES = 1 << 20

ACTIVE_INTERVAL = dt.timedelta(minutes=5)
IDLE_INTERVAL = dt.timedelta(minutes=15)
#: The most a regular interval is lengthened at random, as a share of it.
JITTER_SHARE = 0.1
#: How often a missing, expired or refused sign-in is looked at again.
LOGIN_RECHECK = dt.timedelta(minutes=1)
#: The first wait after a 429: the server's own `Retry-After` of zero says nothing.
RATE_LIMITED_WAIT = dt.timedelta(minutes=10)
#: The first wait after any other failure.
FAILURE_WAIT = dt.timedelta(minutes=1)
MAX_BACKOFF = dt.timedelta(minutes=30)
#: A status line or mod reading this recent covers the five hours and the week.
FEED_FRESH = dt.timedelta(minutes=10)
#: A usage segment of the organization that ended this recently makes it a working one.
ACTIVE_WITHIN = dt.timedelta(minutes=10)
#: The sources whose readings hold the poll back, all of them read through a session.
FEED_SOURCES = ("statusline", "mod")
#: The thread, by name, so a test or a diagnosis can find it.
THREAD_NAME = "valkama-quota-poll"

#: What the poll is doing. `waiting` before its first request; `ok` after a reading;
#: `rate_limited` after a 429; `refused` after a 401 or 403; `expired` while the sign-in
#: has expired; `no_login` while there is none; `failing` after any other failure;
#: `stopped` once its thread has ended.
WAITING = "waiting"
OK = "ok"
RATE_LIMITED = "rate_limited"
REFUSED = "refused"
EXPIRED = "expired"
NO_LOGIN = "no_login"
FAILING = "failing"
STOPPED = "stopped"
STATES = (WAITING, OK, RATE_LIMITED, REFUSED, EXPIRED, NO_LOGIN, FAILING, STOPPED)

#: What an access token may be made of. Anything else is no login: a value that could
#: not go into a header unchanged is never sent, and never ends up in a header error.
_TOKEN_TEXT = re.compile(r"[A-Za-z0-9._~+/=-]{8,4096}")
#: An organization's or an account's id, as a sample keeps one.
_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}")
_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._:-]{0,63}")
_CURRENCY = re.compile(r"[A-Z]{3}")
_PLANS = {"claude_team": "Team", "claude_enterprise": "Enterprise"}


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _stamp(moment: dt.datetime | None) -> str | None:
    return None if moment is None else samples.instant(moment.isoformat())


class Login:
    """A Claude Code sign-in as its file holds it, for one request.

    The token is behind a property and out of `repr`, so printing a login, or a
    traceback's account of one, never shows it. `identity` is what the poll remembers
    instead: the file's modification time and size, and the expiry it states.
    """

    __slots__ = ("_token", "expires_at", "identity")

    def __init__(
        self, token: str, expires_at: dt.datetime | None, identity: tuple[int, int, int | None]
    ) -> None:
        self._token = token
        self.expires_at = expires_at
        self.identity = identity

    @property
    def token(self) -> str:
        return self._token

    def expired(self, now: dt.datetime) -> bool:
        return self.expires_at is not None and self.expires_at <= now

    def __repr__(self) -> str:
        return f"Login(expires_at={self.expires_at!r})"

    __str__ = __repr__


def credentials_path() -> Path:
    """Where Claude Code keeps its sign-in for this user."""

    return skills.client_home("claude") / ".credentials.json"


def read_login(path: Path | None = None) -> Login | None:
    """The sign-in in Claude Code's credentials file, or None when there is no usable one."""

    try:
        with open(path or credentials_path(), "rb") as handle:
            stat = os.fstat(handle.fileno())
            raw = handle.read(_MOST_BYTES)
    except OSError:
        return None
    try:
        document = json.loads(raw)
    except (UnicodeDecodeError, ValueError):
        return None
    oauth = document.get("claudeAiOauth") if isinstance(document, dict) else None
    if not isinstance(oauth, dict):
        return None
    token = oauth.get("accessToken")
    if not isinstance(token, str) or not _TOKEN_TEXT.fullmatch(token):
        return None
    expires = oauth.get("expiresAt")
    if isinstance(expires, bool) or not isinstance(expires, int):
        expires = None
    expires_at = None
    if expires is not None:
        try:
            expires_at = dt.datetime.fromtimestamp(expires / 1000, dt.UTC)
        except (OverflowError, OSError, ValueError):
            expires = None
    return Login(token, expires_at, (stat.st_mtime_ns, stat.st_size, expires))


@dataclass(frozen=True)
class Fetched:
    """What one request came back with: a status and a body, or the kind of failure."""

    status: int | None
    body: bytes | None = None
    retry_after: dt.timedelta | None = None
    #: The exception's type alone, never its text.
    error: str | None = None


#: One GET of one of the two paths, with the token: what the poll asks through.
Transport = Callable[[str, str], Fetched]


def _retry_after(value: str | None, now: dt.datetime) -> dt.timedelta | None:
    """A `Retry-After` header as a wait: seconds or an HTTP date; None when neither."""

    if value is None:
        return None
    text = value.strip()
    if text.isdigit():
        return dt.timedelta(seconds=int(text))
    try:
        moment = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if moment.tzinfo is None:
        return None
    return max(moment - now, dt.timedelta(0))


def _connect_to_anthropic() -> http.client.HTTPConnection:
    # Python 3.11's HTTPSConnection, given the default context, verifies the certificate
    # and the host name, which is what the rule asks to be sure of.
    # nosemgrep: python.lang.security.audit.httpsconnection-detected.httpsconnection-detected
    return http.client.HTTPSConnection(
        HOST, 443, timeout=TIMEOUT_SECONDS, context=ssl.create_default_context()
    )


class HttpsTransport:
    """GETs of the usage and profile paths of `api.anthropic.com`, over HTTPS, and nothing else.

    No redirect is followed, so the token goes to that host or nowhere. `connect` is
    for a test that serves the two paths itself; nothing configures it.
    """

    def __init__(self, connect: Callable[[], http.client.HTTPConnection] | None = None) -> None:
        self.connect = connect or _connect_to_anthropic

    def __call__(self, path: str, token: str) -> Fetched:
        if path not in (USAGE_PATH, PROFILE_PATH):
            raise ValueError(f"the poll asks for no path {path!r}")
        connection = self.connect()
        try:
            connection.request(
                "GET",
                path,
                headers={
                    "Authorization": f"Bearer {token}",
                    "anthropic-beta": _BETA,
                    "Accept": "application/json",
                    "User-Agent": "valkama",
                },
            )
            response = connection.getresponse()
            body = response.read(_MOST_BYTES)
            return Fetched(
                response.status, body, _retry_after(response.getheader("Retry-After"), _utc_now())
            )
        except (OSError, http.client.HTTPException) as error:
            return Fetched(None, error=type(error).__name__)
        finally:
            connection.close()


@dataclass(frozen=True)
class Profile:
    """Whose a sign-in is, in what this store may keep: ids and a plan's short name."""

    organization: str
    account_uuid: str | None
    plan: str | None


def _json(body: bytes) -> object:
    try:
        return json.loads(body)
    except (UnicodeDecodeError, ValueError):
        return None


def _id(value: object) -> str | None:
    return value if isinstance(value, str) and _ID.fullmatch(value) else None


def parse_profile(body: bytes) -> Profile | None:
    """The organization, account UUID and plan a profile answer names; None without an id.

    The organization keys the account; the account's own UUID stands in only when a
    profile names no organization. A plan comes only with the account's UUID, as a
    sample keeps it.
    """

    document = _json(body)
    if not isinstance(document, dict):
        return None
    account = document.get("account")
    account = account if isinstance(account, dict) else {}
    organization = document.get("organization")
    organization = organization if isinstance(organization, dict) else {}
    account_uuid = _id(account.get("uuid"))
    key = _id(organization.get("uuid")) or account_uuid
    if key is None:
        return None
    if account.get("has_claude_max") is True:
        plan: str | None = "Max"
    elif account.get("has_claude_pro") is True:
        plan = "Pro"
    else:
        kind = organization.get("organization_type")
        plan = _PLANS.get(kind) if isinstance(kind, str) else None
    return Profile(key, account_uuid, plan if account_uuid is not None else None)


def _percent(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) and number >= 0 else None


def _time(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        return samples.instant(value)
    except samples.SampleError:
        return None


def _model(scope: object) -> str | None:
    if not isinstance(scope, dict) or not isinstance(scope.get("model"), dict):
        return None
    model = scope["model"]
    for name in (model.get("display_name"), model.get("id")):
        if isinstance(name, str) and _MODEL.fullmatch(name):
            return name
    return None


def _money(value: object) -> tuple[float | None, str | None]:
    if not isinstance(value, dict):
        return None, None
    minor, exponent = value.get("amount_minor"), value.get("exponent", 2)
    if isinstance(minor, bool) or not isinstance(minor, int) or minor < 0:
        return None, None
    if isinstance(exponent, bool) or not isinstance(exponent, int) or not 0 <= exponent <= 6:
        return None, None
    currency = value.get("currency")
    stated = currency if isinstance(currency, str) and _CURRENCY.fullmatch(currency) else None
    return minor / 10**exponent, stated


def _spend(document: dict) -> samples.Window | None:
    spend = document.get("spend")
    if not isinstance(spend, dict) or spend.get("enabled") is not True:
        return None
    amount, currency = _money(spend.get("used"))
    if amount is None:
        return None
    limit, _ = _money(spend.get("limit"))
    percent = _percent(spend.get("percent"))
    if percent is None and limit:
        percent = amount / limit * 100
    return samples.Window("extra_usage", percent, None, amount=amount, currency=currency)


def parse_usage(body: bytes) -> tuple[samples.Window, ...]:
    """The windows a usage answer gives, in this store's kinds; none for an unknown answer.

    The endpoint is undocumented, so every field is optional and a field of the wrong
    type drops its window and nothing else. `limits[]` is the current shape; the older
    `five_hour` and `seven_day` buckets stand in when it gives nothing. A window the
    answer names twice is kept as it first came.
    """

    document = _json(body)
    if not isinstance(document, dict):
        return ()
    kinds = samples.SOURCE_WINDOWS["poll"]
    found: dict[tuple[str, str | None], samples.Window] = {}
    limits = document.get("limits")
    for limit in limits if isinstance(limits, list) else ():
        if not isinstance(limit, dict) or not isinstance(limit.get("kind"), str):
            continue
        kind = kinds.get(limit["kind"])
        percent = _percent(limit.get("percent"))
        if kind is None or kind == "extra_usage" or percent is None:
            continue
        model = _model(limit.get("scope")) if kind == "week_model" else None
        if kind == "week_model" and model is None:
            continue
        found.setdefault(
            (kind, model), samples.Window(kind, percent, _time(limit.get("resets_at")), model)
        )
    if not found:
        for name in ("five_hour", "seven_day"):
            bucket = document.get(name)
            percent = _percent(bucket.get("utilization")) if isinstance(bucket, dict) else None
            if isinstance(bucket, dict) and percent is not None:
                kind = kinds[name]
                found[(kind, None)] = samples.Window(kind, percent, _time(bucket.get("resets_at")))
    spend = _spend(document)
    if spend is not None:
        found[("extra_usage", None)] = spend
    return tuple(found.values())


def backoff(
    failures: int, retry_after: dt.timedelta | None, first: dt.timedelta = FAILURE_WAIT
) -> dt.timedelta:
    """`first` doubled for each failure in a row after the first, up to `MAX_BACKOFF`.

    A `Retry-After` the server gives is honoured when it asks for longer.
    """

    doubled = min(first * 2 ** max(0, failures - 1), MAX_BACKOFF)
    return retry_after if retry_after is not None and retry_after > doubled else doubled


def _working(conn: sqlite3.Connection, organization: str, now: dt.datetime) -> bool:
    """Whether a usage segment of the organization ended within `ACTIVE_WITHIN`."""

    since = samples.instant((now - ACTIVE_WITHIN).isoformat())
    row = conn.execute(
        "SELECT 1 FROM usage_segments WHERE organization = ? AND ended_at >= ? LIMIT 1",
        (organization, since),
    ).fetchone()
    return row is not None


#: The latest status line or mod reading of each session since a moment.
_FRESH_FEEDS = (
    "SELECT session_id, MAX(at) FROM quota_samples WHERE source IN (?, ?)"
    " AND at >= ? GROUP BY session_id"
)


def _fed(conn: sqlite3.Connection, organization: str, now: dt.datetime) -> bool:
    """Whether a status line or mod reading for a session of the organization is fresh.

    Those readings name a session, so a session counts for the organization its own
    usage rows say it was working for at its latest reading.
    """

    since = samples.instant((now - FEED_FRESH).isoformat())
    rows = conn.execute(_FRESH_FEEDS, (*FEED_SOURCES, since)).fetchall()
    return any(
        seats.organization_at(conn, str(session), str(at)) == organization for session, at in rows
    )


def _record(conn: sqlite3.Connection, reading: samples.Reading, now: dt.datetime) -> None:
    """Keep a reading in its own transaction, on a connection that commits nothing itself."""

    conn.execute("BEGIN IMMEDIATE")
    try:
        samples.record(conn, reading, now=now)
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


@dataclass(frozen=True)
class Status:
    """What the poll is doing, as `valkama doctor` reads it from beside the store."""

    state: str
    at: str
    next_at: str | None = None
    last_reading_at: str | None = None
    http_status: int | None = None


def status_path(store_path: str) -> str:
    """Where one store's poll says what it is doing: beside it, under its name."""

    return f"{store_path}.quota-poll.json"


#: How long a status write waits for a reader to let the file go. Windows refuses to replace a
#: file another handle holds open, and the doctor may be reading it at that moment; a write that
#: gave up at once lost its state, the last one a stopped poll writes among them.
_REPLACE_SECONDS = 2.0


def write_status(store_path: str, status: Status) -> None:
    """Replace the status file whole, so a reader never sees half of one.

    A reader holding the file open is waited out for at most `_REPLACE_SECONDS`, then the
    refusal is raised as it came.
    """

    path = status_path(store_path)
    partial = f"{path}.partial"
    with open(partial, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(asdict(status), handle, sort_keys=True)
    deadline = time.monotonic() + _REPLACE_SECONDS
    while True:
        try:
            os.replace(partial, path)
            return
        except PermissionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.01)


def read_status(store_path: str) -> Status | None:
    """The status a poll last wrote, or None when there is none it can read."""

    try:
        with open(status_path(store_path), encoding="utf-8") as handle:
            document = json.load(handle)
        status = Status(**document)
    except (OSError, ValueError, TypeError):
        return None
    return status if status.state in STATES else None


_DESCRIBED = {
    WAITING: "waiting for its first request",
    OK: "working",
    RATE_LIMITED: "paused after HTTP 429",
    REFUSED: "the Claude Code sign-in was refused",
    EXPIRED: "the Claude Code sign-in has expired",
    NO_LOGIN: "no Claude Code sign-in on this machine",
    FAILING: "the usage endpoint did not answer with a reading",
    STOPPED: "stopped",
}


class Poller:
    """The poll's state and its one step; the clock, the transport and the login are given.

    Nothing here waits: `step` does what is due at the clock's moment, and `next_at`
    says when the next step has something to do.
    """

    def __init__(
        self,
        *,
        transport: Transport,
        read_login: Callable[[], Login | None] = read_login,
        clock: Callable[[], dt.datetime] = _utc_now,
        jitter: Callable[[], float] = random.random,  # noqa: S311 -- spreads requests, guards nothing
        report: Callable[[str], None] = lambda _line: None,
    ) -> None:
        self._transport = transport
        self._read_login = read_login
        self._clock = clock
        self._jitter = jitter
        self._report = report
        self.state = WAITING
        self.at = clock()
        self.next_at = self.at
        self.failures = 0
        self.http_status: int | None = None
        self.asked_at: dt.datetime | None = None
        self.last_reading_at: dt.datetime | None = None
        self._profile: Profile | None = None
        self._profile_of: tuple[int, int, int | None] | None = None
        self._refused: tuple[int, int, int | None] | None = None

    def status(self) -> Status:
        return Status(
            self.state,
            str(_stamp(self.at)),
            _stamp(self.next_at),
            _stamp(self.last_reading_at),
            self.http_status,
        )

    def hold(self, wait: dt.timedelta) -> None:
        """Ask nothing for `wait`: after a pass that failed for a reason of this process."""

        self.next_at = self._clock() + wait

    def _settle(self, state: str, wait: dt.timedelta, http_status: int | None = None) -> None:
        now = self._clock()
        if state != self.state:
            self._report(f"quota poll: {_DESCRIBED[state]}")
            self.at = now
        self.state = state
        self.http_status = http_status
        self.next_at = now + wait

    def _fail(self, state: str, fetched: Fetched, first: dt.timedelta) -> None:
        self.failures += 1
        self._settle(state, backoff(self.failures, fetched.retry_after, first), fetched.status)

    def _login(self, now: dt.datetime) -> Login | None:
        """The sign-in to ask with now; None, with the state settled, when there is none."""

        login = self._read_login()
        if login is None:
            self._settle(NO_LOGIN, LOGIN_RECHECK)
        elif login.expired(now):
            self._settle(EXPIRED, LOGIN_RECHECK)
        elif login.identity == self._refused:
            self._settle(REFUSED, LOGIN_RECHECK, self.http_status)
        else:
            return login
        return None

    def _answered(self, fetched: Fetched, identity: tuple[int, int, int | None]) -> bool:
        """Whether a request came back with a body; otherwise the state it leaves is settled."""

        if fetched.status == 200 and fetched.body is not None:
            return True
        if fetched.status in (401, 403):
            # Signed out, or replaced by a newer sign-in: this one is not tried again.
            self._refused = identity
            self._profile = self._profile_of = None
            self.failures = 0
            self._settle(REFUSED, LOGIN_RECHECK, fetched.status)
        elif fetched.status == 429:
            self._fail(RATE_LIMITED, fetched, RATE_LIMITED_WAIT)
        else:
            self._fail(FAILING, fetched, FAILURE_WAIT)
        return False

    def _covered(self, conn: sqlite3.Connection, organization: str, now: dt.datetime) -> bool:
        """Whether fresh session readings make a request at the working pace unnecessary."""

        return (
            self.state == OK
            and self.asked_at is not None
            and now < self.asked_at + IDLE_INTERVAL
            and _fed(conn, organization, now)
        )

    def step(self, conn: sqlite3.Connection) -> bool:
        """Do what is due now; whether anything was asked or the schedule moved.

        `conn` is a store connection that commits nothing on its own; a reading is kept
        in a transaction of its own.
        """

        now = self._clock()
        if now < self.next_at:
            return False
        login = self._login(now)
        if login is None:
            return True
        if self._profile is None or self._profile_of != login.identity:
            identity = login.identity
            fetched = self._transport(PROFILE_PATH, login.token)
            if not self._answered(fetched, identity):
                return True
            profile = parse_profile(fetched.body or b"")
            if profile is None:
                self._fail(FAILING, fetched, FAILURE_WAIT)
                return True
            self._profile, self._profile_of = profile, identity
            # The file is read again for the next request: a token serves one.
            login = self._login(self._clock())
            if login is None:
                return True
        profile = self._profile
        if self._covered(conn, profile.organization, now):
            self.next_at = (self.asked_at or now) + IDLE_INTERVAL
            return True
        identity = login.identity
        self.asked_at = now
        fetched = self._transport(USAGE_PATH, login.token)
        if not self._answered(fetched, identity):
            return True
        windows = parse_usage(fetched.body or b"")
        now = self._clock()
        reading = samples.Reading(
            "poll",
            now.isoformat(),
            windows,
            samples.seat_of(windows),
            organization=profile.organization,
            plan=profile.plan,
            account_uuid=profile.account_uuid,
        )
        try:
            if not windows:
                raise samples.SampleError("an answer with no window")
            _record(conn, reading, now)
        except samples.SampleError:
            self._fail(FAILING, fetched, FAILURE_WAIT)
            return True
        self.failures = 0
        self.last_reading_at = now
        working = _working(conn, profile.organization, now)
        interval = (
            ACTIVE_INTERVAL
            if working and not _fed(conn, profile.organization, now)
            else IDLE_INTERVAL
        )
        self._settle(OK, interval * (1 + JITTER_SHARE * self._jitter()), fetched.status)
        return True


#: The longest the thread sleeps between looks at its setting and its schedule.
_LONGEST_PAUSE = 60.0
#: How long switching the poll on waits for a thread still stopping.
_STOP_SECONDS = TIMEOUT_SECONDS * 2 + 5


class Supervisor:
    """Starts and stops the poll's thread in the listener as the owner's setting says.

    A thread exists only while the setting is on. It reads the setting before each pass,
    so a setting switched off ends it within a minute even when nothing told it; the
    Settings page's write tells it at once (`apply`).

    `open_store` opens the thread's own connection to the store at `store_path`, one that
    commits nothing on its own; the surface that starts the listener supplies it, so
    this module needs nothing of the store's bring-up.
    """

    def __init__(
        self,
        store_path: str,
        report: Callable[[str], None],
        *,
        open_store: Callable[[], sqlite3.Connection],
        make_poller: Callable[[Callable[[str], None]], Poller] | None = None,
    ) -> None:
        self._path = store_path
        self._open_store = open_store
        self._report = report
        self._make_poller = make_poller or (
            lambda said: Poller(transport=HttpsTransport(), report=said)
        )
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    @property
    def running(self) -> bool:
        thread = self._thread
        return thread is not None and thread.is_alive() and not self._stop.is_set()

    def apply(self, on: bool) -> None:
        """Start the thread when `on` and none runs; stop it when not `on`."""

        with self._lock:
            thread = self._thread
            if not on:
                self._stop.set()
                return
            if thread is not None and thread.is_alive():
                if not self._stop.is_set():
                    return
                thread.join(_STOP_SECONDS)
            self._stop = threading.Event()
            self._thread = threading.Thread(
                target=self._run, args=(self._stop,), name=THREAD_NAME, daemon=True
            )
            self._thread.start()

    def stop(self, wait: float = 5.0) -> None:
        """End the thread, waiting up to `wait` seconds for a pass under way."""

        with self._lock:
            thread = self._thread
            self._stop.set()
        if thread is not None:
            thread.join(wait)

    def _run(self, stop: threading.Event) -> None:
        poller = self._make_poller(self._report)
        conn: sqlite3.Connection | None = None
        said = ""
        try:
            while not stop.is_set():
                try:
                    if conn is None:
                        conn = self._open_store()
                    if not quota_settings.read(conn)["poll"]:
                        return
                    if poller.step(conn):
                        write_status(self._path, poller.status())
                    said = ""
                except Exception as error:  # noqa: BLE001 -- a background thread has nobody to raise to
                    # The type alone: no text an exception carries is repeated here.
                    text = type(error).__name__
                    if text != said:
                        self._report(f"quota poll did not finish a pass: {text}")
                        said = text
                    poller.hold(LOGIN_RECHECK)
                    if conn is not None:
                        conn.close()
                        conn = None
                pause = (poller.next_at - _utc_now()).total_seconds()
                if stop.wait(min(max(pause, 1.0), _LONGEST_PAUSE)):
                    return
        finally:
            if conn is not None:
                conn.close()
            try:
                write_status(self._path, Status(STOPPED, str(_stamp(_utc_now()))))
            except OSError:
                pass  # the doctor then reads the last state the thread wrote


#: The listener's supervisor, set by the surface that starts it; None in every other
#: process. Read it through this module, so a test that swaps it reaches every caller.
SUPERVISOR: Supervisor | None = None


def apply_setting(on: bool) -> None:
    """Tell this process's poll what the owner just set; nothing where none is supervised."""

    supervisor = SUPERVISOR
    if supervisor is not None:
        supervisor.apply(on)


__all__ = [
    "ACTIVE_INTERVAL",
    "FEED_FRESH",
    "HOST",
    "IDLE_INTERVAL",
    "LOGIN_RECHECK",
    "MAX_BACKOFF",
    "PROFILE_PATH",
    "RATE_LIMITED_WAIT",
    "STATES",
    "SUPERVISOR",
    "USAGE_PATH",
    "Fetched",
    "HttpsTransport",
    "Login",
    "Poller",
    "Profile",
    "Status",
    "Supervisor",
    "apply_setting",
    "backoff",
    "credentials_path",
    "parse_profile",
    "parse_usage",
    "read_login",
    "read_status",
    "status_path",
    "write_status",
]
