<script setup lang="ts">
/**
 * What the answer that puts a question off opens in place: the day to come back to it, and the
 * press that puts it off to that day.
 *
 * Put off is not available until a day is chosen, and not for a day already gone; the reason
 * stands under it, where the press would have been read. The day is part of what the form holds,
 * so it stays while the question is open, and is said as unsent if the question closes some other
 * way.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { localDay } from '@/shared/api/analyticsAddress.ts'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** The write it started is out: the press keeps focus and takes no second press. */
  busy: boolean
  /** Nothing here can be written now. */
  disabled: boolean
  /** The id the answer that opened it names as what it controls. */
  panelId: string
  /** The day chosen, as the field holds it; empty while none is. */
  value: string
}>()
const emit = defineEmits<{ 'put-off': []; 'update:value': [value: string] }>()
const { t } = useI18n()
const reasonId = useId()
const root = ref<HTMLElement | null>(null)
/** The first day it can be put off to, as the calendar names it. */
const today = localDay(new Date())
/** Why it cannot be put off yet; empty once it can. */
const reason = computed(() => {
  if (!props.value) return t('requests.record.untilMissing')
  return props.value < today ? t('requests.record.untilPast') : ''
})
const busyMark = computed(() => props.busy || undefined)
const pressDisabled = computed(() => props.disabled || reason.value !== '')
const reasonRef = computed(() => (reason.value ? reasonId : undefined))

defineExpose({
  focus: () => root.value?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true }),
})
</script>

<template>
  <div
    :id="panelId"
    ref="root"
    class="request-later"
    role="group"
    :aria-label="t('requests.record.laterName')"
  >
    <VTextInput
      class="request-later-day"
      type="date"
      :label="t('requests.record.until')"
      :model-value="value"
      :min="today"
      :disabled="disabled || busy"
      @update:model-value="(day) => emit('update:value', String(day))"
    />
    <div class="request-later-press">
      <VButton
        variant="primary"
        :aria-describedby="reasonRef"
        :aria-disabled="busyMark"
        :disabled="pressDisabled"
        @click="emit('put-off')"
        >{{ t('requests.record.putOff') }}</VButton
      >
      <p
        v-if="reason"
        :id="reasonId"
        class="request-later-reason"
      >
        {{ reason }}
      </p>
    </div>
  </div>
</template>

<style scoped>
/* The day and the press on one line where they fit, the press under the day where they do not. */
.request-later {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: flex-end;
  min-width: 0;
}

/* As wide as a date of the widest figures needs beside the calendar's button, as in Analytics. */
.request-later-day {
  inline-size: 8.25rem;
}

.request-later-press {
  display: grid;
  gap: var(--space-1);
  justify-items: start;
  min-width: 0;
}

.request-later-reason {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
