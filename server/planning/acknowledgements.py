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
from . import model

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
    `stale` or `unconfirmed`, and null when nobody holds the item.
    """

    state = item["state"]
    return {
        "reference": item["reference"],
        "url": work_item_url(item["reference"]),
        "work_item_id": item["work_item_id"],
        "revision": item["revision"],
        "state": {
            "key": state["key"],
            "name": state["name"],
            "is_terminal": state["is_terminal"],
        },
        "claim_ref": item["claim_ref"],
        "claim_state": item["claim_state"],
    }


def _moved(item: dict) -> dict:
    """What a claim or a release did to the state, and what the caller must not miss.

    `started` is a claim moving unstarted work into the active state; `requeued`
    a release putting work under way back in the queue; `released` the holder
    whose claim a move into a terminal state ended; `warnings` what the move's
    guards had to say, or why an item that should have moved did not.
    """

    return {
        name: item[name]
        for name in ("started", "requeued", "released", "warnings")
        if item.get(name)
    }


def created(item: dict, _arguments: Mapping[str, object]) -> dict:
    """A new item: the defaults the caller may not have named are the news.

    A creation that also claimed or linked the item says so in `applied`, as a
    batch does; one that did neither answers without it.
    """

    answer = {
        **_base(item),
        "title": item["title"],
        "kind": item["kind"],
        "priority": item["priority"],
        **_moved(item),
    }
    if "applied" in item:
        answer["applied"] = item["applied"]
    return answer


def updated(item: dict, arguments: Mapping[str, object]) -> dict:
    """Names of the edited fields; the caller sent the values and can read them back."""

    return {**_base(item), "updated": model.updated_fields(arguments)}


def transitioned(item: dict, _arguments: Mapping[str, object]) -> dict:
    """The state is already in the base; add the findings a caller must not miss."""

    answer = {**_base(item), **_moved(item)}
    if item.get("overridden"):
        answer["overridden"] = item["overridden"]
    return answer


def claimed(item: dict, _arguments: Mapping[str, object]) -> dict:
    """The holder is `claim_ref` and its lease `claim_state`, and a move of the state."""

    return {**_base(item), **_moved(item)}


def checklist_replaced(item: dict, _arguments: Mapping[str, object]) -> dict:
    """The new steps, because their ids are what every later call names."""

    steps = [
        {"item_id": step["id"], "text": step["text"], "done": step["done"]}
        for step in item["checklist"]
    ]
    return {**_base(item), "checklist": steps}


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
        },
    }


def merged(item: dict, _arguments: Mapping[str, object]) -> dict:
    """The survivor, and what each merged item handed it before it closed."""

    answer = {**_base(item), "merged": item["merged"]}
    for name in ("warnings", "overridden"):
        if item.get(name):
            answer[name] = item[name]
    return answer


def summarized(item: dict, _arguments: Mapping[str, object]) -> dict:
    """That the summary is recorded; its text is the caller's own."""

    return {
        **_base(item),
        "summary_recorded": True,
        "summary_comment_id": item["summary_comment_id"],
    }


def applied(item: dict, arguments: Mapping[str, object]) -> dict:
    """A batch: what each group changed, and a transition's findings like the single tool's.

    `applied` names every comment and question the call wrote by its id, so the
    caller needs no read to reply to one or withdraw one.
    """

    return {**transitioned(item, arguments), "applied": item["applied"]}


def reported(item: dict, _arguments: Mapping[str, object]) -> dict:
    return {
        **_base(item),
        "comment_id": item["comments"][-1]["id"],
        "summary_comment_id": item["summary_comment_id"],
    }
