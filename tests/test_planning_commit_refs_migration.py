"""Commit refs carried into commits by the work-model migration.

The text of each 2.9 commit ref is read by one rule (`item_projects.read_commit_text`)
and asked of Git in the registered roots (`item_projects.commit_pairs`);
`valkama projects map-items` writes what that gives into the file's `commit_refs`, the
migration checks the file before its first write and `commit-refs` carries each record over.
The stores are the ones the migration's own tests build, with refs added in the plain
SQL 2.9 wrote, and the repositories are made by git. Expected rows and counts are
written out by hand from the rule, ref by ref.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from collections.abc import Callable
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import cli, processes, store, store_steps
from server.planning import item_projects
from tests import registry_fixtures
from tests.test_planning_item_projects_migration import bound, git, repository
from tests.test_planning_work_model_migration import (
    T0,
    T1,
    T2,
    T3,
    StoreCase,
    file_digest,
    identity,
    once,
    registry,
    several,
    with_step,
)

HASH = "3f2a9c1d"
FULL = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567"
RIGHT = "fedcba98765432100123456789abcdef01234567"


class ReadCommitTextTests(unittest.TestCase):
    """Each form a commit ref's text took, read before any repository is asked."""

    def assert_read(
        self, value: str, words: list, skipped: list | None = None, *, url: bool = False
    ) -> item_projects.CommitText:
        text = item_projects.read_commit_text(value)
        self.assertEqual(
            (tuple(words), tuple(skipped or []), url), (text.words, text.skipped, text.url), value
        )
        return text

    def test_a_bare_hash_is_plain_in_lower_case(self) -> None:
        self.assertTrue(self.assert_read(f" {HASH.upper()} ", [(None, HASH)]).plain)
        # A hex word of letters only is a hash too: 2.9 stored such abbreviations.
        self.assertTrue(self.assert_read("baddeed", [(None, "baddeed")]).plain)

    def test_a_hint_before_the_hash_names_the_repository(self) -> None:
        for value in (
            f"valkama@{HASH}",
            f"Valkama {HASH}",
            f"valkama:{HASH}",
            f"Owner/valkama@{HASH}",
            f"libs/services/valkama@{HASH}",
        ):
            with self.subTest(value=value):
                self.assertTrue(self.assert_read(value, [("valkama", HASH)]).plain)

    def test_a_commit_address_reads_as_name_at_hash(self) -> None:
        for value in (
            f"https://github.com/Owner/Alpha/commit/{FULL}",
            f"https://gitlab.example/group/alpha/-/commit/{FULL}",
            f"https://github.com/owner/alpha/commit/{FULL}?diff=split",
        ):
            with self.subTest(value=value):
                text = self.assert_read(value, [("alpha", FULL)])
                self.assertFalse(text.plain)

    def test_another_address_names_no_commit_and_is_a_url(self) -> None:
        self.assert_read(f"https://example.invalid/pulls/{HASH}", [], url=True)

    def test_several_hashes_skip_the_base_and_the_left_end_of_a_range(self) -> None:
        text = self.assert_read(
            "topic/fix: 1111111 2222222 (base 3333333) from abcdef0, Onto: 1234abc",
            [(None, "1111111"), ("1111111", "2222222")],
            ["3333333", "abcdef0", "1234abc"],
        )
        self.assertFalse(text.plain)
        self.assert_read(
            "wip 4444444 (6 коммитов от 5555555, не слито)", [("wip", "4444444")], ["5555555"]
        )
        self.assert_read(f"{FULL}..{RIGHT}", [(None, RIGHT)], [FULL])
        self.assert_read(f"{FULL}...{RIGHT}", [(None, RIGHT)], [FULL])
        # A merge commit is work: only the starting points are skipped.
        self.assert_read(
            "main 6666666 (merge 7777777)", [("main", "6666666"), ("merge", "7777777")]
        )

    def test_a_hash_named_twice_counts_once(self) -> None:
        self.assert_read(f"{HASH}, {HASH.upper()}", [(None, HASH)])

    def test_a_text_without_a_hash_names_nothing(self) -> None:
        for value in ("pending", "notes@HEAD-plan", "facade", "v0.28.0", ""):
            with self.subTest(value=value):
                self.assert_read(value, [])

    def test_the_label_keeps_a_note_the_text_carries(self) -> None:
        address = f"https://github.com/owner/alpha/commit/{FULL}"
        cases = (
            ("fix", HASH, "fix"),
            ("fix", f"owner/alpha@{HASH}", "fix"),
            ("", f"alpha {HASH}", ""),
            ("fix", address, f"fix — {address}"),
            ("", address, address),
            ("", f" 6 commits from {HASH} ", f"6 commits from {HASH}"),
        )
        for label, value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(expected, item_projects.commit_label(label, value))


