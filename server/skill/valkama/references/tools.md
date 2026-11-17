# Tool reference

Exact shapes for the Valkama planning tools, for when the procedure in
`SKILL.md` needs one. The published tool schemas are the contract; this page
says what they mean together.

## Naming things

- **An item** is named by its reference (`MAIN-12`) or its `work_item_id`.
- **A space** is named by its key (`MAIN`), its name or its id.
- **A state** is named by its key, its id, or a category that exactly one state
  of the workflow has: `triage`, `deferred`, `ready`, `active`, `review`,
  `completed`, `blocked`, `cancelled`. A key wins over a category. A name the
  workflow lacks is refused with its states and the categories that name one, so
  read the refusal instead of guessing another name. A word an earlier model used
  is refused with the word that replaces it.
- **A kind** is `task`, `bug` or `improvement` for work that is taken and worked,
  `goal` for work that holds other work under no parent, and `stage` for such work
  under a parent, at any depth. A goal or stage is never claimed. A task's kind
  changes only among the first three.
- **A file or folder** in a text is a Markdown link to its path from the root of
  the item's space (its default project's root), or a whole path in backticks; a
  label reads better.
  Valkama opens a Markdown file in its own viewer at the `#kb:…` anchor, heading
  or `:42` line the link names, another file in the owner's editor at that line,
  and a folder in the editor. A relative path is looked for in that root first,
  and in the projects registered inside it only when the root has nothing there.
  A path with spaces goes in `<…>` inside a link; in backticks only an absolute
  path may hold one. A path outside every project registered with Valkama does
  not open, and a press copies it: link it, but do not promise it opens.

## What an item says about itself

- `open` says whether its work is still open. An accepted open goal or stage has
  `state: null` and a `container_state`: `not_started`, `in_progress` or
  `awaiting_confirmation`, read from the work under it. In `triage`, `deferred`,
  `completed` or `cancelled` it shows its `state` like any item.
- `acceptance` is why and when the work was accepted (`basis`: `owner`,
  `assignment`, `inherited`, `label_rule`, `migrated`; `at`), null while it is
  not. Work under goals and stages that are all accepted and open is accepted as
  part of them (`inherited`); a claim of any other work accepts it (`assignment`).
  Other work an agent files without a `state` stays in `triage` unless it sends
  `acceptance: "assignment"`, on the owner's word; an item with no basis moved to
  `ready`, `active`, `review`, `blocked` or `completed` without it is refused with
  `acceptance`, `force` or not. A move to `triage` takes the basis away. A goal or
  stage is accepted by a transition to `ready`, and accepted out of `triage` or
  `deferred` it accepts the work in `triage` under it, stopping at a deferred goal
  or stage.
- `started_at` is when work on it began, `waits_for` the open items blocking it,
  and `workable` whether a task may be taken now: unheld, in `triage` or
  `ready`, with nothing unfinished blocking it.
- `get_work_item_chain` with `scope: "tree"` reads everything under an item at
  any depth; `scope: "chain"`, the default, adds what was discovered from it.

## Writes and their answers

Every write answers with an acknowledgement: `reference`, `url` (the address that
opens the item), `work_item_id`, `revision`, `state` (`key`, `name`,
`is_terminal`; `null` for an accepted open goal or stage, whose `container_state`
alone says what it derives), `open` (whether its work is over), `claim_ref` (the
holder) and `claim_state` (`live`, `stale`, `unconfirmed` or null), plus
`container_state` where the item has one and what the call changed. Pass
`verbose: true` for the item's card instead; it carries `url` too.

