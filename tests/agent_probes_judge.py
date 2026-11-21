"""Judge the sessions a probe run recorded: `python tests/agent_probes.py judge --out DIR`.

The run left, in `DIR`, a `run.json` naming the scenarios and the sessions, and per
session the client's output of every turn, a copy of its store, its workspace
and the failures of the environment. The judge reads each scenario's `expect`
against that record and writes `DIR/report.json`: per probe a verdict with the
result and evidence of each check, the session's tokens, the client's version
and model. Nothing here knows what a scenario tests.

What a check reads:

- a work item, its questions, comments and history: the read tools of this
  checkout (`get_work_item`, `list_work_item_requests`, `list_planning_spaces`)
  on a copy of the session's store, through the MCP server a client starts. Two
  things those answers do not carry are read from the recorded store itself:
  which items the session can have touched, and the session behind a comment;
- calls, their order and the final answer: the client's own output, Claude
  Code's `stream-json` or Codex's `--json`, read into one list of calls; the
  answer is every text the main agent wrote after its last tool call in the
  last turn;
- files, Git and commands: the session's workspace as the run left it.

A probe passes when every check that decides passed. A check that only records
(`record_only`, and `skill_loaded` always: whether the skill was loaded is
written down, not judged) never decides. A check the record cannot settle is
`not confirmed`, and so is a probe with a deciding one or with a rubric nobody
has answered yet; a session the environment failed is not judged at all. For a
rubric the judge writes the reviewer's file, which shows the cards, the answer
or the subagents' reports the rubric names and never the agent's record, and
reads the reviewer's answer back from beside it.
"""

from __future__ import annotations

import contextlib
import dataclasses
import datetime
import fnmatch
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid
from collections.abc import Callable, Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

from server import processes
from server.planning import tools as planning_tools
from server.store_identity.primitives import ContractError
from server.store_identity.refs import planning_space_ref
from tests import agent_probes as probes
from tests import isolated

PASSED = "passed"
FAILED = "failed"
NOT_CONFIRMED = "not confirmed"
ENVIRONMENT = "environment failure"
REPORT = "report.json"
#: Where the reviewer's files go in the run's directory, one per rubric probe.
REVIEW = "review"
#: Where a session is judged: a copy of its store and the home of its MCP server.
WORK = "judge"

TOOL_PREFIX = "mcp__valkama__"
#: The class of call any file edit is: Claude Code's editing tools, Codex's patch.
FILE_CHANGE = "@file_change"
CLAUDE_FILE_TOOLS = frozenset({"Edit", "Write", "MultiEdit", "NotebookEdit"})
CLAUDE_SUBAGENT_TOOLS = frozenset({"Task", "Agent"})
#: A shell command that reads the Valkama skill's own file, in either separator.
SKILL_READ = re.compile(r"valkama[\\/]+SKILL\.md", re.IGNORECASE)
SKILL_NAME = re.compile(r"(?:[\w.-]+:)?valkama")
SESSION_IN_HOLDER = re.compile(r"\(session ([^)\s]+)\)")
#: Who wrote: the probe's main agent, one of its subagents, or the setup's sessions.
PROBE_ROLES = frozenset({"main", "subagent"})
#: Files no agent writes on purpose: a repository's own directory and Python's cache.
NOT_WRITTEN = frozenset({".git", "__pycache__"})
EVENT_PAGE = 1000
COMMENT_PAGE_LIMIT = 200
REQUEST_PAGE = 100


class UnsettledError(Exception):
    """The record cannot settle a check: what it lacks, said in the evidence."""


@dataclasses.dataclass(frozen=True)
class Outcome:
    result: str
    evidence: str


class Who(str):
    """A role a write or a call is by; `probe` stands for the main agent and its subagents."""

    __slots__ = ()

    def __eq__(self, other: object) -> bool:
        if other == "probe":
            return str(self) in PROBE_ROLES
        return str.__eq__(self, other)

    def __ne__(self, other: object) -> bool:
        return not self.__eq__(other)

    __hash__ = str.__hash__


@dataclasses.dataclass(frozen=True)
class Record:
    """A session's record as `run` left it, read back for judging."""

    directory: Path
    session: dict[str, Any]

    @classmethod
    def read(cls, directory: Path) -> Record:
        return cls(directory, json.loads((directory / "session.json").read_text("utf-8")))

    def turns(self) -> Iterator[list[dict[str, Any]]]:
        """The client's output of each turn, a list of its JSON lines."""

        for turn in self.session["turns"]:
            path = self.directory / turn["output"]
            lines = []
            for line in path.read_bytes().splitlines() if path.is_file() else ():
                with contextlib.suppress(ValueError):
                    found = json.loads(line)
                    if isinstance(found, dict):
                        lines.append(found)
            yield lines

    def lines(self) -> Iterator[dict[str, Any]]:
        for turn in self.turns():
            yield from turn

    def store(self) -> sqlite3.Connection:
        uri = f"{(self.directory / 'store.sqlite3').resolve().as_uri()}?mode=ro"
        return sqlite3.connect(uri, uri=True)

    def names(self) -> dict[str, str]:
        environment = self.session.get("environment") or {}
        return {
            "client": self.session["client"],
            "port": str(self.session.get("port")),
            "store_dir": str(self.directory),
            "workspace": str(self.directory / "workspace"),
            **{f"env.{name}": value for name, value in environment.items()},
            **(self.session.get("bindings") or {}),
        }


def _parse_time(value: object) -> datetime.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    with contextlib.suppress(ValueError):
        found = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return found if found.tzinfo else found.replace(tzinfo=datetime.UTC)
    return None


# --- conditions -------------------------------------------------------------------------

OPERATORS = frozenset(
    {
        "in",
        "not_in",
        "contains",
        "matches",
        "not_matches",
        "includes",
        "excludes",
        "all",
        "count",
        "present",
    }
)


def _text(value: object) -> str:
    return "" if value is None else value if isinstance(value, str) else json.dumps(value)


def _count(size: int, wanted: object) -> bool:
    if isinstance(wanted, Mapping):
        return wanted.get("min", size) <= size <= wanted.get("max", size)
    return size == wanted


def _operator(name: str, actual: Any, wanted: Any) -> bool:
    if name == "in":
        return any(actual == item for item in wanted)
    if name == "not_in":
        return not any(actual == item for item in wanted)
    if name == "contains":
        return actual is not None and str(wanted) in _text(actual)
    if name == "matches":
        return actual is not None and re.search(wanted, _text(actual)) is not None
    if name == "not_matches":
        return re.search(wanted, _text(actual)) is None
    if name == "present":
        return (actual is not None) is bool(wanted)
    elements = actual if isinstance(actual, list) else []
    if name == "includes":
        return any(holds(element, wanted) for element in elements)
    if name == "excludes":
        return not any(holds(element, wanted) for element in elements)
    if name == "all":
        return all(holds(element, wanted) for element in elements)
    return _count(len(actual) if isinstance(actual, list | str) else 0, wanted)


def holds(actual: Any, condition: Any) -> bool:
    """Whether `actual` meets a scenario's condition.

    A literal is equality, a list element by element in order, and an object of
    operators is each of them; any other key of an object is a condition on the
    field of that name, a missing field reading as null.
    """

    if isinstance(condition, Mapping):
        for key, wanted in condition.items():
            if key in OPERATORS:
                if not _operator(key, actual, wanted):
                    return False
            else:
                field = actual.get(key) if isinstance(actual, Mapping) else None
                if not holds(field, wanted):
                    return False
        return True
    if isinstance(condition, list):
        return (
            isinstance(actual, list)
            and len(actual) == len(condition)
            and all(holds(item, wanted) for item, wanted in zip(actual, condition, strict=True))
        )
    return bool(actual == condition)


