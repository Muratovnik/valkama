<script setup lang="ts">
/**
 * What holds for an item, under its title, as rows that each say what they are: the label in
 * the quiet ink at the start of the row, in a column of its own, and the fact after it. Its
 * priority, the state, its labels, who is on it, who else follows it and its parent are each a
 * row, in the registry's order (`ROWS`). They used to share three unlabelled rows, the state, the priority and the parent in one,
 * so the parent's arrow read as a next task and nothing said which word was which.
 *
 * The state and the priority are each said once, by the control that changes them: the chip is
 * the menu (the state's row is `InspectorStateRow`). A refused write is the host's to show; the
 * chip keeps naming what the item has, so the same change can be asked again. The labels are said
 * where they are changed: each chip filters the Work view and ends in a × that takes it off, and
 * a «+» attaches another.
 *
 * Every mark is the facet registry's, so the priority carries its glyph and its hue here as it
 * does on a tile. The parent is its own kind's sign — the goal's for a goal, the generic
 * parent's for a plain task — and its reference as an item link, the same link a number in
 * text is: a press opens it through the card's own departure (its draft guard, its Back), and
 * resting on it shows its hover card. Any item may hold others, so the row is «Parent». Who is
 * on the item, and who else follows it, are the holder's rows (`InspectorHolderRows`).
 *
 * Accepted work says why and when it was accepted, «Принято», under the rows, and only there.
 *
 * Every row stands at the height of the state's own chip, so the head reads the same whichever
 * facts are present and however they wrap, and a label stands on the line of its fact's words.
 * The labels' column is as wide as its longest label, which stays one line: the facts start at
 * one edge down the block. Under the rows stands how much work the item took, a quiet line of
 * its own and only where there is some.
 *
 * A card its address opens stands before its space is read, and two of these come from the
 * space: the states the item may move to and its parent's reference. Until then the state is
 * the menu it will be, naming only where the item is, and the parent's row stands with its
 * label and no value, so neither moves anything when the space answers.
 *
 * Each row says which fact it is in `data-fact`: the facet's id, `subscribers` for the
 * sessions that follow the item, `participants` for those working on a goal, or `acceptance`. A reader of the rows finds them by what they are, not by
 * how they are drawn.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorHolderRows from '@/widgets/work-item-inspector/components/InspectorHolderRows.vue'
import InspectorStateRow from '@/widgets/work-item-inspector/components/InspectorStateRow.vue'
import InspectorUsageLine from '@/widgets/work-item-inspector/components/InspectorUsageLine.vue'
import type { FactChange } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'

import MissingPlaces from '@/features/session-open/MissingPlaces.vue'
import WorkItemLabels from '@/features/work-item-labels/WorkItemLabels.vue'

import FacetChoiceMark from '@/entities/work-item/components/FacetChoiceMark.vue'
import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'
import { useFacetChoices } from '@/entities/work-item/composables/useFacetChoices.ts'
import { PRIORITY_CHOICES } from '@/entities/work-item/utils/facetChoices.ts'
import { FACET_ORDER, printsFacet } from '@/entities/work-item/utils/facets.ts'
import type { FacetId } from '@/entities/work-item/utils/facets.ts'
import type { WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { PlanningWorkflow, WorkItem } from '@/shared/api/planningModel.ts'
import { provideReferenceLinks, referenceSpaceKey } from '@/shared/lib/referenceLinks.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import RichText from '@/shared/ui/RichText.vue'

const props = withDefaults(
  defineProps<{
    busy: boolean
    item: WorkItem
    workflow: PlanningWorkflow | null
    writable: boolean
    /** Whether a question on it waits for an answer: the facts offer to go and answer it. */
    asking?: boolean
    /** The parent by its reference and its kind; the record carries only its id. */
    parent?: Pick<WorkItem, 'kind' | 'reference'> | null
    /** The space is still being read, so the workflow and the parent are still to come. */
    spaceReading?: boolean
  }>(),
  { asking: false, parent: null, spaceReading: false },
)

const emit = defineEmits<{
  'claim': []
  /** A move to another state, another priority, or the labels it should carry now. */
  'fact': [change: FactChange]
  'filter': [token: WorkFilterToken]
  /** An item's link in the facts was pressed: the host opens it as any item from the card. */
  'open': [reference: string]
  'question': []
  'release': []
  'take-over': []
  'usage': []
}>()

/**
 * The facts that stand as rows, in the one order every surface reads an item's facets
 * (`FACET_ORDER`), as the new-task form asks for them: the template draws each row and never
 * decides where it stands. The kind stands in the head, readiness is the holder's action and
 * the steps are Overview's. The rows stood in the template's order, the parent before labels.
 */
const ROW_FACETS: ReadonlySet<FacetId> = new Set([
  'holder',
  'labels',
  'parent',
  'priority',
  'state',
])
const ROWS = FACET_ORDER.filter((facet) => ROW_FACETS.has(facet))

const { t, d } = useI18n()
/** The holder's rows, which hold the action's place the bar takes over once it scrolls away. */
const holderRows = ref<InstanceType<typeof InspectorHolderRows> | null>(null)
const keepHolderRows = (rows: unknown) => {
  holderRows.value = rows as InstanceType<typeof InspectorHolderRows> | null
}
const actionCell = computed(() => holderRows.value?.actionCell ?? null)

