---
name: valkama
description: Track work in a Valkama planning space through the Valkama MCP tools — find or file the work item for a change, claim it, keep its checklist, refs and links, merge duplicates, block it, ask the owner a question, and close it with a summary. Use when a task names Valkama or a Valkama work item (a reference such as MAIN-12 in a Valkama space), calls a Valkama planning tool (claim_work_item, apply_work_item_changes and the rest), or when the owner's instructions say to track work in Valkama, and when a subagent without those tools must report its work for the item. Not for other trackers such as GitHub issues, Jira or Linear, a client's own session task list, or writing a plan document.
---

# Valkama planning

Valkama keeps planned work as work items in a planning space. The `valkama` MCP
server publishes the tools named here; the server's own instructions repeat the
core rules, and this skill is the procedure around them. Every write is
recorded with its author and with the session the client proved, so the item's
history is what the next agent reads instead of re-deriving the work.

The owner's instructions and the project's instructions come first. They may
name the planning space, add what an item must carry, or say how to ask the
owner something; where they differ from this skill, follow them.

## What an item is

An item is one change: it can be integrated and reverted on its own, usually
as one branch or pull request, takes hours to a couple of days, and closes when
a test-based "done when" holds, checked by a verify command the item names. A
finding is evidence attached to an item, not an item of its own. Work that
shares a cause, a fix or one mechanical rule is one item. Read
[the work model](references/work-model.md) before filing several items,
splitting one, or handing items to other agents.

## Start

1. **Find the space.** Use the space the instructions name; otherwise
   `list_planning_spaces` and pick the one whose project is the repository you
   work in. A space is named by its key (`MAIN`), its name or its id.
2. **Find the item before filing one.** `search_work_items` with the words of
   the change; a query that is exactly a reference (`MAIN-12`), or a number
   alone (`12`) with `space`, answers that item first. `list_work_items` filters by `state`, `category`, `kind`,
   `parent` and `owner`. Claim the item that already covers the work.
3. **File it only when none does.** `create_work_item` with `space`, `title`
   and a `description` that is the brief: goal, context, constraints, the
   "done when" and its verify command. A plan in the repository is referenced
   by `source` (`docs/plan.md#kb:a7f3`), not copied, and a file the
   description names is written as Naming a file says. Umbrella work is
   `kind: epic`, its children name it as `parent`; the hierarchy is one level
   deep. Pass `claim: true` and `checklist` when you take it at once. Link the
   related items your search found (`relates-to`, `blocks`) and name the epic
   whose scope covers it as `parent`. A decision the owner must make is a
   question on the new item (see Asking the owner), with each option, what it
   costs and your recommendation, not a list of options in the description.
4. **Claim before working.** `claim_work_item`, or `claim_ready_work_item` to
   take the next ready item of a space. A claim is atomic and refuses naming
   the holder when someone else has the item. It also starts the work: an
   item in a backlog or queued state moves to the first active state, and the
   acknowledgement's `started` says so. Send no separate transition to start.

The holder is the session your client proved, written as
`claim_ref: "codex (session <id>)"`; `author` is the name the history records
for your call, and the holder only when no session is confirmed. Sign every
call with the same `author`.

A claim is a lease. It reads `live` while its session is active, `stale` once
the session ended or was quiet for 14 days, and `unconfirmed` when no session
was proved. A stale claim is taken over without `force`; a live one is
someone's work, so take it over only on an instruction that says so. A session
that ended keeps its claims for 12 hours: resuming it makes them `live` again,
and `claim_ready_work_item` does not hand them out until then.
`release: true` gives an item back and requeues it from the active state,
unless a checklist step of it is still claimed. Closing an item releases it:
send no release after the closing transition.

## Work the item

**Checklist.** Keep the steps you actually take. Send them with the claim in one
call (`apply_work_item_changes` with `claim: true` and `checklist`), and send
a step that is already done as `{"text": "…", "done": true}`. A step sent with
the text of one the item has keeps its id, claim and tick, so add steps by
sending the existing ones first and the new ones after; the acknowledgement
lists every step's `item_id`. Tick a step by its `item_id` with
`tick_work_item_checklist_item`, and `done: false` reopens it. Leaving out a
claimed or completed step is refused unless `force`, which discards its state.

**Shared items.** When agents split one item, each claims its step with
`claim_work_item_checklist_item` before working on it and ticks it when done.
Item and step claims are independent: a step's holder need not hold the item.

