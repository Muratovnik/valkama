import { computed, inject, provide, ref, watch } from 'vue'
import type { ComputedRef, InjectionKey } from 'vue'

import { useWorkItemResource } from '@/widgets/work-item-inspector/utils/useWorkItemResource.ts'
import { useWorkItemUsage } from '@/widgets/work-item-inspector/utils/useWorkItemUsage.ts'

import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

export interface InspectorUsage {
  /** The item is a goal or a stage, whose numbers take in the work under it. */
  isContainer: ComputedRef<boolean>
  /** The read of the card's own numbers. */
  read: ReturnType<typeof useWorkItemUsage>
  /** The read whose runs the tab's rows and its count name: a container's own, else the card's. */
  rows: ComputedRef<ItemUsage | null>
  /** A container's own runs, read for its rows; no target, so no read, on any other item. */
  runs: ReturnType<typeof useWorkItemUsage>
  /** What reads again with the item's numbers. */
  news: () => unknown
  /** The read reaches this item: it is in the primary store, not an attached one. */
  readable: () => boolean
  /** The item's reference, as the usage reads name it. */
  reference: () => string
}

const USAGE: InjectionKey<InspectorUsage> = Symbol('inspector-usage')

/**
 * The card's record, and what work on the item took, read together.
 *
 * A goal or a stage reads its numbers with its whole tree, anything else alone. Its tab's rows
 * name only its own runs, so it reads those as well, on the item's own scope: the tree names the
 * runs of the work under it too, and those have no row on its card. Like the chain and the attempts, this
 * answers for the primary store only.
 *
 * The usage read starts with the record's rather than after it, and the record is shown once it
 * has answered, because a line arriving later would push down everything under the head: the
 * host's model knows the kind before the record does, and the record's word settles it where it
 * does not. A read slower than the head's wait, or one that fails, keeps nobody waiting.
 *
 * What the numbers go to reads them from here, so each stands in the section it belongs to and
 * the card passes none of them through.
 *
 * News of an agent reads the record again, and nothing else: it is no reason to take a refused
 * write's reason away, which the card's own load does.
 */
export function useInspectorRecord(
  props: {
    readonly projectId: string
    readonly reference: string
    readonly refreshToken: number
    readonly resourceRef: PlanningSpaceEntityRef
    readonly writable: boolean
    readonly agentsToken?: number
    readonly kind?: string
  },
  failureReason: (failure: TypedFailure) => string,
) {
  const recordKind = ref<string | null>(null)
  const isContainer = computed(() =>
    WORK_ITEM_TREE.isContainer({ kind: recordKind.value ?? props.kind ?? '' }),
  )
  const news = () => `${props.refreshToken}:${props.agentsToken}`

  const read = useWorkItemUsage(
    () =>
      props.writable ? { id: props.reference, scope: isContainer.value ? 'tree' : 'item' } : null,
    news,
  )
  const runs = useWorkItemUsage(
    () => (props.writable && isContainer.value ? { id: props.reference, scope: 'item' } : null),
    news,
  )
  const rows = computed(() => (isContainer.value ? runs : read).usage.value)
  provideInspectorUsage({
    isContainer,
    news,
    read,
    runs,
    rows,
    readable: () => props.writable,
    reference: () => props.reference,
  })

  const resource = useWorkItemResource(
    () => props.reference,
    () => ({ project: props.projectId, resource: props.resourceRef }),
    failureReason,
    async (record) => {
      recordKind.value = record.kind
      await Promise.all([read.settled(), runs.settled()])
    },
  )
  watch(
    () => props.agentsToken,
    () => void resource.load(),
  )
  /** The runs the rows name, which the card's count of agents takes in with its record's. */
  return { ...resource, spent: computed(() => rows.value?.agents ?? []) }
}

/** What the card's parts read their numbers from; a test hands them its own. */
export function provideInspectorUsage(usage: InspectorUsage) {
  provide(USAGE, usage)
}

/** The card's usage reads; none in a part drawn outside a card. */
export function injectInspectorUsage(): InspectorUsage | null {
  return inject(USAGE, null)
}
