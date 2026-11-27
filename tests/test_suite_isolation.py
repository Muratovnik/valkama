"""What importing the `tests` package owes every test process: no reach into the caller's places.

A targeted run (`python -m unittest tests.<module>`) imports the package before any test
module, as the gates' run does, so what the package moves holds for both. These tests
look at where the project registry is read from, in this process and in a fresh one
started the way a targeted run starts, because the registry names the Git directories
whose commit records the start-up pass of a surface takes and deletes.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import tests
from server.hooks import commit_records
from server.projects import project_registry, registry_owner
from tests.registry_fixtures import project_entry, registry_bytes

ROOT = Path(__file__).resolve().parents[1]
SESSION = "019a3c2e-7777-7c11-9e0f-2f4b6d8a1c3e"
HOUR_NS = 60 * 60 * 1_000_000_000

#: A process started as a targeted run starts: the package first, then whatever the
#: test raises. Here that is the start-up pass of a surface, twice, as two starts of
#: an MCP loop or `serve` run it: the first takes an old record, the next deletes it.
STARTS = """\
import json, sys
sys.path.insert(0, sys.argv[1])
import tests
from server import housekeeping, store
from server.projects import project_registry
conn = store.connect()
try:
    for _ in range(2):
        housekeeping.start_up(conn)
    taken = conn.execute("SELECT COUNT(*) FROM commits").fetchone()[0]
finally:
    conn.close()
print(json.dumps({
    "registry": project_registry.registry_path(),
    "store": store.db_path(),
    "suite": tests.SUITE_STORE,
    "taken": taken,
}))
"""


def _throwaway_root() -> Path:
    """The suite's own directory: where its store is, and everything else it moves."""

    return Path(tests.SUITE_STORE).parent.resolve()


class RegistryTests(unittest.TestCase):
    def test_the_project_registry_is_read_inside_the_suite_s_own_directory(self) -> None:
        for path in (
            project_registry.registry_path(),
            commit_records.registry_path(),
            registry_owner.inventory_path(),
        ):
            with self.subTest(path=path):
                self.assertTrue(
                    Path(path).resolve().is_relative_to(_throwaway_root()),
                    f"a test process reads the registry from {path}",
                )


class StartUpTests(unittest.TestCase):
    """A registry outside the throwaway root, standing for the caller's own."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-caller-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        base = Path(directory.name).resolve()
        self.local = base / "local"
        self.alpha = base / "alpha"
        self.records = self.alpha / ".git" / "valkama" / "commits"
        (self.local / "Valkama").mkdir(parents=True)
        self.records.mkdir(parents=True)
        (self.local / "Valkama" / "projects.json").write_bytes(
            registry_bytes([project_entry("alpha", self.alpha)])
        )

    def write_records(self) -> dict[str, bytes]:
        """A record two hours old, which the commits step takes, and a file that is no
        record and is eight days old, which it sets aside: every name with its bytes."""

        now = time.time_ns()
        at = now - 2 * HOUR_NS
        record = {
            "format": commit_records.FORMAT,
            "version": commit_records.VERSION,
            "event": "post-commit",
            "rewrite": None,
            "root": self.alpha.as_posix(),
            "project_id": "alpha",
            "commits": [
                {"hash": "a" * 40, "parents": [], "subject": "feat: a", "committed_at": None}
            ],
            "rewritten": [],
            "claude": None,
            "codex": {"session_id": SESSION, "thread_id": SESSION, "tool_call_id": "call_gone"},
            "occurred_at": commit_records.timestamp(at),
        }
        [written] = commit_records.write(
            commit_records.encode(record), [SESSION], [(str(self.records), False)], at
        )
        broken = self.records / f"{SESSION}--{now - 8 * 24 * HOUR_NS}-{'b' * 16}.json"
        broken.write_bytes(b"{not a record")
        return {Path(written).name: Path(written).read_bytes(), broken.name: b"{not a record"}

    def on_disk(self) -> dict[str, bytes]:
        return {
            path.relative_to(self.records).as_posix(): path.read_bytes()
            for path in self.records.rglob("*")
            if path.is_file()
        }

    def test_a_start_up_pass_in_a_test_process_leaves_the_caller_s_records_alone(self) -> None:
        written = self.write_records()
        environment = {name: value for name, value in os.environ.items() if name != "VALKAMA_DB"}
        environment["LOCALAPPDATA"] = str(self.local)
        found = subprocess.run(
            [sys.executable, "-c", STARTS, str(ROOT)],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(0, found.returncode, found.stderr)
        answer = json.loads(found.stdout)
        self.assertEqual(written, self.on_disk())
        self.assertEqual(0, answer["taken"], "a record of the caller's reached the test store")
        self.assertEqual(answer["suite"], answer["store"])
        throwaway = Path(answer["suite"]).parent.resolve()
        self.assertTrue(Path(answer["registry"]).resolve().is_relative_to(throwaway), answer)


#: A process started as a targeted run starts, that writes the global Git configuration
#: as `git-hook install` does and reports what it reads there.
GLOBAL_WRITES = """\
import json, os, subprocess, sys
sys.path.insert(0, sys.argv[1])
import tests

