<script setup lang="ts">
/**
 * What holds for an item, under its title, as three rows with room between them. The first
 * is what the item is now: its state, a question waiting for its answer, its priority and
 * its epic. The second is who is on it and the one thing to do about that, so the holder and
 * the action stand together. The third is its labels, which add themselves to the Work
 * filter, and an item with none has no such row.
 *
 * The state is said once, by the control that moves it: the chip is the transition menu. It
 * used to be a fact in a five-cell grid of equal-weight labels and again a full-width
 * «Перевести в» select above that grid, so the state was read twice and found half way down
 * the drawer. A refused move is the host's to show; the chip keeps naming the state the item
 * is in, so the same move can be asked again.
 *
 * Every mark is the facet registry's, so priority carries its glyph and its hue here as it
 * does on a tile. The holder has a label of its own in the quiet ink, «Исполняет», or
 * «Ранее отвечал» on finished work, where resuming whoever held it is often the point. The
 * words after it are bare, a way to the session where there is one: a plate of the same
 * weight as the chips above it made the row one more chip. The lease is a tooltip and, when
 * nobody is behind it any more, a warning dot: a detail of the holder, not a fact of its own.
 * The other sessions that follow the item stand under it, a note on that row with a label of
 * the same ink, each printed as its claim's holder would be and kept whole on its line.
 *
 * Every row stands at the height of the state's own chip, so a head reads the same whichever
 * facts are present and however they wrap. The action ends the second row where the drawer
 * is wide and stands at full width under the labels where it is not, within reach of a
 * thumb. The host shows it again in the bar once this one has scrolled away. Under the labels
 * stands how much work the item took, a quiet line of its own and only where there is some.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorUsageLine from '@/widgets/work-item-inspector/components/InspectorUsageLine.vue'
import InspectorWriteActions from '@/widgets/work-item-inspector/components/InspectorWriteActions.vue'

import ExecutorLink from '@/features/session-open/ExecutorLink.vue'
import MissingPlaces from '@/features/session-open/MissingPlaces.vue'

import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'
import LabelChip from '@/entities/work-item/components/LabelChip.vue'
import { holderRef, printsFacet } from '@/entities/work-item/utils/facets.ts'
import type { WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { PlanningWorkflow, WorkItem } from '@/shared/api/planningModel.ts'
import { isWebAuthor } from '@/shared/api/webAuthor.ts'
import { holderName } from '@/shared/lib/actor.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    busy: boolean
    item: WorkItem
    workflow: PlanningWorkflow | null
    writable: boolean
    /** Whether a question on it waits for an answer. */
    asking?: boolean
    /** The epic's reference; the record carries only its id. */
    parentReference?: string | null
  }>(),
  { asking: false, parentReference: null },
)

const emit = defineEmits<{
  'claim': []
  'filter': [token: WorkFilterToken]
  'move': [stateKey: string]
  'question': []
  'release': []
  'take-over': []
  'usage': []
}>()

const { t, d } = useI18n()
/** The action's place on the card, which the bar takes over from once it has scrolled away. */
const actionCell = ref<HTMLElement | null>(null)

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

const context = computed(() => ({ parentReference: props.parentReference }))
/** The one fact an item can lack; the others say their own word for having none. */
const inEpic = computed(() => printsFacet('parent', 'card', props.item, context.value))

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
const holder = computed(() => holderRef(props.item))
/** What the row calls its holder; on finished work that nobody held, there is nobody to call. */
const holderLabel = computed(() => {
  if (!props.item.state.is_terminal) return t('workItem.head.holder')
  return holder.value ? t('workItem.previousOwner') : ''
})
/** The holder as it was written, which the line shortens, and the lease behind the claim. */
const holderTitle = computed(
  () => [holder.value, leaseText.value].filter(Boolean).join('\n') || undefined,
)

/** The session behind the holder: its claim's, or on finished work its last claim's. */
const holderExecutor = computed(() =>
  props.item.state.is_terminal ? props.item.last_claim_executor : props.item.claim?.executor,
)

/**
 * The sessions that follow the item, each by the label the server gives it, which is what a
 * claim of it records, printed as the holder is, a comma after all but the last; the holder's
 * row names its own.
 */
