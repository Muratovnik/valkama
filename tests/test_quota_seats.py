"""The seat and account of a usage segment, joined at read time from the quota samples.

The rule held here, stated from the contract rather than read from the code under test:
samples are kept only on a change, so a seat is a state. A feed (one session, or the
organization's poll and imports of one account, in one window) says the seat of its latest
sample at or before the segment's end until that window resets or the seat's week ends.
The segment's own session's most recent feed still holding at its start names the seat;
with none holding, the session's next sample after the segment does, in the same week and
organization; else the organization's other feeds do, where all of them are one account's.

A sample's account comes from every sample of its seat (`accounts.Resolver`): its own UUID;
else a UUID of its organization naming the seat; else the one UUID of any organization
naming it; else, in the organization most of its samples were read for, the account whose
week resets at that time of week in the nearest week, or the account known by its weekly
reset alone. Two counters under one seat leave each sample in its own organization, marked
shared. Every id and time is invented.
"""

from __future__ import annotations

import datetime as dt
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store
from server.quota import accounts, samples, seats

NOW = dt.datetime(2030, 3, 20, tzinfo=dt.UTC)
ORGANIZATION = "org-1"
OTHER = "org-2"
SESSION = "session-1"
OTHER_SESSION = "session-2"
#: Two seats of the week that resets on Friday 2030-03-08, at 09:00 and at 19:00.
SEAT_A = "week:2030-03-08T09:00Z"
SEAT_B = "week:2030-03-08T19:00Z"
WEEK_A = "2030-03-08T09:00:00Z"
WEEK_B = "2030-03-08T19:00:00Z"
#: The week before and the week after, at SEAT_A's time of week.
SEAT_A_BEFORE = "week:2030-03-01T09:00Z"
SEAT_A_AFTER = "week:2030-03-15T09:00Z"
ACCOUNT_A = "account-a"
ACCOUNT_B = "account-b"
#: The segment most tests read: from 10:00 to 10:20.
START, END = "2030-03-04T10:00:00.000Z", "2030-03-04T10:20:00.000Z"


def weekly(
    seat: str, organization: str = ORGANIZATION, *, shared: bool = False
) -> accounts.Account:
    """The account known only by the time of week `seat`'s week resets."""

    return accounts.Account(organization, None, accounts.weekly_reset(seat), shared)


def by_uuid(uuid: str, seat: str, organization: str = ORGANIZATION) -> accounts.Account:
    return accounts.Account(organization, uuid, accounts.weekly_reset(seat))