def git(*arguments):
    return subprocess.run(["git", "config", "--global", *arguments], capture_output=True)

written = git("--replace-all", "hook.valkama-commit.event", "post-commit")
print(json.dumps({
    "written": written.returncode,
    "variable": os.environ.get("GIT_CONFIG_GLOBAL"),
    "origin": git("--show-origin", "-z", "--get", "hook.valkama-commit.event").stdout.decode(),
    "suite": tests.SUITE_GIT_CONFIG,
    "name": git("--get", "user.name").stdout.decode().strip(),
    "safe": git("--get-all", "safe.directory").stdout.decode().splitlines(),
    "alias": git("--get", "alias.from-the-caller").returncode,
}))
"""

#: Run in a fresh process that imports the package: commits an LF file to a new
#: repository and writes out the bytes `git archive` gives back for it.
ARCHIVED_ENTRY = """
import io, subprocess, sys, tarfile
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import tests

repository = Path(sys.argv[2])

def git(*arguments):
    return subprocess.run(["git", *arguments], cwd=repository, capture_output=True, check=True)

git("init", "-q")
(repository / "entry.py").write_bytes(b"one\\ntwo\\n")
git("add", "entry.py")
git("-c", "user.name=suite", "-c", "user.email=suite@example.invalid", "commit", "-qm", "seed")
archive = git("archive", "--format=tar", "HEAD").stdout
with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
    sys.stdout.buffer.write(bundle.extractfile("entry.py").read())
"""


class GlobalGitFileTests(unittest.TestCase):
    """The global Git configuration a test process reads and writes is the suite's own."""

    def test_this_process_names_a_global_git_file_inside_the_suite_s_directory(self) -> None:
        path = Path(os.environ["GIT_CONFIG_GLOBAL"])
        self.assertTrue(path.is_file())
        self.assertTrue(
            path.resolve().is_relative_to(_throwaway_root()),
            f"a test process writes the global Git file at {path}",
        )

    def test_a_targeted_run_writes_no_global_git_file_of_the_caller_s(self) -> None:
        """A caller without `GIT_CONFIG_GLOBAL`, whose global file is the one in its home:
        a fresh process that imports the package writes the suite's file and leaves that
        one byte for byte, and keeps from it only who commits and what is safe."""

        directory = tempfile.TemporaryDirectory(prefix="vk-caller-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        home = Path(directory.name).resolve()
        caller = home / ".gitconfig"
        original = (
            b"[user]\n\tname = Somebody Real\n\temail = somebody@example.com\n"
            b'[safe]\n\tdirectory = C:/work/alpha\n\tdirectory = "C:/work/with space"\n'
            b"[alias]\n\tfrom-the-caller = status\n"
        )
        caller.write_bytes(original)
        environment = {
            name: value for name, value in os.environ.items() if name != "GIT_CONFIG_GLOBAL"
        }
        environment.update({"HOME": str(home), "USERPROFILE": str(home)})
        found = subprocess.run(
            [sys.executable, "-c", GLOBAL_WRITES, str(ROOT)],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(0, found.returncode, found.stderr)
        answer = json.loads(found.stdout)
        self.assertEqual(original, caller.read_bytes(), "a test process wrote the caller's file")
        self.assertEqual(0, answer["written"])
        self.assertEqual(answer["suite"], answer["variable"])
        # Where Git itself says the write went: `file:<path>`, a NUL, the value.
        origin = answer["origin"].partition("\0")[0].removeprefix("file:")
        self.assertEqual(Path(answer["suite"]).resolve(), Path(origin).resolve())
        self.assertNotEqual(Path(answer["suite"]).resolve(), caller)
        self.assertEqual("Somebody Real", answer["name"])
        self.assertEqual(["C:/work/alpha", "C:/work/with space"], answer["safe"])
        self.assertEqual(1, answer["alias"], "a setting other than identity was carried")

    def test_a_host_s_system_autocrlf_reaches_no_repository_a_test_makes(self) -> None:
        """A host whose system Git file turns `core.autocrlf` on, as a hosted Windows
        runner's does: a repository that a fresh process importing the package makes
        archives the LF it committed, as `launcher.pin_release` reads it."""

        directory = tempfile.TemporaryDirectory(prefix="vk-eol-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        base = Path(directory.name).resolve()
        system = base / "gitconfig"
        system.write_bytes(b"[core]\n\tautocrlf = true\n")
        repository = base / "repository"
        repository.mkdir()
        environment = {
            name: value for name, value in os.environ.items() if name != "GIT_CONFIG_NOSYSTEM"
        }
        environment["GIT_CONFIG_SYSTEM"] = str(system)
        found = subprocess.run(
            [sys.executable, "-c", ARCHIVED_ENTRY, str(ROOT), str(repository)],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            check=False,
        )
        self.assertEqual(0, found.returncode, found.stderr.decode("utf-8", "replace"))
        self.assertEqual(b"one\ntwo\n", found.stdout)


if __name__ == "__main__":
    unittest.main()
