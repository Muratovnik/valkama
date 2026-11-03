"""What a click on a session should do: the one plan, for the app and the browser alike.

The plan is built from the target, where the session was last open and what the
machine can open, and it is a list of abstract steps rather than a command line.
The desktop app and the browser each carry out the steps they can, and neither
decides where a session goes. A session opens where it was last open: the place
recorded in its row, or for a row older than that record, what its transcript
says, or the owner's fallback, or finally VS Code. A place that cannot be opened
gives way to the next in that chain, and `opens.missed` names what was passed over.

Nothing here writes. A transcript is read only for one closed value, which goes no
further than this call; `explain` steps carry closed codes, and the words for them
belong to the page.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass, field

from . import query_params, sessions, transcripts
from .hooks import place as places
from .hooks.place import Place
from .ops import url_schemes
from .ops.url_schemes import Installed

SURFACES = ("desktop", "browser")
#: What the settings may name, for the fallback and for "always open in".
OPEN_PLACES = (
    "vscode",
    "vscode-insiders",
    "cursor",
    "windsurf",
    "terminal",
    "claude-desktop",
    "codex-app",
)
#: A client's own check of the process, which `sessions.status` lags behind.
LIVENESS = ("live", "ended")

STEP_KINDS = (
    "focus-folder",
    "open-link",
    "resume-in-terminal",
    "desktop-resume",
    "open-file",
    "copy",
    "explain",
)
#: Every reason an `explain` step can give; the page has words for each.
REASONS = (
    "no-session",
    "invalid-session",
    "unsupported-client",
    "gone",
    "live-headless",
    "live-in-terminal",
    "live-elsewhere",
    "no-folder",
    "not-installed",
)
STATES = ("live", "ended", "gone", "headless", "none")

_VSCODE = Place("ide", "vscode")
_PLACE_OF = {
    "vscode": _VSCODE,
    "vscode-insiders": Place("ide", "vscode-insiders"),
    "cursor": Place("ide", "cursor"),
    "windsurf": Place("ide", "windsurf"),
    "terminal": Place("terminal"),
    "claude-desktop": Place("app", "claude-desktop"),
    "codex-app": Place("app", "codex-app"),
}
_APP_OF_FAMILY = {"claude": "claude-desktop", "codex": "codex-app"}

#: The same shape the desktop app holds an id to before it reaches a command line.
_SESSION_ID = re.compile(r"[0-9A-Za-z._:-]{4,128}")
#: The extension and the Codex app take a UUID; the extension starts an empty
#: conversation for anything else, which is the one outcome a link must not have.
_SESSION_UUID = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", re.IGNORECASE
)

_TAIL_BYTES = 64 * 1024
_HEAD_BYTES = 256 * 1024
_ORIGINATORS = {
    "Codex Desktop": Place("app", "codex-app"),
    "codex_vscode": _VSCODE,
    "codex-tui": Place("terminal"),
    "codex_cli_rs": Place("terminal"),
}


class OpenPlanError(ValueError):
    """A request that names no plan, refused with the boundary's three arguments."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class SessionTarget:
    session: str


def _last_entrypoint(path: str) -> str:
    """The newest `entrypoint` in a Claude transcript's tail; nothing else is taken from it."""

    try:
        with open(path, "rb") as handle:
            size = handle.seek(0, os.SEEK_END)
            handle.seek(max(0, size - _TAIL_BYTES))
            tail = handle.read(_TAIL_BYTES)
    except OSError:
        return ""
    lines = tail.split(b"\n")
    # A read that began inside the file began inside a line.
    for line in reversed(lines[1:] if size > _TAIL_BYTES else lines):
        if b'"entrypoint"' not in line:
            continue
        value = _json_field(line, "entrypoint")
        if value:
            return value
    return ""


def _json_field(line: bytes, name: str) -> str:
    try:
        record = json.loads(line)
    except (ValueError, RecursionError):
        return ""
    value = record.get(name) if isinstance(record, dict) else None
    return value if isinstance(value, str) else ""


