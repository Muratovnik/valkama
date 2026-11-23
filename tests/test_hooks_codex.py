"""Codex hears Valkama at its next prompt, and never through a subagent's hook.

The tree of `test_hooks_tree_notices`: goal G holds stage S1 with tasks T1 and T3 and stage S2
with task T2, and goal H holds task U. A is a Claude Code session with the subagent a1. X is a
Codex session with the subagent x1 and holds T5, outside the tree; B and C are Codex sessions,
B holding T2 under G and C holding U under H. Every Codex call proves its session in `_meta`,
`threadId` naming the subagent; so does A's here, which is the shortest door in a test.

Each hook runs as the client runs it: `valkama.py hook codex <event>` in its own process, its
input shaped by the Codex hook input schemas and its answer held to their output schemas, with
`VALKAMA_DB` on the test's store and `VALKAMA_PROTECTED_STORE` on the owner's real one.

The expectations come from the hook contract, "When it is told": Codex reads a notice at
`UserPromptSubmit` and `PostToolUse`, with `systemMessage` for the person; a Codex subagent's
hook carries its parent's `session_id`, so an input with `agent_id` is a subagent's and is told
nothing, its places untouched; `Stop` cannot tell a subagent's turn apart, so it is never
answered and the news waits for the next prompt.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

from server.alerts import settings as alert_settings
from server.hooks import marks, notify
from server.planning import calls, requests, service
from tests.test_hooks_tree_notices import (
    A1,
    AS_A1,
    AS_B,
    AS_C,
    COMMENT,
    FROM_AGENTS,
    A,
    B,
    C,
    Harness,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
X = "0f100000-0000-4000-8000-0000000000f1"
X1 = "0f100000-0000-4000-8000-0000000000f2"
AS_X = {"sessionId": X}
AS_X1 = {"sessionId": X, "threadId": X1}

#: What the Codex hook input schemas require of each event, and what else they allow; every
#: input has `additionalProperties: false`. `Stop` has no `agent_id`.
_COMMON = {"session_id", "turn_id", "transcript_path", "cwd", "hook_event_name", "model"}
_COMMON |= {"permission_mode"}
INPUT_REQUIRED = {
    "user-prompt-submit": _COMMON | {"prompt"},
    "post-tool-use": _COMMON | {"tool_name", "tool_input", "tool_response", "tool_use_id"},
    "stop": _COMMON | {"stop_hook_active", "last_assistant_message"},
}
INPUT_OPTIONAL = {
    "user-prompt-submit": {"agent_id", "agent_type"},
    "post-tool-use": {"agent_id", "agent_type"},
    "stop": set(),
}
HOOK_EVENT = {
    "user-prompt-submit": "UserPromptSubmit",
    "post-tool-use": "PostToolUse",
    "stop": "Stop",
}
#: What the Codex hook output schemas allow at the top and in `hookSpecificOutput`.
OUTPUT_FIELDS = {"continue", "decision", "hookSpecificOutput", "reason", "stopReason"}
OUTPUT_FIELDS |= {"suppressOutput", "systemMessage"}
SPECIFIC_FIELDS = {
    "user-prompt-submit": {"hookEventName", "additionalContext"},
    "post-tool-use": {"hookEventName", "additionalContext", "updatedMCPToolOutput"},
}
PROMPT = "May the work be cancelled?"
CHOICE = {
    "id": "choice",
    "label": "Cancel it?",
    "type": "choice",
    "required": True,
    "options": [{"id": "agree", "label": "Agree"}, {"id": "object", "label": "Object"}],
}


class CodexHarness(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.t5 = self.made("T5")
        # The person's line is read in the owner's alert language, else the system's.
        alert_settings.write(self.conn, {"locale": "en"})
        self.conn.commit()
        self.turns = 0

    def codex(
        self,
        event: str,
        session: str,
        agent_id: str | None = None,
        *,
        stop_hook_active: bool = False,
    ) -> dict | None:
        """One hook process on a recorded input: its answer, parsed and checked, or None."""

        self.turns += 1
        payload: dict = {
            "session_id": session,
            "turn_id": f"turn-{self.turns}",
            "transcript_path": None,
            "cwd": ROOT,
            "hook_event_name": HOOK_EVENT[event],
            "model": "gpt-5.5-codex",
            "permission_mode": "default",
        }
        if event == "user-prompt-submit":
            payload["prompt"] = "Go on"
        elif event == "post-tool-use":
            payload.update(
                tool_name="mcp__valkama__get_work_item",
                tool_input={"id": self.t5},
                tool_response={"content": [{"type": "text", "text": "{}"}]},
                tool_use_id=f"call_{self.turns}",
            )
        else:
            payload.update(stop_hook_active=stop_hook_active, last_assistant_message="Done.")
        self.assertEqual(INPUT_REQUIRED[event], set(payload), "the schema's required fields")
        if agent_id is not None:
            # The schema has no `agent_id` on `Stop`; sent there, it is still a subagent's.
            payload.update(agent_id=agent_id, agent_type="worker")
            if event != "stop":
                self.assertLessEqual(set(payload), INPUT_REQUIRED[event] | INPUT_OPTIONAL[event])
        environ = {
            **os.environ,
            "VALKAMA_DB": self.path,
            "VALKAMA_PROTECTED_STORE": self.environ["VALKAMA_PROTECTED_STORE"],
        }
        self.assertNotEqual(environ["VALKAMA_DB"], environ["VALKAMA_PROTECTED_STORE"])
        done = subprocess.run(
            [sys.executable, os.path.join(ROOT, "valkama.py"), "hook", "codex", event],
            input=json.dumps(payload).encode(),
            capture_output=True,
            env=environ,
            timeout=60,
            check=False,
        )
        self.assertEqual((0, b""), (done.returncode, done.stderr), done.stderr[:400])
        if not done.stdout:
            return None
        answer = json.loads(done.stdout)
        self.assertLessEqual(set(answer), OUTPUT_FIELDS, "the output schema's fields")
        specific = answer["hookSpecificOutput"]
        self.assertLessEqual(set(specific), SPECIFIC_FIELDS[event])
        self.assertEqual(HOOK_EVENT[event], specific["hookEventName"])
        return dict(answer)

    def context(self, event: str, session: str, agent_id: str | None = None) -> str | None:
        answer = self.codex(event, session, agent_id)
        return None if answer is None else str(answer["hookSpecificOutput"]["additionalContext"])

    def settle_codex(self, *sessions: str) -> None:
        """Each Codex session's prompt has read up to now."""

        for session in sessions:
            self.codex("user-prompt-submit", session)
            self.assertIsNone(self.codex("user-prompt-submit", session), f"{session} has read all")

    def places(self) -> dict[str, bytes]:
        """Every file of the hook's places, by name."""

        state = os.path.join(os.path.dirname(self.path), marks.STATE_DIRECTORY)
        found = {}
        for name in sorted(os.listdir(state)) if os.path.isdir(state) else ():
            with open(os.path.join(state, name), "rb") as file:
                found[name] = file.read()
        return found

    def shown(self, whose: str, ref: str) -> str:
        return f"Valkama told the agent what {whose} on {ref} «{self.title_of(ref)}»"


