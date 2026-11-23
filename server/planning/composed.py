"""The texts the service composes for a person, each with a key and the values it is made of.

Some texts the owner reads are written by Valkama itself, not by an agent: the prompt
of a question a waiting write asks (a goal an agent proposes, a task it files in a goal,
a cancel, a close, a put-off, a change of a goal's steps, a group of findings), the
question a put-off that came back asks, and what the summary of agent decisions says
was decided. They are stored in English, and an agent reads that text through the tools
as it always did. Beside it the service stores a key and the values the text is made of,
so the interface can say the same in the reader's language from its own catalogue,
never by parsing the English: `work_item_requests.prompt_key` and `prompt_values`,
`agent_decisions.what_key` and `what_values`. A row written before them has neither,
and is shown as its text.

This module is the one definition of each key: `QUESTIONS` and `DECISIONS` name every
key with the values it carries, and `question` and `decision` refuse a key not named
there or values other than its own. The values are what the words need -- references,
counts, titles, a state's key, an agent's own reason or summary as it wrote it, lists
of them -- never a fragment of English already put into words.
`docs/connection-contract.md` («Texts the service composes») gives the same list.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

#: The prompts of the questions the service asks, by key, each with the values it carries.
#:
#: - `task_filed`, `task_moved_in`: an agent files the task `reference` in the accepted
#:   goal `goal`, or moves it there; `title` is the task's.
#: - `task_moved_to`: an agent moves the task lying in `goal` to the state whose key is
#:   `state`.
#: - `goal_proposed`: an agent proposes the goal; `goal_came_back`: a goal came back from
#:   being put off.
#: - `put_off_asked`: an agent puts off an accepted goal or stage (`kind`, `goal` or
#:   `stage`) until `until`, a day, a time or a reference, or `comments`, a count of new
#:   comments, or both, whichever comes first; the one not named is null. `reason` is
#:   the agent's.
#: - `put_off_came`: what `reference` was put off until has come: the moment `until`,
#:   `comments` new comments, or the close of the item `item`; the other two are null.
#: - `cancel_asked`: an agent cancels `reference` at `point` (`cancel_outside` or
#:   `cancel_shared`), with its `reason` or null; `sessions_asked` says the sessions at
#:   work were asked as well; when a round of consent passed it to the owner,
#:   `objections` holds each session that objected with its reason, and `unanswered`
#:   the sessions that did not answer within a day.
#: - `cancel_consent`: asked of a session at work: another session's agent cancels it.
#: - `confirm_asked`: all work under `reference` is closed (the sweep's question);
#:   `confirm_agent`: an agent confirms it, quoting its `summary` or null;
#:   `confirm_agent_empty`: an agent closes it with nothing under it. Each lists its
#:   `cancelled` and `moved_out` children, each `{reference, reason}` with the reason
#:   null where none is known, and its `steps`, as many as fit, and `hidden`
#:   counts the lines of the English text that did not fit.
#: - `steps_asked`: an agent changes the steps of a goal or stage: the texts `removed`,
#:   each `{from, to}` of `rewritten`, and its `reason`.
#: - `group_asked`: a group of `count` findings proposed as the goal titled `title`.
QUESTIONS: Mapping[str, tuple[str, ...]] = {
    "task_filed": ("reference", "goal", "title"),
    "task_moved_in": ("reference", "goal", "title"),
    "task_moved_to": ("reference", "goal", "state", "title"),
    "goal_proposed": ("reference", "title"),
    "goal_came_back": ("reference", "title"),
    "put_off_asked": ("reference", "kind", "title", "until", "comments", "reason"),
    "put_off_came": ("reference", "until", "item", "comments"),
    "cancel_asked": (
        "reference",
        "point",
        "title",
        "reason",
        "sessions_asked",
        "objections",
        "unanswered",
    ),
    "cancel_consent": ("reference", "title", "reason"),
    "confirm_asked": ("reference", "cancelled", "moved_out", "steps", "hidden"),
    "confirm_agent": ("reference", "summary", "cancelled", "moved_out", "steps", "hidden"),
    "confirm_agent_empty": ("reference", "summary", "cancelled", "moved_out", "steps", "hidden"),
    "steps_asked": ("reference", "kind", "title", "removed", "rewritten", "reason"),
    "group_asked": ("count", "title"),
}

#: What the summary of agent decisions says was decided, by key, each with its values.
#:
#: - `accepted`: the agent accepted `reference`, standing under `under` or null, or
#:   taken by the label `label` a rule accepts by, else null.
#: - `moved`: it moved the accepted `reference` under `under`.
#: - `cancelled`: it cancelled `reference`, following the owner's answer to the question
#:   `question`, or null.
#: - `closed`: it confirmed the goal `reference`.
#: - `put_off`: it put `reference` off until `until` or `comments`, or both, as
#:   `put_off_asked` names them, for its `reason`.
#: - `steps`: it changed steps of a goal or stage: each of `changes` is `{change, before,
#:   after}`, `change` being `removed` (`after` null), `rewrote` or `clarified`; `reason`,
#:   or null, is why the steps were removed or rewritten.
#: - `chose`: a decision answered by its recommendations: the `labels` chosen.
#: - `group`: a group of `count` findings under the goal titled `title` answered
#:   `answer` (`do`, `later` or `drop`).
DECISIONS: Mapping[str, tuple[str, ...]] = {
    "accepted": ("reference", "under", "label"),
    "moved": ("reference", "under"),
    "cancelled": ("reference", "question"),
    "closed": ("reference",),
    "put_off": ("reference", "until", "comments", "reason"),
    "steps": ("changes", "reason"),
    "chose": ("labels",),
    "group": ("title", "answer", "count"),
}

__all__ = ["DECISIONS", "QUESTIONS", "Text", "decision", "plain", "question"]


@dataclass(frozen=True)
class Text:
    """A text the service composed: the English `text` agents read, and the `key` and
    `values` the interface says it from."""

    key: str
    values: Mapping[str, object]
    text: str

    def message(self) -> dict[str, object]:
        """The key and values as an answer carries them."""

        return {"key": self.key, "values": dict(self.values)}


def _composed(known: Mapping[str, tuple[str, ...]], key: str, text: str, values: dict) -> Text:
    names = known.get(key)
    if names is None:
        raise ValueError(f"no composed text {key!r}")
    if set(values) != set(names):
        raise ValueError(f"{key} takes the values {sorted(names)}, not {sorted(values)}")
    return Text(key, {name: values[name] for name in names}, text)


def question(key: str, text: str, **values: object) -> Text:
    """The prompt of a question the service asks, `text` in English, said by `key`."""

    return _composed(QUESTIONS, key, text, values)


def decision(key: str, text: str, **values: object) -> Text:
    """What the summary of decisions says, `text` in English, said by `key`."""

    return _composed(DECISIONS, key, text, values)


def plain(said: Text | str) -> str:
    """The English text of a composed text, or a text written without a key as it is."""

    return said.text if isinstance(said, Text) else said
