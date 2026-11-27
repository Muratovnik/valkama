"""What a changelog entry owes before its release: lines a reader can read, and a line per feature.

Two rules of the changelog entry `CONTRIBUTING.md` describes, held here so the unittest stage runs
them on every change and `release prepare` runs them on the entry it is about to publish. They read
`[Unreleased]` and the top release while no tag `v<version>` exists for it yet. A release already
tagged is history, and its entry is not rewritten.

Width: a line written by hand, in a paragraph or a list item, is at most 90 characters, counted as
characters rather than bytes, since a byte count once passed lines that were too long and refused
lines that were not. Headings, table rows and a line that is one unbreakable token, such as a lone
link, are exempt, and so is a list item on one line that carries a commit link: that is how the
draft writes each line under Features, Bug Fixes and Performance Improvements.

Completeness: every `feat`, `perf` and breaking commit on `main`'s first-parent line since the
previous release's tag is linked from the entry, unless a revert in the same range names it, since
the users of the release never see a change taken back before it. A `fix` or a `revert` may go
without a line: the curation rule drops a fix of something that first appeared in the same release.
"""

from __future__ import annotations

import re
import unittest
from dataclasses import dataclass
from pathlib import Path

from server import processes

ROOT = Path(__file__).resolve().parents[1]
CHANGELOG = ROOT / "CHANGELOG.md"
UNRELEASED = "Unreleased"
WIDTH = 90

RELEASE = re.compile(r"^## \[(?P<version>[^\]]+)\]")
ITEM = re.compile(r"^\s*(?:[-*]|\d+\.)\s")
COMMIT_LINK = re.compile(r"/commit/(?P<hash>[0-9a-f]{7,40})\b")
NEEDS_LINE = re.compile(r"^(?:feat|perf)(?:\([^)]*\))?!?: |^[a-z]+(?:\([^)]*\))?!: ")
BREAKING_FOOTER = re.compile(r"^BREAKING[ -]CHANGE: ", re.MULTILINE)
NAMED_HASH = re.compile(r"\b[0-9a-f]{7,40}\b")


@dataclass(frozen=True)
class Section:
    """One `## [version]` section: its version, the number of its heading line and what follows."""

    version: str
    heading_line: int
    lines: tuple[str, ...]


@dataclass(frozen=True)
class Commit:
    hash: str
    subject: str
    body: str


def sections(text: str) -> list[Section]:
    """Every `## [version]` section of a changelog, newest first, as the file orders them."""

    found: list[Section] = []
    heading: tuple[str, int] | None = None
    body: list[str] = []
    for number, line in enumerate(text.split("\n"), 1):
        match = RELEASE.match(line)
        if match is None:
            body.append(line)
            continue
        if heading is not None:
            found.append(Section(heading[0], heading[1], tuple(body)))
        heading, body = (match["version"], number), []
    if heading is not None:
        found.append(Section(heading[0], heading[1], tuple(body)))
    return found


def overlong(section: Section) -> list[tuple[int, int]]:
    """The line number and width of each hand-written line of `section` wider than `WIDTH`."""

    blocks: list[list[tuple[int, str]]] = []
    block: list[tuple[int, str]] | None = None
    for number, line in enumerate(section.lines, section.heading_line + 1):
        if not line.strip() or line.lstrip().startswith(("#", "|")):
            block = None
            continue
        if block is None or ITEM.match(line):
            block = []
            blocks.append(block)
        block.append((number, line))

    found: list[tuple[int, int]] = []
    for lines in blocks:
        first = lines[0][1]
        if len(lines) == 1 and ITEM.match(first) and COMMIT_LINK.search(first):
            continue
        for number, line in lines:
            unbreakable = len(ITEM.sub("", line).split()) <= 1
            if len(line) > WIDTH and not unbreakable:
                found.append((number, len(line)))
    return found


def unlisted(section: Section, commits: list[Commit]) -> list[Commit]:
    """The commits that need a line in `section` and have no link there."""

    linked = COMMIT_LINK.findall("\n".join(section.lines))
    reverted = [
        named
        for commit in commits
        if commit.subject.startswith("revert")
        for named in NAMED_HASH.findall(f"{commit.subject}\n{commit.body}")
    ]

    def named_by(prefixes: list[str], full: str) -> bool:
        return any(full.startswith(prefix) for prefix in prefixes)

    return [
        commit
        for commit in commits
        if (NEEDS_LINE.match(commit.subject) or BREAKING_FOOTER.search(commit.body))
        and not named_by(linked, commit.hash)
        and not named_by(reverted, commit.hash)
    ]


def git(*arguments: str) -> processes.TextResult:
    return processes.run_text(["git", "-C", str(ROOT), *arguments], timeout=60)


def tagged(version: str) -> bool:
    result = git("tag", "--list", f"v{version}")
    if result.returncode != 0:
        raise unittest.SkipTest(f"no Git history to read tags from: {result.stderr.strip()}")
    return bool(result.stdout.strip())


def first_parent(revisions: str) -> list[Commit]:
    result = git("log", "--first-parent", "--format=%H%x1f%s%x1f%b%x1e", revisions)
    if result.returncode != 0:
        raise AssertionError(f"git log {revisions} failed: {result.stderr.strip()}")
    records = [record.strip("\n") for record in result.stdout.split("\x1e")]
    return [Commit(*record.split("\x1f", 2)) for record in records if record]


def awaiting_release(found: list[Section]) -> list[Section]:
    """`[Unreleased]`, and the top release while it has no tag: what the next release publishes."""

    pending = [section for section in found if section.version == UNRELEASED]
    releases = [section for section in found if section.version != UNRELEASED]
    if releases and not tagged(releases[0].version):
        pending.append(releases[0])
    return pending