| Tool | Also answers |
| --- | --- |
| `create_work_item` | `title`, `kind`, `priority`; `applied` when it took `claim`, `checklist` or `links`; `started` |
| `claim_work_item` | `started` when the claim moved the item to its active state; `requeued` when a release moved it back; `warnings`; `overridden` when `force` took over or released another session's claim |
| `claim_work_item_checklist_item` | `step`: `item_id`, `done`, `claimed_by`, `done_by`; `overridden` when `force` carried another holder's claim through |
| `apply_work_item_changes` | `applied`, what each group changed, and the findings of its claim, steps and transition: `warnings`, and `overridden` with each step's guards when `force` carried one (`person_spoke` among them); `applied.update` the fields sent; `applied.checklist` each step's `item_id`, `text`, `done`; `applied.checklist_ticks` each `item_id` and `done`; `applied.comment`, and each entry of `applied.comments`, the comment as below; `applied.resolutions` each root's `comment_id` and `resolution`; `applied.questions` each `request_id` and `revision`; `applied.summary` its `summary_comment_id`; `applied.transition` the `state`, and `released` when the close ended a claim |
| `merge_work_items` | `merged`: for each item, its `reference`, `state` and what it `moved` (`steps`, `comments`, `refs`, `links`) |

`claim_ready_work_item` answers with the card of the item it took as
`work_item`, null when no task is workable. A comment in `applied` has `comment_id`, and `reply_to` and
`reply_to_request`: the root a reply joined, both null for a new root, and
`list_request_id` when it carried a `list`, as the summary does. A comment or a
summary that named other items in `mentions` adds `mentions`: per item its
`reference`, `holders` and, when nobody will hear it, `told`. A call names at most
5 items, and a session names one item at most 3 times an hour: the fourth is
refused with `mention_limit`, which names the item.

Any write to an item also answers with `from_person` when a person acted on it
in Valkama's interface since an agent last wrote there, and has no such key
otherwise. Each entry has `kind` (`comment`, `report`, `status`, `edited`,
`question_answered`, `mentioned` and the rest), `via: "interface"`, `at`,
`comment_id`, `request_id` or `fields` when it has one, `from` for `mentioned` (the
item whose comment told this one), and `text`, cut at 300 characters;
the `comments` part of `get_work_item` has the whole text. It lists the newest 20, and
`from_person_omitted` counts the earlier ones. Each event is told once, to
whichever agent writes to the item next.

An answer where a claim began or held the item -- `claim_work_item`,
`claim_ready_work_item`, and `create_work_item` or `apply_work_item_changes` with
`claim: true` -- carries `project_roots`: for each project the task changes, or
its space's default project when it names none, `project_id`, `display_name`,
`root` and `status`: `mapped`, `missing` (no directory at the root),
`unregistered` (the registry no longer records it) or `unavailable` (the registry
was not read, so `root` and `display_name` are null). The projects of the item's
space come first, its default one before the others, then the rest, each part by
id. The claim does not depend on them.

## Claude Code's auto mode

Valkama calls may share a response with any other
tool. Valkama's hook records which session makes each call and leaves the call as
you wrote it, so auto mode reviews every call in the response. An older Valkama
release added your session to the input of each Valkama call instead, and a call
beside it that needed the review then got no verdict: it failed with "another call
in this response was changed by a hook", which says nothing about the failed call.
If you see that failure, the older release is still installed: issue the failed
call again exactly as it was, and for the rest of the session send Valkama calls in
a response of their own, with the other tools in the next one. Another client or
permission mode needs no such care.

## Creating an item

`create_work_item` takes `title`, and optionally `space`, `projects`,
`description`, `kind`, `priority`, `labels`, `source`, `parent`, `state` and
`author`. Without `space` the item lies under its parent's space, else in the
home space of its projects, else in your session's space; projects of two
spaces need `space`, one of them. A named `space` must be the parent's space,
or one of the projects' home spaces when they have one; a `[placement]` refusal
names the candidates. Three more arguments act on the
new item in the same call, all or nothing:

| Argument | Shape |
| --- | --- |
| `claim` | `true` |
| `checklist` | `["…", {"text": "…", "done": true}]` or `{"items": [...]}`, steps as below |
| `links` | `[{"other": "MAIN-12", "kind": "discovered-from"}]`, at most 100 |

