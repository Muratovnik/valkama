<script setup lang="ts">
/**
 * What holds for an item, under its title, as rows that each say what they are: the label in
 * the quiet ink at the start of the row, in a column of its own, and the fact after it. The
 * state, its priority, its epic, who is on it, who else follows it and its labels are each a
 * row. They used to share three unlabelled rows, the state, the priority and the epic in one,
 * so the epic's arrow read as a next task and nothing said which word was which.
 *
 * The state and the priority are each said once, by the control that changes them: the chip is
 * the menu. A refused write is the host's to show; the chip keeps naming what the item has, so
 * the same change can be asked again. The labels are said where they are changed: each chip
 * filters the Work view and ends in a × that takes it off, and a «+» attaches another.
 *
 * Every mark is the facet registry's, so the priority carries its glyph and its hue here as it
 * does on a tile. The epic is the epic's sign and its reference as an item link, the same link
 * a number in text is: a press opens the epic through the card's own departure (its draft
 * guard, its Back), and resting on it shows the epic's hover card. The holder's words are bare, a way to the session where there is one: a plate
 * of the same weight as the chips above it made the row one more chip. The lease is a tooltip
 * and, when nobody is behind it any more, a warning dot: a detail of the holder, not a fact of
 * its own. The other sessions that follow the item are a row under it, each printed as its
 * claim's holder would be and kept whole on its line.
 *
 * Every row stands at the height of the state's own chip, so the head reads the same whichever
 * facts are present and however they wrap, and a label stands on the line of its fact's words.
 * The labels' column is as wide as its longest label, which stays one line: the facts start at
 * one edge down the block. The action ends the holder's row where the drawer is wide and stands
 * at full width under everything else where it is not, within reach of a thumb. The host shows
 * it again in the bar once this one has scrolled away. Under the rows stands how much work the
 * item took, a quiet line of its own and only where there is some.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorUsageLine from '@/widgets/work-item-inspector/components/InspectorUsageLine.vue'
import InspectorWriteActions from '@/widgets/work-item-inspector/components/InspectorWriteActions.vue'
import type { FactChange } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'

import ExecutorLink from '@/features/session-open/ExecutorLink.vue'
import MissingPlaces from '@/features/session-open/MissingPlaces.vue'
import WorkItemLabels from '@/features/work-item-labels/WorkItemLabels.vue'

import FacetChoiceMark from '@/entities/work-item/components/FacetChoiceMark.vue'
import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'
import { useFacetChoices } from '@/entities/work-item/composables/useFacetChoices.ts'
import { PRIORITY_CHOICES } from '@/entities/work-item/utils/facetChoices.ts'
import { holderRef, printsFacet } from '@/entities/work-item/utils/facets.ts'
import type { WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { PlanningWorkflow, WorkItem } from '@/shared/api/planningModel.ts'
import { isWebAuthor } from '@/shared/api/webAuthor.ts'
import { holderName } from '@/shared/lib/actor.ts'
import { provideReferenceLinks, referenceSpaceKey } from '@/shared/lib/referenceLinks.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import RichText from '@/shared/ui/RichText.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    busy: boolean
    item: WorkItem
    workflow: PlanningWorkflow | null
    writable: boolean
    /** Whether a question on it waits for an answer: the facts offer to go and answer it. */
    asking?: boolean
    /** The epic's reference; the record carries only its id. */
    parentReference?: string | null
  }>(),
  { asking: false, parentReference: null },
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

const { t, d } = useI18n()
/** The action's place on the card, which the bar takes over from once it has scrolled away. */
const actionCell = ref<HTMLElement | null>(null)

const facetChoices = useFacetChoices()
const stateChoice = (state: Pick<WorkItem['state'], 'key' | 'name' | 'category'>) =>
  ({ facet: 'state', value: state.key, state }) as const

/** The states this item may move to, which is the workflow's answer, not a list. */
const moves = computed(() => {
  const workflow = props.workflow
  if (!workflow) return []
  const allowed = new Set(
    workflow.transitions
      .filter((transition) => transition.from === props.item.state.state_id)
      .map((transition) => transition.to),
  )
  return facetChoices(
    workflow.states
      .filter((state) => allowed.has(state.state_id))
      .map((state) => stateChoice(state)),
  )
})

/**
 * The menu names where the item is, checked and not choosable, above where it can go; each
 * with its dot, as the chip draws the state it is in.
 */
const stateOptions = computed(() => [
  ...facetChoices([stateChoice(props.item.state)]).map((here) => ({ ...here, disabled: true })),
  ...moves.value,
])
const movable = computed(() => props.writable && moves.value.length > 0)

/**
 * The chip stays enabled while a write is in flight: disabling the control
 * that has focus drops focus to the page, which is where a keyboard move left
 * the reader. A move asked during another write is not sent.
 */
