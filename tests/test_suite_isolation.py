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


if __name__ == "__main__":
    unittest.main()
