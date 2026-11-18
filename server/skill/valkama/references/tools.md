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

## Naming a file in a text

A description, a comment, a report, a summary, a question or an option's
description names a file or folder of the project as a Markdown link to its path
from the root of the item's space (its default project's root), with a label that
says what it is:
`docs/plan.md#kb:a7f3`, `src/parse.ts:42`, `docs/plans/`.

- **Where it opens.** Valkama opens a Markdown file in its own viewer at the
  `#kb:…` anchor, heading or `:42` line the link names, another file in the
  owner's editor at that line, and a folder in the editor. A whole path in
  backticks works too; a label reads better.
- **From the root.** Write a path from that root, not from your working folder or
  another repository: a relative path is looked for there first, and in the
  projects registered inside it only when the root has nothing there. Use an
  absolute path only where there is no relative one, such as a file of another
  project.
- **Spaces.** A path with spaces goes in `<…>` inside a link; in backticks only an
  absolute path may hold one.
- **Outside every project.** A path outside every project registered with Valkama
  does not open, and a press copies it: link it, but do not promise it opens.

## What an item says about itself

- `open` says whether its work is still open. An accepted open goal or stage has
  `state: null` and a `container_state`: `not_started`, `in_progress` or
  `awaiting_confirmation`, read from the work under it. In `triage`, `deferred`,
  `completed` or `cancelled` it shows its `state` like any item.
- `acceptance` is why and when the work was accepted (`basis`: `owner`,
  `assignment`, `inherited`, `label_rule`, `agent`, `migrated`; `at`), null while
  it is not. Work under goals and stages that are all accepted and open is accepted
  as part of them (`inherited`); a claim of any other work accepts it
  (`assignment`). `agent` is an agent's own decision where the owner's setting
  leaves it to the agent: a goal you file with no parent, or move from `triage` to
  `ready` with no `acceptance`, is accepted at once on it,
  or, where the owner decides, stays in `triage` and the answer says
  `waits_for_owner` with the question they answer. A task you file or move under
  goals and stages that are all accepted and open, or move out of `triage` into
  accepted work under them, meets the owner's setting the same way: it is
  `inherited`, or it waits for their answer, a new one or one moved out of `triage`
  in `triage` under the goal and one moved under it where it was. While the owner's
  question whether to do an item stands on it, or over an item with no basis, you
  neither claim it nor move it anywhere but cancelled (`acceptance_question`). The
  owner's summary of decisions marks work you accept on `assignment`, and your
  claim of a task lying in `triage` under such goals and stages. A task lying in
  `triage` outside them is accepted on `label_rule` when the call that files it, or
  puts a label on it, gives it a label the owner's rule makes ready.
  Other work an agent files without a `state` stays in `triage` unless it sends
  `acceptance: "assignment"`, on the owner's word; an item with no basis moved to
  `ready`, `active`, `review`, `blocked` or `completed` without it is refused with
  `acceptance`, `force` or not. A move to `triage` takes the basis away. A goal or
  stage is accepted by a transition to `ready`, and accepted out of `triage` or
  `deferred` it accepts the work in `triage` under it, stopping at a deferred goal
  or stage. Your acceptance leaves out an item the owner is asked whether to do: it
  stays in `triage` for their answer, the answer's `warnings` names it, and a goal or
  stage left there keeps the work under it.
- `started_at` is when work on it began, `waits_for` the open items blocking it,
  `cancelled_blockers`, only when there are any, the cancelled items still linked
  to block it,
  `workable` whether its space's queue may give it now, and `withheld` why not,
  as codes such as `not_ready`, `held`, `waits`, `question` or
  `ancestor_triage`: empty exactly when it is `workable`.
- `lapsed_claim` (`holder`, `reason`, `at`) names whose claim the sweep released,
  why and when, until the next claim; a step marked `by_previous_holder` was
  ticked by that holder and waits for a tick that confirms it (see Claims).
- `deferred`, on work put off, says what it waits on: `until` or `until_item`,
  and `reached_at` once that came and the owner is asked; `returned`, on work in
  triage that came back, says why (`because`: `date`, `completed`, `cancelled`
  or `deleted`, with the `item`) and when.
- `get_work_item_chain` with `scope: "tree"` reads everything under an item at
  any depth; `scope: "chain"`, the default, adds what was discovered from it.

## Writes and their answers

Every write answers with an acknowledgement: `reference`, `url` (the address that
opens the item), `work_item_id`, `revision`, `state` (`key`, `name`,
`is_terminal`; `null` for an accepted open goal or stage, whose `container_state`
alone says what it derives), `open` (whether its work is over), `claim_ref` (the
holder) and `claim_state` (`live`, `stale`, `unconfirmed` or null), plus
`container_state` where the item has one and what the call changed. Pass
`verbose: true` for the item's card instead; it carries `url` too. A write that
closed, moved or deleted the last open item under a goal or stage also answers
`awaiting_confirmation`, the references of the goals and stages it brought to
await confirmation: check each and complete it, as the skill's Close section says.