def _originator(path: str) -> str:
    """Who created a Codex thread, from the first line of its rollout."""

    try:
        with open(path, "rb") as handle:
            first = handle.readline(_HEAD_BYTES)
    except OSError:
        return ""
    try:
        record = json.loads(first)
    except (ValueError, RecursionError):
        return ""
    payload = record.get("payload") if isinstance(record, dict) else None
    value = payload.get("originator") if isinstance(payload, dict) else None
    return value if isinstance(value, str) else ""


def _derived(family: str, transcript: str) -> Place:
    """Where a row older than the record was open, read at the moment of the click."""

    if not transcript:
        return Place()
    if family == "claude":
        entrypoint = _last_entrypoint(transcript)
        return places.classify("claude", {"CLAUDE_CODE_ENTRYPOINT": entrypoint})
    if family == "codex":
        return _ORIGINATORS.get(_originator(transcript), Place())
    return Place()


def _consistent(row: sqlite3.Row, family: str) -> Place:
    """The recorded place, believing a host only where it fits how the session is open.

    A confirmed call moves `opened_in` alone, so the host and Desktop's id can
    still describe the place the session left: `terminal` beside `claude-desktop`.
    """

    opened_in, host = row["opened_in"], row["opened_host"]
    if opened_in in ("ide", "ide-terminal"):
        known = host in url_schemes.EDITOR_HOMES or host == "jetbrains"
        return Place(opened_in, host if known else "vscode")
    if opened_in == "app" and family in _APP_OF_FAMILY:
        host_id = row["host_session_id"]
        keeps_id = (
            family == "claude"
            and host == "claude-desktop"
            and places.HOST_SESSION_ID.fullmatch(host_id) is not None
        )
        return Place("app", _APP_OF_FAMILY[family], host_id if keeps_id else "")
    if opened_in in ("terminal", "background", "headless"):
        return Place(opened_in)
    return Place()


def _runs_an_attempt(conn: sqlite3.Connection, session_id: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM execution_sessions WHERE session_id = ? LIMIT 1", (session_id,)
        ).fetchone()
        is not None
    )


def _usable_folder(folder: str) -> bool:
    """An existing absolute local folder: not a network path, no way back up."""

    if not folder or not os.path.isabs(folder) or folder.startswith(("\\\\", "//")):
        return False
    return ".." not in folder.replace("\\", "/").split("/") and os.path.isdir(folder)


def _window_folder(conn: sqlite3.Connection, row: sqlite3.Row) -> str:
    """The window a session belongs in: where it last started, its cwd, its project's root.

    A link to the extension goes to the window in focus, and in a window of another
    folder it starts an empty conversation, so the window is chosen before the link.
    """

    for folder in (row["opened_folder"], row["cwd"]):
        if _usable_folder(folder):
            return folder
    space_root = sessions.session_context(conn, row["id"]).get("space_root") or {}
    root = str(space_root.get("effective_cwd") or "")
    return root if _usable_folder(root) else ""


def _in_a_terminal(place: Place) -> bool:
    """Open in a terminal Valkama cannot raise, where a second process would be a second writer."""

    return place.opened_in == "terminal" or place.opened_host == "jetbrains"


def _explain(reason: str, **detail: object) -> dict[str, object]:
    return {"kind": "explain", "reason": reason, **detail}


def _shown(place: Place) -> dict[str, str]:
    return {"opened_in": place.opened_in, "opened_host": place.opened_host}


@dataclass(frozen=True)
class _Route:
    place: Place
    steps: list[dict[str, object]]


