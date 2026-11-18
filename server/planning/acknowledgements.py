"""What an agent is told after a write, short enough to read on every call.

A write answers with the whole record at the HTTP boundary, because a browser
redraws from it. An agent needs far less: that the write landed, the revision to
pass as `expected_revision` on the next one, and what this call changed. Handing
it the checklist, comments and event trail after every tick made those answers
the largest repeating part of a long session.

These functions only narrow an already-presented item, so they cannot disagree
with it, and they sit above the HTTP boundary: the same service result serves
both, and only the MCP vocabulary in `tools` asks for the short form.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping

from ..ops import configuration

Acknowledge = Callable[[dict, Mapping[str, object]], dict]


def work_item_url(reference: str) -> str:
    """The address that opens this item in the web UI, for an agent to hand a person.

    The one place this address is built. The HTTP surface's `/open` route answers
    it, and only over loopback, so it names 127.0.0.1 rather than a host name.
    """

    return f"http://127.0.0.1:{configuration.listener_port()}/open/{reference}"


def _base(item: dict) -> dict:
    """Identity, the revision the next write must name, and who holds the item.

    `claim_state` says whether that holder's session is still there: `live`,
    `stale` or `unconfirmed`, and null when nobody holds the item. `state` is the
    record's: null for an accepted open goal or stage, whose `container_state`,
    there alone, says what it derives; `open` says whether work on it is over.
    """

    state = item["state"]
    return {
        "reference": item["reference"],
        "url": work_item_url(item["reference"]),
        "work_item_id": item["work_item_id"],
        "revision": item["revision"],
        "state": None
        if state is None
        else {
            "key": state["key"],
            "name": state["name"],
            "is_terminal": state["is_terminal"],
        },
        "open": item["open"],
        **_derived(item),
        "claim_ref": item["claim_ref"],
        "claim_state": item["claim_state"],
    }


def _derived(item: Mapping[str, object]) -> dict:
    """`container_state` where the item has one: a short answer leaves out the null."""

    found = item.get("container_state")
    return {} if found is None else {"container_state": found}


def _moved(item: dict) -> dict:
    """What a claim or a release did to the state, and what the caller must not miss.

    `started` is a claim moving unstarted work into the active state; `requeued`
    a release putting work under way back in the queue; `released` the holder
    whose claim a move into a terminal state ended; `warnings` what the move's
    guards had to say, or why an item that should have moved did not;
    `awaiting_confirmation` the goals and stages the write left with nothing open
    under them, which now wait for their confirmation; `moved_out` the goal or stage
    a move out took the item out of, with the reason; `converted` what a conversion
    made of the item and the task it left; `waits_for_owner` the write the owner's
    setting kept back for their answer, with the question they answer, and
    `waits_for_sessions` a cancel that waits for the sessions whose work it ends.
    """

    return {
        name: item[name]
        for name in (
            "started",
            "requeued",
            "released",
            "warnings",
            "awaiting_confirmation",
            "moved_out",
            "converted",
            "waits_for_owner",
            "waits_for_sessions",
        )
        if item.get(name)
    }


def _forced(item: dict) -> dict:
    """What a `force` carried through, as `overridden`: the guards a forced move names too."""

    return {"overridden": item["overridden"]} if item.get("overridden") else {}


def created(item: dict, _arguments: Mapping[str, object]) -> dict:
    """A new item: the defaults the caller may not have named are the news.

    A creation that also claimed or linked the item says so in `applied`, as a
    batch does; one that did neither answers without it. A part split off a task
    names that task as `split_from` and the ids of the steps it took as
    `moved_steps`, and `overridden` when `force` took it from another session.
    """

    answer = {
        **_base(item),
        "title": item["title"],
        "kind": item["kind"],
        "priority": item["priority"],
        **_moved(item),
        **_forced(item),
    }
    if "split_from" in item:
        answer["split_from"] = item["split_from"]
        answer["moved_steps"] = item["moved_steps"]
    if "applied" in item:
        answer["applied"] = item["applied"]
    return answer


def claimed(item: dict, _arguments: Mapping[str, object]) -> dict:
    """The holder is `claim_ref` and its lease `claim_state`, and a move of the state."""

    return {**_base(item), **_moved(item), **_forced(item)}


def step_changed(item: dict, arguments: Mapping[str, object]) -> dict:
    """The one step a claim or tick touched, by the id the caller named."""

    wanted = arguments["item_id"]
    step = next(entry for entry in item["checklist"] if entry["id"] == wanted)
    return {
        **_base(item),
        "step": {
            "item_id": step["id"],
            "done": step["done"],
            "claimed_by": step["claimed_by"],
            "done_by": step["done_by"],
            "by_previous_holder": step["by_previous_holder"],
        },
        **_forced(item),
    }


def merged(item: dict, _arguments: Mapping[str, object]) -> dict:
    """The survivor, and what each merged item handed it before it closed."""

    answer = {**_base(item), "merged": item["merged"]}
    for name in ("warnings", "overridden", "awaiting_confirmation"):
        if item.get(name):
            answer[name] = item[name]
    return answer


def applied(item: dict, _arguments: Mapping[str, object]) -> dict:
    """A batch: what each group changed, and what its claim and transition moved.

    `applied` names every comment and question the call wrote by its id, so the
    caller needs no read to reply to one or withdraw one.
    """

    return {
        **_base(item),
        **_moved(item),
        **_forced(item),
        **_told(item),
        "applied": item["applied"],
    }


def _told(item: dict) -> dict:
    """Who hears the items a write named, as `mentions`.

    The whole item carries it as `mentions_told`, since its own `mentions` are the
    records of other texts naming it, which no write of this one is about.
    """

    return {"mentions": item["mentions_told"]} if "mentions_told" in item else {}