def entry(*lines: str) -> Section:
    return Section("9.9.9", 1, lines)


def words(width: int) -> str:
    """Two words, `width` characters in all, so the line breaks between them."""

    first = width // 2
    return "a" * first + " " + "a" * (width - first - 1)


def commit_link(hash_: str) -> str:
    return f"([{hash_[:7]}](https://github.com/example/product/commit/{hash_}))"


class WidthRuleTests(unittest.TestCase):
    def test_a_wrapped_line_may_reach_ninety_characters_and_no_further(self) -> None:
        section = entry(
            "### Highlights",
            "",
            "- " + words(88),
            "  " + words(88),
            "  " + words(89),
            "",
            "A paragraph " + "d" * 79,
        )

        self.assertEqual(overlong(section), [(6, 91), (8, 91)])

    def test_counts_characters_rather_than_bytes(self) -> None:
        section = entry("- " + "ж" * 44 + " " + "—" * 43, "  " + "ж" * 44 + " " + "ж" * 44)

        self.assertEqual(overlong(section), [(3, 91)])

    def test_leaves_the_drafts_lines_tables_headings_and_unbreakable_tokens(self) -> None:
        generated = "- **web:** " + "long words " * 30 + commit_link("a" * 40)
        lone_link = "  " + commit_link("b" * 40) + "."
        section = entry(
            "### Features" + " heading" * 20,
            generated,
            "| a cell " * 20 + "|",
            "- a highlight wrapped over two lines, its second one a link alone:",
            lone_link,
        )

        self.assertGreater(len(generated), WIDTH)
        self.assertGreater(len(lone_link), WIDTH)
        self.assertEqual(overlong(section), [])

    def test_a_one_line_item_without_a_commit_link_is_written_by_hand(self) -> None:
        section = entry("- " + "words " * 20)

        self.assertEqual(overlong(section), [(2, 122)])


class CompletenessRuleTests(unittest.TestCase):
    def test_names_each_feature_performance_and_breaking_commit_without_a_line(self) -> None:
        commits = [
            Commit("1" * 40, "feat(web): one scroll for the whole page", ""),
            Commit("2" * 40, "feat: a second feature", ""),
            Commit("3" * 40, "fix(planning): a fix the curation dropped", ""),
            Commit("4" * 40, "perf: answer the list faster", ""),
            Commit("5" * 40, "refactor(server)!: name the module platform", ""),
            Commit("6" * 40, "chore: drop the old door", "Body.\n\nBREAKING CHANGE: no old door."),
            Commit("7" * 40, "docs: say how", ""),
        ]
        section = entry("### Features", "", "- one scroll " + commit_link("1" * 40))

        self.assertEqual(
            [commit.hash[0] for commit in unlisted(section, commits)], ["2", "4", "5", "6"]
        )

    def test_a_feature_a_revert_in_the_range_names_needs_no_line(self) -> None:
        feature = Commit("ab12cd3" + "0" * 33, "feat(analytics): draw the forecast", "")
        revert = Commit("9" * 40, "revert: take the forecast back out", "This reverts ab12cd3.")

        self.assertEqual(unlisted(entry(), [feature, revert]), [])
        self.assertEqual(unlisted(entry(), [feature]), [feature])

    def test_a_link_by_the_start_of_the_hash_counts(self) -> None:
        feature = Commit("cafe123" + "0" * 33, "feat: a feature", "")
        section = entry(
            "- a feature ([cafe123](https://github.com/example/product/commit/cafe123))"
        )

        self.assertEqual(unlisted(section, [feature]), [])


class ThisChangelogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sections = sections(CHANGELOG.read_text(encoding="utf-8"))

    def test_every_entry_awaiting_its_release_keeps_the_width(self) -> None:
        pending = awaiting_release(self.sections)

        self.assertIn(UNRELEASED, [section.version for section in pending])
        for section in pending:
            with self.subTest(version=section.version):
                self.assertEqual(overlong(section), [], "line number and width, over 90 characters")

    def test_the_entry_awaiting_its_release_links_every_feature(self) -> None:
        releases = [section for section in self.sections if section.version != UNRELEASED]
        if tagged(releases[0].version):
            self.skipTest(f"v{releases[0].version} is tagged: no release entry awaits publication")
        previous = releases[1].version
        self.assertTrue(tagged(previous), f"the previous release v{previous} has no tag")

        missing = unlisted(releases[0], first_parent(f"v{previous}..HEAD"))

        self.assertEqual([f"{c.hash[:9]} {c.subject}" for c in missing], [])

    def test_the_newest_published_entry_passes_and_misses_a_link_taken_out(self) -> None:
        releases = [section for section in self.sections if section.version != UNRELEASED]
        published = [section for section in releases if tagged(section.version)]
        if len(published) < 2:
            self.skipTest("fewer than two release tags to read a published range from")
        newest, previous = published[0], published[1]
        commits = first_parent(f"v{previous.version}..v{newest.version}")
        text = "\n".join(newest.lines)
        features = [c for c in commits if c.subject.startswith("feat") and c.hash in text]
        self.assertGreater(len(features), 0)

        self.assertEqual(unlisted(newest, commits), [])

        dropped = features[0]
        without = Section(
            newest.version,
            newest.heading_line,
            tuple(line for line in newest.lines if dropped.hash not in line),
        )
        self.assertIn(dropped, unlisted(without, commits))


if __name__ == "__main__":
    unittest.main()