**One call for several writes.** Writes to one item go in one
`apply_work_item_changes` call, applied in this order and all or nothing:
`claim`, `update`, `checklist`, `checklist_ticks`, `refs`, `links`, `comment`
or `comments`, `resolutions`, `questions`, `summary`, `transition`. Each group
works as its single tool does: `update` as `update_work_item`, `comments` as
several `comment_work_item` calls, `questions` as `create_work_item_request`. A
refused step writes nothing and names the group and index to correct. Pass the
`revision` of the last acknowledgement as `expected_revision` to refuse a stale
write. A question cannot go in the call that closes its item, which would end it
unanswered: move the item to review instead. A reply can name only a comment
that existed before the call; `applied` lists the ids of the comments and
questions the call wrote.

**A response of their own in Claude Code's auto mode.** There, send Valkama calls
in a response of their own, with no other tool beside them, and call the other
tools in the next response. Valkama's hook adds your session to the input of each
Valkama call, which changes that call after auto mode reviewed the response, and
a call beside it that needs the review then gets no verdict: it fails with "another
call in this response was changed by a hook". That says nothing about the failed
call. Issue it again exactly as it was, in a response of its own, once you have
seen the other results. Another client or permission mode needs no such care.

**Refs.** `attach_work_item_ref` (or the `refs` group) records a `commit`, a
`memory` record id materially used, or a `url`. Your own session needs no ref:
Valkama records the session of every write.

