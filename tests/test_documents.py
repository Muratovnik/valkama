"""The path check every document route and the opener go through.

Junctions and links here are real ones on the real file system: whether
`realpath` follows a junction on this Windows is what these tests establish, not
something a mock could. The scratch lives under the repository's ignored `tmp/`.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import documents, processes
from server.documents import DocumentRefused, Located, Root
from tests.registry_fixtures import project_entry, registry_bytes
from tests.test_document_path_samples import load_rows

ROOT = Path(__file__).resolve().parents[1]
#: Every code `locate` may answer with, as the README lists them.
CODES = {
    "ambiguous",
    "invalid_path",
    "not_a_file",
    "not_found",
    "outside_root",
    "space_unbound",
    "unreadable",
}


def write(path: Path, text: str = "text") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


class LocateHarness(unittest.TestCase):
    """A workspace with two nested projects, a separate project and a place outside."""

    @classmethod
    def setUpClass(cls) -> None:
        ignored = processes.run_text(["git", "-C", str(ROOT), "check-ignore", "tmp/"])
        if ignored.returncode != 0:
            raise AssertionError("a junction must not land in tracked space")

    def setUp(self) -> None:
        scratch_root = ROOT / "tmp"
        scratch_root.mkdir(exist_ok=True)
        scratch = tempfile.TemporaryDirectory(dir=scratch_root)
        self.addCleanup(scratch.cleanup)
        self.scratch = Path(os.path.realpath(scratch.name))
        self.workspace = self.scratch / "workspace"
        self.one = self.workspace / "services" / "one"
        self.two = self.workspace / "services" / "two"
        self.other = self.scratch / "other"
        self.outside = self.scratch / "outside"
        write(self.workspace / "docs" / "plan.md")
        write(self.one / "src" / "only-one.ts")
        write(self.one / "src" / "both.ts")
        write(self.two / "src" / "both.ts")
        write(self.one / "docs" / "plan.md", "the nested copy")
        write(self.other / "b.md")
        write(self.outside / "secret.md")
        self.roots = (
            Root("workspace", str(self.workspace)),
            Root("one", str(self.one)),
            Root("two", str(self.two)),
            Root("other", str(self.other)),
        )

    def locate(self, raw: str, *, base: Path | None = None, nested: bool = False):
        start = self.workspace if base is None else base
        return documents.locate(
            raw,
            base=str(start),
            roots=self.roots,
            nested=documents.nested_roots(str(start), self.roots) if nested else (),
        )

    def refused(self, raw: str, **options) -> str:
        answer = self.locate(raw, **options)
        self.assertIsInstance(answer, DocumentRefused, raw)
        return answer.code

    def found(self, raw: str, **options) -> Located:
        answer = self.locate(raw, **options)
        self.assertIsInstance(answer, Located, f"{raw}: {answer}")
        return answer


class WrittenFormTests(LocateHarness):
    def test_what_windows_would_read_otherwise_is_refused_before_the_disk(self) -> None:
        cases = {
            "a network path": r"\\server\share\x.md",
            "a network path, forward": "//server/share/x.md",
            "a verbatim path": "\\\\?\\C:\\x.md",
            "a device path": "\\\\.\\NUL",
            "relative to a drive": "C:x.md",
            "a bare drive": "C:",
            "rooted on no drive": "/x.md",
            "not a drive letter": "1:/x.md",
            "a stream": "x.md:stream",
            "a stream, in a folder": "docs/x.md:stream",
            "a device": "CON",
            "a device with an extension": "nul.md",
            "a device with two": "NUL.tar.gz",
            "a device with a space": "nul .txt",
            "a device as a folder": "aux/x.md",
            "a device with a superscript": "COM¹",
            "a console": "CONIN$",
            "a segment ending in a dot": "docs./x.md",
            "a segment ending in a space": "docs /x.md",
            "a reserved character": "a<b",
            "a wildcard": "docs/*.md",
            "a NUL": "a\0b",
            "a control character": "a\tb",
            "a delete": "a\x7fb",
            "nothing": "",
            "too long": "a" * (documents.MAX_PATH_CHARS + 1),
        }
        with mock.patch.object(documents.os, "stat", side_effect=AssertionError("stat")):
            with mock.patch.object(documents.os.path, "realpath", side_effect=AssertionError):
                for name, raw in cases.items():
                    with self.subTest(name):
                        self.assertEqual("invalid_path", self.refused(raw))

    def test_names_that_only_resemble_a_device_pass(self) -> None:
        for name in ("con1.md", "COM10", "nul_x.md", "auxiliary.md", "COM0"):
            with self.subTest(name):
                write(self.workspace / name)
                self.assertEqual(name, self.found(name).relative)

    def test_the_length_limit_counts_exactly(self) -> None:
        at_limit = "a" * documents.MAX_PATH_CHARS
        self.assertNotEqual("invalid_path", self.refused(at_limit))

    def test_a_sample_path_gets_an_answer_from_the_closed_list(self) -> None:
        # The table is what the page sends; none of it may surprise the server.
        rows = [row for row in load_rows() if row["paths"]]
        self.assertGreater(len(rows), 40)
        for row in rows:
            for path in row["paths"]:
                with self.subTest(path):
                    answer = self.locate(path, nested=True)
                    if isinstance(answer, DocumentRefused):
                        self.assertIn(answer.code, CODES)
                    else:
                        self.assertEqual("workspace", answer.project)

    def test_a_tail_of_a_dot_or_a_colon_cannot_land_so_two_variants_are_safe(self) -> None:
        tailed = [
            row["paths"][1]
            for row in load_rows()
            if len(row["paths"]) == 2 and row["paths"][1][-1] in ".:"
        ]
        self.assertGreaterEqual(len(tailed), 3)
        for path in tailed:
            with self.subTest(path):
                self.assertEqual("invalid_path", self.refused(path))


class BoundaryTests(LocateHarness):
    def test_outside_answers_the_same_whether_anything_is_there(self) -> None:
        present = self.outside / "secret.md"
        absent = self.outside / "absent.md"
        cases = (str(present), str(absent), "../outside/secret.md", "../outside/absent.md")
        with mock.patch.object(documents.os, "stat", side_effect=AssertionError("stat")):
            for raw in cases:
                with self.subTest(raw):
                    self.assertEqual("outside_root", self.refused(raw))

    def test_a_sibling_that_shares_a_prefix_is_outside(self) -> None:
        write(self.scratch / "workspace-old" / "a.md")
        self.assertEqual("outside_root", self.refused(str(self.scratch / "workspace-old" / "a.md")))

    def test_a_path_that_climbs_back_in_is_inside(self) -> None:
        self.assertEqual("docs/plan.md", self.found("./docs/../docs/plan.md").relative)

    def test_another_drive_is_outside_and_raises_nothing(self) -> None:
        drive = os.path.splitdrive(str(self.workspace))[0]
        self.assertTrue(drive, "these tests run on a drive")
        foreign = "Z:" if drive.upper() != "Z:" else "Y:"
        self.assertEqual("outside_root", self.refused(f"{foreign}/x.md"))

    def test_no_roots_means_nothing_is_inside(self) -> None:
        answer = documents.locate(
            str(self.workspace / "docs" / "plan.md"), base=str(self.workspace), roots=()
        )
        self.assertEqual(DocumentRefused("outside_root"), answer)


class CaseExactTests(LocateHarness):
    """After `realpath` a path is inside only where the disk spells its root the same.

    Windows can make a directory case-sensitive, and WSL makes them so: there `proj`
    and `Proj` are two siblings, and a check that folds case takes one for the other.
    """

    def test_the_real_path_is_compared_as_the_disk_spells_it(self) -> None:
        base = os.path.join(os.path.abspath(os.sep), "work")
        root = os.path.join(base, "Proj")
        cases = {
            os.path.join(root, "docs", "a.md"): "docs/a.md",
            root: ".",
            os.path.join(base, "proj", "secret.md"): None,
            os.path.join(base, "PROJ"): None,
            os.path.join(base, "Project", "a.md"): None,
            os.path.join(base, "other.md"): None,
        }
        for real, expected in cases.items():
            with self.subTest(real):
                self.assertEqual(expected, documents._relative_in(root, real))

    def test_a_root_that_realpath_spells_otherwise_does_not_hold_the_path(self) -> None:
        # What a case-sensitive folder does, on any disk: the written path passes the
        # check by spelling, and `realpath` lands in a sibling named in another case.
        sibling = self.scratch / self.workspace.name.upper() / "docs" / "plan.md"
        with mock.patch.object(documents.os.path, "realpath", return_value=str(sibling)):
            self.assertEqual("outside_root", self.refused("docs/plan.md"))

    @unittest.skipUnless(os.name == "nt", "a folder is made case-sensitive by fsutil on Windows")
    def test_a_case_sensitive_sibling_is_outside(self) -> None:
        folder = self.scratch / "case-sensitive"
        folder.mkdir()
        enabled = processes.run_text(
            ["fsutil.exe", "file", "setCaseSensitiveInfo", str(folder), "enable"],
            # The console's code page: read only to name a skip to a person.
            encoding="utf-8",
            errors="replace",
        )
        if enabled.returncode != 0:
            self.skipTest(f"fsutil cannot make a folder case-sensitive here: {enabled.stdout}")
        upper, lower = folder / "Proj", folder / "proj"
        upper.mkdir()
        try:
            lower.mkdir()
        except FileExistsError:
            self.skipTest("the folder stayed case-insensitive")
        write(upper / "ok.md", "# ok\n")
        write(lower / "secret.md", "# sibling\n")
        root = Root("upper", os.path.realpath(upper))
        raw_paths = (
            str(lower / "secret.md"),
            (lower / "secret.md").as_posix(),
            "../proj/secret.md",
        )
        for raw in raw_paths:
            with self.subTest(raw):
                answer = documents.locate(raw, base=root.path, roots=(root,))
                self.assertEqual(DocumentRefused("outside_root"), answer)
        found = documents.locate("ok.md", base=root.path, roots=(root,))
        self.assertEqual(("upper", "ok.md"), (found.project, found.relative))
        registry = registry_bytes([project_entry("upper", upper)])
        with self.assertRaises(documents.DocumentError) as refused:
            documents.read_markdown("upper", "../proj/secret.md", reader=lambda: registry)
        self.assertEqual("outside_root", refused.exception.code)
        answered = documents.resolve_paths(
            None, ["../proj/secret.md"], project="upper", reader=lambda: registry
        )
        self.assertEqual("outside_root", answered[0].get("code"))


class JunctionHarness(LocateHarness):
    def make_junction(self, link: Path, target: Path) -> None:
        made = processes.run_text(
            ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
            # The console's code page: read only to name a failure to a person.
            encoding="utf-8",
            errors="replace",
        )
        self.assertEqual(0, made.returncode, made.stdout + made.stderr)
        # Removing a junction must leave what it points at alone.
        self.addCleanup(os.rmdir, link)


class RedirectionTests(JunctionHarness):
    """`os.path.realpath` is what these exercise, on real reparse points."""

    @unittest.skipUnless(os.name == "nt", "a junction is a Windows reparse point")
    def test_a_junction_out_of_a_root_is_outside_with_or_without_a_file_behind_it(self) -> None:
        self.make_junction(self.workspace / "escape", self.outside)
        self.assertEqual("outside_root", self.refused("escape/secret.md"))
        self.assertEqual("outside_root", self.refused("escape/absent.md"))
        self.assertEqual("outside_root", self.refused(str(self.workspace / "escape" / "secret.md")))
        self.assertEqual("outside_root", self.refused("escape"))

    @unittest.skipUnless(os.name == "nt", "a junction is a Windows reparse point")
    def test_a_junction_between_roots_lands_in_the_project_it_reaches(self) -> None:
        self.make_junction(self.workspace / "alias", self.other)
        found = self.found("alias/b.md")
        self.assertEqual(("other", "b.md"), (found.project, found.relative))

    def test_a_symbolic_link_out_of_a_root_is_outside(self) -> None:
        link = self.workspace / "escape.md"
        try:
            link.symlink_to(self.outside / "secret.md")
        except OSError as error:
            self.skipTest(f"this system does not allow a symbolic link: {error}")
        self.assertEqual("outside_root", self.refused("escape.md"))
        dangling = self.workspace / "dangling.md"
        dangling.symlink_to(self.outside / "absent.md")
        self.assertEqual("outside_root", self.refused("dangling.md"))


class SwappedAfterTheCheckTests(JunctionHarness):
    """A folder replaced by a junction between `locate` and the read.

    `locate` answers from `realpath`, and the read opens the path by name a moment
    later; what is checked then is where the open file really is.
    """

    def setUp(self) -> None:
        super().setUp()
        self.swapped = self.workspace / "swap"
        self.swapped.mkdir()
        (self.swapped / "s.md").write_bytes(b"# inside\n")
        (self.outside / "s.md").write_bytes(b"# outside\n")
        self.registry = registry_bytes([project_entry("workspace", self.workspace)])

    def read_after(self, change) -> dict[str, object]:
        """`read_markdown`, with `change` made once the path was checked."""

        checked = documents.locate

        def then_changed(*args, **kwargs):
            answer = checked(*args, **kwargs)
            change()
            return answer

        with mock.patch.object(documents, "locate", side_effect=then_changed):
            return documents.read_markdown("workspace", "swap/s.md", reader=lambda: self.registry)

    def swap_to(self, target: Path) -> None:
        for child in self.swapped.iterdir():
            child.unlink()
        self.swapped.rmdir()
        self.make_junction(self.swapped, target)

    @unittest.skipUnless(os.name == "nt", "a junction is a Windows reparse point")
    def test_a_folder_swapped_for_a_junction_out_is_not_read(self) -> None:
        with self.assertRaises(documents.DocumentError) as refused:
            self.read_after(lambda: self.swap_to(self.outside))
        self.assertEqual("outside_root", refused.exception.code)

    @unittest.skipUnless(os.name == "nt", "a junction is a Windows reparse point")
    def test_a_folder_swapped_for_a_junction_that_stays_inside_is_read(self) -> None:
        (self.workspace / "elsewhere").mkdir()
        (self.workspace / "elsewhere" / "s.md").write_bytes(b"# moved inside\n")
        read = self.read_after(lambda: self.swap_to(self.workspace / "elsewhere"))
        self.assertEqual(("swap/s.md", "# moved inside\n"), (read["path"], read["markdown"]))

    def test_the_file_opened_is_compared_with_the_root(self) -> None:
        # Where no junction can be made, the same decision on the opened path alone.
        elsewhere = str(self.outside / "s.md")
        with mock.patch.object(documents, "_opened_path", return_value=elsewhere):
            with self.assertRaises(documents.DocumentError) as refused:
                self.read_after(lambda: None)
        self.assertEqual("outside_root", refused.exception.code)
        self.assertEqual("# inside\n", self.read_after(lambda: None)["markdown"])


class AnswerTests(LocateHarness):
    def test_a_file_and_a_folder_name_their_project_and_path(self) -> None:
        file = self.found("docs/plan.md")
        self.assertEqual(
            ("file", "workspace", "docs/plan.md", True),
            (file.kind, file.project, file.relative, file.markdown),
        )
        for raw in ("docs", "docs/", "docs\\"):
            with self.subTest(raw):
                folder = self.found(raw)
                self.assertEqual(
                    ("directory", "workspace", "docs", False),
                    (folder.kind, folder.project, folder.relative, folder.markdown),
                )

    def test_markdown_is_told_by_the_suffix_in_any_case(self) -> None:
        write(self.workspace / "UPPER.MD")
        write(self.workspace / "long.markdown")
        write(self.workspace / "a.ts")
        self.assertTrue(self.found("UPPER.MD").markdown)
        self.assertTrue(self.found("long.markdown").markdown)
        self.assertFalse(self.found("a.ts").markdown)

    def test_both_separators_give_one_answer(self) -> None:
        target = self.workspace / "docs" / "plan.md"
        backward = str(target)
        self.assertIn("\\", backward, "the case needs a native spelling to mean anything")
        self.assertEqual(self.found(backward), self.found(target.as_posix()))

    def test_case_does_not_move_a_path_out_of_its_root(self) -> None:
        self.assertEqual(
            "docs/plan.md", self.found(str(self.workspace).upper() + "/docs/plan.md").relative
        )

    def test_the_project_is_the_deepest_root_holding_the_path(self) -> None:
        found = self.found(str(self.one / "src" / "only-one.ts"))
        self.assertEqual(("one", "src/only-one.ts"), (found.project, found.relative))

    def test_an_absolute_path_reaches_another_registered_project(self) -> None:
        found = self.found(str(self.other / "b.md"))
        self.assertEqual(("other", "b.md"), (found.project, found.relative))

    def test_the_home_folder_opens_only_inside_a_root(self) -> None:
        for home, expected in ((self.workspace, "file"), (self.outside, "outside_root")):
            write(home / ".config" / "a.md")
            variables = {"USERPROFILE": str(home), "HOME": str(home)}
            with self.subTest(home=home.name), mock.patch.dict(os.environ, variables):
                answer = self.locate("~/.config/a.md")
                self.assertEqual(expected, getattr(answer, "kind", getattr(answer, "code", "")))

    def test_a_relative_path_with_nothing_to_start_from_is_unbound(self) -> None:
        answer = documents.locate("docs/plan.md", base=None, roots=self.roots)
        self.assertEqual(DocumentRefused("space_unbound"), answer)
        absolute = str(self.workspace / "docs" / "plan.md")
        self.assertIsInstance(documents.locate(absolute, base=None, roots=self.roots), Located)

    def test_something_neither_file_nor_folder_is_refused(self) -> None:
        pipe = self.workspace / "docs" / "plan.md"
        with mock.patch.object(documents.os, "stat") as stat:
            stat.return_value.st_mode = 0o010644  # a FIFO
            self.assertEqual("not_a_file", self.refused(str(pipe)))

    def test_a_stat_the_system_refuses_is_not_called_missing(self) -> None:
        with mock.patch.object(documents.os, "stat", side_effect=PermissionError("the os text")):
            self.assertEqual("unreadable", self.refused("docs/plan.md"))


class NestedProjectTests(LocateHarness):
    def test_the_space_root_comes_first(self) -> None:
        found = self.found("docs/plan.md", nested=True)
        self.assertEqual(("workspace", "docs/plan.md"), (found.project, found.relative))

    def test_a_path_only_in_one_nested_project_is_answered_from_it(self) -> None:
        found = self.found("src/only-one.ts", nested=True)
        self.assertEqual(("one", "src/only-one.ts"), (found.project, found.relative))

    def test_a_path_in_two_nested_projects_is_ambiguous(self) -> None:
        self.assertEqual("ambiguous", self.refused("src/both.ts", nested=True))

    def test_a_path_in_none_is_not_found(self) -> None:
        self.assertEqual("not_found", self.refused("src/gone.ts", nested=True))

    def test_without_nested_roots_only_the_base_is_asked(self) -> None:
        self.assertEqual("not_found", self.refused("src/only-one.ts"))

    def test_a_path_climbing_out_of_a_nested_root_was_not_written_from_it(self) -> None:
        # From one/docs/deep it means one/docs/z.md, which is not there. Asked from
        # the nested root one/pkg it would land on one/z.md, which is.
        write(self.one / "z.md")
        (self.one / "pkg").mkdir()
        answer = documents.locate(
            "../z.md",
            base=str(self.one / "docs" / "deep"),
            roots=self.roots,
            nested=[str(self.one / "pkg")],
        )
        self.assertEqual(DocumentRefused("not_found"), answer)

    def test_one_file_reached_through_two_nested_roots_is_not_ambiguous(self) -> None:
        answer = documents.locate(
            "src/only-one.ts",
            base=str(self.workspace),
            roots=self.roots,
            nested=[str(self.one), str(self.one).upper()],
        )
        self.assertIsInstance(answer, Located)

    def test_a_refusal_under_the_base_is_not_retried_in_a_nested_root(self) -> None:
        self.assertEqual("outside_root", self.refused("../outside/secret.md", nested=True))

    def test_nested_roots_are_those_strictly_inside(self) -> None:
        self.assertEqual(
            {str(self.one), str(self.two)},
            set(documents.nested_roots(str(self.workspace), self.roots)),
        )
        self.assertEqual((), documents.nested_roots(str(self.other), self.roots))


class RegistryRootsTests(LocateHarness):
    def test_roots_come_from_the_registry_after_realpath(self) -> None:
        raw = registry_bytes([project_entry("workspace", self.workspace)])
        self.assertEqual(
            (Root("workspace", str(self.workspace)),),
            documents.registered_roots(reader=lambda: raw),
        )

    def test_an_unreadable_registry_leaves_no_roots(self) -> None:
        self.assertEqual((), documents.registered_roots(reader=lambda: b"not json"))


if __name__ == "__main__":
    unittest.main()
