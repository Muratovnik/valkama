"""Who holds a claim or a step: the session the client proved, or else the signature.

On one day only 10 of 124 open claims carried a session in `claim_ref`; the rest
said `claude`, `claude-code`, `agent` or a name the agent chose. Two sessions
under one name read as one holder, and one session under two names as two.
These cases hold the holder to the confirmed session, keep `author` as what
the history records about the call, and keep the signature as the holder for
every call nobody confirmed, so a claim made the old way still behaves the old
way.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import mcp_surface, store
from server.planning import calls, model, service

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
OTHER = "019a3c2e-6c8e-7c11-9e0f-2f4b6d8a1c3e"
THREAD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
TOOL_USE = "toolu_01ABCdefGHIjklMNOpqrSTU"


def codex(session: str = SESSION, thread: str | None = None) -> calls.Identity:
    return calls.verify_mcp({"sessionId": session, "threadId": thread or session}, None)


def claude(agent: str | None = None, *, matching: bool = True) -> calls.Identity:
    hook = {"session_id": SESSION, "tool_use_id": TOOL_USE}
    if agent is not None:
        hook["agent_id"] = agent
    meta = {"claudecode/toolUseId": TOOL_USE if matching else "toolu_other"}
    return calls.verify_mcp(meta, hook)


class HolderLabelTests(unittest.TestCase):
    def holder(self, identity: calls.Identity | None, author: str | None = "signed") -> str:
        if identity is None:
            return calls.holder(author)
        with calls.bind(identity, "claim_work_item"):
            return calls.holder(author)

    def test_a_confirmed_session_holds_as_itself_whatever_it_signs(self) -> None:
        self.assertEqual(f"codex (session {SESSION})", self.holder(codex()))
        self.assertEqual(f"codex (session {SESSION})", self.holder(codex(), "claude-workbench"))
        self.assertEqual(f"claude (session {SESSION})", self.holder(claude()))

    def test_a_subagent_holds_as_its_own_agent_inside_the_session(self) -> None:
        self.assertEqual(
            f"codex agent {THREAD} (session {SESSION})", self.holder(codex(thread=THREAD))
        )
        self.assertEqual(f"claude agent a7 (session {SESSION})", self.holder(claude("a7")))

    def test_every_call_nobody_confirmed_holds_by_its_signature(self) -> None:
        for name, identity in (
            ("no call at all", None),
            ("no identity", calls.verify_mcp({}, None)),
            (
                "an unverified hook",
                calls.verify_mcp({}, {"session_id": SESSION, "tool_use_id": "t"}),
            ),
            ("a mismatched hook", claude(matching=False)),
            ("the browser", calls.browser()),
            ("Valkama itself", calls.valkama()),
        ):
            with self.subTest(name):
                self.assertEqual("signed", self.holder(identity))
                # And nothing signed is the product's own fallback, as before.
                self.assertEqual("agent", self.holder(identity, None))

    def test_an_id_that_is_not_plain_is_carried_as_a_digest(self) -> None:
        odd = "a session id with spaces, and far longer than any id either client sends"
        label = self.holder(codex(odd))
        self.assertRegex(label, r"^codex \(session [0-9a-f]{16}\)$")
        self.assertEqual(label, self.holder(codex(odd)))
        self.assertNotEqual(label, self.holder(codex(odd + "!")))
        # Whatever the ids, the label is a holder the store accepts.
        long = "x" * 200
        self.assertEqual(
            model.actor(self.holder(codex(long, thread=long + "y"))),
            self.holder(codex(long, thread=long + "y")),
        )


class HolderWriteTests(unittest.TestCase):
    """The rule as the store records it, through the MCP surface a client calls."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3"),
                "HOME": directory.name,
                "USERPROFILE": directory.name,
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="holders", name="Holders", key="HLD")
        self.reference = service.create_work_item(self.conn, space="HLD", title="Shared")[
            "reference"
        ]
        self.steps = [
            step["id"]
            for step in service.set_checklist(self.conn, self.reference, ["one", "two"])[
                "checklist"
            ]
        ]
        self.conn.commit()

    def call(self, name: str, session: str | None, **arguments: object) -> dict:
        meta = {"sessionId": session, "threadId": session} if session else None
        try:
            answer = mcp_surface.call_tool(
                self.conn, name, {"id": self.reference, **arguments}, meta=meta
            )
        except model.PlanningError as refusal:
            self.conn.rollback()
            return {"refused": str(refusal)}
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def test_the_item_claim_names_the_session_in_every_read(self) -> None:
        answer = self.call("claim_work_item", SESSION, author="claude-code")
        label = f"codex (session {SESSION})"
        self.assertEqual(label, answer["claim_ref"])
        item = service.get_work_item(self.conn, self.reference)
        self.assertEqual((label, label), (item["claim_ref"], item["claim"]["holder"]))
        [row] = mcp_surface.call_tool(self.conn, "list_work_items", {"space": "HLD"})["work_items"]
        self.assertEqual(label, row["claim_ref"])
        listed = mcp_surface.call_tool(self.conn, "list_work_items", {"owner": label})
        self.assertEqual([self.reference], [r["reference"] for r in listed["work_items"]])
        # The history still says what the call signed.
        claimed = [event for event in item["events"] if event["action"] == "claimed"]
        self.assertEqual("claude-code", claimed[0]["author"])

    def test_two_sessions_under_one_name_hold_two_steps_apart(self) -> None:
        first = self.call("claim_work_item_checklist_item", SESSION, item_id=self.steps[0])
        second = self.call("claim_work_item_checklist_item", OTHER, item_id=self.steps[1])
        self.assertEqual(f"codex (session {SESSION})", first["step"]["claimed_by"])
        self.assertEqual(f"codex (session {OTHER})", second["step"]["claimed_by"])
        refused = self.call("tick_work_item_checklist_item", OTHER, item_id=self.steps[0])
        self.assertIn(f"claimed by codex (session {SESSION})", refused["refused"])
        ticked = self.call("tick_work_item_checklist_item", SESSION, item_id=self.steps[0])
        self.assertEqual(
            (True, f"codex (session {SESSION})"),
            (ticked["step"]["done"], ticked["step"]["done_by"]),
        )

    def test_a_step_held_under_a_signature_is_still_its_signers(self) -> None:
        # A step claimed before sessions held steps: by name, with no identity.
        legacy = self.call(
            "claim_work_item_checklist_item", None, item_id=self.steps[0], author="codex"
        )
        self.assertEqual("codex", legacy["step"]["claimed_by"])
        # A session signing that name is its signer; one signing another is not.
        refused = self.call(
            "tick_work_item_checklist_item", SESSION, item_id=self.steps[0], author="claude"
        )
        self.assertIn("claimed by codex", refused["refused"])
        ticked = self.call(
            "tick_work_item_checklist_item", SESSION, item_id=self.steps[0], author="codex"
        )
        self.assertEqual(f"codex (session {SESSION})", ticked["step"]["done_by"])


if __name__ == "__main__":
    unittest.main()
