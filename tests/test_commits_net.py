"""The net at a close: a move into review or completed names the commits no hook reported.

Each close is a real `apply_work_item_changes` as the stdio loop runs it, committed
before the net looks, or a real transition of the interface over HTTP. The commits
are made in a real repository R (`commit_fixtures`) at committer times counted in
minutes from when the test began, so a window holds exactly the commits a test dates
inside it; the commit R starts with is dated a day before. The server's own Git
reads its committer address from the environment, as `git var GIT_COMMITTER_IDENT`
does: the address of every commit made here unless a test names another.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from unittest import mock

from server import mcp_surface

from .commit_fixtures import CLAUDE, PROJECT
from .test_commits_api import ApiCase
from .test_commits_pickup import UNBOUND, RuleCase

#: The address Git commits with.
ADDRESS = "tester@example.invalid"
#: The identity every call here proves: one session, its own holder.
META = {"sessionId": CLAUDE, "threadId": CLAUDE}
#: A session that is not the closing one.
OTHER = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
FIELDS = ("unreported_commits", "unreported_total", "unreported_unread")


class NetCase(RuleCase):
    def setUp(self) -> None:
        super().setUp()
        patch = mock.patch.dict(
            os.environ,
            {
                "GIT_COMMITTER_NAME": "Tester",
                "GIT_COMMITTER_EMAIL": ADDRESS,
                "GIT_CONFIG_GLOBAL": str(self.place.global_file),
                "GIT_CONFIG_NOSYSTEM": "1",
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.zero = int(time.time())
        self.git(-24 * 60, "commit", "--amend", "-q", "--no-edit")

    def at(self, minutes: int) -> str:
        """A time `minutes` after the test began, as Git and the store write one."""

        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.zero + minutes * 60))

    def made(self, name: str, minutes: int, **variables: str) -> str:
        """A commit in R `minutes` after the test began, from a shell with these
        variables; its hash. Without a client's session variable no record is left."""

        when = self.at(minutes)
        environ = self.place.sessions(GIT_COMMITTER_DATE=when, GIT_AUTHOR_DATE=when, **variables)
        self.place.commit(self.place.repository, name, environ=environ)
        return self.place.head()

    def git(self, minutes: int, *arguments: str, **variables: str) -> None:
        when = self.at(minutes)
        environ = self.place.sessions(GIT_COMMITTER_DATE=when, GIT_AUTHOR_DATE=when, **variables)
        self.place.git(self.place.repository, *arguments, environ=environ)

    def dated(self, reference: str, action: str, minutes: int) -> None:
        """Move the item's newest `action` event to `minutes` after the test began."""

        self.conn.execute(
            "UPDATE work_item_events SET created_at = ? WHERE id = (SELECT MAX(id)"
            " FROM work_item_events WHERE work_item_id = ? AND action = ?)",
            (self.at(minutes)[:-1] + ".000Z", self.identity(reference), action),
        )
        self.conn.commit()

    def close(
        self, reference: str, state: str = "review", *, acceptance: str = "", **extra: object
    ) -> dict:
        """A move as the stdio loop runs it: answered, committed, then the net."""

        move: dict[str, object] = {"state": state}
        if acceptance:
            move["acceptance"] = acceptance
        answer = mcp_surface.run_tool_call(
            self.conn,
            "apply_work_item_changes",
            {"id": reference, "transition": move, **extra},
            meta=META,
        )
        assert isinstance(answer, dict)
        self.assertEqual(state, answer["applied"]["transition"]["state"], "the move went through")
        return answer

    def named(self, answer: dict) -> list[str]:
        return [str(commit["hash"]) for commit in answer.get("unreported_commits", [])]

    def says_nothing(self, answer: dict) -> None:
        for name in FIELDS:
            self.assertNotIn(name, answer)
        lines = answer.get("warnings", [])
        self.assertFalse([line for line in lines if line.startswith("These commits")])

    def line(self, commit: str) -> str:
        """The warning that names one commit to the agent."""

        return (
            "These commits in the card's repositories were made since the card was taken and no"
            f" hook reported them: {PROJECT} {commit[:9]}. Attach the ones that belong here with"
            " the commits group."
        )

    def committed_at(self, commit: str) -> str:
        found = self.place.git(self.place.repository, "log", "-1", "--format=%cI", commit)
        return found.stdout.decode("ascii").strip()


