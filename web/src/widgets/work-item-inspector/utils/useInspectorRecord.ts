import { computed, inject, provide, ref } from 'vue'
import type { ComputedRef, InjectionKey } from 'vue'

import { useWorkItemResource } from '@/widgets/work-item-inspector/utils/useWorkItemResource.ts'
import { useWorkItemUsage } from '@/widgets/work-item-inspector/utils/useWorkItemUsage.ts'

import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

interface InspectorUsage {
  /** The item is an epic, whose numbers take in its children. */
  isEpic: ComputedRef<boolean>
  /** The read of the card's own numbers. */
  read: ReturnType<typeof useWorkItemUsage>
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
 * An epic reads its numbers with its whole scope, anything else alone. Like the chain and the
 * attempts, this answers for the primary store only.
 *
 * The usage read starts with the record's rather than after it, and the record is shown once it
 * has answered, because a line arriving later would push down everything under the head: the
 * host's model knows the kind before the record does, and the record's word settles it where it
 * does not. A read slower than the head's wait, or one that fails, keeps nobody waiting.
 *
 * What the numbers go to reads them from here, so each stands in the section it belongs to and
 * the card passes none of them through.
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
  const isEpic = computed(() => (recordKind.value ?? props.kind) === 'epic')
  const news = () => `${props.refreshToken}:${props.agentsToken}`

  const read = useWorkItemUsage(
    () => (props.writable ? { id: props.reference, scope: isEpic.value ? 'epic' : 'item' } : null),
    news,
  )
  provide(USAGE, {
    isEpic,
    news,
    read,
    readable: () => props.writable,
    reference: () => props.reference,
  })

  const resource = useWorkItemResource(
    () => props.reference,
    () => ({ project: props.projectId, resource: props.resourceRef }),
    failureReason,
    async (record) => {
      recordKind.value = record.kind
      await read.settled()
    },
  )
  /** The runs the read counts, which the card's count of agents takes in with its record's. */
  return { ...resource, spent: computed(() => read.usage.value?.agents ?? []) }
}

/** The card's usage reads; none in a part drawn outside a card. */
export function injectInspectorUsage(): InspectorUsage | null {
  return inject(USAGE, null)
}
