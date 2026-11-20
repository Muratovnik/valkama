<script setup lang="ts">
/**
 * The lines «time to triage» of the window's list: one per space whose stack of work waiting
 * for a triage review has grown past the owner's thresholds, as the list's read carries them
 * (`triage_due`). Each says the space, how many of the stack's cards no review has marked, and
 * how long the oldest of them has waited, counted here from when it entered, since the read
 * carries no clock of the server.
 *
 * A line is no question: nothing answers it, it counts in no total, and focus never lands on it
 * after an answer. Its one action, «Show findings», asks for that space's board narrowed to the
 * cards the line counts (`open`, with the route), whatever scope the window was opened over: the
 * line's own space, by the ref of the source the read found it in. Each line carries its space's
 * key as `data-triage-due` and its words as `data-triage-due-words`, the hooks a check selects
 * them by.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { filterRouteState } from '@/entities/work-item/utils/workFilter.ts'

import type { InputRequestList } from '@/shared/api/inputRequestModel.ts'
import { planningSpaceRoute } from '@/shared/api/planningTarget.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { spanWords, spanWordsOf } from '@/shared/lib/timeSpan.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ lines: InputRequestList['triage_due'] }>()
const emit = defineEmits<{ open: [route: PlatformRoute] }>()
const { t } = useI18n()
/** The cards a line counts: those of the space's stack no review has marked. */
const AWAITING = filterRouteState({ text: '', triage: true })
const rows = computed(() => {
  // Counted when the read arrives: each read hands a new list, so the age follows the poll.
  const now = Date.now()
  return props.lines.map((line) => ({
    // Two stores may hold a space of one key; the source's ref tells them apart.
    id: JSON.stringify(line.space_ref),
    key: line.space.key,
    text: t('requests.hub.triageDue', {
      space: line.space.name,
      count: line.count,
      age: spanWords(Math.max(0, now - Date.parse(line.oldest_at)), spanWordsOf(t)),
    }),
    name: t('requests.hub.triageShowOf', { space: line.space.name }),
    route: { ...planningSpaceRoute(line.space_ref), state: { ...AWAITING } },
  }))
})
</script>

<template>
  <ul class="request-due">
    <li
      v-for="row in rows"
      :key="row.id"
      class="request-due-line"
      :data-triage-due="row.key"
    >
      <span
        class="request-due-words"
        data-triage-due-words
      >
        {{ row.text }}
      </span>
      <VButton
        variant="text"
        size="inline"
        :aria-label="row.name"
        @click="emit('open', row.route)"
      >
        {{ t('requests.hub.triageShow') }}
      </VButton>
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

/*
 * Set apart from the questions on a ground of its own, as a line of the window and no record.
 * The action follows the words and goes to a row of its own where they leave it no room.
 */
.request-due-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  justify-content: space-between;
  align-items: baseline;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  font: var(--font-label);
  background: var(--color-surface-muted);
  border-radius: var(--radius-control);
}

.request-due-words {
  flex: 1 1 16rem;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
