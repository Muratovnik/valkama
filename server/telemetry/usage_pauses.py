"""From one run's steps to its model requests, each with the pause before it and what it waited on.

The usage rows (`usage_segments`) add requests up into stretches of work, so what one request
read from the prompt cache after how long a pause is not in them. It is in the steps
(`usage_steps`), and this reads them again, a run at a time, with nothing written anywhere.

A request is what a client's record reports one usage of: a Claude response by its message id,
whose records repeat the usage as it streams (the largest count of each kind is kept), and a
Codex `token_usage_record`, or in an older rollout each `token_count` that moved. An adviser's
part of a request is its own model's and is left out: its cache is not the executor's.

What a request is measured by:

- `sent_at`: when it was sent, which is the moment of the last record before it that was no
  reply: the prompt, the tool result, the notice or the hook's message it answers. With none
  since the request before, the moment of its own first record.
- `pause`: the seconds from the request before it in the same run was sent to this one, the
  age of the cache it could read, since a request reads and writes the cache when it is sent.
  The first request of a run has none.
- `wait`: what the pause waited on, from the last input before the request:

  | `wait` | The last input before the request |
  |---|---|
  | `wake` | a keep-warm wake (`Step.wake`) |
  | `person` | a person's prompt, or the answer to a question put to a person (`AskUserQuestion`, `request_user_input`, `ExitPlanMode`) |
  | `machine` | anything else: a tool's result, a background command's or a subagent's notice, a peer's message, or none |

  Bookkeeping (a stop hook's summary, a hook's other message) and a failed request's error
  change neither: they come after what was waited on. They give `sent_at` only when nothing
  else came since the request before.

- `background`: whether a background command or subagent the run started was still running
  when the request was sent: started by a tool result that said so and not yet ended by a
  notice naming it, for at most `usage_clock.BACKGROUND_LIMIT_SECONDS` from its start, as the
  clock counts one. A Codex rollout says nothing of background work, so there it is None.
- the tokens it sent by kind, which do not overlap: `input` (not cached), `cached_read`, and
  the cache writes `cache_write_5m` and `cache_write_1h` (Codex reports one write kind, kept
  as `cache_write_5m`); and `cost`, its estimate at public API prices, None when unknown.
- `model` and `organization`: the model that answered it and the organization the latest
  record before it named (`usage_steps.ORGANIZATION`).

Time moves forward as it does for the clock: a record over `usage_clock.LATE_SECONDS` older
than the newest seen was written again by a resume and is skipped, and a request already met
in the run counts once.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from .usage_clock import BACKGROUND_LIMIT_SECONDS, LATE_SECONDS
from .usage_collect import chunks, source, steps_of
from .usage_steps import (
    ASKING,
    FAILURE,
    NOTICE,
    NOTIFIED,
    ORGANIZATION,
    PROMPT,
    REPLY,
    RESULT,
    SERVICE,
    SETTING,
    Step,
)
from .usage_targets import CODEX, Target

WAKE = "wake"
PERSON = "person"
MACHINE = "machine"
WAITS = (MACHINE, PERSON, WAKE)

#: The token kinds a request sends, in the order a report lists them.
KINDS = ("input", "cached_read", "cache_write_5m", "cache_write_1h")


@dataclass(slots=True)
class Request:
    """One model request of a run, as the module measures it."""

    sent_at: float
    pause: float | None
    wait: str
    background: bool | None
    model: str
    organization: str | None
    tokens: dict[str, int]
    cost: float | None

    @property
    def context(self) -> int:
        """Every token it sent: what it read from the cache, wrote to it and sent apart."""

        return sum(self.tokens.get(kind, 0) for kind in KINDS)


class _Walk:
    """What the walk over one run's steps carries from one step to the next."""

    def __init__(self, background_known: bool) -> None:
        self.background_known = background_known
        self.newest = float("-inf")
        #: When the next request was sent and what it waited on, from the last input.
        self.input_at: float | None = None
        self.wait = MACHINE
        self.previous_sent: float | None = None
        self.organization: str | None = None
        #: Calls open by id, with what each waits for.
        self.calls: dict[str, str] = {}
        #: Background work running, by a number of its own, with its start; and that number
        #: by every id a notice may name the work by.
        self.running: dict[int, float] = {}
        self.names: dict[str, int] = {}
        self._started = 0
        self.requests: dict[str, Request] = {}
        self.order: list[Request] = []
        self._anonymous = 0

    def step(self, step: Step) -> None:
        if step.at < self.newest - LATE_SECONDS:
            return
        self.newest = max(self.newest, step.at)
        if ORGANIZATION in step.settings:
            self.organization = step.settings[ORGANIZATION]
        if step.kind == SETTING:
            return
        if step.kind != REPLY:
            self._input(step)
            return
        self.calls.update(step.calls)
        part = next((part for part in step.parts if not part.advisor), None)
        if part is None:
            return
        key = step.request
        if key is None:
            self._anonymous += 1
            key = f"#{self._anonymous}"
        known = self.requests.get(key)
        if known is not None:
            for kind, count in part.tokens.items():
                known.tokens[kind] = max(known.tokens.get(kind, 0), count)
            if part.cost is not None and (known.cost is None or part.cost > known.cost):
                known.cost = part.cost
            return
        sent = self.input_at if self.input_at is not None else step.at
        pause = None if self.previous_sent is None else max(0.0, sent - self.previous_sent)
        request = Request(
            sent,
            pause,
            self.wait,
            self._background(sent),
            part.model,
            self.organization,
            dict(part.tokens),
            part.cost,
        )
        self.requests[key] = request
        self.order.append(request)
        self.previous_sent = sent
        self.input_at, self.wait = None, MACHINE

    def _input(self, step: Step) -> None:
        if step.kind in (SERVICE, FAILURE) and not step.wake:
            # Bookkeeping and retries say nothing of what was waited on, and come after what
            # did: the stop hook's summary after a turn's end, an error before its retry.
            if self.input_at is None:
                self.input_at = step.at
            return
        self.input_at = step.at
        if step.wake:
            self.wait = WAKE
        elif step.kind == PROMPT:
            self.wait = PERSON
        elif step.kind == RESULT:
            asked = any(self.calls.pop(call, None) == ASKING for call in step.closed)
            self.wait = PERSON if asked else MACHINE
            for call, started in step.background.items():
                self._started += 1
                self.running[self._started] = step.at
                for name in (call, str(started.get("task") or "")):
                    if name:
                        self.names[name] = self._started
        else:
            self.wait = MACHINE
        if step.kind in (NOTICE, NOTIFIED) and step.final:
            for name in step.links:
                self.running.pop(self.names.pop(name, -1), None)

    def _background(self, at: float) -> bool | None:
        if not self.background_known:
            return None
        return any(at - started <= BACKGROUND_LIMIT_SECONDS for started in self.running.values())


def requests_of(steps: Iterable[Step], *, background_known: bool = True) -> list[Request]:
    """A run's requests in the order they were sent, from its steps in transcript order."""

    walk = _Walk(background_known)
    for step in steps:
        walk.step(step)
    return walk.order


def read_requests(target: Target) -> list[Request] | None:
    """The requests of the transcript `target` is read from, or None when there is none to read.

    It reads the whole file each time, a chunk at a time, and keeps no step: only the requests.
    """

    path = source(target)
    if path is None:
        return None
    memo: dict = {}

    def steps() -> Iterator[Step]:
        for lines in chunks(path):
            yield from steps_of(lines, target, memo)

    return requests_of(steps(), background_known=target.client != CODEX)
