<script setup lang="ts">
/**
 * The figures of one section under its name on the rail: a line of words — the total and how it
 * moved, or the first value and its share — over a small chart, the overview's days
 * (`MiniTrend`) or a dimension's first shares (`MiniShareBar`).
 *
 * Every state takes the same box: the line is one line, cut with an ellipsis and whole in its
 * hint, and the chart's place is kept at its height while there is no chart to draw, so a tile
 * never moves its neighbours when its figures arrive, change or say they could not be read.
 * Words that name no real value, and the words of a state, are in the quiet ink.
 */
import { computed } from 'vue'

import type { RailTileModel } from '@/pages/analytics/composables/useRailTiles.ts'

import MiniShareBar from '@/shared/ui/MiniShareBar.vue'
import MiniTrend from '@/shared/ui/MiniTrend.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  /** The chart the tile draws, which sets the height kept for it in every state. */
  chart: 'shares' | 'trend'
  tile: RailTileModel
}>()

/** Whether the tile waits for figures: its first read, or the next while the last ones stay. */
const busy = computed(() =>
  props.tile.busy || props.tile.state === 'loading' ? 'true' : undefined,
)
</script>

<template>
  <span
    class="rail-tile"
    :data-state="tile.state"
    :aria-busy="busy"
  >
    <span class="rail-tile-line">
      <span
        v-tooltip.detail="{ text: tile.leadDetail, words: tile.lead }"
        class="rail-tile-lead one-line"
        :class="{ quiet: tile.quiet }"
        >{{ tile.lead }}</span
      >
      <span
        v-if="tile.aside"
        class="rail-tile-aside"
        >{{ tile.aside }}</span
      >
    </span>
    <span
      class="rail-tile-chart"
      :data-chart="chart"
    >
      <MiniTrend
        v-if="tile.trend"
        :label="tile.trend.label"
        :points="tile.trend.points"
      />
      <MiniShareBar
        v-else-if="tile.shares"
        v-tooltip.detail="tile.shares.label"
        :label="tile.shares.label"
        :parts="tile.shares.parts"
      />
    </span>
  </span>
</template>

<style scoped>
.rail-tile {
  display: grid;
  gap: var(--space-1);
  min-inline-size: 0;
}

/* One line whatever it says: the lead gives way, the aside keeps its words. */
.rail-tile-line {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  min-inline-size: 0;
  block-size: 1lh;
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
}

.rail-tile-lead {
  flex: 1 1 auto;
  min-inline-size: 0;
  color: var(--color-text);

  &.quiet {
    color: var(--color-text-tertiary);
  }
}

.rail-tile-aside {
  flex: none;
  color: var(--color-text-muted);
  white-space: nowrap;
}

/* The chart's place, kept at its height while there is nothing to draw in it. */
.rail-tile-chart {
  display: grid;
  align-content: end;
  min-inline-size: 0;

  &[data-chart='trend'] {
    block-size: var(--space-6);
  }

  &[data-chart='shares'] {
    block-size: var(--space-2);
  }
}
</style>