class NamedTests(NetCase):
    def test_a_close_names_commits_no_hook_reported(self) -> None:
        t1 = self.task("Net", PROJECT)
        self.made("before", -30)
        self.claim(t1)
        c = self.made("c", 30)
        answer = self.close(t1)
        self.assertEqual(
            [
                {
                    "repository": PROJECT,
                    "hash": c,
                    "subject": "feat: c",
                    "committed_at": self.committed_at(c),
                }
            ],
            answer["unreported_commits"],
            "only the commit made since the claim, and nothing before it",
        )
        self.assertNotIn("unreported_total", answer)
        self.assertNotIn("unreported_unread", answer)
        self.assertIn(self.line(c), answer["warnings"])
        self.assertEqual([], self.attached(), "the net attaches nothing")
        self.assertEqual("review", answer["state"]["key"])

    def test_the_net_skips_the_stash(self) -> None:
        t1 = self.task("Stash", PROJECT)
        self.claim(t1)
        c = self.made("c", 30)
        (self.place.repository / "README.md").write_text("changed", encoding="utf-8")
        self.git(40, "stash")
        stashed = self.place.git(self.place.repository, "rev-list", "-2", "refs/stash")
        self.assertEqual(2, len(stashed.stdout.split()), "the stash made its two commits")
        self.assertEqual([c], self.named(self.close(t1)))

    def test_the_net_skips_another_committer_s_commit(self) -> None:
        t1 = self.task("Others", PROJECT)
        self.claim(t1)
        c = self.made("c", 30)
        self.git(35, "checkout", "-q", "-b", "side")
        self.made("d", 40, GIT_COMMITTER_EMAIL="someone@example.invalid")
        self.git(41, "checkout", "-q", "main")
        self.assertEqual([c], self.named(self.close(t1)), "d is on a local branch, by another")

    def test_the_net_skips_a_commit_only_in_remote_refs(self) -> None:
        t1 = self.task("Remote", PROJECT)
        self.claim(t1)
        c = self.made("c", 30)
        self.git(35, "checkout", "-q", "-b", "fetched")
        e = self.made("e", 40)
        self.git(41, "update-ref", "refs/remotes/origin/main", e)
        self.git(42, "checkout", "-q", "main")
        self.git(43, "branch", "-q", "-D", "fetched")
        self.assertEqual([c], self.named(self.close(t1)))

    def test_the_answer_names_twenty_and_counts_the_rest(self) -> None:
        t1 = self.task("Many", PROJECT)
        self.claim(t1)
        made = [self.made(f"m{index}", 10 + index) for index in range(22)]
        answer = self.close(t1)
        self.assertEqual(list(reversed(made))[:20], self.named(answer), "the newest twenty")
        self.assertEqual(22, answer["unreported_total"])
        line = next(text for text in answer["warnings"] if text.startswith("These commits"))
        self.assertIn(" and 2 more. ", line)

    def test_a_root_that_cannot_be_read_is_named_and_the_close_stands(self) -> None:
        broken = Path(self.place.base / UNBOUND)
        # A linked worktree whose repository went away: Git refuses it, and asks no other.
        (broken / ".git").write_text("gitdir: gone\n", encoding="utf-8")
        t1 = self.task("Unread", PROJECT, UNBOUND)
        self.claim(t1)
        c = self.made("c", 30)
        answer = self.close(t1)
        self.assertEqual([UNBOUND], answer["unreported_unread"])
        self.assertEqual([c], self.named(answer))
        self.assertEqual("review", answer["state"]["key"])