@dataclass
class _Planner:
    """One session's walk down the chain of places, with what each refusal was."""

    session: str
    family: str
    folder: str
    live: bool
    recorded: Place
    holding: bool
    surface: str
    installed: Installed
    seen: frozenset[str]
    missed: list[str] = field(default_factory=list)
    failure: dict[str, object] | None = None

    def route(self, place: Place) -> _Route | None:
        if place.opened_in == "app":
            return self._app(place)
        if place.opened_in == "background" or _in_a_terminal(place):
            return self._terminal(place)
        if place.opened_in in ("ide", "ide-terminal"):
            return self._extension(place)
        return None

    def _not_installed(self, host: str) -> None:
        self.missed.append(host)
        self.failure = _explain("not-installed", host=host)

    def _would_be_a_second_writer(self, place: Place) -> bool:
        """Whether this route opens a live session away from where it runs, unwarned."""

        if not self.live or (place == self.recorded and place.opened_in == "ide"):
            return False
        if url_schemes.ELSEWHERE_NOTICE in self.seen:
            return False
        self.failure = _explain("live-in-terminal" if self.holding else "live-elsewhere")
        return True

    def _extension(self, place: Place) -> _Route | None:
        if self._would_be_a_second_writer(place):
            return None
        if self.family == "codex" and url_schemes.CODEX_EXTENSION_ROUTE not in self.seen:
            return self._app(Place("app", "codex-app"))
        editor = place.opened_host or "vscode"
        extension = (
            url_schemes.CODEX_EXTENSION if self.family == "codex" else url_schemes.CLAUDE_EXTENSION
        )
        if (
            editor not in self.installed.schemes
            or (editor, extension) not in self.installed.extensions
        ):
            self._not_installed(editor)
            return None
        if not self.folder:
            self.failure = _explain("no-folder")
            return None
        if not _SESSION_UUID.fullmatch(self.session):
            self.failure = _explain("invalid-session")
            return None
        link = (
            url_schemes.codex_extension_link(editor, self.session)
            if self.family == "codex"
            else url_schemes.claude_extension_link(editor, self.session)
        )
        return _Route(
            Place(place.opened_in, editor),
            [
                _focus_folder(editor, self.folder, self.surface),
                {"kind": "open-link", "scheme": editor, "link": link},
            ],
        )

    def _app(self, place: Place) -> _Route | None:
        if place.opened_host == "codex-app":
            return self._codex_app(place)
        if "claude" not in self.installed.schemes:
            self._not_installed("claude-desktop")
            return None
        if place.host_session_id and url_schemes.DESKTOP_CONTINUE in self.seen:
            link = url_schemes.claude_desktop_link(place.host_session_id)
            return _Route(place, [{"kind": "open-link", "scheme": "claude", "link": link}])
        if self.surface == "desktop":
            return _Route(place, [{"kind": "desktop-resume", "session": self.session}])
        return _Route(
            place, [{"kind": "copy", "text": f"claude --desktop --resume {self.session}"}]
        )

    def _codex_app(self, place: Place) -> _Route | None:
        if "codex" not in self.installed.schemes:
            self._not_installed("codex-app")
            return None
        if not _SESSION_UUID.fullmatch(self.session):
            self.failure = _explain("invalid-session")
            return None
        link = url_schemes.codex_app_link(self.session)
        return _Route(place, [{"kind": "open-link", "scheme": "codex", "link": link}])

    def _terminal(self, place: Place) -> _Route | None:
        # A background session is attached to, not written to twice.
        if self.live and place.opened_in != "background":
            self.failure = _explain("live-in-terminal" if self.holding else "live-elsewhere")
            return None
        if self.surface == "desktop" and self.installed.terminal and self.folder:
            step: dict[str, object] = {
                "kind": "resume-in-terminal",
                "client": self.family,
                "session": self.session,
                "folder": self.folder,
            }
        elif (
            self.family == "claude"
            and self.folder
            and url_schemes.CLI_RESUME_LINK in self.seen
            and "claude-cli" in self.installed.schemes
        ):
            link = url_schemes.claude_cli_resume_link(self.folder, self.session)
            step = {"kind": "open-link", "scheme": "claude-cli", "link": link}
        else:
            verb = "claude --resume" if self.family == "claude" else "codex resume"
            step = {"kind": "copy", "text": f"{verb} {self.session}"}
        return _Route(place, [step])


def _focus_folder(editor: str, folder: str, surface: str) -> dict[str, object]:
    """The app starts the editor on the folder; a browser can only follow a link there."""

    step: dict[str, object] = {"kind": "focus-folder", "ide": editor, "folder": folder}
    if surface == "browser":
        step["link"] = url_schemes.folder_link(editor, folder)
    return step


def _session_row(conn: sqlite3.Connection, session_id: str) -> tuple[sqlite3.Row | None, str]:
    """The row a session target opens, and the agent asked for when that is its parent.

    A subagent cannot be opened from outside its client; what can is the session
    that ran it, which shows its progress.
    """

    query = "SELECT * FROM sessions WHERE id = ?"
    row = conn.execute(query, (session_id,)).fetchone()
    if row is None or not row["parent_session_id"]:
        return row, ""
    return conn.execute(query, (row["parent_session_id"],)).fetchone(), str(row["agent_id"])