| Tool | Also answers |
| --- | --- |
| `create_work_item` | `title`, `kind`, `priority`; `applied` when it took `claim`, `checklist`, `links` or `group`; `started`; `split_from` and `moved_steps`, the ids of the steps it took, for a part split off a task, and `overridden` when `force` split it off another session's task; `waits_for_owner` (`action`, `point`, `question`, `what`) when the owner decides on it and it waits in `triage` for their answer |
| `claim_work_item` | `started` when the claim moved the item to its active state; `requeued` when a release moved it back; `warnings`; `overridden` when `force` took over or released another session's claim |
| `claim_work_item_checklist_item` | `step`: `item_id`, `done`, `claimed_by`, `done_by`; `overridden` when `force` carried another holder's claim through |
| `apply_work_item_changes` | `applied`, what each group changed, and the findings of its claim, steps and transition: `waits_for_owner` (as `create_work_item` gives it) when the owner decides on one of its writes, `waits_for_sessions` (`action`, `point`, `sessions`, `until`) when a cancel waits for the sessions whose work it ends, `warnings`, and `overridden` with each step's guards when `force` carried one (`person_spoke` among them); `applied.update` the fields sent; `applied.commits` the `attached` and `removed` commits, each `repository` and `hash`, and how many were `unchanged`; `applied.checklist` each step's `item_id`, `text`, `done`; `applied.checklist_ticks` each `item_id` and `done`; `applied.comment`, and each entry of `applied.comments`, the comment as below; `applied.resolutions` each root's `comment_id` and `resolution`; `applied.questions` each `request_id` and `revision`, or for an entry with `addressees` its `requests`, each `request_id` with its `addressee`; `applied.summary` its `summary_comment_id`; `applied.transition` the `state`, `released` when the close ended a claim, and, entering review or completing, `conditions_changed` when steps were taken off, reworded or moved to another item |
| `merge_work_items` | `merged`: for each item, its `reference`, `state` and what it `moved` (`steps`, `comments`, `refs`, `commits`, `links`, `projects`) |

`claim_ready_work_item` takes the first workable task in the order of work —
urgent, started, a goal or stage under way, priority, age — which a list row
says as `queue_order`, and answers with the card of the item it took as
`work_item`, null when no task is workable. It reads one space's queue: `space`, or the space of
`within`, a goal or stage whose tasks at any depth it keeps, or else the space
whose project root holds your session's folder (`session_space` in
`list_planning_spaces`); `label` keeps the tasks that carry that label
themselves, and `project` the tasks that name that project, never one that
names none. A call naming neither `space` nor `within` from a session in no
space's project root is refused with the spaces, as is `within` naming a task or
a goal of another space than `space`; a task of any space is claimed by number. A goal, a stage and work in triage or deferred are never
taken. Nothing sets the order by hand. A comment in `applied` has `comment_id`, and `reply_to` and
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
item whose comment told this one), and `text`, whole up to 1500 characters. A
longer one is cut there and says `cut: true`, and the `comments` part of
`get_work_item` has the rest. It lists the newest 20, and
`from_person_omitted` counts the earlier ones. Each event is told once, to
whichever agent writes to the item next.

A claim of a task or of a step also answers with `waiting` when a person acted on
a goal or stage over the task while no live session worked under it: one entry per
goal or stage that still holds words for this session, with its `reference`, `title` and `said`, what the person did there
from that act on, in the entries of `from_person` (the newest 20, and `omitted`
counting the earlier ones); a record of Valkama's that asks for a session waits the
same way, with `via: "valkama"`. The claim takes them: the next one under that goal gets
nothing until a person acts there again with nobody working. No key when nothing
waited.

An answer where a claim began or held the item -- `claim_work_item`,
`claim_ready_work_item`, and `create_work_item` or `apply_work_item_changes` with
`claim: true` -- carries `project_roots`: for each project the task changes, or
its space's default project when it names none, `project_id`, `display_name`,
`root` and `status`: `mapped`, `missing` (no directory at the root),
`unregistered` (the registry no longer records it) or `unavailable` (the registry
was not read, so `root` and `display_name` are null). The projects of the item's
space come first, its default one before the others, then the rest, each part by
id. The claim does not depend on them.

## Writes that wait for the owner

