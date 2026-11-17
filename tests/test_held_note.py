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
from server.planning import held, item_projects, service
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_entry, registry_bytes

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
        "roots": [],
        "last_write": None,
    }
    item.update(facts)
    return item


#: A folder of no real disk the roots below stand in; the note only compares paths.
BASE = os.path.join(os.path.abspath(os.sep), "work")


def mapped(*parts: str, project: str = "alpha") -> dict:
    """One `project_roots` entry whose directory is there, at `BASE` and `parts`."""

    return {
        "project_id": project,
        "display_name": project.title(),
        "root": os.path.join(BASE, *parts),
        "status": "mapped",
    }


def not_mapped(project: str, status: str) -> dict:
    """One `project_roots` entry as it stands when its root is not there to work in.

    A `missing` one keeps the root the registry records, which is gone from the disk;
    an `unregistered` or `unavailable` one knows no root.
    """

    if status == "missing":
        return {**mapped(project, project=project), "status": status}
    return {"project_id": project, "display_name": None, "root": None, "status": status}


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


class RootLineTests(unittest.TestCase):
    """Where the held items are: each one's first root, from the session's folder."""

    CWD = os.path.join(BASE, "here")

    def lines(self, *items: dict, cwd: str | None = CWD, **told: list[str]) -> list[str]:
        return str(held_note.compose(list(items), agent=False, cwd=cwd, **told)).splitlines()

    def test_a_root_stands_relative_to_the_session_folder(self) -> None:
        item = entry("MAIN-1", "Held", roots=[mapped("main")])
        self.assertEqual("- MAIN-1 «Held», Dev. No conditions. Root ../main.", self.lines(item)[1])
        inside = entry("MAIN-1", "Held", roots=[mapped("here", "inner", "part")])
        self.assertEqual(
            "- MAIN-1 «Held», Dev. No conditions. Root inner/part.", self.lines(inside)[1]
        )
        # Without a folder no way leads from it: the root is named as the registry has it.
        whole = mapped("main")["root"].replace(os.sep, "/")
        self.assertEqual(
            f"- MAIN-1 «Held», Dev. No conditions. Root {whole}.", self.lines(item, cwd=None)[1]
        )

    def test_the_session_folder_as_root_is_not_named(self) -> None:
        here = entry("MAIN-1", "Held", roots=[mapped("here")])
        self.assertEqual("- MAIN-1 «Held», Dev. No conditions.", self.lines(here)[1])
        # The folder as written another way is the same folder.
        spelled = os.path.join(BASE, "here", "inner", os.pardir) + os.sep
        self.assertEqual("- MAIN-1 «Held», Dev. No conditions.", self.lines(here, cwd=spelled)[1])
        # Nor does a shared line name it.
        self.assertEqual(
            ["- MAIN-1 «Held», Dev. No conditions.", "- MAIN-2 «Too», Dev. No conditions."],
            self.lines(here, {**here, "reference": "MAIN-2", "title": "Too"})[1:3],
        )

    def test_a_shared_root_is_one_line_after_the_items(self) -> None:
        roots = [mapped("main"), mapped("side", project="beta")]
        lines = self.lines(
            entry("MAIN-1", "One", roots=roots),
            entry("MAIN-2", "Two", roots=roots),
            lost=["MAIN-7"],
        )
        self.assertEqual(
            [
                "- MAIN-1 «One», Dev. No conditions.",
                "- MAIN-2 «Two», Dev. No conditions.",
                "Root of these items: ../main (+1).",
                "No longer held by you: MAIN-7.",
                RULE,
            ],
            lines[1:],
        )

    def test_different_roots_stand_in_each_items_line(self) -> None:
        lines = self.lines(
            entry("MAIN-1", "One", roots=[mapped("main"), mapped("side", project="beta")]),
            entry("MAIN-2", "Two", roots=[mapped("main")]),
            entry("MAIN-3", "Three"),
        )
        self.assertEqual(
            [
                "- MAIN-1 «One», Dev. No conditions. Root ../main (+1).",
                "- MAIN-2 «Two», Dev. No conditions. Root ../main.",
                "- MAIN-3 «Three», Dev. No conditions.",
                RULE,
            ],
            lines[1:],
        )

    def test_the_first_root_is_named_and_the_others_counted(self) -> None:
        roots = [mapped("zeta", project="zeta"), *[mapped(f"p{n}") for n in range(1200)]]
        line = self.lines(entry("MAIN-1", "Held", roots=roots))[1]
        self.assertTrue(line.endswith(" Root ../zeta (+999+)."), line)

    def test_an_item_without_projects_has_no_root(self) -> None:
        self.assertEqual(
            "- MAIN-1 «Held», Dev. No conditions.", self.lines(entry("MAIN-1", "Held"))[1]
        )

    def test_a_root_not_mapped_is_named_by_its_project(self) -> None:
        for status in ("missing", "unregistered", "unavailable"):
            with self.subTest(status=status):
                line = self.lines(entry("MAIN-1", "Held", roots=[not_mapped("alpha", status)]))[1]
                self.assertTrue(line.endswith(f" Root alpha ({status})."), line)
        root = not_mapped("a" * 100, "missing")
        line = self.lines(entry("MAIN-1", "Held", roots=[root, root]))[1]
        self.assertTrue(line.endswith(f" Root {'a' * 29}… (missing) (+1)."), line)

    def test_a_long_root_is_cut_from_the_left_at_a_separator(self) -> None:
        deep = mapped("here", "a-rather-long-folder", "and-another-one", "the-last")
        line = self.lines(entry("MAIN-1", "Held", roots=[deep]))[1]
        self.assertTrue(line.endswith(" Root …/and-another-one/the-last."), line)
        # A last part longer than the bound keeps its end.
        single = mapped("here", "x" * 30 + "y" * 30)
        line = self.lines(entry("MAIN-1", "Held", roots=[single]))[1]
        self.assertTrue(line.endswith(f" Root …{'x' * 9}{'y' * 30}."), line)


