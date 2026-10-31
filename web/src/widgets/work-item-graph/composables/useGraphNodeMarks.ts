/**
 * What the field writes on each node beyond the item itself: its origin chip,
 * whether it is the chain's root, whether it sinks into the ground, and its
 * place in the chain — and the legend that names the places drawn.
 *
 * Every answer here depends on whether the field is one chain, which is why
 * they live together rather than as five separate questions in the view.
 */

import { computed } from 'vue'
import type { Ref } from 'vue'

import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type {
  GraphLayout,
  GraphScope,
  neighborhood,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'

import { CHAIN_GROUPS, chainGroup } from '@/shared/api/planningChainGroups.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

interface MarkInput {
  focusSet: Ref<ReturnType<typeof neighborhood> | null>
  placed: Ref<GraphLayout | null>
  /** The chain's root in chain scope; otherwise whatever epic the scope names. */
  epicId: () => string | null
  items: () => readonly WorkItemBrief[]
  scopeKind: () => GraphScope['kind']
}

export function useGraphNodeMarks(input: MarkInput) {
  const inChain = computed(() => input.scopeKind() === 'chain')
  // Containers are named by reference on their children.
  const referenceById = computed(
    () => new Map(input.items().map((item) => [item.work_item_id, item.reference])),
  )

  /** The chain's root, which the field marks; a chain is the only field that has one. */
  function isChainRoot(node: PlacedNode): boolean {
    return inChain.value && node.work_item_id === input.epicId()
  }

  /** The parent's reference; none for a root, nor for the chain's root, which the chip names. */
  function parentReference(node: PlacedNode): string | undefined {
    if (node.parent_id === null) return undefined
    if (inChain.value && node.parent_id === input.epicId()) return undefined
    return referenceById.value.get(node.parent_id)
  }

  /**
   * Outside the focused lineage, which is a fact about the field — or, in a
   * chain, finished: the chain draws its closed work as the ground the open work
   * stands on. Its root is the exception, closed or not: it is what the rest grew
   * from.
   */
  function isRecessed(node: PlacedNode): boolean {
    if (inChain.value && node.state.is_terminal && !isChainRoot(node)) return true
    const focused = input.focusSet.value
    return focused !== null && !focused.ids.has(node.work_item_id)
  }

  /** The node's place in the chain, marked only when the field is one. */
  function nodeChainGroup(node: PlacedNode) {
    return inChain.value ? chainGroup(node) : undefined
  }

  /** The chain groups the field draws, which is what its legend names. */
  const chainLegend = computed(() => {
    if (!inChain.value || !input.placed.value) return []
    const present = new Set(input.placed.value.nodes.map((node) => chainGroup(node)))
    return CHAIN_GROUPS.filter((group) => present.has(group))
  })

  return {
    chainLegend,
    inChain,
    isChainRoot,
    isRecessed,
    nodeChainGroup,
    parentReference,
    referenceById,
  }
}
