# The work model

How work is cut into items and handed to agents. Read it before filing several
items, splitting or grouping work, or delegating items to other agents. The
sources at the end are the ones each rule draws on.

## An item is one change

An item is a change that can be integrated and reverted on its own — usually
one branch or one pull request — and is small enough to finish in hours to a
couple of days. It closes on a "done when" a test can check, run by a verify
command written in the item, so whoever closes it can show the result rather
than assert it. Work that cannot finish within a few days is more than one
change: split it into items that each integrate on their own, under a goal
or stage when they share one [DORA, Devin].

## A finding is evidence, not an item

A finding — a failing check, a review remark, a defect seen in passing — is
evidence. It goes on the item it bears on: as a step, a comment or a ref.

Findings that share a cause, a fix or one mechanical rule are one item, kept as
its steps or its links. When the same change was filed twice, merge the extras
into one survivor with `merge_work_items`, or close them as duplicates of it.

Never group work by area or by a set of files alone. "Everything in the parser"
or "all the UI bugs" is a list that has no single "done": it cannot be
integrated, reverted or closed as one change. Group by what can be finished
independently [Shape Up].

## The brief lives in the item

What an agent needs to do the work is on the item: the description (goal,
context, constraints), the checklist, the "done when" and its verify command.
A plan kept in the repository is fine; the item points at it with `source`
instead of copying it. Do not keep a second tracker beside Valkama — a folder
of task or packet files that says what the items already say drifts from them
[Codex, ExecPlans, Devin].

## One agent, several items

Give one agent several items only when:

- they are really one change — then merge them first and give it one item;
- they are a mechanical sweep under one rule, where fixing the first teaches
  how to fix the rest [GitHub];
- they are sequential edits of the same files that need one context, where
  two agents would overwrite each other [Claude Code teams].

Never give one session unrelated items: the context of the first weighs on
every later one and the results get worse [Claude Code, Codex].

## Who writes what

Workers write to their own item: the claim, the ticks, the refs and the
comments. The delegating agent files the new items a worker reports and closes
them, after triaging findings by cause, so that two reports of one cause become
one item and not two [Claude Code teams].

## Flow

Take work from the queue (`claim_ready_work_item`, or the list row whose
`queue_order` is 1) rather than by preference. Keep the work in
progress within what can be verified and merged: a change counts once it is
integrated, and every further open item adds coordination and delays the
feedback on the others [DORA, Claude Code teams].

## Goals and stages

A goal or stage is done when nothing under it is open, at any depth; completing
it before then is refused (`children`). When the last open item under it closes,
moves out or is deleted, it awaits confirmation: the write that did it answers
with `awaiting_confirmation`, the top-level session of the agent that wrote it
follows the goal or stage, and Valkama records the wait there, which wakes the
sessions working on it.

Confirming is completing it. Read its `confirmation` part: what was cancelled and
what moved out under it, each with its reason, and how many steps it has. Check
its steps, or its description when it has none, against what was done, tick
them, write the summary and complete it. When something is missing, file a task
under it instead: the goal or stage goes back to work.

When no live session works on it, or none has confirmed it a day after its wait
began, Valkama asks the owner, once in that wait. Only the owner answers:
`confirm` completes it with its steps ticked, `leave` leaves it to the next
session that takes work in the space, which hears it as words left for it. A
session that confirms it meanwhile ends the question.

Work that does not belong to its goal or stage leaves it with the reason
(`move_out`): it goes to the top level and to triage, keeps that it started,
and loses its claims and its basis; the goal or stage records the reason, and a
confirmer reads it. A goal or stage moved out takes its work along and becomes
a goal. An edit does not clear a parent (`[parent]`), so the reason is never
skipped. Moving an item under another goal or stage is an edit of `parent`, and
the one it left records `moved under` it. Accepted work does not move under a
goal or stage that is not accepted (`[parent]`): accept that one first, or move
the item out. Work in triage moved under goals and stages all accepted is
accepted with them, as if filed there.

