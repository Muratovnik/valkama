"""What `valkama released` says about a real repository and a throwaway store.

The commits here are made by git, and carried and pruned the way an integration
does it, because each step is a claim about what git keeps: a hash that a rebase
replaced, a patch-id that survives it, an object that a deleted branch takes with
it. A stub would only repeat what the code assumes. Each is attached to an item
as a registered project and a hash, the way a card holds it.

The expected step of every case comes from how its commit was made in the test,
not from anything the command computes.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from server import cli, processes, released, store
from server.planning import commits, service
from server.projects import project_registry
from tests.registry_fixtures import project_entry, registry_bytes

SPACE = "MAIN"
#: The registered project whose root is the release checkout.
PROJECT = "alpha"


class ReleasedTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.home.cleanup)
        self.database = os.path.join(self.home.name, "valkama.sqlite3")
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": self.database,
                "USERPROFILE": self.home.name,
                "HOME": self.home.name,
                "LOCALAPPDATA": self.home.name,
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Command Line", key=SPACE)
        self.conn.commit()
        self.repo = self.repository("product")
        # The registry as each read finds it: a test may register more, or less.
        self.projects = {PROJECT: self.repo}
        registry = mock.patch.object(
            project_registry,
            "_read_registry_bytes",
            side_effect=lambda: registry_bytes(
                [project_entry(name, root) for name, root in self.projects.items()]
            ),
        )
        registry.start()
        self.addCleanup(registry.stop)
        # The release is everything after `start` on `main`.
        self.commit(self.repo, "chore: before the release")
        self.git(self.repo, "tag", "start")

    def repository(self, name: str) -> str:
        root = os.path.join(self.home.name, name)
        os.makedirs(root)
        self.git(root, "init", "-b", "main")
        return root

    def git(self, root: str, *args: str) -> str:
        done = processes.run_text(
            [
                "git",
                "-C",
                root,
                "-c",
                "user.name=Test User",
                "-c",
                "user.email=test@example.invalid",
                *args,
            ]
        )
        self.assertEqual(0, done.returncode, done.stderr)
        return done.stdout.strip()

    def commit(self, root: str, subject: str, content: bytes | None = None) -> str:
        """One commit touching a file of its own, returning its full hash."""

        name = hashlib.sha256(subject.encode()).hexdigest()[:12] + ".txt"
        with open(os.path.join(root, name), "wb") as handle:
            handle.write(content if content is not None else subject.encode() + b"\n")
        self.git(root, "add", name)
        self.git(root, "commit", "-m", subject)
        return self.git(root, "rev-parse", "HEAD")

    def carried(self, subject: str, content: bytes | None = None) -> tuple[str, str]:
        """A branch commit integrated into `main`: its hash there and its hash here."""

        self.git(self.repo, "switch", "-c", "topic", "start")
        branch_commit = self.commit(self.repo, subject, content)
        self.git(self.repo, "switch", "main")
        self.commit(self.repo, f"chore: moves main past {subject}")
        self.git(self.repo, "cherry-pick", branch_commit)
        integrated = self.git(self.repo, "rev-parse", "HEAD")
        self.assertNotEqual(branch_commit, integrated)
        return branch_commit, integrated

    def remove_the_branch(self, commit: str) -> None:
        """Delete the branch and its object, as a pruned repository has."""

        self.git(self.repo, "branch", "-D", "topic")
        self.git(self.repo, "reflog", "expire", "--expire=now", "--expire-unreachable=now", "--all")
        self.git(self.repo, "gc", "--prune=now", "--quiet")
        gone = processes.run_text(["git", "-C", self.repo, "cat-file", "-e", commit])
        self.assertNotEqual(0, gone.returncode, "the object survived; the case proves nothing")

    def item(self, title: str, *attached: str | tuple[str | None, str, str]) -> str:
        """An open item with these commits attached: a hash of the release checkout's
        project, attached by hand as a person would, or `(project, hash, subject)`
        recorded as the migration records a commit, with no repository when `project`
        is None."""

        created = service.create_work_item(self.conn, space=SPACE, title=title)
        reference = str(created["reference"])
        for entry in attached:
            if isinstance(entry, str):
                commits.attach(self.conn, reference, PROJECT, entry)
                continue
            project, recorded, subject = entry
            commit_id = self.conn.execute(
                "INSERT INTO commits(project_id, hash, subject, reported_at)"
                " VALUES (?,?,?,'2026-01-02T03:04:05Z')",
                (project, recorded, subject),
            ).lastrowid
            self.conn.execute(
                "INSERT INTO work_item_commits(work_item_id, commit_id, attached_by)"
                " VALUES ((SELECT work_item_id FROM work_items WHERE title = ?), ?, 'migrated')",
                (title, commit_id),
            )
        self.conn.commit()
        return reference

    def close_item(self, reference: str) -> None:
        service.transition_work_item(
            self.conn, reference, "completed", force=True, acceptance="assignment"
        )
        self.conn.commit()

    def report(self, *extra: str, revisions: str = "start..main", repo: str = "") -> dict:
        arguments = ["--space", SPACE, "--repo", repo or self.repo, "--range", revisions, *extra]
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            cli.main(["released", *arguments, "--json"])
        return json.loads(stream.getvalue())

    def text(self, revisions: str = "start..main") -> str:
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            cli.main(["released", "--space", SPACE, "--repo", self.repo, "--range", revisions])
        return stream.getvalue()

    def found(self, reference: str, report: dict | None = None) -> dict | None:
        items = (report or self.report())["items"]
        return next((item for item in items if item["reference"] == reference), None)

    def only_match(self, reference: str, report: dict | None = None) -> dict:
        item = self.found(reference, report)
        self.assertIsNotNone(item, f"{reference} is not on the list")
        assert item is not None
        self.assertEqual(1, len(item["matched"]), item)
        return dict(item["matched"][0])


class StepTests(ReleasedTestCase):
    def test_a_commit_in_the_range_is_found_by_its_hash(self) -> None:
        commit = self.commit(self.repo, "feat: in the range")
        reference = self.item("direct", commit[:7])
        match = self.only_match(reference)
        self.assertEqual(
            {"repository": PROJECT, "hash": commit, "step": "hash", "weak": False},
            {key: match[key] for key in ("repository", "hash", "step", "weak")},
        )
        self.assertEqual(commit, match["release_commit"])

    def test_a_commit_carried_under_another_hash_is_found_by_its_patch_id(self) -> None:
        # The case an exact hash misses: the item holds the branch's hash, and the
        # release holds the same change under the hash the integration gave it.
        branch_commit, integrated = self.carried("feat: carried over")
        reference = self.item("carried", branch_commit[:7])
        match = self.only_match(reference)
        self.assertEqual("patch-id", match["step"])
        self.assertEqual(integrated, match["release_commit"])
        self.assertFalse(match["weak"])

    def test_a_patch_in_a_legacy_encoding_keeps_its_patch_id(self) -> None:
        # Bytes that are not UTF-8 must reach `git patch-id` as git wrote them.
        branch_commit, integrated = self.carried(
            "feat: legacy text", "кодировка\n".encode("cp1251")
        )
        match = self.only_match(self.item("legacy", branch_commit))
        self.assertEqual(("patch-id", integrated), (match["step"], match["release_commit"]))

    def test_two_different_legacy_texts_are_not_the_same_change(self) -> None:
        # Decoded lossily, both would read as the same replacement character and
        # the same patch-id, a strong match for work nobody released.
        self.commit(self.repo, "feat: legacy text", "первый\n".encode("cp1251"))
        self.git(self.repo, "switch", "-c", "elsewhere", "start")
        unreleased = self.commit(self.repo, "feat: legacy text", "другой\n".encode("cp1251"))
        self.git(self.repo, "switch", "main")
        self.assertEqual("changed-patch", self.only_match(self.item("t", unreleased))["step"])

    def test_a_carried_commit_with_a_changed_patch_is_found_and_called_weak(self) -> None:
        # An integration that resolved a conflict: the subject stays, the patch does not.
        self.git(self.repo, "switch", "-c", "topic", "start")
        branch_commit = self.commit(self.repo, "feat: carried with a conflict", b"as written\n")
        self.git(self.repo, "switch", "main")
        integrated = self.commit(self.repo, "feat: carried with a conflict", b"as resolved\n")
        match = self.only_match(self.item("rewritten", branch_commit[:7]))
        self.assertEqual("changed-patch", match["step"])
        self.assertEqual(integrated, match["release_commit"])
        self.assertTrue(match["weak"])
        text = self.text()
        self.assertIn(f"changed-patch: WEAK MATCH: {integrated[:7]}", text)

    def test_a_commit_already_reachable_from_the_ranges_start_is_not_found(self) -> None:
        # The same subject as a commit of the range, but it shipped in an earlier release.
        earlier = self.commit(self.repo, "build(web): rebuild the bundled UI", b"old bundle\n")
        self.git(self.repo, "tag", "second")
        self.commit(self.repo, "build(web): rebuild the bundled UI", b"new bundle\n")
        reference = self.item("rebuilt earlier", earlier)
        self.assertIsNone(self.found(reference, self.report(revisions="second..main")))

    def test_a_common_subject_elsewhere_shows_as_weak_for_a_person_to_judge(self) -> None:
        # A false match this step accepts: unrelated work, the same words.
        self.commit(self.repo, "build(web): rebuild the bundled UI", b"released bundle\n")
        self.git(self.repo, "switch", "-c", "elsewhere", "start")
        unreleased = self.commit(self.repo, "build(web): rebuild the bundled UI", b"other\n")
        self.git(self.repo, "switch", "main")
        match = self.only_match(self.item("rebuilt elsewhere", unreleased))
        self.assertEqual("changed-patch", match["step"])
        self.assertTrue(match["weak"])

    def test_a_deleted_branch_is_found_by_the_subject_recorded_and_called_weak(self) -> None:
        # Attached while it was there, so the subject was recorded then; the label is
        # free text and says nothing the step reads.
        branch_commit, integrated = self.carried("fix: gone with its branch")
        reference = self.item("gone", branch_commit[:7])
        self.conn.execute("UPDATE work_item_commits SET label = 'unrelated words'")
        self.conn.commit()
        self.remove_the_branch(branch_commit)
        match = self.only_match(reference)
        self.assertEqual("subject", match["step"])
        self.assertEqual(integrated, match["release_commit"])
        self.assertTrue(match["weak"])
        self.assertIn("WEAK MATCH: the object is gone", self.text())

    def test_a_gone_commit_whose_subject_the_range_lacks_is_no_match(self) -> None:
        self.commit(self.repo, "fix: what the release holds")
        self.git(self.repo, "switch", "-c", "topic", "start")
        unmerged = self.commit(self.repo, "fix: what nobody merged")
        self.git(self.repo, "switch", "main")
        reference = self.item("unmerged", unmerged)
        self.remove_the_branch(unmerged)
        self.assertIsNone(self.found(reference))

    def test_a_commit_outside_the_range_is_not_shown(self) -> None:
        self.commit(self.repo, "feat: in the range")
        before = self.git(self.repo, "rev-parse", "start")
        self.git(self.repo, "switch", "-c", "elsewhere", "start")
        unreleased = self.commit(self.repo, "feat: on a branch nobody merged")
        self.git(self.repo, "switch", "main")
        earlier = self.item("released earlier", before)
        branch = self.item("not released", unreleased)
        answer = self.report()
        self.assertIsNone(self.found(earlier, answer))
        self.assertIsNone(self.found(branch, answer))

    def test_a_commit_after_the_range_is_not_shown(self) -> None:
        self.commit(self.repo, "feat: in the range")
        self.git(self.repo, "tag", "end")
        later = self.commit(self.repo, "feat: after the tag")
        reference = self.item("later", later)
        self.assertIsNone(self.found(reference, self.report(revisions="start..end")))


class RepositoryTests(ReleasedTestCase):
    """Which attached commits are the checkout's to compare."""

    def test_a_commit_with_no_repository_is_compared_by_its_hash_and_its_subject(self) -> None:
        commit = self.commit(self.repo, "feat: in the range")
        branch_commit, integrated = self.carried("fix: gone with its branch")
        self.remove_the_branch(branch_commit)
        by_hash = self.item("no repository", (None, commit[:7], ""))
        by_subject = self.item(
            "no repository, gone", (None, branch_commit[:7], "fix: gone with its branch")
        )
        answer = self.report()
        match = self.only_match(by_hash, answer)
        self.assertEqual(
            (None, commit[:7], "hash"), (match["repository"], match["hash"], match["step"])
        )
        match = self.only_match(by_subject, answer)
        self.assertEqual(("subject", integrated), (match["step"], match["release_commit"]))
        self.assertIn(f"  {commit[:7]}  hash: in the range", self.text())

    def test_a_commit_of_another_project_is_never_compared(self) -> None:
        # A clone shares every hash, so only the project the commit is attached as
        # keeps it out: the same hash and subject of the checkout's project match.
        clone = os.path.join(self.home.name, "clone")
        commit = self.commit(self.repo, "feat: in the range")
        self.git(self.home.name, "clone", "--quiet", self.repo, clone)
        self.projects["beta"] = clone
        elsewhere = self.item("elsewhere", ("beta", commit, "feat: in the range"))
        here = self.item("here", ("alpha", commit, "feat: in the range"))
        answer = self.report()
        self.assertIsNone(self.found(elsewhere, answer))
        self.assertEqual("hash", self.only_match(here, answer)["step"])

    def test_a_linked_worktree_is_the_repository_of_its_checkout(self) -> None:
        commit = self.commit(self.repo, "feat: in the range")
        linked = os.path.join(self.home.name, "linked")
        self.git(self.repo, "worktree", "add", "--detach", linked, "main")
        reference = self.item("linked", commit)
        answer = self.report(repo=linked)
        self.assertEqual(PROJECT, answer["project"])
        self.assertEqual("hash", self.only_match(reference, answer)["step"])

    def test_a_checkout_no_project_is_registered_at_compares_no_project_commit(self) -> None:
        commit = self.commit(self.repo, "feat: in the range")
        attached = self.item("attached as alpha", commit)
        unplaced = self.item("no repository", (None, commit, ""))
        del self.projects[PROJECT]
        answer = self.report()
        self.assertIsNone(answer["project"])
        self.assertIsNone(self.found(attached, answer))
        self.assertEqual("hash", self.only_match(unplaced, answer)["step"])
        self.assertIn("is no registered project's root", self.text())


