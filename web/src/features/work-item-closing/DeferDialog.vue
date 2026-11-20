<script setup lang="ts">
/**
 * «Put off»: when the work comes back, a day or the close of a card (`UntilChoice`), and why it
 * waits, which the server takes nothing without and the owner reads when the work comes back.
 *
 * «Put off» is not available until both are said, and not for a day already gone; the reason
 * stands under the fields, where the press would have been read. A refused write keeps the
 * window open with all that was chosen, its reason at the foot.
 */
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import UntilChoice, { untilProblem } from '@/entities/work-item/components/UntilChoice.vue'
import type { CardSearchScope } from '@/entities/work-item/composables/useCardSearch.ts'
import { writeFailure } from '@/entities/work-item/utils/writeFailure.ts'

import { localDay } from '@/shared/api/analyticsAddress.ts'
import { deferWorkItem } from '@/shared/api/planningClosingApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  item: WorkItem
  open: boolean
  /** Where a card to wait on is found. */
  scope: CardSearchScope
}>()
const emit = defineEmits<{ close: []; done: [] }>()
const { t } = useI18n()

const until = ref('')
const reason = ref('')
const busy = ref(false)
const error = ref('')
const today = ref(localDay(new Date()))
const hintId = useId()

// Each open starts from nothing chosen.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    until.value = ''
    reason.value = ''
    error.value = ''
    today.value = localDay(new Date())
  },
  { immediate: true },
)

/** Why it cannot be put off yet; empty once it can. */
const blocked = computed(() => {
  const problem = untilProblem(until.value, today.value)
  if (problem) return t(problem)
  return reason.value.trim() ? '' : t('workItem.closeActions.defer.reasonMissing')
})
/** The press names the hint that says why it is unavailable, and nothing while it is not. */
const describedBy = computed(() => (blocked.value ? hintId : undefined))

async function submit() {
  if (busy.value || blocked.value) return
  busy.value = true
  error.value = ''
  try {
    await deferWorkItem({
      id: props.item.reference,
      until: until.value,
      reason: reason.value.trim(),
    })
    emit('done')
  } catch (error_) {
    error.value = writeFailure(error_, t)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DialogFrame
    :open="open"
    :title="t('workItem.closeActions.defer.title')"
    :context="`${item.reference} · ${item.title}`"
    :close-label="t('workItem.closeActions.defer.keep')"
    :busy="busy"
    :error="error"
    @close="emit('close')"
    @submit="submit"
  >
    <div class="defer-fields">
      <UntilChoice
        v-model:value="until"
        layout="stack"
        :scope="scope"
        :today="today"
        :disabled="busy"
      />
      <VTextInput
        v-model="reason"
        class="defer-reason"
        :label="t('workItem.closeActions.defer.reason')"
        :maxlength="400"
        :disabled="busy"
      />
      <p
        v-if="blocked"
        :id="hintId"
        class="defer-blocked"
      >
        {{ blocked }}
      </p>
    </div>
    <template #footer>
      <VButton @click="emit('close')">{{ t('workItem.closeActions.defer.keep') }}</VButton>
      <VButton
        variant="primary"
        type="submit"
        :disabled="Boolean(blocked)"
        :aria-describedby="describedBy"
        >{{ t('workItem.closeActions.defer.submit') }}</VButton
      >
    </template>
  </DialogFrame>
</template>

<style scoped>
.defer-fields {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.defer-blocked {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