A task that turns out to be several is converted into a goal or stage
(`convert`, `to: stage` under a parent, `to: goal` without one), and an
edit of its kind or a child filed under it is refused naming that word. It
keeps its number, text, discussion, history, links, questions, subscribers,
refs and steps with their ticks; a bug or improvement keeps its kind as a
label. A goal or stage is held by nobody, so a held task leaves its work at
hand in a new task under it: the same holder, every claimed step with its
claim, the steps `leftover.steps` names, started as it was and with its
projects, and each holder's top-level session follows the new goal or stage.
A goal or stage with nothing under it becomes a task again with `to: task`.
An agent does not convert an item while a question to the owner on it is open.

A task of which only a part is to go elsewhere, later or to another holder,
splits that part off: `create_work_item` with `split_from` and the `steps` it
takes. The part stands beside the task under the same parent, accepted as the
task is, and its steps keep their ids and ticks. When the task enters review or
completes, its answer names where its steps went and which were taken off or
reworded (`conditions_changed`), so the close says what it stands for.

Work that is to wait is put off with `defer`, never by a move into a deferred
state: `until` names the day (`2026-12-01`, from 00:00 UTC), a time with its zone,
or the open item whose close it waits on, and `reason` says why, which the owner
reads when it comes back. It loses its claims and its basis, and the queue gives
none of it, nor of the work under a goal or stage put off; whoever holds work under
one keeps it and hears that it was put off and that it came back. When the day
comes, or that item completes, is cancelled or deleted, the work comes back to
triage by itself (the record's `returned` says why); an item merged away passes the
wait to the one it merged into. Under goals and stages all accepted it stays put
off and the owner is asked instead: do it, later or drop it. Until the owner
answers, you can neither claim it nor move it anywhere but cancelled
(`acceptance_question`): wait for the answer. A claim, or any move out of
deferred, ends the wait, and so does merging it into work that is not put off.

## Sources

Read on 2026-11-01.

- [DORA] DORA, "Capabilities: Working in small batches",
  <https://dora.dev/capabilities/working-in-small-batches/> — batches completed
  "in small increments of time, meaning hours to a couple days", as
  independent as possible, and "any batch of code that takes longer than a
  week to complete and check is too big".
- [Shape Up] Ryan Singer, *Shape Up*, chapter 12 "Map the Scopes",
  <https://basecamp.com/shapeup/3.3-chapter-12> — scopes are "integrated
  slices" that can be finished independently, organised by the structure of
  the project; "grab bags" such as "bugs" never get to be done.
- [GitHub] GitHub Docs, "About security campaigns",
  <https://docs.github.com/en/code-security/securing-your-organization/fixing-security-alerts-at-scale/about-security-campaigns>
  — a campaign groups closely related alerts so that developers build on what
  they learned fixing one to fix several more.
- [Claude Code] Claude Code docs, "Best practices for Claude Code",
  <https://code.claude.com/docs/en/best-practices> — `/clear` between unrelated
  tasks; a session that collected unrelated tasks keeps re-reading them.
- [Claude Code teams] Claude Code docs, "Orchestrate teams of Claude Code
  sessions", <https://code.claude.com/docs/en/agent-teams> — same-file edits
  and sequential work suit a single session; tasks are self-contained units
  with a clear deliverable; each teammate owns a different set of files; the
  lead creates tasks and teammates claim and complete them.
- [ExecPlans] OpenAI Cookbook, "Using PLANS.md for multi-hour problem solving",
  <https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md>
  — a plan is a self-contained living document from which the work can
  restart, with acceptance phrased as observable behaviour and exact test
  commands.
- [Codex] OpenAI, Codex "Best practices",
  <https://learn.chatgpt.com/guides/best-practices> — a prompt names the goal,
  context, constraints and "done when"; one chat per coherent unit of work.
- [Devin] Devin docs, "When to Use Devin",
  <https://docs.devin.ai/essential-guidelines/when-to-use-devin> — tasks with
  a clear start and end and explicit success criteria; break work longer than
  about three hours into smaller sessions.
