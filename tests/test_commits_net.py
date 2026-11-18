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
from server.planning import calls, commits, participation, requests, service

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
#: The summary every close here records.
SUMMARY = {"done": "the change", "next": "nothing"}


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
        self,
        reference: str,
        state: str = "review",
        *,
        acceptance: str = "",
        force: bool = False,
        **extra: object,
    ) -> dict:
        """A move as the stdio loop runs it: answered, committed, then the net. It carries
        the summary a close asks, and `to_check` when it enters review."""

        move: dict[str, object] = {"state": state}
        if acceptance:
            move["acceptance"] = acceptance
        if force:
            move["force"] = True
        if state == "review":
            move["to_check"] = "the change"
        extra.setdefault("summary", SUMMARY)
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
        self.tool(
            "apply_work_item_changes",
            id=t1,
            summary=SUMMARY,
            transition={"state": "review", "to_check": "the change"},
        )
        # An agent completes from review only with no question to the owner open there,
        # as on an item a store before 3.0 left in review: the one entering asked goes.
        self.conn.execute(
            "DELETE FROM work_item_requests WHERE work_item_id = ?", (self.identity(t1),)
        )
        self.conn.commit()
        c = self.made("c", 70)
        answer = self.close(t1, "done")
        self.assertEqual([c], self.named(answer), "the window opens at the session's claim")

    def add_step(self, reference: str, text: str = "the step") -> str:
        """Add one step to the card; its item_id."""

        listed = self.tool("apply_work_item_changes", id=reference, checklist=[text])
        return str(listed["applied"]["checklist"][0]["item_id"])

    def test_a_step_ticked_in_the_closing_call_starts_at_its_claim(self) -> None:
        t2 = self.task("Ticked in the close", PROJECT)
        step = self.add_step(t2)
        self.tool("claim_work_item_checklist_item", id=t2, item_id=step)
        self.dated(t2, "checklist_claimed", 60)
        self.made("before", 50)
        d = self.made("d", 70)
        row = self.conn.execute(
            "SELECT claim_ref FROM work_items WHERE work_item_id = ?", (self.identity(t2),)
        )
        self.assertEqual("", row.fetchone()[0], "the item itself is not claimed")
        answer = self.close(t2, checklist_ticks=[{"item_id": step}])
        self.assertEqual([d], self.named(answer), "the step's claim opens the window")

    def test_a_step_ticked_before_the_close_starts_at_its_claim(self) -> None:
        t2 = self.task("Ticked before the close", PROJECT)
        step = self.add_step(t2)
        self.tool("claim_work_item_checklist_item", id=t2, item_id=step)
        self.dated(t2, "checklist_claimed", 60)
        self.made("before", 50)
        d = self.made("d", 70)
        self.tool("apply_work_item_changes", id=t2, checklist_ticks=[{"item_id": step}])
        self.assertEqual([d], self.named(self.close(t2)), "the step's claim opens the window")

    def test_the_window_starts_at_the_session_s_earliest_take(self) -> None:
        t4 = self.task("Earliest take", PROJECT)
        self.claim(t4)
        self.dated(t4, "claimed", 10)
        self.made("before", 5)
        e = self.made("e", 20)
        # The card's claim ends while the work goes on: a release, which the server allows
        # without force, and which requeues the card because no step is held.
        self.tool("claim_work_item", id=t4, release=True)
        step = self.add_step(t4)
        self.tool("claim_work_item_checklist_item", id=t4, item_id=step)
        self.dated(t4, "checklist_claimed", 40)
        answer = self.close(t4, checklist_ticks=[{"item_id": step}])
        self.assertEqual([e], self.named(answer), "the card's earlier claim is the earliest take")

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
        service.set_summary(self.conn, t2, SUMMARY, author="tester")
        self.conn.commit()
        status, body = self.http(
            "/api/planning/work-item/transition",
            {"id": t2, "state": "review", "to_check": "the change"},
        )
        self.assertEqual(200, status, body)
        self.assertEqual("review", body["state"]["key"])
        self.says_nothing(body)
        answer = self.close(t1)
        self.assertEqual([c], self.named(answer))
        self.assertIn(self.line(c), answer["warnings"])
        self.assertEqual([], self.attached())


class GoalWindowCase(NetCase):
    """A goal of the owner's over work of `alpha`, which the session does through the tools.

    A goal or stage has no holder, so its window opens at the session's earliest take of
    a task under it, at any depth, or of such a task's step.
    """

    def filed(self, title: str, *, kind: str = "task", parent: str | None = None) -> str:
        """An item the owner files in the interface; a task holds `alpha`."""

        with calls.bind(calls.browser(), "/api/planning/work-item/create"):
            made = service.create_work_item(
                self.conn,
                space="MAIN",
                title=title,
                kind=kind,
                parent=parent,
                projects=[PROJECT] if kind == "task" else None,
            )
        self.conn.commit()
        return str(made["reference"])

    def done(self, task: str, minutes: int) -> list[str]:
        """The session claims the task, commits c1 `minutes` in and completes the task, then
        commits c2 ten minutes later; the hashes, newest first, as the net names them."""

        self.claim(task)
        c1 = self.made("c1", minutes)
        self.assertEqual([c1], self.named(self.close(task, "done")), "the task's own net")
        c2 = self.made("c2", minutes + 10)
        return [c2, c1]

    def confirm(self, card: str) -> dict:
        """The session's confirmation of a goal or stage as the stdio loop runs it, after a
        word on the card that answers the owner's filing of it."""

        self.tool("apply_work_item_changes", id=card, comment={"body": "Its work is done."})
        answer = mcp_surface.run_tool_call(
            self.conn,
            "apply_work_item_changes",
            {"id": card, "summary": SUMMARY, "transition": {"state": "completed"}},
            meta=META,
        )
        assert isinstance(answer, dict)
        return answer

    def category(self, card: str) -> str:
        return str(service.get_work_item(self.conn, card)["state"]["category"])


