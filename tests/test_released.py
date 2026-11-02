"""What `valkama released` says about a real repository and a throwaway store.

The commits here are made by git, and carried and pruned the way an integration
does it, because each step is a claim about what git keeps: a hash that a rebase
replaced, a patch-id that survives it, an object that a deleted branch takes with
it. A stub would only repeat what the code assumes.

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
from server.planning import service
from server.projects import project_registry
from tests.registry_fixtures import project_entry, registry_bytes

SPACE = "COM"


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
        service.create_planning_space(self.conn, project_id="cli", name="Command Line", key=SPACE)
        self.conn.commit()
        self.repo = self.repository("product")
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

    def item(self, title: str, *refs: tuple[str, str]) -> str:
        created = service.create_work_item(self.conn, space=SPACE, title=title)
        reference = str(created["reference"])
        for value, label in refs:
            service.attach_ref(self.conn, reference, "commit", value, label=label)
        self.conn.commit()
        return reference

    def close_item(self, reference: str) -> None:
        service.transition_work_item(self.conn, reference, "completed", force=True)
        self.conn.commit()

    def report(self, *extra: str, revisions: str = "start..main") -> dict:
        arguments = ["--space", SPACE, "--repo", self.repo, "--range", revisions, *extra]
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

    def only_match(self, reference: str) -> dict:
        item = self.found(reference)
        self.assertIsNotNone(item, f"{reference} is not on the list")
        assert item is not None
        self.assertEqual(1, len(item["matched"]), item)
        return dict(item["matched"][0])


class StepTests(ReleasedTestCase):
    def test_a_commit_in_the_range_is_found_by_its_hash(self) -> None:
        commit = self.commit(self.repo, "feat: in the range")
        reference = self.item("direct", (commit[:7], ""))
        match = self.only_match(reference)
        self.assertEqual("hash", match["step"])
        self.assertEqual(commit, match["release_commit"])
        self.assertFalse(match["weak"])

    def test_a_commit_carried_under_another_hash_is_found_by_its_patch_id(self) -> None:
        # The case an exact hash misses: the ref names the branch's hash, and the
        # release holds the same change under the hash the integration gave it.
        branch_commit, integrated = self.carried("feat: carried over")
        reference = self.item("carried", (branch_commit[:7], ""))
        match = self.only_match(reference)
        self.assertEqual("patch-id", match["step"])
        self.assertEqual(integrated, match["release_commit"])
        self.assertFalse(match["weak"])

    def test_a_patch_in_a_legacy_encoding_keeps_its_patch_id(self) -> None:
        # Bytes that are not UTF-8 must reach `git patch-id` as git wrote them.
        branch_commit, integrated = self.carried(
            "feat: legacy text", "кодировка\n".encode("cp1251")
        )
        match = self.only_match(self.item("legacy", (branch_commit, "")))
        self.assertEqual(("patch-id", integrated), (match["step"], match["release_commit"]))

    def test_two_different_legacy_texts_are_not_the_same_change(self) -> None:
        # Decoded lossily, both would read as the same replacement character and
        # the same patch-id, a strong match for work nobody released.
        self.commit(self.repo, "feat: legacy text", "первый\n".encode("cp1251"))
        self.git(self.repo, "switch", "-c", "elsewhere", "start")
        unreleased = self.commit(self.repo, "feat: legacy text", "другой\n".encode("cp1251"))
        self.git(self.repo, "switch", "main")
        self.assertEqual("changed-patch", self.only_match(self.item("t", (unreleased, "")))["step"])

    def test_a_carried_commit_with_a_changed_patch_is_found_and_called_weak(self) -> None:
        # An integration that resolved a conflict: the subject stays, the patch does not.
        self.git(self.repo, "switch", "-c", "topic", "start")
        branch_commit = self.commit(self.repo, "feat: carried with a conflict", b"as written\n")
        self.git(self.repo, "switch", "main")
        integrated = self.commit(self.repo, "feat: carried with a conflict", b"as resolved\n")
        match = self.only_match(self.item("rewritten", (branch_commit[:7], "")))
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
        reference = self.item("rebuilt earlier", (earlier, ""))
        self.assertIsNone(self.found(reference, self.report(revisions="second..main")))

    def test_a_common_subject_elsewhere_shows_as_weak_for_a_person_to_judge(self) -> None:
        # A false match this step accepts: unrelated work, the same words.
        self.commit(self.repo, "build(web): rebuild the bundled UI", b"released bundle\n")
        self.git(self.repo, "switch", "-c", "elsewhere", "start")
        unreleased = self.commit(self.repo, "build(web): rebuild the bundled UI", b"other\n")
        self.git(self.repo, "switch", "main")
        match = self.only_match(self.item("rebuilt elsewhere", (unreleased, "")))
        self.assertEqual("changed-patch", match["step"])
        self.assertTrue(match["weak"])

    def test_a_deleted_branch_is_found_by_the_subject_in_the_label_and_called_weak(self) -> None:
        branch_commit, integrated = self.carried("fix: gone with its branch")
        self.remove_the_branch(branch_commit)
        reference = self.item(
            "gone", (branch_commit[:7], "product work: fix: gone with its branch (the note)")
        )
        match = self.only_match(reference)
        self.assertEqual("subject", match["step"])
        self.assertEqual(integrated, match["release_commit"])
        self.assertTrue(match["weak"])
        self.assertIn("WEAK MATCH", self.text())

    def test_a_subject_inside_a_longer_sentence_is_no_match(self) -> None:
        branch_commit, _integrated = self.carried("fix")
        self.remove_the_branch(branch_commit)
        reference = self.item("sentence", (branch_commit[:7], "not the fix anyone asked for"))
        self.assertIsNone(self.found(reference))

    def test_a_commit_outside_the_range_is_not_shown(self) -> None:
        self.commit(self.repo, "feat: in the range")
        before = self.git(self.repo, "rev-parse", "start")
        self.git(self.repo, "switch", "-c", "elsewhere", "start")
        unreleased = self.commit(self.repo, "feat: on a branch nobody merged")
        self.git(self.repo, "switch", "main")
        earlier = self.item("released earlier", (before, ""))
        branch = self.item("not released", (unreleased, ""))
        answer = self.report()
        self.assertIsNone(self.found(earlier, answer))
        self.assertIsNone(self.found(branch, answer))

    def test_a_commit_after_the_range_is_not_shown(self) -> None:
        self.commit(self.repo, "feat: in the range")
        self.git(self.repo, "tag", "end")
        later = self.commit(self.repo, "feat: after the tag")
        reference = self.item("later", (later, ""))
        self.assertIsNone(self.found(reference, self.report(revisions="start..end")))


class ListTests(ReleasedTestCase):
    def test_a_closed_item_is_not_shown(self) -> None:
        commit = self.commit(self.repo, "feat: in the range")
        reference = self.item("finished", (commit, ""))
        self.close_item(reference)
        self.assertEqual([], self.report()["items"])

    def test_partly_released_work_is_shown_and_says_so_after_whole_work(self) -> None:
        released_commit = self.commit(self.repo, "feat: first half")
        self.git(self.repo, "switch", "-c", "rest", "start")
        unreleased = self.commit(self.repo, "feat: second half")
        self.git(self.repo, "switch", "main")
        partly = self.item("partly", (released_commit, ""), (unreleased[:7], ""))
        whole = self.item("whole", (released_commit, ""))
        answer = self.report()
        self.assertEqual([whole, partly], [item["reference"] for item in answer["items"]])
        self.assertEqual([unreleased[:7]], answer["items"][1]["not_matched"])
        text = self.text()
        self.assertIn("partly released? 1 of 2 commit refs", text)
        self.assertIn("  check: 1 of 1 commit refs", text)

    def test_the_answer_says_to_check_and_never_that_work_is_done(self) -> None:
        commit = self.commit(self.repo, "feat: in the range")
        self.item("anything", (commit, ""))
        text = self.text()
        self.assertIn("Check these open work items", text)
        self.assertNotIn("done", text.lower())
        self.assertNotIn("finished items", text.lower())

    def test_an_empty_answer_names_the_gap_it_cannot_see(self) -> None:
        self.commit(self.repo, "feat: in the range")
        self.item("no refs at all")
        self.assertIn("no commit ref", self.text())

    def test_a_ref_that_is_no_recorded_hash_is_never_handed_to_git(self) -> None:
        # `HEAD` would resolve into the range and put the item on the list.
        self.commit(self.repo, "feat: in the range")
        values = ("HEAD", "main", "a..b", "https://example.invalid/x", "--output=x", "x:abcd1234")
        reference = self.item("odd forms", *((value, "") for value in values))
        self.assertIsNone(self.found(reference))

    def test_a_ref_may_name_this_repository(self) -> None:
        commit = self.commit(self.repo, "feat: in the range")
        for value in (f"product@{commit[:7]}", f"product {commit[:7]}"):
            with self.subTest(value=value):
                self.assertEqual("hash", self.only_match(self.item("named", (value, "")))["step"])

    def test_a_linked_worktree_answers_to_its_checkouts_name(self) -> None:
        branch_commit, _integrated = self.carried("fix: gone with its branch")
        self.remove_the_branch(branch_commit)
        linked = os.path.join(self.home.name, "linked")
        self.git(self.repo, "worktree", "add", "--detach", linked, "main")
        reference = self.item(
            "named", (f"product@{branch_commit[:7]}", "fix: gone with its branch")
        )
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            cli.main(
                ["released", "--space", SPACE, "--repo", linked, "--range", "start..main", "--json"]
            )
        item = self.found(reference, json.loads(stream.getvalue()))
        self.assertIsNotNone(item)

    def test_a_label_does_not_match_for_a_ref_naming_another_repository(self) -> None:
        branch_commit, _integrated = self.carried("fix: same words elsewhere")
        self.remove_the_branch(branch_commit)
        reference = self.item(
            "elsewhere", (f"other-repo@{branch_commit[:7]}", "fix: same words elsewhere")
        )
        self.assertIsNone(self.found(reference))

    def test_a_label_does_not_match_for_a_commit_another_registered_repository_has(self) -> None:
        # The ref names no repository, and `resolve_ref` is what says where it lives.
        other = self.repository("other")
        foreign = self.commit(other, "fix: same words elsewhere")
        self.commit(self.repo, "fix: same words elsewhere")
        reference = self.item("foreign", (foreign[:7], "fix: same words elsewhere"))
        entries = [project_entry("other", other), project_entry("product", self.repo)]
        with mock.patch.object(
            project_registry, "_read_registry_bytes", return_value=registry_bytes(entries)
        ):
            self.assertIsNone(self.found(reference))
        # The registry is the only difference, so it is what kept the label out.
        self.assertEqual("subject", self.only_match(reference)["step"])

    def test_a_registered_project_id_names_this_repository(self) -> None:
        branch_commit, _integrated = self.carried("fix: gone with its branch")
        self.remove_the_branch(branch_commit)
        reference = self.item(
            "by id", (f"registered-id@{branch_commit[:7]}", "fix: gone with its branch")
        )
        entries = [project_entry("registered-id", self.repo)]
        with mock.patch.object(
            project_registry, "_read_registry_bytes", return_value=registry_bytes(entries)
        ):
            self.assertEqual("subject", self.only_match(reference)["step"])


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
        reference = self.item("hinted", (commit, ""), (branch_commit, ""))
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
