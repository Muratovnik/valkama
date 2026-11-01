<script setup lang="ts">
/**
 * What holds for an item, under its title: its state, priority, holder and
 * epic on one line, its labels under them, and the one thing to do about it.
 *
 * The state is said once, by the control that moves it: the chip is the
 * transition menu. It used to be a fact in a five-cell grid of equal-weight
 * labels and again a full-width «Перевести в» select above that grid, so the
 * state was read twice and found half way down the drawer. A refused move is
 * the host's to show; the chip keeps naming the state the item is in, so the
 * same move can be asked again.
 *
 * Every mark is the facet registry's, so priority carries its glyph and its
 * hue here as it does on a tile. The holder's lease is a tooltip and, when
 * nobody is behind it any more, a warning dot: it is a detail of the holder,
 * not a fact of its own.
 *
 * The action ends the facts line where the drawer is wide and stands at full
 * width under the labels where it is not; a question about it takes the whole
 * width wherever it is asked. Labels are buttons that add themselves to the
 * Work filter, and step out with the rest of the head's detail when it
 * condenses.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorWriteActions from '@/widgets/work-item-inspector/components/InspectorWriteActions.vue'
import { openBlockers } from '@/widgets/work-item-inspector/utils/openBlockers.ts'

import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'
import LabelChip from '@/entities/work-item/components/LabelChip.vue'
import type { WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { PlanningWorkflow, WorkItem } from '@/shared/api/planningModel.ts'
import { isWebAuthor } from '@/shared/api/webAuthor.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'

const props = withDefaults(
  defineProps<{
    busy: boolean
    item: WorkItem
    workflow: PlanningWorkflow | null
    writable: boolean
    /** The head is condensed while the body is read: the labels step out. */
    condensed?: boolean
    /** The epic's reference; the record carries only its id. */
    parentReference?: string | null
  }>(),
  { condensed: false, parentReference: null },
)

const emit = defineEmits<{
  'claim': []
  'filter': [token: WorkFilterToken]
  'move': [stateKey: string]
  'release': []
  'take-over': []
}>()

const { t, d } = useI18n()
const asking = ref(false)

/** The states this item may move to, which is the workflow's answer, not a list. */
const moves = computed<ChoiceOption[]>(() => {
  const workflow = props.workflow
  if (!workflow) return []
  const allowed = new Set(
    workflow.transitions
      .filter((transition) => transition.from === props.item.state.state_id)
      .map((transition) => transition.to),
  )
  return workflow.states
    .filter((state) => allowed.has(state.state_id))
    .map((state) => ({ value: state.key, label: state.name }))
})

/** The menu names where the item is, checked and not choosable, above where it can go. */
const stateOptions = computed<ChoiceOption[]>(() => [
  { value: props.item.state.key, label: props.item.state.name, disabled: true },
  ...moves.value,
])
const movable = computed(() => props.writable && moves.value.length > 0)

/**
 * The chip stays enabled while a write is in flight: disabling the control
 * that has focus drops focus to the page, which is where a keyboard move left
 * the reader. A move asked during another write is not sent.
 */
function move(stateKey: string) {
  if (!props.busy && stateKey !== props.item.state.key) emit('move', stateKey)
}

const waitingOn = computed(() => openBlockers(props.item)[0]?.reference ?? null)
const context = computed(() => ({ parentReference: props.parentReference }))

/**
 * Whether anyone is still behind another holder's claim, and until when.
 * Not on a finished item, whose holder is history, nor on this client's own
 * claim, which no session ever stands behind.
 */
const lease = computed(() => {
  const claim = props.item.claim
  return props.item.state.is_terminal || !claim || isWebAuthor(claim.holder) ? null : claim
})
const leaseText = computed(() => {
  const claim = lease.value
  if (!claim) return ''
  let detail = t('workItem.lease.unconfirmedDetail')
  if (claim.state === 'live' && claim.expires_at)
    detail = t('workItem.lease.liveDetail', { date: when(claim.expires_at) })
  else if (claim.state === 'stale') detail = t('workItem.lease.staleDetail')
  const state = t(`workItem.lease.${claim.state}`)
  return `${t('workItem.lease.label')}: ${state} — ${detail}`
})
/** Who the holder is to the item: responsible while it is open, history once it is done. */
const ownerLabel = computed(() =>
  t(props.item.state.is_terminal ? 'workItem.previousOwner' : 'workItem.owner'),
)
/** The lease where one stands behind the claim; otherwise what the name is. */
const holderTitle = computed(() => leaseText.value || ownerLabel.value)

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}

const filterLabel = (label: string) => emit('filter', { facet: 'labels', value: label })
</script>

<template>
  <div
    class="card-facts-block"
    :class="{ asking }"
  >
    <div class="card-facts">
      <ChoiceSelect
        v-if="movable"
        class="card-state"
        size="compact"
        :model-value="item.state.key"
        :options="stateOptions"
        :label="t('workItem.head.state', { state: item.state.name })"
        @update:model-value="move"
      >
        <template #value>
          <SemanticState
            dimension="work-item-state"
            :state="item.state.category"
            :label="item.state.name"
          />
        </template>
      </ChoiceSelect>
      <SemanticState
        v-else
        class="card-state"
        dimension="work-item-state"
        :state="item.state.category"
        :label="item.state.name"
      />
      <FacetMarks
        surface="card"
        :item="item"
        :facets="['priority']"
      />
      <span
        class="card-holder"
        :title="holderTitle"
      >
        <span class="visually-hidden">{{ ownerLabel }}:</span>
        <FacetMarks
          surface="card"
          :item="item"
          :facets="['holder']"
        />
        <SemanticState
          v-if="lease?.state === 'stale'"
          dimension="claim-lease"
          state="stale"
          variant="dot"
          :label="t('workItem.lease.mark')"
        />
        <span
          v-if="leaseText"
          class="visually-hidden"
          >{{ leaseText }}</span
        >
      </span>
      <FacetMarks
        surface="card"
        :item="item"
        :facets="['parent']"
        :context="context"
      />
    </div>
    <InspectorWriteActions
      v-if="writable"
      v-model:asking="asking"
      class="card-action"
      :item="item"
      :busy="busy"
      :waiting-on="waitingOn"
      @claim="emit('claim')"
      @release="emit('release')"
      @take-over="emit('take-over')"
    />
    <ul
      v-if="item.labels.length && !condensed"
      class="card-labels"
    >
      <li
        v-for="label in item.labels"
        :key="label"
      >
        <LabelChip
          :label="label"
          @filter="filterLabel"
        />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.card-facts-block {
  display: grid;
  grid-template-areas: 'facts action' 'labels labels';
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  min-width: 0;

  /* A question about the action takes the width it needs to be read. */
  &.asking {
    grid-template-areas: 'facts facts' 'labels labels' 'action action';
  }
}

.card-facts {
  display: flex;
  flex-wrap: wrap;
  grid-area: facts;
  gap: var(--space-1) var(--space-4);
  align-items: center;
  min-width: 0;
}

/* The chip is as wide as the state it names, not the row. */
.card-state {
  flex: 0 0 auto;
  max-width: 100%;
}

.card-holder {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
}

.card-action {
  grid-area: action;
}

.card-labels {
  display: flex;
  flex-wrap: wrap;
  grid-area: labels;
  gap: 0 var(--space-2);
  min-width: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* A phone-wide drawer: the facts wrap, the labels follow them, and the one
   action stands under both at the full width a thumb reaches. */
@container drawer (width < 520px) {
  .card-facts-block,
  .card-facts-block.asking {
    grid-template-areas: 'facts' 'labels' 'action';
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
