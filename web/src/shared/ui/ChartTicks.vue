<script setup lang="ts">
/**
 * Labels set along one edge of a plot: the value scale's figures up its side, the periods'
 * names under it, the numbers of the changes over it. Each label stands at its share of the
 * edge, by its middle unless it says another point of it (`PlacedTick.edge`); along an edge a
 * label that would hang past either end is moved in by as much as it would hang, and no further,
 * so a period's name stays under its column wherever it fits there.
 *
 * Every label sits in one grid cell, because labels in one cell still give it the size of the
 * largest: the scale's column is as wide as its widest figure, the axis's row as tall as a name
 * with a note. Up a side a label is moved by its share of that cell; along an edge the edge is the
 * container a label is kept inside, so its place and its own width are read in one length.
 * Drawn for the eye; the chart's names and its table say the same in words.
 */
import type { PlacedTick } from '@/shared/ui/chartGeometry.ts'

const props = defineProps<{
  /** `block` stands the labels up a side from the baseline, `inline` along an edge. */
  along: 'block' | 'inline'
  ticks: readonly PlacedTick[]
}>()

function place(tick: PlacedTick) {
  return props.along === 'block'
    ? { insetBlockEnd: `${tick.offset * 100}%` }
    : { '--tick-at': tick.offset }
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
      :data-key="tick.key"
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

  /* The edge's length is what a label along it is placed by and kept inside. */
  &[data-along='inline'] {
    container-type: inline-size;
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

  /* The label's point (`--tick-point`, a share of its own width) at its share of the edge
     (`--tick-at`, which `place` writes), clamped so that neither of its ends passes the edge's: a label that fits stands exactly at
     its place, and one at an end moves in only by what would hang past it. */
  [data-along='inline'] > & {
    --tick-at: 0;
    --tick-point: 0.5;

    justify-items: center;
    justify-self: start;
    transform: translateX(
      clamp(0px, calc(var(--tick-at) * 100cqi - var(--tick-point) * 100%), calc(100cqi - 100%))
    );
  }

  [data-along='inline'] > &[data-edge='start'] {
    --tick-point: 0;

    justify-items: start;
  }

  [data-along='inline'] > &[data-edge='end'] {
    --tick-point: 1;

    justify-items: end;
  }
}

.chart-tick-note {
  color: var(--color-text-muted);
}
</style>