The owner's participation setting, which only the server reads, decides at each of
these points whether an agent's write is made at once or waits for the owner: a goal
with no parent you file or accept out of `triage` (`proposed_goal`), a task you file or move into accepted
goals and stages (`task_in_goal`), a cancel of an item your own work did not file
(`cancel_outside`) or of work other live sessions do (`cancel_shared`), a removal or
rewording of a step of a goal or stage (`condition`), the completion of a goal,
which confirms it (`goal_close`), and the put-off of an accepted one
(`goal_defer`). Where the setting leaves it to you, the write is made and the
owner's summary of decisions marks it. Act the same at any setting: the answer says
which happened.

A write that waits writes nothing of itself: the item stays as it was, and the
answer's `waits_for_owner` is `{action, point, question, what}`, `what` saying the
write as the summary would. The same write sent again while it waits answers the
same and writes nothing; another write of that point on the item is refused with
`[participation]` until its question is withdrawn. Your session follows the item
from then on, unless it holds it. The owner's answer makes the write, as the
owner's, if it still applies: the events that record it end with `as asked by`
and your holder label, and the action ends `carried_out`, or `declined` on an
answer that keeps things as they are. One that no longer applies ends `dropped`,
with an `action_dropped` event `<point>: <why>`, and so does one whose item closes
or merges, or that a person claims or moves meanwhile. Expiring the question,
which only your session can do, takes the write back (`withdrawn`). A question
Valkama asked itself, such as one about a put-off goal that came back, names
`Valkama` as its asker and is withdrawn by no session.

The question's `purpose` and the options of its choice field `answer`: `goal`
(`do`, `later` with `until`, `drop` with `cancels`), `task` (`do`, `later`, `out`,
`drop`), `cancel` (`cancel` with `cancels`, `keep`), `condition` (`allow`, `keep`)
and `confirm` (`confirm`, `leave`); the option you asked for is recommended. Read
whole, the question carries `action`: `id`, `point`, `asked_by`, `asked_at`,
`reason`, `proposed` (the `until`, the steps `removed` and `rewritten`, or the
`summary`), `outcome`, and for `goal` and `cancel` the `cancel_list` as it stands,
with its `list_token`; the compact form carries `purpose` and `action.point`. A
`cancel` or a `drop` over a list that changed since you asked is refused with
`cancel_list` and the new list, for the owner to confirm.

A cancel of work other live sessions do asks each of them a request of purpose
`consent`, by a call of Valkama's for you. Where the owner leaves it to the agent,
the answer is `waits_for_sessions` (`action`, `point`, `sessions`, `until`, a day
on), and the cancel is made as Valkama's write once each agreed, moved its work
out or ended, or goes to the owner on an objection or after the day; where the
owner decides, they are asked beside the sessions. A cancel whose
`transition.following` names an answered question of the owner on the item or
above it follows that answer and waits only for the sessions. Asked yourself,
answer with `answer_work_item_request`: `answers: {"answer": "agree"}`,
`{"answer": "object", "reason": "…"}`, or `{"answer": "moved_out"}` once `move_out`
took your task out of what the cancel closes.

`checklist_reason`, up to 500 characters, says why a change of a goal's or stage's
steps removes or rewrites one. A step sent by its `id` with `clarifies: true` and a
new text only says the same better: it is written at once, at any setting, and the
summary of decisions shows it. A call whose `transition` closes the item while
another of its writes waits is refused whole with `close_with_waiting`.

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
names the candidates. Four more arguments act on the
new item in the same call, all or nothing:

| Argument | Shape |
| --- | --- |
| `claim` | `true` |
| `checklist` | `["…", {"text": "…", "done": true}]` or `{"items": [...]}`, steps as below |
| `links` | `[{"other": "MAIN-12", "kind": "discovered-from"}]`, at most 100 |
| `group` | `{"items": ["MAIN-41", "MAIN-42"], "answer": "do", "why": "…"}`, with `until` beside `later` |

A refused claim, step, link or group creates nothing and spends no number.

`group` makes a new goal of 2 to 20 tasks waiting for a triage review: each in
triage, under no goal, in the goal's space, with no question of the owner open.
The goal needs `kind: "goal"` and its conditions in `checklist`, and takes no
`parent`, `acceptance`, `claim` or `state` (`[group]`). The tasks move under it at
once. Your `answer` (`do`, `later` with `until`, `drop`) is carried out in the same
call, and `applied.group.carried_out` is `true`; or it waits for the owner, as
`waits_for_owner` says, and while it waits no task of the group is claimed or
moved. A task that does not wait in the stack is refused with
`[group] MAIN-41 is not waiting for a triage review: <why>`.

