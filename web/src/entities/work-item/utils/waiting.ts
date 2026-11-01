/**
 * What each work item waits on: the reference of an open item that blocks it.
 *
 * The readiness facet prints «Ждёт MAIN-12» from it (`FacetContext.waitingOn`),
 * and every surface that prints the exception asks here rather than reading
 * the links itself. A surface used to count a block as open while its source
 * was among the items it held and not finished, which saw nothing of a blocker
 * in another space: the item was not workable and nothing said why.
 */
import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

/** A link as the rule reads it: its ends and kind, and the source's state when the view carries it. */
export type WaitingLink = Pick<PlanningEdge, 'from' | 'to' | 'kind'> &
  Partial<Pick<PlanningEdge, 'reference' | 'is_terminal'>>

/** An item as the rule reads it: its id, its reference and whether it has finished. */
export type WaitingItem = Pick<WorkItemBrief, 'work_item_id' | 'reference'> & {
  state: Pick<WorkItemBrief['state'], 'is_terminal'>
}

/**
 * The open blocker each blocked item waits on, by the blocked item's id; the
 * first open one in link order when several are.
 *
 * A link names its source's state — a space view's links and a chain's edges
 * alike — and that answer stands whichever space the source lives in, inside
 * the chain or not. Only a link from a server that predates it says nothing,
 * and then the source is looked up among `items`. A state the store could not
 * resolve, or a source neither says anything about, is not taken for an open
 * blocker: unknown is not open.
 */
export function waitingOn(
  links: readonly WaitingLink[],
  items: readonly WaitingItem[],
): Map<string, string> {
  const byId = new Map(items.map((item) => [item.work_item_id, item]))
  const waiting = new Map<string, string>()
  for (const link of links) {
    if (link.kind !== 'blocks' || waiting.has(link.to)) continue
    const source = byId.get(link.from)
    const open =
      link.is_terminal === undefined
        ? source !== undefined && !source.state.is_terminal
        : link.is_terminal === false
    const reference = link.reference ?? source?.reference
    if (open && reference) waiting.set(link.to, reference)
  }
  return waiting
}