/** Who decided the work is to be done, and when; null while nobody has. */
const accepted = computed(() => {
  const given = props.item.acceptance
  return given
    ? t('workItem.facts.acceptedOn', {
        basis: t(`workItem.facts.basis.${given.basis}`),
        date: when(given.at),
      })
    : null
})

const facetChoices = useFacetChoices()

/**
 * The four priorities, most pressing first, each with its glyph and what it means: the same
 * definitions an agent reads in the tool's schema, so a person choosing one reads what it
 * commits to.
 */
const priorityOptions = computed(() => facetChoices(PRIORITY_CHOICES))
const priorityName = computed(() => t(`priority.${props.item.priority}`))

/**
 * A choice made during another write is not sent, and the chip stays enabled to keep its focus:
 * disabling the control that has focus drops focus to the page.
 */
function choosePriority(priority: string) {
  if (!props.busy && priority !== props.item.priority) emit('fact', { priority })
}

/** The labels' row stands where there are labels, or where one can be attached. */
const labelsShown = computed(() => props.item.labels.length > 0 || props.writable)

const context = computed(() => ({
  parentKind: props.parent?.kind,
  parentReference: props.parent?.reference,
}))
/** The one fact an item can lack; the others say their own word for having none. */
const hasParent = computed(() => printsFacet('parent', 'card', props.item, context.value))
/** The parent's row, held for a parent the space has still to name. */
const parentRow = computed(
  () => hasParent.value || (props.spaceReading && Boolean(props.item.parent_id)),
)

/**
 * An item of the card's space named in the facts — the parent, the blocker a reason waits on —
 * links as the layers above say it does, with its address and its hover card, and opens
 * through the host, which asks about a draft first and keeps the way back. The facts stand
 * above the card's body and outside its layer, so they bring this part of it with them.
 */
provideReferenceLinks((reference, parent) => {
  const link = parent(reference)
  const own = props.item.reference
  return link &&
    reference.kind === 'work-item' &&
    referenceSpaceKey(reference.value) === referenceSpaceKey(own)
    ? { ...link, open: () => emit('open', reference.value) }
    : link
})

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}

const filterLabel = (label: string) => emit('filter', { facet: 'labels', value: label })

defineExpose({ actionCell })
</script>

<template>
  <div class="card-facts-block">
    <!-- Each row is a label and its fact, laid into the block's columns; a row draws no box. -->
    <template
      v-for="facet in ROWS"
      :key="facet"
    >
      <InspectorStateRow
        v-if="facet === 'state'"
        :asking="asking"
        :busy="busy"
        :item="item"
        :space-reading="spaceReading"
        :workflow="workflow"
        :writable="writable"
        @fact="(change) => emit('fact', change)"
        @question="emit('question')"
      />
      <div
        v-else-if="facet === 'priority'"
        class="card-row"
        data-fact="priority"
      >
        <span class="card-row-label beside-chip trimmed-word">{{ t('workItem.priority') }}</span>
        <div class="card-row-value">
          <ChoiceSelect
            v-if="writable"
            class="card-priority"
            size="compact"
            :model-value="item.priority"
            :options="priorityOptions"
            :label="t('workItem.head.priority', { priority: priorityName })"
            @update:model-value="choosePriority"
          >
            <template #option="{ option }">
              <FacetChoiceMark :mark="option.mark" />
            </template>
            <template #value>
              <span class="card-priority-value">
                <FacetMarks
                  surface="card"
                  :item="item"
                  :facets="['priority']"
                />
              </span>
            </template>
          </ChoiceSelect>
          <span
            v-else
            class="card-fact"
          >
            <FacetMarks
              surface="card"
              :item="item"
              :facets="['priority']"
            />
          </span>
        </div>
      </div>
      <div
        v-else-if="facet === 'labels' && labelsShown"
        class="card-row"
        data-fact="labels"
      >
        <span class="card-row-label">{{ t('workItem.labels') }}</span>
        <div class="card-row-value">
          <WorkItemLabels
            class="card-labels"
            :labels="item.labels"
            :writable="writable"
            @labels="(labels) => emit('fact', { labels })"
            @filter="filterLabel"
          />
        </div>
      </div>
      <InspectorHolderRows
        v-else-if="facet === 'holder'"
        :ref="keepHolderRows"
        :item="item"
        :busy="busy"
        :writable="writable"
        @claim="emit('claim')"
        @release="emit('release')"
        @take-over="emit('take-over')"
      />
      <div
        v-else-if="facet === 'parent' && parentRow"
        class="card-row"
        data-fact="parent"
      >
        <span class="card-row-label beside-chip trimmed-word">{{ t('workItem.parent') }}</span>
        <div class="card-row-value">
          <span
            v-if="hasParent"
            class="card-fact card-parent"
          >
            <FacetMarks
              surface="card"
              :item="item"
              :facets="['parent']"
              :context="context"
            />
            <RichText
              class="card-parent-link trimmed-word one-line"
              :source="parent?.reference ?? ''"
              inline
            />
          </span>
        </div>
      </div>
    </template>
    <div
      v-if="accepted"
      class="card-row"
      data-fact="acceptance"
    >
      <span class="card-row-label">{{ t('workItem.facts.accepted') }}</span>
      <p class="card-row-value card-accepted">{{ accepted }}</p>
    </div>
    <MissingPlaces class="card-missing" />
    <div class="card-usage">
      <InspectorUsageLine @details="emit('usage')" />
    </div>
  </div>
</template>

<style scoped src="./InspectorFactRows.css"></style>

<style scoped src="./InspectorFacts.css"></style>
