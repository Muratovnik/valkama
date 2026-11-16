"""The resume note: its text, who is told what, and its bound.

The expected text of a whole note is the form the note's contract gives for it.
The bound is checked as a property on random inputs far past anything a store
holds, because the note promises 600 characters by construction, not by the
inputs a test happens to pick.
"""

from __future__ import annotations

import json
import os
import random
import re
import tempfile
import unittest
from unittest import mock

from server import mcp_surface, store
from server.hooks import held_note
from server.planning import held, service

#: The store a test must never touch: the default one, read before a test moves the home.
LIVE_STORE = os.path.join(os.path.expanduser("~"), ".valkama", "valkama.sqlite3")

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
OTHER = "019a3c2e-6c8e-7c11-9e0f-2f4b6d8a1c3e"
CHILD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
SIBLING = "019a3c2e-8888-7c11-9e0f-2f4b6d8a1c3e"
STRANGER = "019a3c2e-7777-7c11-9e0f-2f4b6d8a1c3e"

RULE = "Current: read an item only for what this note leaves out."
DEV = {"key": "dev", "name": "Dev", "category": "active"}


def entry(reference: str, title: str, **facts: object) -> dict:
    """One `held.held_for_note` item, claimed, in Dev, with nothing to count."""

    item: dict = {
        "reference": reference,
        "title": title,
        "state": DEV,
        "held_as": "claim",
        "steps": {"done": 0, "total": 0},
        "pending_questions": 0,
        "url": f"http://127.0.0.1:8642/open/{reference}",
        "next_condition": None,
        "open_threads": 0,
        "new_answers": 0,
        "to_confirm": 0,
        "stage": None,
        "goal": None,
        "last_write": None,
    }
    item.update(facts)
    return item


class ComposeTests(unittest.TestCase):
    def test_the_note_reads_as_its_form(self) -> None:
        items = [
            entry(
                "MAIN-12",
                "Widen the check",
                steps={"done": 2, "total": 5},
                next_condition={
                    "text": "Add the probe for the second client",
                    "done": 2,
                    "total": 5,
                    "flagged": False,
                },
                open_threads=3,
                new_answers=1,
                stage="MAIN-3",
                goal="MAIN-1",
            ),
            entry(
                "MAIN-14",
                "Retire the old reader",
                held_as="step",
                steps={"done": 2, "total": 4},
                next_condition={
                    "text": "Measure the cold start",
                    "done": 1,
                    "total": 4,
                    "flagged": True,
                },
                to_confirm=1,
            ),
            entry(
                "MAIN-9",
                "Draft the release note",
                state={"key": "blocked", "name": "Blocked", "category": "blocked"},
                steps={"done": 3, "total": 3},
                pending_questions=1,
                goal="MAIN-1",
            ),
            entry("MAIN-20", "Not named: the fourth"),
        ]
        self.assertEqual(
            "\n".join(
                (
                    "Valkama now: this session holds 4 open items; the 3 it wrote to last:",
                    "- MAIN-12 «Widen the check», Dev. Next condition 2/5: «Add the probe for"
                    " the second client». 3 open threads; 1 new answer. Stage MAIN-3 of goal"
                    " MAIN-1.",
                    "- MAIN-14 «Retire the old reader», Dev, held by a condition. Next condition"
                    " 1/4: «Measure the cold start» (to confirm). 1 to confirm.",
                    "- MAIN-9 «Draft the release note», Blocked. All 3 conditions ticked."
                    " 1 open question. Goal MAIN-1.",
                    "No longer held by you: MAIN-7.",
                    "Waiting for your answer: MAIN-3.",
                    RULE,
                )
            ),
            held_note.compose(items, agent=False, lost=["MAIN-7"], waiting=["MAIN-3"]),
        )

    def test_the_header_counts_what_is_held_and_names_what_is_shown(self) -> None:
        one = [entry("MAIN-1", "Only")]
        self.assertEqual(
            "\n".join(
                (
                    "Valkama now: this agent holds 1 open item:",
                    "- MAIN-1 «Only», Dev. No conditions.",
                    RULE,
                )
            ),
            held_note.compose(one, agent=True),
        )
        many = [entry(f"MAIN-{number}", "Held") for number in range(1, 1201)]
        header = str(held_note.compose(many, agent=False)).splitlines()[0]
        self.assertEqual(
            "Valkama now: this session holds 999+ open items; the 3 it wrote to last:", header
        )
        nothing_held = held_note.compose([], agent=False, lost=["MAIN-7", "MAIN-8"])
        self.assertEqual(
            "\n".join(
                (
                    "Valkama now: this session holds no open item.",
                    "No longer held by you: MAIN-7 and MAIN-8.",
                    RULE,
                )
            ),
            nothing_held,
        )

    def test_nothing_to_tell_is_no_note(self) -> None:
        self.assertIsNone(held_note.compose([], agent=False))
        # A request is its session's to answer, so a subagent with only that is told nothing.
        self.assertIsNone(held_note.compose([], agent=True, waiting=["MAIN-3"]))

    def test_a_long_note_shortens_its_fields_before_it_names_fewer_items(self) -> None:
        long = "word " * 200
        step = {"text": long, "done": 0, "total": 9, "flagged": False}
        items = [
            entry(f"SPACE-{number}", long, next_condition=step, steps={"done": 0, "total": 9})
            for number in (1, 2, 3)
        ]
        text = str(held_note.compose(items, agent=False))
        lines = text.splitlines()
        self.assertLessEqual(len(text), 600)
        # With 60 and 72 characters each item's line is 173, and the note 634; with
        # 44 and 52 it is 137, and the note 526: three items, at the second level.
        self.assertEqual(5, len(lines))
        for line in lines[1:4]:
            title, condition = re.findall(r"«([^»]*)»", line)
            self.assertEqual((44, 52), (len(title), len(condition)))
            self.assertTrue(title.endswith("…") and condition.endswith("…"))

    def test_a_field_is_one_line_and_its_cut_ends_with_an_ellipsis(self) -> None:
        item = entry("MAIN-1", "two\nlines\t and  spaces", state={**DEV, "name": "S" * 30})
        line = str(held_note.compose([item], agent=False)).splitlines()[1]
        self.assertEqual(f"- MAIN-1 «two lines and spaces», {'S' * 19}…. No conditions.", line)


