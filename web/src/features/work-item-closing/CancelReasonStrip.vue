<script setup lang="ts">
/**
 * Work cancelled where its state is changed: the reason asked in place, and the question that
 * confirms it (`ReasonStrip`). The reason is the move's and the summary's `why`, so the history
 * and the report say why the card closed; the cancel waits for one. The caret starts in the field,
 * there to be typed in; Escape there, or «Cancel», keeps the task as it was.
 *
 * A refused cancel keeps the strip and the reason as they are, its reason under them. A goal or a
 * stage whose cancel is refused with the list of the work it closes goes on in the window that
 * shows the list (`list`), the reason given here kept there.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { cancelSummary } from '@/features/work-item-closing/cancelSummary.ts'

import { writeFailure } from '@/entities/work-item/utils/writeFailure.ts'

import { CancelListError } from '@/shared/api/planningApi.ts'
import { cancelWorkItem } from '@/shared/api/planningClosingApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import type { NamedState } from '@/shared/lib/stateNames.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import ReasonStrip from '@/shared/ui/ReasonStrip.vue'

const props = defineProps<{
  item: WorkItem
  /** The workflow's cancelled state: its key, and what `useStateName` names it by. */
  state: NamedState & { key: string }
}>()
const emit = defineEmits<{
  close: []
  done: []
  /** The server refused with the list of the work it would close: the host shows it. */
  list: [reason: string]
}>()
const { t } = useI18n()

/** The press names what it cancels: a goal or a stage by its kind, any other work as a task. */
const CONFIRM: Partial<Record<WorkItem['kind'], string>> = {
  goal: 'workItem.closeActions.cancelGoal.title',
  stage: 'workItem.closeActions.cancelGoal.titleStage',
}

const stateName = useStateName()
const busy = ref(false)
const failure = ref('')

async function confirm(why: string) {
  if (busy.value) return
  busy.value = true
  failure.value = ''
  try {
    await cancelWorkItem({
      id: props.item.reference,
      state: props.state.key,
      reason: why,
      summary: cancelSummary(props.item, why),
    })
    emit('done')
  } catch (error_) {
    if (error_ instanceof CancelListError) emit('list', why)
    else failure.value = writeFailure(error_, t)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ReasonStrip
    data-closing="cancel-task"
    tone="danger"
    :label="t('workItem.closeActions.cancelTask.reason')"
    :message="
      t('workItem.closeActions.cancelTask.question', {
        reference: item.reference,
        state: stateName(state),
      })
    "
    :missing="t('workItem.closeActions.cancelTask.reasonMissing')"
    :failure="failure"
    :busy="busy"
    :confirm-label="t(CONFIRM[item.kind] ?? 'workItem.closeActions.cancelTask.confirm')"
    :cancel-label="t('workItem.closeActions.cancelTask.keep')"
    @confirm="confirm"
    @cancel="emit('close')"
  />
</template>
