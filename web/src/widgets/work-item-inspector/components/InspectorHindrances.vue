<script setup lang="ts">
/**
 * What stops an item, at the top of Overview, before anything else on it: each open blocker as
 * «Ждёт MAIN-12» and its title, and work put off as «Отложено до 20 ноября» or «Отложено до
 * закрытия MAIN-12», with why it waits. A closed item is neither blocked nor waiting
 * (`openBlockers`), and the record names a put-off only while the item stands put off.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { openBlockers } from '@/widgets/work-item-inspector/utils/openBlockers.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'
import RichText from '@/shared/ui/RichText.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ item: WorkItem }>()

const { t, d } = useI18n()

const blockers = computed(() => openBlockers(props.item))
/** A blocker as the facet registry words a wait: «Ждёт MAIN-12», then what it is. */
const blockerTone = semanticStatePresentation({
  dimension: 'work-item-readiness',
  state: 'blocked',
}).tone

/** Until when it is put off, as the owner reads a day, or the card whose close it waits on. */
const deferral = computed(() => {
  const put = props.item.deferred
  if (!put || props.item.state?.category !== 'deferred') return null
  const until = put.until_item
    ? t('workItem.closeActions.deferred.card', { reference: put.until_item })
    : t('workItem.closeActions.deferred.day', { date: day(put.until ?? '') })
  const line = `${t('workItem.closeActions.deferred.label')} ${until}`
  return put.reason ? `${line} — ${put.reason}` : line
})

/**
 * A day put off until comes back at its midnight in UTC, so it is said as that day, wherever
 * the reader is; a time is said as the reader's own clock has it.
 */
function day(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  const midnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0
  return midnight
    ? d(date, { day: 'numeric', month: 'long', timeZone: 'UTC' })
    : d(date, 'activity')
}
</script>

<template>
  <ul
    v-if="blockers.length || deferral"
    class="blockers"
  >
    <li
      v-if="deferral"
      class="blocker"
      data-hindrance="deferred"
    >
      <VIcon
        class="blocker-glyph"
        name="pause"
        :size="14"
        :stroke-width="2"
      />
      <RichText
        class="blocker-text"
        :source="deferral"
        inline
      />
    </li>
    <li
      v-for="link in blockers"
      :key="link.reference"
      class="blocker"
    >
      <VIcon
        class="blocker-glyph"
        name="waiting"
        :data-tone="blockerTone"
        :size="14"
        :stroke-width="2"
      />
      <RichText
        class="blocker-text"
        :source="`${t('workItem.facet.waiting', { reference: link.reference })} — ${link.title}`"
        inline
      />
    </li>
  </ul>
</template>

<style scoped>
.blockers {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  list-style: none;
}

/* A wait reads as the facet does everywhere else: its glyph in the hue of a
   stop, then «Ждёт» and the reference, which opens the blocker. The glyph sits
   on the first line's baseline, as a letter would, and a long title wraps
   under the words rather than under the glyph. */
.blocker {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: baseline;
  color: var(--color-text);
  font: var(--font-line);
}

/* A glyph's baseline is its bottom edge; the margin sets it a little below the
   line's baseline, where a letter's descender would end. */
.blocker-glyph {
  margin-bottom: calc(-2 * var(--space-hair));
  color: var(--color-text-tertiary);

  &[data-tone='danger'] {
    color: var(--color-danger);
  }
}
</style>