`split_from` names an open task to split a part off, and `steps` the ids of its
steps the part takes. The part stands beside the task, under the same parent,
and is accepted as the task is: in the first ready state when the task is
accepted (`inherited` under goals and stages all accepted, else the task's
basis), in triage beside a task in triage, put off on the same condition beside
one put off. The steps go with their ids, ticks and `done_by`, and their claims
end; the part names the task's projects unless `projects` names others. The task
records `split_off`, the part `split_from`. `parent`, `state` and `acceptance`
are the task's to set and are refused beside `split_from`, as are a task in
review or closed and a step it does not have (`[split]`); a task another session
holds needs `force`.

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
new step. Leaving out a claimed or completed step needs `force`. A step sent as
`{"id": "…", "text": "…"}` with its `item_id` and another text is that step
reworded, keeping its tick and claim. Each step left out, and the former text of
each one reworded, is recorded as a `checklist_removed` event, and entering
review or completing then answers `conditions_changed`: `removed`, those texts,
and `moved`, each item that took steps along (`{to, count}`).

## One call, several writes

`apply_work_item_changes` takes `id`, `author`, `expected_revision`, `verbose`
and any of these groups, applied in this order. It is the one tool that edits
an item's fields, sets and ticks its steps, attaches refs and commits, links it, writes and
resolves its discussion, records its summary and moves its state:

