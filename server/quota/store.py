"""Quota's own tables: the accounts the sources name, the owner's names for them, the
samples every source records, the alerts the owner was given and the owner's quota
settings.

Added with schema 17, and additive: `store.connect()` runs this script against an
upgraded store exactly as against a fresh one, and an upgraded store holds no account
and no sample until a source records one or history is imported, and no name until the
owner gives one. It imports nothing, because the store's bring-up reads it.

`quota_accounts`: one row per account, an organization and the account's UUID in it, with
the plan a source named. The UUID does not change from week to week, so the row holds
across weeks. Only ids and a plan's short name are kept: no e-mail address and no name
from a profile.

`quota_account_names`: the owner's name for an account, one row per organization, written
from Settings and read by every device and by the quota alerts (`quota.names`). No source
writes it. A name is one line of 1 to `MAX_NAME_LENGTH` characters; an organization with
no name has no row.

`quota_samples`: one row per reading of one window that differed from the reading before
it in its series, never rewritten. A series is what the sample is identified by (the
organization for `poll` and `import`, the session for `statusline` and `mod`), its
account where the source named one, its seat, its window kind and, for a week of one
model, the model. Rows older than a year are deleted by the start-up housekeeping
(`samples.prune`).

- `at` and `resets_at` are UTC times to the millisecond, `2030-03-04T09:00:00.000Z`, the
  form the usage rows keep, so a time comparison is a text comparison.
- `account_uuid` is the account's UUID where the source gave it, which only an
  organization's reading does; NULL otherwise, and such a sample's account is read from
  its seat (`seats.account_of_seat`).
- `seat` is `week:<the week's reset, to the nearest ten minutes>`; NULL where the reading
  showed no week, or where imported history said none. It tells the seats of one
  organization apart within one week.
- `percent` is the share of the window spent, 0 to 100 and past 100 only where a source
  reports an overrun; `amount` and `currency` are money spent, for the two kinds that
  carry money, and a currency the source did not state is NULL, never a guess.

`quota_alerts`: one row per alert the owner was given about a window running out
(`alerts.quota`), so a restart does not give it again. A row is the alert's key: the
account, as its organization and its seat, the window (its kind and, for a model's week,
the model, `''` for none), the reset the window named and the level. `account_uuid` is the
account's UUID where it was known when the alert was raised, NULL for a provisional seat;
it is not part of the key, so learning it later does not raise the same alert again. A row
whose window has reset can match no reading any more, and the next evaluation deletes it.

`quota_settings`: the owner's settings for the quota sources, one row a key; no row means
the defaults `quota.settings` keeps. `poll` holds whether the poll of the usage endpoint
runs, which it does not until the owner switches it on.
"""

from __future__ import annotations

#: The window kinds a sample may be of, in the order a reader lists them: the five-hour
#: window, the week, the week of one model, the usage credits past the plan's limits,
#: and a gateway's spend limit.
KINDS = ("five_hour", "week", "week_model", "extra_usage", "spend_limit")
#: The kinds that may carry money beside, or instead of, a percentage.
MONEY_KINDS = ("extra_usage", "spend_limit")
#: Where a sample came from: the status line command, the Claude Code mod, the poll of
#: the usage endpoint, and history imported from a file.
SOURCES = ("statusline", "mod", "poll", "import")
#: The sources whose samples name an organization; the others name a session.
BY_ORGANIZATION = ("poll", "import")
#: How long a sample is kept.
RETENTION_DAYS = 365
#: The windows an alert is raised for, and its levels: a share of a week spent, or the
#: five-hour window forecast to run out before its reset.
ALERT_KINDS = ("five_hour", "week", "week_model")
ALERT_LEVELS = ("75", "90", "exhausted")
#: The longest name the owner may give an account, and the longest organization id, as
#: the usage read bounds one.
MAX_NAME_LENGTH = 80
MAX_ORGANIZATION_LENGTH = 512


def _listed(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


SCHEMA = f"""
CREATE TABLE IF NOT EXISTS quota_accounts(
    organization TEXT NOT NULL,
    account_uuid TEXT NOT NULL,
    plan TEXT,
    PRIMARY KEY(organization, account_uuid)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS quota_account_names(
    organization TEXT PRIMARY KEY CHECK(length(organization) BETWEEN 1 AND {MAX_ORGANIZATION_LENGTH}),
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND {MAX_NAME_LENGTH}),
    updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS quota_samples(
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ({_listed(SOURCES)})),
    organization TEXT,
    session_id TEXT,
    account_uuid TEXT,
    seat TEXT,
    kind TEXT NOT NULL CHECK(kind IN ({_listed(KINDS)})),
    model TEXT,
    percent REAL,
    resets_at TEXT,
    amount REAL,
    currency TEXT,
    CHECK((source IN ({_listed(BY_ORGANIZATION)})) = (organization IS NOT NULL)),
    CHECK((organization IS NULL) = (session_id IS NOT NULL)),
    CHECK(account_uuid IS NULL OR organization IS NOT NULL),
    CHECK((kind = 'week_model') = (model IS NOT NULL)),
    CHECK(kind IN ({_listed(MONEY_KINDS)}) OR (amount IS NULL AND currency IS NULL)),
    CHECK(percent IS NOT NULL OR amount IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS quota_samples_organization
    ON quota_samples(organization, at) WHERE organization IS NOT NULL;
CREATE INDEX IF NOT EXISTS quota_samples_session
    ON quota_samples(session_id, at) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quota_samples_at ON quota_samples(at);
CREATE INDEX IF NOT EXISTS quota_samples_account_seat
    ON quota_samples(organization, seat) WHERE account_uuid IS NOT NULL;
CREATE TABLE IF NOT EXISTS quota_alerts(
    organization TEXT NOT NULL,
    seat TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ({_listed(ALERT_KINDS)})),
    model TEXT NOT NULL,
    resets_at TEXT NOT NULL,
    level TEXT NOT NULL CHECK(level IN ({_listed(ALERT_LEVELS)})),
    account_uuid TEXT,
    sample_at TEXT NOT NULL,
    raised_at TEXT NOT NULL,
    CHECK((kind = 'week_model') = (model != '')),
    PRIMARY KEY(organization, seat, kind, model, resets_at, level)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS quota_settings(
    key TEXT PRIMARY KEY CHECK(key IN ('poll')),
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
) WITHOUT ROWID;
"""

SCHEMA_TABLES = (
    "quota_accounts",
    "quota_account_names",
    "quota_samples",
    "quota_alerts",
    "quota_settings",
)

__all__ = [
    "ALERT_KINDS",
    "ALERT_LEVELS",
    "BY_ORGANIZATION",
    "KINDS",
    "MAX_NAME_LENGTH",
    "MAX_ORGANIZATION_LENGTH",
    "MONEY_KINDS",
    "RETENTION_DAYS",
    "SCHEMA",
    "SCHEMA_TABLES",
    "SOURCES",
]
