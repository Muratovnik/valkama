---
status: draft
card: 1267
---

# ADR 0013: Items that are one change merge into the one that survives

## Context

A finding filed twice, or one cause found from two places, leaves two items for
one change. The only way to say so was by hand: link one `duplicates` the other,
summarise it and close it as cancelled. That closed the extra item with
everything it held — the steps someone had ticked or claimed, the discussion,
the commits, and the `blocks` links that made other work wait — so the work
that continued in the survivor started without them, and the items the extra
one blocked stopped waiting on anything open.

## Decision

1. **One operation, all or nothing.** `merge_work_items` takes the survivor and
   up to 20 items. Everything a caller can correct is refused before the first
   write, naming the item: the survivor among the items, an item named twice,
   another planning space, a closed survivor or merged item, a merged item
   with children, more than the checklist limit of steps in all, a workflow with
   no reachable cancelled state, and an item another session holds. The writes
   run inside one savepoint, so a refusal later undoes all of them.
2. **What was the work moves; what describes the item stays.** The survivor
   takes the steps (ids, ticks and step claims kept), the discussion comments,
   the refs it does not already have, and the links, each in its own direction.
   The merged item keeps its history, its reports — its selected summary must
   be one of its own reports — its description, labels, parent and requests.
   A link to the survivor or to another merged item is not moved: it would tie
   the survivor to itself.
3. **A merged item closes as a duplicate.** It is linked `duplicates` to the
   survivor, given a summary naming it, released, and moved to the first
   `cancelled` state it can reach, as a person would close it.
4. **Another session's claim needs `force`**, on the survivor (its work
   changes) or on a merged item (its work ends). A stale lease does not stand
   in the way. A forced claim is recorded as an `overridden` event.
5. **Only existing writes.** Each step is the write a single tool makes, with
   that tool's event. Moving comments and refs re-points their rows, which no
   event records; the survivor's comment and the merged item's summary say
   what moved.

## Consequences

- No schema change and no new event action. A build from before this reads a
  merge as links, replaced checklists, a release, a summary, a transition and
  a comment, and its web, which refuses event actions it does not know, renders
  both items.
- The survivor's readiness can change: a `blocks` link that arrives makes it
  block that work, and one into it can make it wait.
- Children are not moved. Reparenting is a decision about the hierarchy, not a
  consequence of a duplicate, so a merged item with children is refused until
  they have another parent.
- Rejected: copying instead of moving (two items holding one step id, and a
  survivor whose history does not show what it took); moving the reports too
  (a merged item's summary would point at a comment it no longer has); a new
  `merged` event action (every earlier web would refuse the item's history);
  and taking over the survivor's claim (the caller merging is not necessarily
  the one doing the work).