class _Seats(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": str(Path(directory.name) / "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.runs = 0
        self.working(SESSION, ORGANIZATION, "2030-03-04T00:00:00.000Z")

    def working(self, session: str, organization: str | None, started_at: str) -> None:
        """A main-run segment of `session`, working for `organization` from `started_at`."""

        with self.conn:
            run = self.conn.execute(
                "SELECT id FROM usage_runs WHERE session_id = ? AND agent_id = ''", (session,)
            ).fetchone()
            if run is None:
                self.runs += 1
                self.conn.execute(
                    "INSERT INTO usage_runs(id, session_id, client, path) VALUES (?,?,?,?)",
                    (self.runs, session, "claude", f"{session}.jsonl"),
                )
                run_id = self.runs
            else:
                run_id = run[0]
            self.conn.execute(
                "INSERT INTO usage_segments(run_id, session_id, started_at, ended_at, seconds,"
                " quality, organization) VALUES (?,?,?,?,0,'observed',?)",
                (run_id, session, started_at, started_at, organization),
            )

    def sample(
        self,
        at: str,
        seat: str | None,
        *,
        session: str | None = SESSION,
        organization: str | None = None,
        kind: str = "week",
        resets_at: str | None = WEEK_A,
        account: str | None = None,
        percent: float = 40,
    ) -> None:
        source = "mod" if session is not None else "poll"
        reading = samples.Reading(
            source,
            at,
            (samples.Window(kind, percent, resets_at),),
            seat,
            organization=organization,
            session_id=session,
            account_uuid=account,
        )
        with self.conn:
            self.assertEqual(1, samples.record(self.conn, reading, now=NOW))

    def poll(self, at: str, seat: str | None, **fields: object) -> None:
        fields.setdefault("organization", ORGANIZATION)
        self.sample(at, seat, session=None, **fields)  # type: ignore[arg-type]

    def seat(
        self,
        organization: str | None = ORGANIZATION,
        start: str = START,
        end: str = END,
        session: str = SESSION,
    ) -> seats.Seat:
        return seats.seat_of_segment(
            self.conn,
            session_id=session,
            organization=organization,
            started_at=start,
            ended_at=end,
        )

    def account_of(self, at: str) -> accounts.Account | None:
        """The account `account_samples` gives the sample made at `at`."""

        found = [
            one.account
            for one in seats.account_samples(
                self.conn, "2030-01-01T00:00:00.000Z", ("week", "five_hour")
            )
            if one.at == samples.instant(at)
        ]
        return found[0] if found else None


class SeatOfSegmentTests(_Seats):
    def test_a_seat_holds_through_a_quiet_stretch_until_its_window_resets(self) -> None:
        # Four hours with no sample: nothing changed, so the seat still stands.
        self.sample("2030-03-04T06:00:00Z", SEAT_A)
        self.assertEqual(
            seats.Seat(SEAT_A, "session", "2030-03-04T06:00:00.000Z", weekly(SEAT_A)), self.seat()
        )
        # Days later, still inside the week the seat names.
        later = self.seat(start="2030-03-07T22:00:00Z", end="2030-03-07T22:10:00Z")
        self.assertEqual(SEAT_A, later.seat)
        # Past the week's reset it no longer does.
        past = self.seat(start="2030-03-08T09:00:00Z", end="2030-03-08T09:10:00Z")
        self.assertEqual(seats.UNKNOWN, past)

    def test_a_window_that_reset_before_the_segment_names_no_seat(self) -> None:
        # The five hours reset at 09:00, before the segment, and nothing came after.
        self.sample(
            "2030-03-04T07:00:00Z", SEAT_A, kind="five_hour", resets_at="2030-03-04T09:00:00Z"
        )
        self.assertEqual(seats.UNKNOWN, self.seat())
        # A reset inside the segment: the seat held when it began.
        self.assertEqual(
            SEAT_A, self.seat(start="2030-03-04T08:50:00Z", end="2030-03-04T09:10:00Z").seat
        )
        # A reset exactly at the segment's start already ended it.
        self.assertEqual(
            seats.UNKNOWN, self.seat(start="2030-03-04T09:00:00Z", end="2030-03-04T09:10:00Z")
        )

    def test_a_sample_with_no_reset_holds_until_its_seat_s_week_ends(self) -> None:
        self.sample("2030-03-04T08:00:00Z", "week:2030-03-04T09:30Z", resets_at=None)
        self.assertEqual(seats.UNKNOWN, self.seat())
        self.assertEqual(
            "week:2030-03-04T09:30Z",
            self.seat(start="2030-03-04T09:20:00Z", end="2030-03-04T09:25:00Z").seat,
        )

    def test_the_next_sample_of_a_feed_replaces_the_seat_it_said(self) -> None:
        self.sample("2030-03-04T08:00:00Z", SEAT_A)
        self.sample("2030-03-04T09:30:00Z", SEAT_B, resets_at=WEEK_B)
        self.assertEqual(
            seats.Seat(SEAT_B, "session", "2030-03-04T09:30:00.000Z", weekly(SEAT_B)), self.seat()
        )
        # Before the switch the segment was on the first seat.
        earlier = self.seat(start="2030-03-04T09:00:00Z", end="2030-03-04T09:10:00Z")
        self.assertEqual(
            seats.Seat(SEAT_A, "session", "2030-03-04T08:00:00.000Z", weekly(SEAT_A)), earlier
        )
        # And back again.
        self.sample("2030-03-04T10:30:00Z", SEAT_A, percent=41)
        after = self.seat(start="2030-03-04T11:00:00Z", end="2030-03-04T11:10:00Z")
        self.assertEqual(
            seats.Seat(SEAT_A, "session", "2030-03-04T10:30:00.000Z", weekly(SEAT_A)), after
        )

    def test_a_feed_whose_latest_sample_lapsed_does_not_fall_back_to_an_earlier_one(
        self,
    ) -> None:
        self.sample("2030-03-04T07:00:00Z", SEAT_A)
        # The same feed then names another seat, whose week ended at 09:30.
        ended = "week:2030-03-04T09:30Z"
        self.sample("2030-03-04T09:00:00Z", ended, resets_at="2030-03-04T09:30:00Z")
        self.assertEqual(seats.UNKNOWN, self.seat())
        self.assertEqual(
            ended, self.seat(start="2030-03-04T09:20:00Z", end="2030-03-04T09:25:00Z").seat
        )

    def test_of_the_feeds_holding_the_most_recent_names_the_seat(self) -> None:
        self.sample("2030-03-04T08:00:00Z", SEAT_A)
        self.sample(
            "2030-03-04T09:00:00Z", SEAT_B, kind="five_hour", resets_at="2030-03-04T13:00:00Z"
        )
        self.assertEqual(
            seats.Seat(SEAT_B, "session", "2030-03-04T09:00:00.000Z", weekly(SEAT_B)), self.seat()
        )
        # Once the five hours reset, the week's feed is the one still holding.
        late = self.seat(start="2030-03-04T14:00:00Z", end="2030-03-04T14:10:00Z")
        self.assertEqual(
            seats.Seat(SEAT_A, "session", "2030-03-04T08:00:00.000Z", weekly(SEAT_A)), late
        )

    def test_with_none_before_its_end_the_session_s_next_sample_names_the_seat(self) -> None:
        # A reading is taken as a turn ends: the first after the segment names who served it.
        self.sample("2030-03-04T10:25:00Z", SEAT_A)
        self.sample("2030-03-04T11:00:00Z", SEAT_B, resets_at=WEEK_B)
        self.assertEqual(
            seats.Seat(SEAT_A, "session", "2030-03-04T10:25:00.000Z", weekly(SEAT_A)), self.seat()
        )
        # Another identity's later sample is no such reading.
        self.assertEqual(seats.UNKNOWN, self.seat(session=OTHER_SESSION))

    def test_the_next_sample_says_nothing_of_another_week_or_organization(self) -> None:
        # The session's next reading names a week that began after the segment ended.
        self.sample("2030-03-08T10:00:00Z", SEAT_A_AFTER, resets_at="2030-03-15T09:00:00Z")
        self.assertEqual(seats.UNKNOWN, self.seat())
        # A segment of another organization than the one that reading counts for.
        later = self.seat(OTHER, start="2030-03-08T09:30:00Z", end="2030-03-08T09:40:00Z")
        self.assertEqual(seats.UNKNOWN, later)
        self.assertEqual(
            SEAT_A_AFTER,
            self.seat(start="2030-03-08T09:30:00Z", end="2030-03-08T09:40:00Z").seat,
        )

    def test_a_sample_during_the_segment_names_its_seat(self) -> None:
        self.sample("2030-03-04T10:20:00Z", SEAT_A)
        found = self.seat()
        self.assertEqual(
            (SEAT_A, "session", "2030-03-04T10:20:00.000Z", weekly(SEAT_A)),
            (found.seat, found.basis, found.sample_at, found.account),
        )

    def test_the_own_session_comes_before_a_more_recent_sample_of_the_organization(
        self,
    ) -> None:
        self.sample("2030-03-04T07:40:00Z", SEAT_A)
        self.poll("2030-03-04T10:10:00Z", SEAT_B, resets_at=WEEK_B)
        self.assertEqual(
            seats.Seat(SEAT_A, "session", "2030-03-04T07:40:00.000Z", weekly(SEAT_A)), self.seat()
        )

    def test_with_no_feed_of_its_own_the_organization_s_one_account_names_the_seat(self) -> None:
        self.sample(
            "2030-03-04T07:00:00Z", SEAT_A, kind="five_hour", resets_at="2030-03-04T08:00:00Z"
        )
        self.poll("2030-03-04T06:30:00Z", SEAT_B, resets_at=WEEK_B)
        self.sample("2030-03-04T09:05:00Z", SEAT_A, session=None, organization=OTHER)
        self.assertEqual(
            seats.Seat(SEAT_B, "organization", "2030-03-04T06:30:00.000Z", weekly(SEAT_B)),
            self.seat(),
        )

    def test_feeds_of_two_accounts_of_the_organization_name_no_seat(self) -> None:
        # Two accounts of the organization read this week: either may have spent the work.
        self.poll("2030-03-04T06:30:00Z", SEAT_B, resets_at=WEEK_B, account=ACCOUNT_B)
        self.poll("2030-03-04T07:30:00Z", SEAT_A, account=ACCOUNT_A)
        self.assertEqual(seats.UNKNOWN, self.seat(session=OTHER_SESSION))
        # One of them read again is still one of two.
        self.poll("2030-03-04T09:30:00Z", SEAT_B, resets_at=WEEK_B, account=ACCOUNT_B, percent=41)
        self.assertEqual(seats.UNKNOWN, self.seat(session=OTHER_SESSION))
        # The session's own feed still says which.
        self.sample("2030-03-04T09:00:00Z", SEAT_A, session=OTHER_SESSION)
        self.working(OTHER_SESSION, ORGANIZATION, "2030-03-04T00:00:00.000Z")
        self.assertEqual(by_uuid(ACCOUNT_A, SEAT_A), self.seat(session=OTHER_SESSION).account)

    def test_another_session_counts_only_while_it_worked_for_the_organization(self) -> None:
        self.working("session-2", ORGANIZATION, "2030-03-04T09:00:00.000Z")
        self.working("session-3", OTHER, "2030-03-04T09:00:00.000Z")
        self.sample("2030-03-04T09:50:00Z", SEAT_A, session="session-3")
        self.assertEqual(seats.UNKNOWN, self.seat())
        self.sample("2030-03-04T09:40:00Z", SEAT_B, session="session-2", resets_at=WEEK_B)
        self.assertEqual(
            seats.Seat(SEAT_B, "organization", "2030-03-04T09:40:00.000Z", weekly(SEAT_B)),
            self.seat(),
        )

    def test_its_own_feed_after_a_change_of_organization_says_nothing_for_the_first(
        self,
    ) -> None:
        self.sample("2030-03-04T08:00:00Z", SEAT_A)
        self.working(SESSION, OTHER, "2030-03-04T09:00:00.000Z")
        self.sample("2030-03-04T09:10:00Z", SEAT_B, resets_at=WEEK_B)
        self.assertEqual(seats.UNKNOWN, self.seat())
        # The organization it moved to reads that sample as its own.
        self.assertEqual(
            seats.Seat(SEAT_B, "session", "2030-03-04T09:10:00.000Z", weekly(SEAT_B, OTHER)),
            self.seat(OTHER),
        )

    def test_a_sample_without_a_seat_names_none(self) -> None:
        self.sample("2030-03-04T10:05:00Z", None)
        self.poll("2030-03-04T10:06:00Z", None)
        self.assertEqual(seats.UNKNOWN, self.seat())
        self.assertEqual(seats.Seat(None, None, None, None), seats.UNKNOWN)

    def test_a_segment_with_no_organization_is_on_a_seat_unknown(self) -> None:
        self.sample("2030-03-04T10:05:00Z", SEAT_A)
        self.assertEqual(seats.UNKNOWN, self.seat(None))

    def test_the_organization_of_a_session_is_its_latest_main_segment_begun(self) -> None:
        self.working(SESSION, None, "2030-03-04T11:00:00.000Z")
        self.assertIsNone(accounts.organization_at(self.conn, SESSION, "2030-03-03T23:59:59.999Z"))
        self.assertEqual(
            ORGANIZATION,
            accounts.organization_at(self.conn, SESSION, "2030-03-04T00:00:00.000Z"),
        )
        self.assertIsNone(accounts.organization_at(self.conn, SESSION, "2030-03-04T11:00:00.000Z"))
        self.assertIsNone(
            accounts.organization_at(self.conn, "no-such", "2030-03-04T09:00:00.000Z")
        )


class AccountTests(_Seats):
    """The account a seat belongs to, which holds when the week and its seat's key change."""

    def test_a_sample_with_an_account_names_it(self) -> None:
        self.poll("2030-03-04T09:00:00Z", SEAT_A, account=ACCOUNT_A)
        self.assertEqual(
            seats.Seat(
                SEAT_A, "organization", "2030-03-04T09:00:00.000Z", by_uuid(ACCOUNT_A, SEAT_A)
            ),
            self.seat(),
        )
        self.assertEqual(f"{ORGANIZATION}/{ACCOUNT_A}", self.seat().account.key)  # type: ignore[union-attr]

    def test_a_session_s_seat_belongs_to_the_account_whose_samples_name_it(self) -> None:
        self.sample("2030-03-04T09:00:00Z", SEAT_A)
        self.assertEqual(weekly(SEAT_A), self.seat().account)
        self.assertEqual(f"{ORGANIZATION}/weekly:5T09:00Z", weekly(SEAT_A).key)
        # A poll of the organization names the account of that seat, at any time that week.
        self.poll("2030-03-06T12:00:00Z", SEAT_A, account=ACCOUNT_A)
        self.assertEqual(by_uuid(ACCOUNT_A, SEAT_A), self.seat().account)

    def test_two_accounts_of_the_organization_naming_a_seat_share_it(self) -> None:
        self.sample("2030-03-04T09:00:00Z", SEAT_A)
        self.poll("2030-03-04T07:00:00Z", SEAT_A, account=ACCOUNT_A, percent=10)
        self.assertEqual(by_uuid(ACCOUNT_A, SEAT_A), self.seat().account)
        # Two accounts whose weeks reset in the same ten minutes share a key: no guess.
        self.poll("2030-03-04T07:10:00Z", SEAT_A, account=ACCOUNT_B, percent=20)
        self.assertEqual(weekly(SEAT_A, shared=True), self.seat().account)
        # Each reading with a UUID is still its own account's.
        self.assertEqual(by_uuid(ACCOUNT_B, SEAT_A), self.account_of("2030-03-04T07:10:00Z"))

    def test_a_seat_one_account_of_another_organization_names_is_that_account_s(self) -> None:
        # The session's reading was read for the organization its main run was on, while the
        # seat is the other organization's account: the reading is that account's.
        self.sample("2030-03-04T09:00:00Z", SEAT_A)
        self.sample("2030-03-04T08:30:00Z", SEAT_A, session=None, organization=OTHER,
                    account=ACCOUNT_B)  # fmt: skip
        self.assertEqual(by_uuid(ACCOUNT_B, SEAT_A, OTHER), self.account_of("2030-03-04T09:00:00Z"))
        self.assertEqual(seats.UNKNOWN, self.seat())
        self.assertEqual(by_uuid(ACCOUNT_B, SEAT_A, OTHER), self.seat(OTHER).account)

    def test_an_organization_s_reading_without_a_uuid_moves_to_the_account_naming_it(self) -> None:
        # An import keyed under the wrong organization names a seat the other's poll names.
        self.poll("2030-03-04T08:00:00Z", SEAT_A, organization=OTHER, percent=30)
        self.poll("2030-03-04T08:10:00Z", SEAT_A, account=ACCOUNT_A, percent=31)
        self.assertEqual(by_uuid(ACCOUNT_A, SEAT_A), self.account_of("2030-03-04T08:00:00Z"))

    def test_a_seat_no_uuid_names_is_the_organization_most_of_its_samples_were_read_for(
        self,
    ) -> None:
        # Three readings while the session worked for the organization, one while its main
        # run still said the other: the seat is the first one's.
        self.sample("2030-03-04T08:00:00Z", SEAT_A, percent=40)
        self.working(SESSION, OTHER, "2030-03-04T08:30:00.000Z")
        self.sample("2030-03-04T08:40:00Z", SEAT_A, percent=41)
        self.working(SESSION, ORGANIZATION, "2030-03-04T08:50:00.000Z")
        self.sample("2030-03-04T09:00:00Z", SEAT_A, percent=42)
        self.sample("2030-03-04T09:10:00Z", SEAT_A, percent=43)
        for at in ("08:00", "08:40", "09:00", "09:10"):
            self.assertEqual(weekly(SEAT_A), self.account_of(f"2030-03-04T{at}:00Z"))
        # The work of the other organization is not on it.
        late = self.seat(OTHER, start="2030-03-04T08:35:00Z", end="2030-03-04T08:45:00Z")
        self.assertEqual(seats.UNKNOWN, late)

    def test_a_tie_of_organizations_goes_to_the_latest_reading(self) -> None:
        self.sample("2030-03-04T08:00:00Z", SEAT_B, resets_at=WEEK_B, percent=40)
        self.working(SESSION, OTHER, "2030-03-04T08:30:00.000Z")
        self.sample("2030-03-04T08:40:00Z", SEAT_B, resets_at=WEEK_B, percent=41)
        self.assertEqual(weekly(SEAT_B, OTHER), self.account_of("2030-03-04T08:00:00Z"))

    def test_an_account_holds_across_weeks(self) -> None:
        self.poll("2030-03-04T09:00:00Z", SEAT_A, account=ACCOUNT_A)
        self.poll("2030-03-09T09:00:00Z", SEAT_A_AFTER, account=ACCOUNT_A,
                  resets_at="2030-03-15T09:00:00Z")  # fmt: skip
        first = self.seat()
        second = self.seat(start="2030-03-10T10:00:00Z", end="2030-03-10T10:20:00Z")
        self.assertEqual((SEAT_A, ACCOUNT_A), (first.seat, first.account.account_uuid))  # type: ignore[union-attr]
        self.assertEqual((SEAT_A_AFTER, ACCOUNT_A), (second.seat, second.account.account_uuid))  # type: ignore[union-attr]
        self.assertEqual(first.account.key, second.account.key)  # type: ignore[union-attr]
        self.assertEqual(
            [(ORGANIZATION, ACCOUNT_A)],
            [tuple(row) for row in self.conn.execute(
                "SELECT organization, account_uuid FROM quota_accounts")],
        )  # fmt: skip

    def test_a_week_with_no_uuid_is_the_account_whose_week_resets_then_in_a_nearby_week(
        self,
    ) -> None:
        # The poll named the account the week before; this week only the session reads.
        self.poll("2030-02-26T09:00:00Z", SEAT_A_BEFORE, account=ACCOUNT_A,
                  resets_at="2030-03-01T09:00:00Z")  # fmt: skip
        self.sample("2030-03-04T09:00:00Z", SEAT_A)
        self.assertEqual(by_uuid(ACCOUNT_A, SEAT_A), self.seat().account)
        # And a week before the poll first named it, from the week after.
        self.poll("2030-03-11T09:00:00Z", SEAT_A_AFTER, account=ACCOUNT_B,
                  resets_at="2030-03-15T09:00:00Z", organization=OTHER)  # fmt: skip
        self.sample("2030-03-04T09:05:00Z", SEAT_A, session=None, organization=OTHER)
        self.assertEqual(by_uuid(ACCOUNT_B, SEAT_A, OTHER), self.account_of("2030-03-04T09:05:00Z"))

    def test_an_account_with_another_seat_that_week_is_not_carried_over(self) -> None:
        self.poll("2030-02-26T09:00:00Z", SEAT_A_BEFORE, account=ACCOUNT_A,
                  resets_at="2030-03-01T09:00:00Z")  # fmt: skip
        # This week that account's week resets at 19:00: its reset moved.
        self.poll("2030-03-04T08:00:00Z", SEAT_B, account=ACCOUNT_A, resets_at=WEEK_B)
        self.sample("2030-03-04T09:00:00Z", SEAT_A)
        self.assertEqual(weekly(SEAT_A), self.seat().account)

    def test_two_accounts_tied_for_the_nearest_week_leave_the_seat_shared(self) -> None:
        self.poll("2030-02-26T09:00:00Z", SEAT_A_BEFORE, account=ACCOUNT_A,
                  resets_at="2030-03-01T09:00:00Z")  # fmt: skip
        self.poll("2030-03-11T09:00:00Z", SEAT_A_AFTER, account=ACCOUNT_B,
                  resets_at="2030-03-15T09:00:00Z")  # fmt: skip
        self.sample("2030-03-04T09:00:00Z", SEAT_A)
        self.assertEqual(weekly(SEAT_A, shared=True), self.seat().account)


class TwoCountersTests(_Seats):
    """Two accounts whose weeks reset in the same ten minutes, read with no UUID."""

    def setUp(self) -> None:
        super().setUp()
        self.working(OTHER_SESSION, ORGANIZATION, "2030-03-04T00:00:00.000Z")

    def test_two_feeds_apart_while_both_are_current_mark_the_seat_shared(self) -> None:
        self.sample("2030-03-04T09:00:00Z", SEAT_A, percent=40)
        self.sample("2030-03-04T09:05:00Z", SEAT_A, session=OTHER_SESSION, percent=10)
        # The first feed's next reading is still where it was: two counters.
        self.sample("2030-03-04T09:10:00Z", SEAT_A, percent=41)
        self.assertEqual(weekly(SEAT_A, shared=True), self.seat().account)
        self.assertEqual(weekly(SEAT_A, shared=True), self.account_of("2030-03-04T09:05:00Z"))

    def test_a_five_hour_window_resetting_at_two_times_marks_the_seat_shared(self) -> None:
        five = {"kind": "five_hour"}
        self.sample("2030-03-04T09:00:00Z", SEAT_A, resets_at="2030-03-04T12:00:00Z", **five)  # type: ignore[arg-type]
        self.sample("2030-03-04T09:05:00Z", SEAT_A, session=OTHER_SESSION,
                    resets_at="2030-03-04T13:30:00Z", **five)  # type: ignore[arg-type]  # fmt: skip
        self.sample("2030-03-04T09:10:00Z", SEAT_A, resets_at="2030-03-04T12:00:00Z",
                    percent=41, **five)  # type: ignore[arg-type]  # fmt: skip
        self.assertEqual(weekly(SEAT_A, shared=True), self.seat().account)

    def test_a_count_that_restarted_is_one_counter(self) -> None:
        # Every feed falls after a restart, and the one that read high agrees next time.
        self.sample("2030-03-04T09:00:00Z", SEAT_A, percent=90)
        self.sample("2030-03-04T09:05:00Z", SEAT_A, session=OTHER_SESSION, percent=0)
        self.sample("2030-03-04T09:10:00Z", SEAT_A, percent=1)
        self.assertEqual(weekly(SEAT_A), self.seat().account)

    def test_readings_apart_but_not_current_together_are_one_counter(self) -> None:
        self.sample("2030-03-04T08:00:00Z", SEAT_A, percent=40)
        self.sample("2030-03-04T09:00:00Z", SEAT_A, session=OTHER_SESSION, percent=10)
        self.sample("2030-03-04T09:05:00Z", SEAT_A, percent=41)
        self.assertEqual(weekly(SEAT_A), self.seat().account)

    def test_a_shared_seat_keeps_each_reading_in_its_own_organization(self) -> None:
        self.working("session-3", OTHER, "2030-03-04T00:00:00.000Z")
        self.poll("2030-03-04T08:00:00Z", SEAT_A, account=ACCOUNT_A, percent=40)
        self.sample("2030-03-04T09:00:00Z", SEAT_A, percent=40)
        self.sample("2030-03-04T09:05:00Z", SEAT_A, session="session-3", percent=10)
        self.sample("2030-03-04T09:10:00Z", SEAT_A, percent=41)
        self.assertEqual(
            weekly(SEAT_A, OTHER, shared=True), self.account_of("2030-03-04T09:05:00Z")
        )
        self.assertEqual(weekly(SEAT_A, shared=True), self.account_of("2030-03-04T09:10:00Z"))
        self.assertEqual(by_uuid(ACCOUNT_A, SEAT_A), self.account_of("2030-03-04T08:00:00Z"))


class ManySegmentsTests(_Seats):
    """Many segments read at once get the seat each gets alone, from the same few reads."""

    def test_segments_read_together_are_each_on_the_seat_it_is_on_alone(self) -> None:
        self.working(OTHER_SESSION, ORGANIZATION, "2030-03-04T00:00:00.000Z")
        self.sample("2030-03-04T07:00:00Z", SEAT_A)
        self.sample("2030-03-04T09:30:00Z", SEAT_B, resets_at=WEEK_B)
        self.sample("2030-03-04T08:00:00Z", SEAT_B, session=OTHER_SESSION, resets_at=WEEK_B)
        self.poll("2030-03-04T06:00:00Z", SEAT_A, account=ACCOUNT_A)
        self.poll("2030-03-04T06:30:00Z", SEAT_B, account=ACCOUNT_B, resets_at=WEEK_B)
        # Out of the order they end: one its session's next reading names, one of no
        # organization, one of a session with no feed of its own in an organization of two
        # accounts, and one that no feed reaches.
        segments = [
            seats.Segment(SESSION, ORGANIZATION, "2030-03-04T11:00:00.000Z", "2030-03-04T11:10:00.000Z"),
            seats.Segment(SESSION, ORGANIZATION, "2030-03-04T09:00:00.000Z", "2030-03-04T09:10:00.000Z"),
            seats.Segment(SESSION, ORGANIZATION, "2030-03-04T05:00:00.000Z", "2030-03-04T05:10:00.000Z"),
            seats.Segment(SESSION, None, "2030-03-04T10:00:00.000Z", "2030-03-04T10:10:00.000Z"),
            seats.Segment("session-3", ORGANIZATION, "2030-03-04T07:10:00.000Z", "2030-03-04T07:20:00.000Z"),
            seats.Segment(OTHER_SESSION, ORGANIZATION, "2030-03-04T08:10:00.000Z", "2030-03-04T08:20:00.000Z"),
            seats.Segment(OTHER_SESSION, ORGANIZATION, "2030-03-04T07:40:00.000Z", "2030-03-04T07:50:00.000Z"),
            seats.Segment("session-4", ORGANIZATION, "2030-03-04T05:00:00.000Z", "2030-03-04T05:10:00.000Z"),
        ]  # fmt: skip
        statements: list[str] = []
        self.conn.set_trace_callback(statements.append)
        together = seats.seats_of_segments(self.conn, segments)
        self.conn.set_trace_callback(None)
        self.assertEqual(
            [
                seats.Seat(SEAT_B, "session", "2030-03-04T09:30:00.000Z", by_uuid(ACCOUNT_B, SEAT_B)),
                seats.Seat(SEAT_A, "session", "2030-03-04T07:00:00.000Z", by_uuid(ACCOUNT_A, SEAT_A)),
                seats.Seat(SEAT_A, "session", "2030-03-04T07:00:00.000Z", by_uuid(ACCOUNT_A, SEAT_A)),
                seats.UNKNOWN,
                seats.UNKNOWN,
                seats.Seat(SEAT_B, "session", "2030-03-04T08:00:00.000Z", by_uuid(ACCOUNT_B, SEAT_B)),
                seats.Seat(SEAT_B, "session", "2030-03-04T08:00:00.000Z", by_uuid(ACCOUNT_B, SEAT_B)),
                seats.UNKNOWN,
            ],
            together,
        )  # fmt: skip
        alone = [
            seats.seat_of_segment(
                self.conn,
                session_id=segment.session_id,
                organization=segment.organization,
                started_at=segment.started_at,
                ended_at=segment.ended_at,
            )
            for segment in segments
        ]
        self.assertEqual(alone, together)
        # The samples with whom they were read for, the seats UUIDs name, and every sample
        # of the seats read: however many segments.
        self.assertEqual(3, len(statements), statements)

    def test_a_seat_is_the_same_account_whatever_span_is_read(self) -> None:
        self.sample("2030-03-04T08:00:00Z", SEAT_A, percent=40)
        self.working(SESSION, OTHER, "2030-03-04T08:30:00.000Z")
        self.sample("2030-03-04T08:40:00Z", SEAT_A, percent=41)
        self.working(SESSION, ORGANIZATION, "2030-03-04T08:50:00.000Z")
        self.sample("2030-03-04T09:00:00Z", SEAT_A, percent=42)
        late = seats.account_samples(self.conn, "2030-03-04T08:35:00.000Z", ("week",))
        self.assertEqual([weekly(SEAT_A), weekly(SEAT_A)], [one.account for one in late])


if __name__ == "__main__":
    unittest.main()