class ListTests(ReleasedTestCase):
    def test_a_closed_item_is_not_shown(self) -> None:
        commit = self.commit(self.repo, "feat: in the range")
        reference = self.item("finished", commit)
        self.close_item(reference)
        self.assertEqual([], self.report()["items"])

    def test_partly_released_work_is_shown_and_says_so_after_whole_work(self) -> None:
        released_commit = self.commit(self.repo, "feat: first half")
        self.git(self.repo, "switch", "-c", "rest", "start")
        unreleased = self.commit(self.repo, "feat: second half")
        self.git(self.repo, "switch", "main")
        partly = self.item("partly", released_commit, unreleased[:7])
        whole = self.item("whole", released_commit)
        answer = self.report()
        self.assertEqual([whole, partly], [item["reference"] for item in answer["items"]])
        self.assertEqual(
            [{"repository": PROJECT, "hash": unreleased}], answer["items"][1]["not_matched"]
        )
        text = self.text()
        self.assertIn("partly released? 1 of 2 attached commits", text)
        self.assertIn("  check: 1 of 1 attached commits", text)
        self.assertIn(f"  no match: {PROJECT}@{unreleased[:9]}", text)

    def test_the_answer_says_to_check_and_never_that_work_is_done(self) -> None:
        commit = self.commit(self.repo, "feat: in the range")
        self.item("anything", commit)
        text = self.text()
        self.assertIn("Check these open work items", text)
        self.assertNotIn("done", text.lower())
        self.assertNotIn("finished items", text.lower())

    def test_an_empty_answer_names_the_gap_it_cannot_see(self) -> None:
        self.commit(self.repo, "feat: in the range")
        self.item("no commits at all")
        self.assertIn("no attached commit", self.text())


