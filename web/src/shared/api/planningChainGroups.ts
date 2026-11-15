/**
 * Which group of a chain an item reads in: the one question the card's member
 * list, its summary line and the graph's marker legend all answer, so the three
 * cannot disagree about where a piece of work stands.
 *
 * Open work is grouped by its workflow category, in the order work moves
 * through it, and closed work is one group whatever state closed it. An accepted
 * open goal or stage stands in no category: it derives its state from the work
 * under it, and that work is counted where it stands, so the goals and stages are
 * one group of their own rather than a category they are not in. Being workable
 * is not a group: the space calls every unheld, unblocked untriaged item workable,
 * so grouping by it would empty triage into "ready" and hide how much of the chain
 * is merely planned. It rides on a row as a mark instead.
 */

import type { NamedState } from '@/shared/lib/stateNames.ts'

export const CHAIN_GROUPS = [
  'active',
  'review',
  'ready',
  'triage',
  'deferred',
  'blocked',
  'containers',
  'done',
] as const
export type ChainGroup = (typeof CHAIN_GROUPS)[number]

/**
 * Where along a chain each group stands, as the card's map runs a lane and
 * every key to a chain reads: finished, then under way — review nearest
 * finished — then blocked and what is ahead.
 */
export const CHAIN_PROGRESS_ORDER: readonly ChainGroup[] = [
  'done',
  'review',
  'active',
  'blocked',
  'containers',
  'ready',
  'triage',
  'deferred',
]

/** The open groups, in the order the card lists them. */
const OPEN_CHAIN_GROUPS = CHAIN_GROUPS.filter(
  (group): group is Exclude<ChainGroup, 'done'> => group !== 'done',
)

const OPEN = new Set<string>(OPEN_CHAIN_GROUPS)

interface Classifiable {
  open: boolean
  state: { category: string } | null
}

/**
 * The group an item reads in. A category this build does not know names no group, and
 * reading it as one it does know would misplace the item silently, so it is refused.
 */
export function chainGroup(item: Classifiable): ChainGroup {
  if (!item.open) return 'done'
  if (item.state === null) return 'containers'
  const category = item.state.category
  if (category === 'completed' || category === 'cancelled') return 'done'
  if (OPEN.has(category)) return category as ChainGroup
  throw new Error(`unknown state category: ${category}`)
}

interface Named {
  state: NamedState | null
}

/**
 * The space's own name for each group, when every member in it is in one state:
 * a workflow that calls its active state "Development" should read that wherever
 * a chain is drawn, as the board's column reads it, in the words `stateName` gives it. Null
 * for a group that spans several states, or holds none, which keeps the group's own word.
 */
export function groupStateNames(
  groups: Readonly<Record<ChainGroup, readonly Named[]>>,
  stateName: (state: NamedState) => string,
): Record<ChainGroup, string | null> {
  return Object.fromEntries(
    CHAIN_GROUPS.map((group) => {
      const [first, ...rest] = groups[group]
      const named = first?.state
      const one = named && rest.every((member) => member.state?.name === named.name)
      return [group, one ? stateName(named) : null]
    }),
  ) as Record<ChainGroup, string | null>
}