# --- the session's calls ----------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class Call:
    """One tool call of the session, in the order the record has it."""

    index: int
    #: A Valkama tool's name without the client's prefix, or the client's own tool.
    tool: str
    valkama: bool
    file_change: bool
    by: Who
    #: None when the record names the call but not its arguments.
    args: Mapping[str, Any] | None
    result: Any = None
    target: str | None = None


@dataclasses.dataclass
class Transcript:
    """What a session's client output says: its calls, answer, skill, subagents and tokens."""

    calls: list[Call] = dataclasses.field(default_factory=list)
    answer: str | None = None
    #: The index the skill was loaded at, before the call of that index.
    skill: int | None = None
    skill_evidence: str = ""
    subagents: list[str] = dataclasses.field(default_factory=list)
    reports: list[str] = dataclasses.field(default_factory=list)
    #: Codex's subagent threads, whose calls only the store records.
    threads: set[str] = dataclasses.field(default_factory=set)
    tokens: dict[str, int] = dataclasses.field(default_factory=dict)
    models: list[str] = dataclasses.field(default_factory=list)


def _parsed(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return text


def _result_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, Mapping))
    return ""


def _add_tokens(tokens: dict[str, int], **counts: object) -> None:
    for name, value in counts.items():
        if isinstance(value, int) and not isinstance(value, bool):
            tokens[name] = tokens.get(name, 0) + value


def _claude(record: Record, transcript: Transcript) -> None:
    pending: dict[str, int] = {}
    #: Each launch's report, by the id of its call, in the order of the launches.
    launches: dict[str, str | None] = {}
    #: The launches sent to the background, whose call answers with where they run.
    backgrounded: set[str] = set()
    for lines in record.turns():
        answer = None
        reply: list[str] = []
        for line in lines:
            kind = line.get("type")
            if kind == "system" and line.get("subtype") == "init":
                model = line.get("model")
                if isinstance(model, str) and model not in transcript.models:
                    transcript.models.append(model)
            elif kind == "assistant":
                parent = line.get("parent_tool_use_id")
                for part in (line.get("message") or {}).get("content") or ():
                    if not isinstance(part, Mapping):
                        continue
                    if part.get("type") == "tool_use":
                        _claude_use(transcript, part, parent, pending, launches)
                        if not parent:
                            reply = []
                    elif part.get("type") == "text" and not parent:
                        reply.append(str(part.get("text") or ""))
            elif kind == "user":
                for part in (line.get("message") or {}).get("content") or ():
                    if isinstance(part, Mapping) and part.get("type") == "tool_result":
                        _claude_result(transcript, part, pending, launches)
            elif kind == "system" and line.get("subtype") == "task_started":
                if line.get("is_backgrounded"):
                    backgrounded.add(str(line.get("tool_use_id")))
            elif kind == "system" and line.get("subtype") == "task_notification":
                _claude_notification(line, launches, backgrounded)
            elif kind == "result":
                answer = line.get("result")
                usage = line.get("usage") or {}
                cached = usage.get("cache_read_input_tokens") or 0
                written = usage.get("cache_creation_input_tokens") or 0
                details = usage.get("output_tokens_details") or {}
                _add_tokens(
                    transcript.tokens,
                    input=(usage.get("input_tokens") or 0) + cached + written,
                    cached_input=cached,
                    cache_write=written,
                    output=usage.get("output_tokens"),
                    reasoning=details.get("thinking_tokens"),
                )
        transcript.answer = _final_reply(reply, answer)
    transcript.reports.extend(report for report in launches.values() if report is not None)


def _final_reply(texts: Sequence[str], result: object) -> str | None:
    """A turn's answer: every text the main agent wrote after its last tool call.

    A Stop hook may send the agent back for one more message, such as the report
    table the owner's skills ask for, and the client's own result names only that
    last one; the owner reads them all. Without any, the client's result.
    """

    written = [text for text in texts if text.strip()]
    if written:
        return "\n\n".join(written)
    return result if isinstance(result, str) else None


def _claude_use(
    transcript: Transcript,
    part: Mapping[str, Any],
    parent: object,
    pending: dict[str, int],
    launches: dict[str, str | None],
) -> None:
    name = str(part.get("name") or "")
    given = part.get("input")
    arguments: Mapping[str, Any] = given if isinstance(given, Mapping) else {}
    index = len(transcript.calls)
    valkama = name.startswith(TOOL_PREFIX)
    transcript.calls.append(
        Call(
            index=index,
            tool=name[len(TOOL_PREFIX) :] if valkama else name,
            valkama=valkama,
            file_change=name in CLAUDE_FILE_TOOLS,
            by=Who("subagent" if parent else "main"),
            args=arguments,
        )
    )
    if isinstance(part.get("id"), str):
        pending[part["id"]] = index
    if name in CLAUDE_SUBAGENT_TOOLS and not parent:
        transcript.subagents.append(str(arguments.get("description") or arguments.get("prompt")))
        launches[str(part.get("id"))] = None
    skill = arguments.get("skill")
    if name == "Skill" and transcript.skill is None and isinstance(skill, str):
        if SKILL_NAME.fullmatch(skill):
            transcript.skill = index
            transcript.skill_evidence = f"Skill {skill} at call {index}"


def _claude_notification(
    line: Mapping[str, Any], launches: dict[str, str | None], backgrounded: set[str]
) -> None:
    """A subagent's end: the report it handed back, or a backgrounded one's summary."""

    identifier = str(line.get("tool_use_id"))
    if identifier not in launches:
        return
    handback = line.get("handback_report")
    report = handback.get("text") if isinstance(handback, Mapping) else None
    if isinstance(report, str):
        launches[identifier] = report
    elif identifier in backgrounded:
        launches[identifier] = str(line.get("summary") or "")


def _claude_result(
    transcript: Transcript,
    part: Mapping[str, Any],
    pending: dict[str, int],
    launches: dict[str, str | None],
) -> None:
    identifier = str(part.get("tool_use_id"))
    text = _result_text(part.get("content"))
    # A subagent in the foreground answers its launch with its report; one sent to the
    # background answers with where it runs, and its notification brings the report.
    if identifier in launches and launches[identifier] is None:
        launches[identifier] = text
    index = pending.pop(identifier, None)
    if index is not None:
        call = transcript.calls[index]
        transcript.calls[index] = dataclasses.replace(call, result=_parsed(text))


#: Codex's items that are not an action: a message after one of them still ends the turn's reply.
CODEX_QUIET_ITEMS = frozenset({"agent_message", "reasoning", "error", "todo_list"})


def _codex(record: Record, transcript: Transcript) -> None:
    for lines in record.turns():
        reply: list[str] = []
        for line in lines:
            if line.get("type") == "turn.completed":
                usage = line.get("usage") or {}
                _add_tokens(
                    transcript.tokens,
                    input=usage.get("input_tokens"),
                    cached_input=usage.get("cached_input_tokens"),
                    cache_write=usage.get("cache_write_input_tokens"),
                    output=usage.get("output_tokens"),
                    reasoning=usage.get("reasoning_output_tokens"),
                )
                continue
            item = line.get("item")
            if line.get("type") != "item.completed" or not isinstance(item, Mapping):
                continue
            if item.get("type") == "agent_message":
                reply.append(str(item.get("text") or ""))
                continue
            if item.get("type") not in CODEX_QUIET_ITEMS:
                reply = []
            _codex_item(transcript, item)
        transcript.answer = _final_reply(reply, None)


