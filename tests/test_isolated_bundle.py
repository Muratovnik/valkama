"""What `tests/isolated.py serve` owes about the bundle: a warning whenever it is behind, and only then.

Every checkout here is a repository this test made, with a `web/` laid out as the
real one is: sources under `src`, `index.html` and `public`, the build in `dist`.
"""

from __future__ import annotations

import contextlib
import io
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from server import processes
from tests import isolated


class BundleCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-bundle-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        environment = mock.patch.dict(
            os.environ,
            {
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
                # Whatever holds the temporary directory is not searched for a repository.
                "GIT_CEILING_DIRECTORIES": str(self.root),
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        for name, text in {
            "web/src/main.ts": "mount()\n",
            "web/src/pages/board.vue": "<template>board</template>\n",
            "web/index.html": "<div id=app></div>\n",
            "web/public/favicon.svg": "<svg/>\n",
            "web/dist/index.html": '<script src="assets/main-1.js"></script>\n',
            "web/dist/assets/main-1.js": "mount()\n",
            "server/app.py": "print()\n",
        }.items():
            self.write(name, text)
        self.commit("build(web): the first bundle")
        self.bundle = self.git("log", "-1", "--format=%h").strip()

    def git(self, *arguments: str, cwd: Path | None = None) -> str:
        result = processes.run_text(
            [
                "git",
                "-C",
                str(cwd or self.repo),
                "-c",
                "user.name=Test User",
                "-c",
                "user.email=test@example.invalid",
                *arguments,
            ]
        )
        self.assertEqual(0, result.returncode, result.stderr)
        return result.stdout

    def write(self, name: str, text: str, *, at: float | None = None) -> None:
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
        if at is not None:
            os.utime(path, (at, at))

    def commit(self, subject: str) -> None:
        self.git("add", "-A")
        self.git("commit", "-m", subject)

    def build_here(self, *, at: float) -> None:
        """What `npm run build` leaves: a new bundle, written now, not committed."""

        self.write("web/dist/assets/main-2.js", "mount(2)\n", at=at)
        self.write("web/dist/index.html", '<script src="assets/main-2.js"></script>\n', at=at)


class BundleLagTests(BundleCase):
    def test_a_fresh_clone_whose_bundle_matches_is_silent_whatever_the_checkout_times(
        self,
    ) -> None:
        clone = self.root / "clone"
        self.git("clone", "-q", str(self.repo), str(clone), cwd=self.root)
        # A checkout writes files in whatever order it likes: here every source
        # is newer than the bundle, which a comparison of times would call stale.
        later = time.time() + 100
        for source in (clone / "web" / "src").rglob("*"):
            os.utime(source, (later, later))

        self.assertIsNone(isolated.bundle_lag(clone))
        self.assertIsNone(isolated.bundle_warning(clone))

    def test_a_change_outside_the_sources_is_silent(self) -> None:
        self.write("server/app.py", "print(2)\n")
        self.commit("fix(server): a change the bundle does not hold")

        self.assertIsNone(isolated.bundle_lag(self.repo))

    def test_sources_committed_after_the_bundle_warn_naming_them_and_the_bundles_commit(
        self,
    ) -> None:
        self.write("web/src/pages/board.vue", "<template>new board</template>\n")
        self.commit("feat(web): a new board")

        lag = isolated.bundle_lag(self.repo)

        assert lag is not None
        self.assertIn("web/src/pages/board.vue", lag)
        self.assertIn(self.bundle, lag)
        warning = isolated.bundle_warning(self.repo)
        assert warning is not None
        self.assertIn("npm run build", warning)

    def test_uncommitted_source_changes_warn(self) -> None:
        cases = {
            "a changed source": lambda: self.write("web/src/main.ts", "mount(again)\n"),
            "a new source": lambda: self.write("web/src/widgets/new.vue", "<template/>\n"),
            "a removed source": lambda: (self.repo / "web/src/pages/board.vue").unlink(),
            "a changed page": lambda: self.write("web/index.html", "<div id=other></div>\n"),
        }
        for case, change in cases.items():
            with self.subTest(case=case):
                change()
                self.assertIsNotNone(isolated.bundle_lag(self.repo))
                self.git("reset", "-q", "--hard")
                self.git("clean", "-q", "-fd")
                self.assertIsNone(isolated.bundle_lag(self.repo), "the tree is back")

    def test_an_uncommitted_build_after_the_last_source_change_is_silent(self) -> None:
        now = time.time()
        self.write("web/src/main.ts", "mount(2)\n", at=now - 10)
        self.build_here(at=now)

        self.assertIsNone(isolated.bundle_lag(self.repo))

    def test_a_source_written_after_an_uncommitted_build_warns_naming_it(self) -> None:
        now = time.time()
        self.build_here(at=now - 10)
        self.write("web/src/pages/board.vue", "<template>after</template>\n", at=now)

        lag = isolated.bundle_lag(self.repo)

        assert lag is not None
        self.assertIn("web/src/pages/board.vue was written after the build", lag)

    def test_a_directory_with_no_history_is_not_called_a_match(self) -> None:
        snapshot = self.root / "snapshot"
        (snapshot / "web" / "dist").mkdir(parents=True)

        lag = isolated.bundle_lag(snapshot)

        assert lag is not None
        self.assertIn("no commit of web/dist was found", lag)


class ServeTests(BundleCase):
    def serve(self) -> str:
        """What `serve` says before it starts, with the start itself left out."""

        output = io.StringIO()
        with (
            mock.patch.object(isolated, "ROOT", self.repo),
            mock.patch.object(isolated, "start", return_value=0) as start,
            contextlib.redirect_stdout(output),
        ):
            code = isolated.main(["serve", "--out", str(self.root / "out")])
        self.assertEqual(0, code)
        start.assert_called_once()
        return output.getvalue()

    def test_serve_warns_before_it_starts_when_the_sources_moved_on(self) -> None:
        self.write("web/src/main.ts", "mount(again)\n")

        said = self.serve()

        self.assertIn("warning: the server will serve web/dist", said)
        self.assertIn("web/src/main.ts", said)

    def test_serve_says_nothing_of_a_bundle_that_matches(self) -> None:
        self.assertNotIn("warning", self.serve())


if __name__ == "__main__":
    unittest.main()