A refused claim, step or link creates nothing and spends no number.

`priority` on `create_work_item` and in the batch's `update` is how much the item
matters, not when to do it:

- `urgent`: blocks work or loses data
- `high`: serious; could block work
- `medium`: noticeably affects work, with a workaround
- `low`: minor

`labels` in the batch's `update` replaces the whole set: `["observation"]` leaves
the item with that one label and nothing else. To add or remove labels without
knowing the rest, send `labels_add` or `labels_remove` (both may go in one
call). A label already there is kept once, one the item lacks is ignored, and
the set stays within 32 labels. `labels` beside either of them is refused, as is
one label named in both. An edit that changes the set, by any of the three,
writes one history event `labels_changed` whose `detail` is
`{"from":[…],"to":[…]}`, the set before and after; one that leaves the set as it
was, a reorder included, writes none. No other field's edit writes an event.

## Steps

A step is text, or `{"text": "…", "done": true}` for one already done, which is
recorded done by you with the event a tick writes. A checklist holds at most
100 steps of at most 1000 characters each. A step sent with the text of one the
item has is that step and keeps its `item_id`, claim and tick; a new text is a
new step. Leaving out a claimed or completed step needs `force`.

## One call, several writes

`apply_work_item_changes` takes `id`, `author`, `expected_revision`, `verbose`
and any of these groups, applied in this order. It is the one tool that edits
an item's fields, sets and ticks its steps, attaches refs, links it, writes and
resolves its discussion, records its summary and moves its state:

| Group | Shape | Does |
| --- | --- | --- |
| `claim` | `true` | claims the item as `claim_work_item` does |
| `subscribe` | `true` or `false` | follows the item's news for this session, or stops |
| `update` | `{"title": "…", "priority": "high", "parent": "MAIN-3", "labels_add": ["…"]}` | edits the fields a transition does not own |
| `checklist` | `["…", {"text": "…", "done": true}]`, or `{"items": [...], "force": true}` to carry a refusal through | sets the steps |
| `checklist_ticks` | `[{"item_id": "…", "done": true, "force": false}]` | completes or reopens steps |
| `refs` | `[{"kind": "commit", "value": "…", "label": "…"}]` | attaches pointers |
| `links` | `[{"other": "MAIN-20", "kind": "blocks", "remove": false}]` | adds or removes links |
| `comment` | `{"body": "…", "checklist_item_id": "…", "reply_to": 12, "reply_to_request": "…", "list": {"label": "…", "options": [...]}, "mentions": ["MAIN-14"]}` | writes one comment |
| `comments` | `[{"body": "…"}, {"body": "…", "reply_to": 12}]`, not with `comment` | writes comments, in order |
| `resolutions` | `[{"comment_id": 12, "resolution": "…", "reopen": false}]` | marks thread roots resolved |
| `questions` | `[{"kind": "question", "prompt": "…", "fields": [...]}]` | asks as `create_work_item_request` does |
| `summary` | `{"done": "…", "next": "…", "why": "…", "friction": "none", "list": {"label": "…", "options": [...]}}` | records the closing summary |
| `transition` | `{"state": "completed", "reason": "…", "force": false, "rank": "first"}` | moves the state |

A list group holds at most 100 entries. `checklist_ticks` can name only steps
the item already had and a `checklist` in the same call kept; send a new step
done as `{"text": "…", "done": true}` instead. Likewise a `reply_to` or a
resolution names only a comment that existed before the call. `questions`
beside a `transition` that closes the item is refused, `force` or not: the close
would end them unanswered. So is a `list` in a comment or the summary of such a
call. `applied.comment`, each entry of `applied.comments` and `applied.summary`
carry `list_request_id` when they wrote a list, and `applied.comment` and each
entry of `applied.comments` carry `mentions` when they named other items. A refusal
writes nothing and answers with the step:
`{"error": {"code": "…", "message": "transition: …", "step": {"group": "transition", "index": 0}}}`.