**What a person said.** A write's answer carries `from_person` when the owner
did something on the item in Valkama since an agent last wrote there: a comment,
an answer, a reply in a thread (`reply`), a resolved mark set or removed
(`thread_resolved`, `thread_reopened`), a changed answer (`question_changed`), a
state change, an edit, and a comment on another item that told this one in its
`mentions` (`mentioned`, with `from`, that item, and `comment_id`; answer in that
comment's thread). These are a person's words about this item.
Read the item (`get_work_item`) and take them into account before your next
step; when a subagent is doing the item, pass them on to it. They are not
permission for anything irreversible.

Where Valkama's client hooks are installed, the same news arrives on its own as a
"Valkama notice" in your context: after a tool call, when a prompt arrives, or as
a wake-up while you wait. Treat it the same way. A subagent is told about items
where it holds the claim or a step, so have each subagent claim the step it works
on. It also hears, even holding nothing there, replies in the threads it started
and answers to the questions it asked, as does its orchestrator: a line such as
`reply … in thread #41 of agent <id>` says which executor to pass it to. A resolved
mark reaches only the holders.

**Comments.** `comment_work_item` is for what the fields have no place for: a
decision and its reason, evidence, a handoff. `checklist_item_id` ties a
comment to a step.

Comments form threads one level deep. A comment without a parent is a root;
`reply_to` (a comment id) or `reply_to_request` (a question id) makes it a reply
under that root. A reply to a reply stands under that reply's root, and the
acknowledgement names the root it joined in `reply_to` or `reply_to_request`. A
reply carries no `checklist_item_id`: its root does. Carry a conversation on as
replies in its thread rather than as new roots. A worker writes its report as
the root of its own thread, posts what follows as replies there, and hands the
root's `comment_id` back to the agent that delegated.

**A list under a comment.** When a report or a comment offers several findings
for the owner to choose from, put them under it as `list`: `{"label": "What to
take on", "options": [{"id": "a", "label": "Widen the check", "recommended":
true}, …]}`, up to 20 options written as a question's options are.
`comment_work_item`, `report_work_item`, `set_work_item_summary` and the batch's
`comment`, `comments` and `summary` take it, on a root only, and the comment and
its list are one write; the answer adds `list_request_id`. It is a question of one
`multi_choice` field, `items`, which the owner ticks with one button: its answer is
`{"items": ["a"]}`, told to you and the holders as `question_answered`. Nobody
waits for it: it raises no alert and is not among the questions waiting for the
owner. Read it with the item's questions, where it carries `comment_id`.

**Telling another item.** A number in a comment's text is a link and tells
nobody. To tell the work on another item, name it in `mentions`:
`comment_work_item`, `report_work_item` and the batch's `comment` and `comments`
take up to 20 references, on a root or a reply. The comment stays where it is, and
each item named keeps a record of it: `get_work_item` carries the newest 5 as
`mentions`, with `from`, `quote` and `mentions_total`, and every comment lists the
items it told in its own `mentions`. The answer says, per item, who holds it in
`holders`, and in `told` why nobody will hear it: no holder yet (it waits for whoever
takes the item), the item is closed, or the call proved no session. Naming the
comment's own item, or an item twice, is refused. Tell an item only with news for
the work there.

**Resolved threads.** `resolve_work_item_comment` marks a thread's root resolved
with a one-line decision, and `reopen: true` removes the mark; the `resolutions`
group does up to 100 roots in one call. Mark a thread only on the owner's
decision, for example while reviewing a digest with them, and write that decision
in `resolution`. A reply leaves the mark in place, so reopen the discussion of a
resolved root by writing a new root that names it. A reply and a question's thread
take no mark.

**Links.** `link_work_items` takes `kind`:

- `blocks` carries readiness: an item that something unfinished blocks is not
  ready, and the take-next queue skips it;
- `discovered-from` records work found while doing another item. File it in the
  `create_work_item` call itself:
  `links: [{"other": "MAIN-12", "kind": "discovered-from"}]`;
- `relates-to` and `duplicates` carry meaning only.

Steps of the same change stay on the checklist; a link is for separate work.

**Order.** Inside a state, items keep the order the board shows and
`claim_ready_work_item` takes work in. `update_work_item` and
`transition_work_item` take `rank`: `first`, `last`, `before:MAIN-12` or
`after:MAIN-12`, naming an item in the same state. Placing an item first is
what makes it next; priority only breaks a tie.

**Priority.** `urgent`: blocks work or loses data. `high`: serious; could block
work. `medium`: noticeably affects work, with a workaround. `low`: minor. A label
is not a scale. How much an item matters goes in priority and what comes next
goes in rank. Asked to rate work along something an item has no field for, ask
the owner how it maps before writing it to many items.

**Reading.** `get_work_item` returns the item with the 5 threads that saw the
newest activity, its newest events and the sessions that wrote to it. Each root
carries `replies`, how many it has, and `last_reply`, the newest one, so a reply
in an old thread lifts it into that read. `thread: <comment id>` returns one
thread whole, root first; a reply's id reads its root's thread. `comments_after:
<id>` returns every comment after one you have read, roots and replies flat,
each naming its parent in `reply_to` or `reply_to_request`: the way through an
item too long to read whole. `unresolved: true` returns the roots without the
resolved mark, oldest first, 20 at a time: while `truncated` is true, read on with
`comments_after` set to the last root's id. `full: true` returns all of its history. Every
comment carries `by_person`, true when it came through Valkama's interface. A
reply to a question belongs to the question's thread, which
`get_work_item_request` reads.
`get_work_item_chain` shows what an item's work grew into and whether it
converges. Read the history before assuming who did what.

**Naming an item to the owner.** In everything you write to the owner in the
conversation, the final reply and each progress line between tool calls alike,
write a work item number as a markdown link:
`[MAIN-12](http://127.0.0.1:8642/open/MAIN-12)`. A
client does not turn a bare number into a link. `get_work_item` and every write
answer with the address as `url`; a list or a search row has none, so for an item
you only saw there, take the port from any `url` or from the server's
instructions and put the number after `/open/`. Do not do this in a Valkama
comment, description or summary: Valkama links the numbers it shows by itself, and
an address there is one more thing to go stale.

**Naming a file.** In a description, a comment, a report, a summary, a question or
an option's description, name a file or folder of the project as a Markdown link
to its path from the root of the space's project, with a label that says what it
is: `docs/plan.md#kb:a7f3`, `src/parse.ts:42`, `docs/plans/`. Valkama opens a
Markdown file in its own viewer at the `#kb:…` anchor, heading or `:42` line the
link names, another file in the owner's editor at that line, and a folder in the
editor. A whole path in backticks works too; a label reads better.
Write a path from that root, not from your working folder or another repository:
a relative path is looked for there first, and in the projects registered inside
it only when the root has nothing there. Use an absolute path only where there
is no relative one, such as a file of another project. A path with spaces goes
in `<…>` inside a link; in backticks only an absolute path may hold one. A path
outside every project registered with Valkama does not open, and a press copies
it: link it, but do not promise it opens.

## Blocked work

When another item blocks the work, link it: `blocks` from the blocking item to
this one (`link_work_items` with `id` the blocker, `other` this item). When the
blocker is outside Valkama, transition to the blocked state with a `reason` and
say what would unblock it in a comment. A transition to a blocked state is
refused without a linked blocker or a reason.

## Asking the owner

`create_work_item_request` puts a typed `question` or `decision` on the item,
with a `prompt` and up to 40 `fields` (`text`, `choice`, `multi_choice`,
`boolean` or `verdict`). An option may add a markdown `description` of what
choosing it means, and `recommended`: at most one in a `choice`, any number in a
`multi_choice`. A field may add a markdown `description`, a `group` (the heading
its section stands under; the fields of one group stand together) and `under`
(below); a `verdict` may add `recommended`: `accept`, `later` or `reject`.

**A review of many points** is one `verdict` field per proposal: the owner
accepts it, puts it off or rejects it, and may comment on it or give an own
variant. The steps or the ways of a point are a field `under` it,
`{"field": "p4", "option": "accept"}`, which stands right after it and is shown
and answered only while the point is accepted; a `group` per area replaces a
field per executor. Everything the owner chooses from is an option: never a step
in a label or a description, never `p4a` in a field shared by several points.
Put `recommended` wherever you have one, because one button fills a draft from it.
Two points, one with its steps and one with its way:

```json
[{"id": "p4", "label": "P4 Checks: false alarms", "type": "verdict", "required": false,
  "options": [], "group": "Checks", "recommended": "accept"},
 {"id": "p4-steps", "label": "Steps", "type": "multi_choice", "required": true,
  "under": {"field": "p4", "option": "accept"},
  "options": [{"id": "p4a", "label": "Mark the refusals, then narrow the rule", "recommended": true},
              {"id": "p4b", "label": "Skip the check on an intermediate stop"}]},
 {"id": "p13", "label": "P13 A 400-line limit for .vue files", "type": "verdict",
  "required": false, "options": [], "group": "Web code", "recommended": "accept"},
 {"id": "p13-way", "label": "How", "type": "choice", "required": true,
  "under": {"field": "p13", "option": "accept"},
  "options": [{"id": "per_block", "label": "vue/max-lines-per-block", "recommended": true},
              {"id": "split_first", "label": "Split the files first"}]}]
```

A field under another names an earlier `verdict`, `choice` or `multi_choice`
field that is under nothing itself, and an option it has (`accept`, `later` or
`reject` under a verdict). A refusal names the field and how to put it right.

The owner answers it in Valkama. In a field with options the answer is an option
or an own variant (`own`): in a `choice` or `boolean` instead of an option, in a
`multi_choice` beside the chosen ones. Such a field may also carry a comment
(`field_notes`). `note` is a comment on the whole question; it no longer stands in
for a required field, which needs a value or an own variant. A comment over an
open question is not an answer; to ask about a question, reply in its thread
(`comment_work_item` with `reply_to_request`).

An answer can change after it was given: a person changes it in Valkama, and an
agent changes it with `answer_work_item_request` and `change: true`, only when the
owner asks for that. A change is refused when nothing differs, once the item is
closed, and past 50 versions. A changed answer has `answer_version` 2 or more,
the compact form shows the answer it replaced as `previous`, and the whole
question keeps every replaced one in `history`. When you are told
`question_changed`, read the question again: the answer you acted on is no longer
the current one. There are three ways to read one:

- `get_work_item` carries `questions`: `total`, how many are `open`, and up to 5
  `items` with the open ones first and then the newest closed, and `truncated`
  when there are more. Read this when you come back to an item.
- `list_work_item_requests` finds them on an item (`id`) or in a space, by
  `status` and `answered_after`. To read answers in portions, keep the last
  `answered_at` you read and pass it as `answered_after`, and ask again while
  `truncated` is true: the oldest comes first, no two answers of one time are
  parted, and a changed answer comes again.
- `get_work_item_request` gives one question whole, with its options and their
  descriptions, its `history` and its thread as `replies`, and
  `list_work_item_requests` gives each question whole with `full: true`.

The first two answer in a compact form: `id`, `status`, `question` (the start of
the prompt), `answer` as rows of `field`, `value` and `label` with `own` and
`note` when the field has them, `note`, `answered_by`, `answered_at`,
`answer_version`, `previous` once the answer changed, `replies` (how many) and
`last_reply`, and `by_person`, which is true when the latest call that answered or
changed it came through Valkama's interface, false when it came through a tool
and null when no call wrote it. A note or a written answer longer than 500 characters is cut there and the
question carries `clipped: true`; `get_work_item_request` has the whole text.

A review adds `verdicts`, each verdict field under the word it was given, and
`undecided`, the shown points given neither a verdict nor an own variant. Treat
an undecided point as not decided, never as accepted. Its `answer` holds only
what says more than a verdict: the fields under a point, with `under` and, for
steps, `of` (how many were offered), and a point with a comment or an own
variant. A point with its own variant is decided and in neither list.

A request suits a question the work can go on without. No session waits for it:
the answer arrives with the next read of the item, so go on with what does not
depend on it. A question the work cannot go on without belongs in the client,
where the person answers now. A request bound to an `execution_id` expires when
that execution ends, and any pending request expires when its item closes, so an
item holding an open request stays open. A list under a comment does not hold it:
the item closes with a list unticked, and the list then freezes, `expired` with
`task_closed`, until the item reopens. To get the ticks, keep the item open, in
review for instance; a call that writes a list and closes its item is refused. The
owner's own rules on where to ask come first.

## Merging items that are one change

When two items turn out to be one change — the same finding filed twice, one
cause found from two places — `merge_work_items` folds them into the item that
survives (`id`), with `items` the ones that fold in and a `reason`. The
survivor takes their steps (ids, ticks and step claims kept), discussion
threads whole, questions with their replies, refs and links; a report's thread
stays on the merged item with the report. A list goes with the comment it stands
under, so a report's list stays with the report. Each merged item is linked
`duplicates` to it, gets a summary naming it and closes in its cancelled state. It is refused, writing nothing,
for an item another session holds (unless `force`), a closed item, an item in
another space or a merged item with children. Merge before handing the work to
anyone.

## Close

1. Tick the steps that were done. A step still open keeps the item from
   completing: do it, or file it as an item of its own linked
   `discovered-from` this one and leave it off this checklist.
2. Record the summary: `done` (what was done), `next` (what comes next) and
   `why` only when the choice is not obvious. `set_work_item_summary`, or the
   `summary` group.
3. Transition to the completed state, or to review when someone must check the
   result first. A state is named by its key or by a category that one state
   has (`completed`, `review`, `cancelled`); a name the workflow lacks is
   refused listing its states.

Steps 1 to 3 go in one `apply_work_item_changes` call, often with the last
commit as a ref. The transition to a completed or cancelled state also ends
your claim and any step claims in that write, so the item stops reading as
held; `applied.transition.released` names the holder, and the item's
`last_claim_ref` keeps it. Reopening the item restores no claim: claim it again
to work it. A terminal state is refused while a step is open or without a
summary. It is also refused with `person_spoke` while the owner did something on
the item that no agent has been told: the refusal quotes it. Read it, write what
you did about it (a comment is enough), then close; a comment in the same call
as the close does not count. `force: true` carries a refusal through and records
it as `overridden`: use it only when the record would still be true.

**Closing a release.** Before closing the release's epic, run
`valkama released --space MAIN --repo <checkout> --range v1.0.0..v1.1.0`. It
lists the open items whose commit refs went into that range, including a change
that arrived under another hash, and it changes nothing. Check each one and close
what is finished: partly released work shows as well, a `changed-patch` or
`subject` match is weak, and an item with no commit ref cannot show.

**Not done.** Work that is not needed, duplicated or superseded closes in the
cancelled state. It needs the summary, which starts with why (`Not needed:`,
`Duplicate of MAIN-12`, `Superseded by MAIN-12`), and leaves undone steps open,
because ticking them would claim work that did not happen. For a duplicate,
prefer `merge_work_items`; otherwise link `duplicates` to the survivor and copy
anything unique there first. `delete_work_item` is only for an item that should
never have existed, and it refuses while the item has children.

## Delegating

A worker writes to its own item: it claims it, ticks its steps, attaches refs,
writes its report as the root of its own thread and replies in that thread
afterwards. The agent that delegated files the new items a worker reports
and closes them, after grouping the findings by cause, so two workers' reports
of one cause become one item. Hand one agent several items only as the
[work model](references/work-model.md#one-agent-several-items) allows.

A subagent without the Valkama tools writes nothing to Valkama. It returns, for
the delegating agent to record:

- the item reference it worked on and the steps it finished, by `item_id` or
  text;
- the commits it made and anything else worth a ref;
- each finding with its evidence (command, error text, versions), its cause,
  and where it belongs: a step of this item, a new item linked
  `discovered-from` this one, or the same change as an existing item;
- what blocked it, and any question for the owner with its options.

The delegating agent writes that report as the root of a thread on the item.

## When a call is refused

| Refusal | What to do |
| --- | --- |
| `revision_conflict` | Someone wrote since your read: read the item, then retry on the new `revision`. |
| A claim held by another | Take other work, or take it over only on an instruction (`force: true`). |
| `workflow_guard` with `[executor]` | Claim the item or a step before moving it to an active state. |
| `workflow_guard` with `[checklist]` or `[summary]` | Tick what was done, move undone work to an item of its own, record the summary, then close. |
| `workflow_guard` with `[blocker]` | Link the blocking item, or give the reason. |
| `workflow_guard` with `[person_spoke]` | The owner acted on the item: read what the refusal quotes, write what you did about it, then close. |
| `workflow_guard` with `[transition]` | The workflow has no such move; go through a state it allows. |
| An unknown state | The refusal lists the workflow's states and the categories that name one. |
| A refused batch or creation step | The message starts with the group and index; correct that entry. |

Exact argument shapes, acknowledgements and limits are in
[the tool reference](references/tools.md).