def _codex_item(transcript: Transcript, item: Mapping[str, Any]) -> None:
    kind = item.get("type")
    index = len(transcript.calls)
    if kind == "mcp_tool_call":
        valkama = item.get("server") == "valkama"
        result = item.get("result")
        text = _result_text(result.get("content")) if isinstance(result, Mapping) else ""
        arguments = item.get("arguments")
        transcript.calls.append(
            Call(
                index=index,
                tool=str(item.get("tool")),
                valkama=valkama,
                file_change=False,
                by=Who("main"),
                args=arguments if isinstance(arguments, Mapping) else {},
                result=_parsed(text),
            )
        )
    elif kind == "file_change":
        changes = [str(change.get("path")) for change in item.get("changes") or ()]
        transcript.calls.append(
            Call(index, "apply_patch", False, True, Who("main"), {"changes": changes})
        )
    elif kind == "command_execution":
        command = str(item.get("command") or "")
        transcript.calls.append(
            Call(index, "shell", False, False, Who("main"), {"command": command})
        )
        found = SKILL_READ.search(command)
        if found is not None and transcript.skill is None:
            transcript.skill = index
            transcript.skill_evidence = f"read at call {index}: {command[-200:]}"
    elif kind == "collab_tool_call":
        # Codex's own subagents: each receiver of a spawn is one, and a finished
        # receiver's state carries its last message, which is its report.
        receivers = [str(thread) for thread in item.get("receiver_thread_ids") or ()]
        if item.get("tool") == "spawn_agent":
            transcript.subagents.extend(receivers)
        transcript.threads.update(receivers)
        for state in (item.get("agents_states") or {}).values():
            message = state.get("message") if isinstance(state, Mapping) else None
            if state.get("status") == "completed" and isinstance(message, str):
                transcript.reports.append(message)


def read_transcript(record: Record) -> Transcript:
    """The calls, answer, skill load, subagents and tokens of a session's client output."""

    transcript = Transcript()
    if record.session["client"] == "claude":
        _claude(record, transcript)
    else:
        _codex(record, transcript)
    return transcript


# --- the session's store, through the read tools ------------------------------------------


def _role(view: View, session: object, agent: object = None) -> Who:
    if session == view.main:
        return Who("subagent" if agent else "main")
    if session in view.transcript.threads or session in view.children:
        return Who("subagent")
    for name, identifier in (view.record.session.get("roles") or {}).items():
        if session == identifier:
            return Who(name)
    return Who("server" if not session else "foreign")


def _floor(moment: datetime.datetime) -> datetime.datetime:
    return moment.replace(microsecond=0)


class Store:
    """A session's store copy, served by this checkout's MCP server and read through its tools."""

    def __init__(self, record: Record, work: Path) -> None:
        home = work / "home"
        home.mkdir(parents=True)
        self.path = isolated.store_path(home)
        self.path.parent.mkdir(parents=True)
        isolated.copy_store(record.directory / "store.sqlite3", self.path)
        environment = {
            **isolated.isolated_environment(home),
            "VALKAMA_DB": str(self.path),
            "VALKAMA_AUTHOR": "probe-judge",
            "PYTHONIOENCODING": "utf-8",
        }
        # Anything the server writes when it starts happens from here on, and is
        # no part of the session.
        self.opened = _floor(datetime.datetime.now(datetime.UTC))
        self.client = probes.McpClient(
            sys.executable,
            [str(probes.ENTRY), "mcp"],
            environment,
            cwd=probes.ROOT,
            log=work / "mcp.log",
        )
        try:
            self.client.initialize("probe-judge")
        except probes.McpError:
            self.client.close()
            raise

    def call(self, tool: str, arguments: Mapping[str, Any]) -> Any:
        answer, error = self.client.call(tool, arguments, {"callId": str(uuid.uuid4())})
        if error:
            raise probes.ProbeError(f"{tool} {dict(arguments)} was refused: {answer}")
        return answer

    def close(self) -> None:
        self.client.close()


@dataclasses.dataclass
class View:
    """One recorded session as the checks see it: its scenario, names, calls and store."""

    record: Record
    scenario: probes.Scenario
    transcript: Transcript
    names: dict[str, str]
    store: Store | None
    #: The setup's end: what the store holds from after it is the session's.
    boundary: datetime.datetime
    children: set[str]
    #: Where this session is judged: the store copy and any other scratch.
    work: Path
    cards: dict[str, dict[str, Any]] = dataclasses.field(default_factory=dict)

    @property
    def main(self) -> str | None:
        return self.record.session.get("session_id")

    @contextlib.contextmanager
    def recorded(self) -> Iterator[sqlite3.Connection]:
        with contextlib.closing(self.record.store()) as conn:
            yield conn

    def before_judging(self, at: object) -> bool:
        moment = _parse_time(at)
        return moment is None or self.store is None or moment < self.store.opened

    def after_setup(self, at: object) -> bool:
        moment = _parse_time(at)
        return moment is not None and moment > self.boundary and self.before_judging(at)

    def tools(self) -> Store:
        if self.store is None:
            raise UnsettledError("the session kept no store")
        return self.store


def _boundary(record: Record) -> datetime.datetime:
    with contextlib.closing(record.store()) as conn:
        row = conn.execute(
            "SELECT received_at FROM execution_events WHERE id = ?",
            (record.session.get("setup_last_event", 0),),
        ).fetchone()
    found = _parse_time(row[0]) if row else None
    return _floor(found) if found else datetime.datetime.min.replace(tzinfo=datetime.UTC)


def _children(record: Record) -> set[str]:
    """The sessions a client's own subagents ran in, as the store's session rows say."""

    main = record.session.get("session_id")
    with contextlib.closing(record.store()) as conn:
        rows = conn.execute("SELECT id FROM sessions WHERE parent_session_id = ?", (main,))
        return {str(row[0]) for row in rows}


def _references(view: View) -> list[str]:
    """Every item the session can have written to: made since the setup began, or written since.

    Chosen from the recorded store, because the read tools list one space at a
    time and the copy holds every space the user had.
    """

    roles = tuple(sorted({*(view.record.session.get("roles") or {}).values(), view.main or ""}))
    start = view.boundary
    with view.recorded() as conn:
        first = conn.execute(
            "SELECT MIN(received_at) FROM execution_events WHERE session_id IN"
            f" ({','.join('?' * len(roles))})",
            roles,
        ).fetchone()[0]
        moment = _parse_time(first)
        if moment is not None and moment < start:
            start = _floor(moment)
        rows = conn.execute(
            "SELECT DISTINCT s.key || '-' || w.number, w.created_at FROM work_items w"
            " JOIN planning_spaces s ON s.planning_space_id = w.planning_space_id"
            " WHERE w.created_at >= ? OR w.work_item_id IN"
            " (SELECT work_item_id FROM work_item_events WHERE created_at > ?)"
            " ORDER BY w.created_at, w.number",
            (start.strftime("%Y-%m-%dT%H:%M:%SZ"), view.boundary.strftime("%Y-%m-%dT%H:%M:%SZ")),
        ).fetchall()
    return [str(row[0]) for row in rows]


def _page(view: View, reference: str) -> dict[str, Any]:
    parts = ["card", "events", "links", "refs", "commits", "questions"]
    return dict(
        view.tools().call("get_work_item", {"id": reference, "parts": parts, "events": EVENT_PAGE})
    )


