"""A close answers to what the closing agent was told, by its own write or by its hook.

A person's comment reaches an agent that runs the client hook at its next tool
call, so asking that agent to write once more before it may close only made it
retry. And one agent's write used to empty the window for every other agent, so
an agent that had heard nothing could close over the person's words. Where the
closing agent's hook keeps a marks file, what counts is that agent's own last
write on the item or what its hook handed it there, whichever is later; with no
such file, or one that does not read, the item's window decides as before.

The cases drive the real doors: an agent through `mcp_surface.call_tool` with a
proved session, a person through the HTTP boundary as the browser binds it, and
the hook through `notify.deliver` with a payload shaped like the client's input.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import mcp_surface, store
from server.hooks import marks, notify
from server.planning import api, calls, model, service

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
CHILD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
STRANGER = "019a3c2e-7777-7c11-9e0f-2f4b6d8a1c3e"
ORCHESTRATOR = {"sessionId": SESSION}
SUBAGENT = {"sessionId": SESSION, "threadId": CHILD}
#: An agent of another session.
OTHER = {"sessionId": STRANGER}


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "store", "valkama.sqlite3")
        os.makedirs(os.path.dirname(self.path))
        home = os.path.join(directory.name, "home")
        os.makedirs(home)
        self.environ = {"VALKAMA_DB": self.path, "HOME": home, "USERPROFILE": home}
        patch = mock.patch.dict(os.environ, self.environ)
        patch.start()
        self.addCleanup(patch.stop)
        for name in ("CLAUDE_CODE_SESSION_ID", "CLAUDE_PID", "VALKAMA_NOTIFY"):
            os.environ.pop(name, None)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.space = service.create_planning_space(self.conn, project_id="p", name="Quality Crew")
        self.ref = self.new_item("Do the work")

    def new_item(self, title: str) -> str:
        item = service.create_work_item(self.conn, space=self.space["key"], title=title)
        self.conn.commit()
        return str(item["reference"])

    def agent(self, tool: str, meta: object = ORCHESTRATOR, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, tool, arguments, meta=meta)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def refused(self, tool: str, meta: object = ORCHESTRATOR, **arguments: object) -> str:
        with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught:
            mcp_surface.call_tool(self.conn, tool, arguments, meta=meta)
        self.conn.rollback()
        return str(caught.exception)

    def says(self, body: str, ref: str | None = None) -> None:
        with calls.bind(calls.browser(), "/api/planning/work-item/comment"):
            api.handle_post(
                self.conn, "/api/planning/work-item/comment", {"id": ref or self.ref, "body": body}
            )
        self.conn.commit()

    def hook(self, agent_id: str | None = None) -> str:
        """What one `PostToolUse` hook of this session hands over; empty for nothing."""

        payload: dict = {"session_id": SESSION}
        if agent_id:
            payload["agent_id"] = agent_id
        answer = notify.deliver("claude", "post-tool-use", payload, self.environ)
        return "" if answer is None else answer.decode("ascii")

    def marks_file(self, agent_id: str | None = None) -> str:
        return marks.path(marks.directory(self.path), SESSION, agent_id)

    def worked(self, meta: object = ORCHESTRATOR) -> None:
        self.agent("claim_work_item", meta, id=self.ref)
        self.agent(
            "apply_work_item_changes", meta, id=self.ref, summary={"done": "Did", "next": "None"}
        )

    def close(self, meta: object = ORCHESTRATOR) -> dict:
        return self.agent(
            "apply_work_item_changes", meta, id=self.ref, transition={"state": "done"}
        )

    def close_refused(self, meta: object = ORCHESTRATOR) -> str:
        return self.refused(
            "apply_work_item_changes", meta, id=self.ref, transition={"state": "done"}
        )


class WithTheHookTests(Harness):
    def test_words_the_hook_handed_over_let_the_close_through(self) -> None:
        self.worked()
        self.says("Use the other library")
        self.assertIn("Use the other library", self.hook())
        answer = self.close()
        self.assertEqual("done", answer["state"]["key"])
        self.assertNotIn("overridden", answer)

    def test_words_after_the_hooks_last_read_refuse_the_close(self) -> None:
        self.worked()
        self.hook()
        self.assertTrue(os.path.isfile(self.marks_file()))
        self.says("Hold on, the requirement changed")
        message = self.close_refused()
        self.assertIn("[person_spoke]", message)
        self.assertIn("Hold on, the requirement changed", message)

    def test_the_refusal_names_the_form_that_passes_and_that_form_passes(self) -> None:
        self.worked()
        self.hook()
        self.says("Not so fast")
        message = self.close_refused()
        self.assertIn(f"as a comment on {self.ref} in a call of its own", message)
        self.assertIn("close in the next call", message)
        self.assertIn("in the same call as the close does not count", message)
        self.agent("apply_work_item_changes", id=self.ref, comment={"body": "Read it"})
        self.assertEqual("done", self.close()["state"]["key"])

    def test_a_comment_in_the_closing_call_still_does_not_count(self) -> None:
        self.worked()
        self.hook()
        self.says("Not so fast")
        message = self.refused(
            "apply_work_item_changes",
            id=self.ref,
            comment={"body": "Read it"},
            transition={"state": "done"},
        )
        self.assertIn("[person_spoke]", message)

    def test_another_agents_write_does_not_count_once_the_hook_keeps_marks(self) -> None:
        self.worked()
        self.hook()
        self.says("For whoever closes this")
        self.agent("apply_work_item_changes", OTHER, id=self.ref, comment={"body": "Passing by"})
        message = self.close_refused()
        self.assertIn("For whoever closes this", message)
        self.assertIn("that you have not been told of", message)

    def test_the_orchestrator_being_told_does_not_tell_its_subagent(self) -> None:
        self.worked(SUBAGENT)
        self.hook(CHILD)
        self.assertTrue(os.path.isfile(self.marks_file(CHILD)))
        self.says("Whoever does this, read it")
        self.assertIn("Whoever does this, read it", self.hook())
        self.assertIn("[person_spoke]", self.close_refused(SUBAGENT))
        self.assertEqual("done", self.close()["state"]["key"])

    def test_a_place_the_hook_kept_without_holding_the_item_counts_for_nothing(self) -> None:
        """Not holding it, the hook told the agent only what was addressed to it."""

        self.agent("claim_work_item", id=self.ref)
        self.agent("apply_work_item_changes", id=self.ref, summary={"done": "Did", "next": "None"})
        self.agent("apply_work_item_changes", SUBAGENT, id=self.ref, comment={"body": "Looked"})
        self.says("A note on the work")
        self.assertEqual("", self.hook(CHILD))
        self.assertFalse(marks.read_marks(self.marks_file(CHILD))[self.item_id()][2])
        self.assertIn("A note on the work", self.close_refused(SUBAGENT))

    def item_id(self) -> str:
        return str(service.get_work_item(self.conn, self.ref)["work_item_id"])


class WithoutTheHookTests(Harness):
    def test_with_no_marks_file_any_agents_write_ends_the_window(self) -> None:
        self.worked()
        self.says("For whoever closes this")
        self.agent("apply_work_item_changes", OTHER, id=self.ref, comment={"body": "Passing by"})
        self.assertFalse(os.path.exists(self.marks_file()))
        self.assertEqual("done", self.close()["state"]["key"])

    def test_with_no_marks_file_the_refusal_still_names_the_form_that_passes(self) -> None:
        self.worked()
        self.says("Not so fast")
        message = self.close_refused()
        self.assertIn("since an agent last wrote to it", message)
        self.assertIn("in a call of its own", message)

    def test_a_damaged_marks_file_is_no_file(self) -> None:
        self.worked()
        self.hook()
        self.says("For whoever closes this")
        self.agent("apply_work_item_changes", OTHER, id=self.ref, comment={"body": "Passing by"})
        with open(self.marks_file(), "wb") as handle:
            handle.write(b"v4\nnot a mark at all\n")
        self.assertEqual("done", self.close()["state"]["key"])

    def test_an_unconfirmed_call_answers_to_the_items_window(self) -> None:
        self.worked()
        self.hook()
        self.says("For whoever closes this")
        self.agent("apply_work_item_changes", OTHER, id=self.ref, comment={"body": "Passing by"})
        # A call that proves no session cannot be matched to any hook's marks.
        self.assertEqual("done", self.close(meta={})["state"]["key"])


class MergeTests(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.other = self.new_item("Merge me")
        self.agent("claim_work_item", id=self.other)

    def test_a_merge_over_words_the_hook_handed_over_goes_through(self) -> None:
        self.says("Keep this", self.other)
        self.assertIn("Keep this", self.hook())
        answer = self.agent("merge_work_items", id=self.ref, items=[self.other])
        self.assertNotIn("overridden", answer)

    def test_a_merge_over_words_after_the_hooks_last_read_is_refused(self) -> None:
        self.hook()
        self.says("Keep this", self.other)
        message = self.refused("merge_work_items", id=self.ref, items=[self.other])
        self.assertIn("[person_spoke]", message)
        self.assertIn("Keep this", message)
        self.assertIn(f"as a comment on {self.other} in a call of its own", message)
        self.assertIn("merge in the next call", message)

    def test_another_agents_write_on_the_merged_item_does_not_count(self) -> None:
        self.hook()
        self.says("Keep this", self.other)
        self.agent("apply_work_item_changes", OTHER, id=self.other, comment={"body": "Seen"})
        self.assertIn(
            "[person_spoke]", self.refused("merge_work_items", id=self.ref, items=[self.other])
        )


if __name__ == "__main__":
    unittest.main()