class PropertyTests(unittest.TestCase):
    """The bound and the shape on random inputs."""

    ALPHABET = "abcz ABZ абя 019\t\n!?;:-()/…"
    SUFFIX = "(session S)"

    def test_note_fits_by_construction(self) -> None:
        rng = random.Random(20261116)  # noqa: S311 - made-up inputs, not a secret
        pool = [self.reference(rng) for _ in range(10**4)]
        # Every field at its bound at once: the longest reference, title, state and
        # flagged condition, every count past 999, and the longest header.
        longest = "ABCDEFGH-123456789"
        steps = [{"text": "x" * 1000, "done": True, "claimed_by": "", held.FLAG: True}] * 1200
        extreme = entry(
            longest,
            "t" * 1000,
            state={**DEV, "name": "s" * 1000},
            held_as="step",
            steps={"done": 1200, "total": 1200},
            next_condition=held.next_condition(steps, self.SUFFIX),
            pending_questions=10**4,
            open_threads=10**4,
            new_answers=10**4,
            to_confirm=1200,
            stage=longest,
            goal=longest,
            _steps=steps,
        )
        references = [longest] * 10**4
        text = held_note.compose(
            [extreme] * 10**4, agent=False, lost=references, waiting=references
        )
        assert text is not None
        self.check(text, [extreme] * 10**4, False, references, references)
        for case in range(400):
            with self.subTest(case=case):
                held_count = rng.choice((1, 2, 3, 4, rng.randint(5, 10**4), 10**4))
                shown_items = [self.item(rng, pool) for _ in range(min(held_count, 4))]
                items = shown_items + [shown_items[-1]] * (held_count - len(shown_items))
                agent = rng.random() < 0.3
                lost = pool[: rng.choice((0, 1, 2, 3, 4, rng.randint(0, 10**4), 10**4))]
                waiting = pool[: rng.choice((0, 1, 3, 4, rng.randint(0, 10**4), 10**4))]
                text = held_note.compose(items, agent=agent, lost=lost, waiting=waiting)
                assert text is not None
                self.check(text, items, agent, lost, waiting)

    def check(
        self, text: str, items: list[dict], agent: bool, lost: list[str], waiting: list[str]
    ) -> None:
        self.assertLessEqual(len(text), 600)
        lines = text.split("\n")
        self.assertEqual(RULE, lines[-1])
        header = re.fullmatch(
            r"Valkama now: this (session|agent) holds (\d+\+?) open items?"
            r"(?:; the (\d) it wrote to last)?:",
            lines[0],
        )
        assert header is not None, lines[0]
        self.assertEqual("agent" if agent else "session", header.group(1))
        self.assertEqual(cap(len(items)), header.group(2))
        tasks = [line for line in lines if line.startswith("- ")]
        self.assertLessEqual(len(tasks), 3)
        self.assertGreaterEqual(len(tasks), 1)
        if header.group(3) is None:
            self.assertEqual(len(items), len(tasks))
        else:
            self.assertEqual(str(len(tasks)), header.group(3))
            self.assertLess(len(tasks), len(items))
        self.assertEqual(lines[1 : 1 + len(tasks)], tasks)
        for line, item in zip(tasks, items, strict=False):
            self.check_task(line, item)
        rest = lines[1 + len(tasks) : -1]
        expected_leads = ["No longer held by you"] * bool(lost)
        expected_leads += ["Waiting for your answer"] * bool(waiting and not agent)
        self.assertEqual(expected_leads, [line.split(":")[0] for line in rest])
        for line, references in zip(rest, [r for r in (lost, waiting) if r], strict=False):
            self.check_references(line, references)

    def check_task(self, line: str, item: dict) -> None:
        found = re.match(r"- (\S+) «([^»]*)», ([^,.]*)(, held by a condition)?\. ", line)
        assert found is not None, line
        self.assertEqual(item["reference"], found.group(1))
        self.check_cut(found.group(2), item["title"], 60)
        self.check_cut(found.group(3), item["state"]["name"], 20)
        self.assertEqual(item["held_as"] == "step", found.group(4) is not None)
        steps = item["_steps"]
        following = re.search(
            r"Next condition (\d+\+?)/(\d+\+?): «([^»]*)»( \(to confirm\))?\.", line
        )
        unticked = [step for step in steps if not step["done"] or step.get(held.FLAG)]
        self.assertEqual(bool(unticked), following is not None, line)
        if following is None:
            self.assertIn(f"All {cap(len(steps))} condition" if steps else "No conditions.", line)
            return
        # A step a previous holder ticked is not counted as ticked.
        ticked = sum(1 for step in steps if step["done"] and not step.get(held.FLAG))
        self.assertEqual((cap(ticked), cap(len(steps))), following.group(1, 2))
        condition = item["next_condition"]
        self.check_cut(following.group(3), condition["text"], 72)
        self.assertEqual(condition["flagged"], following.group(4) is not None)

    def check_cut(self, shown: str, source: str, most: int) -> None:
        whole = " ".join(source.split())
        self.assertLessEqual(len(shown), most)
        if shown != whole:
            self.assertTrue(shown.endswith("…"), shown)
            self.assertTrue(whole.startswith(shown[:-1]), (shown, whole))

    def check_references(self, line: str, references: list[str]) -> None:
        listed = line.split(": ", 1)[1].removesuffix(".")
        more = re.fullmatch(r"(.*) and (\d+\+?) more", listed)
        if more is not None:
            names = more.group(1).split(", ")
            self.assertEqual(cap(len(references) - len(names)), more.group(2))
        else:
            names = listed.replace(" and ", ", ").split(", ")
            self.assertEqual(len(references), len(names))
        self.assertLessEqual(len(names), 3)
        self.assertEqual(references[: len(names)], names)

    # -- the inputs ----------------------------------------------------------

    def text(self, rng: random.Random) -> str:
        length = rng.choice((0, 1, rng.randint(0, 1000), 1000))
        return "".join(rng.choice(self.ALPHABET) for _ in range(length))

    def reference(self, rng: random.Random) -> str:
        key = rng.choice("ABCXYZ") + "".join(rng.choice("ABZ09") for _ in range(rng.randint(1, 7)))
        return f"{key}-{rng.randint(1, 999_999_999)}"

    def item(self, rng: random.Random, pool: list[str]) -> dict:
        count = rng.choice((0, 1, 5, rng.randint(0, 40), 1200))
        steps = []
        for _ in range(count):
            done = rng.random() < 0.5
            steps.append(
                {
                    "text": self.text(rng) if rng.random() < 0.2 else "step",
                    "done": done,
                    "claimed_by": "" if done or rng.random() < 0.7 else f"codex {self.SUFFIX}",
                    held.FLAG: done and rng.random() < 0.3,
                }
            )
        counts = (0, 1, rng.randint(0, 10**4), 10**4)
        goal = rng.choice((None, rng.choice(pool)))
        return entry(
            self.reference(rng),
            self.text(rng),
            state={**DEV, "name": self.text(rng)},
            held_as=rng.choice(("claim", "step")),
            steps={"done": sum(1 for s in steps if s["done"]), "total": len(steps)},
            next_condition=held.next_condition(steps, self.SUFFIX),
            pending_questions=rng.choice(counts),
            open_threads=rng.choice(counts),
            new_answers=rng.choice(counts),
            to_confirm=sum(1 for s in steps if s[held.FLAG]),
            goal=goal,
            stage=None if goal is None else rng.choice((None, rng.choice(pool))),
            _steps=steps,
        )


