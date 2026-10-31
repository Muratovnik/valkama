---
status: draft
card: 1214
---

# ADR 0012: A claim starts the work it takes, and its session holds it

## Context

ADR 0010 made a claim a lease: it names the session that holds the item. It
left the item's state to the agent, which was expected to claim and then
transition. Agents did the first and skipped the second. In one coordinating
session eleven items were worked while they sat in Backlog, so the board said
nobody had begun work that was half done, and the take-next queue, which offers
unheld work in `backlog` and `queued` states, had nothing wrong to show.

The guessing went further. A transition to `in_progress` was refused with
"this workflow has no state named in_progress" and nothing to correct from: the
default workflow keys its active state `dev`, and the agent had not read it.

Executions already did the right thing for a launch: claim, then move a
`backlog` or `queued` item to the first `active` state. That rule lived in
`executions/lifecycle.py` and nowhere else.

## Decision

1. **Claiming starts unstarted work.** Every claim — `claim_work_item`,
   `claim_ready_work_item`, the `claim` of `create_work_item` and of
   `apply_work_item_changes`, the HTTP writes, the browser and a launch — moves
   an item in a `backlog` or `queued` state to the first `active` state in
   workflow order that a transition of the workflow reaches from where it
   stands. The move is an ordinary guarded transition with its own event, and
   the answer says where the item came from and went (`started`). An item that
   has nowhere to go stays, with a warning. Review, blocked, active and
   finished items keep their state: review and blocked say something a claim
   does not undo, and reopening finished work is a decision of its own.

2. **Releasing work under way requeues it.** Because every claim now starts
   its item, a release that left the state alone would strand the item in an
   active state with nobody holding it: not `ready`, so the take-next queue
   never offers it again, and not held, so the list of abandoned claims does
   not show it either. The suite's own contract for that re-offer
   (`test_the_take_next_queue_releases_expired_leases_first`) failed on the
   first version of decision 1. So a release — by the holder, by `force`, or by
   a lease expiring — moves an item in an active state to the first reachable
   `queued` state, or the backlog when there is none, and the answer says so
   (`requeued`). An item whose checklist still has a claimed step stays active:
   that step's holder is still its executor.

3. **A state may be named by its category** when exactly one state of the
   workflow has it, and a key wins over a category. A name the workflow does
   not have is refused listing every state and the categories that name one,
   so a caller can correct itself in one call.

4. **The holder is the confirmed session; `author` is a label, and the
   fallback.** On one day only 10 of 124 open claims carried a session in
   `claim_ref`; the rest said `claude`, `claude-code`, `agent` or a name of the
   agent's own, so two sessions read as one holder and one session as several.
   A claim already pointed at the call that took it, and through it at the
   session, so who may release it was decided by session; what every reader
   saw was still the free text. Now a call whose client proved its session
   writes that session as the holder — `codex (session <id>)`,
   `claude agent <id> (session <id>)` — into `claim_ref` and a step's
   `claimed_by` and `done_by`. `author` stays what each event, comment and ref
   records about the call, and stays the holder of a call nobody confirmed, so
   a claim made the old way behaves the old way.

## Consequences

- No store or schema change, and no new event action: a move is a
  `transitioned` event, which every build that opens the store already reads.
  A build from before this decision reads a started or requeued item as it
  reads any item moved by hand.
- An existing agent that claims and then transitions to the active state now
  makes a transition within one state; it is accepted and logs one more event.
- A launch that cannot reach an active state proceeds with the item where it
  was and a warning, where it used to fail on the transition guard. The launch
  compensation puts back the state it found and asks its claim writes not to
  move it again (`move_state=False`).
- The owner releasing a Dev item in the browser moves it to Todo.
- The holder label is written where the name was, as text of the spelling the
  web already split into a name and a session. An earlier build reads it as a
  name; nothing changes meaning, so the store schema does not move. The label
  is written once, by the call its lease points at, so it cannot drift from
  the lease. Claims taken before keep their text until they are claimed again.
- Rejected for the holder: a second, derived `holder` field computed from the
  lease at read time (a second answer to "who holds it" beside `claim_ref`, a
  new field in every strict reader of every payload that carries one, and no
  answer for checklist steps, which have no lease to derive from); and
  ignoring `author` altogether (a call with no confirmed session would hold as
  nobody, and every claim made before identity would change owner).
- Rejected: leaving release alone and documenting the stranded item (it would
  be in no list anyone reads); widening the take-next queue to unheld active
  items (`ready` is the one rule every record, view and chain count uses, and a
  queue that disagreed with it would re-create the drift the Board era had,
  while an item worked through claimed steps would need excluding by a scan of
  its checklist); refusing a claim on a blocked or review item (taking it over
  is legitimate, moving it is not); and aliases such as `in_progress` (a
  guessed vocabulary the workflow does not have is answered with the one it
  does).
