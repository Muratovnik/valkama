<script setup lang="ts">
/**
 * What the answer that puts a question off opens in place: when to come back to it, a day or the
 * close of a card, and the press that puts it off.
 *
 * The question takes one condition, so the two are one choice: choosing a day leaves no card, and
 * choosing a card leaves no day. The card is found by its number or the words of its title among
 * the open cards of the question's space (`useCardSearch`), and goes as its number, which the
 * server reads as the card the work waits on.
 *
 * Put off is not available until a day or a card is chosen, and not for a day already gone; the
 * reason stands under it, where the press would have been read. What is chosen is part of what
 * the form holds, so it stays while the question is open, and is said as unsent if the question
 * closes some other way.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { useCardSearch } from '@/features/input-requests/composables/useCardSearch.ts'

import { localDay } from '@/shared/api/analyticsAddress.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** The write it started is out: the press keeps focus and takes no second press. */
  busy: boolean
  /** Nothing here can be written now. */
  disabled: boolean
  /** The question put off, in whose space the card is found. */
  entry: InputRequestEntry
  /** The id the answer that opened it names as what it controls. */
  panelId: string
  /** The day or the card's number chosen, as the field holds it; empty while none is. */
  value: string
  /** Why the answer that opened it cannot be sent now, which keeps the press unavailable too. */
  blocked?: string
}>()
const emit = defineEmits<{ 'put-off': []; 'update:value': [value: string] }>()
const { t } = useI18n()
const reasonId = useId()
const root = ref<HTMLElement | null>(null)
/** The first day it can be put off to, as the calendar names it. */
const today = localDay(new Date())
const DAY = /^\d{4}-\d{2}-\d{2}$/u
const day = computed(() => (DAY.test(props.value) ? props.value : ''))
const card = computed(() => (day.value ? '' : props.value))
const cards = useCardSearch(() => props.entry)
/** Why it cannot be put off yet; empty once it can. */
const reason = computed(() => {
  if (props.blocked) return props.blocked
  if (!props.value) return t('requests.kinds.untilEither')
  return day.value && day.value < today ? t('requests.record.untilPast') : ''
})
const busyMark = computed(() => props.busy || undefined)
const pressDisabled = computed(() => props.disabled || reason.value !== '')
const reasonRef = computed(() => (reason.value ? reasonId : undefined))
const fieldsDisabled = computed(() => props.disabled || props.busy)

function chooseCard(reference: string) {
  cards.choose(reference)
  emit('update:value', reference)
}

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
      :label="t('requests.kinds.untilDay')"
      :model-value="day"
      :min="today"
      :disabled="fieldsDisabled"
      @update:model-value="(chosen) => emit('update:value', String(chosen))"
    />
    <SearchCombobox
      class="request-later-card"
      :label="t('requests.kinds.untilCard')"
      :model-value="card"
      :options="cards.options.value"
      :empty-label="cards.emptyLabel.value"
      :placeholder="t('requests.kinds.cardHint')"
      :disabled="fieldsDisabled"
      @search="cards.search"
      @update:model-value="chooseCard"
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
/* The day, the card and the press on one line where they fit; the card takes what the day
   leaves, and the press goes under them where they do not fit. */
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

/* Wide enough for a number and the first words of a title, and no wider than the line. */
.request-later-card {
  flex: 1 1 14rem;
  min-width: 0;
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
