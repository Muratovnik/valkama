<script setup lang="ts">
/**
 * Labels set along one edge of a plot: the value scale's figures up its side, the periods'
 * names under it, the numbers of the changes over it. Each label stands at its share of the
 * edge; along the time axis the first and the last keep inside it rather than hanging past.
 *
 * Every label sits in one grid cell and is moved by its share of that cell, because an offset
 * in percent reads the cell, and labels in one cell still give it the size of the largest: the
 * scale's column is as wide as its widest figure, the axis's row as tall as a name with a note.
 * Drawn for the eye; the chart's names and its table say the same in words.
 */
import type { PlacedTick } from '@/shared/ui/chartGeometry.ts'

const props = defineProps<{
  /** `block` stands the labels up a side from the baseline, `inline` along an edge. */
  along: 'block' | 'inline'
  ticks: readonly PlacedTick[]
}>()

function place(tick: PlacedTick) {
  const at = `${tick.offset * 100}%`
  return props.along === 'block' ? { insetBlockEnd: at } : { insetInlineStart: at }
}
</script>

<template>
  <div
    class="chart-ticks"
    aria-hidden="true"
    :data-along="along"
  >
    <span
      v-for="tick in ticks"
      :key="tick.key"
      class="chart-tick"
      :data-edge="tick.edge"
      :style="place(tick)"
    >
      <span>{{ tick.text }}</span>
      <span
        v-if="tick.note"
        class="chart-tick-note"
        >{{ tick.note }}</span
      >
    </span>
  </div>
</template>

<style scoped>
.chart-ticks {
  display: grid;
  min-width: 0;
  color: var(--color-text-tertiary);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;

  &[data-along='block'] {
    justify-items: end;
  }
}

.chart-tick {
  position: relative;
  display: grid;
  grid-area: 1 / 1;
  gap: var(--space-1);
  white-space: nowrap;

  [data-along='block'] > & {
    align-self: end;
    transform: translateY(50%);
  }

  [data-along='inline'] > & {
    justify-items: center;
    justify-self: start;
    transform: translateX(-50%);
  }

  [data-along='inline'] > &[data-edge='start'] {
    justify-items: start;
    transform: none;
  }

  [data-along='inline'] > &[data-edge='end'] {
    justify-items: end;
    transform: translateX(-100%);
  }
}

.chart-tick-note {
  color: var(--color-text-muted);
}
</style>
