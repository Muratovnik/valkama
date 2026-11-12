"""The seat of a usage segment, joined at read time from the quota samples near it.

The rule held here: a sample of the segment's own session first, else one of its
organization (the poll's, or another session's then working for it); the nearest in
time within half an hour of the segment; otherwise the seat is unknown. The bound and the
rule are stated here, not read from the code under test. Every id and time is invented.
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

NOW = dt.datetime(2030, 3, 5, tzinfo=dt.UTC)
ORGANIZATION = "org-1"
OTHER = "org-2"
SESSION = "session-1"
SEAT_A = "week:2030-03-08T09:00Z"
SEAT_B = "week:2030-03-08T19:00Z"
#: The segment every test reads: from 10:00 to 10:20.
START, END = "2030-03-04T10:00:00.000Z", "2030-03-04T10:20:00.000Z"


class SeatOfSegmentTests(unittest.TestCase):
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
        self.working(SESSION, ORGANIZATION, "2030-03-04T08:00:00.000Z")

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
    ) -> None:
        source = "mod" if session is not None else "poll"
        reading = samples.Reading(
            source,
            at,
            (samples.Window("week", 40, "2030-03-08T09:00:00Z"),),
            seat,
            organization=organization,
            session_id=session,
        )
        with self.conn:
            self.assertEqual(1, samples.record(self.conn, reading, now=NOW))

    def seat(self, organization: str | None = ORGANIZATION) -> seats.Seat:
        return seats.seat_of_segment(
            self.conn,
            session_id=SESSION,
            organization=organization,
            started_at=START,
            ended_at=END,
        )

    def test_the_bound_is_half_an_hour(self) -> None:
        self.assertEqual(dt.timedelta(minutes=30), seats.NEAR)

    def test_a_segment_with_no_sample_near_it_is_on_a_seat_unknown(self) -> None:
        self.sample("2030-03-04T09:29:59Z", SEAT_A)
        self.sample("2030-03-04T10:50:01Z", SEAT_B, session=None, organization=ORGANIZATION)
        self.assertEqual(seats.UNKNOWN, self.seat())
        self.assertEqual(seats.Seat(None, None, None), seats.UNKNOWN)

    def test_a_sample_at_the_bound_still_names_the_seat(self) -> None:
        self.sample("2030-03-04T10:50:00Z", SEAT_A)
        found = self.seat()
        self.assertEqual(
            (SEAT_A, "session", "2030-03-04T10:50:00.000Z"),
            (found.seat, found.basis, found.sample_at),
        )

    def test_the_own_session_comes_before_a_nearer_sample_of_the_organization(self) -> None:
        self.sample("2030-03-04T09:40:00Z", SEAT_A)
        self.sample("2030-03-04T10:10:00Z", SEAT_B, session=None, organization=ORGANIZATION)
        self.assertEqual(seats.Seat(SEAT_A, "session", "2030-03-04T09:40:00.000Z"), self.seat())

    def test_the_nearest_of_its_own_samples_wins_and_a_tie_goes_to_the_earlier(self) -> None:
        self.sample("2030-03-04T09:45:00Z", SEAT_A)
        self.sample("2030-03-04T10:35:00Z", SEAT_B)
        self.assertEqual(SEAT_A, self.seat().seat)
        self.sample("2030-03-04T10:30:00Z", "week:2030-03-08T23:00Z")
        self.sample("2030-03-04T09:50:00Z", "week:2030-03-08T21:00Z")
        self.assertEqual(
            seats.Seat("week:2030-03-08T21:00Z", "session", "2030-03-04T09:50:00.000Z"),
            self.seat(),
        )
        self.sample("2030-03-04T10:05:00Z", SEAT_B)
        self.assertEqual(seats.Seat(SEAT_B, "session", "2030-03-04T10:05:00.000Z"), self.seat())

    def test_with_no_sample_of_its_own_the_organization_names_the_seat(self) -> None:
        self.sample("2030-03-04T10:30:00Z", SEAT_B, session=None, organization=ORGANIZATION)
        self.sample("2030-03-04T10:05:00Z", SEAT_A, session=None, organization=OTHER)
        self.assertEqual(
            seats.Seat(SEAT_B, "organization", "2030-03-04T10:30:00.000Z"), self.seat()
        )

    def test_another_session_counts_only_while_it_worked_for_the_organization(self) -> None:
        self.working("session-2", ORGANIZATION, "2030-03-04T09:00:00.000Z")
        self.working("session-3", OTHER, "2030-03-04T09:00:00.000Z")
        self.sample("2030-03-04T10:01:00Z", SEAT_A, session="session-3")
        self.assertEqual(seats.UNKNOWN, self.seat())
        self.sample("2030-03-04T10:25:00Z", SEAT_B, session="session-2")
        self.assertEqual(
            seats.Seat(SEAT_B, "organization", "2030-03-04T10:25:00.000Z"), self.seat()
        )

    def test_its_own_sample_after_a_change_of_organization_does_not_count(self) -> None:
        self.working(SESSION, OTHER, "2030-03-04T10:21:00.000Z")
        self.sample("2030-03-04T10:22:00Z", SEAT_A)
        self.assertEqual(seats.UNKNOWN, self.seat())
        # The organization the session left reads that sample as the other's.
        self.assertEqual(
            seats.Seat(SEAT_A, "session", "2030-03-04T10:22:00.000Z"), self.seat(OTHER)
        )

    def test_a_sample_without_a_seat_names_none(self) -> None:
        self.sample("2030-03-04T10:05:00Z", None)
        self.sample("2030-03-04T10:06:00Z", None, session=None, organization=ORGANIZATION)
        self.assertEqual(seats.UNKNOWN, self.seat())

    def test_a_segment_with_no_organization_is_on_a_seat_unknown(self) -> None:
        self.sample("2030-03-04T10:05:00Z", SEAT_A)
        self.assertEqual(seats.UNKNOWN, self.seat(None))

    def test_the_organization_of_a_session_is_its_latest_main_segment_begun(self) -> None:
        self.working(SESSION, None, "2030-03-04T11:00:00.000Z")
        self.assertIsNone(seats.organization_at(self.conn, SESSION, "2030-03-04T07:59:59.999Z"))
        self.assertEqual(
            ORGANIZATION, seats.organization_at(self.conn, SESSION, "2030-03-04T08:00:00.000Z")
        )
        self.assertIsNone(seats.organization_at(self.conn, SESSION, "2030-03-04T11:00:00.000Z"))
        self.assertIsNone(seats.organization_at(self.conn, "no-such", "2030-03-04T09:00:00.000Z"))


if __name__ == "__main__":
    unittest.main()
