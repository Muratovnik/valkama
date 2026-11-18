# Kanban planning

Planning holds the work: a space, its workflow, its work items and the links
between them. Agents work it through Valkama's MCP tools, which create, move,
claim, comment, link, and summarise work. You see the same items as a Kanban
board, a list or a graph over one Planning read model. Planning MCP tools use
spaces and work items; a Kanban card is one view of a work item.

The exact shapes of every call are in
[the connection contract](../connection-contract.md). Launching an agent from a
card is in [Launching agents from a card](launching-agents.md).

## Columns, goals and stages

One column per state of the space's workflow. A new space gets one for each of
the eight categories: Triage, Deferred, Ready, Dev, Review, Done, Blocked and
Cancelled. Beside them the workflow keeps a service state where an accepted open
goal or stage stands; no listing shows it and no input names it. Done is for finished work;
Cancelled is for work closed as not needed, duplicated or superseded, and needs
a closing summary that says why but no ticked checklist.

A work item is a task, a bug or an improvement, which an agent takes, holds and
finishes, or a **goal** or a **stage**, which holds other work and is never claimed
itself. A goal stands under no parent; a stage stands under a goal or another stage,
at any depth, so which of the two it is follows from whether it has a parent: a goal
created with a parent is a stage, and a stage created without one is refused. Only an
open goal or stage can be a parent: filing work under a task or under closed work is
refused, and so is moving an item under itself or anything under it. An accepted open
goal or stage stands in no state of its own: it shows what it derives from the work
under it, Not started, In progress or Awaiting confirmation. The exact rules are in
[the connection contract](../connection-contract.md#the-work-model).

**The board reads by goal.** With View → Grouping → By goal, each goal is a lane
headed by its reference, title, open and closed counts and a fold, and holds all the
work under it, through its stages at any depth. A goal is its lane's heading, not a card
in it. A stage heads no lane: it is work of its goal's lane, a card there while it stands
in a column. Lanes with open work come first, and the work under no parent comes last,
in a lane of its own.
A lane with nothing open starts folded, and the board remembers the lanes you fold or
unfold, per space, in the browser. A lane's Chain action narrows the board to the
chain of the goal or stage heading it, and the chain stays when you switch to List or
Graph; its chip leaves it in every view.

## What keeps a card honest

What makes a card honest about its own progress:

- **A checklist with stable ids.** Agents claim a step with
  `claim_work_item_checklist_item` and complete it by id in the
  `checklist_ticks` of `apply_work_item_changes`. No invented percentages, and
  two agents splitting a work item each hold their own step.
  A comment accepts an optional `checklist_item_id`: the saved comment
  keeps a quote of that step even after it is renamed or removed.
- **Typed refs** — memory entry ids and urls — attached in the `refs` of
  `apply_work_item_changes`, so the next agent reads pointers instead of doing
  archaeology. An agent's own session needs no ref: Valkama records the
  confirmed session behind every write, and the `sessions` part of
  `get_work_item` lists those sessions.
- **Commits.** Valkama attaches each commit an agent's session makes to the
  task it holds; the `commits` group of `apply_work_item_changes` attaches or
  moves one by hand, as a registered project and a hash. The card lists them
  as its `commits`, and `GET /api/commit?repository=<id>&hash=<hash>` shows
  one from its project's repository. A commit is not a ref: `refs` refuses
  the kind `commit`.
- **An activity trace.** Creations, moves, claims, takeovers, releases,
  completions and link changes are all recorded with an author. The `events`
  part of `get_work_item` returns the newest of it, up to a thousand events at a
  time, with how many there are, so nobody has to guess who did what.
- **Reading by parts.** `get_work_item` answers with the item's card: its
  fields, its description, its checklist and its summary, and a table of the
  other parts it has with their sizes. An agent reads the discussion, the
  history, the lease or a section of a long description by name when the work
  needs it, so opening an item with a long discussion does not read the
  discussion ([details](../connection-contract.md#reading-one-work-item)).

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
takes their steps, discussion, refs, commits, links and projects, and each merged item
closes as its duplicate with its own history intact
([details](../connection-contract.md#merging-items-that-are-one-change)).

## Claims are leases

`claim_work_item` refuses a competing claim on the current Planning wire. A
claim is a lease held by the agent session that took it, so it lapses once that
session is gone, 12 hours after an ordinary end so that a resumed session keeps
its work.

A claim also says whether anyone is still behind it. When the client proves its
session, the claim is a lease on that session: `live` while the session is
active and has shown a sign of life — a hook event or a Valkama write — in the
lease term of the item's space, `lease_quiet_days` (3 days unless the owner
changed it), `stale` once it ended or went quiet, and `unconfirmed` when no
session was proved, which is also how every older claim and every claim made in
the browser reads. An `unconfirmed` claim lapses after that many days without an event
on the item, the owner's own included. An open question to the owner on the item
stops both counts. Another session needs `force` to take a live claim, even when
it signs with the same author. A stale claim is released by whoever meets it
next, or by the
[planning sweep](../connection-contract.md#the-planning-sweep) a running server
repeats every ten minutes, and taking it over needs no `force`; the history
shows the expiry as a `released` event by `valkama`, and the claimed steps of
that session go with it. A checklist step's claim lapses with its session the
same way. The board marks stale claims, and the inspector shows the lease
and when it expires. The exact rules are in
[the connection contract](../connection-contract.md#claims-are-leases).

## Discussion and outcomes

The inspector keeps editable descriptions and a shared discussion. A comment can
target a checklist step, and a reply stands under the comment, report or question
it answers, one level deep. A thread can be marked resolved with a one-line
decision, by a person in the card or by an agent in the `resolutions` of
`apply_work_item_changes`, and `get_work_item` with `unresolved: true` reads the
threads still open, twenty roots a page, as its `comments` part
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
the claim in the call that files the item. A blocker that is not a work item is
the stated reason of a move to `blocked`.

## Guards and concurrent moves

Guards refuse a move the board could not honestly report: `dev` needs an
executor, `review` and `done` need every checklist item closed and a summary,
`blocked` needs a stated reason. A move into `review` also needs `to_check`, what
the owner is to check, and asks it as a question that only the owner answers:
accepting completes the item, returning it sends it back to `ready`. An agent
does not complete an item, or take it out of review, while a question to the
owner is open on it ([details](../connection-contract.md#review-asks-the-owner)).
A refusal names its guard, and `force=true` carries the move through as a
recorded override; it supplies no `to_check` and does not pass an open question.

**Concurrent moves are resolved, not raced.** A drag sends the revision of the
card as the board last read it. If an agent has moved or edited the card since,
the server answers `409` with the revision it is at, the board says so, and the
card stays where the next read of the space puts it rather than silently undoing
the agent's work.

## The order of work

**The board's order is the order work is taken in.** Valkama computes it and
nobody sets it: urgent work first, then work already started, then work whose
goal or stage is under way, then by priority, then the older. Dropping a card in
another column moves it to that state, and the move is announced to a screen
reader; a drop within its own column changes nothing. Agents see the same order:
`claim_ready_work_item` takes the first workable task of one space's queue, the
space it names, else that of the goal or stage it names in `within`, else the
space whose project root holds the agent session's folder; `within`, `label` and
`project` narrow that queue without reordering it. `list_work_items` lists each
state in the same order, a row the queue would give carries its place there as
`queue_order`, and a `rank` sent to place an item is refused. The exact rules
are in [the connection contract](../connection-contract.md#the-order-of-work).

What an upgrade does to an existing store, and how to go back, is in
[Upgrading the store and going back](store-upgrades.md).