const followers = computed(() => {
  const labels = (props.item.subscribers ?? [])
    .map(({ label }) => label)
    .filter((label) => label !== holder.value)
  return labels.map((label, index) => ({
    label,
    words: index < labels.length - 1 ? `${holderName(label)},` : holderName(label),
  }))
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
      <span
        v-else
        class="card-fact"
      >
        <SemanticState
          class="card-state"
          dimension="work-item-state"
          :state="item.state.category"
          :label="item.state.name"
        />
      </span>
      <VButton
        v-if="asking"
        class="card-question"
        variant="ghost"
        size="compact"
        @click="emit('question')"
      >
        <SemanticState
          dimension="work-item-readiness"
          state="asking"
          :label="t('requests.pending')"
        />
      </VButton>
      <span class="card-fact">
        <FacetMarks
          surface="card"
          :item="item"
          :facets="['priority']"
        />
      </span>
      <span
        v-if="inEpic"
        class="card-fact"
      >
        <FacetMarks
          surface="card"
          :item="item"
          :facets="['parent']"
          :context="context"
        />
      </span>
    </div>
    <div
      class="card-holder"
      :title="holderTitle"
    >
      <span
        v-if="holderLabel"
        class="card-holder-label"
        >{{ holderLabel }}</span
      >
      <ExecutorLink
        v-if="holderExecutor?.session"
        class="card-holder-link"
        :holder="holder"
        :executor="holderExecutor"
        :detail="leaseText"
      />
      <span
        v-else-if="holder"
        class="card-holder-name"
        >{{ holderName(holder) }}</span
      >
      <FacetMarks
        v-else
        surface="card"
        :item="item"
        :facets="['holder']"
      />
      <SemanticState
        v-if="lease?.state === 'stale'"
        class="card-holder-stale"
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
    </div>
    <div
      v-if="writable"
      ref="actionCell"
      class="card-action"
    >
      <InspectorWriteActions
        :item="item"
        :busy="busy"
        @claim="emit('claim')"
        @release="emit('release')"
        @take-over="emit('take-over')"
      />
    </div>
    <p
      v-if="followers.length"
      class="card-subscribers"
    >
      <span class="card-holder-label">{{ t('workItem.head.subscribers') }}</span>
      <span
        v-for="follower in followers"
        :key="follower.label"
        class="card-subscriber"
        :title="follower.label"
        >{{ follower.words }}</span
      >
    </p>
    <MissingPlaces class="card-missing" />
    <ul
      v-if="item.labels.length"
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
    <div class="card-usage">
      <InspectorUsageLine @details="emit('usage')" />
    </div>
  </div>
</template>

<style scoped>
/* Auto-placed, so a row with nothing in it has no track and none of the room around it: named
   areas keep an empty row's gaps, and a head without labels ended 12px lower than its action. */
.card-facts-block {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3) var(--space-4);
  align-items: start;
  min-width: 0;
}

.card-facts {
  display: flex;
  flex-wrap: wrap;
  grid-column: 1 / -1;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  min-width: 0;
}

/* The chip is as wide as the state it names, not the row. */
.card-state {
  flex: 0 0 auto;
  max-width: 100%;
}

/* Each fact takes the chip's height, so a wrap adds a row of the same height. */
.card-fact {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  min-height: var(--size-control-height-compact);
}

/* The label and the first line of the holder share a baseline, in the middle of a row as high
   as the action's. The label and the holder wrap as two words do: a holder too long to stand
   beside the label takes a line of its own, and only there does its name give way. */
.card-holder {
  display: flex;
  flex-wrap: wrap;
  grid-column: 1;
  gap: var(--space-1) var(--space-2);
  place-content: center start;
  align-items: baseline;
  min-width: 0;
  min-height: var(--size-control-height-compact);
}

.card-holder-label {
  flex: none;
  color: var(--color-text-muted);
  font: var(--font-detail);
  white-space: nowrap;
}

/* The words start where a plain holder's do: the margin takes back the inset its fill keeps
   under the pointer. The name takes the ink a value has, against the label's quiet one. */
.card-holder-link {
  --color-open-action-name: var(--color-text);

  margin-inline-start: calc(-1 * var(--space-fill-inset));
}

.card-holder-name {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--color-text);
  font: var(--font-detail);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-holder-stale {
  flex: none;
  align-self: center;
}

.card-action {
  grid-column: 2;

  &:empty {
    display: none;
  }
}

/* Who else follows the item: a note on the holder's row, as the missing places are below. The
   names wrap between them, never inside one, and a line that wraps starts where the label does;
   only a name wider than the whole line gives way, as the holder's does. */
.card-subscribers {
  display: flex;
  flex-wrap: wrap;
  grid-column: 1 / -1;
  gap: var(--space-1) var(--space-2);
  align-items: baseline;
  min-width: 0;
  margin: calc(var(--space-1) - var(--space-3)) 0 0;
}

.card-subscriber {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--color-text);
  font: var(--font-detail);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* A note on the holder's row rather than a row of its own, so it stands closer to it. */
.card-missing {
  grid-column: 1 / -1;
  margin-block-start: calc(var(--space-1) - var(--space-3));
}

.card-labels {
  display: flex;
  flex-wrap: wrap;
  grid-column: 1 / -1;
  gap: var(--space-1);
  min-width: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* Closer to the facts than they are to each other: it reads as a note on them. */
.card-usage {
  grid-column: 1 / -1;
  margin-block-start: calc(-1 * var(--space-1));

  &:empty {
    display: none;
  }
}

/* A phone-wide drawer: the one action stands under everything else, at the full width a thumb
   reaches. In the document it stays next to the holder it is about. */
@container drawer (width < 520px) {
  .card-facts-block {
    grid-template-columns: minmax(0, 1fr);
  }

  .card-action {
    grid-column: 1;
    order: 1;
  }
}
</style>
