<script lang="ts">
const DAY = /^\d{4}-\d{2}-\d{2}$/u

/**
 * Why work cannot be put off until `value` yet, as a message key; null once it can. Nothing is
 * chosen, or the day chosen is gone: `today` is the first day it can be put off to.
 */
export function untilProblem(value: string, today: string): string | null {
  if (!value) return 'requests.kinds.untilEither'
  return DAY.test(value) && value < today ? 'requests.record.untilPast' : null
}
</script>

<script setup lang="ts">
/**
 * When put-off work comes back: a day, or the close of a card. Work waits on one condition, so
 * the two are one choice: choosing a day leaves no card, and choosing a card leaves no day.
 *
 * The card is found by its number or the words of its title among the open cards of the space
 * (`useCardSearch`), and goes as its number, which the server reads as the card the work waits
 * on. The value is the day as the calendar names it, `2026-12-01`, or the card's number; empty
 * while neither is chosen. A question's «Later…» and a card's «Put off» both ask it here.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useCardSearch } from '@/entities/work-item/composables/useCardSearch.ts'
import type { CardSearchScope } from '@/entities/work-item/composables/useCardSearch.ts'

import SearchCombobox from '@/shared/ui/SearchCombobox.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  disabled: boolean
  /** `line`: the day and the card side by side where they fit; `stack`: each across its box. */
  layout: 'line' | 'stack'
  /** Where the card is found, and which card waits. */
  scope: CardSearchScope
  /** The first day it can be put off to, as the calendar names it. */
  today: string
  value: string
}>()
const emit = defineEmits<{ 'update:value': [value: string] }>()
const { t } = useI18n()

const day = computed(() => (DAY.test(props.value) ? props.value : ''))
const card = computed(() => (day.value ? '' : props.value))
const cards = useCardSearch(() => props.scope)

function chooseCard(reference: string) {
  cards.choose(reference)
  emit('update:value', reference)
}
</script>

<template>
  <div
    class="until"
    :class="`is-${layout}`"
  >
    <VTextInput
      class="until-day"
      type="date"
      :label="t('requests.kinds.untilDay')"
      :model-value="day"
      :min="today"
      :disabled="disabled"
      @update:model-value="(chosen) => emit('update:value', String(chosen))"
    />
    <SearchCombobox
      class="until-card"
      :label="t('requests.kinds.untilCard')"
      :model-value="card"
      :options="cards.options.value"
      :empty-label="cards.emptyLabel.value"
      :placeholder="t('requests.kinds.cardHint')"
      :disabled="disabled"
      @search="cards.search"
      @update:model-value="chooseCard"
    />
  </div>
</template>

<style scoped>
.until {
  gap: var(--space-2) var(--space-3);
  min-width: 0;
}

/* On a line the card takes what the day leaves, and goes under it where both do not fit. */
.until.is-line {
  display: flex;
  flex: 1 1 22rem;
  flex-wrap: wrap;
  align-items: flex-end;
}

.until.is-stack {
  display: grid;
}

/* As wide as a date of the widest figures needs beside the calendar's button, as in Analytics. */
.is-line > .until-day {
  inline-size: 8.25rem;
}

/* Wide enough for a number and the first words of a title, and no wider than the line. */
.is-line > .until-card {
  flex: 1 1 14rem;
  min-width: 0;
}
</style>