class SubagentInputTests(CodexHarness):
    def test_a_codex_hook_with_an_agent_id_tells_nothing_and_moves_no_place(self) -> None:
        """K1: x1 holds a step of X's T5, so its own hook would hear a person there."""

        self.agent("claim_work_item", AS_X, id=self.t5)
        self.agent("apply_work_item_changes", AS_X, id=self.t5, checklist={"items": ["one"]})
        step = service.get_work_item(self.conn, self.t5)["checklist"][0]["id"]
        self.agent("claim_work_item_checklist_item", AS_X1, id=self.t5, item_id=step)
        self.settle_codex(X)
        self.person(COMMENT, id=self.t5, body="Use the other library, marker K-1")
        before = self.places()
        for event in ("user-prompt-submit", "post-tool-use", "stop"):
            with self.subTest(event=event):
                self.assertIsNone(self.codex(event, X, X1), "a subagent's hook says nothing")
                self.assertEqual(before, self.places(), "and moves no place")
        told = self.context("user-prompt-submit", X)
        assert told is not None, "the same prompt without agent_id is the orchestrator's"
        self.assertIn("marker K-1", told)

    def test_codex_stop_says_nothing_and_the_news_waits_for_the_prompt(self) -> None:
        """K6: a request asked of X would wake it; Codex `Stop` still answers nothing."""

        self.agent("claim_work_item", AS_X, id=self.t5)
        self.settle_codex(X)
        with calls.bind(calls.valkama(), "test"):
            asked = requests.ask_sessions(
                self.conn, self.t5, sessions=[X], prompt=PROMPT, fields=[CHOICE]
            )
        self.conn.commit()
        before = self.places()
        self.assertIsNone(self.codex("stop", X), "no continuation of the turn")
        self.assertEqual(before, self.places(), "the place stays")
        answer = self.codex("user-prompt-submit", X)
        assert answer is not None, "the request waits for the next prompt"
        told = answer["hookSpecificOutput"]["additionalContext"]
        self.assertTrue(told.startswith(FROM_AGENTS), told)
        self.assertIn("- question asked of this session at ", told)
        self.assertIn(f"answer_work_item_request id={asked[0]['request_id']}", told)
        self.assertEqual(self.shown("Valkama recorded", self.t5), answer["systemMessage"])
        self.assertIsNone(self.codex("user-prompt-submit", X), "once")

    def test_codex_stop_never_answers_a_person_either(self) -> None:
        """A person's act on held work continues a Claude Code turn; never a Codex one."""

        self.agent("claim_work_item", AS_X, id=self.t5)
        self.settle_codex(X)
        self.person(COMMENT, id=self.t5, body="Stop here, marker K-6")
        for active in (False, True):
            with self.subTest(stop_hook_active=active):
                self.assertIsNone(self.codex("stop", X, stop_hook_active=active))
        answer = self.codex("user-prompt-submit", X)
        assert answer is not None
        self.assertIn("marker K-6", answer["hookSpecificOutput"]["additionalContext"])
        self.assertEqual(self.shown("you did", self.t5), answer["systemMessage"])


