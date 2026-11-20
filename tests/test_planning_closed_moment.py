"""A finished item closed at one moment, whichever read gives it.

That moment is when it last entered its finished state: its last `created`,
`transitioned` or `opened` event in history order, or its creation when the history
holds none (`standing.ENTERED_AT`). The full record, the brief of a list, a chain's
member and the Volumes read all give it, so a card's close date, a chain's pace and the
Work filter's «Closed in a period» agree with the Volumes count. Three tasks under one
accepted goal of MAIN: one filed straight into Done that never moved and was edited
after the period, one closed, reopened and closed again, and one still open. Their
moments are written here, so each expected day is counted by hand.
"""

from __future__ import annotations

import unittest

from server.planning import chain, service, standing
from tests.test_planning_volumes import VolumesCase

#: Where each task's history stands, the period being 2026-11-10 to 2026-11-16 at UTC+3.
FILED = "2026-11-12T10:00:00Z"
LATER = "2026-11-25T10:00:00Z"
FIRST_CLOSE = "2026-11-05T10:00:00Z"
REOPENED = "2026-11-06T10:00:00Z"
SECOND_CLOSE = "2026-11-14T10:00:00Z"
OPENED = "2026-11-13T10:00:00Z"


class ClosedMomentTests(VolumesCase):
    def setUp(self) -> None:
        super().setUp()
        self.place("MAIN", "goal", kind="goal", state="container")
        self.filed = self.place("MAIN", "filed", parent="goal", state="done", created=FILED)
        self.reclosed = self.place(
            "MAIN",
            "reclosed",
            parent="goal",
            state="done",
            entries=(FIRST_CLOSE, REOPENED, SECOND_CLOSE),
        )
        self.open = self.place("MAIN", "open", parent="goal", state="ready", entries=(OPENED,))
        self.conn.commit()
        # An edit after the period writes the item, but it is no state entry.
        service.update_work_item(self.conn, self.trees["MAIN"].refs["filed"], title="Renamed")
        self.conn.execute(
            "UPDATE work_items SET updated_at = ? WHERE work_item_id = ?", (LATER, self.filed)
        )
        self.conn.commit()

    def reads(self) -> dict[str, dict[str, str | None]]:
        """Each task's `closed_at` by the read that gives it: record, brief and chain member."""

        refs = self.trees["MAIN"].refs
        names = {refs[name]: name for name in ("filed", "reclosed", "open")}
        briefs = {
            names[row["reference"]]: row["closed_at"]
            for row in service.list_work_items(self.conn, space="MAIN", limit=None)
            if row["reference"] in names
        }
        members = {
            names[member["reference"]]: member["closed_at"]
            for member in chain.chain(self.conn, refs["goal"], "chain")["members"]
        }
        return {
            name: {
                "record": service.get_work_item(self.conn, ref)["closed_at"],
                "brief": briefs[name],
                "member": members[name],
            }
            for ref, name in names.items()
        }

    def test_every_read_gives_the_moment_it_last_entered_its_finished_state(self) -> None:
        reads = self.reads()
        self.assertEqual(
            {
                "filed": dict.fromkeys(("record", "brief", "member"), FILED),
                "reclosed": dict.fromkeys(("record", "brief", "member"), SECOND_CLOSE),
                "open": dict.fromkeys(("record", "brief", "member")),
            },
            reads,
        )
        rows = self.conn.execute(
            "SELECT * FROM work_items WHERE work_item_id IN (?, ?)", (self.filed, self.reclosed)
        ).fetchall()
        entered = standing.entered(self.conn, rows)
        self.assertEqual(
            (entered[self.filed], entered[self.reclosed]),
            (reads["filed"]["record"], reads["reclosed"]["record"]),
        )

    def test_the_volumes_read_counts_each_on_the_day_its_closed_at_falls_on(self) -> None:
        volumes = self.volumes("MAIN")
        closed = {day["day"]: day["closed"] for day in volumes["flow"]["days"] if day["closed"]}
        # At UTC+3 the filed task closed on the 12th and the reclosed one on the 14th; the
        # first close and the edit fall outside the period.
        self.assertEqual({"2026-11-12": 1, "2026-11-14": 1}, closed)
        self.assertEqual(2, self.categories(volumes)["completed"]["tasks"])


if __name__ == "__main__":
    unittest.main()