class PropertyTests(unittest.TestCase):
    """The bound and the shape on random inputs."""

    ALPHABET = "abcz ABZ абя 019\t\n!?;:-()/…"
    SUFFIX = "(session S)"
    #: What a folder's name is made of here: no separator, no dot, no space, and
    #: nothing that spells `Root`, so a path is read back from the note as written.
    FOLDER_ALPHABET = "abzAB019-_"
    #: Where the session runs, against the roots under `BASE`; `same` is the first root.
    FOLDERS = ("base", "elsewhere", "none", "same")

    def test_note_fits_by_construction(self) -> None:
        rng = random.Random(20261116)  # noqa: S311 - made-up inputs, not a secret
        pool = [self.reference(rng) for _ in range(10**4)]
        # Every field at its bound at once: the longest reference, title, state and
        # flagged condition, every count past 999, a root of 10^3 characters with
        # 10^4 more behind it, and the longest header.
        longest = "ABCDEFGH-123456789"
        steps = [{"text": "x" * 1000, "done": True, "claimed_by": "", held.FLAG: True}] * 1200
        far = self.root_at(["d" * 110] * 9)
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
            roots=[far] * (10**4 + 1),
            _steps=steps,
        )
        references = [longest] * 10**4
        text = held_note.compose(
            [extreme] * 10**4,
            agent=False,
            cwd=self.folder("elsewhere", far),
            lost=references,
            waiting=references,
        )
        assert text is not None
        self.check(text, [extreme] * 10**4, False, references, references, "elsewhere")
        for case in range(400):
            with self.subTest(case=case):
                held_count = rng.choice((1, 2, 3, 4, rng.randint(5, 10**4), 10**4))
                shown_items = [self.item(rng, pool) for _ in range(min(held_count, 4))]
                where = rng.choice(self.FOLDERS)
                if where == "same" or rng.random() < 0.3:
                    # Every item with the first one's roots: the note names them once.
                    roots = shown_items[0]["roots"] or [self.root(rng, mapped_only=True)]
                    if where == "same":
                        roots = [self.root(rng, mapped_only=True), *roots[1:]]
                    for item in shown_items:
                        item["roots"] = roots
                items = shown_items + [shown_items[-1]] * (held_count - len(shown_items))
                agent = rng.random() < 0.3
                lost = pool[: rng.choice((0, 1, 2, 3, 4, rng.randint(0, 10**4), 10**4))]
                waiting = pool[: rng.choice((0, 1, 3, 4, rng.randint(0, 10**4), 10**4))]
                cwd = self.folder(where, items[0]["roots"][0] if items[0]["roots"] else None)
                text = held_note.compose(items, agent=agent, cwd=cwd, lost=lost, waiting=waiting)
                assert text is not None
                self.check(text, items, agent, lost, waiting, where)

    def check(
        self,
        text: str,
        items: list[dict],
        agent: bool,
        lost: list[str],
        waiting: list[str],
        where: str,
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
        rest = lines[1 + len(tasks) : -1]
        shared = None
        if rest and rest[0].startswith("Root of these items: "):
            shared = rest.pop(0).removeprefix("Root of these items: ").removesuffix(".")
        roots = []
        for line, item in zip(tasks, items, strict=False):
            roots.append(self.check_task(line, item))
            self.check_root(shared or roots[-1], item["roots"], where)
        if shared is None:
            # Items that would all name one root name it in the shared line instead.
            self.assertFalse(len(tasks) > 1 and roots[0] and len(set(roots)) == 1, roots)
        else:
            self.assertGreater(len(tasks), 1)
            self.assertEqual([None] * len(tasks), roots)
        expected_leads = ["No longer held by you"] * bool(lost)
        expected_leads += ["Waiting for your answer"] * bool(waiting and not agent)
        self.assertEqual(expected_leads, [line.split(":")[0] for line in rest])
        for line, references in zip(rest, [r for r in (lost, waiting) if r], strict=False):
            self.check_references(line, references)

    def check_task(self, line: str, item: dict) -> str | None:
        """Check one item's line, and give the root it names, if any."""

        found = re.match(r"- (\S+) «([^»]*)», ([^,.]*)(, held by a condition)?\. ", line)
        assert found is not None, line
        self.assertEqual(item["reference"], found.group(1))
        self.check_cut(found.group(2), item["title"], 60)
        self.check_cut(found.group(3), item["state"]["name"], 20)
        self.assertEqual(item["held_as"] == "step", found.group(4) is not None)
        root = re.search(r"\. Root (.*)\.$", line)
        steps = item["_steps"]
        following = re.search(
            r"Next condition (\d+\+?)/(\d+\+?): «([^»]*)»( \(to confirm\))?\.", line
        )
        unticked = [step for step in steps if not step["done"] or step.get(held.FLAG)]
        self.assertEqual(bool(unticked), following is not None, line)
        if following is None:
            self.assertIn(f"All {cap(len(steps))} condition" if steps else "No conditions.", line)
        else:
            # A step a previous holder ticked is not counted as ticked.
            ticked = sum(1 for step in steps if step["done"] and not step.get(held.FLAG))
            self.assertEqual((cap(ticked), cap(len(steps))), following.group(1, 2))
            condition = item["next_condition"]
            self.check_cut(following.group(3), condition["text"], 72)
            self.assertEqual(condition["flagged"], following.group(4) is not None)
        # The steps a previous holder ticked are counted apart, as steps to confirm.
        confirm = re.search(r"(?:\. |; )(\d+\+?) to confirm[.;]", line)
        self.assertEqual(bool(item["to_confirm"]), confirm is not None, line)
        if confirm is not None:
            self.assertEqual(cap(item["to_confirm"]), confirm.group(1))
        return None if root is None else root.group(1)

    def check_root(self, shown: str | None, roots: list[dict], where: str) -> None:
        """The first root, from the session's folder, cut to 40, and how many follow."""

        if shown is None:
            self.assertTrue(not roots or (where == "same" and roots[0]["status"] == "mapped"))
            return
        self.assertTrue(roots)
        self.assertNotEqual("same", where)
        self.assertLessEqual(len(shown), 48)
        others = re.fullmatch(r"(.*) \(\+(\d+\+?)\)", shown)
        self.assertEqual(len(roots) > 1, others is not None, shown)
        if others is not None:
            self.assertEqual(cap(len(roots) - 1), others.group(2))
            shown = others.group(1)
        self.assertLessEqual(len(shown), 40)
        first = roots[0]
        if first["status"] != "mapped":
            self.assertTrue(shown.endswith(f" ({first['status']})"), shown)
            mark = len(first["status"]) + 3
            self.check_cut(shown[:-mark], first["project_id"], 40 - mark)
            return
        parts = first["_parts"]
        whole = {
            "base": "/".join(parts),
            "elsewhere": "/".join(("..", *parts)),
            "none": first["root"].replace(os.sep, "/"),
        }[where]
        if shown == whole:
            return
        # Cut from the left: at a separator, keeping every whole part that fits, or
        # inside a last part that alone is longer than the bound.
        self.assertTrue(shown.startswith("…") and whole.endswith(shown[1:]), (shown, whole))
        if shown.startswith("…/"):
            kept = shown[2:].split("/")
            dropped = whole.split("/")[-len(kept) - 1]
            self.assertGreater(len(shown) + len(dropped) + 1, 40, (shown, whole))
        else:
            self.assertGreater(len(whole.split("/")[-1]), 38, (shown, whole))
            self.assertEqual(40, len(shown))

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

    def root_at(self, parts: list[str]) -> dict:
        return {**mapped(*parts), "_parts": parts}

    def root(self, rng: random.Random, *, mapped_only: bool = False) -> dict:
        """One root of up to 10^3 characters under `BASE`, or a project not mapped."""

        statuses = ("mapped",) if mapped_only else ("mapped", "mapped", "missing", "unavailable")
        status = rng.choice(statuses)
        length = rng.choice((1, rng.randint(1, 1000), 1000))
        name = "".join(rng.choice(self.FOLDER_ALPHABET) for _ in range(length))
        if status != "mapped":
            return not_mapped(name, status)
        parts: list[str] = []
        while sum(len(part) + 1 for part in parts) < length:
            parts.append(name[: rng.choice((1, rng.randint(1, 60), rng.randint(1, length)))])
        return self.root_at(parts)

    def folder(self, where: str, first: dict | None) -> str | None:
        if where == "same" and first is not None and first["status"] == "mapped":
            # The same folder, written with a separator after it.
            return str(first["root"]) + os.sep
        return {"base": BASE, "elsewhere": os.path.join(BASE, "elsewhere")}.get(where)

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
        first = self.root(rng)
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
            roots=[first] * rng.choice((0, 1, 2, rng.randint(0, 40), 10**4)),
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
            # No registry there: no item has a root, and the live one is never read.
            "LOCALAPPDATA": os.path.join(directory.name, "local"),
        }
        patch = mock.patch.dict(os.environ, self.environ)
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Note", key="NT")
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

    def test_each_recipient_is_told_its_own_losses(self) -> None:
        mine = self.item("The session's own")
        self.claim(SESSION, mine)
        agents_own = self.item("The subagent's")
        self.claim(SESSION, agents_own, thread=CHILD)
        theirs = self.item("Another session's")
        self.claim(OTHER, theirs)
        for session in (SESSION, OTHER):
            self.conn.execute(
                "UPDATE sessions SET status = 'ended',"
                " ended_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-13 hours') WHERE id = ?",
                (session,),
            )
        self.assertEqual(3, service.expire_leases(self.conn))
        self.conn.commit()

        def lost(text: str | None) -> str:
            assert text is not None
            return text.splitlines()[1]

        self.assertEqual(f"No longer held by you: {agents_own}.", lost(self.told(SESSION, CHILD)))
        self.assertEqual(
            f"No longer held by you: {agents_own} and {mine}.", lost(self.told(SESSION))
        )
        self.assertEqual(f"No longer held by you: {theirs}.", lost(self.told(OTHER)))
        self.assertIsNone(self.told(SESSION, SIBLING))
        self.assertIsNone(self.told(STRANGER))

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

    def test_the_roots_are_those_a_claim_names(self) -> None:
        # NT binds `zeta`, its default, and `alpha`; BR binds none.
        base = os.path.dirname(self.path)
        scope = str(read_store_metadata(self.conn)["data_scope_id"])
        space = planning_space_entity({"data_scope_id": scope, "space_key": "NT"})
        entries = []
        for project, default in (("zeta", True), ("alpha", False)):
            os.makedirs(os.path.join(base, project))
            entry_ = project_entry(project, os.path.join(base, project))
            entry_["planning_binding"] = {**space, "default": default}
            entries.append(entry_)
        registry = os.path.join(self.environ["LOCALAPPDATA"], "Valkama", "projects.json")
        os.makedirs(os.path.dirname(registry))
        with open(registry, "wb") as handle:
            handle.write(registry_bytes(entries))
        service.create_planning_space(self.conn, name="Bare", key="BR")
        both = self.item("Changes both")
        service.update_work_item(self.conn, both, projects=["alpha", "zeta"])
        bare = str(service.create_work_item(self.conn, space="BR", title="Bare")["reference"])
        self.conn.commit()
        self.claim(SESSION, both)
        self.claim(SESSION, bare)

        found = {item["reference"]: item for item in held.held_for_note(self.conn, SESSION)}
        identity = str(service.get_work_item(self.conn, both)["work_item_id"])
        self.assertEqual(item_projects.project_roots(self.conn, identity), found[both]["roots"])
        self.assertEqual(["zeta", "alpha"], [r["project_id"] for r in found[both]["roots"]])
        self.assertEqual([], found[bare]["roots"])

        payload = {
            "session_id": SESSION,
            "source": "resume",
            "hook_event_name": "SessionStart",
            "cwd": os.path.join(base, "alpha"),
        }
        answer = held_note.answer(payload)
        assert answer is not None
        lines = str(json.loads(answer)["hookSpecificOutput"]["additionalContext"]).splitlines()
        tasks = {line.split(" ")[1]: line for line in lines if line.startswith("- ")}
        # The default project's root comes first, though `alpha` sorts before it.
        self.assertTrue(tasks[both].endswith(" Root ../zeta (+1)."), tasks[both])
        self.assertNotIn("Root", tasks[bare])
        # Run in that root, the session is told no root at all.
        answer = held_note.answer({**payload, "cwd": os.path.join(base, "zeta")})
        assert answer is not None
        self.assertNotIn("Root", json.loads(answer)["hookSpecificOutput"]["additionalContext"])


if __name__ == "__main__":
    unittest.main()