def _recorded_place(
    conn: sqlite3.Connection, row: sqlite3.Row, family: str
) -> tuple[Place, str, bool]:
    """Where the session was last open, how that is known, and whether it is its first open."""

    columns = (row["opened_in"], row["opened_host"], row["opened_folder"], row["host_session_id"])
    if family == "codex" and not row["opened_in"] and _runs_an_attempt(conn, row["id"]):
        return Place("headless"), "derived", False
    if any(columns):
        # An empty `opened_in` beside other columns is a start nothing recognized,
        # not a row older than the record: its transcript is not asked.
        place = _consistent(row, family)
        return place, ("recorded" if place.opened_in else "none"), False
    place = _derived(family, row["transcript_path"])
    if not place.opened_in:
        return place, "none", False
    return place, "derived", family == "codex"


def _chain(recorded: Place, source: str, fallback: str, family: str) -> list[tuple[Place, str]]:
    """The places to try in order, the owner's fallback before the last resort."""

    chain: dict[Place, str] = {recorded: source} if recorded.opened_in else {}
    for place in (_PLACE_OF[fallback or "vscode"], _VSCODE):
        if _serves(place, family):
            chain.setdefault(place, "fallback")
    return list(chain.items())


def _serves(place: Place, family: str) -> bool:
    """Whether a configured place can hold this client's sessions at all."""

    return place.opened_in != "app" or _APP_OF_FAMILY.get(family) == place.opened_host


def _plan(
    target: Mapping[str, object],
    surface: str,
    *,
    state: str,
    steps: list[dict[str, object]],
    client: str = "",
    place: Mapping[str, object] | None = None,
    opens: Mapping[str, object] | None = None,
    one_action: bool = False,
) -> dict[str, object]:
    return {
        "target": dict(target),
        "surface": surface,
        "client": client,
        "state": state,
        "place": dict(place or {"opened_in": "", "opened_host": "", "source": "none"}),
        "opens": dict(opens) if opens else None,
        "one_action": one_action,
        "steps": steps,
    }


@dataclass(frozen=True)
class _Ask:
    """What a click asks for beyond its target, as the settings and the executor send it."""

    surface: str
    fallback: str
    always: str
    liveness: str
    installed: Installed
    seen: frozenset[str]


def _session_plan(conn: sqlite3.Connection, target: SessionTarget, ask: _Ask) -> dict[str, object]:
    shown_target: dict[str, object] = {"kind": "session", "session": target.session, "agent": ""}
    row, agent = _session_row(conn, target.session)
    if row is None:
        return _plan(shown_target, ask.surface, state="none", steps=[_explain("no-session")])
    session_id = str(row["id"])
    shown_target.update(session=session_id, agent=agent)
    family = sessions.client_family(row["client"])
    if family == "other" or not _SESSION_ID.fullmatch(session_id):
        reason = "unsupported-client" if family == "other" else "invalid-session"
        return _plan(
            shown_target, ask.surface, state="none", client=family, steps=[_explain(reason)]
        )
    live = ask.liveness == "live" or (not ask.liveness and row["status"] == "active")
    transcript = str(row["transcript_path"])
    if not live and transcript and not os.path.isfile(transcript):
        # Nothing can be resumed from a file the client deleted, so no link is offered:
        # one would start an empty conversation under the session's name.
        kept = any(
            archive.session_id == session_id and not archive.agent_id
            for archive in transcripts.current(conn).values()
        )
        steps = [_explain("gone", archived=kept)]
        return _plan(shown_target, ask.surface, state="gone", client=family, steps=steps)
    return _place_plan(conn, row, shown_target, family, live, ask)


