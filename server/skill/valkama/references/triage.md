# Triage review

A triage review decides what waits in triage in one space: findings filed
outside accepted goals, goals nobody has accepted, and tasks waiting inside
accepted goals. The owner starts one, when a line among their questions says it
is time or at any moment. Run it as an item of its own, `Triage review: <space>`,
filed with `acceptance: "assignment"`: the owner asking for the review is that
word. It is done when `triage_stack: "unseen"` lists nothing in the space; give
its counts in the closing summary.

## What waits

`list_work_items` with `space` and `triage_stack: "unseen"` lists what waits and
no review has marked, oldest first; `"seen"` lists what an earlier review left
as it was. A list row does not show the mark itself: `get_work_item`, or the
list with `verbose`, says when a review marked the item and who. An item stops
waiting when it is accepted, deferred, cancelled, merged, moved under a goal
nobody has accepted yet, or given a question for the owner, until the answer. A
mark is cleared by a new comment, a merge into the item, a question for the
owner, a move, or a change of state; an item that still waits is listed unseen
again.

## Steps

1. An item back with its doubtful-repeat decision answered: merge it or keep it
   as the answer says.
2. Give each item a topic label and a priority.
3. Findings that share a cause or a fix are one change, not a group. Merge
   obvious repeats, the same defect in the same place: the same screen, command
   or code path. The same steps failing in another environment (another OS,
   device or browser) are the same place, so they are an obvious repeat. Copy
   the evidence the survivor lacks as comments in one `apply_work_item_changes`
   call, then `merge_work_items` with up to 20 items. The merge clears the
   survivor's mark: if the review leaves the survivor as it is, mark it
   `triage_seen` in a later call.
4. A repeat you are not sure of, such as the same symptom in another place or
   two defects one fix would end, is a `decision` on the newer item, the later
   by `created_at`, then by number. Its choice field, `answer`, offers `merge`
   into the older one and `keep`, with your recommendation. Mark the older item
   as step 7 says when the review leaves it; the newer one, its question open,
   joins no group until the question comes back. When it comes back answered,
   act on the answer as step 1 says.
5. Group by topic: a topic is an outcome one goal finishes, not an area or a
   component, as "Never group work by area" in [the work model](work-model.md)
   says. A group is 2 to 20 tasks without a parent that one goal would finish;
   a finding of priority high or urgent that none shares a topic with is a
   group of one. A finding of another kind, such as an improvement, joins a
   group only when the goal's outcome needs it; otherwise mark it as step 7
   says. File the goal with `create_work_item`: `kind: "goal"`, a title
   and a description of what the group achieves, its conditions as `checklist`,
   and `group` with `items`, your `answer` and `why`. Answer `do`, `later` with
   `until`, or `drop` for work that is no longer needed. The tasks move under
   the goal at once; the answer is carried out, or waits for the owner as one
   question, as `waits_for_owner` says.
6. A goal waiting in triage: accept it with a transition to ready, put it off
   with `defer`, cancel it when no work is left under it, or leave it. A task
   waiting inside an accepted goal: accept it with a transition to ready when
   the goal's conditions need it, otherwise take it out with `move_out`. The
   answer says when a step waits for the owner.
7. Mark every item you leave as it is with `triage_seen: true`, a comment on
   why in the same call when it helps the next review. Accept or cancel a
   single finding only as part of a group.
8. Close the review item when `triage_stack: "unseen"` lists nothing, even
   while answers wait: the questions of groups and decisions stay on their own
   items. Its summary gives merged, groups and their answers, decisions asked,
   marked.

## What the owner's answer does

`do` accepts the goal and every task left ticked. `later` puts the goal off with
the tasks under it until the date or the item. `drop` cancels the ticked tasks
and the goal; when accepted work stands under the goal, the owner confirms its
cancel list first. A task the owner unticks leaves the goal for triage and waits
for the next review; it is not cancelled. A `do` or `later` that finds none of
its ticked tasks still under the goal changes nothing, and the goal waits in
triage for the next review.

Expiring the question, which only your session can do, withdraws the group: the
tasks still in triage leave the goal for triage, unmarked, and the goal is
cancelled, unless work a person accepted stands under it: then it stays in
triage with that work for the next review. A person who accepts, puts off or
cancels the goal before answering decides the group that way, and the question
ends.
