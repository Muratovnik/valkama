"""Every document under docs/ declares its lifecycle, or the suite names it.

A file that graduates into `docs/` is a canonical artifact that says what it
is: a frontmatter header naming a status. That header is what lets the next
reader tell an adopted contract from a superseded plan without re-deriving
either. The header names no planning items: a `card:` field, or any other field
starting with `card`, is refused, because a public repository carries no
reference to its owner's planning.

This repository carries the rule itself, so a standalone checkout has its own
gate.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path, PurePosixPath, PureWindowsPath

DOCS = Path(__file__).resolve().parent.parent / "docs"
ROOT = DOCS.parent
STATUSES = ("draft", "adopted", "superseded")
# Planning card ids are not a document's business: any frontmatter key that
# starts with this prefix is refused, so the field cannot come back under a new
# spelling such as `cards:`.
RETIRED_FIELD_PREFIX = "card"
# A README describes a directory rather than one piece of work, so it carries
# no lifecycle of its own.
EXEMPT_NAMES = {"README.md", "index.md"}
# A guide describes how to use the product as it is now, and changes with it
# the way the README does, rather than belonging to one piece of work.
GUIDES = DOCS / "guides"
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
PUBLIC_DOCS = (
    ROOT / "README.md",
    ROOT / "SERVICE.md",
    ROOT / "CONTRIBUTING.md",
    ROOT / "CHANGELOG.md",
    ROOT / "DESIGN.md",
    *sorted(DOCS.rglob("*.md")),
)
DIRECT_PYTHON_TARGET = re.compile(
    r"(?m)^\s*python\s+[\"']?(?!-m\b)([^\s\"']+\.py)(?=[\"']?(?:\s|$))"
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
        return "no lifecycle frontmatter (status)"
    status = fields.get("status", "")
    if status not in STATUSES:
        return f"status {status!r} is not one of {list(STATUSES)}"
    retired = sorted(key for key in fields if key.startswith(RETIRED_FIELD_PREFIX))
    if retired:
        return f"retired field(s) {retired}: a document names no planning card"
    return None


class DocsLifecycleTests(unittest.TestCase):
    def test_every_document_declares_status(self) -> None:
        problems: list[str] = []
        for path in sorted(DOCS.rglob("*.md")):
            if path.name in EXEMPT_NAMES or path.is_relative_to(GUIDES):
                continue
            problem = lifecycle_problem(path.read_text(encoding="utf-8"))
            if problem:
                problems.append(f"{path.relative_to(DOCS).as_posix()}: {problem}")
        self.assertEqual([], problems)

    def test_the_scanner_refuses_what_the_convention_refuses(self) -> None:
        refused = {
            "no header": "# Title\n",
            "unterminated fence": "---\nstatus: adopted\n",
            "unknown status": "---\nstatus: final\n---\n",
            "missing status": "---\ntitle: Title\n---\n",
            "card field": "---\nstatus: adopted\ncard: 1\n---\n",
            "card field under another spelling": "---\nstatus: adopted\ncards: 1, 2\n---\n",
            "card field in capitals": "---\nstatus: adopted\nCard: 1\n---\n",
        }
        for name, text in refused.items():
            with self.subTest(name):
                self.assertIsNotNone(lifecycle_problem(text))
        accepted = "---\nstatus: adopted\n---\n\n# Title\n"
        self.assertIsNone(lifecycle_problem(accepted))

    def test_direct_python_commands_reference_existing_repository_files(self) -> None:
        problems: list[str] = []
        for document in PUBLIC_DOCS:
            text = document.read_text(encoding="utf-8")
            for match in DIRECT_PYTHON_TARGET.finditer(text):
                raw = match.group(1)
                if "$" in raw or "%" in raw:
                    continue
                if (
                    Path(raw).is_absolute()
                    or PurePosixPath(raw).is_absolute()
                    or PureWindowsPath(raw).is_absolute()
                ):
                    continue
                relative = raw.replace("\\", "/")
                while relative.startswith("./"):
                    relative = relative[2:]
                target = ROOT / relative
                if not target.is_file():
                    problems.append(
                        f"{document.relative_to(ROOT).as_posix()}: missing python target {raw}"
                    )
        self.assertEqual([], problems)


class ProductModelDocsTests(unittest.TestCase):
    def test_product_model_is_adopted_and_defines_the_vocabulary(self) -> None:
        text = PRODUCT_MODEL.read_text(encoding="utf-8")
        self.assertIsNone(lifecycle_problem(text))
        fields = frontmatter(text)
        self.assertIsNotNone(fields)
        self.assertEqual("adopted", fields["status"])
        for term in REQUIRED_PRODUCT_TERMS:
            with self.subTest(term=term):
                self.assertIn(f"| {term} |", text)

    def test_product_model_keeps_the_load_bearing_distinctions_explicit(self) -> None:
        text = PRODUCT_MODEL.read_text(encoding="utf-8")
        normalized = " ".join(text.split())
        required_statements = (
            "| Owns a user domain and route | Yes | No | No |",
            "An adapter manifest names the adapter and the Capabilities it answers;",
            "Declaring an adapter enables nothing and authorizes nothing.",
            "A WorkItem expresses intent, an Execution records one attempt",
            "a typed unavailable result",
        )
        for statement in required_statements:
            with self.subTest(statement=statement):
                self.assertIn(statement, normalized)

    def test_current_public_contracts_do_not_publish_obsolete_product_names(self) -> None:
        current_contracts = (
            ROOT / "README.md",
            PRODUCT_MODEL,
            DOCS / "platform-contract.md",
            DOCS / "improvements-contract.md",
            *sorted(GUIDES.glob("*.md")),
        )
        for path in current_contracts:
            text = path.read_text(encoding="utf-8")
            for obsolete in OBSOLETE_PRODUCT_CONTRACT_NAMES:
                with self.subTest(path=path.name, obsolete=obsolete):
                    self.assertNotIn(obsolete, text)

    def test_retired_contracts_are_marked_superseded(self) -> None:
        for name in ("improvements-contract.md", "session-event-contract.md"):
            with self.subTest(name=name):
                text = (DOCS / name).read_text(encoding="utf-8")
                self.assertIsNone(lifecycle_problem(text))
                self.assertEqual("superseded", frontmatter(text)["status"])


if __name__ == "__main__":
    unittest.main()