| Group | Shape | Does |
| --- | --- | --- |
| `claim` | `true` | claims the item as `claim_work_item` does |
| `subscribe` | `true` or `false` | follows the item's news for this session, or stops |
| `update` | `{"title": "…", "priority": "high", "parent": "MAIN-3", "labels_add": ["…"]}` | edits the fields a transition does not own |
| `convert` | `{"to": "stage", "leftover": {"title": "…", "steps": ["…"]}, "force": false}`, not with `transition`, `defer` or `move_out` | turns a task into a goal or stage, or one with nothing under it into a task ([work model](work-model.md#goals-and-stages)) |
| `checklist` | `["…", {"text": "…", "done": true}]`, or `{"items": [...], "force": true}` to carry a refusal through | sets the steps |
| `checklist_ticks` | `[{"item_id": "…", "done": true, "force": false}]` | completes or reopens steps |
| `refs` | `[{"kind": "memory", "value": "…", "label": "…"}]` | attaches pointers: a `memory` record id or a `url` |
| `commits` | `[{"repository": "alpha", "hash": "3f2a9c1", "label": "…", "remove": false}]` | attaches commits by hand, or detaches them |
| `links` | `[{"other": "MAIN-20", "kind": "blocks", "remove": false}]` | adds or removes links |
| `comment` | `{"body": "…", "checklist_item_id": "…", "reply_to": 12, "reply_to_request": "…", "list": {"label": "…", "options": [...]}, "mentions": ["MAIN-14"]}` | writes one comment |
| `comments` | `[{"body": "…"}, {"body": "…", "reply_to": 12}]`, not with `comment` | writes comments, in order |
| `resolutions` | `[{"comment_id": 12, "resolution": "…", "reopen": false}]` | marks thread roots resolved |
| `questions` | `[{"kind": "question", "prompt": "…", "fields": [...]}]` | asks as `create_work_item_request` does |
| `summary` | `{"done": "…", "next": "…", "why": "…", "friction": "none", "list": {"label": "…", "options": [...]}}` | records the closing summary |
| `transition` | `{"state": "completed", "reason": "…", "force": false}` | moves the state |
| `defer` | `{"until": "2026-12-01", "reason": "…", "force": false}`, not with `transition`, `move_out` or `convert` | puts the item off until a day, a time with its zone, or an open item's close ([work model](work-model.md#goals-and-stages)) |
| `move_out` | `{"reason": "…", "force": false}`, not with `transition`, `defer` or `convert` | takes the item out of its goal or stage, to triage |

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

Valkama attaches each commit your session makes to the task you hold, and its
hook answer says where it went; `commits` is for the rest. When the answer names
several tasks, attach the commit to the right one with the call the answer gives.
Send `remove: true` on the item that has a commit by mistake, then attach it
where it belongs. `repository` is the registered project's id and `hash` a whole
hash or its first 7 or more hex digits, which the project's repository expands
on this machine; without its root here, only a whole hash is taken. A goal or
stage takes a commit too; a task also gains the commit's project, and loses it
again with its last commit unless it names the project. A refusal starts with
`[commit]` and says what to send: the registered ids for an unknown project, more
digits for an ambiguous start, the full hash where there is no root, and that the
item has no such commit for a `remove`. A commit is never a ref: `refs` refuses
the kind `commit` and names the `commits` group.

A typical close, in one call:

```json
{"id": "MAIN-12", "expected_revision": 7,
 "checklist_ticks": [{"item_id": "…"}],
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

A list under a comment offers the owner findings to choose from: `list` is
`{"label": "What to take on", "options": [{"id": "a", "label": "Widen the check",
"recommended": true, "why": "Two of the five misses are its."}, …]}`, up to 20
options written as a question's options are. The batch's `comment`, `comments`
and `summary` take it, on a root only, and the comment and its list are one
write; the answer adds `list_request_id`. It is a question of one `multi_choice`
field, `items`, which the owner ticks with one button: its answer is
`{"items": ["a"]}`, told to you and the holders as `question_answered`. Nobody
waits for it: it raises no alert and is not among the questions waiting for the
owner. Read it with the item's questions, where it carries `comment_id`.

## Reading an item

`get_work_item` takes `id` and reads an item by parts. `parts` names them, one
name or a list: `card`, `comments`, `events`, `links`, `refs`, `commits`,
`questions`, `mentions`, `sessions`, `images`, `subscribers`, `claim` and
`sections`, and on a goal or stage `participants`, and `confirmation` while it
awaits confirmation. The
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
`container_state`, `acceptance`, `started_at`, `waits_for`, `cancelled_blockers`
(only when there are any), `workable`, `withheld`, `projects` (the projects the item changes, each with its `project_id`, the
registry's `display_name`, null while the registry does not record it, and its
`source`: `named`, `commits` or `migrated`; a goal's or stage's are those of
every task under it), `claim_ref`, `claim_state`, `last_claim_ref`,
`lapsed_claim`, `closed_at`, `labels`, `source`, `revision`, `created_at`, `updated_at`, `url`,
`parent` (a reference or null),
`description` whole, `checklist` (each step's `id`, `text` and `done`, and
`claimed_by` and `done_by` when they are set, and `by_previous_holder: true` when
a lapsed holder ticked it), `summary` when there is one, and
`parts`: each other part the item has, with its size. A part with nothing in it
is left out.

| Part | On the card | Read, it answers with |
| --- | --- | --- |
| `comments` | `count`, `threads`, `unresolved`, `chars` | `comments` as the table below says, `comments_total` (every row), `threads_total` (the roots), `unresolved_total` (the roots without the mark) and `truncated` |
| `events` | `count`, `chars` | `events`, the 10 newest oldest first, or the newest `events: <n>`; `events_total` and `events_truncated` |
| `questions` | `count`, `open` and `addressed_open`, the open requests asked of agent sessions | `questions` as [Requests](#requests) says |
| `mentions` | `count` | `mentions`, the 50 newest texts on other items that named this one, oldest first, each with `in` (`comment`, `report`, `summary` or `description`), `from`, `quote`, `author`, `by_person` and `at`; `mentions_total` |
| `claim` | `count`, 1 while it is held | `claim`, the lease: `holder`, `state`, `session_id`, `agent_id`, `source`, `acquired_at`, `last_seen` and `expires_at`, the time it lapses unless the session shows a sign of life; null while nobody holds it |
| `sections` | `count`, for a description longer than 2,000 characters | `sections`, as below |
| `commits` | `count`, the commits attached now | `commits`, the newest first, each with `repository`, `display_name`, `hash`, `subject`, `committed_at`, `session`, `agent`, `attached_by` (`server`, `manual` or `migrated`) and `label` |
| `links`, `refs`, `sessions`, `images`, `subscribers` | `count` | the list of that name |
| `participants` | `count`, on a goal or stage | `participants`, the live sessions working on it: each `session`, `client`, `label`, `holds` (the tasks under it it holds), `follows` and `last_seen` |
| `confirmation` | `count`, the items it lists, only while a goal or stage awaits confirmation | `confirmation`: `since`, `steps` (how many it has; 0: check it against its description), `cancelled` and `moved_out` (each `reference` and `reason`), `asked` (the owner's question, once asked) and `left_for_next_session` |

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

## Guards

| Moving to | Needs |
| --- | --- |
| an active state | a holder after the move: a claim on the item or on one of its steps; `force` does not carry this |
| ready, active, review, blocked or completed, for an item with no basis | a basis of acceptance (`acceptance`), which `force` does not carry |
| a deferred state | refused: put work off with `defer` |
| anything but a cancelled state, for an agent, out of triage or deferred, while the owner is asked whether to do the item or take it up again, on it or over an item with no basis | refused with `acceptance_question`, which `force` does not carry |
| active, review or blocked, for a goal or stage | refused: a goal or stage is accepted (ready), completed or cancelled |
| a triage state, for an accepted open goal or stage | refused: an accepted goal or stage is completed or cancelled |
| a completed state, for a goal or stage never accepted, from triage or deferred | refused: a goal or stage that was not accepted is not done; not doing it is a cancellation |
| a completed state, for a goal or stage | nothing open under it at any depth, triage and deferred included, which `force` does not carry (`children`); when the last item under it closes it awaits confirmation, and completing it is the confirmation |
| a review or completed state | every step done and a summary |
| a review state, from outside review | `to_check`, what the owner is to check, which `force` does not carry (`review_question`); the move asks it of the owner |
| a review or completed state | no step marked `by_previous_holder`: tick it again to confirm it, or reopen it (`previous_holder`) |
| a cancelled state | a summary; open steps stay open |
| a cancelled state, for a goal or stage with open work under it | `cancels` set to the `list_token` its refusal (`cancel_list`) handed over, which `force` does not carry; the move then cancels that work too |
| a blocked state | a `reason`, for a cause outside Valkama; work that waits on an item is linked `blocks` and stays where it is |
| any state | a transition the workflow allows from where the item stands |
| review, blocked, completed or cancelled, for an item being created | refused (`new_item`): create it, then move it there; `force` does not carry this |

A move to review warns, and is not refused, when the item has no `session` ref,
no attached commit and no write a confirmed session made.
An agent's move to a completed or cancelled state is also refused with
`person_spoke` while a person acted on the item since an agent last wrote to it;
the refusal names what they did. The answer a cancel's `transition.following` names
is left out; any other act still refuses it. A `comment` sent in the same
`apply_work_item_changes` call does not lift it. An agent's move that completes an
item or takes it out of review is refused with `question` while a question to the
owner is open on it, `force` or not; cancelling is not.
`force: true` carries a refusal through and records an `overridden` event.

## Closing a release

Before closing the release's goal, run
`valkama released --space MAIN --repo <checkout> --range v1.0.0..v1.1.0`. It
lists the open items whose attached commits went into that range, including a
change that arrived under another hash, and it changes nothing. `--repo` is the
checkout of a registered project: its attached commits are compared, and those
attached with no repository by their hash. Check each item and close what is
finished: partly released work shows as well, a `changed-patch` or `subject`
match is weak, and an item with no attached commit cannot show.

## When a call is refused

| Refusal | What to do |
| --- | --- |
| `revision_conflict` | Someone wrote since your read: read the item, then retry on the new `revision`. |
| A claim held by another | Take other work, or take it over only on an instruction (`force: true`). |
| `workflow_guard` with `[executor]` | Claim the item or a step before moving it to an active state. |
| `workflow_guard` with `[acceptance]` | Send `acceptance: "assignment"` only on the owner's word; otherwise leave the item to the owner to accept. |
| `workflow_guard` with `[checklist]` or `[summary]` | Tick what was done, move undone work to an item of its own, record the summary, then close. |
| `workflow_guard` with `[blocker]` | Give the reason: blocking by hand is for a cause outside Valkama; link `blocks` for work that waits on an item. |
| `workflow_guard` with `[new_item]` | Create the item, then move it. |
| `workflow_guard` with `[review_question]` | Send `to_check`, what the owner is to check. |
| `workflow_guard` with `[question]` | Wait for the owner's answer, or withdraw a question you asked. |
| `workflow_guard` with `[children]` | Close, cancel or move out what is open under it; it then awaits confirmation. |
| `cancel_list` | Read the list, then send the same transition with `cancels` set to `list_token`. |
| `owner_only` | The owner answers this question in Valkama: leave it. Every question with a purpose but a `consent` request is theirs, and so is every question a waiting write carries. |
| `not_asker` | Only the session that asked withdraws the question; one Valkama asked ends with the write that ends its wait. |
| `[purpose]` | A question with a purpose (review, confirm, return, goal, task, cancel, condition), a `consent` request and a question a waiting write carries take one of their answers, and their answer is not changed or declined. |
| `[participation]` | Another write of that point waits for the owner on the item: wait for the answer, or withdraw that question first. Send `following` only with a cancel, naming an answered question of the owner on the item or above it. |
| `close_with_waiting` | Close the item after the answer, or send the waiting change in a call of its own. |
| `[checklist]` naming `checklist_reason` | Say why the change removes or rewrites a step of the goal or stage, or send a step that only says the same better by its `id` with `clarifies: true`. |
| `[decision]` | Recommend an answer in every required field, or ask a `question` when there is nothing to recommend. |
| `[consent]` | Answer `agree`, `object` with a `reason`, or `moved_out` once `move_out` took your task out of what the cancel closes. |
| `queue_off` | The refusal says `the owner hands out work in MAIN by hand: take the item they named with claim_work_item`: do that. |
| `workflow_guard` or a claim refused with `[acceptance_question]` | Wait for the owner's answer, then take it. |
| `[deferral]` | Send `until` and `reason`; `until` is a day, a time with its zone, or an open item other than this one and the goals and stages over it. |
| `[move_out]` | Give the reason the item leaves its goal or stage; an item under none, or closed, has nothing to move out of. |
| `[parent]` | Clear a parent with `move_out`, not an edit; accept the goal or stage first, or move the item out, before accepted work goes under it. |
| `[convert]` | Send the word the refusal names: `stage` for a task under a parent, `goal` for one without, a task kind for a goal or stage; move out what stands under a goal or stage first, and reopen a closed item. |
| `[split]` | Send `split_from` with `steps` alone, without `parent`, `state` or `acceptance`; split a part off an open task, not one in review, and name only its own step ids. |
| `workflow_guard` with `[person_spoke]` | The owner acted on the item: read what the refusal quotes, write what you did about it, then close. |
| `workflow_guard` with `[transition]` | The workflow has no such move, or no state to start or requeue the task in; go through a state it allows. |
| An unknown state | The refusal lists the workflow's states and the categories that name one. |
| A refused batch or creation step | The message starts with the group and index; correct that entry. |

## Claims

A claim is a lease on the session that took it: `live` while that session is
active and showed a sign of life within the lease term of the item's space,
`lease_quiet_days` (3 days unless the owner changed it), `stale` once it ended or
went quiet, `unconfirmed` when no session was proved. A launch's claim is a
lease of the session the launch started, which the launch proves
(`source: launch`): it is `live` while the launched agent runs and follows the
same rule after it ends. That session is the agent's own when the launch assigns
or resumes it. On a fresh launch of a client that announces its own session once
it runs, as Codex does, it is the launch's (`launch-…`): the agent's own session
does not hold that claim, and a resume reattaches to the session the agent
announced. An unconfirmed claim, the owner's own from the browser included,
lapses after that many days without an event on the item. An open question to the owner on the item stops the count of silence
for every hold on it; an end still counts. A session's claimed steps lapse with
its lease. `claim_work_item` releases a stale or lapsed claim at once, and taking
it over needs no `force`; a live or unconfirmed claim held by another needs
`force`. Everything else leaves the claim of an ended
session alone for 12 hours after its end, so a resumed session reads `live` again
with its claims in place: until then `claim_ready_work_item` does not hand the
item out and a server start does not release it. The history names why a claim
was released: `session-ended`, `session-missing` or `lease-expired`, the last for
a quiet lease term. A step's claim lapses with its session by the same rules, and
releasing a lapsed claim releases the steps its session holds there, each written
as `checklist_released` with the step's text; a hold of the session making the
call stays. The release marks every step the lapsed holder ticked
`by_previous_holder`, at work or blocked, until a tick confirms it, and the
item's `lapsed_claim` (`holder`, `reason`, `at`) names that release until the
next claim. After a resume or a compaction the session's Valkama note names such
a step `(to confirm)` and lists the items whose claim or step the sweep released
since the session's last write call in `No longer held by you: …`, a subagent
only its own. `release: true` requeues an item that was
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

### A review of many points

A review of many points is one `verdict` field per proposal: the owner
accepts it, puts it off or rejects it, and may comment on it or give an own
variant. The steps or the ways of a point are a field `under` it,
`{"field": "p4", "option": "accept"}`, which stands right after it and is shown
and answered only while the point is accepted; a `group` per area replaces a
field per executor. Everything the owner chooses from is an option: never a step
in a label or a description, never `p4a` in a field shared by several points.
Put `recommended`, with its `why`, wherever you have one: a button drafts from it.
Two points, one with its steps and one with its way:

```json
[{"id": "p4", "label": "P4 Checks: false alarms", "type": "verdict", "required": false,
  "options": [], "group": "Checks", "recommended": "accept",
  "why": "All fourteen false alarms came from one rule."},
 {"id": "p4-steps", "label": "Steps", "type": "multi_choice", "required": true,
  "under": {"field": "p4", "option": "accept"},
  "options": [{"id": "p4a", "label": "Mark the refusals, then narrow the rule", "recommended": true,
               "why": "The marks show which cases the narrower rule must keep."},
              {"id": "p4b", "label": "Skip the check on an intermediate stop"}]},
 {"id": "p13", "label": "P13 A 400-line limit for .vue files", "type": "verdict",
  "required": false, "options": [], "group": "Web code", "recommended": "accept",
  "why": "Six files passed 400 lines this month."},
 {"id": "p13-way", "label": "How", "type": "choice", "required": true,
  "under": {"field": "p13", "option": "accept"},
  "options": [{"id": "per_block", "label": "vue/max-lines-per-block", "recommended": true,
               "why": "The rule already exists; no file moves."},
              {"id": "split_first", "label": "Split the files first"}]}]
```

A field `under` a later field, a field of a type other than `verdict`, `choice` or
`multi_choice`, a field that is itself under another, or an option its parent lacks
is refused, naming the field and how to put it right.

### Answering and reading a question

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
`[unchanged]` when nothing differs, `[item_closed]` once the item is closed and
`[answer_versions]` past 50 versions.

A request is `pending` until it is answered, declined or expires; it expires
when its item closes, with `item_completed` or `item_cancelled` and for good, or
when its deadline (`expires_at`) passes. A comment over an
open question changes nothing about it.

The `questions` part of `get_work_item` is
`{"total": 6, "open": 2, "items": […], "truncated": true, "addressed_open": 0}`, at
most 5 items, the open ones first and then the newest closed; a request asked of an
agent session stays out of them, and `addressed_open` counts the open ones. The card's
`parts` counts them: read the part when you come back to an item that has open ones.
`list_work_item_requests` takes `space`, `id` (one item), `status`,
`answered_after` (an ISO timestamp with a timezone), `limit`, `offset`, `full` and
`addressed`, and its page says `truncated` and `next_offset`. `addressed: true`
lists the open requests asked of your own session; answer each with
`answer_work_item_request`, from your conversation or a subagent. After a resume or a
compaction the session's Valkama note names their items, the item of the newest
request first, in `Waiting for your answer: …`; a subagent's note does not. A request asked of
a session is answered only by that session (`not_addressed` refuses anyone else)
and withdrawn only by the session that asked (`not_asker`); while the session asked
has ended or gone quiet, it reads expired with `session_gone`. The question a move
into review asks is the owner's to answer (`owner_only` refuses an agent); the
answer completes the item or returns it to ready, and withdrawing it, which only the
asking session does, returns it to ready too. The question Valkama asks to confirm a
goal or stage nobody confirmed (purpose `confirm`) is the owner's too, and nobody
withdraws it; the owner's answer completes it or leaves it to the next session that
takes work in its space. So is every question of purpose `goal`, `task`, `cancel` or
`condition`, and every question a write that waits for the owner carries, whatever its
purpose ([Writes that wait for the owner](#writes-that-wait-for-the-owner)); none of
them, nor a `consent` request, is declined or has its answer changed (`[purpose]`).
With `answered_after` the oldest answer comes first, and a page runs past `limit`
rather than part two answers of one time: to read answers in portions, keep the last
`answered_at` you read, pass it as `answered_after`, and ask again while `truncated`
is true; a changed answer comes again. Both give a compact form
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
variant. `previous` has the same shape. Treat an undecided point as not decided,
never as accepted; a point with its own variant is decided and in neither list.

A list under a comment adds `comment_id` and `undecided`: `["items"]` while nothing
on it is ticked, which a send with none ticked leaves it, and `[]` once something
is. `previous` has it too. Treat `["items"]` as not decided, never as every option
refused; `status` tells a list not sent yet (`pending`) from one sent empty
(`answered`).

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

### Asking another session

Ask a session when you need its answer before you go on — a choice, a yes or no —
and only one that is working. `create_work_item_request` with `addressees` (1 to 5
top-level session ids, as `participants`, `subscribers` and holders name them, the
holder among them) asks those sessions instead of the owner: one request each, with the call's `kind`, `prompt`, `fields` and
`expires_at`, and the answer is `{"requests": [{"request_id": "…", "addressee":
"…"}]}`. Your session is the one that asked, whichever of its agents called. Each
request wakes the session it asks; its answer wakes yours as `your question answered
… by agent <id> of session <id>: <field>=<value>, …`, by the ids you sent. Refused
with `invalid_request`, naming the session where there is one: a call that proved
no agent session, an unknown session, one that ended or went quiet past its lease,
your own, a subagent's, one named twice, more than 5 or none, and `execution_id` or
`session_id` beside `addressees`. A session asks one other at most 3 times an hour:
the fourth is refused with `ask_limit`, so ask once with every field you need. For a
free exchange, write a comment with `awaits_reply` instead. The batch's `questions`
take `addressees` too, and answer with `requests`.

## Merging

Merge before handing the work to anyone.
`merge_work_items` takes `id` (the survivor), `items` (1 to 20), and optionally
`reason`, `force`, `expected_revision` (the survivor's) and `author`. What
moves: steps (their ids, ticks and step claims kept), discussion threads whole,
questions with their replies, refs and attached commits the survivor lacks,
links in their own direction, and projects (a project more than one of them names keeps the
strongest source: named, then commits, then migrated); `moved.comments` counts
the comment rows, replies included. A list goes with the comment it stands
under. What stays on a merged item: its history, reports with their threads and
lists, description, labels and parent. Each merged item is linked `duplicates`
to the survivor, gets a summary naming it, is released and closes in its
cancelled state. Refused, writing nothing: the survivor in `items`, an item
named twice, another space, a closed item, a goal or stage with a task, a merged
item with children, more than 100 steps in all, a workflow with no reachable
cancelled state, or an item another session holds without `force`.