class TreeTests(CodexHarness):
    def test_a_codex_session_under_the_goal_hears_the_close(self) -> None:
        """K2: a1 of the Claude Code session A closes T1; B holds T2 under the same goal."""

        self.agent("claim_work_item", AS_B, id=self.t2)
        self.settle_codex(B)
        self.close(AS_A1, self.t1)
        answer = self.codex("user-prompt-submit", B)
        assert answer is not None, "B works under the goal and hears where T1 stands"
        told = answer["hookSpecificOutput"]["additionalContext"]
        self.assertIn(f"\n{self.line(self.t1, self.goal)}\n", told)
        self.assertRegex(told, rf"\n- status at \S+ by agent {A1} of session {A}: «done»\n")
        self.assertEqual(self.shown("another agent wrote", self.t1), answer["systemMessage"])
        self.assertIsNone(self.codex("user-prompt-submit", B), "once")

    def test_a_codex_orchestrator_hears_its_agent_at_its_next_prompt(self) -> None:
        """K3: x1 claims T5 and closes it in its own calls, `_meta.threadId` naming it."""

        self.agent("claim_work_item", AS_X1, id=self.t5)
        self.settle_codex(X)
        self.agent(
            "apply_work_item_changes",
            AS_X1,
            id=self.t5,
            transition={"state": "done"},
            summary={"done": "Parser rewritten, marker K-3", "next": "Nothing"},
        )
        closed = [
            event["identity"]
            for event in service.get_work_item(self.conn, self.t5)["events"]
            if event["action"] == "transitioned"
        ][-1]
        self.assertEqual((X, X1), (closed["session_id"], closed["agent_id"]), "x1 of session X")
        self.assertIsNone(self.codex("user-prompt-submit", X, X1), "x1's own hook: nothing")
        answer = self.codex("user-prompt-submit", X)
        assert answer is not None
        told = answer["hookSpecificOutput"]["additionalContext"]
        self.assertRegex(told, rf"\n- status at \S+ by your agent {X1}\n")
        self.assertNotIn("marker K-3", told, "one short line that quotes nothing")
        self.assertEqual(
            self.shown("a subagent of this session wrote", self.t5), answer["systemMessage"]
        )

    def test_a_codex_session_outside_the_goal_hears_nothing(self) -> None:
        """K4: C holds U under H; B, under G, is the control that hears the close."""

        self.agent("claim_work_item", AS_C, id=self.u)
        self.agent("claim_work_item", AS_B, id=self.t2)
        self.settle_codex(B, C)
        self.close(AS_A1, self.t1)
        self.assertIsNone(self.codex("user-prompt-submit", C), "C works under H only")
        self.assertIn(self.t1, self.context("user-prompt-submit", B) or "")

    def test_a_codex_notice_fits_its_limit(self) -> None:
        """K7: a person writes 4 000 Cyrillic characters on G."""

        self.agent("claim_work_item", AS_B, id=self.t2)
        self.settle_codex(B)
        self.person(COMMENT, id=self.goal, body="д" * 4000)
        told = self.context("user-prompt-submit", B)
        assert told is not None
        self.assertLessEqual(len(told), 2400)
        self.assertIn("«" + "д" * 1499 + "…»", told, "cut at 1 500, the ellipsis counted")
        self.assertNotIn("д" * 1500, told)
        self.assertTrue(told.endswith(notify.READ_THE_REST), told[-200:])