def cap(number: int) -> str:
    return "999+" if number > 999 else str(number)


class RecipientTests(unittest.TestCase):
    """Who is told what, from holds an agent takes through the tools."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "valkama.sqlite3")
        self.environ = {
            "VALKAMA_DB": self.path,
            "VALKAMA_PROTECTED_STORE": LIVE_STORE,
            "HOME": directory.name,
            "USERPROFILE": directory.name,
        }
        patch = mock.patch.dict(os.environ, self.environ)
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="note", name="Note", key="NT")
        self.conn.commit()

    def item(self, title: str, steps: tuple[str, ...] = ()) -> str:
        reference = str(service.create_work_item(self.conn, space="NT", title=title)["reference"])
        if steps:
            service.set_checklist(self.conn, reference, list(steps))
        self.conn.commit()
        return reference

    def claim(self, session: str, reference: str, thread: str | None = None) -> None:
        meta = {"sessionId": session, "threadId": thread or session}
        mcp_surface.call_tool(self.conn, "claim_work_item", {"id": reference}, meta=meta)
        self.conn.commit()

    def told(self, session: str, agent: str | None = None) -> str | None:
        payload = {"session_id": session, "source": "compact", "hook_event_name": "SessionStart"}
        if agent is not None:
            payload["agent_id"] = agent
        answer = held_note.answer(payload)
        if answer is None:
            return None
        return str(json.loads(answer)["hookSpecificOutput"]["additionalContext"])

    def test_recipient(self) -> None:
        mine = self.item("The session's own")
        self.claim(SESSION, mine)
        agents_own = self.item("The subagent's")
        self.claim(SESSION, agents_own, thread=CHILD)
        siblings_own = self.item("Another subagent's")
        self.claim(SESSION, siblings_own, thread=SIBLING)
        # A stranger's label in a step's text, on an item another session holds.
        named = self.item("Names a stranger", (f"ask codex (session {STRANGER})",))
        self.claim(OTHER, named)

        def references(text: str | None) -> set[str]:
            assert text is not None
            return set(re.findall(r"^- (\S+) ", text, re.MULTILINE))

        by_agent = self.told(SESSION, CHILD)
        self.assertEqual({agents_own}, references(by_agent))
        self.assertTrue(str(by_agent).startswith("Valkama now: this agent holds 1 open item:"))
        by_session = self.told(SESSION)
        self.assertEqual({mine, agents_own, siblings_own}, references(by_session))
        self.assertTrue(str(by_session).startswith("Valkama now: this session holds 3"))
        self.assertIsNone(self.told(STRANGER))
        self.assertEqual({named}, references(self.told(OTHER)))
        # Losses reach a subagent as they reach the session; requests reach only the session.
        items = held.held_for_note(self.conn, SESSION, CHILD)
        to_agent = str(held_note.compose(items, agent=True, lost=["NT-90"], waiting=["NT-91"]))
        self.assertIn("No longer held by you: NT-90.", to_agent)
        self.assertNotIn("Waiting for your answer", to_agent)
        items = held.held_for_note(self.conn, SESSION)
        to_session = str(held_note.compose(items, agent=False, lost=["NT-90"], waiting=["NT-91"]))
        self.assertIn("Waiting for your answer: NT-91.", to_session)

    def test_the_note_reads_the_store_without_writing_it(self) -> None:
        reference = self.item("Held", ("one", "two"))
        self.claim(SESSION, reference)
        # `data_version` moves when any other connection commits to the store.
        before = self.conn.execute("PRAGMA data_version").fetchone()[0]
        text = self.told(SESSION)
        self.assertEqual(
            "\n".join(
                (
                    "Valkama now: this session holds 1 open item:",
                    f"- {reference} «Held», Dev. Next condition 0/2: «one».",
                    RULE,
                )
            ),
            text,
        )
        self.assertEqual(before, self.conn.execute("PRAGMA data_version").fetchone()[0])


if __name__ == "__main__":
    unittest.main()