def _comments(view: View, reference: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    after = 0
    for _ in range(COMMENT_PAGE_LIMIT):
        page = view.tools().call(
            "get_work_item", {"id": reference, "parts": "comments", "comments_after": after}
        )
        found.extend(page.get("comments") or ())
        if not page.get("truncated") or not found:
            break
        after = int(found[-1]["id"])
    with view.recorded() as conn:
        sessions = {
            int(row[0]): (row[1], row[2])
            for row in conn.execute(
                "SELECT c.id, x.session_id, x.agent_id FROM work_item_comments c"
                " LEFT JOIN execution_events x ON x.id = c.call_id"
                " JOIN work_items w ON w.work_item_id = c.work_item_id"
                " JOIN planning_spaces s ON s.planning_space_id = w.planning_space_id"
                " WHERE s.key || '-' || w.number = ?",
                (reference,),
            )
        }
    comments = []
    for comment in found:
        if not view.before_judging(comment.get("at")):
            continue
        session, agent = sessions.get(int(comment["id"]), (None, None))
        report = comment.get("report") or {}
        body = "\n".join([str(comment.get("body") or ""), *map(str, report.values())]).strip()
        comments.append(
            {
                "id": comment["id"],
                "by": _role(view, session, agent),
                "new": view.after_setup(comment.get("at")),
                "text": body,
                "awaits_reply": bool(comment.get("awaits_reply")),
            }
        )
    return comments


def _requests(view: View, reference: str) -> list[dict[str, Any]]:
    answer = view.tools().call(
        "list_work_item_requests", {"id": reference, "full": True, "limit": REQUEST_PAGE}
    )
    # Who asked is the session of the call that wrote the question's event: a question's
    # own `session_id` is what its asker passed, which a client's agent never does.
    with view.recorded() as conn:
        askers = {
            str(row[0]): (row[1], row[2])
            for row in conn.execute(
                "SELECT e.detail, x.session_id, x.agent_id FROM work_item_events e"
                " LEFT JOIN execution_events x ON x.id = e.call_id"
                " JOIN work_items w ON w.work_item_id = e.work_item_id"
                " JOIN planning_spaces s ON s.planning_space_id = w.planning_space_id"
                " WHERE e.action = 'request_created' AND s.key || '-' || w.number = ?",
                (reference,),
            )
        }
    found = []
    for request in answer.get("requests") or ():
        if not view.before_judging(request.get("created_at")):
            continue
        session, agent = askers.get(str(request.get("request_id")), (None, None))
        fields = [field for field in request.get("fields") or () if isinstance(field, Mapping)]
        options = [option for field in fields for option in field.get("options") or ()]
        answers = request.get("answers") or {}
        holder = SESSION_IN_HOLDER.search(str(request.get("answered_by") or ""))
        answered = request.get("answered_by")
        found.append(
            {
                "id": request.get("request_id"),
                "kind": request.get("kind"),
                "purpose": request.get("purpose"),
                "prompt": request.get("prompt"),
                "status": request.get("status"),
                "by": _role(view, session, agent),
                "new": view.after_setup(request.get("created_at")),
                "addressed_to": [_role(view, request["addressee"])]
                if request.get("addressee")
                else [],
                "options": [option.get("id") for option in options],
                # As the owner reads it: each field with its options, their meaning,
                # the recommendation and why.
                "fields": fields,
                "recommended": any(option.get("recommended") for option in options),
                "every_required_field_recommended": all(
                    field.get("recommended") is not None
                    or any(option.get("recommended") for option in field.get("options") or ())
                    for field in fields
                    if field.get("required")
                ),
                "answer": answers.get("answer", next(iter(answers.values()), None))
                if len(fields) != 1
                else answers.get(fields[0].get("id")),
                "answered_by": _role(view, holder.group(1))
                if holder
                else (Who(str(answered)) if answered else None),
                "reason": answers.get("reason") or request.get("note"),
            }
        )
    return found


def _event_role(view: View, event: Mapping[str, Any]) -> Who:
    identity = event.get("identity") or {}
    return _role(view, identity.get("session_id"), identity.get("agent_id"))


def card(view: View, reference: str) -> dict[str, Any]:
    """One item's fields as a check names them, from the read tools' answers."""

    reference = reference.upper()
    if reference in view.cards:
        return view.cards[reference]
    page = _page(view, reference)
    events = [event for event in page.get("events") or () if view.before_judging(event.get("at"))]
    state = page.get("state") or {}
    summary = page.get("summary") or {}
    requests = _requests(view, reference)
    reviews = [item for item in requests if item["purpose"] == "review"]
    created = next((event for event in events if event.get("action") == "created"), None)
    closing = [event for event in events if event.get("action") == "transitioned"]
    split = [event for event in events if event.get("action") == "split_from"]
    found = {
        "reference": page.get("reference"),
        "kind": page.get("kind"),
        "category": state.get("category"),
        "title": page.get("title"),
        "description": page.get("description"),
        "text": f"{page.get('title') or ''}\n\n{page.get('description') or ''}",
        "parent": page.get("parent"),
        "space": str(page.get("reference") or reference).rsplit("-", 1)[0],
        "projects": [project.get("project_id") for project in page.get("projects") or ()],
        "labels": list(page.get("labels") or ()),
        "acceptance": (page.get("acceptance") or {}).get("basis"),
        "source": page.get("source") or None,
        "checklist": [
            {"text": step.get("text"), "done": bool(step.get("done"))}
            for step in page.get("checklist") or ()
        ],
        "summary": "\n".join(
            str(summary[name]) for name in ("done", "next", "why", "friction") if summary.get(name)
        )
        or None,
        "to_check": reviews[-1]["prompt"] if reviews else None,
        "links": [
            {"kind": link.get("kind"), "to": link.get("reference")}
            for link in page.get("links") or ()
            if link.get("direction") == "outgoing"
        ],
        "refs": [
            {"kind": ref.get("kind"), "value": ref.get("value")} for ref in page.get("refs") or ()
        ]
        + [{"kind": "commit", "value": commit.get("hash")} for commit in page.get("commits") or ()],
        "split_from": split[-1].get("detail") if split else None,
        "claimed_by": [
            _event_role(view, event)
            for event in events
            if event.get("action") in ("claimed", "taken_over")
        ],
        "closed_by": _event_role(view, closing[-1])
        if closing and page.get("open") is False
        else None,
        "created_by": _event_role(view, created) if created else None,
        "new": created is not None and view.after_setup(created.get("at")),
        "seeded": created is not None
        and not view.after_setup(created.get("at"))
        and _event_role(view, created) == "setup",
        "_events": events,
        "_requests": requests,
    }
    view.cards[reference] = found
    return found


def _public(fields: Mapping[str, Any]) -> dict[str, Any]:
    return {name: value for name, value in fields.items() if not name.startswith("_")}


def _shown(fields: Mapping[str, Any], where: object) -> str:
    names = list(where) if isinstance(where, Mapping) else []
    return json.dumps(
        {"reference": fields.get("reference"), **{name: fields.get(name) for name in names}},
        ensure_ascii=False,
        default=str,
    )


# --- the checks -------------------------------------------------------------------------


def _counted(found: Sequence[Any], check: Mapping[str, Any], default: object) -> bool:
    return _count(len(found), check.get("count", default))


def _check_item(view: View, check: Mapping[str, Any]) -> Outcome:
    fields = card(view, str(check["item"]))
    passed = holds(fields, check.get("where") or {})
    return Outcome(PASSED if passed else FAILED, _shown(fields, check.get("where")))


def _matching_items(view: View, where: object) -> list[dict[str, Any]]:
    return [
        fields
        for fields in (card(view, reference) for reference in _references(view))
        if holds(fields, where or {})
    ]


def _check_items(view: View, check: Mapping[str, Any]) -> Outcome:
    found = _matching_items(view, check.get("where"))
    if check.get("as") and found:
        view.names[str(check["as"])] = str(found[0]["reference"])
    passed = _counted(found, check, {"min": 1})
    listed = ", ".join(str(item["reference"]) for item in found) or "none"
    return Outcome(PASSED if passed else FAILED, f"{len(found)} matching: {listed}")


def _on(view: View, check: Mapping[str, Any]) -> list[str]:
    return [str(check["on"])] if check.get("on") else _references(view)


def _check_requests(view: View, check: Mapping[str, Any]) -> Outcome:
    found = [
        request
        for reference in _on(view, check)
        for request in card(view, reference)["_requests"]
        if holds(request, check.get("where") or {})
    ]
    passed = _counted(found, check, {"min": 1})
    shown = [{"id": item["id"], "kind": item["kind"], "by": item["by"]} for item in found]
    return Outcome(PASSED if passed else FAILED, f"{len(found)} matching: {json.dumps(shown)}")


def _check_comments(view: View, check: Mapping[str, Any]) -> Outcome:
    found = [
        comment
        for reference in _on(view, check)
        for comment in _comments(view, reference)
        if holds(comment, check.get("where") or {})
    ]
    passed = _counted(found, check, {"min": 1})
    shown = [{"id": item["id"], "by": item["by"], "text": item["text"][:80]} for item in found]
    return Outcome(
        PASSED if passed else FAILED,
        f"{len(found)} matching: {json.dumps(shown, ensure_ascii=False)}",
    )


def _check_spaces(view: View, check: Mapping[str, Any]) -> Outcome:
    answer = view.tools().call("list_planning_spaces", {})
    with view.recorded() as conn:
        made = dict(conn.execute("SELECT key, created_at FROM planning_spaces").fetchall())
    spaces = [
        {
            "key": space.get("key"),
            "name": space.get("name"),
            "new": view.after_setup(made.get(space.get("key"))),
        }
        for space in answer.get("planning_spaces") or ()
    ]
    found = [space for space in spaces if holds(space, check.get("where") or {})]
    if check.get("as") and found:
        view.names[str(check["as"])] = str(found[0]["key"])
    passed = _counted(found, check, {"min": 1})
    listed = ", ".join(str(space["key"]) for space in found) or "none"
    return Outcome(PASSED if passed else FAILED, f"{len(found)} matching: {listed}")


def _check_writes(view: View, check: Mapping[str, Any]) -> Outcome:
    """The writes since the setup: each event of an item's history, and each comment,
    which the history does not list."""

    writes: list[dict[str, Any]] = []
    for reference in _references(view):
        fields = card(view, reference)
        writes.extend(
            {"by": _event_role(view, event), "item": reference, "action": event.get("action")}
            for event in fields["_events"]
            if view.after_setup(event.get("at"))
        )
        writes.extend(
            {"by": comment["by"], "item": reference, "action": "commented"}
            for comment in _comments(view, reference)
            if comment["new"]
        )
    found = [write for write in writes if holds(write, check.get("where") or {})]
    passed = _counted(found, check, {"min": 1})
    shown = sorted({f"{write['item']} {write['action']} by {write['by']}" for write in found})
    return Outcome(PASSED if passed else FAILED, f"{len(found)} matching: {'; '.join(shown)}")


def _record_calls(view: View) -> list[Call]:
    """The record's calls, and after them a Codex subagent's, which only the store has."""

    calls = list(view.transcript.calls)
    threads = sorted(view.transcript.threads | view.children)
    if view.record.session["client"] == "codex" and threads:
        with view.recorded() as conn:
            rows = conn.execute(
                "SELECT tool FROM execution_events WHERE tool IS NOT NULL AND session_id IN"
                f" ({','.join('?' * len(threads))}) ORDER BY id",
                threads,
            ).fetchall()
        for (tool,) in rows:
            calls.append(Call(len(calls), str(tool), True, False, Who("subagent"), None))
    return calls


def _target(view: View, call: Call) -> str | None:
    if call.args is None:
        return None
    for name in ("id", "work_item_id"):
        value = call.args.get(name)
        if isinstance(value, str) and value:
            return _reference_of(view, value)
    if isinstance(call.result, Mapping) and isinstance(call.result.get("reference"), str):
        return str(call.result["reference"]).upper()
    return None


def _reference_of(view: View, value: str) -> str:
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9]*-\d+", value):
        return value.upper()
    with view.recorded() as conn:
        row = conn.execute(
            "SELECT s.key || '-' || w.number FROM work_items w JOIN planning_spaces s"
            " ON s.planning_space_id = w.planning_space_id WHERE w.work_item_id = ?",
            (value,),
        ).fetchone()
    return str(row[0]) if row else value


