<script setup lang="ts">
/**
 * What a heading of a dimension's table holds (`SpendingTable`, whose cell it stands in): the
 * column's words, pressed to sort the rows by it, with the arrow of the way they run while they
 * are sorted by it (`mark`).
 *
 * Over the names of models it holds the room of each id the rows name, unseen and of no height
 * (`column.room`): a heading cell sets its column's least width by what it holds, where a row's
 * name, which takes what the figures leave, sets none. The column of names is then as wide as the
 * longest id, and no id is cut: cut, «claude-fable-5-1» and «claude-fable-5-2» both read
 * «claude-fa…».
 */
import { useI18n } from 'vue-i18n'

import type { SortMark } from '@/pages/analytics/composables/useTableSort.ts'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{
  column: {
    /** The words whose room the heading holds unseen: a model id each, or none. */
    room: readonly string[]
    text: string
  }
  /** How the heading says the rows are sorted by it; none while they are not. */
  mark?: SortMark
}>()
const emit = defineEmits<{ sort: [] }>()

const { t } = useI18n()
</script>

<template>
  <button
    v-tooltip.clipped="column.text"
    type="button"
    class="table-sort"
    :aria-description="t('analytics.panel.table.sortBy', { column: column.text })"
    @click="emit('sort')"
  >
    {{ column.text }}
    <VIcon
      v-if="mark"
      class="table-sort-icon"
      :name="mark.icon"
      :size="12"
    />
  </button>
  <span
    v-for="word in column.room"
    :key="word"
    class="column-room"
    aria-hidden="true"
    >{{ word }}</span
  >
</template>

<style scoped>
/* A heading that sorts: the heading's own words, pressed as a whole, with the way it runs. */
.table-sort {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: inherit;
  background: none;
  cursor: pointer;

  [data-numeric='true'] > & {
    justify-content: flex-end;
  }
}

/* The room of a word the column's cells hold, unseen and of no height, in the cells' own font:
   the heading is as wide as the longest, and so is its column. */
.column-room {
  display: block;
  block-size: 0;
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  visibility: hidden;
}
</style>
