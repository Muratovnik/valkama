"""Quota's own tables: the accounts the owner names, the samples every source records, and
the owner's quota settings.

Added with schema 17, and additive: `store.connect()` runs this script against an
upgraded store exactly as against a fresh one, and an upgraded store holds no account
and no sample until a source records one or history is imported. It imports nothing,
because the store's bring-up reads it.

`quota_accounts`: one row per account, an organization and the account's UUID in it, with
the plan a source named and the label the owner gave it. The UUID does not change from
week to week, so the label holds across weeks. Only ids, a plan's short name and the
owner's own label are kept: no e-mail address and no name from a profile.

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


def _listed(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


SCHEMA = f"""
CREATE TABLE IF NOT EXISTS quota_accounts(
    organization TEXT NOT NULL,
    account_uuid TEXT NOT NULL,
    plan TEXT,
    label TEXT,
    PRIMARY KEY(organization, account_uuid)
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
CREATE TABLE IF NOT EXISTS quota_settings(
    key TEXT PRIMARY KEY CHECK(key IN ('poll')),
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
) WITHOUT ROWID;
"""

SCHEMA_TABLES = ("quota_accounts", "quota_samples", "quota_settings")

__all__ = [
    "BY_ORGANIZATION",
    "KINDS",
    "MONEY_KINDS",
    "RETENTION_DAYS",
    "SCHEMA",
    "SCHEMA_TABLES",
    "SOURCES",
]
