/**
 * The chain production-graph-discovery.spec.ts serves: a discovery from the root and a block
 * between two of the small chain's members.
 */
import { workItem } from '../planningFixtures.ts'
import type { Served } from '../servedContracts.ts'
import { servedChain, smallChain } from './chains.ts'

/**
 * The suite's item as a chain's root, MAIN-1103 discovered from it and MAIN-1103
 * blocking MAIN-1105: the two members of the small chain that already block.
 */
export function discoveryChain() {
  const small = smallChain()
  const kept = new Set(['MAIN-1103', 'MAIN-1105'])
  const items = small.items.filter((item) => kept.has(item.reference))
  const [found, blocked] = items
  const edges = [
    { from: found.work_item_id, to: workItem.work_item_id, kind: 'discovered-from' as const },
    { from: found.work_item_id, to: blocked.work_item_id, kind: 'blocks' as const },
  ]
  const chain = {
    ...small.chain,
    root: { ...small.chain.root, totals: { chain: items.length, tree: 0 } },
    total: items.length,
    closed: 0,
    open: items.length,
    workable: items.filter((item) => item.workable).length,
    origins: [],
    series: [{ day: '2026-10-20', created: 2, closed: 0, total: 2, closed_total: 0 }],
    members: small.chain.members.filter((member) => kept.has(member.reference)),
    edges,
  }
  return { chain, items, edges }
}

const discovery = discoveryChain()

export const served: Served[] = [
  ...servedChain(
    'served/graphDiscovery.ts discoveryChain()',
    discovery.chain,
    discovery.items,
    discovery.edges,
  ),
]
