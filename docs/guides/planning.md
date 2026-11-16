# Kanban planning

Planning holds the work: a space, its workflow, its work items and the links
between them. Agents work it through Valkama's MCP tools, which create, move,
claim, comment, link, and summarise work. You see the same items as a Kanban
board, a list or a graph over one Planning read model. Planning MCP tools use
spaces and work items; a Kanban card is one view of a work item.

The exact shapes of every call are in
[the connection contract](../connection-contract.md). Launching an agent from a
card is in [Launching agents from a card](launching-agents.md).

## Columns and epics

One column per state of the space's workflow. A new space gets seven: Backlog,
Todo, Dev, Review, Done, Blocked and Cancelled. Done is for finished work;
Cancelled is for work closed as not needed, duplicated or superseded, and needs
a closing summary that says why but no ticked checklist.

A card becomes an **epic** when other cards point `parent_id` at it. The board
keeps a persistent index of epics and renders one selected view;
inside each lane, children are grouped under their epic instead of repeating the
epic id on every card.

**The board reads by epic.** Grouped by epic, each epic is a lane with its
reference, title, open and closed counts and a fold; a lane with nothing open
starts folded, and the board remembers the lanes you fold or unfold, per space,
in the browser. Work under no epic comes last. A lane's Chain action narrows the
board to that epic's chain, and the chain stays when you switch to List or
Graph; its chip leaves it in every view.

## What keeps a card honest

Three things make a card honest about its own progress:

- **A checklist with stable ids.** Agents claim a step with
  `claim_work_item_checklist_item` and complete it by id in the
  `checklist_ticks` of `apply_work_item_changes`. No invented percentages, and
  two agents splitting a work item each hold their own step.
  A comment accepts an optional `checklist_item_id`: the saved comment
  keeps a quote of that step even after it is renamed or removed.
- **Typed refs** — commit hashes, memory entry ids, urls — attached in the
  `refs` of `apply_work_item_changes`, so the next agent reads pointers instead of doing
  archaeology. An agent's own session needs no ref: Valkama records the
  confirmed session behind every write, and `get_work_item` lists those
  sessions.
- **An activity trace.** Creations, moves, claims, takeovers, releases,
  completions and link changes are all recorded with an author. `get_work_item`
  returns the newest of it, and all of it with `full: true`, so nobody has to
  guess who did what. Reordering within a lane is deliberately *not* history.

## Several changes in one call

An agent that finishes a step usually makes several writes to one card: tick it,
attach the commit, comment, record the summary, move the card.
`apply_work_item_changes` is the one tool for those writes and does them in one
call, in a fixed order and all or nothing, so a closing move sees the ticks and
the summary sent with it. The
exact shapes are in
[the connection contract](../connection-contract.md#several-changes-in-one-call).

Two items filed for one change — the same finding twice, or one cause found in
two places — are folded together with `merge_work_items`. The surviving item
takes their steps, discussion, refs and links, and each merged item closes as
its duplicate with its own history intact
([details](../connection-contract.md#merging-items-that-are-one-change)).

## Claims are leases

`claim_work_item` refuses a competing claim on the current Planning wire. A
claim is a lease held by the agent session that took it, so it lapses once that
session is gone, 12 hours after an ordinary end so that a resumed session keeps
its work.

A claim also says whether anyone is still behind it. When the client proves its
session, the claim is a lease on that session: `live` while the session is
active and has shown a sign of life — a hook event or a Valkama write — in the
last 14 days, `stale` once it ended or went quiet, and `unconfirmed` when no
session was proved, which is also how every older claim and every claim made in
the browser reads. Another session needs `force` to take a live claim, even when
it signs with the same author. A stale claim is released by whoever meets it
next, and taking it over needs no `force`; the history shows the expiry as a
`released` event by `valkama`. A checklist step's claim lapses with its session
the same way. The board marks stale claims, and the inspector shows the lease
and when it expires. The exact rules are in
[the connection contract](../connection-contract.md#claims-are-leases).

## Discussion and outcomes

The inspector keeps editable descriptions and a shared discussion. A comment can
target a checklist step, and a reply stands under the comment, report or question
it answers, one level deep. A thread can be marked resolved with a one-line
decision, by a person in the card or by an agent in the `resolutions` of
`apply_work_item_changes`, and `get_work_item` with `unresolved: true` reads the
threads still open
([details](../connection-contract.md#threads-and-the-resolved-mark)). Work
reports show in the discussion with “What was done / Why / What comes next”: an
agent's closing summary is one, and in the card any of them can be selected as
the task outcome. Closing a task
that has no outcome asks a person for one: what was done and what comes next. System
and execution history have filters, date groups and expandable details. Their
search covers the records loaded for that task.

## Questions and decisions

Questions and decisions live in the task's discussion and a shared inbox. Agents
create typed requests; the owner answers, in their own words if they prefer, or
declines the exact request, and can change an answer while the task is open.
Expired requests stop accepting answers, and sending an answer does not
automatically resume an execution.

Use `create_work_item_request` for a question or decision that needs an explicit
answer. Each request has 1–12 named fields: text, one choice, multiple choices or
a boolean. Optional execution and session bindings must belong to the task.
`get_work_item_request` and `list_work_item_requests` expose the current status;
`answer_work_item_request` and `expire_work_item_request` require that
request's `expected_revision`; a person declines a request in the card. A terminal
task, ended execution or elapsed deadline closes the pending request. An option
can explain itself in a `description` and be `recommended`. A field with options
is answered with an option or the person's own variant, and may carry a comment;
a note comments on the whole question and does not answer a required field. While
the task is open, a given answer can be changed, in the card or with
`answer_work_item_request` and `change: true`, and the answers it replaced are
kept ([details](../connection-contract.md#questions-and-decisions)). Answers are
stored separately from comments and do not change the task's workflow.

## Links between work items

Work items relate to each other the way
[beads](https://github.com/steveyegge/beads) proved useful for agents. A
`blocks` link keeps unfinished dependencies out of `claim_ready_work_item`,
which chooses and claims a ready item in one step. `discovered-from` records
where work found en route came from, and `create_work_item` takes that link and
the claim in the call that files the item. Blockers that are not work items stay
comments.

## Guards and concurrent moves

Guards refuse a move the board could not honestly report: `dev` needs an
executor, `done` needs every checklist item closed and a summary, `blocked`
needs a linked blocker or a stated reason. A refusal names its guard, and
`force=true` carries the move through as a recorded override.

**Concurrent moves are resolved, not raced.** A drag or a keyboard move sends
the revision of the card as the board last read it. If an agent has moved or
edited the card since, the server answers `409` with the revision it is at, the
board says so, and the card stays where the next read of the space puts it
rather than silently undoing the agent's work.

## The order of work

**The board's order is the order work is taken in.** Dragging a card up or down
its column, or pressing Alt+↑ or Alt+↓ on a focused card, places it among the
cards of its state; the move is announced to a screen reader. Dropping it in
another column moves it there at the place it was dropped. Agents see the same
order: `claim_ready_work_item` takes the first ready item of it,
`list_work_items` lists each state in it, and the `update` and `transition`
of `apply_work_item_changes` take a `rank` (`first`, `last`, `before:<item>` or
`after:<item>`) to place an item themselves. Priority only breaks a tie. The
order is the item's `position`, which every store already holds, so it needs
no new schema; the exact rules are in
[the connection contract](../connection-contract.md#the-order-of-work).

What an upgrade does to an existing store, and how to go back, is in
[Upgrading the store and going back](store-upgrades.md).