class CommitPairsTests(unittest.TestCase):
    """The commits a text names, asked of Git in the registered roots."""

    def setUp(self) -> None:
        self.home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.home.cleanup)
        roots = os.path.join(self.home.name, "roots")
        self.alone = repository(os.path.join(roots, "alpha"), "alpha subject")
        self.shared = repository(os.path.join(roots, "beta"), "beta")
        git(roots, "clone", "--quiet", os.path.join(roots, "beta"), os.path.join(roots, "gamma"))
        os.makedirs(os.path.join(roots, "plain"))
        self.projects = [
            {"project_id": name, "canonical_root": os.path.join(roots, name)}
            for name in ("alpha", "beta", "gamma", "plain", "away")
        ]
        self.committed_at = git(os.path.join(roots, "alpha"), "log", "-1", "--format=%cI")

    def pair(self, project: str | None, hash_: str, described: bool = False) -> dict:
        subject, at = ("alpha subject", self.committed_at) if described else ("", None)
        return {"project": project, "hash": hash_, "subject": subject, "committed_at": at}

    def test_each_text_resolves_by_its_hint_then_by_the_one_repository_holding_it(self) -> None:
        short = self.alone[:9]
        found = item_projects.commit_pairs(
            [
                short,
                f"beta@{short}",
                f"Owner/away@{short}",
                f"elsewhere@{short}",
                self.shared[:10],
                "0" * 40,
                f"https://github.com/owner/alpha/commit/{short}",
                f"done {short} (base {self.shared[:8]})",
                "https://example.invalid/x",
                "pending",
            ],
            self.projects,
        )
        whole = self.pair("alpha", self.alone, described=True)
        self.assertEqual(
            {
                # One repository holds it: its project and the whole hash, described.
                short: {"pairs": [whole], "skipped": [], "url": False},
                # A registered hint wins, holding it or not; the hash stays as written.
                f"beta@{short}": {"pairs": [self.pair("beta", short)], "skipped": [], "url": False},
                f"Owner/away@{short}": {
                    "pairs": [self.pair("away", short)],
                    "skipped": [],
                    "url": False,
                },
                # A hint nobody registered is no hint.
                f"elsewhere@{short}": {"pairs": [whole], "skipped": [], "url": False},
                # Two repositories, or none, hold it: no project, as written.
                self.shared[:10]: {
                    "pairs": [self.pair(None, self.shared[:10])],
                    "skipped": [],
                    "url": False,
                },
                "0" * 40: {"pairs": [self.pair(None, "0" * 40)], "skipped": [], "url": False},
                f"https://github.com/owner/alpha/commit/{short}": {
                    "pairs": [whole],
                    "skipped": [],
                    "url": False,
                },
                f"done {short} (base {self.shared[:8]})": {
                    "pairs": [whole],
                    "skipped": [self.shared[:8]],
                    "url": False,
                },
                "https://example.invalid/x": {"pairs": [], "skipped": [], "url": True},
                "pending": {"pairs": [], "skipped": [], "url": False},
            },
            found,
        )
        self.assertEqual(
            ["alpha", "beta"],
            item_projects.commit_projects(
                [*found[short]["pairs"], self.pair("beta", short), self.pair(None, "abcdef0")]
            ),
        )

    def test_a_branch_named_like_a_hash_is_not_its_commit(self) -> None:
        git(os.path.join(self.home.name, "roots", "plain"), "init", "-q")
        git(os.path.join(self.home.name, "roots", "alpha"), "branch", "abcdef1")
        self.assertEqual(
            [self.pair(None, "abcdef1")],
            item_projects.commit_pairs(["abcdef1"], self.projects)["abcdef1"]["pairs"],
        )

    def test_hints_whose_roots_hold_nothing_ask_no_repository(self) -> None:
        with mock.patch.object(processes, "run_text") as run:
            found = item_projects.commit_pairs(["away@1234567", "a note"], self.projects)
        run.assert_not_called()
        self.assertEqual([self.pair("away", "1234567")], found["away@1234567"]["pairs"])


