"""Rewritten and merged commits, in real Git, taken by the client hook.

Every commit, amend, rebase and merge here is made by `git` itself with the hooks
the release writes (`commit_fixtures`), and the client hook is `valkama hook`, as
in the pickup tests. A rewrite carries the links of each commit Valkama knows to
its new commit; a merge reports only the merge commit it made now.
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import threading
import time
import unittest

from server import mcp_surface
from server.hooks import commit_records, notify
from server.planning import calls, commits, sweep

from .commit_fixtures import CLAUDE, PROJECT, SCRIPT
from .test_commits_pickup import RuleCase, context

#: Turns the second line of a `rebase -i` list into a squash into the first.
SQUASH_SECOND = "sed -i -e '2s/^pick/squash/'"
#: A second Claude Code session, S2.
OTHER = "019a3c2e-cccc-7c11-9e0f-2f4b6d8a1c3e"


class RewriteCase(RuleCase):
    def setUp(self) -> None:
        super().setUp()
        self.session = self.place.sessions(CLAUDE_CODE_SESSION_ID=CLAUDE)
        self.repository = self.place.repository

    def git(self, *arguments: str, session: bool = True, **variables: str) -> str:
        environ = {**(self.session if session else self.place.environ), **variables}
        found = self.place.git(self.repository, *arguments, environ=environ)
        return found.stdout.decode("utf-8").strip()

    def made(self, name: str, *, session: bool = True, subject: str = "") -> str:
        """A commit of one new file; its hash."""

        (self.repository / f"{name}.txt").write_text(name, encoding="utf-8")
        self.git("add", f"{name}.txt", session=session)
        self.git("commit", "-qm", subject or f"feat: {name}", session=session)
        return self.place.head()

    def amended(self) -> str:
        """HEAD amended with one more file, so its tree and its hash change."""

        (self.repository / "amended.txt").write_text("amended", encoding="utf-8")
        self.git("add", "amended.txt")
        self.git("commit", "-q", "--amend", "--no-edit")
        return self.place.head()

    def taken(self) -> str:
        """The client hook of the shell call that did all of it, and what it answers."""

        stdout, stderr = self.claude()
        self.assertEqual("", stderr)
        return context(stdout) if stdout else ""

    def rewritten(self) -> dict[str, str | None]:
        """Each recorded commit, by hash, and the hash of the commit that replaced it."""

        return {
            str(row[0]): row[1]
            for row in self.conn.execute(
                "SELECT c.hash, n.hash FROM commits c"
                " LEFT JOIN commits n ON n.commit_id = c.rewritten_to"
            )
        }

    def decisions(self) -> int:
        found = self.conn.execute(
            "SELECT COUNT(*) FROM work_item_events WHERE action = 'commit_attached'"
        )
        return int(found.fetchone()[0])

    def attach(self, reference: str, commit: str) -> None:
        self.tool(
            "apply_work_item_changes",
            id=reference,
            commits=[{"repository": PROJECT, "hash": commit}],
        )

    def moved(self, old: str, new: str) -> str:
        return f"Valkama moved the links of {PROJECT} {old[:9]} to the rewritten commit {new[:9]}."

    def rewrites(self) -> list[tuple[str, str, str]]:
        """Each `commit_rewritten` event: its card, its detail and who signed it."""

        return [
            (self.reference(str(row[0])), str(row[1]), str(row[2]))
            for row in self.conn.execute(
                "SELECT work_item_id, detail, author FROM work_item_events"
                " WHERE action = 'commit_rewritten' ORDER BY id"
            )
        ]


class AmendTests(RewriteCase):
    """An amend replaces the commit on its card, whichever call reports which."""

    def test_amend_moves_the_link(self) -> None:
        t1 = self.task("Held", PROJECT)
        self.claim(t1)
        old = self.made("one")
        self.taken()
        self.assertEqual([(t1, old, "server", "valkama")], self.attached())
        new = self.amended()
        self.assertEqual(2, len(self.place.beside_the_store()), "post-commit and post-rewrite")
        self.assertEqual(self.moved(old, new), self.taken())
        self.assertEqual([(t1, new, "server", "valkama")], self.attached())
        self.assertEqual({old: new, new: None}, self.rewritten())
        self.assertEqual(1, self.decisions(), "the amend is decided once, by the old commit")
        self.assertEqual([], self.waiting(), "the new commit is on its card")
        self.assertEqual([], self.place.everywhere())

    def test_commit_and_amend_in_one_call_leave_one_link(self) -> None:
        t1 = self.task("Held", PROJECT)
        self.claim(t1)
        old = self.made("one")
        new = self.amended()
        files = self.place.beside_the_store()
        self.assertEqual(3, len(files), "post-commit, post-commit and post-rewrite")
        self.assertEqual(
            ["post-commit", "post-commit", "post-rewrite"],
            [json.loads(path.read_bytes())["event"] for path in files],
        )
        line = self.taken()
        self.assertEqual(
            f"Valkama attached your commit {self.short(old)} to {t1}.\n{self.moved(old, new)}",
            line,
        )
        self.assertEqual([(t1, new, "server", "valkama")], self.attached())
        self.assertEqual({old: new, new: None}, self.rewritten())
        self.assertEqual(1, self.decisions())
        self.assertEqual([], self.waiting())
        self.assertEqual([], self.place.everywhere())

    def test_an_amend_reported_apart_unites_the_links(self) -> None:
        """The new commit decided on its own, in an earlier batch, keeps that decision, and
        the rewrite adds the old commit's links to it."""

        t1, t2 = self.task("First", PROJECT), self.task("Second", PROJECT)
        self.claim(t1)
        old = self.made("one")
        self.taken()
        new = self.amended()
        post_commit, post_rewrite = self.place.beside_the_store()
        held = post_rewrite.read_bytes()
        post_rewrite.unlink()
        self.tool("claim_work_item", id=t1, release=True)
        self.claim(t2)
        self.taken()
        self.assertEqual({(t1, old), (t2, new)}, {row[:2] for row in self.attached()})
        post_rewrite.write_bytes(held)
        self.taken()
        self.assertEqual({(t1, new), (t2, new)}, {row[:2] for row in self.attached()})
        self.assertFalse(post_commit.exists())
        self.assertEqual(
            [(t1, f"{PROJECT} {old} -> {new}", "valkama")],
            self.rewrites(),
            "the card whose attachment the rewrite carried over; T2 had the new commit already",
        )

    def test_a_rewrite_leaves_an_event_on_each_card_it_moved(self) -> None:
        t1, t2, t3 = (self.task(title, PROJECT) for title in ("Held", "Other", "Also"))
        self.claim(t1)
        old = self.made("one")
        self.taken()
        self.attach(t3, old)
        self.attach(t2, self.made("two", session=False))
        self.git("reset", "-q", "--hard", old)
        new = self.amended()
        self.assertEqual(self.moved(old, new), self.taken(), "the event is no news")
        self.assertEqual(
            [
                (t1, f"{PROJECT} {old} -> {new}", "valkama"),
                (t3, f"{PROJECT} {old} -> {new}", "valkama"),
            ],
            sorted(self.rewrites()),
        )
        self.assertEqual([], [event for event in self.rewrites() if event[0] == t2])
        stdout, _ = self.claude(**{"duration_ms": 600_000})
        self.assertEqual(b"", stdout, "taken again, the record moves nothing")
        self.assertEqual(2, len(self.rewrites()), "one per card and pair")

    def test_an_amend_of_an_unknown_commit_is_the_session_s_commit(self) -> None:
        t1 = self.task("Held", PROJECT)
        self.made("a-person-s", session=False)
        self.claim(t1)
        new = self.amended()
        line = self.taken()
        self.assertEqual(f"Valkama attached your commit {self.short(new)} to {t1}.", line)
        self.assertEqual([(t1, new, "server", "valkama")], self.attached())
        self.assertEqual({new: None}, self.rewritten())

    def test_a_rewrite_back_returns_the_first_commit(self) -> None:
        """Two amends at a pinned committer time: the second makes the first commit again."""

        pinned = {
            "GIT_COMMITTER_DATE": "2026-11-20T10:00:00Z",
            "GIT_AUTHOR_DATE": "2026-11-20T10:00:00Z",
        }
        t1 = self.task("Held", PROJECT)
        self.claim(t1)
        (self.repository / "one.txt").write_text("one", encoding="utf-8")
        self.git("add", "one.txt")
        self.git("commit", "-qm", "feat: one", **pinned)
        first = self.place.head()
        self.taken()
        (self.repository / "amended.txt").write_text("amended", encoding="utf-8")
        self.git("add", "amended.txt")
        self.git("commit", "-q", "--amend", "--no-edit", **pinned)
        second = self.place.head()
        self.git("rm", "-q", "amended.txt")
        self.git("commit", "-q", "--amend", "--no-edit", **pinned)
        self.assertEqual(first, self.place.head(), "the second amend made the first commit again")
        self.assertEqual(f"{self.moved(first, second)}\n{self.moved(second, first)}", self.taken())
        self.assertEqual([(t1, first, "server", "valkama")], self.attached())
        self.assertEqual({first: None, second: first}, self.rewritten())
        card = self.tool("get_work_item", id=t1, parts="commits")
        self.assertEqual([first], [commit["hash"] for commit in card["commits"]])
        self.assertEqual([], self.waiting(), "the second commit is hidden")
        written = self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0]
        self.git("commit", "-q", "--amend", "--no-edit", **pinned)
        self.assertEqual(first, self.place.head(), "an amend that changes nothing: c -> c")
        self.assertEqual("", self.taken(), "a pair of one hash changes nothing")
        self.assertEqual([(t1, first, "server", "valkama")], self.attached())
        self.assertEqual({first: None, second: first}, self.rewritten())
        self.assertEqual(
            written, self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0]
        )
        self.assertEqual([], self.place.everywhere())