A typical close, in one call:

```json
{"id": "MAIN-12", "expected_revision": 7,
 "checklist_ticks": [{"item_id": "…"}],
 "refs": [{"kind": "commit", "value": "3f2a9c1"}],
 "summary": {"done": "Parser accepts empty input; regression test added.",
             "next": "Nothing; MAIN-14 covers the CLI message.",
             "friction": "none"},
 "transition": {"state": "completed"}}
```

## Comments and threads

A comment in the batch's `comment` or `comments` takes `body` (at most 8000
characters), and optionally `checklist_item_id`, and one parent: `reply_to`, the
id of a comment, or `reply_to_request`, the id of a question on the same item. A
comment with no parent is the root of a thread; a report is one too. Threads
are one level deep: a reply to a reply is written under that reply's root, and
a reply to a reply of a question under the question. Refused, writing nothing:
both parents at once, a parent that is not on the item, and a reply with a
`checklist_item_id`.

An entry of the batch's `resolutions` takes `comment_id`, the root of a thread,
and optionally `resolution`, the decision in one line of at most 280 characters,
which may be blank, or `reopen: true` in its place to remove the mark. Marking
again replaces the decision and is recorded as a new mark, and reopening a root with
no mark writes nothing. A mark writes the history event `comment_resolved` or
`comment_reopened` and changes no revision. Refused, writing nothing: a reply, a
comment on another item or none at all (`not_found`), a decision of two lines, and
`resolution` with `reopen`.

## Reading an item

`get_work_item` takes `id` and reads an item by parts. `parts` names them, one
name or a list: `card`, `comments`, `events`, `links`, `refs`, `questions`,
`mentions`, `sessions`, `images`, `subscribers`, `claim` and `sections`. The
answer carries `reference`, `revision` and the fields of each part named, the
card's among them when `card` is. Without `parts` it reads the card, and a mode
without `parts` reads only the part it cuts: `unresolved`, `thread` and
`comments_after` the comments, `events` the events, `section` the sections.
Refused with `invalid_request`: an unknown part, a mode beside a `parts` that
leaves its part out (`thread reads the comments part: add comments to parts or
leave parts out`), `thread` with `comments_after` or `unresolved`, and `events`
outside 1 to 1000.

**The card** is what a write with `verbose: true` and `claim_ready_work_item`
answer with too: `reference`, `title`, `kind`, `priority`, `state` (`key`,
`name`, `category`; null for an accepted open goal or stage), `open`,
`container_state`, `acceptance`, `started_at`, `waits_for`, `workable`,
`projects` (the projects the item changes, each with its `project_id`, the
registry's `display_name`, null while the registry does not record it, and its
`source`: `named`, `commits` or `migrated`; a goal's or stage's are those of
every task under it), `claim_ref`, `claim_state`, `last_claim_ref`,
`closed_at`, `labels`, `source`, `revision`, `created_at`, `updated_at`, `url`,
`parent` (a reference or null),
`description` whole, `checklist` (each step's `id`, `text` and `done`, and
`claimed_by` and `done_by` when they are set), `summary` when there is one, and
`parts`: each other part the item has, with its size. A part with nothing in it
is left out.