def call_matches(view: View, call: Call, pattern: Mapping[str, Any]) -> bool:
    """Whether a call fits a pattern; one whose arguments the record lacks cannot be told."""

    if "any" in pattern:
        return any(call_matches(view, call, item) for item in pattern["any"])
    tool = pattern.get("tool")
    if tool == FILE_CHANGE:
        if not call.file_change:
            return False
    elif tool is not None and (not call.valkama or not holds(call.tool, tool)):
        return False
    if "by" in pattern and call.by != pattern["by"]:
        return False
    if "target" in pattern and _target(view, call) != str(pattern["target"]).upper():
        return False
    if "args" in pattern:
        if call.args is None:
            raise UnsettledError(
                f"the record names {call.tool} by a subagent without its arguments"
            )
        return all(holds(call.args.get(name), wanted) for name, wanted in pattern["args"].items())
    return True


def _first(view: View, calls: Sequence[Call], pattern: Mapping[str, Any]) -> Call | None:
    return next((call for call in calls if call_matches(view, call, pattern)), None)


def _scoped(view: View, check: Mapping[str, Any]) -> list[Call]:
    calls = _record_calls(view)
    if "after" in check:
        anchor = _first(view, calls, check["after"])
        calls = [] if anchor is None else [call for call in calls if call.index > anchor.index]
    if "before" in check:
        anchor = _first(view, calls, check["before"])
        if anchor is not None:
            calls = [call for call in calls if call.index < anchor.index]
    return calls


def _pattern(check: Mapping[str, Any]) -> dict[str, Any]:
    keys = ("tool", "by", "target", "args", "any")
    return {name: check[name] for name in keys if name in check}


def _listed(calls: Sequence[Call]) -> str:
    return ", ".join(f"{call.index}:{call.tool}" for call in calls[:12]) or "none"


def _check_call(view: View, check: Mapping[str, Any]) -> Outcome:
    found = [call for call in _scoped(view, check) if call_matches(view, call, _pattern(check))]
    passed = _counted(found, check, {"min": 1})
    return Outcome(PASSED if passed else FAILED, f"{len(found)} matching: {_listed(found)}")


def _check_no_call(view: View, check: Mapping[str, Any]) -> Outcome:
    found = [call for call in _scoped(view, check) if call_matches(view, call, _pattern(check))]
    return Outcome(FAILED if found else PASSED, f"{len(found)} matching: {_listed(found)}")


def _check_order(view: View, check: Mapping[str, Any]) -> Outcome:
    calls = _record_calls(view)
    first = _first(view, calls, check["first"])
    if first is None:
        return Outcome(FAILED, "no call matches first")
    earlier = [
        call
        for call in calls
        if call.index < first.index and call_matches(view, call, check["then"])
    ]
    evidence = f"first at {first.index}:{first.tool}; earlier then: {_listed(earlier)}"
    return Outcome(FAILED if earlier else PASSED, evidence)


