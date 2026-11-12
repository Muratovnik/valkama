"""The seat and account of a usage segment, joined at read time from the quota samples.

The rule held here, stated from the contract rather than read from the code under test:
samples are kept only on a change, so a seat is a state. A feed (one session, or the
organization's poll and imports, in one window) says the seat of its latest sample at or
before the segment's end until that window resets or the seat's week ends; the most
recent feed still holding at the segment's start names the seat, the segment's own
session's feeds first, else its organization's. The account is the naming sample's UUID,
or the one account whose samples name the same seat in the organization; otherwise the
seat is provisional. Every id and time is invented.
"""

from __future__ import annotations

import datetime as dt
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store
from server.quota import samples, seats

NOW = dt.datetime(2030, 3, 20, tzinfo=dt.UTC)
ORGANIZATION = "org-1"
OTHER = "org-2"
SESSION = "session-1"
SEAT_A = "week:2030-03-08T09:00Z"
SEAT_B = "week:2030-03-08T19:00Z"
WEEK_A = "2030-03-08T09:00:00Z"
ACCOUNT_A = "account-a"
ACCOUNT_B = "account-b"
#: The segment most tests read: from 10:00 to 10:20.
START, END = "2030-03-04T10:00:00.000Z", "2030-03-04T10:20:00.000Z"


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
        self.sample(at, seat, session=None, organization=ORGANIZATION, **fields)  # type: ignore[arg-type]

    def seat(
        self, organization: str | None = ORGANIZATION, start: str = START, end: str = END
    ) -> seats.Seat:
        return seats.seat_of_segment(
            self.conn,
            session_id=SESSION,
            organization=organization,
            started_at=start,
            ended_at=end,
        )


class SeatOfSegmentTests(_Seats):
    def test_a_seat_holds_through_a_quiet_stretch_until_its_window_resets(self) -> None:
        # Four hours with no sample: nothing changed, so the seat still stands.
        self.sample("2030-03-04T06:00:00Z", SEAT_A)
        self.assertEqual(seats.Seat(SEAT_A, "session", "2030-03-04T06:00:00.000Z"), self.seat())
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
        self.sample("2030-03-04T09:30:00Z", SEAT_B, resets_at="2030-03-08T19:00:00Z")
        self.assertEqual(seats.Seat(SEAT_B, "session", "2030-03-04T09:30:00.000Z"), self.seat())
        # Before the switch the segment was on the first seat.
        earlier = self.seat(start="2030-03-04T09:00:00Z", end="2030-03-04T09:10:00Z")
        self.assertEqual(seats.Seat(SEAT_A, "session", "2030-03-04T08:00:00.000Z"), earlier)
        # And back again.
        self.sample("2030-03-04T10:30:00Z", SEAT_A, percent=41)
        after = self.seat(start="2030-03-04T11:00:00Z", end="2030-03-04T11:10:00Z")
        self.assertEqual(seats.Seat(SEAT_A, "session", "2030-03-04T10:30:00.000Z"), after)

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
        self.assertEqual(seats.Seat(SEAT_B, "session", "2030-03-04T09:00:00.000Z"), self.seat())
        # Once the five hours reset, the week's feed is the one still holding.
        late = self.seat(start="2030-03-04T14:00:00Z", end="2030-03-04T14:10:00Z")
        self.assertEqual(seats.Seat(SEAT_A, "session", "2030-03-04T08:00:00.000Z"), late)

    def test_with_no_sample_before_its_end_a_segment_is_on_a_seat_unknown(self) -> None:
        self.sample("2030-03-04T10:20:00.001Z", SEAT_A)
        self.poll("2030-03-04T11:00:00Z", SEAT_B)
        self.assertEqual(seats.UNKNOWN, self.seat())
        self.assertEqual(seats.Seat(None, None, None, None), seats.UNKNOWN)

    def test_a_sample_during_the_segment_names_its_seat(self) -> None:
        self.sample("2030-03-04T10:20:00Z", SEAT_A)
        found = self.seat()
        self.assertEqual(
            (SEAT_A, "session", "2030-03-04T10:20:00.000Z", None),
            (found.seat, found.basis, found.sample_at, found.account_uuid),
        )

    def test_the_own_session_comes_before_a_more_recent_sample_of_the_organization(
        self,
    ) -> None:
        self.sample("2030-03-04T07:40:00Z", SEAT_A)
        self.poll("2030-03-04T10:10:00Z", SEAT_B)
        self.assertEqual(seats.Seat(SEAT_A, "session", "2030-03-04T07:40:00.000Z"), self.seat())

    def test_with_no_feed_of_its_own_holding_the_organization_names_the_seat(self) -> None:
        self.sample(
            "2030-03-04T07:00:00Z", SEAT_A, kind="five_hour", resets_at="2030-03-04T08:00:00Z"
        )
        self.poll("2030-03-04T06:30:00Z", SEAT_B)
        self.sample("2030-03-04T09:05:00Z", SEAT_A, session=None, organization=OTHER)
        self.assertEqual(
            seats.Seat(SEAT_B, "organization", "2030-03-04T06:30:00.000Z"), self.seat()
        )

    def test_another_session_counts_only_while_it_worked_for_the_organization(self) -> None:
        self.working("session-2", ORGANIZATION, "2030-03-04T09:00:00.000Z")
        self.working("session-3", OTHER, "2030-03-04T09:00:00.000Z")
        self.sample("2030-03-04T09:50:00Z", SEAT_A, session="session-3")
        self.assertEqual(seats.UNKNOWN, self.seat())
        self.sample("2030-03-04T09:40:00Z", SEAT_B, session="session-2")
        self.assertEqual(
            seats.Seat(SEAT_B, "organization", "2030-03-04T09:40:00.000Z"), self.seat()
        )

    def test_its_own_feed_after_a_change_of_organization_says_nothing_for_the_first(
        self,
    ) -> None:
        self.sample("2030-03-04T08:00:00Z", SEAT_A)
        self.working(SESSION, OTHER, "2030-03-04T09:00:00.000Z")
        self.sample("2030-03-04T09:10:00Z", SEAT_B, resets_at="2030-03-08T19:00:00Z")
        self.assertEqual(seats.UNKNOWN, self.seat())
        # The organization it moved to reads that sample as its own.
        self.assertEqual(
            seats.Seat(SEAT_B, "session", "2030-03-04T09:10:00.000Z"), self.seat(OTHER)
        )

    def test_a_sample_without_a_seat_names_none(self) -> None:
        self.sample("2030-03-04T10:05:00Z", None)
        self.poll("2030-03-04T10:06:00Z", None)
        self.assertEqual(seats.UNKNOWN, self.seat())

    def test_a_segment_with_no_organization_is_on_a_seat_unknown(self) -> None:
        self.sample("2030-03-04T10:05:00Z", SEAT_A)
        self.assertEqual(seats.UNKNOWN, self.seat(None))

    def test_the_organization_of_a_session_is_its_latest_main_segment_begun(self) -> None:
        self.working(SESSION, None, "2030-03-04T11:00:00.000Z")
        self.assertIsNone(seats.organization_at(self.conn, SESSION, "2030-03-03T23:59:59.999Z"))
        self.assertEqual(
            ORGANIZATION, seats.organization_at(self.conn, SESSION, "2030-03-04T00:00:00.000Z")
        )
        self.assertIsNone(seats.organization_at(self.conn, SESSION, "2030-03-04T11:00:00.000Z"))
        self.assertIsNone(seats.organization_at(self.conn, "no-such", "2030-03-04T09:00:00.000Z"))


