"""Commits attached to an item by hand, read on its card, and kept through a merge.

The `commits` group of `apply_work_item_changes` attaches a commit of a registered
project, by a whole hash or a start of one the project's real repository expands,
and detaches it with `remove`. The card reads what is attached as the `commits`
field and part. Each test holds the projects rule: every project a task holds by
its commits is the project of a commit attached to it.
"""

from __future__ import annotations

from unittest import mock

from server import git_worktrees, processes
from server.planning import api, service

from .commit_fixtures import CLAUDE, PROJECT
from .test_commits_pickup import DEFAULT, RuleCase

#: The commits an item carries as the contract lists their fields.
FIELDS = (
    "repository",
    "display_name",
    "hash",
    "subject",
    "committed_at",
    "session",
    "agent",
    "attached_by",
    "label",
)


class ManualCase(RuleCase):
    def made(self, name: str) -> str:
        """A commit in R made outside any session, which no hook reports."""

        self.place.commit(self.place.repository, name)
        return self.place.head()

    def batch(self, reference: str, *entries: dict) -> dict:
        answer = self.tool("apply_work_item_changes", id=reference, commits=list(entries))
        return dict(answer["applied"]["commits"])

    def refused(self, reference: str, *entries: dict) -> dict:
        """The refusal of a batch, which must leave every attachment as it was."""

        before = self.attached()
        with self.assertRaises(api.PlanningHttpError) as caught:
            self.tool("apply_work_item_changes", id=reference, commits=list(entries))
        self.conn.rollback()
        self.assertEqual(before, self.attached(), "a refused batch writes nothing")
        status, body = api.error_response(caught.exception)
        self.assertEqual(400, status)
        return dict(body["error"])

    def tasks_hold_their_commits_projects(self) -> None:
        """The projects rule: no task holds a project by its commits without one of them."""

        orphans = self.conn.execute(
            "SELECT p.work_item_id, p.project_id FROM work_item_projects p"
            " WHERE p.source = 'commits' AND NOT EXISTS (SELECT 1 FROM work_item_commits a"
            " JOIN commits c ON c.commit_id = a.commit_id WHERE a.work_item_id = p.work_item_id"
            " AND c.project_id = p.project_id AND c.rewritten_to IS NULL)"
        ).fetchall()
        self.assertEqual([], [tuple(row) for row in orphans])

    def events(self, reference: str) -> list[tuple[str, str]]:
        return [
            (str(row[0]), str(row[1]))
            for row in self.conn.execute(
                "SELECT action, detail FROM work_item_events WHERE work_item_id = ?"
                " AND action LIKE 'commit_%' ORDER BY id",
                (self.identity(reference),),
            )
        ]

    def card(self, reference: str, **arguments: object) -> dict:
        return self.tool("get_work_item", id=reference, **arguments)


