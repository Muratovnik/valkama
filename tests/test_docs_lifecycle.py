"""Every document under docs/ declares its lifecycle, or the suite names it.

The convention comes from the workspace this repository sits in: working notes
belong in AgentMemory and card comments, and a file that graduates into
`docs/` is a canonical artifact that says what it is — a frontmatter header
naming a status and the cards whose work it belongs to. That header is what
lets the next reader tell an adopted contract from a superseded plan without
re-deriving either.

The parent workspace runs the same check over its own `docs/` only, so this
repository carries the rule itself: a nested Git root that leaves its gate to
the parent has no gate in a standalone checkout.
"""

from __future__ import annotations

import unittest
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
ROOT = DOCS.parent
STATUSES = ("draft", "adopted", "superseded")
# A README describes a directory rather than one piece of work, so it carries
# no lifecycle of its own.
EXEMPT_NAMES = {"README.md", "index.md"}
FENCE = "---"
# Frontmatter is a handful of lines; a fence that has not closed by here is a
# horizontal rule in prose, not an unterminated header.
MAX_FRONTMATTER_LINES = 20
PRODUCT_MODEL = DOCS / "product-model.md"
REQUIRED_PRODUCT_TERMS = (
    "Kernel",
    "Module",
    "View",
    "Adapter",
    "Service",
    "Connection",
    "Assignment",
    "Capability",
    "Projection",
    "Project",
    "PlanningSpace",
    "Workflow",
    "WorkItem",
    "Execution",
    "Session",
)
# Product-owned generation names that the current public contract must not
# publish. External protocol revisions and migration fixtures are deliberately
# outside this bounded list and the files scanned below.
OBSOLETE_PRODUCT_CONTRACT_NAMES = (
    "hub-modules-v2",
    "platform-modules",
    "project-board-binding-v1",
)


def frontmatter(text: str) -> dict[str, str] | None:
    """The leading fenced block as flat key/value pairs, None when absent."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != FENCE:
        return None
    fields: dict[str, str] = {}
    for line in lines[1 : MAX_FRONTMATTER_LINES + 1]:
        if line.strip() == FENCE:
            return fields
        key, separator, value = line.partition(":")
        if separator:
            fields[key.strip().lower()] = value.strip()
    return None  # an unterminated block is not frontmatter


def lifecycle_problem(text: str) -> str | None:
    """What keeps this document from being a canonical artifact, if anything."""
    fields = frontmatter(text)
    if fields is None:
        return "no lifecycle frontmatter (status, card)"
    status = fields.get("status", "")
    if status not in STATUSES:
        return f"status {status!r} is not one of {list(STATUSES)}"
    card = fields.get("card", "")
    if not card:
        return "no card reference"
    parts = card.split(",")
    if not all(part.strip().isdigit() for part in parts):
        return f"card reference {card!r} is not a list of card ids"
    return None


class DocsLifecycleTests(unittest.TestCase):
    def test_every_document_declares_status_and_cards(self) -> None:
        problems: list[str] = []
        for path in sorted(DOCS.rglob("*.md")):
            if path.name in EXEMPT_NAMES:
                continue
            problem = lifecycle_problem(path.read_text(encoding="utf-8"))
            if problem:
                problems.append(f"{path.relative_to(DOCS).as_posix()}: {problem}")
        self.assertEqual([], problems)

    def test_the_scanner_refuses_what_the_convention_refuses(self) -> None:
        refused = {
            "no header": "# Title\n",
            "unterminated fence": "---\nstatus: adopted\ncard: 1\n",
            "unknown status": "---\nstatus: final\ncard: 1\n---\n",
            "missing card": "---\nstatus: adopted\n---\n",
            "non-numeric card": "---\nstatus: adopted\ncard: soon\n---\n",
            "empty id in the list": "---\nstatus: adopted\ncard: 1,,2\n---\n",
        }
        for name, text in refused.items():
            with self.subTest(name):
                self.assertIsNotNone(lifecycle_problem(text))
        accepted = "---\nstatus: adopted\ncard: 147, 150\n---\n\n# Title\n"
        self.assertIsNone(lifecycle_problem(accepted))


class ProductModelDocsTests(unittest.TestCase):
    def test_product_model_is_adopted_for_core_001_and_defines_the_vocabulary(self) -> None:
        text = PRODUCT_MODEL.read_text(encoding="utf-8")
        self.assertIsNone(lifecycle_problem(text))
        fields = frontmatter(text)
        self.assertIsNotNone(fields)
        self.assertEqual("adopted", fields["status"])
        self.assertEqual("351", fields["card"])
        self.assertIn("<!-- kb:core-001-product-model -->", text)
        for term in REQUIRED_PRODUCT_TERMS:
            with self.subTest(term=term):
                self.assertIn(f"| {term} |", text)

    def test_product_model_keeps_the_load_bearing_distinctions_explicit(self) -> None:
        text = PRODUCT_MODEL.read_text(encoding="utf-8")
        normalized = " ".join(text.split())
        required_statements = (
            "| Owns a user domain and route | Yes | No | No |",
            "A Capability definition describes what a Module needs.",
            "A Connection describes one usable tool instance.",
            "An Assignment chooses Connection references for a Capability.",
            "A WorkItem expresses intent, an Execution records one attempt",
            "project override, then installation default, then",
            "a typed unavailable result",
        )
        for statement in required_statements:
            with self.subTest(statement=statement):
                self.assertIn(statement, normalized)

    def test_current_product_copy_is_not_board_first(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        introduction = readme.split("## What it does", 1)[0].lower()
        self.assertIn("modular control surface", introduction)
        self.assertIn("planning", introduction)
        self.assertNotIn("kanban board", introduction)
        self.assertNotIn("board attached", introduction)

        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        added = changelog.split("### Added", 1)[1]
        first_bullet = next(line for line in added.splitlines() if line.startswith("- **"))
        self.assertIn("modular control surface", first_bullet.lower())
        self.assertNotIn("kanban board", first_bullet.lower())

    def test_current_public_contracts_do_not_publish_obsolete_product_names(self) -> None:
        current_contracts = (
            ROOT / "README.md",
            PRODUCT_MODEL,
            DOCS / "platform-contract.md",
            DOCS / "improvements-contract.md",
        )
        for path in current_contracts:
            text = path.read_text(encoding="utf-8")
            for obsolete in OBSOLETE_PRODUCT_CONTRACT_NAMES:
                with self.subTest(path=path.name, obsolete=obsolete):
                    self.assertNotIn(obsolete, text)


if __name__ == "__main__":
    unittest.main()