| Part | On the card | Read, it answers with |
| --- | --- | --- |
| `comments` | `count`, `threads`, `unresolved`, `chars` | `comments` as the table below says, `comments_total` (every row), `threads_total` (the roots), `unresolved_total` (the roots without the mark) and `truncated` |
| `events` | `count`, `chars` | `events`, the 10 newest oldest first, or the newest `events: <n>`; `events_total` and `events_truncated` |
| `questions` | `count`, `open` | `questions` as [Requests](#requests) says |
| `mentions` | `count` | `mentions`, the 50 newest texts on other items that named this one, oldest first, each with `in` (`comment`, `report`, `summary` or `description`), `from`, `quote`, `author`, `by_person` and `at`; `mentions_total` |
| `claim` | `count`, 1 while it is held | `claim`, the lease: `holder`, `state`, `session_id`, `agent_id`, `source`, `acquired_at`, `last_seen` and `expires_at`, the time it lapses unless the session shows a sign of life; null while nobody holds it |
| `sections` | `count`, for a description longer than 2,000 characters | `sections`, as below |
| `links`, `refs`, `sessions`, `images`, `subscribers` | `count` | the list of that name |

The comments part takes one of these modes:

| Read | `comments` holds |
| --- | --- |
| no mode | the roots of the 5 threads with the newest activity, the most recent last; a thread's activity is its newest row, so a new reply lifts an old thread, and `truncated` says older threads are left out |
| `thread: <id>` | one thread, the root and every reply oldest first; a reply's id reads its root's thread, and a reply to a question is refused |
| `unresolved: true` | the roots without the resolved mark, oldest first, at most 20, each with `replies` and `last_reply`; while `truncated` is true, read on with `comments_after` set to the last root's id |
| `comments_after: <id>` | at most 50 comments after that id, roots and replies flat, oldest first; `0` starts from the first, and while `truncated` is true the next page starts after the last id read |

Every comment has `id`, `kind` (`comment` or `report`), `report`,
`checklist_item_id`, `checklist_item_text`, `author`, `body`, `at`,
`reply_to` and `reply_to_request` (both null on a root), `by_person`: true
when the interface wrote it, false for another call, null for a row written
with no call, `resolution`: a root's resolved mark as `at`, `by`, `by_person`
and `text`, or null, and always null on a reply, and `mentions`, the items it
told. With no mode and with `unresolved` each root adds `replies`, how many it
has, and `last_reply`, its newest reply as `id`, `author`, `by_person`, `at` and
`body`, the body cut at 500 characters with `clipped: true`, or null.

**Sections.** A line that starts with one to six `#` and a space, outside a
fenced code block, opens a section, which runs to the next heading of its level
or a higher one and so holds its subsections; the text before the first heading
is `(start)`. `parts: sections` lists them as `{key, level, chars}`. A
description without a heading is divided into paragraphs, listed as
`{key, chars, starts}`, `starts` being its first 60 characters. A heading's key
is its text with the spaces run together, compared without case; a paragraph's
is `p` and eight hex digits of its text's hash. A key repeated in one
description takes ` (2)`, ` (3)` in order. `section`, one key or a list of them,
reads those sections with their `text`, in the description's order. A key the
description no longer has is refused, naming the keys it has: a renamed heading
and an edited paragraph get new keys, so a stale key never reads other text.

## Placement

`rank` in the batch's `update` (in the item's own state) and `transition` (in
the state it moves to): `first`, `last`,
`before:MAIN-12`, `after:MAIN-12`, the anchor in that same state. Without
`rank`, a moved item goes last. `claim_ready_work_item` takes the first
workable task: a ready state before a triage one, then the order inside the
state; priority only breaks a tie. A goal, a stage and deferred work are never
taken.

## Guards

| Moving to | Needs |
| --- | --- |
| an active state | a holder after the move: a claim on the item or on one of its steps; `force` does not carry this |
| ready, active, review, blocked or completed, for an item with no basis | a basis of acceptance (`acceptance`), which `force` does not carry |
| a deferred state | refused: putting work off is its own action |
| active, review or blocked, for a goal or stage | refused: a goal or stage is accepted (ready), completed or cancelled |
| a triage state, for an accepted open goal or stage | refused: an accepted goal or stage is completed or cancelled |
| a completed state, for a goal or stage never accepted, from triage or deferred | refused: a goal or stage that was not accepted is not done; not doing it is a cancellation |
| a completed state | every step done and a summary |
| a cancelled state | a summary; open steps stay open |
| a blocked state | an unfinished item linked `blocks` to it, or a `reason` |
| any state | a transition the workflow allows from where the item stands |