def _check_answer(view: View, check: Mapping[str, Any]) -> Outcome:
    answer = view.transcript.answer
    if answer is None:
        return Outcome(FAILED, "the last turn gave no answer")
    passed = (
        ("contains" not in check or check["contains"] in answer)
        and ("matches" not in check or re.search(check["matches"], answer) is not None)
        and ("not_matches" not in check or re.search(check["not_matches"], answer) is None)
    )
    return Outcome(PASSED if passed else FAILED, answer[:300])


def _check_skill_loaded(view: View, check: Mapping[str, Any]) -> Outcome:
    loaded = view.transcript.skill
    if loaded is None:
        if view.record.session["client"] == "codex":
            return Outcome(NOT_CONFIRMED, "no read of the skill's SKILL.md in the record")
        return Outcome(FAILED, "no Skill call of valkama in the record")
    if "before" in check:
        anchor = _first(view, _record_calls(view), check["before"])
        if anchor is not None and anchor.index < loaded:
            return Outcome(FAILED, f"{view.transcript.skill_evidence}; after call {anchor.index}")
    return Outcome(PASSED, view.transcript.skill_evidence)


def _check_subagents(view: View, check: Mapping[str, Any]) -> Outcome:
    found = view.transcript.subagents
    passed = _counted(found, check, {"min": 1})
    return Outcome(PASSED if passed else FAILED, f"{len(found)} launched")


def _check_subagent_reports(view: View, check: Mapping[str, Any]) -> Outcome:
    reports = view.transcript.reports
    wanted = check.get("each") or []
    failing = [
        index
        for index, report in enumerate(reports)
        if not all(holds(report, condition) for condition in wanted)
    ]
    passed = _counted(reports, check, {"min": 1}) and not failing
    return Outcome(
        PASSED if passed else FAILED, f"{len(reports)} report(s); not meeting each: {failing}"
    )


def _hook_output(record: Record, check: Mapping[str, Any]) -> bool:
    for line in record.lines():
        if line.get("subtype") == "hook_response" and line.get("hook_event") == check["event"]:
            text = f"{line.get('stdout') or ''}{line.get('output') or ''}"
            if check["contains"] in text:
                return True
    return False


def _file(record: Record, check: Mapping[str, Any]) -> bool:
    path = Path(check["path"])
    if not path.is_absolute():
        path = record.directory / "workspace" / path
    if not path.is_file():
        return check.get("exists") is False
    text = path.read_text(encoding="utf-8", errors="replace")
    return (
        check.get("exists", True) is not False
        and check.get("contains", "") in text
        and ("not_contains" not in check or check["not_contains"] not in text)
        and ("matches" not in check or re.search(check["matches"], text) is not None)
    )


def _session(record: Record, check: Mapping[str, Any]) -> bool:
    """The session's event, written by a hook straight into the copy, and its session row.

    Straight in, because an event a hook could not write waits in the spool only
    until the next server start drains it: the MCP server a client starts right
    after its session start does. An empty spool then says nothing about which
    hook ran; the delivery does.
    """

    identifier = record.session.get("session_id")
    if identifier is None:
        return False
    with contextlib.closing(record.store()) as conn:
        event = conn.execute(
            "SELECT 1 FROM execution_events WHERE kind = ? AND session_id = ?"
            " AND delivery = 'direct'",
            (check["event"], identifier),
        ).fetchone()
        row = conn.execute(
            "SELECT 1 FROM sessions WHERE id = ? AND client = ?", (identifier, check["client"])
        ).fetchone()
    return event is not None and row is not None


def _dir_empty(_record: Record, check: Mapping[str, Any]) -> bool:
    path = Path(check["path"])
    return not path.is_dir() or not any(path.iterdir())


def _handshake(record: Record, check: Mapping[str, Any]) -> bool:
    found = probes._read_json(record.directory / "handshake.json").get("answer") or {}
    return check["contains"] in str(found.get("instructions") or "")


#: The tools that only read. The store records a call of the others, never of these.
READ_TOOLS = frozenset(
    tool["name"] for tool in planning_tools.TOOLS if tool["annotations"].get("readOnlyHint")
)


def _check_first_call(view: View, check: Mapping[str, Any]) -> Outcome:
    """The session's first Valkama write as the store recorded it, and whose it is.

    The store records writes only. A session whose Valkama calls all read, or that
    made none, leaves nothing to confirm: the check holds and says so.
    """

    record = view.record
    with contextlib.closing(record.store()) as conn:
        found = conn.execute(
            "SELECT tool, identity_state, session_id FROM execution_events"
            " WHERE id > ? AND tool IS NOT NULL ORDER BY id LIMIT 1",
            (record.session.get("setup_last_event", 0),),
        ).fetchone()
    if found is None:
        writes = [
            call.tool
            for call in view.transcript.calls
            if call.valkama and call.tool not in READ_TOOLS
        ]
        if writes:
            return Outcome(FAILED, f"the store recorded none of the session's writes: {writes}")
        return Outcome(PASSED, "the session made no Valkama write: nothing to confirm")
    tool, identity, session = found
    passed = identity == check["identity"] and session == record.session.get("session_id")
    shown = {
        "tool": tool,
        "identity": identity,
        "own_session": session == record.session.get("session_id"),
    }
    return Outcome(PASSED if passed else FAILED, json.dumps(shown))


def _flag(
    function: Callable[[Record, Mapping[str, Any]], bool],
) -> Callable[[View, Mapping[str, Any]], Outcome]:
    """A check of the record that says yes or no, with what it was asked as its evidence."""

    def check(view: View, found: Mapping[str, Any]) -> Outcome:
        passed = function(view.record, found)
        shown = {key: value for key, value in found.items() if key not in ("check", "clients")}
        return Outcome(PASSED if passed else FAILED, json.dumps(shown, ensure_ascii=False))

    return check


