<script setup lang="ts">
/**
 * Work cancelled where its state is changed: the reason asked in place, and the question that
 * confirms it (`ConfirmStrip`). The reason is the move's and the summary's `why`, so the history
 * and the report say why the card closed; the cancel waits for one. The caret starts in the field,
 * there to be typed in; Escape there, or «Cancel», keeps the task as it was.
 *
 * A refused cancel keeps the strip and the reason as they are, its reason under them. A goal or a
 * stage whose cancel is refused with the list of the work it closes goes on in the window that
 * shows the list (`list`), the reason given here kept there.
 */
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { cancelSummary } from '@/features/work-item-closing/cancelSummary.ts'
import { closingFailure } from '@/features/work-item-closing/closingFailure.ts'

import { CancelListError } from '@/shared/api/planningApi.ts'
import { cancelWorkItem } from '@/shared/api/planningClosingApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import type { NamedState } from '@/shared/lib/stateNames.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

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
const reason = ref('')
const busy = ref(false)
const failure = ref('')
/** A missing reason is said once the press asked for it, and only while it is still missing. */
const asked = ref(false)
const error = computed(() =>
  asked.value && !reason.value.trim()
    ? t('workItem.closeActions.cancelTask.reasonMissing')
    : failure.value,
)
const field = useTemplateRef<{ control: () => HTMLInputElement | null }>('field')

onMounted(() => field.value?.control()?.focus())

async function confirm() {
  if (busy.value) return
  if (!reason.value.trim()) {
    asked.value = true
    field.value?.control()?.focus()
    return
  }
  busy.value = true
  failure.value = ''
  try {
    const why = reason.value.trim()
    await cancelWorkItem({
      id: props.item.reference,
      state: props.state.key,
      reason: why,
      summary: cancelSummary(props.item, why),
    })
    emit('done')
  } catch (error_) {
    if (error_ instanceof CancelListError) emit('list', reason.value.trim())
    else failure.value = closingFailure(error_)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div
    class="cancel-strip"
    data-closing="cancel-task"
  >
    <VTextInput
      ref="field"
      v-model="reason"
      :label="t('workItem.closeActions.cancelTask.reason')"
      :rows="2"
      :maxlength="400"
      :disabled="busy"
      @keydown.esc.stop.prevent="emit('close')"
    />
    <ConfirmStrip
      tone="danger"
      :message="
        t('workItem.closeActions.cancelTask.question', {
          reference: item.reference,
          state: stateName(state),
        })
      "
      :confirm-label="t(CONFIRM[item.kind] ?? 'workItem.closeActions.cancelTask.confirm')"
      :cancel-label="t('workItem.closeActions.cancelTask.keep')"
      @confirm="confirm"
      @cancel="emit('close')"
    />
    <p
      v-if="error"
      class="cancel-strip-error"
      role="alert"
    >
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.cancel-strip {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.cancel-strip-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
