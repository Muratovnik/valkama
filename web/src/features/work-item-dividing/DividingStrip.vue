<script setup lang="ts">
/**
 * A dividing write asked where it was chosen, in the band under the card's bar: converting a
 * task into a stage or a goal, converting a goal or a stage with nothing under it back into a
 * task, and moving work out of its goal, which asks its reason first (`ReasonStrip`).
 *
 * A task converts into the word its place gives, a stage under a goal and a goal without one,
 * and the question says what stays: everything it has. A held task's claims end and the work
 * they hold goes into a new task inside it; a task nobody holds drops its projects, since the
 * tasks inside carry them. A move out names the goal or stage it leaves and the triage state the
 * card goes to at the top level; the reason is the one that goal keeps, and nothing is sent
 * without it. A refused write keeps the question, its reason under it. Each strip carries
 * `data-dividing` with its action.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { writeFailure } from '@/entities/work-item/utils/writeFailure.ts'

import { convertWorkItem, moveWorkItemOut } from '@/shared/api/planningDividingApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import type { NamedState } from '@/shared/lib/stateNames.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'
import ReasonStrip from '@/shared/ui/ReasonStrip.vue'

const props = defineProps<{
  action: 'convert' | 'move-out' | 'to-task'
  item: WorkItem
  /** The triage state a move out lands in, when the workflow has one. */
  triage?: NamedState | null
}>()
const emit = defineEmits<{ close: []; done: [] }>()
const { t } = useI18n()
const stateName = useStateName()

const busy = ref(false)
const failure = ref('')
/** The word a task's place gives it, and what a goal or a stage was before it is a task. */
const word = computed(() => (props.item.parent_id ? 'stage' : 'goal'))
const container = computed(() => (props.item.kind === 'stage' ? 'stage' : 'goal'))
const held = computed(
  () => Boolean(props.item.claim_ref) || props.item.checklist.some((step) => step.claimed_by),
)

const question = computed(() => {
  const reference = props.item.reference
  if (props.action === 'to-task')
    return t(`workItem.dividing.toTask.${container.value}`, { reference })
  if (props.action === 'move-out') {
    const parent = props.item.parent ?? ''
    return props.triage
      ? t('workItem.dividing.moveOut.question', {
          reference,
          parent,
          state: stateName(props.triage),
        })
      : t('workItem.dividing.moveOut.questionPlain', { reference, parent })
  }
  const said = [t(`workItem.dividing.convert.${word.value}`, { reference })]
  if (held.value) said.push(t('workItem.dividing.convert.held'))
  else if (props.item.projects.length) said.push(t('workItem.dividing.convert.projects'))
  return said.join(' ')
})
/** The press names what the work becomes, as the menu's entry did. */
const BECOMES = { goal: 'toGoal', stage: 'toStage' } as const
const confirmLabel = computed(() =>
  props.action === 'to-task'
    ? t('workItem.dividing.toTask.confirm')
    : t(`workItem.dividing.action.${BECOMES[word.value]}`),
)
const missing = computed(() =>
  t('workItem.dividing.moveOut.reasonMissing', { parent: props.item.parent ?? '' }),
)

async function send(write: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  failure.value = ''
  try {
    await write()
    emit('done')
  } catch (error_) {
    failure.value = writeFailure(error_)
  } finally {
    busy.value = false
  }
}

const convert = () =>
  send(() =>
    convertWorkItem({
      id: props.item.reference,
      to: props.action === 'to-task' ? 'task' : word.value,
    }),
  )
const moveOut = (reason: string) =>
  send(() => moveWorkItemOut({ id: props.item.reference, reason }))
</script>

<template>
  <ReasonStrip
    v-if="action === 'move-out'"
    :data-dividing="action"
    :label="t('workItem.dividing.moveOut.reason')"
    :message="question"
    :missing="missing"
    :failure="failure"
    :busy="busy"
    :confirm-label="t('workItem.dividing.moveOut.confirm')"
    :cancel-label="t('workItem.dividing.moveOut.keep')"
    @confirm="moveOut"
    @cancel="emit('close')"
  />
  <div
    v-else
    class="dividing-strip"
    :data-dividing="action"
  >
    <ConfirmStrip
      :message="question"
      :confirm-label="confirmLabel"
      :cancel-label="t('workItem.dividing.convert.keep')"
      @confirm="convert"
      @cancel="emit('close')"
    />
    <p
      v-if="failure"
      class="dividing-strip-error"
      role="alert"
    >
      {{ failure }}
    </p>
  </div>
</template>

<style scoped>
.dividing-strip {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.dividing-strip-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