class RebaseTests(RewriteCase):
    """A rebase moves the links, a squash unites them, and foreign commits stay out."""

    def topic(self, *names: str, session: bool = True, base: bool = True) -> list[str]:
        """Commits on a branch `topic` off main and, with `base`, one more on main; back on
        `topic`."""

        self.git("checkout", "-q", "-b", "topic")
        made = [self.made(name, session=session) for name in names]
        if base:
            self.git("checkout", "-q", "main")
            self.made("base", session=False)
            self.git("checkout", "-q", "topic")
        return made

    def test_rebase_moves_links_and_squash_unites_them(self) -> None:
        t1, t2 = self.task("First", PROJECT), self.task("Second", PROJECT)
        self.claim(t1)
        self.claim(t2)
        c1, c2 = self.topic("one", "two")
        self.taken()  # both fit two tasks: on no card yet
        self.attach(t1, c1)
        self.attach(t2, c2)
        self.git("rebase", "-q", "main")
        c1_new, c2_new = self.git("rev-list", "--reverse", "main..topic").split()
        self.assertEqual(f"{self.moved(c1, c1_new)}\n{self.moved(c2, c2_new)}", self.taken())
        self.assertEqual(
            [(t1, c1_new, "manual", "agent"), (t2, c2_new, "manual", "agent")],
            self.attached(),
        )
        rows = self.conn.execute(
            "SELECT hash, session_id FROM commits WHERE hash IN (?, ?) ORDER BY hash",
            (c1_new, c2_new),
        ).fetchall()
        self.assertEqual({CLAUDE}, {row[1] for row in rows}, "the old commits' session")

        self.git("rebase", "-q", "-i", "main", GIT_SEQUENCE_EDITOR=SQUASH_SECOND, GIT_EDITOR="true")
        [squashed] = self.git("rev-list", "main..topic").split()
        self.taken()
        self.assertEqual({(t1, squashed), (t2, squashed)}, {row[:2] for row in self.attached()})
        found = self.rewritten()
        self.assertEqual(
            (squashed, squashed, c1_new, c2_new),
            (found[c1_new], found[c2_new], found[c1], found[c2]),
        )
        self.assertIsNone(found[squashed])
        self.assertEqual([], self.waiting())
        self.assertEqual([], self.place.everywhere())

    def test_autosquash_amend_inside_rebase_moves_once(self) -> None:
        t1 = self.task("Held", PROJECT)
        self.claim(t1)
        # main stays where it was: the rebase keeps c3 and squashes the fixup into it, by
        # an amend inside the rebase, which moves the links first.
        [c3] = self.topic("three", base=False)
        (self.repository / "three.txt").write_text("three, fixed", encoding="utf-8")
        self.git("commit", "-q", "-a", "-m", "fixup! feat: three")
        fixup = self.place.head()
        self.taken()
        self.assertEqual({(t1, c3), (t1, fixup)}, {row[:2] for row in self.attached()})
        self.git("rebase", "-q", "-i", "--autosquash", "main", GIT_SEQUENCE_EDITOR="true")
        [squashed] = self.git("rev-list", "main..topic").split()
        events = [
            json.loads(path.read_bytes())["rewrite"] for path in self.place.beside_the_store()
        ]
        self.assertEqual(["amend", "rebase"], events, "an amend inside the rebase, then its own")
        self.taken()
        self.assertEqual([(t1, squashed, "server", "valkama")], self.attached())
        found = self.rewritten()
        self.assertEqual((squashed, squashed, None), (found[c3], found[fixup], found[squashed]))
        self.assertEqual(2, self.decisions(), "the two commits' own; the rewrite decides nothing")
        self.assertEqual([], self.place.everywhere())

    def test_rebasing_unknown_commits_records_nothing(self) -> None:
        self.claim(self.task("Held", PROJECT))
        self.topic("theirs-one", "theirs-two", session=False)
        self.git("rebase", "-q", "main")
        [record] = self.place.beside_the_store()
        self.assertEqual((b"", ""), self.claude(), "nothing to say")
        self.assertEqual([], self.rows())
        self.assertFalse(record.exists(), "worked off at once, and deleted")