class AccountTests(_Seats):
    """The account a seat belongs to, which holds when the week and its seat's key change."""

    def test_a_sample_with_an_account_names_it(self) -> None:
        self.poll("2030-03-04T09:00:00Z", SEAT_A, account=ACCOUNT_A)
        self.assertEqual(
            seats.Seat(SEAT_A, "organization", "2030-03-04T09:00:00.000Z", ACCOUNT_A), self.seat()
        )

    def test_a_session_s_seat_belongs_to_the_account_whose_samples_name_it(self) -> None:
        self.sample("2030-03-04T09:00:00Z", SEAT_A)
        self.assertEqual(seats.Seat(SEAT_A, "session", "2030-03-04T09:00:00.000Z"), self.seat())
        # A poll of the organization names the account of that seat, at any time that week.
        self.poll("2030-03-06T12:00:00Z", SEAT_A, account=ACCOUNT_A)
        self.assertEqual(ACCOUNT_A, self.seat().account_uuid)
        self.assertEqual(ACCOUNT_A, seats.account_of_seat(self.conn, ORGANIZATION, SEAT_A))

    def test_a_seat_no_account_or_two_accounts_name_is_provisional(self) -> None:
        self.poll("2030-03-04T08:00:00Z", SEAT_B, account=ACCOUNT_A)
        self.sample("2030-03-04T09:00:00Z", SEAT_A)
        self.assertEqual((SEAT_A, None), (self.seat().seat, self.seat().account_uuid))
        # The same seat in another organization is not this one's.
        self.sample("2030-03-04T08:30:00Z", SEAT_A, session=None, organization=OTHER,
                    account=ACCOUNT_B)  # fmt: skip
        self.assertIsNone(seats.account_of_seat(self.conn, ORGANIZATION, SEAT_A))
        # Two accounts whose weeks reset in the same ten minutes share a key: no guess.
        self.poll("2030-03-04T07:00:00Z", SEAT_A, account=ACCOUNT_A, percent=10)
        self.assertEqual(ACCOUNT_A, seats.account_of_seat(self.conn, ORGANIZATION, SEAT_A))
        self.poll("2030-03-04T07:10:00Z", SEAT_A, account=ACCOUNT_B, percent=20)
        self.assertIsNone(seats.account_of_seat(self.conn, ORGANIZATION, SEAT_A))
        self.assertEqual((SEAT_A, None), (self.seat().seat, self.seat().account_uuid))

    def test_an_account_holds_across_weeks(self) -> None:
        next_week = "week:2030-03-15T09:00Z"
        self.poll("2030-03-04T09:00:00Z", SEAT_A, account=ACCOUNT_A)
        self.poll("2030-03-09T09:00:00Z", next_week, account=ACCOUNT_A,
                  resets_at="2030-03-15T09:00:00Z")  # fmt: skip
        first = self.seat()
        second = self.seat(start="2030-03-10T10:00:00Z", end="2030-03-10T10:20:00Z")
        self.assertEqual((SEAT_A, ACCOUNT_A), (first.seat, first.account_uuid))
        self.assertEqual((next_week, ACCOUNT_A), (second.seat, second.account_uuid))
        self.assertEqual(
            [(ORGANIZATION, ACCOUNT_A)],
            [tuple(row) for row in self.conn.execute(
                "SELECT organization, account_uuid FROM quota_accounts")],
        )  # fmt: skip


if __name__ == "__main__":
    unittest.main()
