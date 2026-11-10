"""A store of made-up usage rows for the Analytics tests: every id, time and count is invented.

The rows are written as the telemetry reader writes them, straight into the tables, so a
test says exactly which stretches of work exist. A time is seconds after `START`.
"""

from __future__ import annotations

import datetime as dt
import os
import tempfile
import unittest
from collections.abc import Mapping, Sequence
from pathlib import Path
from unittest import mock

from server import store
from server.analytics import api, usage
from server.planning import service as planning
from server.projects import project_registry
from tests.registry_fixtures import project_entry, registry_bytes

START = dt.datetime(2030, 3, 4, 0, 0, 0, tzinfo=dt.UTC)
HOUR = 3600
DAY = 24 * HOUR


def stamp(seconds: float) -> str:
    """A moment as the usage rows store it, exact to the millisecond."""

    moment = START + dt.timedelta(milliseconds=round(seconds * 1000))
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def day(offset_days: int) -> str:
    return (START.date() + dt.timedelta(days=offset_days)).isoformat()


class UsageStore(unittest.TestCase):
    """One store, a registry of two projects, and a way to write usage rows into it."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.alpha_root = self.root / "work" / "alpha"
        self.beta_root = self.root / "work" / "beta"
        environment = {
            "VALKAMA_DB": str(self.root / "valkama.sqlite3"),
            "HOME": str(self.root),
            "USERPROFILE": str(self.root),
        }
        for patch in (
            mock.patch.dict(os.environ, environment),
            mock.patch.object(
                project_registry,
                "_read_registry_bytes",
                lambda: registry_bytes(
                    [
                        project_entry("alpha", self.alpha_root, board="Alpha project"),
                        project_entry("beta", self.beta_root, board="Beta project"),
                    ]
                ),
            ),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        planning.create_planning_space(self.conn, project_id="alpha", name="Alpha", key="MAIN")
        self.conn.commit()
        self.runs: dict[tuple[str, str], int] = {}

    def item(self, title: str = "Work") -> tuple[str, str]:
        created = planning.create_work_item(self.conn, space="MAIN", title=title)
        self.conn.commit()
        return str(created["reference"]), str(created["work_item_id"])

    def session(self, session: str, cwd: str | Path = "", client: str = "claude") -> None:
        self.conn.execute(
            "INSERT INTO sessions(id, client, cwd, transcript_path, status, started_at, last_seen)"
            " VALUES (?, ?, ?, ?, 'ended', ?, ?)",
            (
                session,
                client,
                str(cwd),
                str(self.root / "transcripts" / f"{session}.jsonl"),
                stamp(0),
                stamp(0),
            ),
        )
        self.conn.commit()

    def add_run(self, session: str, agent: str = "", launch_class: str | None = None) -> int:
        if (session, agent) not in self.runs:
            self.runs[session, agent] = int(
                self.conn.execute(
                    "INSERT INTO usage_runs(session_id, agent_id, client, path, launch_class,"
                    " first_at, last_at) VALUES (?, ?, 'claude', ?, ?, ?, ?)",
                    (
                        session,
                        agent,
                        str(self.root / "transcripts" / f"{session}-{agent}.jsonl"),
                        launch_class,
                        stamp(0),
                        stamp(0),
                    ),
                ).lastrowid
                or 0
            )
            self.conn.commit()
        return self.runs[session, agent]

    def segment(
        self,
        session: str,
        start: float,
        end: float,
        *,
        agent: str = "",
        seconds: float | None = None,
        item: str | None = None,
        model: str | None = "claude-opus-5-5",
        tokens: tuple[int | None, ...] = (10, 100, 20, None, 5, None),
        cost: float | None = 0.01,
        quality: str = "observed",
        organization: str | None = None,
        effort: str | None = None,
        environment: str | None = None,
        launch_class: str | None = None,
        advisor: bool = False,
    ) -> None:
        run = self.add_run(session, agent, launch_class)
        self.conn.execute(
            "INSERT INTO usage_segments(run_id, session_id, agent_id, model, started_at, ended_at,"
            " seconds, work_item_id, input_tokens, cached_read_tokens, cache_write_5m_tokens,"
            " cache_write_1h_tokens, output_tokens, reasoning_tokens, estimated_api_cost_usd,"
            " price_book, quality, organization, effort, environment, advisor)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                run,
                session,
                agent,
                model,
                stamp(start),
                stamp(end),
                end - start if seconds is None else seconds,
                item,
                *tokens,
                cost,
                None if cost is None else "2030-01-01",
                quality,
                organization,
                effort,
                environment,
                int(advisor),
            ),
        )
        self.conn.execute(
            "UPDATE usage_runs SET last_at = MAX(last_at, ?) WHERE id = ?", (stamp(end), run)
        )
        self.conn.commit()

    def answer(self, **parameters: str) -> tuple[int, dict]:
        try:
            found = api.handle_get(
                self.conn, api.USAGE_PATH, {name: [value] for name, value in parameters.items()}
            )
        except (api.AnalyticsHttpError, usage.UsageQueryError) as error:
            return api.error_response(error)
        assert found is not None
        return found

    def read(self, **parameters: str) -> dict:
        status, body = self.answer(**parameters)
        self.assertEqual(200, status, body)
        self.assertEqual(api.ANALYTICS_API_INTERFACE, body["interface_version"])
        return body["usage"]


def tokens_sum(lines: Sequence[Mapping]) -> dict[str, int | None]:
    """Each kind added up the way a reader would: absent where no line reported it."""

    kinds = lines[0]["tokens"].keys() if lines else ()
    added: dict[str, int | None] = {}
    for kind in kinds:
        counts = [line["tokens"][kind] for line in lines if line["tokens"][kind] is not None]
        added[kind] = sum(counts) if counts else None
    return added