function move(stateKey: string) {
  if (!props.busy && stateKey !== props.item.state.key) emit('fact', { state: stateKey })
}

/**
 * The four priorities, most pressing first, each with its glyph and what it means: the same
 * definitions an agent reads in the tool's schema, so a person choosing one reads what it
 * commits to.
 */
const priorityOptions = computed(() => facetChoices(PRIORITY_CHOICES))
const priorityName = computed(() => t(`priority.${props.item.priority}`))

/** As a move: a choice made during another write is not sent, and the chip keeps its focus. */
function choosePriority(priority: string) {
  if (!props.busy && priority !== props.item.priority) emit('fact', { priority })
}

/** The labels' row stands where there are labels, or where one can be attached. */
const labelsShown = computed(() => props.item.labels.length > 0 || props.writable)

const context = computed(() => ({ parentReference: props.parentReference }))
/** The one fact an item can lack; the others say their own word for having none. */
const inEpic = computed(() => printsFacet('parent', 'card', props.item, context.value))

/**
 * An item of the card's space named in the facts — the epic, the blocker a reason waits on —
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
/** What the row calls its holder: who is on it, or on finished work who was. */
const holderLabel = computed(() =>
  props.item.state.is_terminal ? t('workItem.previousOwner') : t('workItem.head.holder'),
)
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
 * row names its own. A name is cut into its words, the dot kept with the word before it, so a
 * name wider than the line breaks only between them.
 */
const followers = computed(() => {
  const labels = (props.item.subscribers ?? [])
    .map(({ label }) => label)
    .filter((label) => label !== holder.value)
  return labels.map((label, index) => {
    const comma = index < labels.length - 1 ? ',' : ''
    const words = `${holderName(label)}${comma}`
      .split(/ (?!·)/)
      .map((text, at) => ({ before: at ? ' ' : '', text }))
    return { label, words }
  })
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
    <div class="card-row card-facts">
      <span class="card-row-label beside-chip trimmed-word">{{ t('workItem.state') }}</span>
      <div class="card-row-value">
        <ChoiceSelect
          v-if="movable"
          class="card-state"
          size="compact"
          :model-value="item.state.key"
          :options="stateOptions"
          :label="t('workItem.head.state', { state: item.state.name })"
          @update:model-value="move"
        >
          <template #option="{ option }">
            <FacetChoiceMark :mark="option.mark" />
          </template>
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
        <!-- A verb, not a state: the state's dot already says an agent waits, and this goes
             to the question on Overview. -->
        <VButton
          v-if="asking"
          v-tooltip.clipped="t('requests.answerQuestion')"
          class="card-question"
          variant="ghost"
          size="compact"
          @click="emit('question')"
        >
          <VIcon
            name="message-square"
            :size="16"
          />
          <span class="card-question-word trimmed-word one-line">{{
            t('requests.answerQuestion')
          }}</span>
        </VButton>
      </div>
    </div>
    <div class="card-row">
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
      v-if="inEpic"
      class="card-row"
    >
      <span class="card-row-label beside-chip trimmed-word">{{ t('workItem.parent') }}</span>
      <div class="card-row-value">
        <span class="card-fact card-epic">
          <FacetMarks
            surface="card"
            :item="item"
            :facets="['parent']"
            :context="context"
          />
          <RichText
            class="card-epic-link trimmed-word one-line"
            :source="parentReference ?? ''"
            inline
          />
        </span>
      </div>
    </div>
    <div class="card-row card-holder">
      <span class="card-row-label card-holder-label">{{ holderLabel }}</span>
      <div class="card-row-value card-holder-value">
        <!-- A session's link says the holder in its own hint; a bare name carries it here. -->
        <ExecutorLink
          v-if="holderExecutor?.session"
          class="card-holder-link"
          :holder="holder"
          :executor="holderExecutor"
          :detail="leaseText"
        />
        <span
          v-else-if="holder"
          v-tooltip.detail="holderTitle"
          class="card-holder-name one-line"
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
    </div>
    <div
      v-if="followers.length"
      class="card-row card-subscribers"
    >
      <span class="card-row-label">{{ t('workItem.head.subscribers') }}</span>
      <p class="card-row-value card-subscriber-list">
        <span
          v-for="follower in followers"
          :key="follower.label"
          v-tooltip.detail="follower.label"
          class="card-subscriber"
          ><template
            v-for="(word, at) in follower.words"
            :key="at"
            >{{ word.before }}<span class="card-subscriber-word">{{ word.text }}</span></template
          ></span
        >
      </p>
    </div>
    <div
      v-if="labelsShown"
      class="card-row"
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
    <MissingPlaces class="card-missing" />
    <div class="card-usage">
      <InspectorUsageLine @details="emit('usage')" />
    </div>
  </div>
</template>

<style scoped src="./InspectorFacts.css"></style>
