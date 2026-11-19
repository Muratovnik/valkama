<script setup lang="ts">
/**
 * The state's row of the card's facts (`InspectorFacts`): where the item stands, said once, by the
 * control that changes it. The chip is the menu; a refused write is the host's to show, and the
 * chip keeps naming what the item has, so the same change can be asked again.
 *
 * A move that closes work or puts it off is not sent as it is chosen: putting off opens the
 * window that asks until when, and cancelling asks its reason in place, or, for a goal or a
 * stage with work under it, opens the window that lists what closes with it
 * (`provideInspectorClosing`). An accepted open goal or stage stands in no state, so its menu
 * offers only what can be done to it: confirm its close while it awaits that, put it off, cancel
 * it. While it awaits confirmation, «Confirm close» also stands beside its state.
 *
 * A task waiting to be taken that was taken before says «начата» beside its state; a goal or a
 * stage says no such thing, its start being its first task's. While a question on it waits for
 * an answer, a verb beside the state goes to it on Overview.
 *
 * Until its space is read the state is the menu it will be, naming only where the item is, so
 * nothing moves when the space answers.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { injectInspectorClosing } from '@/widgets/work-item-inspector/utils/useInspectorClosing.ts'
import type { ClosingAction } from '@/widgets/work-item-inspector/utils/useInspectorClosing.ts'
import type { FactChange } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'

import FacetChoiceMark from '@/entities/work-item/components/FacetChoiceMark.vue'
import { useFacetChoices } from '@/entities/work-item/composables/useFacetChoices.ts'
import type { FacetChoiceOption } from '@/entities/work-item/composables/useFacetChoices.ts'
import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { PlanningWorkflow, WorkItem } from '@/shared/api/planningModel.ts'
import { standingOf } from '@/shared/lib/standing.ts'
import { useStandingName } from '@/shared/lib/useStateName.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  asking: boolean
  busy: boolean
  item: WorkItem
  spaceReading: boolean
  workflow: PlanningWorkflow | null
  writable: boolean
}>()

const emit = defineEmits<{ fact: [change: FactChange]; question: [] }>()

const { t } = useI18n()
const standingName = useStandingName()
const closing = injectInspectorClosing()
const here = computed(() => standingName(props.item))
const standing = computed(() => standingOf(props.item))

/** A task waiting to be taken that was started before says so; a goal starts with its tasks. */
const WAITING = new Set(['triage', 'deferred', 'ready'])
const started = computed(
  () =>
    props.item.started_at !== null &&
    !WORK_ITEM_TREE.isContainer(props.item) &&
    WAITING.has(props.item.state?.category ?? ''),
)

/** The value an accepted open goal's menu names where it stands by: it is in no state. */
const HERE = 'standing'
/** A menu value that starts a closing action rather than naming a state. */
const ACTION = 'action:'
type Option = ChoiceOption & { mark?: FacetChoiceOption['mark'] }

const facetChoices = useFacetChoices()
const stateChoice = (state: Pick<NonNullable<WorkItem['state']>, 'key' | 'name' | 'category'>) =>
  ({ facet: 'state', value: state.key, state }) as const

/** The states this item may move to, which is the workflow's answer, not a list. */
const moves = computed(() => {
  const workflow = props.workflow
  const from = props.item.state
  if (!workflow || !from) return []
  const allowed = new Set(
    workflow.transitions
      .filter((transition) => transition.from === from.state_id)
      .map((transition) => transition.to),
  )
  return facetChoices(
    workflow.states
      .filter((state) => allowed.has(state.state_id))
      .map((state) => stateChoice(state)),
  )
})

/** An accepted open goal or stage, whose standing is derived and whose menu holds its actions. */
const derived = computed(() => props.item.state === null && props.item.container_state !== null)
const awaiting = computed(() => props.item.container_state === 'awaiting_confirmation')
const closes = computed(() => props.writable && closing !== null && derived.value)
/** An action whose state the workflow lacks is not offered: it would lead nowhere. */
const leadsTo = (category: string) =>
  props.workflow?.states.some((state) => state.category === category) ?? false