class ReadOnlyTests(ReleasedTestCase):
    def fingerprint(self) -> tuple:
        store_bytes = []
        for suffix in ("", "-wal"):
            with open(self.database + suffix, "rb") as handle:
                store_bytes.append(hashlib.sha256(handle.read()).hexdigest())
        rows = self.conn.execute(
            "SELECT number, revision, state_id, updated_at FROM work_items ORDER BY number"
        ).fetchall()
        events = self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0]
        return (store_bytes, [tuple(row) for row in rows], events)

    def test_no_write_reaches_the_store_or_the_repository(self) -> None:
        commit = self.commit(self.repo, "feat: in the range")
        branch_commit, _integrated = self.carried("feat: carried over")
        reference = self.item("hinted", commit, branch_commit)
        self.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        before = self.fingerprint()
        head_before = self.git(self.repo, "rev-parse", "main", "topic")
        tags_before = self.git(self.repo, "tag")
        self.assertIsNotNone(self.found(reference))
        self.text()
        self.assertEqual(before, self.fingerprint())
        self.assertEqual(head_before, self.git(self.repo, "rev-parse", "main", "topic"))
        self.assertEqual(tags_before, self.git(self.repo, "tag"))

    def test_the_connection_it_reads_through_refuses_a_write(self) -> None:
        conn = released.open_store()
        self.addCleanup(conn.close)
        with self.assertRaises(sqlite3.OperationalError):
            conn.execute("UPDATE work_items SET title = 'x'")

    def test_a_store_newer_than_this_build_is_refused(self) -> None:
        self.conn.execute(f"PRAGMA user_version = {store.STORE_SCHEMA_VERSION + 1}")
        self.conn.commit()
        with self.assertRaisesRegex(SystemExit, "newer Valkama"):
            self.report()
        self.conn.execute(f"PRAGMA user_version = {store.STORE_SCHEMA_VERSION}")
        self.conn.commit()


class RefusalTests(ReleasedTestCase):
    def test_what_cannot_be_read_as_asked_exits_non_zero_with_the_reason(self) -> None:
        cases = {
            "a lone tag": ("--range", "start", "not a range"),
            "an option": ("--range", "--output=x..y", "cannot begin with '-'"),
            "an unknown rev": ("--range", "nothing..main", "failed"),
            "an unknown space": ("--space", "NOPE", "no planning space"),
            "no repository": ("--repo", os.path.join(self.home.name, "missing"), "failed"),
        }
        for name, (option, value, reason) in cases.items():
            with self.subTest(name), self.assertRaisesRegex(SystemExit, reason):
                arguments = {"--space": SPACE, "--repo": self.repo, "--range": "start..main"}
                arguments[option] = value
                # `=` because argparse would otherwise read `--output=x..y` as an option.
                cli.main(["released", *(f"{key}={val}" for key, val in arguments.items())])


if __name__ == "__main__":
    unittest.main()
