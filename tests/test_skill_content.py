"""The skill Valkama ships: a valid skill, about tools that exist, and fit to publish.

Two clients read it, so its frontmatter keeps to the fields both understand: the
Agent Skills specification's `name`, which must match the directory, and a
`description` of at most 1024 characters on one line, which Codex collapses
anyway. It names tools an agent will call, so every tool it names has to be one
this build publishes; a renamed tool would otherwise leave agents calling a
name that no longer answers. And it is published with the repository, so it
carries no private planning references or paths.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from server.ops import skills
from server.planning import tools

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT.joinpath(*skills.SOURCE_PARTS)
NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
#: A planning tool's name: a verb, then what it acts on.
TOOL = re.compile(
    r"`((?:list|get|create|update|delete|transition|claim|set|tick|link|merge|attach|report"
    r"|select|comment|apply|answer|decline|expire|search)_[a-z_]*"
    r"(?:work_item|planning_space)[a-z_]*)`"
)
LINK = re.compile(r"\]\(([^)#\s]+)(?:#[^)]*)?\)")
#: What a public document must not carry: private planning keys, a person's
#: paths, and attribution to a tool.
PRIVATE = (
    re.compile(r"\b(?:AW|VAL)-\d+\b"),
    re.compile(r"workbench", re.IGNORECASE),
    re.compile(r"[A-Za-z]:[\\/]Users[\\/]", re.IGNORECASE),
    re.compile(r"co-authored-by|generated with", re.IGNORECASE),
)


def frontmatter(text: str) -> tuple[dict[str, str], str]:
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise AssertionError("SKILL.md does not start with frontmatter")
    end = lines.index("---", 1)
    fields = {}
    for line in lines[1:end]:
        key, separator, value = line.partition(":")
        if not separator or not key or key != key.strip():
            raise AssertionError(f"not a flat frontmatter field: {line!r}")
        fields[key] = value.strip()
    return fields, "\n".join(lines[end + 1 :])


class SkillContentTests(unittest.TestCase):
    def documents(self) -> dict[Path, str]:
        return {path: path.read_text(encoding="utf-8") for path in sorted(SKILL.rglob("*.md"))}

    def test_the_frontmatter_is_one_both_clients_read(self) -> None:
        fields, body = frontmatter((SKILL / "SKILL.md").read_text(encoding="utf-8"))
        self.assertEqual({"name", "description"}, set(fields))
        self.assertEqual(SKILL.name, fields["name"])
        self.assertRegex(fields["name"], NAME)
        self.assertLessEqual(len(fields["name"]), 64)
        self.assertTrue(fields["description"])
        self.assertLessEqual(len(fields["description"]), 1024)
        # A plain YAML scalar: no `: ` or ` #` that would end it early, and no
        # quote or indicator at its start.
        for breaking in (": ", " #"):
            self.assertNotIn(breaking, fields["description"])
        self.assertNotIn(fields["description"][0], "'\"[{>|*&!%@`")
        self.assertLess(len(body.splitlines()), 500)

    def test_the_description_says_when_to_use_it_and_when_not(self) -> None:
        fields, _body = frontmatter((SKILL / "SKILL.md").read_text(encoding="utf-8"))
        description = fields["description"]
        self.assertIn("Valkama", description)
        self.assertIn("Use when", description)
        self.assertIn("Not for", description)

    def test_every_tool_it_names_is_one_this_build_publishes(self) -> None:
        named = {name for text in self.documents().values() for name in TOOL.findall(text)}
        self.assertTrue(named)
        self.assertEqual(set(), named - tools.TOOL_NAMES)

    def test_every_link_inside_the_skill_resolves(self) -> None:
        for path, text in self.documents().items():
            for target in LINK.findall(text):
                if target.startswith(("http://", "https://")):
                    continue
                with self.subTest(document=path.name, target=target):
                    self.assertTrue((path.parent / target).is_file())

    def test_it_carries_nothing_private(self) -> None:
        for path, text in self.documents().items():
            for pattern in PRIVATE:
                with self.subTest(document=path.name, pattern=pattern.pattern):
                    self.assertIsNone(pattern.search(text))

    def test_it_ships_only_markdown(self) -> None:
        shipped = {path.suffix for path in SKILL.rglob("*") if path.is_file()}
        self.assertEqual({".md"}, shipped)


if __name__ == "__main__":
    unittest.main()