class MergeTests(RewriteCase):
    """A merge made now counts; what a merge or a fast-forward brings does not."""

    def branch(self, name: str, *commits: str, start: str = "main") -> None:
        """A branch `name` off `start` with commits nobody's session made; back on main."""

        self.git("checkout", "-q", "-b", name, start, session=False)
        for commit in commits:
            self.made(commit, session=False)
        self.git("checkout", "-q", "main", session=False)

    def test_a_merge_commit_counts_and_what_it_brings_does_not(self) -> None:
        t1 = self.task("Held", PROJECT)
        self.claim(t1)
        self.branch("other", "other-one", "other-two")
        self.made("main-side", session=False)
        self.git("merge", "--no-edit", "-q", "other")
        merge = self.place.head()
        self.assertEqual(2, len(self.git("log", "-1", "--format=%P").split()), "a merge commit")
        [record] = self.place.beside_the_store()
        self.assertEqual(
            ("post-merge", [merge]),
            (
                json.loads(record.read_bytes())["event"],
                [commit["hash"] for commit in json.loads(record.read_bytes())["commits"]],
            ),
        )
        line = self.taken()
        self.assertEqual(f"Valkama attached your commit {self.short(merge)} to {t1}.", line)
        self.assertEqual([merge], [row[1] for row in self.rows()])

    def test_a_fast_forward_to_an_unknown_merge_records_nothing(self) -> None:
        start = self.place.head()
        # `theirs`: a merge M whose first parent is main, by another committer.
        self.branch("side", "side-one", start=start)
        self.git("checkout", "-q", "-b", "theirs", start, session=False)
        self.git(
            "merge",
            "--no-ff",
            "--no-edit",
            "-q",
            "side",
            session=False,
            GIT_COMMITTER_EMAIL="someone-else@example.invalid",
        )
        merge = self.place.head()
        # `late`: a merge M2 on top of M by the same committer, ten minutes ago.
        self.branch("late-side", "late-one", start=merge)
        self.git("checkout", "-q", "-b", "late", merge, session=False)
        self.git(
            "merge",
            "--no-ff",
            "--no-edit",
            "-q",
            "late-side",
            session=False,
            GIT_COMMITTER_DATE=f"{int(time.time()) - 600} +0000",
        )
        late = self.place.head()
        self.git("checkout", "-q", "main", session=False)
        for branch, expected in (("theirs", merge), ("late", late)):
            with self.subTest(branch=branch):
                self.git("merge", "--ff-only", "-q", branch)
                self.assertEqual(expected, self.place.head())
                self.assertEqual(
                    2, len(self.git("log", "-1", "--format=%P").split()), "a merge commit"
                )
                self.assertEqual([], self.place.everywhere())
        self.assertEqual([], self.rows())


