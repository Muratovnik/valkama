"""The public documents describe the work model in the words it ships.

Valkama 3.0 retired `epic` as a kind and a scope, `backlog` and `queued` as
categories, the state key `todo` and the service word `container`; the list is
`model.RETIRED_WORDS`, which every refusal reads. A document that describes what
this build does must not teach one of them as current behaviour, or a reader
sends the word the server refuses.

Read: the README, SERVICE, CONTRIBUTING and DESIGN at the root, the contracts
directly under `docs/` and the guides in `docs/guides/`. Not read: the changelog,
which is history, and `docs/decisions/`, which records decisions as they were
taken, the one that retires these words among them.

A read document may still name a retired word where it says so, and only by one
of these rules, each written below with its reason:

- a document whose lifecycle is `superseded` records an earlier contract;
- a section whose heading is listed in `RETIRED_SECTIONS` names the words as
  retired;
- a passage listed in `ALLOWED_PASSAGES` is quoted as it stands on one line, and
  covers only the words inside the quote. A passage rewritten so that the quote
  no longer matches loses its allowance, and an allowance that covers nothing
  fails here;
- a word listed for a document in `OTHER_MEANINGS` means something else there
  throughout.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path
from typing import NamedTuple

from server.planning import model
from tests.test_docs_lifecycle import DOCS, ROOT, frontmatter

#: The documents that describe current behaviour.
GUARDED = (
    ROOT / "README.md",
    ROOT / "SERVICE.md",
    ROOT / "CONTRIBUTING.md",
    ROOT / "DESIGN.md",
    *sorted(DOCS.glob("*.md")),
    *sorted((DOCS / "guides").glob("*.md")),
)

#: Every word the model refuses, from the one list, read as a word of its own and
#: in the plural: `container_state` is not `container`, `epics` is `epic`.
WORDS = sorted({word for words in model.RETIRED_WORDS.values() for word in words})
RETIRED_WORD = re.compile(r"\b(?:" + "|".join(WORDS) + r")s?\b", re.IGNORECASE)

#: Sections that name the words as retired, by document and heading.
RETIRED_SECTIONS: dict[str, frozenset[str]] = {
    # The table of what each refusal says.
    "docs/connection-contract.md": frozenset({"Retired words"}),
}


class Allowed(NamedTuple):
    document: str
    passage: str
    why: str


ALLOWED_PASSAGES = (
    Allowed(
        "docs/connection-contract.md",
        "A record carries no `container`",
        "names the record field 3.0 removed",
    ),
    Allowed(
        "docs/connection-contract.md",
        "`epic` names `tree` in its refusal",
        "names the retired scope by what its refusal says",
    ),
    Allowed(
        "docs/product-model.md",
        "runtime container",
        "a provider's runtime, not a word of the work model",
    ),
    Allowed(
        "DESIGN.md",
        "an epic loot's purple",
        "the purple of an epic item in games, which the goal colour starts from",
    ),
    Allowed(
        "DESIGN.md",
        "how `todo` came to have a dot",
        "the history of a defect, in a state key of the earlier workflow",
    ),
)

#: Words that mean something else in a document wherever they stand there.
OTHER_MEANINGS: dict[str, frozenset[str]] = {
    # The CSS box, container queries, and the token a goal's and a stage's colour is.
    "DESIGN.md": frozenset({"container"}),
}

HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
FENCE = re.compile(r"^\s*(```|~~~)")


class Hit(NamedTuple):
    line: int
    word: str
    allowed_by: Allowed | None


def hits(document: str, text: str) -> list[Hit]:
    """Each retired word the text names outside a retired section, and what allows it."""

    if (frontmatter(text) or {}).get("status") == "superseded":
        return []
    sections = RETIRED_SECTIONS.get(document, frozenset())
    elsewhere = OTHER_MEANINGS.get(document, frozenset())
    passages = [allowed for allowed in ALLOWED_PASSAGES if allowed.document == document]
    found: list[Hit] = []
    headings: list[tuple[int, str]] = []
    fenced = False
    for number, line in enumerate(text.splitlines(), start=1):
        if FENCE.match(line):
            fenced = not fenced
        heading = None if fenced else HEADING.match(line)
        if heading is not None:
            level = len(heading.group(1))
            headings = [(depth, title) for depth, title in headings if depth < level]
            headings.append((level, heading.group(2)))
        if any(title in sections for _depth, title in headings):
            continue
        for match in RETIRED_WORD.finditer(line):
            word = match.group(0).lower().removesuffix("s")
            if word in elsewhere:
                continue
            allowing = next(
                (
                    allowed
                    for allowed in passages
                    for quoted in re.finditer(re.escape(allowed.passage), line)
                    if quoted.start() <= match.start() and match.end() <= quoted.end()
                ),
                None,
            )
            found.append(Hit(number, match.group(0), allowing))
    return found


def offences(document: str, text: str) -> list[str]:
    return [
        f"{document}:{hit.line}: {hit.word}"
        for hit in hits(document, text)
        if hit.allowed_by is None
    ]


def name(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


class PublicDocumentsTests(unittest.TestCase):
    def test_no_public_document_names_a_retired_word_as_current_behaviour(self) -> None:
        found = [
            offence
            for path in GUARDED
            for offence in offences(name(path), path.read_text(encoding="utf-8"))
        ]
        self.assertEqual([], found, "a retired word describes current behaviour")

    def test_every_allowance_covers_a_word_it_was_written_for(self) -> None:
        used = {
            hit.allowed_by
            for path in GUARDED
            for hit in hits(name(path), path.read_text(encoding="utf-8"))
        }
        for allowed in ALLOWED_PASSAGES:
            with self.subTest(document=allowed.document, passage=allowed.passage):
                self.assertIn(
                    allowed, used, f"no retired word left for the allowance: {allowed.why}"
                )
        read = {name(path) for path in GUARDED}
        listed = {*RETIRED_SECTIONS, *OTHER_MEANINGS, *(a.document for a in ALLOWED_PASSAGES)}
        self.assertEqual(set(), listed - read, "a rule for a document that is not read")

    def test_the_words_are_the_ones_the_model_refuses(self) -> None:
        for word in ("epic", "backlog", "queued", "todo", "container"):
            with self.subTest(word=word):
                self.assertIn(word, WORDS)
                self.assertRegex(f"an {word.upper()}s list", RETIRED_WORD)
        self.assertNotRegex("container_state and epicentre", RETIRED_WORD)


class TheRulesAreNarrowTests(unittest.TestCase):
    """The guard turns red for a word put back, and each rule allows only its own."""

    def setUp(self) -> None:
        self.readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.contract = (DOCS / "connection-contract.md").read_text(encoding="utf-8")

    def test_a_word_put_back_into_the_readme_is_named_by_file_and_line(self) -> None:
        lines = self.readme.splitlines()
        at = lines.index("## What you can do") + 1
        put_back = f"README.md:{at + 1}: epic"
        self.assertNotIn(put_back, offences("README.md", self.readme))
        lines.insert(at, "Each epic is a lane.")
        self.assertIn(put_back, offences("README.md", "\n".join(lines)))

    def test_the_retired_section_allows_its_words_and_the_next_section_none(self) -> None:
        lines = self.contract.splitlines()
        inside = lines.index("#### Retired words") + 1
        after = lines.index("### Naming a state") + 1
        lines.insert(after, "A backlog item is listed.")
        lines.insert(inside, "A backlog item is refused.")
        offended = offences("docs/connection-contract.md", "\n".join(lines))
        self.assertEqual([f"docs/connection-contract.md:{after + 2}: backlog"], offended)

    def test_a_passage_allows_only_the_word_inside_its_quote(self) -> None:
        line = "A record carries no `container` field; queued work waits."
        self.assertEqual(
            ["docs/connection-contract.md:1: queued"],
            offences("docs/connection-contract.md", line),
        )
        self.assertEqual(
            ["README.md:1: container", "README.md:1: queued"], offences("README.md", line)
        )

    def test_a_superseded_document_records_history(self) -> None:
        history = "---\nstatus: superseded\n---\n\nAn epic held cards.\n"
        current = history.replace("superseded", "adopted")
        self.assertEqual([], offences("docs/x.md", history))
        self.assertEqual(["docs/x.md:5: epic"], offences("docs/x.md", current))

    def test_a_heading_inside_a_code_fence_opens_no_section(self) -> None:
        text = "```\n#### Retired words\n```\nThe epic.\n"
        self.assertEqual(
            ["docs/connection-contract.md:4: epic"],
            offences("docs/connection-contract.md", text),
        )


if __name__ == "__main__":
    unittest.main()
