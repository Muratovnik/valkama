<script setup lang="ts">
/**
 * The lines «time to triage» of the window's list: one per space whose stack of work waiting
 * for a triage review has grown past the owner's thresholds, as the list's read carries them
 * (`triage_due`). Each says the space, how many of the stack's cards no review has marked, and
 * how long the oldest of them has waited, counted here from when it entered, since the read
 * carries no clock of the server.
 *
 * A line is no question: nothing answers it, it counts in no total, and it holds nothing focus
 * could land on after an answer. Each line carries its space's key as `data-triage-due`, the
 * hook a check selects it by.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { InputRequestList } from '@/shared/api/inputRequestModel.ts'
import { spanWords, spanWordsOf } from '@/shared/lib/timeSpan.ts'

const props = defineProps<{ lines: InputRequestList['triage_due'] }>()
const { t } = useI18n()
const rows = computed(() => {
  // Counted when the read arrives: each read hands a new list, so the age follows the poll.
  const now = Date.now()
  return props.lines.map((line) => ({
    key: line.space.key,
    text: t('requests.hub.triageDue', {
      space: line.space.name,
      count: line.count,
      age: spanWords(Math.max(0, now - Date.parse(line.oldest_at)), spanWordsOf(t)),
    }),
  }))
})
</script>

<template>
  <ul class="request-due">
    <li
      v-for="row in rows"
      :key="row.key"
      class="request-due-line"
      :data-triage-due="row.key"
    >
      {{ row.text }}
    </li>
  </ul>
</template>

<style scoped>
.request-due {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

/* Set apart from the questions on a ground of its own, as a line of the window and no record. */
.request-due-line {
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  font: var(--font-label);
  overflow-wrap: anywhere;
  background: var(--color-surface-muted);
  border-radius: var(--radius-control);
}
</style>