A move to review without a session or commit ref warns but is not refused.
An agent's move to a completed or cancelled state is also refused with
`person_spoke` while a person acted on the item since an agent last wrote to it;
the refusal names what they did. A `comment` sent in the same
`apply_work_item_changes` call does not lift it.
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
in its active state unless one of its steps is still claimed. A task at work stands
held: with no ready state to requeue it in, a release, the tick or release of its
last held step and a takeover of its stale claim are refused, and its lapsed lease
is not released at all. Any transition but to an active or blocked state ends the
item's claims, as a close does.
`list_work_items` with `owner` set to a holder exactly as `claim_ref` spells it
lists that holder's items.

## Requests

`create_work_item_request` takes `id`, `kind` (`question` or `decision`),
`prompt` and `fields`, each field
`{"id": "…", "label": "…", "type": "text" | "choice" | "multi_choice" | "boolean" | "verdict", "required": true, "options": [{"id": "…", "label": "…"}]}`.
A question holds 1 to 40 fields. An option also takes `description` (markdown, 1
to 8000 characters), `recommended` (a boolean, true on at most one option of a
`choice`) and, on a recommended option only, `why` (markdown, 1 to 8000
characters: why you recommend it). A field also takes `description` (markdown, 1
to 8000 characters), `group` (1 to 200 characters; the fields of one group stand
together), `under` (`{"field": "…", "option": "…"}`) and, on a `verdict` only,
`recommended` (`accept`, `later` or `reject`) with its `why`. Give `why` whenever
you recommend; without `recommended` it is refused naming the option or field. A `verdict` has `options: []` and is answered
`accept`, `later` or `reject`. A field `under` another names an earlier
`verdict`, `choice` or `multi_choice` field that is under nothing itself, and an
option of it (a verdict's word under a verdict); it leaves `group` out or repeats
its parent's, and it is shown and answered only while the parent's answer holds
that option. The fields of one question fit in 64 KiB as stored.

`answer_work_item_request` takes `id`, `answers` (field id to answer),
`expected_revision` and optionally `own` (field id to an own variant, at most 8000
characters), `field_notes` (field id to a comment, at most 2000 characters),
`note` (a comment on the whole question, at most 8000 characters), `change` and
`author`. Only a `choice`, `multi_choice`, `boolean` or `verdict` field takes an
own variant or a comment; in a `choice`, `boolean` or `verdict` the own variant
replaces the option, and giving both is refused. A hidden field takes nothing:
"answer p4-steps stands under p4=accept, and p4 is later; leave it out"; a
required one is required only while it is shown. A required field needs a value or an own variant; a note
no longer stands in for it, and the refusal says so: "answer path is required;
give an option or your own variant in own; a note no longer stands in for a
field".

A pending question is answered once; a second answer is refused. `change: true`
replaces the answer of an answered question, held to the same rules, and keeps the
replaced one as a version: `answer_version` rises by one and `answered_at` moves to
the change. Change an answer only when the owner asks. Refused with
`[unchanged]` when nothing differs, `[task_closed]` once the item is closed and
`[answer_versions]` past 50 versions.

A request is `pending` until it is answered, declined or expires; it expires
when its item closes or its deadline (`expires_at`) passes. A comment over an
open question changes nothing about it.

The `questions` part of `get_work_item` is
`{"total": 6, "open": 2, "items": […], "truncated": true}`, at most 5 items, the
open ones first and then the newest closed. `list_work_item_requests` takes
`space`, `id` (one item), `status`, `answered_after` (an ISO timestamp with a
timezone), `limit`, `offset` and `full`, and its page says `truncated` and
`next_offset`. With `answered_after` the oldest answer comes first, and a page runs
past `limit` rather than part two answers of one time. Both give a compact form
unless `full` is true:

```json
{"id": "…", "status": "answered", "question": "Which way?",
 "answer": [{"field": "path", "value": "keep", "label": "Keep it",
             "note": "It is cheap"},
            {"field": "areas", "value": ["api"], "label": "The API",
             "own": "The docs"}],
 "note": "And the docs.", "answered_by": "user", "by_person": true,
 "answered_at": "2026-11-02T09:00:00.000000Z", "answer_version": 2,
 "previous": {"answer": [{"field": "path", "value": "drop", "label": "Drop it"}],
              "note": null, "answered_at": "2026-11-01T09:00:00.000000Z"},
 "replies": 1,
 "last_reply": {"id": 41, "author": "user", "by_person": true,
                "at": "2026-11-02T09:05:00Z", "body": "Ask me if unsure."}}
```

`question` is the first 160 characters of the prompt, with `…` when it was cut.
`label` names what was chosen in a `choice` or `multi_choice` and is null for a
`boolean` or `text`, whose `value` reads as itself. A row has `own` and `note` (the
field's comment) only when the field has them, and `value` is null when only those
came back. A field with nothing has no row. `answered_by` and `answered_at` are
null with no answer. `answer_version` is 0 with no answer and 1 for a first one;
`previous` appears from version 2. `replies` counts the question's thread and
`last_reply` quotes its latest reply, its `body` cut at 500 characters with
`clipped: true`. A note, a written answer, an own variant, a comment and a label
are cut at 500 characters with `…`, and one question is at most 2000 characters of
JSON: `previous` is cut first, then every label at once, then the later fields;
`clipped: true` says something was cut, and the key is absent otherwise.

A question with a `verdict` field adds `verdicts`
(`{"accept": ["p1", "p4"], "later": ["p12"], "reject": []}`) and `undecided` (the
shown verdict fields given neither a verdict nor an own variant), which stand
whole before any row. Its `answer` has a row only for a field under another, which
carries `under` (the parent's id) and, for a `multi_choice`, `of` (how many
options it offers) and no label, and for a verdict with a comment or an own
variant. `previous` has the same shape.

A list under a comment adds `comment_id` and `undecided`: `["items"]` while nothing
on it is ticked, which a send with none ticked leaves it, and `[]` once something
is. `previous` has it too.

`by_person` is true when the latest call that closed or changed the question came
through Valkama's interface, false for any other call that answered, changed,
declined or withdrew it, and null while none has, which includes an answer written
with no call. No argument sets it and `author`
does not count, though a process holding the interface's credentials counts as the
interface.

`get_work_item_request`, and the list with `full: true`, give the whole question:
`prompt`, `fields` with their options and descriptions, `answers`, `own`,
`field_notes`, `note`, `answer_version`, `history` (the replaced answers, oldest
first, each with `version`, its parts, `answered_by`, `answered_at` and
`by_person`), `by_person` and the rest of the record. `get_work_item_request` also
gives `replies`, the question's whole thread, oldest first.

## Merging

`merge_work_items` takes `id` (the survivor), `items` (1 to 20), and optionally
`reason`, `force`, `expected_revision` (the survivor's) and `author`. What
moves: steps (their ids, ticks and step claims kept), discussion threads whole,
questions with their replies, refs the survivor lacks, links in their own
direction, and projects (a project more than one of them names keeps the
strongest source: named, then commits, then migrated); `moved.comments` counts
the comment rows, replies included. A list goes with the comment it stands
under. What stays on a merged item: its history, reports with their threads and
lists, description, labels and parent. Each merged item is linked `duplicates`
to the survivor, gets a summary naming it, is released and closes in its
cancelled state. Refused, writing nothing: the survivor in `items`, an item
named twice, another space, a closed item, a goal or stage with a task, a merged
item with children, more than 100 steps in all, a workflow with no reachable
cancelled state, or an item another session holds without `force`.
