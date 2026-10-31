"""The transcript archive: the copy an ended session leaves, how long it stays, and what it never does.

Every transcript here is synthetic, written by the test into its own temporary
directory. The expectations come from the archive rules: a copy is named by its
content, its row records the source path and the sha256 the test computes
itself, a copy that does not fit the hook is owed until a sweep makes it, and
retention lets a copy go only when no open item refers to the session and 90
days have passed since the later of the session's last sign of life and the
newest terminal transition of an item that refers to it.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import store, transcripts
from server.hooks import ingest, normalize
from server.planning import service as planning

SESSION = "6f1c2a8e-0000-4000-8000-0000000000aa"
AGENT = "a1b2c3"
LAST_SEEN = "2026-01-01T00:00:00Z"
#: Exactly 90 days after `LAST_SEEN`, and one second short of it.
BOUNDARY = "2026-04-01T00:00:00Z"
BEFORE_BOUNDARY = "2026-03-31T23:59:59Z"


def synthetic(lines: int, marker: str = "synthetic") -> bytes:
    return b"".join(
        json.dumps({"type": marker, "line": n}).encode("utf-8") + b"\n" for n in range(lines)
    )


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ArchiveCase(unittest.TestCase):
    """A throwaway store at the current schema, its archive root, and a client directory."""

    def setUp(self) -> None:
        self.home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.home.cleanup)
        self.path = os.path.join(self.home.name, "store", "valkama.sqlite3")
        patch = mock.patch.dict(
            os.environ,
            {"VALKAMA_DB": self.path, "HOME": self.home.name, "USERPROFILE": self.home.name},
        )
        patch.start()
        self.addCleanup(patch.stop)
        # The hook's copy deadline counts from the start of delivery, so on a slow
        # runner a copy a test expects made at once is left pending instead. The
        # tests that are about that deadline set their own.
        budget = mock.patch.object(transcripts, "HOOK_SECONDS", 60.0)
        budget.start()
        self.addCleanup(budget.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.root = transcripts.directory(self.path)
        self.client = os.path.join(self.home.name, "client")
        os.makedirs(self.client)
        self.uids = iter(f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 10_000))

    def transcript(self, name: str, data: bytes) -> str:
        path = os.path.join(self.client, name)
        with open(path, "wb") as handle:
            handle.write(data)
        return path

    def deliver(self, event: str, uid: str | None = None, **payload: object) -> str:
        payload.setdefault("session_id", SESSION)
        record = normalize.lifecycle_event(
            "claude",
            event,
            payload,
            event_uid=uid or next(self.uids),
            occurred_at=normalize.timestamp(time.time_ns()),
        )
        assert record is not None
        return ingest.deliver(
            record,
            store_path=self.path,
            schema_version=store.STORE_SCHEMA_VERSION,
            occurred_ns=time.time_ns(),
            now=normalize.timestamp(time.time_ns()),
        )

    def rows(self, kind: str = transcripts.ARCHIVED) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM execution_events WHERE kind = ? ORDER BY id", (kind,)
        ).fetchall()

    def files(self) -> list[str]:
        found = []
        for directory, _folders, names in os.walk(self.root):
            found.extend(
                os.path.relpath(os.path.join(directory, name), self.root).replace(os.sep, "/")
                for name in names
            )
        return sorted(found)

    def read_copy(self, relative: str) -> bytes:
        with open(os.path.join(self.root, *relative.split("/")), "rb") as handle:
            return handle.read()

    def sweep(self, **options: object) -> transcripts.SweepResult:
        return transcripts.sweep(self.conn, root=self.root, **options)


class NamingTests(unittest.TestCase):
    def test_a_plain_id_is_its_own_name_and_anything_else_is_a_digest(self) -> None:
        self.assertEqual(SESSION, transcripts.safe(SESSION))
        for unsafe in ("..", ".", "a/b", "a\\b", "CON", "nul.txt", "trail.", "x" * 129, ""):
            with self.subTest(unsafe=unsafe):
                self.assertEqual(
                    hashlib.sha256(unsafe.encode("utf-8")).hexdigest()[:32],
                    transcripts.safe(unsafe),
                )

    def test_a_copy_is_named_by_session_agent_and_content(self) -> None:
        digest = sha(b"x")
        self.assertEqual(
            f"{SESSION}/main-{digest[:16]}.jsonl", transcripts.archive_path(SESSION, None, digest)
        )
        self.assertEqual(
            f"{SESSION}/agent-{AGENT}-{digest[:16]}.jsonl",
            transcripts.archive_path(SESSION, AGENT, digest),
        )


class HookArchiveTests(ArchiveCase):
    """The copy a direct hook write makes, in-process."""

    def test_a_session_end_leaves_a_copy_that_outlives_its_source(self) -> None:
        data = synthetic(50)
        source = self.transcript("session.jsonl", data)
        self.assertEqual("direct", self.deliver("session-end", transcript_path=source))

        (row,) = self.rows()
        self.assertEqual(
            (SESSION, None, source, "valkama", "confirmed"),
            (
                row["session_id"],
                row["agent_id"],
                row["transcript_path"],
                row["identity_source"],
                row["identity_state"],
            ),
        )
        self.assertEqual(sha(data), row["archive_sha256"])
        self.assertEqual(f"{SESSION}/main-{sha(data)[:16]}.jsonl", row["archive_path"])
        self.assertEqual([row["archive_path"]], self.files())

        os.remove(source)
        copy = self.read_copy(row["archive_path"])
        self.assertEqual(data, copy)
        self.assertEqual(row["archive_sha256"], sha(copy))
        self.assertEqual([], transcripts.pending(self.conn))
        self.assertEqual(transcripts.SweepResult(), self.sweep())
        self.assertEqual([row["archive_path"]], self.files())

    def test_no_transcript_content_reaches_the_store(self) -> None:
        source = self.transcript("session.jsonl", synthetic(5, marker="needle-7f3a"))
        self.deliver("session-end", transcript_path=source)
        self.conn.commit()
        with open(self.path, "rb") as handle:
            self.assertNotIn(b"needle-7f3a", handle.read())
        wal = self.path + "-wal"
        if os.path.exists(wal):
            with open(wal, "rb") as handle:
                self.assertNotIn(b"needle-7f3a", handle.read())

    def test_a_subagent_stop_archives_the_subagents_own_transcript(self) -> None:
        main = self.transcript("session.jsonl", synthetic(3))
        own = synthetic(7, marker="agent")
        agent = self.transcript("agent.jsonl", own)
        self.deliver("session-start", transcript_path=main)
        self.deliver("subagent-start", agent_id=AGENT, transcript_path=main)
        self.deliver(
            "subagent-stop", agent_id=AGENT, transcript_path=main, agent_transcript_path=agent
        )
        (row,) = self.rows()
        self.assertEqual((AGENT, agent), (row["agent_id"], row["transcript_path"]))
        self.assertEqual(f"{SESSION}/agent-{AGENT}-{sha(own)[:16]}.jsonl", row["archive_path"])
        self.assertEqual(own, self.read_copy(row["archive_path"]))

    def test_a_subagent_stop_without_its_own_transcript_owes_nothing(self) -> None:
        main = self.transcript("session.jsonl", synthetic(3))
        self.deliver("session-start", transcript_path=main)
        self.deliver("subagent-stop", agent_id=AGENT, transcript_path=main)
        self.assertEqual([], self.rows())
        self.assertEqual([], transcripts.pending(self.conn))

    def test_a_large_transcript_is_left_owed_and_the_sweep_copies_it(self) -> None:
        data = synthetic(200)
        source = self.transcript("session.jsonl", data)
        with mock.patch.object(transcripts, "HOOK_MAX_BYTES", len(data) - 1):
            self.assertEqual("direct", self.deliver("session-end", transcript_path=source))
        self.assertEqual([], self.rows())
        self.assertEqual([], self.files())
        (owed,) = transcripts.pending(self.conn)
        self.assertEqual(
            (SESSION, None, source), (owed.session_id, owed.agent_id, owed.transcript_path)
        )

        result = self.sweep()
        self.assertEqual(1, result.archived)
        (row,) = self.rows()
        self.assertEqual(sha(data), row["archive_sha256"])
        self.assertEqual(data, self.read_copy(row["archive_path"]))
        self.assertEqual([], transcripts.pending(self.conn))

    def test_a_missing_source_keeps_the_event_and_the_sweep_records_it_gone(self) -> None:
        gone = os.path.join(self.client, "never-written.jsonl")
        self.assertEqual("direct", self.deliver("session-end", transcript_path=gone))
        session = self.conn.execute(
            "SELECT status FROM sessions WHERE id = ?", (SESSION,)
        ).fetchone()
        self.assertEqual("ended", session["status"])
        self.assertEqual(1, len(transcripts.pending(self.conn)))

        result = self.sweep()
        self.assertEqual((0, 1), (result.archived, result.missing))
        (row,) = self.rows()
        self.assertEqual(
            (None, None, transcripts.SOURCE_MISSING),
            (row["archive_path"], row["archive_sha256"], row["reason"]),
        )
        self.assertEqual([], transcripts.pending(self.conn))

    def test_an_unreadable_source_stays_owed(self) -> None:
        source = self.transcript("session.jsonl", synthetic(3))
        with mock.patch("builtins.open", side_effect=PermissionError("held")):
            self.deliver("session-end", transcript_path=source)
        self.assertEqual(1, len(transcripts.pending(self.conn)))
        with mock.patch("builtins.open", side_effect=PermissionError("held")):
            self.assertEqual(1, self.sweep().unreadable)
        self.assertEqual(1, len(transcripts.pending(self.conn)))
        self.assertEqual([], self.files())

    def test_an_extended_length_path_is_read_without_its_prefix(self) -> None:
        data = synthetic(4)
        source = self.transcript("session.jsonl", data)
        self.deliver("session-end", transcript_path="\\\\?\\" + source)
        (row,) = self.rows()
        self.assertEqual(source, row["transcript_path"])
        self.assertEqual(data, self.read_copy(row["archive_path"]))
        # The copy itself drops the prefix too, for a path from anywhere else.
        copied = transcripts.copy("\\\\?\\" + source, self.root, "other", None)
        self.assertEqual(sha(data), copied.sha256)

    def test_ending_again_with_the_same_content_reuses_the_file(self) -> None:
        source = self.transcript("session.jsonl", synthetic(5))
        self.deliver("session-end", transcript_path=source)
        self.deliver("session-start", transcript_path=source)
        self.deliver("session-end", transcript_path=source)
        first, second = self.rows()
        self.assertEqual(first["archive_path"], second["archive_path"])
        self.assertEqual(1, len(self.files()))

    def test_a_resumed_session_that_ends_with_new_content_adds_a_file(self) -> None:
        source = self.transcript("session.jsonl", synthetic(5))
        self.deliver("session-end", transcript_path=source)
        with open(source, "ab") as handle:
            handle.write(synthetic(1, marker="resumed"))
        self.deliver("session-start", transcript_path=source)
        self.deliver("session-end", transcript_path=source)
        first, second = self.rows()
        self.assertNotEqual(first["archive_path"], second["archive_path"])
        self.assertEqual(2, len(self.files()))
        self.assertEqual([], transcripts.pending(self.conn))

    def test_a_replayed_end_copies_nothing_again(self) -> None:
        source = self.transcript("session.jsonl", synthetic(5))
        uid = "00000000-0000-4000-8000-0000000000ff"
        self.deliver("session-end", uid=uid, transcript_path=source)
        self.deliver("session-end", uid=uid, transcript_path=source)
        self.assertEqual(1, len(self.rows()))

    def test_a_row_the_store_refuses_leaves_the_copy_for_the_sweep_to_adopt(self) -> None:
        data = synthetic(6)
        source = self.transcript("session.jsonl", data)
        with mock.patch.object(
            transcripts, "_append", side_effect=sqlite3.OperationalError("database is locked")
        ):
            self.assertEqual("direct", self.deliver("session-end", transcript_path=source))
        self.assertEqual([], self.rows())
        self.assertEqual(1, len(transcripts.pending(self.conn)))
        (left,) = self.files()

        os.remove(source)
        self.assertEqual(1, self.sweep().archived)
        (row,) = self.rows()
        self.assertEqual((left, sha(data)), (row["archive_path"], row["archive_sha256"]))
        self.assertEqual([left], self.files())

    def interrupt_copy(self) -> None:
        """Start a copy and run it out of time after its first chunk."""

        data = synthetic(100)
        source = self.transcript("session.jsonl", data)
        ticks = iter([0.0, 0.0])
        with (
            mock.patch.object(transcripts, "CHUNK_BYTES", len(data) // 4),
            mock.patch.object(transcripts.time, "monotonic", side_effect=lambda: next(ticks, 10.0)),
            self.assertRaises(transcripts.DeferredError),
        ):
            transcripts.copy(source, self.root, SESSION, None, deadline=5.0)

    def test_an_interrupted_copy_leaves_nothing_behind(self) -> None:
        self.interrupt_copy()
        self.assertEqual([], self.files())

    def test_a_copy_killed_midway_never_leaves_part_of_a_file_under_an_archive_name(self) -> None:
        """The copy goes through `*.partial`, so a process killed mid-copy leaves only that.

        Nothing cleans up after a killed process; with `_discard` doing nothing,
        what remains is what a crash at that moment would leave.
        """

        with mock.patch.object(transcripts, "_discard"):
            self.interrupt_copy()
        left = self.files()
        self.assertEqual(1, len(left))
        self.assertTrue(left[0].endswith(transcripts.PARTIAL_SUFFIX), left)
        self.assertEqual([], [name for name in left if name.endswith(transcripts.ARCHIVE_SUFFIX)])

    def test_an_out_of_time_hook_copy_stays_owed(self) -> None:
        source = self.transcript("session.jsonl", synthetic(5))
        with mock.patch.object(transcripts, "HOOK_SECONDS", -1.0):
            self.deliver("session-end", transcript_path=source)
        self.assertEqual(([], []), (self.rows(), self.files()))
        self.assertEqual(1, len(transcripts.pending(self.conn)))


class RetentionTests(ArchiveCase):
    """Retention: kept while an open item refers to the session, and 90 days after the later anchor."""

    def setUp(self) -> None:
        super().setUp()
        self.data = synthetic(5)
        self.source = self.transcript("session.jsonl", self.data)
        self.deliver("session-end", transcript_path=self.source)
        self.conn.execute("UPDATE sessions SET last_seen = ? WHERE id = ?", (LAST_SEEN, SESSION))
        self.conn.commit()
        (self.archive,) = self.files()
        planning.create_planning_space(self.conn, project_id="test", name="Test", key="TST")
        self.conn.commit()

    def item(self, state: str = "dev") -> str:
        record = planning.create_work_item(self.conn, space="TST", title="refers", state=state)
        self.conn.commit()
        return str(record["reference"])

    def close(self, reference: str) -> str:
        planning.transition_work_item(self.conn, reference, "done", force=True)
        self.conn.commit()
        return str(
            self.conn.execute(
                "SELECT MAX(created_at) FROM work_item_events WHERE action = 'transitioned'"
            ).fetchone()[0]
        )

    def after(self, at: str, modifier: str) -> str:
        return str(
            self.conn.execute(
                "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', ?, ?)", (at, modifier)
            ).fetchone()[0]
        )

    def call_row(self, work_item_id: str | None) -> int:
        cursor = self.conn.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " session_id, work_item_id) VALUES (?, 'planning_write', 'confirmed', 'mcp', ?, ?)",
            (next(self.uids), SESSION, work_item_id),
        )
        self.conn.commit()
        return int(cursor.lastrowid or 0)

    def execution(self, work_item_id: str, session_id: str) -> None:
        """An attempt at the item, with `session_id` linked to it as Executions links one."""

        execution_id = next(self.uids)
        self.conn.execute(
            "INSERT INTO sessions(id, client) VALUES (?, 'codex') ON CONFLICT(id) DO NOTHING",
            (session_id,),
        )
        self.conn.execute(
            "INSERT INTO executions(execution_id, work_item_id, client_family, role,"
            " environment, expected_effect, status) VALUES (?,?,?,?,?,?,?)",
            (execution_id, work_item_id, "codex", "executor", "local", "change", "running"),
        )
        self.conn.execute(
            "INSERT INTO execution_sessions(execution_id, session_id, relation)"
            " VALUES (?, ?, 'launched')",
            (execution_id, session_id),
        )
        self.conn.commit()

    def item_id(self, reference: str) -> str:
        return str(planning.get_work_item(self.conn, reference)["work_item_id"])

    def test_the_copy_goes_at_the_ninety_day_boundary_and_not_a_second_before(self) -> None:
        self.assertEqual(0, self.sweep(now=BEFORE_BOUNDARY).purged)
        self.assertEqual([self.archive], self.files())
        self.assertEqual(1, self.sweep(now=BOUNDARY).purged)
        self.assertEqual([], self.files())
        (purge,) = self.rows(transcripts.PURGED)
        self.assertEqual(
            (self.archive, sha(self.data), transcripts.RETENTION, SESSION),
            (purge["archive_path"], purge["archive_sha256"], purge["reason"], purge["session_id"]),
        )
        self.assertEqual({}, transcripts.current(self.conn))
        self.assertFalse(os.path.exists(os.path.join(self.root, SESSION)))

    def test_an_open_item_that_refers_to_the_session_keeps_the_copy(self) -> None:
        later = str(
            self.conn.execute("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 year')").fetchone()[
                0
            ]
        )
        ways = {
            "session ref": lambda ref: planning.attach_ref(self.conn, ref, "session", SESSION),
            "short session ref": lambda ref: planning.attach_ref(
                self.conn, ref, "session", SESSION[:8]
            ),
            "subagent ref": lambda ref: planning.attach_ref(
                self.conn, ref, "session", f"{SESSION}:{AGENT}"
            ),
            "call row": lambda ref: self.call_row(self.item_id(ref)),
            "claim": lambda ref: self.conn.execute(
                "UPDATE work_items SET claim_call_id = ? WHERE work_item_id = ?",
                (self.call_row(None), self.item_id(ref)),
            ),
            "execution": lambda ref: self.execution(self.item_id(ref), SESSION),
            "execution of a subagent": lambda ref: self.execution(
                self.item_id(ref), f"{SESSION}:{AGENT}"
            ),
            "launched for the item": lambda ref: self.conn.execute(
                "UPDATE sessions SET work_item_id = ? WHERE id = ?", (self.item_id(ref), SESSION)
            ),
        }
        references = []
        for name, refer in ways.items():
            with self.subTest(name):
                reference = self.item()
                refer(reference)
                self.conn.commit()
                references.append(reference)
                self.assertEqual(0, self.sweep(now=later).purged)
                self.assertEqual([self.archive], self.files())
                # Only this item refers now; closing it hands the decision back to time.
                planning.transition_work_item(self.conn, reference, "cancelled", force=True)
                self.conn.commit()
        self.assertEqual(1, self.sweep(now=later).purged)

    def test_the_newest_terminal_transition_restarts_the_clock(self) -> None:
        reference = self.item()
        planning.attach_ref(self.conn, reference, "session", SESSION)
        closed = self.close(reference)
        self.assertEqual(0, self.sweep(now=self.after(closed, "+89 days")).purged)
        self.assertEqual(1, self.sweep(now=self.after(closed, "+90 days")).purged)

    def test_an_unrelated_open_item_does_not_keep_the_copy(self) -> None:
        reference = self.item()
        planning.attach_ref(self.conn, reference, "session", "another-session")
        self.conn.commit()
        self.assertEqual(1, self.sweep(now=BOUNDARY).purged)

    def test_the_purge_is_recorded_before_the_file_is_deleted(self) -> None:
        seen = []
        witness = ingest.open_light(self.path, store.STORE_SCHEMA_VERSION)
        self.addCleanup(witness.close)
        discard = transcripts._discard

        def checked(path: str) -> None:
            seen.append(
                witness.execute(
                    "SELECT COUNT(*) FROM execution_events WHERE kind = ? AND archive_path = ?",
                    (transcripts.PURGED, self.archive),
                ).fetchone()[0]
            )
            discard(path)

        with mock.patch.object(transcripts, "_discard", side_effect=checked):
            self.sweep(now=BOUNDARY)
        self.assertEqual([1], seen)

    def test_a_crash_between_the_purge_row_and_the_delete_is_finished_later(self) -> None:
        with mock.patch.object(transcripts, "_discard"):
            self.sweep(now=BOUNDARY)
        self.assertEqual([self.archive], self.files())
        # Still inside the grace period: the file may be one a hook just renamed into place.
        self.assertEqual(0, self.sweep(now=BOUNDARY).orphans)
        old = time.time() - transcripts.ORPHAN_GRACE_SECONDS - 1
        os.utime(os.path.join(self.root, *self.archive.split("/")), (old, old))
        self.assertEqual(1, self.sweep(now=BOUNDARY).orphans)
        self.assertEqual([], self.files())
        self.assertEqual(1, len(self.rows(transcripts.PURGED)))


class OrphanTests(ArchiveCase):
    def place(self, relative: str, *, age: float) -> str:
        path = os.path.join(self.root, *relative.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(b"{}\n")
        when = time.time() - age
        os.utime(path, (when, when))
        return path

    def test_only_abandoned_partials_go_and_files_without_a_row_stay(self) -> None:
        source = self.transcript("session.jsonl", synthetic(3))
        self.deliver("session-end", transcript_path=source)
        (kept,) = self.files()
        old = transcripts.ORPHAN_GRACE_SECONDS + 60
        os.utime(os.path.join(self.root, *kept.split("/")), (time.time() - old,) * 2)
        self.place("stray/main-0123456789abcdef.jsonl", age=old)
        self.place("stray/.abc.partial", age=old)
        self.place("young/.def.partial", age=0)
        self.place("stray/notes.txt", age=old)

        self.assertEqual(1, self.sweep().orphans)
        self.assertEqual(
            sorted(
                [kept, "stray/main-0123456789abcdef.jsonl", "stray/notes.txt", "young/.def.partial"]
            ),
            self.files(),
        )

    def test_an_archive_restored_without_its_rows_survives_every_sweep(self) -> None:
        """A store restored from a snapshot older than its archive, or another store
        sharing the directory, has no row for these files; they may be the only copies left."""

        old = transcripts.ORPHAN_GRACE_SECONDS * 10
        restored = [
            self.place(f"{SESSION}/main-0123456789abcdef.jsonl", age=old),
            self.place(f"{SESSION}/agent-{AGENT}-fedcba9876543210.jsonl", age=old),
            self.place("another-session/main-00112233445566ff.jsonl", age=old),
        ]
        for _ in range(3):
            self.assertEqual(0, self.sweep().orphans)
        self.assertTrue(all(os.path.exists(path) for path in restored))
        self.assertEqual(3, transcripts.summary(self.conn, self.root)["orphans"])

    def test_a_file_whose_newest_row_is_its_purge_is_removed(self) -> None:
        source = self.transcript("session.jsonl", synthetic(3))
        self.deliver("session-end", transcript_path=source)
        (kept,) = self.files()
        (archived,) = self.rows()
        self.conn.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " session_id, archive_path, archive_sha256, reason) VALUES (?,?,?,?,?,?,?,?)",
            (
                next(self.uids),
                transcripts.PURGED,
                "confirmed",
                "valkama",
                SESSION,
                kept,
                archived["archive_sha256"],
                transcripts.RETENTION,
            ),
        )
        self.conn.commit()
        old = time.time() - transcripts.ORPHAN_GRACE_SECONDS - 1
        os.utime(os.path.join(self.root, *kept.split("/")), (old, old))
        self.assertEqual(1, self.sweep().orphans)
        self.assertEqual([], self.files())

    def test_the_summary_counts_copies_owed_orphans_and_lost(self) -> None:
        data = synthetic(3)
        self.deliver("session-end", transcript_path=self.transcript("a.jsonl", data))
        self.deliver(
            "session-end", session_id="second", transcript_path=self.transcript("b.jsonl", data * 2)
        )
        os.remove(os.path.join(self.root, "second", f"main-{sha(data * 2)[:16]}.jsonl"))
        self.place("stray/main-0123456789abcdef.jsonl", age=0)
        with mock.patch.object(transcripts, "HOOK_MAX_BYTES", 0):
            self.deliver(
                "session-end", session_id="third", transcript_path=self.transcript("c.jsonl", data)
            )
        found = transcripts.summary(self.conn, self.root)
        self.assertEqual(
            {"archived": 1, "bytes": len(data), "lost": 1, "pending": 1, "orphans": 1},
            {key: found[key] for key in ("archived", "bytes", "lost", "pending", "orphans")},
        )
        self.assertTrue(found["oldest_pending"])

    def test_a_sweep_out_of_time_starts_nothing(self) -> None:
        with mock.patch.object(transcripts, "HOOK_MAX_BYTES", 0):
            self.deliver("session-end", transcript_path=self.transcript("a.jsonl", synthetic(2)))
        self.assertEqual(transcripts.SweepResult(), self.sweep(seconds=-1.0))
        self.assertEqual(1, len(transcripts.pending(self.conn)))

    def test_a_store_error_stops_the_sweep(self) -> None:
        with mock.patch.object(transcripts, "HOOK_MAX_BYTES", 0):
            self.deliver("session-end", transcript_path=self.transcript("a.jsonl", synthetic(2)))
        with mock.patch.object(
            transcripts, "_append", side_effect=sqlite3.OperationalError("database is locked")
        ):
            result = self.sweep()
        self.assertEqual("database is locked", result.stopped)

    def test_the_default_root_is_beside_the_configured_store(self) -> None:
        with mock.patch.object(transcripts, "HOOK_MAX_BYTES", 0):
            self.deliver("session-end", transcript_path=self.transcript("a.jsonl", synthetic(2)))
        self.assertEqual(1, transcripts.sweep(self.conn).archived)
        self.assertEqual(os.path.join(os.path.dirname(self.path), "transcripts"), self.root)
        self.assertEqual(1, len(self.files()))


OTHER = "7a2d3b9f-0000-4000-8000-0000000000bb"


class PurgeOnRequestTests(ArchiveCase):
    """`valkama transcripts purge`: deletion when a person asks, whatever retention says."""

    def setUp(self) -> None:
        super().setUp()
        self.mine = synthetic(5, marker="mine")
        self.theirs = synthetic(9, marker="theirs")
        self.deliver("session-end", transcript_path=self.transcript("mine.jsonl", self.mine))
        self.deliver(
            "session-end",
            session_id=OTHER,
            transcript_path=self.transcript("theirs.jsonl", self.theirs),
        )
        self.mine_copy = f"{SESSION}/main-{sha(self.mine)[:16]}.jsonl"
        self.their_copy = f"{OTHER}/main-{sha(self.theirs)[:16]}.jsonl"
        self.assertEqual(sorted([self.mine_copy, self.their_copy]), self.files())

    def purge(self, **options: object) -> transcripts.PurgeResult:
        return transcripts.purge_on_request(self.conn, root=self.root, **options)

    def open_item(self) -> None:
        planning.create_planning_space(self.conn, project_id="test", name="Test", key="TST")
        reference = planning.create_work_item(self.conn, space="TST", title="open")["reference"]
        planning.attach_ref(self.conn, reference, "session", SESSION)
        self.conn.commit()

    def test_a_named_session_goes_now_even_with_an_open_item_and_others_stay(self) -> None:
        self.open_item()
        result = self.purge(sessions=[SESSION])
        self.assertEqual(
            transcripts.PurgeResult(
                dry_run=False, sessions=1, files=1, bytes=len(self.mine), open_items=1
            ),
            result,
        )
        self.assertEqual([self.their_copy], self.files())
        (purge,) = self.rows(transcripts.PURGED)
        self.assertEqual(
            (self.mine_copy, sha(self.mine), transcripts.ON_REQUEST, SESSION),
            (purge["archive_path"], purge["archive_sha256"], purge["reason"], purge["session_id"]),
        )
        # Retention's own sweep does not bring it back or touch the other copy.
        self.assertEqual(0, self.sweep().archived)
        self.assertEqual([self.their_copy], self.files())

    def test_the_summary_names_no_session_path_or_content(self) -> None:
        self.open_item()
        text = transcripts.render_purge(self.purge(sessions=[SESSION]))
        for secret in (SESSION, OTHER, self.root, self.client, "mine", "theirs"):
            self.assertNotIn(secret, text)
        self.assertIn("1 file(s)", text)
        self.assertIn("1 open work item(s)", text)

    def test_a_dry_run_counts_and_changes_nothing(self) -> None:
        before = self.rows(transcripts.PURGED)
        result = self.purge(sessions=[SESSION, OTHER], dry_run=True)
        self.assertEqual(
            (2, 2, len(self.mine) + len(self.theirs)),
            (
                result.sessions,
                result.files,
                result.bytes,
            ),
        )
        self.assertEqual(before, self.rows(transcripts.PURGED))
        self.assertEqual(sorted([self.mine_copy, self.their_copy]), self.files())
        self.assertIn("dry run", transcripts.render_purge(result))

    def test_before_selects_sessions_whose_last_activity_is_earlier(self) -> None:
        self.conn.execute("UPDATE sessions SET last_seen = ? WHERE id = ?", (LAST_SEEN, SESSION))
        self.conn.commit()
        result = self.purge(before=transcripts.before_argument("2026-02-01"))
        self.assertEqual(1, result.sessions)
        self.assertEqual([self.their_copy], self.files())
        # Both filters given: a session must match both.
        self.assertEqual(0, self.purge(sessions=[OTHER], before="2026-02-01T00:00:00Z").sessions)
        self.assertEqual([self.their_copy], self.files())

    def test_an_owed_copy_is_settled_and_never_made_later(self) -> None:
        with mock.patch.object(transcripts, "HOOK_MAX_BYTES", 0):
            self.deliver(
                "session-end",
                session_id="third",
                transcript_path=self.transcript("third.jsonl", synthetic(2)),
            )
        self.assertEqual(1, len(transcripts.pending(self.conn)))
        self.assertEqual(1, self.purge(sessions=["third"]).owed)
        self.assertEqual([], transcripts.pending(self.conn))
        self.assertEqual(0, self.sweep().archived)
        self.assertFalse(os.path.exists(os.path.join(self.root, "third")))

    def test_a_named_sessions_copy_without_a_row_goes_too(self) -> None:
        stray = os.path.join(self.root, SESSION, "main-0123456789abcdef.jsonl")
        with open(stray, "wb") as handle:
            handle.write(b"{}\n")
        result = self.purge(sessions=[SESSION])
        self.assertEqual(2, result.files)
        self.assertEqual([self.their_copy], self.files())
        reasons = {row["archive_path"]: row["reason"] for row in self.rows(transcripts.PURGED)}
        self.assertEqual(transcripts.ON_REQUEST, reasons[f"{SESSION}/main-0123456789abcdef.jsonl"])

    def test_a_request_must_name_something(self) -> None:
        with self.assertRaises(ValueError):
            self.purge()
        for bad in ("yesterday", "2026-13-01"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                transcripts.before_argument(bad)
        self.assertEqual("2026-02-01T00:00:00Z", transcripts.before_argument("2026-02-01"))
        self.assertEqual(
            "2026-01-31T21:00:00Z", transcripts.before_argument("2026-02-01T00:00:00+03:00")
        )

    def test_the_command_line(self) -> None:
        from server import cli

        self.conn.commit()
        for argv, expected in (
            (["transcripts", "purge", "--session", SESSION, "--dry-run"], "would remove 1 file(s)"),
            (["transcripts", "purge", "--session", SESSION], "removed 1 file(s)"),
        ):
            with self.subTest(argv=argv):
                printed = io.StringIO()
                with mock.patch.object(sys, "stdout", printed):
                    cli.main(argv)
                self.assertIn(expected, printed.getvalue())
                self.assertNotIn(SESSION, printed.getvalue())
        self.assertEqual([self.their_copy], self.files())
        with mock.patch.object(sys, "stderr", io.StringIO()), self.assertRaises(SystemExit):
            cli.main(["transcripts", "purge"])


class HookProcessTests(unittest.TestCase):
    """The real `valkama hook` entry point as a client runs it, against a synthetic transcript."""

    def setUp(self) -> None:
        self.home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.home.cleanup)
        self.path = os.path.join(self.home.name, "store", "valkama.sqlite3")
        self.env = {
            **os.environ,
            "VALKAMA_DB": self.path,
            "HOME": self.home.name,
            "USERPROFILE": self.home.name,
        }
        with mock.patch.dict(os.environ, self.env):
            store.connect().close()
        self.client = os.path.join(self.home.name, "client")
        os.makedirs(self.client)

    def hook(self, event: str, payload: dict) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, os.path.join(ROOT, "valkama.py"), "hook", "claude", event],
            input=json.dumps(payload).encode("utf-8"),
            capture_output=True,
            env=self.env,
            timeout=60,
            check=False,
        )

    def transcript(self, name: str, data: bytes) -> str:
        path = os.path.join(self.client, name)
        with open(path, "wb") as handle:
            handle.write(data)
        return path

    def connect(self) -> sqlite3.Connection:
        with mock.patch.dict(os.environ, self.env):
            conn = store.connect()
        self.addCleanup(conn.close)
        return conn

    def end(self, session_id: str, transcript_path: str) -> None:
        done = self.hook(
            "session-end",
            {
                "session_id": session_id,
                "transcript_path": transcript_path,
                "hook_event_name": "SessionEnd",
                "reason": "exit",
            },
        )
        self.assertEqual((0, b""), (done.returncode, done.stdout), done.stderr[:400])

    def test_the_hook_archives_small_defers_large_and_survives_missing(self) -> None:
        small = synthetic(20)
        large = synthetic(1) * (transcripts.HOOK_MAX_BYTES // len(synthetic(1)) + 10)
        self.end("small", self.transcript("small.jsonl", small))
        self.end("large", self.transcript("large.jsonl", large))
        self.end("missing", os.path.join(self.client, "missing.jsonl"))
        extended = self.transcript("extended.jsonl", synthetic(3))
        self.end("extended", "\\\\?\\" + extended)

        conn = self.connect()
        ended = {
            row[0]
            for row in conn.execute(
                "SELECT session_id FROM execution_events WHERE kind = 'session_end'"
            )
        }
        self.assertEqual({"small", "large", "missing", "extended"}, ended)
        archived = {
            row["session_id"]: row
            for row in conn.execute(
                "SELECT * FROM execution_events WHERE kind = ?", (transcripts.ARCHIVED,)
            )
        }
        self.assertEqual({"small", "extended"}, set(archived))
        self.assertEqual(sha(small), archived["small"]["archive_sha256"])
        self.assertEqual(extended, archived["extended"]["transcript_path"])
        self.assertEqual(
            {"large", "missing"}, {owed.session_id for owed in transcripts.pending(conn)}
        )

        result = transcripts.sweep(conn, root=transcripts.directory(self.path))
        self.assertEqual((1, 1), (result.archived, result.missing))
        (copied,) = conn.execute(
            "SELECT archive_path, archive_sha256 FROM execution_events"
            " WHERE kind = ? AND session_id = 'large'",
            (transcripts.ARCHIVED,),
        ).fetchall()
        self.assertEqual(sha(large), copied[1])
        root = transcripts.directory(self.path)
        with open(os.path.join(root, *copied[0].split("/")), "rb") as handle:
            self.assertEqual(sha(large), sha(handle.read()))


if __name__ == "__main__":
    unittest.main()