def _place_plan(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    target: Mapping[str, object],
    family: str,
    live: bool,
    ask: _Ask,
) -> dict[str, object]:
    """Walk the chain of places for a session that can still be opened."""

    recorded, source, first_open = _recorded_place(conn, row, family)
    shown = {**_shown(recorded), "source": source, "first_open": first_open}

    def answer(
        state: str,
        steps: list[dict[str, object]],
        opens: Mapping[str, object] | None = None,
        one_action: bool = False,
    ) -> dict[str, object]:
        return _plan(
            target,
            ask.surface,
            state=state,
            client=family,
            place=shown,
            opens=opens,
            steps=steps,
            one_action=one_action,
        )

    state = "live" if live else "ended"
    if live and recorded.opened_in == "headless":
        return answer("headless", [_explain("live-headless")])

    terminal_only = _in_a_terminal(recorded)
    holding = live and (terminal_only or recorded.opened_in == "ide-terminal")
    chain = _chain(recorded, source, ask.fallback, family)
    leading: list[dict[str, object]] = []
    override = _PLACE_OF[ask.always] if ask.always else None
    if override and _serves(override, family) and not (live and _in_a_terminal(override)):
        chain = [(override, "always")]
    elif holding:
        # What keeps a second process off one transcript: say where the session runs,
        # and offer a way to look at it only where that was seen to be safe.
        if url_schemes.ELSEWHERE_NOTICE not in ask.seen:
            return answer(state, [_explain("live-in-terminal")])
        if terminal_only:
            leading = [_explain("live-in-terminal")]
            chain = [(place, how) for place, how in chain if not _in_a_terminal(place)]

    planner = _Planner(
        session=str(row["id"]),
        family=family,
        folder=_window_folder(conn, row),
        live=live,
        recorded=recorded,
        holding=holding,
        surface=ask.surface,
        installed=ask.installed,
        seen=ask.seen,
    )
    for place, how in chain:
        route = planner.route(place)
        if route is None:
            continue
        opens = {
            **_shown(route.place),
            "source": how if route.place == place else "fallback",
            "missed": planner.missed[0] if planner.missed else "",
        }
        # A link sent straight after a window opens can reach the window before it,
        # so two steps take two actions until that race was seen not to happen.
        unattended = ask.surface == "desktop" and url_schemes.WINDOW_THEN_LINK in ask.seen
        one_action = not leading and (len(route.steps) == 1 or unattended)
        return answer(state, [*leading, *route.steps], opens, one_action)
    failure = planner.failure or _explain("not-installed", host="vscode")
    return answer(state, [*leading, failure] if failure not in leading else leading)


def open_plan(
    conn: sqlite3.Connection,
    target: SessionTarget,
    *,
    surface: str,
    fallback: str = "",
    always: str = "",
    liveness: str = "",
    schemes: Installed | None = None,
    seen: frozenset[str] | None = None,
) -> dict[str, object]:
    """The plan for one click. Reads the store and the machine, writes nothing."""

    ask = _Ask(
        surface=surface,
        fallback=fallback,
        always=always,
        liveness=liveness,
        installed=schemes if schemes is not None else url_schemes.detect(),
        seen=url_schemes.SEEN_LIVE if seen is None else seen,
    )
    return _session_plan(conn, target, ask)


def _choice(parameters: Mapping[str, list[str]], name: str, allowed: tuple[str, ...]) -> str:
    value = query_params.first(parameters, name, error=OpenPlanError) or ""
    if value and value not in allowed:
        raise OpenPlanError(400, "invalid_request", f"{name} must be one of {', '.join(allowed)}")
    return value


def plan_for_query(conn: sqlite3.Connection, parameters: Mapping[str, list[str]]) -> dict:
    """Answer `GET /api/open-plan` from its parsed query string."""

    surface = query_params.required(parameters, "surface", error=OpenPlanError)
    if surface not in SURFACES:
        raise OpenPlanError(400, "invalid_request", f"surface must be one of {', '.join(SURFACES)}")
    kind = query_params.required(parameters, "target", error=OpenPlanError)
    if kind != "session":
        raise OpenPlanError(400, "invalid_request", "target must be session")
    return open_plan(
        conn,
        SessionTarget(query_params.required(parameters, "session", error=OpenPlanError)),
        surface=surface,
        fallback=_choice(parameters, "fallback", OPEN_PLACES),
        always=_choice(parameters, "always", OPEN_PLACES),
        liveness=_choice(parameters, "liveness", LIVENESS),
    )
