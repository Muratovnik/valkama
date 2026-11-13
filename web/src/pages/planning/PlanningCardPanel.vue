<script setup lang="ts">
/**
 * A Planning card in its panel: the board's and the one over another module's page are this one.
 *
 * The panel lives while any card is open and only the card inside it is keyed by `identity`, so
 * going from a card to a card closes nothing and opens nothing either. Every way of closing the
 * panel asks the card about its drafts first. The walk through cards is the host's trail, whose
 * Back, related opening and close the card is wired to here, the same way on every host.
 *
 * What else the card is read and written with is one object of the card's own props and
 * handlers, `card`, built by the host, because each host reads it from somewhere else: the board
 * from the space it holds, the overlay from one read of the card's space beside the card. Each is
 * bound by its name here rather than spread onto the card, so what reaches the card is a list the
 * reader and the style guard can both see.
 */
import { computed, useTemplateRef } from 'vue'

import type { PlanningCardTrail } from '@/pages/planning/composables/usePlanningCardTrail.ts'
import PlanningCardDrawer from '@/pages/planning/PlanningCardDrawer.vue'

import WorkItemInspector from '@/widgets/work-item-inspector/components/WorkItemInspector.vue'
import type { InspectorReturn } from '@/widgets/work-item-inspector/utils/inspectorReturn.ts'

type InspectorProps = InstanceType<typeof WorkItemInspector>['$props']
/** The card's own props and handlers that its host decides; the trail gives it the rest. */
export type PlanningCardProps = Pick<
  InspectorProps,
  | 'agentsToken'
  | 'kind'
  | 'onChain'
  | 'onChanged'
  | 'onFilter'
  | 'ownChain'
  | 'parent'
  | 'projectId'
  | 'questionAsked'
  | 'reference'
  | 'refreshToken'
  | 'resourceRef'
  | 'spaceReading'
  | 'workflow'
  | 'writable'
> & {
  /** The card's `question-taken`, by a name a host's object can write without quotes. */
  onQuestionTaken?: InspectorProps['onQuestion-taken']
}

const props = defineProps<{
  /** What the card is read and written with; null while no card is open. */
  card: PlanningCardProps | null
  /** Which card is on show, across its project and space; it keys the card. */
  identity: string
  /** The panel's name: the card's title, or its reference until the title is read. */
  label: string
  trail: PlanningCardTrail
}>()

const inspector = useTemplateRef<InstanceType<typeof WorkItemInspector>>('inspector')

const shown = computed(() => props.card !== null)
const canGoBack = computed(() => props.trail.canGoBack.value)
const returnTo = computed(() => props.trail.returning.value)
/** A card opened from the one on show steps onto the trail, with where this one was left. */
function openRelated(reference: string, left: InspectorReturn) {
  props.trail.openItem(reference, true, left)
}

/** Closing the panel is the card's to decide, after its drafts. */
const close = () => inspector.value?.close()

/**
 * Another card of the space, opened from the one on show through its departure — its draft guard
 * and its Back. False while no card is on show, and the host opens it itself.
 */
function openFrom(reference: string): boolean {
  const card = inspector.value
  if (!card) return false
  if (reference !== props.card?.reference) card.openFrom(reference)
  return true
}

defineExpose({ close, openFrom })
</script>

<template>
  <PlanningCardDrawer
    :content-key="identity"
    :open="shown"
    :label="label"
    @close="close"
  >
    <WorkItemInspector
      v-if="card"
      ref="inspector"
      :key="identity"
      :reference="card.reference"
      :resource-ref="card.resourceRef"
      :project-id="card.projectId"
      :can-go-back="canGoBack"
      :return-to="returnTo"
      :refresh-token="card.refreshToken"
      :agents-token="card.agentsToken"
      :workflow="card.workflow"
      :space-reading="card.spaceReading"
      :writable="card.writable"
      :parent="card.parent"
      :own-chain="card.ownChain"
      :kind="card.kind"
      :question-asked="card.questionAsked"
      @back="trail.goBack"
      @changed="card.onChanged"
      @chain="card.onChain"
      @close="trail.closeItem"
      @filter="card.onFilter"
      @open="openRelated"
      @question-taken="card.onQuestionTaken"
    />
  </PlanningCardDrawer>
</template>
