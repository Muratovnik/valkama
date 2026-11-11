<script setup lang="ts">
/**
 * What changed at the start of a period, under a chart of periods (`PeriodColumns`): a line per
 * change, numbered as its line up the plot, with the period it stands on and its words. Each is
 * one line whatever it says, so a new answer with longer words moves nothing under the chart:
 * the words end in an ellipsis and their hint says them whole, the number and the period stay
 * whole before them, and the chart's table says them in full.
 */
import type { ChangeNote } from '@/shared/ui/chartGeometry.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

defineProps<{ notes: readonly ChangeNote[] }>()
</script>

<template>
  <ol class="period-notes">
    <li
      v-for="note in notes"
      :key="note.number"
      class="period-note"
    >
      <span class="period-note-number">{{ note.number }}</span>
      <span>{{ note.period }}</span>
      <span
        v-tooltip.clipped="note.text"
        class="period-note-text one-line"
        >{{ note.text }}</span
      >
    </li>
  </ol>
</template>

<style scoped>
.period-notes {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  list-style: none;
}

/* Only the words give way: the number and the period, unbroken, keep their whole width. */
.period-note {
  display: flex;
  gap: var(--space-2);
  min-width: 0;
  white-space: nowrap;
}

.period-note-number {
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