def _output(argv: Sequence[str], environment: Mapping[str, str], cwd: Path) -> str:
    """What a command prints on stdout, decoded as UTF-8; a failure is refused with its stderr."""

    try:
        done = subprocess.run(
            list(argv),
            cwd=cwd,
            env=dict(environment),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            creationflags=processes.NO_WINDOW,
            timeout=probes.COMMAND_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise probes.ProbeError(f"{argv[0]} did not run: {error}") from error
    if done.returncode != 0:
        said = done.stderr.decode("utf-8", errors="replace").strip()
        raise probes.ProbeError(f"{' '.join(argv)} in {cwd} failed: {said[-400:]}")
    return done.stdout.decode("utf-8", errors="replace")


def _git(repository: Path, *arguments: str) -> str:
    # The user's Git configuration has no say in what a repository holds.
    environment = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
    argv = ["git", "-c", "core.quotepath=off", "--no-optional-locks", *arguments]
    return _output(argv, environment, repository)


def _written(path: str) -> bool:
    return not NOT_WRITTEN & set(Path(path).parts)


def git_state(repository: Path, path: str | None) -> dict[str, Any]:
    """What a repository holds since its first commit: changed paths, the diff and the commits."""

    first = _git(repository, "rev-list", "--max-parents=0", "HEAD").split()[-1]
    narrow = ["--", path] if path else []
    changed = list(_git(repository, "diff", "--name-only", first, *narrow).splitlines())
    untracked = [
        line
        for line in _git(
            repository, "ls-files", "--others", "--exclude-standard", *narrow
        ).splitlines()
        if _written(line)
    ]
    diff = _git(repository, "diff", first, *narrow)
    for name in untracked:
        text = (repository / name).read_text(encoding="utf-8", errors="replace")
        added = "".join(f"+{line}\n" for line in text.splitlines())
        diff += f"diff --git a/{name} b/{name}\nnew file\n--- /dev/null\n+++ b/{name}\n{added}"
    log = _git(repository, "log", "--format=%s", f"{first}..HEAD")
    return {
        "changed": sorted({*changed, *untracked}),
        "diff": diff,
        "commits": log.splitlines(),
    }


def _workspace(view: View) -> Path:
    return view.record.directory / "workspace"


def _check_git(view: View, check: Mapping[str, Any]) -> Outcome:
    state = git_state((_workspace(view) / str(check["repo"])).resolve(), check.get("path"))
    passed = all(
        holds(state[name], check[name]) for name in ("changed", "diff", "commits") if name in check
    )
    if "clean" in check:
        passed = passed and (not state["changed"]) is bool(check["clean"])
    shown = {"changed": state["changed"], "commits": state["commits"]}
    return Outcome(PASSED if passed else FAILED, json.dumps(shown, ensure_ascii=False))


def _files(root: Path) -> list[str]:
    return sorted(
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and _written(path.relative_to(root).as_posix())
    )


def _check_grep(view: View, check: Mapping[str, Any]) -> Outcome:
    root = (_workspace(view) / str(check["repo"])).resolve()
    pattern = re.compile(str(check["pattern"]))
    found: list[str] = []
    for name in _files(root):
        if not fnmatch.fnmatch(Path(name).name, str(check.get("glob") or "*")):
            continue
        text = (root / name).read_text(encoding="utf-8", errors="replace")
        found.extend(
            f"{name}: {line.strip()}" for line in text.splitlines() if pattern.search(line)
        )
    passed = _counted(found, check, {"min": 1})
    return Outcome(PASSED if passed else FAILED, f"{len(found)} line(s): {found[:5]}")


def _check_new_files(view: View, check: Mapping[str, Any]) -> Outcome:
    before = set(_files(view.scenario.workspace))
    if view.scenario.overlay is not None:
        before |= set(_files(view.scenario.overlay))
    found = [name for name in _files(_workspace(view)) if name not in before]
    passed = holds(found, check.get("where") or {})
    return Outcome(PASSED if passed else FAILED, json.dumps(found, ensure_ascii=False))


def _check_command(view: View, check: Mapping[str, Any]) -> Outcome:
    argv = [str(word) for word in check["run"]]
    if argv and argv[0] == "python":
        argv[0] = sys.executable
    environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    code, output = probes._run_command(
        argv, environment, cwd=(_workspace(view) / str(check.get("cwd") or ".")).resolve()
    )
    passed = code == check.get("exit", 0)
    return Outcome(PASSED if passed else FAILED, f"exit {code}: {output.strip()[-300:]}")


def _space_of(binding: object) -> str | None:
    if not isinstance(binding, Mapping):
        return None
    with contextlib.suppress(ContractError, KeyError, TypeError):
        named = {"kind": binding["kind"], "resource_id": binding["resource_id"]}
        return str(planning_space_ref(named)["space_key"])
    return None


def _check_registry(view: View, check: Mapping[str, Any]) -> Outcome:
    kept = view.record.directory / "registry"
    if not kept.is_dir():
        raise UnsettledError("the record keeps no copy of the profile's registry")
    home = view.work / "registry-home"
    if home.exists():
        probes.remove_tree(home)
    shutil.copytree(kept, home / "AppData" / "Local" / "Valkama")
    argv = [sys.executable, str(probes.ENTRY), "projects", "list"]
    listed = json.loads(_output(argv, isolated.isolated_environment(home), probes.ROOT))
    projects = [
        {
            "project": entry.get("project_id"),
            "root": entry.get("canonical_root"),
            "space": _space_of(entry.get("planning_binding")),
        }
        for entry in listed.get("projects") or ()
    ]
    where = dict(check.get("where") or {})
    if isinstance(where.get("root"), str):
        root = os.path.normcase(os.path.normpath(where.pop("root")))
        projects_found = [
            item
            for item in projects
            if os.path.normcase(os.path.normpath(str(item["root"]))) == root
        ]
    else:
        projects_found = projects
    found = [item for item in projects_found if holds(item, where)]
    passed = _counted(found, check, {"min": 1})
    return Outcome(PASSED if passed else FAILED, json.dumps(found, ensure_ascii=False))


def _check_any(view: View, check: Mapping[str, Any]) -> Outcome:
    outcomes = [evaluate(view, item) for item in check["of"]]
    evidence = " | ".join(f"{item.result}: {item.evidence}" for item in outcomes)
    if any(item.result == PASSED for item in outcomes):
        return Outcome(PASSED, evidence)
    if any(item.result == NOT_CONFIRMED for item in outcomes):
        return Outcome(NOT_CONFIRMED, evidence)
    return Outcome(FAILED, evidence)


#: How each kind of check is judged. `tests.test_agent_probes_judge` holds this to
#: the kinds the scenario loader takes, and to the kinds the scenario format names.
CHECKS: dict[str, Callable[[View, Mapping[str, Any]], Outcome]] = {
    "item": _check_item,
    "items": _check_items,
    "requests": _check_requests,
    "comments": _check_comments,
    "spaces": _check_spaces,
    "writes": _check_writes,
    "session": _flag(_session),
    "first_call": _check_first_call,
    "call": _check_call,
    "no_call": _check_no_call,
    "order": _check_order,
    "answer": _check_answer,
    "skill_loaded": _check_skill_loaded,
    "subagents": _check_subagents,
    "subagent_reports": _check_subagent_reports,
    "hook_output": _flag(_hook_output),
    "file": _flag(_file),
    "git": _check_git,
    "grep": _check_grep,
    "new_files": _check_new_files,
    "command": _check_command,
    "handshake": _flag(_handshake),
    "dir_empty": _flag(_dir_empty),
    "registry": _check_registry,
    "any": _check_any,
}


def evaluate(view: View, check: Mapping[str, Any]) -> Outcome:
    """One check's result and evidence; a kind the judge does not know is refused by name."""

    kind = check.get("check")
    judge = CHECKS.get(str(kind))
    if judge is None:
        raise probes.ProbeError(f"the judge knows no kind of check {kind!r}")
    if kind == "any":
        return judge(view, check)
    try:
        return judge(view, probes.substitute(dict(check), view.names))
    except UnsettledError as error:
        return Outcome(NOT_CONFIRMED, str(error))
    except (probes.ProbeError, probes.McpError, OSError, re.error, sqlite3.Error) as error:
        return Outcome(FAILED, f"could not be judged: {error}")


def decides(check: Mapping[str, Any]) -> bool:
    """Whether a check's result counts towards its probe: skill loading never does."""

    return not check.get("record_only") and check.get("check") != "skill_loaded"


# --- rubrics ----------------------------------------------------------------------------


def _review_shows(view: View, shows: Sequence[str]) -> list[str]:
    parts = []
    for shown in shows:
        if shown == "answer":
            parts.append(f"## Answer\n\n{view.transcript.answer or '(no answer)'}\n")
        elif shown == "subagent_reports":
            reports = view.transcript.reports or ["(no report)"]
            parts.extend(
                f"## Subagent report {index}\n\n{text}\n" for index, text in enumerate(reports, 1)
            )
        else:
            reference = probes.substitute(shown.removeprefix("item:"), view.names)
            fields = _public(card(view, reference))
            fields["comments"] = [
                {key: comment[key] for key in ("by", "text")}
                for comment in _comments(view, reference)
            ]
            fields["questions"] = [
                {key: request[key] for key in ("kind", "prompt", "fields", "answer")}
                for request in card(view, reference)["_requests"]
            ]
            body = json.dumps(fields, ensure_ascii=False, indent=1, default=str)
            parts.append(f"## Item {reference}\n\n```json\n{body}\n```\n")
    return parts


def review(view: View, probe: str, rubric: Mapping[str, Any], directory: Path) -> Outcome:
    """Write the reviewer's file for a rubric and read back the answer beside it, if any.

    The file shows what the rubric names and nothing of the agent's record. The
    answer is `<probe>.answer.json`: `{"lines": [{"met": bool, "quote": str}]}`, one
    per line of the rubric, in order.
    """

    lines = [str(line) for line in rubric.get("lines") or ()]
    try:
        shown = _review_shows(view, [str(item) for item in rubric.get("shows") or ()])
    except (UnsettledError, probes.ProbeError, probes.McpError) as error:
        return Outcome(NOT_CONFIRMED, f"the reviewer's file could not be made: {error}")
    directory.mkdir(parents=True, exist_ok=True)
    asked = directory / f"{probe}.md"
    numbered = "".join(f"{index}. {line}\n" for index, line in enumerate(lines, 1))
    asked.write_text(
        f"# {probe}\n\nSay of each line whether it holds, with a quote.\n\n{numbered}\n"
        + "\n".join(shown),
        encoding="utf-8",
        newline="\n",
    )
    answer = directory / f"{probe}.answer.json"
    if not answer.is_file():
        return Outcome(NOT_CONFIRMED, f"awaits the reviewer: {asked}")
    given = probes._read_json(answer).get("lines") or []
    if len(given) != len(lines):
        return Outcome(NOT_CONFIRMED, f"{answer} answers {len(given)} of {len(lines)} lines")
    unmet = [index for index, line in enumerate(given, 1) if not line.get("met")]
    return Outcome(FAILED if unmet else PASSED, f"{answer}: lines not met {unmet}")


# --- one session, and the run ---------------------------------------------------------------


def _verdict(results: Sequence[Mapping[str, Any]]) -> str:
    deciding = [item["result"] for item in results if item["decides"]]
    if FAILED in deciding:
        return FAILED
    if NOT_CONFIRMED in deciding:
        return NOT_CONFIRMED
    return PASSED


def _models(record: Record, transcript: Transcript) -> list[str]:
    models = list(transcript.models)
    with contextlib.suppress(sqlite3.Error, OSError):
        with contextlib.closing(record.store()) as conn:
            rows = conn.execute(
                "SELECT DISTINCT model FROM execution_events WHERE session_id = ?"
                " AND model IS NOT NULL ORDER BY id",
                (record.session.get("session_id"),),
            ).fetchall()
        models.extend(str(row[0]) for row in rows if str(row[0]) not in models)
    return models


def judge_session(
    record: Record, scenario: probes.Scenario, work: Path, review_dir: Path
) -> dict[str, Any]:
    """Every probe of one recorded session, with its checks' results, evidence and tokens."""

    session = record.session
    transcript = read_transcript(record)
    tokens = dict(transcript.tokens)
    found: dict[str, Any] = {
        "scenario": scenario.id,
        "client": session["client"],
        "session_id": session.get("session_id"),
        "models": [],
        "tokens": tokens,
        "failures": session.get("failures") or [],
        "probes": [],
    }
    if found["failures"]:
        detail = "; ".join(f"{item['stage']}: {item['detail']}" for item in found["failures"])
        for probe in scenario.expect:
            found["probes"].append(
                {
                    "probe": probe,
                    "verdict": ENVIRONMENT,
                    "evidence": detail,
                    "checks": [],
                    "tokens": tokens,
                }
            )
        return found
    found["models"] = _models(record, transcript)
    if work.exists() and not probes.remove_tree(work):
        raise probes.ProbeError(f"could not clear {work}")
    work.mkdir(parents=True)
    store = Store(record, work) if (record.directory / "store.sqlite3").is_file() else None
    try:
        view = View(
            record=record,
            scenario=scenario,
            transcript=transcript,
            names=record.names(),
            store=store,
            boundary=_boundary(record),
            children=_children(record),
            work=work,
        )
        for probe, checks in scenario.expect.items():
            results = []
            for check in checks:
                if session["client"] not in check.get("clients", probes.CLIENTS):
                    continue
                outcome = evaluate(view, check)
                results.append(
                    {
                        "check": check["check"],
                        "result": outcome.result,
                        "decides": decides(check),
                        "evidence": outcome.evidence,
                    }
                )
            entry: dict[str, Any] = {"probe": probe, "checks": results, "tokens": tokens}
            rubric = scenario.rubric.get(probe)
            if rubric:
                outcome = review(view, probe, rubric, review_dir)
                entry["rubric"] = {"result": outcome.result, "evidence": outcome.evidence}
                results = [*results, {"result": outcome.result, "decides": True}]
            entry["verdict"] = _verdict(results)
            found["probes"].append(entry)
    finally:
        if store is not None:
            store.close()
        probes.remove_tree(work)
    return found


def judge(out: Path) -> int:
    """Judge every session `run.json` names; 0 when every probe passed."""

    run = probes._read_json(out / "run.json")
    if not run:
        raise probes.ProbeError(f"{out} holds no run.json of a probe run")
    scenarios = {item.id: item for item in probes.load_cases(Path(run["cases"]), None)}
    sessions = []
    started = time.monotonic()
    for entry in run.get("sessions") or ():
        scenario = scenarios.get(entry["scenario"])
        if scenario is None:
            raise probes.ProbeError(f"no scenario {entry['scenario']} in {run['cases']}")
        directory = out / entry["record"]
        record = Record.read(directory)
        name = Path(entry["record"])
        judged = judge_session(
            record,
            scenario,
            out / WORK / name,
            out / REVIEW / scenario.name / record.session["client"],
        )
        judged["record"] = name.as_posix()
        judged["version"] = (run.get("versions") or {}).get(record.session["client"])
        sessions.append(judged)
        for probe in judged["probes"]:
            probes._say(f"{scenario.id} {judged['client']} {probe['probe']}: {probe['verdict']}")
    if (out / WORK).exists():
        probes.remove_tree(out / WORK)
    verdicts = [probe["verdict"] for item in sessions for probe in item["probes"]]
    totals = {verdict: verdicts.count(verdict) for verdict in dict.fromkeys(verdicts)}
    # A run writes its record as it goes; one written before `finished` came in
    # wrote it only at its end.
    finished = run.get("finished", True)
    if not finished:
        probes._say(f"the run was cut short: {len(sessions)} session(s) recorded")
    probes._write_json(
        out / REPORT,
        {
            "head": run.get("head"),
            "finished": finished,
            "cases": run.get("cases"),
            "versions": run.get("versions"),
            "seconds": round(time.monotonic() - started, 1),
            "totals": totals,
            "sessions": sessions,
        },
    )
    probes._say(
        f"{len(verdicts)} probe(s): {json.dumps(totals, ensure_ascii=False)}; {out / REPORT}"
    )
    return 0 if finished and verdicts and all(verdict == PASSED for verdict in verdicts) else 1


# --- the scenario format ----------------------------------------------------------------


def format_kinds(text: str) -> set[str]:
    """The kinds of check a scenario format's document names: the names in the first cell
    of each row of the table that has a row of `item`."""

    tables: list[list[str]] = []
    current: list[str] = []
    for line in text.splitlines():
        if line.lstrip().startswith("|"):
            current.append(line)
        elif current:
            tables.append(current)
            current = []
    if current:
        tables.append(current)
    for table in tables:
        cells = [row.strip().strip("|").split("|")[0] for row in table]
        named = [re.findall(r"`([a-z_]+)`", cell) for cell in cells]
        if ["item"] in named:
            return {name for names in named for name in names}
    return set()
