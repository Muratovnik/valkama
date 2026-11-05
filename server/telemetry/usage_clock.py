"""What was work between two records of one run, and what was not.

The gap between neighbouring records counts as work, except:

| Left out as | When |
|---|---|
| `human` | a turn ended and the next thing is a person's prompt; a question to a person (`AskUserQuestion`, `request_user_input`) from its call to its answer; a permission request (`attention`) until the call goes on |
| `subagent` | a turn ended and the next thing is a subagent's notice or message, or a foreground subagent call. That time is in the subagent's own segments. A subagent with no transcript of its own has nobody else to carry it, so it counts here instead |
| `external` | after `system/api_error` until the next reply, and a model wait over `MODEL_WAIT_LIMIT_SECONDS` |
| `gap` | what lies in a hole between liveness intervals, and everything between the last record of a run that fell (a prompt arrives with a tool call unanswered) and the next one: nothing is built on a run's end |

A script counts: the gap from a tool call to its result does, and so does a background
command from its start to its notice, even when the turn ended meanwhile. That second
one is only known at the notice, and a command may end without one, as a server killed
with its session does. So what a command's turn left out is kept in `pending` while one
runs, and what its span covers turns into work when its notice arrives. Without a
notice it stays left out: a background wait never reaches past a run's records.

Time only moves forward. A record older than the newest one seen moves nothing, and one
over `LATE_SECONDS` older changes no state either: a resume writes old records again
under their old time, and every one of those was over a minute behind. Of 270,000
assistant records that held for all but 218, which are counted but take no time.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

from . import liveness
from .usage_ledger import Ledger
from .usage_steps import (
    AGENT,
    FAILURE,
    NOTICE,
    NOTIFIED,
    PEER,
    PROMPT,
    REPLY,
    RESULT,
    SCRIPT,
    SERVICE,
    Step,
)

WORK = "work"
HUMAN = "human"
SUBAGENT = "subagent"
EXTERNAL = "external"
GAP = "gap"
LEFT_OUT = (HUMAN, SUBAGENT, EXTERNAL, GAP)

#: A model wait longer than this is a failure outside the work. Of 272 waits over 100 s,
#: 255 ended within 600 s with a median of 13,408 output tokens for those under 300 s;
#: none ended between 600 s and 900 s; the 17 over 900 s had a median of 264 tokens.
MODEL_WAIT_LIMIT_SECONDS = 600.0
LATE_SECONDS = 60.0
#: A turn's end is written over a few records, hooks running between them. A record later
#: than this after the end is not more of the ending: a person came back, and it may be
#: a rollout's next turn, which need not say it started.
_ENDING_SECONDS = 60.0

_MOST_PENDING = 64
_MOST_BACKGROUND = 64

_IDLE = "idle"
_BUSY = "busy"
_FINISHING = "finishing"
_FAILED = "failed"


class Clock:
    """One run's reader of time. `feed` it steps and marks in order; `state` is all it keeps."""

    def __init__(
        self,
        state: dict,
        coverage: liveness.Coverage,
        ledger: Ledger,
        keeps_transcript: Callable[[str], bool],
    ) -> None:
        self.high: float | None = state.get("high")
        self.first: float | None = state.get("first")
        self.phase: str = state.get("phase", _IDLE)
        self.asking: bool = state.get("asking", False)
        self.open: dict[str, str] = state.get("open", {})
        self.background: dict[str, dict] = state.get("background", {})
        self.pending: list[list] = state.get("pending", [])
        self.left_out: dict[str, float] = state.get("left_out", dict.fromkeys(LEFT_OUT, 0.0))
        self.coverage = coverage
        self.ledger = ledger
        self.keeps_transcript = keeps_transcript
        self._handlers: dict[str, Callable[[Step], None]] = {
            SERVICE: self._on_service,
            NOTIFIED: self._on_notified,
            NOTICE: self._on_notice,
            PEER: self._on_peer,
            PROMPT: self._on_prompt,
            RESULT: self._on_result,
            REPLY: self._on_reply,
            FAILURE: self._on_failure,
        }

    def state(self) -> dict:
        return {
            "high": self.high,
            "first": self.first,
            "phase": self.phase,
            "asking": self.asking,
            "open": self.open,
            "background": self.background,
            "pending": self.pending,
            "left_out": self.left_out,
        }

    def feed(self, step: Step) -> None:
        if self.high is None:
            self.first = self.high = step.at
            self.ledger.new_turn(step.at)
        elif step.at < self.high - LATE_SECONDS:
            self.ledger.count(step)
            return
        self._handlers[step.kind](step)

    def mark_write(self, at: float, item: str) -> None:
        """The agent wrote to `item`: what came before it in this turn goes there."""

        if self.phase in (_BUSY, _FAILED):
            self._to(at, self._running_class(at))
        self.ledger.wrote(item)

    def mark_attention(self, at: float) -> None:
        """A client asked a person for something while a call waits: time stops counting."""

        if self.open:
            self._to(at, self._tools_class(()))
            self.asking = True

    def _to(self, at: float, klass: str) -> None:
        start = self.high
        if start is not None and at > start:
            self._span(start, at, klass)
            self.high = at

    def _span(self, start: float, end: float, klass: str) -> None:
        parts, dark = self.coverage.split(start, end)
        if klass == WORK:
            for part_start, part_end, quality in parts:
                self.ledger.work(part_start, part_end, quality)
            self.left_out[GAP] += dark
            return
        holes = self.coverage.holes_within(start, end)
        self.left_out[GAP] += holes if klass != GAP else end - start
        if klass != GAP:
            self.left_out[klass] += end - start - holes
        if klass != GAP and self._script_runs():
            self.pending.append([start, end, klass])
            del self.pending[:-_MOST_PENDING]

    def _script_runs(self) -> bool:
        return any(self._counts_as_script(entry) for entry in self.background.values())

    def _counts_as_script(self, entry: dict) -> bool:
        return entry["kind"] == SCRIPT or not self.keeps_transcript(str(entry.get("task")))

    def _running_class(self, at: float) -> str:
        """What the time since the last record is, with something still expected of the model."""

        if self.open:
            return self._tools_class(())
        if self.phase == _FAILED:
            return EXTERNAL
        start = self.high if self.high is not None else at
        return EXTERNAL if at - start > MODEL_WAIT_LIMIT_SECONDS else WORK

    def _tools_class(self, finished_agents: Iterable[str]) -> str:
        kinds = set(self.open.values())
        if self.asking:
            return HUMAN
        if SCRIPT in kinds:
            return WORK
        if AGENT in kinds:
            lost = any(not self.keeps_transcript(agent) for agent in finished_agents)
            return WORK if lost else SUBAGENT
        return HUMAN

    def _linked(self, links: Iterable[str]) -> str | None:
        """Which background call a notice is about, by either id it may name."""

        for link in links:
            if link in self.background:
                return link
            for call, entry in self.background.items():
                if entry.get("task") == link:
                    return call
        return None

    def _settle(self, call: str | None, at: float, final: bool) -> bool:
        """Say a background call was heard from; whether it was a script. Its wait counts now."""

        if call is None:
            return False
        entry = self.background[call]
        script = self._counts_as_script(entry)
        if script:
            self._reclaim(float(entry["at"]), at)
        if final:
            del self.background[call]
            if not self._script_runs():
                self.pending = []
        return script

    def _reclaim(self, since: float, until: float) -> None:
        kept: list[list] = []
        for start, end, klass in self.pending:
            first, last = max(start, since), min(end, until)
            if last <= first:
                kept.append([start, end, klass])
                continue
            parts, _dark = self.coverage.split(first, last)
            for part_start, part_end, quality in parts:
                self.ledger.work_back(part_start, part_end, quality)
                self.left_out[klass] -= part_end - part_start
            if start < first:
                kept.append([start, first, klass])
            if last < end:
                kept.append([last, end, klass])
        self.pending = kept

    def _came_back(self, at: float) -> bool:
        """Whether a turn that said it ended has gone quiet for longer than ending takes."""

        return (
            self.phase == _FINISHING
            and self.high is not None
            and (at - self.high > _ENDING_SECONDS)
        )

    def _on_service(self, step: Step) -> None:
        if self.phase == _IDLE:
            return
        if self.phase == _FINISHING:
            self._to(step.at, HUMAN if self._came_back(step.at) else WORK)
            self.phase = _IDLE
            return
        self._to(step.at, self._running_class(step.at))

    def _on_notified(self, step: Step) -> None:
        call = self._linked(step.links)
        if call is None:
            return
        script = self._counts_as_script(self.background[call])
        if self.phase in (_IDLE, _FINISHING):
            if script:
                self._to(step.at, WORK)
        else:
            self._to(step.at, self._running_class(step.at))
        self._settle(call, step.at, step.final)

    def _input(self, step: Step, klass: str) -> None:
        """Something that starts a turn arrived, and the time before it was `klass`."""

        self._to(step.at, klass)
        self.phase = _BUSY
        self.asking = False
        self.ledger.new_turn(step.at)

    def _on_notice(self, step: Step) -> None:
        call = self._linked(step.links)
        if self.open:
            self._to(step.at, self._tools_class(()))
            self._settle(call, step.at, step.final)
            return
        script = call is not None and self._counts_as_script(self.background[call])
        self._input(step, WORK if script else SUBAGENT)
        self._settle(call, step.at, step.final)

    def _on_peer(self, step: Step) -> None:
        if self.open:
            self._to(step.at, self._tools_class(()))
        else:
            self._input(step, SUBAGENT)

    def _on_prompt(self, step: Step) -> None:
        klass = GAP if self.open else HUMAN
        self.open = {}
        self._input(step, klass)

    def _on_result(self, step: Step) -> None:
        if self.open:
            self._to(step.at, self._tools_class(step.agents))
        elif self.phase in (_IDLE, _FINISHING):
            self._to(step.at, HUMAN)
        else:
            self._to(step.at, self._running_class(step.at))
        for call in step.closed:
            self.open.pop(call, None)
        for call, entry in step.background.items():
            self.background[call] = {**entry, "at": step.at}
            while len(self.background) > _MOST_BACKGROUND:
                del self.background[next(iter(self.background))]
        self.phase = _BUSY
        self.asking = False

    def _on_reply(self, step: Step) -> None:
        if self.phase == _IDLE or self._came_back(step.at):
            self._input(step, HUMAN)
        elif step.synthetic:
            self._to(step.at, EXTERNAL)
        elif self.phase == _FINISHING:
            self._to(step.at, WORK)
        elif self.open:
            self._to(step.at, self._tools_class(()))
        else:
            self._to(step.at, self._running_class(step.at))
        self.ledger.count(step)
        if step.ends_turn:
            # Nothing can be outstanding once the model has closed its turn.
            self.open = {}
        self.open.update(step.calls)
        self.phase = _FINISHING if step.ends_turn else _BUSY
        self.asking = False

    def _on_failure(self, step: Step) -> None:
        if self.phase in (_IDLE, _FINISHING):
            return
        self._to(step.at, self._running_class(step.at))
        if not self.open:
            self.phase = _FAILED
