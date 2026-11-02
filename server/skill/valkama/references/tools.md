# Tool reference

Exact shapes for the Valkama planning tools, for when the procedure in
`SKILL.md` needs one. The published tool schemas are the contract; this page
says what they mean together.

## Naming things

- **An item** is named by its reference (`MAIN-12`) or its `work_item_id`.
- **A space** is named by its key (`MAIN`), its name or its id.
- **A state** is named by its key, its id, or a category that exactly one state
  of the workflow has: `backlog`, `queued`, `active`, `review`, `blocked`,
  `completed`, `cancelled`. A key wins over a category. A name the workflow
  lacks is refused with its states and the categories that name one, so read
  the refusal instead of guessing another name.
- **A kind** is `task`, `bug`, `improvement` or `epic`.

## Writes and their answers

Every write answers with an acknowledgement: `reference`, `url` (the address that
opens the item), `work_item_id`, `revision`, `state` (`key`, `name`,
`is_terminal`), `claim_ref` (the holder) and `claim_state` (`live`, `stale`,
`unconfirmed` or null), plus what the call changed. Pass `verbose: true` for the
full item instead; it carries `url` too.

| Tool | Also answers |
| --- | --- |
| `create_work_item` | `title`, `kind`, `priority`; `applied` when it took `claim`, `checklist` or `links`; `started` |
| `claim_work_item` | `started` when the claim moved the item to its active state; `requeued` when a release moved it back; `warnings` |
| `transition_work_item` | `warnings`, and `overridden` when `force` carried a guard |
| `set_work_item_checklist` | `checklist`: each step's `item_id`, `text`, `done` |
| `claim_work_item_checklist_item`, `tick_work_item_checklist_item` | `step`: `item_id`, `done`, `claimed_by`, `done_by` |
| `apply_work_item_changes` | `applied`, what each group changed, and the findings of its claim and transition |
| `merge_work_items` | `merged`: for each item, its `reference`, `state` and what it `moved` (`steps`, `comments`, `refs`, `links`) |

`claim_ready_work_item` answers with the item it took, or nothing when no item
is ready.

## Creating an item

`create_work_item` takes `space`, `title`, and optionally `description`,
`kind`, `priority`, `labels`, `source`, `parent`, `state` and `author`. Three
more arguments act on the new item in the same call, all or nothing:

| Argument | Shape |
| --- | --- |
| `claim` | `true` |
| `checklist` | `{"items": [...]}`, steps as below |
| `links` | `[{"other": "MAIN-12", "kind": "discovered-from"}]`, at most 100 |

A refused claim, step or link creates nothing and spends no number.

## Steps

A step is text, or `{"text": "…", "done": true}` for one already done, which is
recorded done by you with the event a tick writes. A checklist holds at most
100 steps of at most 1000 characters each. A step sent with the text of one the
item has is that step and keeps its `item_id`, claim and tick; a new text is a
new step. Leaving out a claimed or completed step needs `force`.

## One call, several writes

`apply_work_item_changes` takes `id`, `author`, `expected_revision`, `verbose`
and any of these groups, applied in this order:

| Group | Shape | Works as |
| --- | --- | --- |
| `claim` | `true` | `claim_work_item` |
| `checklist` | `{"items": [...], "force": false}` | `set_work_item_checklist` |
| `checklist_ticks` | `[{"item_id": "…", "done": true}]` | `tick_work_item_checklist_item` |
| `refs` | `[{"kind": "commit", "value": "…", "label": "…"}]` | `attach_work_item_ref` |
| `links` | `[{"other": "MAIN-20", "kind": "blocks", "remove": false}]` | `link_work_items` |
| `comment` | `{"body": "…", "checklist_item_id": "…"}` | `comment_work_item` |
| `summary` | `{"done": "…", "next": "…", "why": "…"}` | `set_work_item_summary` |
| `transition` | `{"state": "completed", "reason": "…", "force": false, "rank": "first"}` | `transition_work_item` |

A list group holds at most 100 entries. `checklist_ticks` can name only steps
the item already had and a `checklist` in the same call kept; send a new step
done as `{"text": "…", "done": true}` instead. A refusal
writes nothing and answers with the step:
`{"error": {"code": "…", "message": "transition: …", "step": {"group": "transition", "index": 0}}}`.

A typical close, in one call:

```json
{"id": "MAIN-12", "expected_revision": 7,
 "checklist_ticks": [{"item_id": "…"}],
 "refs": [{"kind": "commit", "value": "3f2a9c1"}],
 "summary": {"done": "Parser accepts empty input; regression test added.",
             "next": "Nothing; MAIN-14 covers the CLI message."},
 "transition": {"state": "completed"}}
```

