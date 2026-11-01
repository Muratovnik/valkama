/**
 * What each item on the board waits on: the reference of an open item that
 * blocks it.
 *
 * The board's edges carry no state, so the other end's is read from the
 * space's items, which hold every item the edges start from. A finished or
 * cancelled blocker blocks nothing and is never named; the tile used to say
 * «заблокировано» without saying by what, and a reader had to open the card to
 * find out whether the blocker was even still open. Of several open blockers
 * the first linked is named, so a tile names the same one on every read.
 */
import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

export function waitingOn(
  links: readonly PlanningEdge[],
  spaceItems: readonly WorkItemBrief[],
): Map<string, string> {
  const open = new Map(
    spaceItems
      .filter((item) => !item.state.is_terminal)
      .map((item) => [item.work_item_id, item.reference]),
  )
  const waiting = new Map<string, string>()
  for (const link of links) {
    if (link.kind !== 'blocks' || waiting.has(link.to)) continue
    const blocker = open.get(link.from)
    if (blocker !== undefined) waiting.set(link.to, blocker)
  }
  return waiting
}