class WaitingRecordTests(NetCase):
    def test_a_commit_a_hook_reported_is_taken_first_and_not_named(self) -> None:
        t1 = self.task("Waiting", PROJECT)
        self.claim(t1)
        reported = self.made("reported", 30, CLAUDE_CODE_SESSION_ID=CLAUDE)
        self.assertTrue(self.place.everywhere(), "the Git hook left a record no hook took")
        c = self.made("c", 40)
        answer = self.close(t1)
        self.assertEqual([c], self.named(answer))
        self.assertEqual([(t1, reported, "server", "valkama")], self.attached())
        self.assertEqual([], self.place.everywhere(), "the record taken is deleted")

    def test_another_session_s_record_in_the_card_s_project_is_taken_too(self) -> None:
        t1 = self.task("Theirs", PROJECT)
        self.claim(t1)
        theirs = self.made("theirs", 30, CLAUDE_CODE_SESSION_ID=OTHER)
        self.says_nothing(self.close(t1))
        row = self.conn.execute("SELECT session_id FROM commits WHERE hash = ?", (theirs,))
        self.assertEqual(OTHER, row.fetchone()[0], "decided by the session that made it")
        self.assertEqual([], self.place.everywhere())

    def test_a_rewrite_the_hook_reported_is_not_new_work(self) -> None:
        t1 = self.task("Amended", PROJECT)
        self.claim(t1)
        first = self.made("first", 30, CLAUDE_CODE_SESSION_ID=CLAUDE)
        self.claude()
        self.assertEqual([(t1, first, "server", "valkama")], self.attached())
        self.git(35, "commit", "--amend", "-qm", "feat: amended", CLAUDE_CODE_SESSION_ID=CLAUDE)
        amended = self.place.head()
        self.says_nothing(self.close(t1))
        self.assertEqual([(t1, amended, "server", "valkama")], self.attached())


class WindowTests(NetCase):
    def test_a_close_from_review_starts_at_the_session_s_last_claim(self) -> None:
        t1 = self.task("Reviewed", PROJECT)
        self.claim(t1)
        self.dated(t1, "claimed", 60)
        self.made("before", 50)
        self.tool("apply_work_item_changes", id=t1, transition={"state": "review"})
        c = self.made("c", 70)
        answer = self.close(t1, "done", summary={"done": "the change", "next": "nothing"})
        self.assertEqual([c], self.named(answer), "the window opens at the session's claim")

    def test_a_step_holder_starts_at_its_step_claim(self) -> None:
        t2 = self.task("Stepped", PROJECT)
        listed = self.tool("apply_work_item_changes", id=t2, checklist=["the step"])
        step = listed["applied"]["checklist"][0]["item_id"]
        self.tool("claim_work_item_checklist_item", id=t2, item_id=step)
        self.dated(t2, "checklist_claimed", 60)
        self.made("before", 50)
        d = self.made("d", 70)
        row = self.conn.execute(
            "SELECT claim_ref FROM work_items WHERE work_item_id = ?", (self.identity(t2),)
        )
        self.assertEqual("", row.fetchone()[0], "the item itself is not claimed")
        self.assertEqual([d], self.named(self.close(t2)))

    def test_an_item_the_session_never_held_has_no_window(self) -> None:
        t3 = self.task("Never", PROJECT)
        self.made("c", 30)
        self.says_nothing(self.close(t3, acceptance="assignment"))


class WhoseCloseTests(NetCase, ApiCase):
    def test_only_an_agents_close_runs_the_net(self) -> None:
        """S holds T1 and T2 of `alpha`, and commits c with no record in their window: the
        agent's close of T1 names c, a person's close of T2 in the interface does not."""

        t1, t2 = self.task("Agent", PROJECT), self.task("Person", PROJECT)
        self.claim(t1)
        self.claim(t2)
        c = self.made("c", 30)
        status, body = self.http(
            "/api/planning/work-item/transition", {"id": t2, "state": "review"}
        )
        self.assertEqual(200, status, body)
        self.assertEqual("review", body["state"]["key"])
        self.says_nothing(body)
        answer = self.close(t1)
        self.assertEqual([c], self.named(answer))
        self.assertIn(self.line(c), answer["warnings"])
        self.assertEqual([], self.attached())