## Placement

`rank` on `update_work_item` (in the item's own state) and on
`transition_work_item` (in the state it moves to): `first`, `last`,
`before:MAIN-12`, `after:MAIN-12`, the anchor in that same state. Without
`rank`, a moved item goes last. `claim_ready_work_item` takes the first ready
item: a queued state before the backlog, then the order inside the state;
priority only breaks a tie.

## Guards

| Moving to | Needs |
| --- | --- |
| an active state from backlog or queued | a holder: a claim on the item or on one of its steps |
| a completed state | every step done and a summary |
| a cancelled state | a summary; open steps stay open |
| a blocked state | an unfinished item linked `blocks` to it, or a `reason` |
| any state | a transition the workflow allows from where the item stands |

A move to review without a session or commit ref warns but is not refused.
`force: true` carries a refusal through and records an `overridden` event.

## Claims

A claim is a lease on the session that took it: `live` while that session is
active and showed a sign of life in the last 14 days, `stale` once it ended or
went quiet, `unconfirmed` when no session was proved. `claim_work_item` releases
a stale claim at once, and taking it over needs no `force`; a live or unconfirmed
claim held by another needs `force`. Everything else leaves the claim of an ended
session alone for 12 hours after its end, so a resumed session reads `live` again
with its claims in place: until then `claim_ready_work_item` does not hand the
item out and a server start does not release it. The history names why a claim
was released: `session-ended`, `session-missing` or `lease-expired`, the last for
14 quiet days. `release: true` requeues an item that was
in its active state unless one of its steps is still claimed.
`list_work_items` with `owner` set to a holder exactly as `claim_ref` spells it
lists that holder's items.

## Requests

`create_work_item_request` takes `id`, `kind` (`question` or `decision`),
`prompt` and `fields`, each field
`{"id": "…", "label": "…", "type": "text" | "choice" | "multi_choice" | "boolean", "required": true, "options": [{"id": "…", "label": "…"}]}`.
An option also takes `description` (markdown, 1 to 8000 characters) and
`recommended` (a boolean, true on at most one option of a `choice`). The fields of
one question fit in 64 KiB as stored.

`answer_work_item_request` takes `id`, `answers` (field id to answer, `{}` when
the note says it all), `expected_revision` and optionally `note` (at most 8000
characters) and `author`. A non-empty note stands in for required fields; an
answer that is given is still checked against its field. An answer is final: a
second one is refused.

A request is `pending` until it is answered, declined or expires; it expires
when its item closes or its deadline (`expires_at`) passes. A comment over an
open question changes nothing about it.

`get_work_item` answers with `questions`:
`{"total": 6, "open": 2, "items": […], "truncated": true}`, at most 5 items, the
open ones first and then the newest closed. `list_work_item_requests` takes
`space`, `id` (one item), `status`, `answered_after` (an ISO timestamp with a
timezone), `limit` and `full`. Both give a compact form unless `full` is true:

```json
{"id": "…", "status": "answered", "question": "Which way?",
 "answer": [{"field": "path", "value": "keep", "label": "Keep it"},
            {"field": "sure", "value": false, "label": null}],
 "note": "And the docs.", "answered_by": "user", "by_person": true,
 "answered_at": "2026-11-02T09:00:00.000000Z"}
```

`question` is the first 160 characters of the prompt, with `…` when it was cut.
`label` names what was chosen in a `choice` or `multi_choice` and is null for a
`boolean` or `text`, whose `value` reads as itself. A field left out or empty has
no row. `answered_by`, `by_person` and `answered_at` are null with no answer.
`by_person` is true when the answer came through Valkama's interface and false
when it came through a tool; a caller cannot set it.

`get_work_item_request`, and the list with `full: true`, give the whole question:
`prompt`, `fields` with their options and descriptions, `answers`, `note`,
`by_person` and the rest of the record.

## Merging

`merge_work_items` takes `id` (the survivor), `items` (1 to 20), and optionally
`reason`, `force`, `expected_revision` (the survivor's) and `author`. What
moves: steps, discussion comments, questions, refs the survivor lacks, and links
in their own direction. What stays on a merged item: its history, reports,
description, labels and parent. Each merged item is linked `duplicates` to the
survivor, summarised, released and closed in its cancelled state. Refused,
writing nothing: the survivor in `items`, an item named twice, another space,
a closed item, a merged item with children, more than 100 steps in all, a
workflow with no reachable cancelled state, or an item another session holds
without `force`.