class OrderAcrossSessionsTests(RewriteCase):
    """Records apply in one time order across sessions, whichever reader takes them.

    S1 holds T1 and S2 holds T2, both of `alpha`. S2 commits d, S1 commits c, and
    S2 amends c into c'. The record of S1's commit lies on disk before S2's amend,
    and S2's own commit d before both, so a pass grouped by session would decide
    c' as S2's commit before it knew c.
    """

    def setUp(self) -> None:
        super().setUp()
        self.t1, self.t2 = self.task("First", PROJECT), self.task("Second", PROJECT)
        self.claim(self.t1)
        meta = {"sessionId": OTHER, "threadId": OTHER}
        mcp_surface.call_tool(self.conn, "claim_work_item", {"id": self.t2}, meta=meta)
        self.conn.commit()
        self.d = self.by_other("d")
        self.c = self.made("c")
        (self.repository / "amended.txt").write_text("amended", encoding="utf-8")
        self.git("add", "amended.txt", session=False, CLAUDE_CODE_SESSION_ID=OTHER)
        self.git(
            "commit", "-q", "--amend", "--no-edit", session=False, CLAUDE_CODE_SESSION_ID=OTHER
        )
        self.amended = self.place.head()

    def by_other(self, name: str) -> str:
        (self.repository / f"{name}.txt").write_text(name, encoding="utf-8")
        self.git("add", f"{name}.txt", session=False, CLAUDE_CODE_SESSION_ID=OTHER)
        self.git("commit", "-qm", f"feat: {name}", session=False, CLAUDE_CODE_SESSION_ID=OTHER)
        return self.place.head()

    def settled(self) -> None:
        """c' on T1, as S1 decided c; d on T2; c rewritten to c'."""

        self.assertEqual(
            {(self.t1, self.amended), (self.t2, self.d)},
            {row[:2] for row in self.attached()},
        )
        self.assertEqual(self.amended, self.rewritten()[self.c])

    def s1_finds_its_record_worked_off(self) -> None:
        self.assertEqual(1, len(self.place.everywhere()), "S1's record waits for S1's hook")
        self.finds_worked_off(CLAUDE)

    def s2_finds_its_records_worked_off(self) -> None:
        self.finds_worked_off(OTHER)

    def finds_worked_off(self, session: str) -> None:
        written = self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0]
        stdout, stderr = self.claude(session)
        self.assertEqual(("", b""), (stderr, stdout), "nothing to say: worked off")
        self.assertEqual([], self.place.everywhere())
        self.assertEqual(
            written, self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0]
        )

    def test_a_rewrite_of_another_sessions_commit_waits_for_its_record(self) -> None:
        """The hook of S2 takes the record of S1 lying before its amend first."""

        stdout, stderr = self.claude(OTHER)
        self.assertEqual("", stderr)
        self.assertEqual(
            f"Valkama attached your commit {self.short(self.d)} to {self.t2}.\n"
            f"{self.moved(self.c, self.amended)}",
            context(stdout),
            "S2's lines say nothing of where S1's commit went",
        )
        self.settled()
        self.s1_finds_its_record_worked_off()

    def test_the_sweep_takes_the_same_records_in_the_same_order(self) -> None:
        for path in self.place.everywhere():
            self.aged(path, 61 * 60)
        step = [found for found in sweep.STEPS if found.name == sweep.COMMITS]
        self.assertEqual({sweep.COMMITS: 4}, sweep.run_pass(self.conn, steps=step).changed)
        self.settled()
        self.assertEqual(4, len(self.place.everywhere()), "applied: they wait for a hook")
        self.assertEqual((b"", ""), self.claude(), "S1's record is worked off")
        self.assertEqual(3, len(self.place.everywhere()))
        self.s2_finds_its_records_worked_off()