const confirmable = computed(() => closes.value && awaiting.value && leadsTo('completed'))
const actions = computed<Option[]>(() => {
  if (!closes.value) return []
  const offered = { confirm: confirmable.value, defer: true, cancel: leadsTo('cancelled') }
  return (['confirm', 'defer', 'cancel'] as const)
    .filter((action) => offered[action])
    .map((action) => ({
      value: `${ACTION}${action}`,
      label: t(`workItem.closeActions.action.${action}`),
    }))
})

/**
 * The menu names where the item is, checked and not choosable, above where it can go; each
 * with its dot, as the chip draws the state it is in.
 */
const stateOptions = computed<Option[]>(() => {
  if (derived.value) return [{ value: HERE, label: here.value, disabled: true }, ...actions.value]
  const { state } = props.item
  const current = state ? facetChoices([stateChoice(state)]) : []
  return [...current.map((at) => ({ ...at, disabled: true })), ...moves.value]
})
const movable = computed(
  () =>
    actions.value.length > 0 ||
    (props.writable &&
      props.item.state !== null &&
      (moves.value.length > 0 || (props.spaceReading && !props.workflow))),
)

const confirmClose = () => closing?.start('confirm')

/** Where a state of the workflow leads: putting off and cancelling ask first. */
function closingOf(key: string): ClosingAction | null {
  const category = props.workflow?.states.find((state) => state.key === key)?.category
  if (category === 'deferred') return 'defer'
  return category === 'cancelled' ? 'cancel' : null
}

/**
 * The chip stays enabled while a write is in flight: disabling the control
 * that has focus drops focus to the page, which is where a keyboard move left
 * the reader. A move asked during another write is not sent.
 */
function move(value: string) {
  if (props.busy || value === props.item.state?.key || value === HERE) return
  if (value.startsWith(ACTION)) {
    closing?.start(value.slice(ACTION.length) as ClosingAction)
    return
  }
  const action = closing ? closingOf(value) : null
  if (action) closing?.start(action, value)
  else emit('fact', { state: value })
}
</script>

<template>
  <div
    class="card-row card-facts"
    data-fact="state"
  >
    <span class="card-row-label beside-chip trimmed-word">{{ t('workItem.state') }}</span>
    <div class="card-row-value">
      <ChoiceSelect
        v-if="movable"
        class="card-state"
        size="compact"
        :model-value="item.state?.key ?? HERE"
        :options="stateOptions"
        :label="t('workItem.head.state', { state: here })"
        @update:model-value="move"
      >
        <template #option="{ option }">
          <FacetChoiceMark
            v-if="(option as Option).mark"
            :mark="(option as Option).mark!"
          />
          <SemanticState
            v-else-if="option.value === HERE"
            dimension="work-item-state"
            :state="standing"
            :label="here"
          />
          <span
            v-else
            class="card-state-action"
            >{{ option.label }}</span
          >
        </template>
        <template #value>
          <SemanticState
            dimension="work-item-state"
            :state="standing"
            :label="here"
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
          :state="standing"
          :label="here"
        />
      </span>
      <span
        v-if="started"
        class="card-started"
        data-mark="started"
        >{{ t('workItem.facts.started') }}</span
      >
      <VButton
        v-if="confirmable"
        class="card-confirm-close"
        size="compact"
        data-closing="confirm"
        @click="confirmClose"
        >{{ t('workItem.closeActions.action.confirm') }}</VButton
      >
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
</template>

<style scoped src="./InspectorFactRows.css"></style>

<style scoped>
/* A chip is as wide as what it names, not the row. */
.card-state {
  flex: 0 0 auto;
  max-width: 100%;
}

/* «Answer» speaks in the state chip's word beside it, trimmed to its letters as that word is,
   so the two stand on one baseline with the row's name. */
.card-question-word {
  font: var(--font-field-label);
}

/* The started mark is a word of the state's, quieter than the state. */
.card-started {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.card-state-action {
  font: var(--font-field-label);
}
</style>
