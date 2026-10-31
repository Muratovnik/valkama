<script setup lang="ts">
/**
 * The two writes that change what an item is — who holds it and what state it
 * is in — and the questions and refusals that come with them.
 *
 * Release is this client's act on its own claim; the server refuses it on
 * anyone else's, and used to answer every press of the button with that same
 * refusal. Another holder's claim is offered as a takeover instead, asked once
 * in place before the override is sent.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorRefusal from '@/widgets/work-item-inspector/components/InspectorRefusal.vue'
import type { RefusalNotice } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'

import type { PlanningWorkflow, WorkItem } from '@/shared/api/planningModel.ts'
import { isWebAuthor } from '@/shared/api/webAuthor.ts'
import { actorName } from '@/shared/lib/actor.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  busy: boolean
  error: string
  item: WorkItem
  notice: RefusalNotice | null
  workflow: PlanningWorkflow | null
}>()

const emit = defineEmits<{
  'claim': []
  'dismiss': []
  'force': []
  'guard': [name: string]
  'move': [stateKey: string]
  'release': []
  'take-over': []
}>()

const { t } = useI18n()
const askingTakeover = ref(false)

/** The states this item may move to, which is the workflow's answer, not a list. */
const nextStates = computed<ChoiceOption[]>(() => {
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

const claimAction = computed<'claim' | 'release' | 'takeover' | null>(() => {
  if (props.item.state.is_terminal) return null
  if (!props.item.claim_ref) return 'claim'
  return isWebAuthor(props.item.claim_ref) ? 'release' : 'takeover'
})
const takeoverDisabled = computed(() => props.busy || askingTakeover.value)
const choiceDisabled = computed(() => props.busy || !nextStates.value.length)
const takeoverQuestion = computed(() =>
  t('workItem.takeOverQuestion', { holder: actorName(props.item.claim_ref) }),
)

// An action select, not a value: the model stays empty, so the same state can
// be chosen again after the server refused it.
const stateChoice = computed({
  get: () => '',
  set: (value: string) => {
    if (value) emit('move', value)
  },
})

function takeOver() {
  askingTakeover.value = false
  emit('take-over')
}
</script>

<template>
  <div class="head-actions">
    <VButton
      v-if="claimAction === 'release'"
      :disabled="busy"
      @click="emit('release')"
    >
      {{ t('workItem.release') }}
    </VButton>
    <VButton
      v-else-if="claimAction === 'takeover'"
      :disabled="takeoverDisabled"
      @click="askingTakeover = true"
    >
      {{ t('workItem.takeOver') }}
    </VButton>
    <VButton
      v-else-if="claimAction === 'claim'"
      variant="primary"
      :disabled="busy"
      @click="emit('claim')"
    >
      {{ t('workItem.claim') }}
    </VButton>
    <ChoiceSelect
      v-model="stateChoice"
      class="state-choice"
      :label="t('workItem.moveTo')"
      :placeholder="t('workItem.moveTo')"
      :options="nextStates"
      :disabled="choiceDisabled"
    />
  </div>
  <ConfirmStrip
    v-if="askingTakeover"
    :message="takeoverQuestion"
    :confirm-label="t('workItem.takeOverConfirm')"
    :cancel-label="t('workItem.cancel')"
    @confirm="takeOver"
    @cancel="askingTakeover = false"
  />
  <InspectorRefusal
    v-if="notice"
    :notice="notice"
    :busy="busy"
    @dismiss="emit('dismiss')"
    @force="emit('force')"
    @guard="(name) => emit('guard', name)"
  />
  <p
    v-if="error"
    class="head-error"
    role="alert"
  >
    {{ error }}
  </p>
</template>

<style scoped>
.head-actions {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: end;
  min-width: 0;
}

.state-choice {
  flex: 1 1 auto;
  min-width: 0;
}

.head-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
