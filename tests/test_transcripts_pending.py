"""The search for transcript copies still owed, `transcripts.pending`, against the query it replaced.

The query was rewritten to stop searching a session again for each of its ends,
and nothing else about it was to change. So the oracle here is the earlier
query, kept below as it stood: on every generated execution tree both must give
the same rows in the same order. The trees are synthetic and made from a fixed
seed, with sessions long enough that the earlier query's cost shows, and with
each case the rules distinguish: an end answered by a later copy or only by an
earlier one, a copy of another agent or another path, a subagent stop that
carries the parent's path, and events with no session or no path.
"""

from __future__ import annotations

import os
import random
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import store, transcripts

#: The pending query before the rewrite, the oracle the current one is held to.
PREVIOUS_PENDING_SQL = """
SELECT MAX(e.id), e.client, e.session_id,
       CASE WHEN e.kind = 'subagent_stop' THEN e.agent_id END AS archive_agent,
       e.transcript_path
FROM execution_events e
WHERE e.session_id IS NOT NULL AND e.transcript_path IS NOT NULL
  AND (e.kind = 'session_end'
       OR (e.kind = 'subagent_stop' AND e.agent_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM execution_events o
               WHERE o.session_id = e.session_id AND o.transcript_path = e.transcript_path
                 AND o.kind NOT IN ('subagent_stop', 'transcript_archived', 'transcript_purged'))))
  AND NOT EXISTS (
      SELECT 1 FROM execution_events a
      WHERE a.session_id = e.session_id AND a.kind = 'transcript_archived'
        AND a.agent_id IS (CASE WHEN e.kind = 'subagent_stop' THEN e.agent_id END)
        AND a.transcript_path = e.transcript_path AND a.id > e.id)
GROUP BY e.session_id, archive_agent, e.transcript_path
ORDER BY 1
"""

#: Kinds that are neither an end nor a copy; any of them marks a path as the session's own.
OTHER_KINDS = ("session_start", "tool_use", "prompt", "notification")


class Tree:
    """An execution tree written row by row, the way the hooks would leave one."""

    def __init__(self, conn: sqlite3.Connection, rng: random.Random) -> None:
        self.conn = conn
        self.rng = rng
        self.rows = 0

    def add(
        self,
        kind: str,
        session: str | None,
        path: str | None,
        agent: str | None = None,
        client: str | None = "claude",
    ) -> None:
        self.rows += 1
        self.conn.execute(
            "INSERT INTO execution_events"
            " (event_uid, kind, identity_state, identity_source, client, session_id,"
            "  agent_id, transcript_path)"
            " VALUES (?, ?, 'confirmed', 'test', ?, ?, ?, ?)",
            (f"uid-{self.rows}", kind, client, session, agent, path),
        )

    def session(self, number: int, length: int) -> None:
        """One session of about `length` events, its subagents and copies interleaved."""

        rng = self.rng
        session = f"session-{number}"
        own = f"/client/{session}.jsonl"
        agents = [f"agent-{number}-{n}" for n in range(rng.randint(1, 12))]
        # Some agents report a transcript of their own; the rest stop with the parent's.
        separate = {
            agent: f"/client/{session}/{agent}.jsonl" for agent in agents if rng.random() < 0.7
        }
        clients = ("claude", "codex", None)
        for _ in range(length):
            roll = rng.random()
            agent = rng.choice(agents)
            client = rng.choice(clients)
            if roll < 0.55:
                self.add(
                    rng.choice(OTHER_KINDS),
                    session,
                    rng.choice((own, own, own, None)),
                    agent,
                    client,
                )
            elif roll < 0.75:
                # A stop with a transcript of its own, with the parent's, or with none.
                path = rng.choice((separate.get(agent, own), own, None))
                self.add("subagent_stop", session, path, rng.choice((agent, agent, None)), client)
            elif roll < 0.82:
                # Now and then an end carries an agent's path, which makes it the session's own.
                path = separate.get(agent) if rng.random() < 0.01 else own
                self.add("session_end", session, path, None, client)
            elif roll < 0.95:
                # A copy of the session, of an agent, of the wrong agent or of another path.
                target_agent = rng.choice((None, agent, "agent-elsewhere"))
                path = own if target_agent is None else separate.get(agent, own)
                path = rng.choice((path, path, path, "/client/elsewhere.jsonl"))
                self.add("transcript_archived", session, path, target_agent, client)
            else:
                self.add(
                    "transcript_purged",
                    session,
                    rng.choice((own, separate.get(agent))),
                    agent,
                    client,
                )
        # Events with no session at all, which neither query may take.
        for _ in range(rng.randint(0, 5)):
            self.add(rng.choice(("session_end", "subagent_stop")), None, own, agent)


class PendingTests(unittest.TestCase):
    def setUp(self) -> None:
        home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(home.cleanup)
        self.home = home.name
        self.stores = 0
        self.conn = self.new_store()

    def new_store(self) -> sqlite3.Connection:
        """A store of its own at the current schema: execution events cannot be deleted."""

        self.stores += 1
        path = os.path.join(self.home, f"store-{self.stores}", "valkama.sqlite3")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": path}):
            conn = store.connect()
        self.addCleanup(conn.close)
        return conn

    def tree(self, seed: int, lengths: list[int]) -> Tree:
        tree = Tree(self.conn, random.Random(seed))  # noqa: S311 - made-up rows, not a secret
        for number, length in enumerate(lengths):
            tree.session(number, length)
        self.conn.commit()
        return tree

    def answers(self) -> tuple[list[tuple], list[tuple]]:
        previous = [tuple(row) for row in self.conn.execute(PREVIOUS_PENDING_SQL)]
        current = [
            (owed.event_id, owed.client, owed.session_id, owed.agent_id, owed.transcript_path)
            for owed in transcripts.pending(self.conn)
        ]
        return previous, current

    def ends(self) -> int:
        return self.conn.execute(
            "SELECT COUNT(DISTINCT session_id || '|' || IFNULL(agent_id, '') || '|' || transcript_path)"
            " FROM execution_events WHERE kind IN ('session_end', 'subagent_stop')"
            " AND session_id IS NOT NULL AND transcript_path IS NOT NULL"
        ).fetchone()[0]

    def test_long_sessions_give_the_answer_the_previous_query_gave(self) -> None:
        for seed in range(8):
            with self.subTest(seed=seed):
                self.conn = self.new_store()
                self.tree(seed, [3000, 1500, 400, 40, 5])
                previous, current = self.answers()

                self.assertEqual(previous, current)
                # The comparison means something only where some ends are owed,
                # some of them for agents, and others were answered by a copy.
                self.assertTrue(any(row[3] is None for row in previous))
                self.assertTrue(any(row[3] is not None for row in previous))
                self.assertLess(len(previous), self.ends())

    def test_many_short_sessions_give_the_answer_the_previous_query_gave(self) -> None:
        self.tree(100, [1 + n % 30 for n in range(300)])
        previous, current = self.answers()

        self.assertEqual(previous, current)
        self.assertTrue(previous)

    def test_no_end_is_searched_for_again_row_by_row(self) -> None:
        # The earlier query's cost came from subqueries run once for each end.
        plan = [
            row[3] for row in self.conn.execute("EXPLAIN QUERY PLAN " + transcripts._PENDING_SQL)
        ]

        self.assertFalse([step for step in plan if "CORRELATED" in step], plan)


if __name__ == "__main__":
    unittest.main()