class ConcurrentPickupTests(RewriteCase):
    """One batch taken twice at once is written once: two processes, two connections."""

    def counts(self) -> tuple[int, int, int]:
        return tuple(
            int(self.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            for table in ("commits", "work_item_commits", "work_item_events")
        )  # type: ignore[return-value]

    def test_two_hook_processes_take_one_batch_once(self) -> None:
        t1 = self.task("Held", PROJECT)
        self.claim(t1)
        self.made("one")
        self.amended()
        before = self.counts()
        payload = json.dumps(
            {"session_id": CLAUDE, "tool_name": "Bash", "duration_ms": 60_000}
        ).encode("utf-8")
        environ = {
            **self.place.environ,
            "VALKAMA_NOTIFY": "off",
            "PYTHONIOENCODING": "utf-8",
        }
        start = threading.Barrier(2)
        answers: list[bytes] = []

        def hook() -> None:
            start.wait()
            done = subprocess.run(
                [sys.executable, "-X", "utf8", SCRIPT, "hook", "claude", "post-tool-use"],
                input=payload,
                env=environ,
                capture_output=True,
                check=False,
                timeout=60,
            )
            self.assertEqual(0, done.returncode)
            answers.append(done.stdout)

        threads = [threading.Thread(target=hook) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(2, len(answers))
        # Two rows, one attachment, and its two events, attached and rewritten; whichever
        # process came second wrote nothing.
        self.assertEqual((before[0] + 2, before[1] + 1, before[2] + 2), self.counts())
        self.assertEqual(1, self.decisions())
        self.assertEqual(1, sum(1 for answer in answers if answer), "one of them answers")
        self.assertEqual([], self.place.everywhere())

    def test_two_connections_take_one_batch_once(self) -> None:
        t1 = self.task("Held", PROJECT)
        self.claim(t1)
        self.made("one")
        self.amended()
        records = commit_records.taken(
            "claude",
            {"session_id": CLAUDE, "tool_name": "Bash", "duration_ms": 60_000},
            str(self.place.store),
            notify.loads,
            time.time_ns(),
        )
        self.assertEqual(3, len(records))
        before = self.counts()
        start = threading.Barrier(2)
        results: list[commits.Taken] = []
        failures: list[str] = []

        def take() -> None:
            conn = sqlite3.connect(self.place.store, timeout=30, isolation_level=None)
            conn.row_factory = sqlite3.Row
            hook = commits.Hook("claude", CLAUDE, None, commit_records.timestamp(time.time_ns()))
            try:
                start.wait()
                conn.execute("BEGIN IMMEDIATE")
                with calls.bind(calls.valkama(), commits.HOOK_TOOL):
                    results.append(commits.take(conn, records, hook))
                conn.execute("COMMIT")
            except sqlite3.Error as error:
                failures.append(f"{type(error).__name__}: {error}")
            finally:
                conn.close()

        threads = [threading.Thread(target=take) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual([], failures)
        self.assertEqual((before[0] + 2, before[1] + 1, before[2] + 2), self.counts())
        first, second = sorted(results, key=lambda taken: len(taken.worked_off))
        self.assertEqual((3, []), (len(first.applied), first.worked_off))
        self.assertEqual(([], 3), (second.applied, len(second.worked_off)), "the second: nothing")


if __name__ == "__main__":
    unittest.main()
