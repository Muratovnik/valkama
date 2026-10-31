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

#: The arguments of `update_work_item` that edit the record, in the order the
#: tool declares them. An argument that is absent or null changes nothing.
UPDATABLE_FIELDS = ("title", "description", "source", "priority", "labels", "kind", "parent")

Acknowledge = Callable[[dict, Mapping[str, object]], dict]


def _base(item: dict) -> dict:
    """Identity, the revision the next write must name, and who holds the item.

    `claim_state` says whether that holder's session is still there: `live`,
    `stale` or `unconfirmed`, and null when nobody holds the item.
    """

    state = item["state"]
    return {
        "reference": item["reference"],
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
    }
    if "applied" in item:
        answer["applied"] = item["applied"]
    return answer


def updated(item: dict, arguments: Mapping[str, object]) -> dict:
    """Names of the edited fields; the caller sent the values and can read them back."""

    names = [name for name in UPDATABLE_FIELDS if arguments.get(name) is not None]
    return {**_base(item), "updated": names}


def transitioned(item: dict, _arguments: Mapping[str, object]) -> dict:
    """The state is already in the base; add the findings a caller must not miss."""

    answer = _base(item)
    if item.get("warnings"):
        answer["warnings"] = item["warnings"]
    if item.get("overridden"):
        answer["overridden"] = item["overridden"]
    return answer


def claimed(item: dict, _arguments: Mapping[str, object]) -> dict:
    """The holder is `claim_ref`, and its lease `claim_state`; the base carries both."""

    return _base(item)


def checklist_replaced(item: dict, _arguments: Mapping[str, object]) -> dict:
    """The new steps, because their ids are what every later call names."""

    steps = [{"item_id": step["id"], "text": step["text"]} for step in item["checklist"]]
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


def summarized(item: dict, _arguments: Mapping[str, object]) -> dict:
    """That the summary is recorded; its text is the caller's own."""

    return {
        **_base(item),
        "summary_recorded": True,
        "summary_comment_id": item["summary_comment_id"],
    }


def applied(item: dict, arguments: Mapping[str, object]) -> dict:
    """A batch: what each group changed, and a transition's findings like the single tool's."""

    return {**transitioned(item, arguments), "applied": item["applied"]}


def reported(item: dict, _arguments: Mapping[str, object]) -> dict:
    return {
        **_base(item),
        "comment_id": item["comments"][-1]["id"],
        "summary_comment_id": item["summary_comment_id"],
    }