class AttachTests(ManualCase):
    def test_a_start_of_a_hash_attaches_a_commit_no_session_made(self) -> None:
        t1 = self.task("By hand")
        commit = self.made("outside")
        applied = self.batch(t1, {"repository": PROJECT, "hash": commit[:9].upper()})
        self.assertEqual(
            {"attached": [{"repository": PROJECT, "hash": commit}], "removed": [], "unchanged": 0},
            applied,
        )
        self.assertEqual([(t1, commit, "manual", "agent")], self.attached())
        row = self.conn.execute(
            "SELECT project_id, subject, session_id, agent_id, client, committed_at FROM commits"
        ).fetchone()
        self.assertEqual((PROJECT, "feat: outside", None, None, None), tuple(row)[:5])
        self.assertRegex(str(row[5]), r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$")
        self.assertEqual([(PROJECT, "commits")], self.projects(t1))
        self.assertEqual([("commit_attached", f"{PROJECT} {commit}")], self.events(t1))
        self.assertEqual([], self.waiting(), "a commit no session made is never waiting")
        self.tasks_hold_their_commits_projects()

    def test_attaching_it_again_changes_nothing(self) -> None:
        t1 = self.task("Twice")
        commit = self.made("twice")
        self.batch(t1, {"repository": PROJECT, "hash": commit})
        applied = self.batch(t1, {"repository": PROJECT, "hash": commit[:7], "label": "again"})
        self.assertEqual({"attached": [], "removed": [], "unchanged": 1}, applied)
        self.assertEqual(1, len(self.events(t1)))

    def test_the_answer_lists_each_entry_by_what_it_did(self) -> None:
        t1 = self.task("Several")
        first, second = self.made("first"), self.made("second")
        self.batch(t1, {"repository": PROJECT, "hash": first})
        applied = self.batch(
            t1,
            {"repository": PROJECT, "hash": second},
            {"repository": PROJECT, "hash": first, "remove": True},
            {"repository": PROJECT, "hash": second},
        )
        pair = {"repository": PROJECT, "hash": second}
        self.assertEqual(
            {
                "attached": [pair],
                "removed": [{"repository": PROJECT, "hash": first}],
                "unchanged": 1,
            },
            applied,
        )

    def test_a_named_project_stays_named(self) -> None:
        t1 = self.task("Named", PROJECT)
        self.batch(t1, {"repository": PROJECT, "hash": self.made("named")})
        self.assertEqual([(PROJECT, "named")], self.projects(t1))

    def test_a_whole_hash_of_a_project_without_a_root_here_is_kept_as_it_is(self) -> None:
        t1 = self.task("Elsewhere")
        whole = "ab" * 20
        applied = self.batch(t1, {"repository": DEFAULT, "hash": whole.upper()})
        self.assertEqual([{"repository": DEFAULT, "hash": whole}], applied["attached"])
        row = self.conn.execute("SELECT subject, committed_at, session_id FROM commits").fetchone()
        self.assertEqual(("", None, None), tuple(row))
        self.assertEqual([(DEFAULT, "commits")], self.projects(t1))


class DetachTests(ManualCase):
    def test_detaching_takes_off_the_commit_and_the_project_it_gave(self) -> None:
        t1 = self.task("Held")
        self.claim(t1)
        commit, _line = self.commit()
        self.assertEqual([(t1, commit, "server", "valkama")], self.attached())
        applied = self.batch(t1, {"repository": PROJECT, "hash": commit[:9], "remove": True})
        self.assertEqual(
            {"attached": [], "removed": [{"repository": PROJECT, "hash": commit}], "unchanged": 0},
            applied,
        )
        self.assertEqual([], self.attached())
        self.assertEqual([], self.projects(t1))
        self.assertEqual(
            [
                ("commit_attached", f"{PROJECT} {commit}"),
                ("commit_detached", f"{PROJECT} {commit}"),
            ],
            self.events(t1),
        )
        # The commit stays, and being a session's attached nowhere, it is on no card.
        self.assertEqual([(PROJECT, commit, CLAUDE)], [row[:3] for row in self.waiting()])

    def test_a_project_another_commit_or_a_name_holds_stays(self) -> None:
        t1, t2 = self.task("Two commits"), self.task("Named", PROJECT)
        first, second = self.made("first"), self.made("second")
        self.batch(
            t1, {"repository": PROJECT, "hash": first}, {"repository": PROJECT, "hash": second}
        )
        self.batch(t2, {"repository": PROJECT, "hash": first})
        self.batch(t1, {"repository": PROJECT, "hash": first, "remove": True})
        self.batch(t2, {"repository": PROJECT, "hash": first, "remove": True})
        self.assertEqual([(PROJECT, "commits")], self.projects(t1))
        self.assertEqual([(PROJECT, "named")], self.projects(t2))
        self.tasks_hold_their_commits_projects()
        self.batch(t1, {"repository": PROJECT, "hash": second, "remove": True})
        self.assertEqual([], self.projects(t1))


class RefusalTests(ManualCase):
    def test_each_refusal_names_what_to_send(self) -> None:
        t1 = self.task("Refusals")
        commit = self.made("there")
        other = self.made("not attached")
        self.place.git(self.place.repository, "branch", "abcdef12345", commit)
        cases = (
            (
                {"repository": "nobody", "hash": commit},
                f"[commit] nobody is not a registered project: {PROJECT}, {DEFAULT}, gamma",
            ),
            (
                {"repository": PROJECT, "hash": "0" * 40},
                f"[commit] {'0' * 40} is not a commit in {PROJECT}",
            ),
            (
                {"repository": PROJECT, "hash": "abc12"},
                f"[commit] abc12 is not a commit in {PROJECT}",
            ),
            (
                {"repository": PROJECT, "hash": "HEAD~1"},
                f"[commit] HEAD~1 is not a commit in {PROJECT}",
            ),
            (
                # A branch named like a hash resolves, to a commit whose digits differ.
                {"repository": PROJECT, "hash": "abcdef12345"},
                f"[commit] abcdef12345 is not a commit in {PROJECT}",
            ),
            (
                {"repository": DEFAULT, "hash": commit[:9]},
                f"[commit] {DEFAULT} has no root on this machine, so the short hash"
                f" {commit[:9]} cannot be resolved: send the full hash",
            ),
            (
                {"repository": PROJECT, "hash": other[:9], "remove": True},
                f"[commit] {PROJECT} {other[:9]} is not attached to {t1}",
            ),
        )
        for entry, message in cases:
            with self.subTest(entry=entry):
                error = self.refused(t1, {"repository": PROJECT, "hash": commit}, entry)
                self.assertEqual("invalid_request", error["code"])
                self.assertEqual({"group": "commits", "index": 1}, error["step"])
                self.assertEqual(f"commits[1]: {message}", error["message"])

    def test_a_start_two_commits_share_is_ambiguous(self) -> None:
        """Seven shared digits take some 16,000 commits to find, so Git's two answers are
        given here: no commit by that start, and two objects that begin with it."""

        t1 = self.task("Ambiguous")
        start = "abcdef1"

        def git(_repo: str, *arguments: str, **_options: object) -> processes.TextResult:
            if arguments[:2] == ("rev-parse", "--verify"):
                return processes.TextResult(1, "", "")
            if arguments == ("rev-parse", f"--disambiguate={start}"):
                return processes.TextResult(0, f"{start}00\n{start}11\n", "")
            raise AssertionError(arguments)

        with mock.patch.object(git_worktrees, "git_text", side_effect=git):
            error = self.refused(t1, {"repository": PROJECT, "hash": start})
        self.assertEqual(
            f"commits[0]: [commit] {start} is ambiguous in {PROJECT}: send more digits",
            error["message"],
        )

    def test_an_entry_is_held_to_its_fields(self) -> None:
        t1 = self.task("Fields")
        for entry, message in (
            ({"repository": PROJECT}, "commits[0]: hash is required"),
            (
                {"repository": PROJECT, "hash": "abc1234", "remove": "yes"},
                "remove must be a boolean",
            ),
            ({"repository": PROJECT, "hash": "abc1234", "kind": "commit"}, "unknown field(s) kind"),
        ):
            with self.subTest(entry=entry):
                self.assertIn(message, self.refused(t1, entry)["message"])


class ContainerTests(ManualCase):
    def test_a_goal_takes_a_commit_by_hand_and_no_project(self) -> None:
        goal = str(
            service.create_work_item(self.conn, space="MAIN", title="Goal", kind="goal")[
                "reference"
            ]
        )
        self.conn.commit()
        commit = self.made("goal")
        applied = self.batch(goal, {"repository": PROJECT, "hash": commit[:9]})
        self.assertEqual([{"repository": PROJECT, "hash": commit}], applied["attached"])
        self.assertEqual([(goal, commit, "manual", "agent")], self.attached())
        self.assertEqual([], self.projects(goal), "a goal holds no projects")
        self.assertEqual({"count": 1}, self.card(goal)["parts"]["commits"])
        self.batch(goal, {"repository": PROJECT, "hash": commit, "remove": True})
        self.assertEqual([], self.attached())

    def test_the_server_attaches_to_the_task_under_a_goal_never_the_goal(self) -> None:
        goal = str(
            service.create_work_item(self.conn, space="MAIN", title="Goal", kind="goal")[
                "reference"
            ]
        )
        task = str(
            service.create_work_item(self.conn, space="MAIN", title="Under", parent=goal)[
                "reference"
            ]
        )
        self.conn.commit()
        self.claim(task)
        commit, _line = self.commit()
        self.assertEqual([(task, commit, "server", "valkama")], self.attached())


class CardTests(ManualCase):
    def test_the_card_counts_the_commits_and_the_part_lists_them_newest_first(self) -> None:
        t1 = self.task("Card")
        self.assertNotIn("commits", self.card(t1)["parts"], "an empty part is not named")
        self.assertEqual([], self.card(t1, parts="commits")["commits"])
        first, second = self.made("first"), self.made("second")
        self.batch(t1, {"repository": PROJECT, "hash": first, "label": "the fix"})
        self.batch(t1, {"repository": PROJECT, "hash": second})
        self.tool(
            "apply_work_item_changes", id=t1, refs=[{"kind": "url", "value": "https://a.example"}]
        )
        card = self.card(t1)
        self.assertNotIn("commits", card, "the card counts the part and leaves it out")
        self.assertEqual({"count": 2}, card["parts"]["commits"])
        parts = list(card["parts"])
        self.assertEqual(parts.index("refs") + 1, parts.index("commits"), "it follows refs")
        listed = self.card(t1, parts="commits")["commits"]
        self.assertEqual([second, first], [entry["hash"] for entry in listed])
        self.assertEqual(list(FIELDS), list(listed[1]))
        self.assertEqual(
            {
                "repository": PROJECT,
                "display_name": PROJECT,
                "subject": "feat: first",
                "session": None,
                "agent": None,
                "attached_by": "manual",
                "label": "the fix",
            },
            {name: listed[1][name] for name in FIELDS if name not in ("hash", "committed_at")},
        )
        full = service.get_work_item(self.conn, t1)
        self.assertEqual(listed, full["commits"], "the part is the full record's field")

    def test_a_rewritten_commit_is_not_listed(self) -> None:
        t1 = self.task("Rewritten")
        first, second = self.made("first"), self.made("second")
        self.batch(
            t1, {"repository": PROJECT, "hash": first}, {"repository": PROJECT, "hash": second}
        )
        self.conn.execute(
            "UPDATE commits SET rewritten_to = (SELECT commit_id FROM commits WHERE hash = ?)"
            " WHERE hash = ?",
            (second, first),
        )
        self.conn.commit()
        self.assertEqual({"count": 1}, self.card(t1)["parts"]["commits"])
        self.assertEqual(
            [second], [entry["hash"] for entry in self.card(t1, parts="commits")["commits"]]
        )

    def test_the_session_s_commit_names_its_session(self) -> None:
        t1 = self.task("Session")
        self.claim(t1)
        commit, _line = self.commit(agent_id="agent-1")
        [entry] = self.card(t1, parts="commits")["commits"]
        self.assertEqual(
            (commit, CLAUDE, "agent-1", "server"),
            (entry["hash"], entry["session"], entry["agent"], entry["attached_by"]),
        )


class MergeAndDeleteTests(ManualCase):
    def test_a_merge_moves_the_commits_the_survivor_lacks(self) -> None:
        survivor, merged = self.task("Survivor"), self.task("Merged")
        first, second, third = self.made("first"), self.made("second"), self.made("third")
        self.batch(
            survivor,
            {"repository": PROJECT, "hash": first},
            {"repository": PROJECT, "hash": second},
        )
        self.batch(
            merged, {"repository": PROJECT, "hash": second}, {"repository": PROJECT, "hash": third}
        )
        answer = self.tool("merge_work_items", id=survivor, items=[merged])
        [entry] = answer["merged"]
        self.assertEqual(
            ["steps", "comments", "refs", "commits", "links", "projects"], list(entry["moved"])
        )
        self.assertEqual(1, entry["moved"]["commits"])
        self.assertEqual(
            sorted([(survivor, first), (survivor, second), (survivor, third)]),
            sorted((row[0], row[1]) for row in self.attached()),
        )
        summary = service.get_work_item(self.conn, merged)["summary"]["done"]
        self.assertEqual(
            f"Merged into {survivor}, which now holds its 0 steps, 0 comments, 0 refs, 1 commit,"
            " 0 links and 1 project.",
            summary,
        )
        self.assertEqual([(PROJECT, "commits")], self.projects(survivor))
        self.assertEqual([], self.projects(merged))
        self.tasks_hold_their_commits_projects()

    def test_deleting_an_item_takes_its_attachments_and_leaves_the_commits(self) -> None:
        t1, t2 = self.task("Deleted"), self.task("Kept")
        commit = self.made("kept")
        self.batch(t1, {"repository": PROJECT, "hash": commit})
        self.batch(t2, {"repository": PROJECT, "hash": commit})
        service.delete_work_item(self.conn, t1)
        self.conn.commit()
        self.assertEqual([(t2, commit, "manual", "agent")], self.attached())
        self.assertEqual(1, self.conn.execute("SELECT COUNT(*) FROM commits").fetchone()[0])
        self.tasks_hold_their_commits_projects()