class GoalWindowTests(GoalWindowCase):
    def test_an_agent_s_confirmation_names_what_its_tasks_and_after_them_made(self) -> None:
        goal = self.filed("Goal", kind="goal")
        task = self.filed("Its task", parent=goal)
        self.made("before", -30)
        both = self.done(task, 30)
        answer = self.confirm(goal)
        self.assertNotIn("waits_for_owner", answer, "the default lets the agent confirm")
        self.assertEqual("completed", self.category(goal))
        self.assertEqual(both, self.named(answer), "from the task's claim, and after its close")

    def test_an_agent_s_close_of_a_stage_has_the_same_window(self) -> None:
        goal = self.filed("Goal", kind="goal")
        stage = self.filed("Stage", kind="stage", parent=goal)
        task = self.filed("Its task", parent=stage)
        self.made("before", -30)
        both = self.done(task, 30)
        answer = self.confirm(stage)
        self.assertEqual("completed", self.category(stage))
        self.assertEqual(both, self.named(answer))
        c3 = self.made("c3", 50)
        self.assertEqual([c3, *both], self.named(self.confirm(goal)), "a task two levels down")

    def test_a_step_of_a_task_under_the_goal_opens_its_window(self) -> None:
        goal = self.filed("Goal", kind="goal")
        task = self.filed("Its task", parent=goal)
        listed = self.tool("apply_work_item_changes", id=task, checklist=["the step"])
        step = str(listed["applied"]["checklist"][0]["item_id"])
        self.made("before", -30)
        self.tool("claim_work_item_checklist_item", id=task, item_id=step)
        c1 = self.made("c1", 30)
        self.close(task, "done", checklist_ticks=[{"item_id": step}])
        c2 = self.made("c2", 40)
        self.assertEqual([c2, c1], self.named(self.confirm(goal)), "from the step's claim")

    def test_a_session_that_took_no_task_under_the_goal_has_no_window(self) -> None:
        """Another session does the goal's task, and this one only a task outside it: the
        commits in the goal's repository are not this session's to answer for."""

        goal = self.filed("Goal", kind="goal")
        task = self.filed("Its task", parent=goal)
        outside = self.filed("Elsewhere")
        self.claim(outside)
        theirs = {"sessionId": OTHER, "threadId": OTHER}
        mcp_surface.run_tool_call(self.conn, "claim_work_item", {"id": task}, meta=theirs)
        self.made("c", 30)
        mcp_surface.run_tool_call(
            self.conn,
            "apply_work_item_changes",
            {"id": task, "summary": SUMMARY, "transition": {"state": "completed"}},
            meta=theirs,
        )
        self.assertEqual("completed", self.category(task))
        answer = self.confirm(goal)
        self.assertEqual("completed", self.category(goal))
        self.says_nothing(answer)


class HeldCloseTests(GoalWindowCase):
    def test_a_close_that_waits_names_the_commits_and_the_owners_answer_does_not(self) -> None:
        """At the maximal set, the session's confirmation of a goal whose task it did waits
        for the owner: its answer names what the confirmation would have, and the owner's
        answer that makes the close runs no net and names nothing again."""

        participation.write_set(
            self.conn, service.space_identity(self.conn, "MAIN"), participation.MAXIMAL
        )
        self.conn.commit()
        goal = self.filed("Goal", kind="goal")
        task = self.filed("Its task", parent=goal)
        self.made("before", -30)
        both = self.done(task, 30)
        answer = self.confirm(goal)
        waits = answer["waits_for_owner"]
        self.assertEqual("goal_close", waits["point"])
        self.assertEqual(both, self.named(answer), "the window is the close's own")
        question = waits["question"]
        revision = self.conn.execute(
            "SELECT revision FROM work_item_requests WHERE request_id = ?", (question,)
        ).fetchone()[0]
        with commits.closes() as found:
            with calls.bind(calls.browser(), "/api/planning/request/resolve"):
                record = requests.resolve(
                    self.conn,
                    question,
                    status="answered",
                    expected_revision=int(revision),
                    answers={"answer": "confirm"},
                    author="user",
                )
            self.conn.commit()
        self.assertEqual("carried_out", record["carried_out"])
        self.assertEqual("completed", self.category(goal))
        self.assertEqual([], found, "the owner's answer notes no window")
        self.says_nothing(commits.with_unreported(self.conn, found, dict(record)))
