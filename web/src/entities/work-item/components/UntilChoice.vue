<script lang="ts">
const DAY = /^\d{4}-\d{2}-\d{2}$/u
/** A count of new comments, alone or after a day and `or`, as the server reads it. */
const COUNTED = /^(?:(\d{4}-\d{2}-\d{2}) or )?(\S+) comments?$/u
/** The most new comments work can wait for, as the server holds it. */
const COMMENTS_MOST = 999

/** The card, the count of new comments and the day a value names; each empty where it names none. */
function parts(value: string): { card: string; count: string; day: string } {
  if (DAY.test(value)) return { card: '', count: '', day: value }
  const counted = COUNTED.exec(value)
  return counted
    ? { card: '', count: counted[2] ?? '', day: counted[1] ?? '' }
    : { card: value, count: '', day: '' }
}

/** A day, a count of new comments or both, as the server reads them: `2026-12-01 or 3 comments`. */
function joined(day: string, count: string): string {
  if (!count) return day
  const counted = count === '1' ? '1 comment' : `${count} comments`
  return day ? `${day} or ${counted}` : counted
}

/** Every reason `untilProblem` gives, as message keys, so that a room can be held for each. */
export const UNTIL_PROBLEMS = {
  none: 'requests.kinds.untilEither',
  count: 'requests.record.untilCount',
  past: 'requests.record.untilPast',
} as const

/**
 * Why work cannot be put off until `value` yet, as a message key; null once it can. Nothing is
 * chosen, the count is no whole number from 1 to 999, or the day chosen is gone: `today` is the
 * first day it can be put off to.
 */
export function untilProblem(value: string, today: string): string | null {
  if (!value) return UNTIL_PROBLEMS.none
  const { day, count } = parts(value)
  if (count && !(/^\d+$/u.test(count) && Number(count) >= 1 && Number(count) <= COMMENTS_MOST))
    return UNTIL_PROBLEMS.count
  return day && day < today ? UNTIL_PROBLEMS.past : null
}
</script>

<script setup lang="ts">
/**
 * When put-off work comes back: a day, a count of new comments, both — whichever comes first —
 * or the close of a card. A card's close stands alone, so choosing a card leaves no day and no
 * count, and choosing a day or a count leaves no card.
 *
 * The card is found by its number or the words of its title among the open cards of the space
 * (`useCardSearch`), and goes as its number, which the server reads as the card the work waits
 * on. The value is what the server reads as `until`: the day as the calendar names it,
 * `2026-12-01`; the count, `3 comments`; both, `2026-12-01 or 3 comments`; or the card's number;
 * empty while nothing is chosen. Every comment and reply written on the card after it is put off
 * counts. A question's «Later…» and a card's «Put off» both ask it here.
 *
 * With a day and a count both chosen, a line (`data-until="either"`) says the work comes back on
 * whichever comes first. It stands right under the day and the count it qualifies, before the
 * card, wherever the card does not stand beside them: stacked always, and on a line too narrow
 * for the three fields. On a line wide enough for the card beside them, it ends the fields across
 * their whole width, so the card does not move when it appears. Under a card that stands under
 * the day and the count, it read as a word about the card.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useCardSearch } from '@/entities/work-item/composables/useCardSearch.ts'
import type { CardSearchScope } from '@/entities/work-item/composables/useCardSearch.ts'

import SearchCombobox from '@/shared/ui/SearchCombobox.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  disabled: boolean
  /** `line`: the fields side by side where they fit; `stack`: each across its box. */
  layout: 'line' | 'stack'
  /** Where the card is found, and which card waits. */
  scope: CardSearchScope
  /** The first day it can be put off to, as the calendar names it. */
  today: string
  value: string
}>()
const emit = defineEmits<{ 'update:value': [value: string] }>()
const { t } = useI18n()

const chosen = computed(() => parts(props.value))
const cards = useCardSearch(() => props.scope)

function chooseDay(day: string) {
  emit('update:value', joined(day, chosen.value.count))
}

function chooseCount(count: string) {
  emit('update:value', joined(chosen.value.day, count.trim()))
}

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
      :model-value="chosen.day"
      :min="today"
      :disabled="disabled"
      @update:model-value="(day) => chooseDay(String(day))"
    />
    <VTextInput
      class="until-comments"
      type="number"
      inputmode="numeric"
      min="1"
      max="999"
      :label="t('requests.kinds.untilComments')"
      :model-value="chosen.count"
      :disabled="disabled"
      @update:model-value="(count) => chooseCount(String(count))"
    />
    <p
      v-if="chosen.day && chosen.count"
      class="until-either"
      data-until="either"
    >
      {{ t('requests.kinds.untilFirst') }}
    </p>
    <SearchCombobox
      class="until-card"
      :label="t('requests.kinds.untilCard')"
      :model-value="chosen.card"
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

/* On a line the card takes what the day and the count leave, and goes under them where they do
   not fit. Its width is what the line's order of the fields is decided by. */
.until.is-line {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  container: until-line / inline-size;
}

.until.is-stack {
  display: grid;
}

/* As wide as a date of the widest figures needs beside the calendar's button, as in Analytics. */
.is-line > .until-day {
  inline-size: 8.25rem;
}

/* As wide as its label: a count is three figures at most. */
.is-line > .until-comments {
  flex: 0 0 auto;
  inline-size: 9.5rem;
}

/* Wide enough for a number and the first words of a title, and no wider than the line. */
.is-line > .until-card {
  flex: 1 1 14rem;
  min-width: 0;
}

/* Right under the day and the count, before the card, across the fields' width. */
.until-either {
  flex: 1 0 100%;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* A line as wide as the day (8.25rem), the count (9.5rem), the card's least (14rem) and the two
   gaps between them (--space-3) holds the card beside them: there the line ends the fields, after
   the card, which it would otherwise push under itself. */
@container until-line (width >= calc(8.25rem + 9.5rem + 14rem + 2 * 12px)) {
  .until-either {
    order: 1;
  }
}
</style>
