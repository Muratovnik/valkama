/**
 * Which group of a chain an item reads in: the one question the card's member
 * list, its summary line and the graph's marker legend all answer, so the three
 * cannot disagree about where a piece of work stands.
 *
 * Open work is grouped by its workflow category, in the order work moves
 * through it, and closed work is one group whatever state closed it. Readiness
 * is not a group: the space calls every unheld, unblocked backlog item workable,
 * so grouping by it would empty the backlog into "ready" and hide how much of
 * the chain is merely planned. It rides on a row as a mark instead.
 */

export const CHAIN_GROUPS = ['active', 'review', 'queued', 'backlog', 'blocked', 'done'] as const
export type ChainGroup = (typeof CHAIN_GROUPS)[number]

/** The open groups, in the order the card lists them. */
export const OPEN_CHAIN_GROUPS = CHAIN_GROUPS.filter(
  (group): group is Exclude<ChainGroup, 'done'> => group !== 'done',
)

const OPEN = new Set<string>(OPEN_CHAIN_GROUPS)

interface Classifiable {
  state: { category: string; is_terminal: boolean }
}

export function chainGroup(item: Classifiable): ChainGroup {
  const category = item.state.category
  if (item.state.is_terminal || category === 'completed' || category === 'cancelled') return 'done'
  return OPEN.has(category) ? (category as ChainGroup) : 'backlog'
}