#: The commit refs added to the store: item, text, label, author, time. `@A` and `@B`
#: stand for the two commits only `work-model` holds, `@S` for the one `shared` and
#: its clone `kept` both hold.
REFS = (
    ("WM-8", "@A", "first", "agent-a", T1),
    ("WM-8", "work-model@@A7", "second", "agent-b", T2),
    ("WM-8", "https://github.com/owner/work-model/commit/@B", "", "agent-a", T2),
    ("WM-8", "https://example.invalid/other", "notes", "agent-c", T3),
    ("WM-9", "pending", "placeholder", "agent-a", T1),
    ("WM-9", "https://example.invalid/page", "page", "agent-a", T1),
    ("WM-9", "remote@1234567", "", "agent-a", T1),
    ("WM-5", "Owner/shared@@S9", "shared one", "agent-d", T1),
    ("WM-5", "wip abcdef1 (from @A7)", "", "agent-d", T2),
    ("WM-1", "@A", "", "agent-e", T0),
)


class CommitRefsCase(StoreCase):
    """A store holding `REFS`, the registry of `projects map-items`' own tests."""

    def setUp(self) -> None:
        super().setUp()
        roots = os.path.join(self.directory.name, "roots")
        self.a = repository(os.path.join(roots, "work-model"), "work model")
        with open(os.path.join(roots, "work-model", "file.txt"), "a", encoding="utf-8") as handle:
            handle.write("more")
        git(os.path.join(roots, "work-model"), "commit", "-qam", "second commit")
        self.b = git(os.path.join(roots, "work-model"), "rev-parse", "HEAD")
        self.s = repository(os.path.join(roots, "shared"), "shared")
        git(roots, "clone", "--quiet", os.path.join(roots, "shared"), os.path.join(roots, "kept"))
        entries = [
            bound(self.directory.name, "KEEP", "kept", default=True),
            bound(self.directory.name, "WM", "work-model", default=True),
            bound(self.directory.name, "ALT", "other", default=True),
            bound(self.directory.name, "ALT", "remote", default=False),
            {
                "project_id": "shared",
                "display_name": "Shared",
                "canonical_root": os.path.join(roots, "shared"),
                "planning_binding": None,
            },
        ]
        registry(self, self.directory.name, raw=registry_fixtures.registry_bytes(entries))
        conn = sqlite3.connect(self.path)
        try:
            # The item already holds this address as a url ref.
            conn.execute(
                "INSERT INTO work_item_refs(work_item_id, kind, value, created_at)"
                " VALUES(?, 'url', 'https://example.invalid/page', ?)",
                (self.ids["WM-9"], T0),
            )
            self.refs: list[int] = []
            for reference, value, label, author, at in REFS:
                value = (
                    value.replace("@A7", self.a[:7])
                    .replace("@A", self.a)
                    .replace("@B", self.b)
                    .replace("@S9", self.s[:9])
                )
                cursor = conn.execute(
                    "INSERT INTO work_item_refs(work_item_id, kind, value, label, author, created_at)"
                    " VALUES(?, 'commit', ?, ?, ?, ?)",
                    (self.ids[reference], value, label, author, at),
                )
                self.refs.append(int(cursor.lastrowid or 0))
            conn.commit()
        finally:
            conn.close()
        self.output = os.path.join(self.directory.name, "mapped.json")

    def command(self, *arguments: str) -> tuple[int | str, dict | None]:
        output = io.StringIO()
        with (
            mock.patch.dict(os.environ, {"VALKAMA_DB": self.path}),
            contextlib.redirect_stdout(output),
        ):
            try:
                cli.main(list(arguments))
            except SystemExit as exit_:
                return (exit_.code if exit_.code is not None else 0), None
        return 0, json.loads(output.getvalue())

    def map_items(self) -> dict:
        code, summary = self.command("projects", "map-items", "--output", self.output)
        self.assertEqual(0, code)
        assert summary is not None
        self.file = self.output
        return summary

    def document(self) -> dict:
        with open(self.output, encoding="utf-8") as handle:
            return json.load(handle)

    def rewrite(self, change: Callable[[dict], None]) -> None:
        document = self.document()
        change(document)
        with open(self.output, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(document, handle)

    def record(self, document: dict, index: int) -> dict:
        return next(r for r in document["commit_refs"] if r["ref"] == self.refs[index])


class MapItemsCommitRefsTests(CommitRefsCase):
    """`projects map-items` writes a record of each commit ref and says what it becomes."""

    def test_each_ref_gets_its_record_and_the_summary_names_what_to_check(self) -> None:
        summary = self.map_items()
        document = self.document()

        def pair(project: str | None, hash_: str, subject: str = "") -> dict:
            root = os.path.join(self.directory.name, "roots", str(project))
            at = git(root, "log", "--no-walk", "--format=%cI", hash_) if subject else None
            return {"project": project, "hash": hash_, "subject": subject, "committed_at": at}

        a = pair("work-model", self.a, "work model")
        self.assertEqual(self.refs, [record["ref"] for record in document["commit_refs"]])
        expected = [
            ("WM-8", [a], [], False, False),
            ("WM-8", [a], [], False, False),
            ("WM-8", [pair("work-model", self.b, "second commit")], [], False, False),
            ("WM-8", [], [], True, False),
            ("WM-9", [], [], False, True),
            ("WM-9", [], [], True, False),
            ("WM-9", [pair("remote", "1234567")], [], False, False),
            ("WM-5", [pair("shared", self.s, "shared")], [], False, False),
            ("WM-5", [pair(None, "abcdef1")], [self.a[:7]], False, False),
            ("WM-1", [a], [], False, False),
        ]
        for index, (reference, pairs, skipped, url, drop) in enumerate(expected):
            self.assertEqual(
                {
                    "ref": self.refs[index],
                    "item": self.ids[reference],
                    "pairs": pairs,
                    "skipped": skipped,
                    "url": url,
                    "drop": drop,
                },
                self.record(document, index),
                index,
            )
        # The projects of a task come from the same pairs: the hinted one too.
        projects = {
            reference: document["items"][self.ids[reference]]["projects"]
            for reference in ("WM-5", "WM-8", "WM-9")
        }
        self.assertEqual(
            {
                "WM-5": [{"project_id": "shared", "source": "commits"}],
                "WM-8": [{"project_id": "work-model", "source": "commits"}],
                "WM-9": [{"project_id": "remote", "source": "commits"}],
            },
            projects,
        )
        commits = summary["commit_refs"]
        self.assertEqual({"shared": 1, "remote": 1, "work-model": 2}, commits["pairs_by_project"])
        self.assertEqual(
            (1, 6, 10),
            (commits["pairs_without_repository"], commits["attachments"], commits["refs"]),
        )
        self.assertEqual(
            [{"ref": self.refs[4], "reference": "WM-9", "value": "pending"}], commits["dropped"]
        )
        self.assertEqual([self.refs[3], self.refs[5]], [shown["ref"] for shown in commits["urls"]])
        self.assertEqual(
            [(self.refs[8], [self.a[:7]])],
            [(shown["ref"], shown["skipped"]) for shown in commits["skipped"]],
        )
        self.assertEqual(
            [
                {
                    "reference": "WM-8",
                    "project": "work-model",
                    "hash": self.a,
                    "labels": ["first", "second"],
                }
            ],
            commits["diverging_labels"],
        )
        self.assertGreaterEqual(commits["seconds"], 0)


class CommitRefsPreconditionTests(CommitRefsCase):
    """E9's conditions on the file, each refused with its reason before any write."""

    def setUp(self) -> None:
        super().setUp()
        self.map_items()

    def assert_refused(self, says: str) -> None:
        before, digest = identity(self.path), file_digest(self.path)
        with self.assertRaises(store.WorkModelPreconditionError) as raised:
            self.migrate()
        self.assertIn(says, str(raised.exception))
        self.assertEqual("refused", raised.exception.report["status"])
        self.assertEqual([], raised.exception.report["steps"])
        self.assertEqual((before, digest), (identity(self.path), file_digest(self.path)))

    def test_a_file_without_commit_refs_is_refused_when_the_store_holds_them(self) -> None:
        self.rewrite(lambda document: document.pop("commit_refs"))
        self.assert_refused("the store holds 10 commit refs and the item projects file has no")

    def test_a_file_from_before_the_refs_changed_is_refused(self) -> None:
        conn = sqlite3.connect(self.path)
        conn.execute(
            "UPDATE work_item_refs SET value = 'pending again' WHERE id = ?", (self.refs[4],)
        )
        conn.commit()
        conn.close()
        self.assert_refused("the item projects file was made from another state of this store")

    def test_each_record_out_of_place_is_refused(self) -> None:
        def take_out(document: dict) -> None:
            document["commit_refs"] = document["commit_refs"][1:]

        def add_one(document: dict) -> None:
            document["commit_refs"].append({**document["commit_refs"][0], "ref": 999})

        def move(document: dict) -> None:
            self.record(document, 0)["item"] = self.ids["WM-9"]

        def unregistered(document: dict) -> None:
            self.record(document, 0)["pairs"][0]["project"] = "ghost"

        def dropped(document: dict) -> None:
            self.record(document, 6)["drop"] = True

        cases = (
            (take_out, f"commit_refs leaves out the commit refs {self.refs[0]}"),
            (add_one, "commit_refs names 999, which are no commit refs"),
            (move, f"commit_refs gives the ref {self.refs[0]} to {self.ids['WM-9']}, but it is on"),
            (
                unregistered,
                f"commit ref {self.refs[0]} names project ghost, which is not registered",
            ),
            (
                dropped,
                f"the file derives project remote from commits it drops for {self.ids['WM-9']}",
            ),
        )
        for change, says in cases:
            with self.subTest(says=says):
                self.map_items_again()
                self.rewrite(change)
                self.assert_refused(says)

    def test_each_malformed_record_is_refused(self) -> None:
        def set_(index: int, key: str, value: object) -> Callable[[dict], None]:
            return lambda document: self.record(document, index).__setitem__(key, value)

        def set_pair(key: str, value: object) -> Callable[[dict], None]:
            return lambda document: self.record(document, 0)["pairs"][0].__setitem__(key, value)

        cases = (
            (lambda document: document.__setitem__("commit_refs", {}), "commit_refs must list"),
            (set_(0, "ref", "1"), "must name its ref by id"),
            (
                lambda document: document["commit_refs"].append(document["commit_refs"][0]),
                "repeats the ref",
            ),
            (set_(0, "url", "no"), "must say true or false for url and drop"),
            (set_(0, "skipped", "3333333"), ".skipped must list hex words"),
            (set_(0, "skipped", ["B3199F3"]), ".skipped must list hex words"),
            (set_(0, "skipped", ["b3199f"]), ".skipped must list hex words"),
            (set_(0, "pairs", {}), ".pairs must be a list"),
            (set_pair("hash", self.a.upper()), ".hash must be 7 to 64 lower-case hex digits"),
            (set_pair("hash", "abcdef"), ".hash must be 7 to 64 lower-case hex digits"),
            (set_pair("project", 7), ".project must be a project id or null"),
            (set_pair("committed_at", 7), "must give its subject as text"),
            (set_(0, "pairs", []), "carries nothing: give it a pair, or set url or drop"),
            (lambda document: self.record(document, 0).pop("drop"), "must hold"),
        )
        for change, says in cases:
            with self.subTest(says=says):
                self.map_items_again()
                self.rewrite(change)
                self.assert_refused(says)

    def map_items_again(self) -> None:
        os.remove(self.output)
        self.map_items()


class CarriedCommitRefsTests(CommitRefsCase):
    """`commit-refs` on the store: each record carried as the file says, held by
    `no-commit-refs`, `other-refs`, `record-pairs`, `commits-attached` and
    `commit-projects`."""

    def setUp(self) -> None:
        super().setUp()
        self.map_items()

    def attachments(self) -> dict[tuple[str, str | None, str], tuple]:
        return {
            (str(row[0]), row[1], str(row[2])): tuple(row[3:])
            for row in self.read(
                "SELECT a.work_item_id, c.project_id, c.hash, a.attached_by, a.label, a.author,"
                " a.created_at FROM work_item_commits a JOIN commits c ON c.commit_id = a.commit_id"
            )
        }

    def test_the_refs_become_commits_and_every_postcondition_holds(self) -> None:
        refs_before = len(self.read("SELECT id FROM work_item_refs"))
        report = self.migrate()
        self.assertEqual("migrated", report["status"])
        self.assertEqual(
            [], [entry["name"] for entry in report["postconditions"] if not entry["passed"]]
        )
        step_commit_refs = next(step for step in report["steps"] if step["name"] == "commit-refs")
        self.assertEqual(
            {"commit_refs": 10, "dropped": 1, "commits": 5, "attachments": 6, "url_refs": 1},
            step_commit_refs["result"],
        )
        # The refs are rebuilt to take no commit once `commit-refs` has left none, keeping the rest.
        rebuilt = next(step for step in report["steps"] if step["name"] == "refs-without-commits")
        self.assertTrue(rebuilt["needed"])
        self.assertEqual(
            (["commit", "memory", "session", "url"], ["memory", "session", "url"], refs_before - 9),
            (
                rebuilt["result"]["kinds_before"],
                rebuilt["result"]["kinds"],
                rebuilt["result"]["refs"],
            ),
        )
        conn = sqlite3.connect(self.path)
        try:
            with self.assertRaisesRegex(sqlite3.IntegrityError, "CHECK constraint failed"):
                conn.execute(
                    "INSERT INTO work_item_refs(work_item_id, kind, value) VALUES(?, 'commit', ?)",
                    (self.ids["WM-1"], self.a),
                )
        finally:
            conn.close()
        post_row_counts = next(
            entry for entry in report["postconditions"] if entry["name"] == "row-counts"
        )
        # Ten commit refs leave, one url ref comes; the other was there already.
        self.assertEqual(
            (refs_before - 10 + 1, 5, 6),
            (
                post_row_counts["detail"]["tables"]["work_item_refs"],
                post_row_counts["detail"]["tables"]["commits"],
                post_row_counts["detail"]["tables"]["work_item_commits"],
            ),
        )
        address = f"https://github.com/owner/work-model/commit/{self.b}"
        migrated = "migrated"
        self.assertEqual(
            {
                # Two refs naming one commit: one attachment, the first's label and maker.
                (self.ids["WM-8"], "work-model", self.a): (migrated, "first", "agent-a", T1),
                (self.ids["WM-8"], "work-model", self.b): (migrated, address, "agent-a", T2),
                (self.ids["WM-9"], "remote", "1234567"): (migrated, "", "agent-a", T1),
                (self.ids["WM-5"], "shared", self.s): (migrated, "shared one", "agent-d", T1),
                (self.ids["WM-5"], None, "abcdef1"): (
                    migrated,
                    f"wip abcdef1 (from {self.a[:7]})",
                    "agent-d",
                    T2,
                ),
                (self.ids["WM-1"], "work-model", self.a): (migrated, "", "agent-e", T0),
            },
            self.attachments(),
        )
        commits = {
            (row[0], str(row[1])): tuple(row[2:])
            for row in self.read(
                "SELECT project_id, hash, subject, committed_at IS NOT NULL, session_id,"
                " reported_at, rewritten_to, rewrite_recorded_ns FROM commits"
            )
        }
        self.assertEqual(
            {
                # Reported when its earliest ref was made, by no session, rewritten by none.
                ("work-model", self.a): ("work model", 1, None, T0, None, None),
                ("work-model", self.b): ("second commit", 1, None, T2, None, None),
                ("remote", "1234567"): ("", 0, None, T1, None, None),
                ("shared", self.s): ("shared", 1, None, T1, None, None),
                (None, "abcdef1"): ("", 0, None, T2, None, None),
            },
            commits,
        )
        refs = {
            (str(row[0]), str(row[1]), str(row[2]), str(row[3]))
            for row in self.read(
                "SELECT work_item_id, kind, value, label FROM work_item_refs WHERE kind != 'session'"
            )
        }
        self.assertEqual(
            {
                (self.ids["WM-9"], "url", "https://example.invalid/page", ""),
                (self.ids["WM-8"], "url", "https://example.invalid/other", "notes"),
            },
            refs,
        )
        # A second run finds the store current and changes nothing, the refs' CHECK
        # among it.
        before = identity(self.path)
        self.assertEqual("current", self.migrate()["status"])
        self.assertEqual(before, identity(self.path))

    def test_a_dropped_record_carries_nothing(self) -> None:
        def drop(document: dict) -> None:
            for index in (2, 3):
                self.record(document, index)["drop"] = True

        self.rewrite(drop)
        report = self.migrate()
        self.assertEqual(
            [], [entry["name"] for entry in report["postconditions"] if not entry["passed"]]
        )
        self.assertNotIn((self.ids["WM-8"], "work-model", self.b), self.attachments())
        self.assertEqual(
            [],
            self.read("SELECT 1 FROM work_item_refs WHERE value = 'https://example.invalid/other'"),
        )

    def test_each_postcondition_refuses_a_store_that_breaks_it(self) -> None:
        cases: tuple[tuple[str, str, Callable[[dict[str, str]], list[tuple[str, tuple]]]], ...] = (
            (
                "record-pairs",
                "attached by manual",
                lambda _ids: [("UPDATE work_item_commits SET attached_by = 'manual'", ())],
            ),
            (
                "record-pairs",
                "lacks",
                lambda ids: [
                    ("DELETE FROM work_item_commits WHERE work_item_id = ?", (ids["WM-1"],))
                ],
            ),
            (
                "commits-attached",
                "names the session",
                lambda _ids: [("UPDATE commits SET session_id = 'a-session'", ())],
            ),
            (
                "commits-attached",
                "carries a rewrite recorded at 1",
                lambda _ids: [("UPDATE commits SET rewrite_recorded_ns = 1", ())],
            ),
            (
                "commits-attached",
                "is attached to nothing",
                lambda ids: [
                    ("DELETE FROM work_item_commits WHERE work_item_id != ?", (ids["WM-8"],))
                ],
            ),
            (
                "commit-projects",
                "holds remote from commits it has none of",
                lambda ids: [
                    ("DELETE FROM work_item_commits WHERE work_item_id = ?", (ids["WM-9"],))
                ],
            ),
            (
                "other-refs",
                "lacks [('url', 'https://example.invalid/other')]",
                lambda _ids: [
                    ("DELETE FROM work_item_refs WHERE value = 'https://example.invalid/other'", ())
                ],
            ),
        )
        for name, says, statements in cases:
            with self.subTest(postcondition=name, says=says):
                before, digest = identity(self.path), file_digest(self.path)
                step = once(says, several(statements, self.ids))
                with with_step(step), self.assertRaises(store_steps.RunFailedError) as raised:
                    self.migrate()
                self.assertEqual((before, digest), (identity(self.path), file_digest(self.path)))
                entry = next(
                    entry
                    for entry in raised.exception.report["postconditions"]
                    if entry["name"] == name
                )
                self.assertFalse(entry["passed"])
                self.assertIn(says, entry["error"])


if __name__ == "__main__":
    unittest.main()
