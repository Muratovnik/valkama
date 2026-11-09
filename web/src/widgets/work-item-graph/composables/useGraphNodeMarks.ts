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
import { useI18n } from 'vue-i18n'

import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type {
  GraphLayout,
  GraphScope,
  neighborhood,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'

import {
  CHAIN_GROUPS,
  CHAIN_PROGRESS_ORDER,
  chainGroup,
  groupStateNames,
} from '@/shared/api/planningChainGroups.ts'
import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'

interface MarkInput {
  focusSet: Ref<ReturnType<typeof neighborhood> | null>
  placed: Ref<GraphLayout | null>
  /** The chain's root in chain scope; otherwise whatever epic the scope names. */
  epicId: () => string | null
  items: () => readonly WorkItemBrief[]
  /** The chain's members by id, closed ones included and the root not among them. */
  members: () => readonly string[] | undefined
  scopeKind: () => GraphScope['kind']
}

/** A frame's edge parts, in the order an edge runs, and the group whose key names each. */
const FRAME_PARTS = [
  ['done', 'done'],
  ['review', 'review'],
  ['active', 'active'],
  ['blocked', 'blocked'],
  ['ahead', 'queued'],
] as const

export function useGraphNodeMarks(input: MarkInput) {
  const { t } = useI18n()
  const stateName = useStateName()
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

  /** The chain groups the field draws, which is what its legend names, in the card's map's order. */
  const chainLegend = computed(() => {
    if (!inChain.value || !input.placed.value) return []
    const present = new Set(input.placed.value.nodes.map((node) => chainGroup(node)))
    return CHAIN_PROGRESS_ORDER.filter((group) => present.has(group))
  })

  /**
   * What the key calls each group, by the rule the card's chain section uses:
   * the one state its members share, else the group's own word. Read off the
   * chain's members, as the card counts them: the root set aside, and closed work
   * kept, so the closed switch never renames a word of the key.
   */
  const chainLegendNames = computed(() => {
    const groups = Object.fromEntries(
      CHAIN_GROUPS.map((group) => [group, [] as WorkItemBrief[]]),
    ) as Record<ChainGroup, WorkItemBrief[]>
    if (inChain.value) {
      const members = new Set(input.members())
      for (const item of input.items())
        if (members.has(item.work_item_id)) groups[chainGroup(item)].push(item)
    }
    return groupStateNames(groups, stateName)
  })

  /**
   * What the key names: in a chain, its groups as the cards are marked; over the
   * whole space, the parts the frames' edges draw — «ahead» is queued and backlog
   * together, as an edge draws them.
   */
  const legend = computed(() => {
    if (inChain.value) return { groups: chainLegend.value, names: chainLegendNames.value }
    const frames = input.placed.value?.frames ?? []
    const groups = FRAME_PARTS.filter(([part]) => frames.some((frame) => frame.progress[part])).map(
      ([, group]) => group,
    )
    return { groups, names: { ...chainLegendNames.value, queued: t('graph.legendAhead') } }
  })

  return {
    inChain,
    isChainRoot,
    isRecessed,
    legend,
    nodeChainGroup,
    parentReference,
    referenceById,
  }
}
