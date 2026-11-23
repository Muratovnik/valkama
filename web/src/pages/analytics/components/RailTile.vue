<script setup lang="ts">
/**
 * The figures of one section under its name on the rail: a line of words — the total and how it
 * moved, the first value and its share, or the account of the tightest window of the quota and
 * its share — over a small chart, the overview's days (`MiniTrend`), a dimension's first shares
 * (`MiniShareBar`) or that one window with its pace and its forecast (`WindowBar`).
 *
 * Every state takes the same box: the line is one line, cut with an ellipsis and whole in its
 * hint, and the chart's place is kept at its height while there is no chart to draw, so a tile
 * never moves its neighbours when its figures arrive, change or say they could not be read.
 * Words that name no real value, and the words of a state, are in the quiet ink. While a new view
 * is read, figures of the last one are dimmed until the tile's own answer lands
 * (`readPending.css`).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { RailTileModel } from '@/pages/analytics/composables/useRailTiles.ts'
import { useAnewDimmed, usePageStanding } from '@/pages/analytics/composables/useReadStanding.ts'
import { useReadWaitReport } from '@/pages/analytics/composables/useReadWaits.ts'

import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import MiniShareBar from '@/shared/ui/MiniShareBar.vue'
import MiniTrend from '@/shared/ui/MiniTrend.vue'
import { vTextRuns } from '@/shared/ui/textRuns.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import WindowBar from '@/shared/ui/WindowBar.vue'

const props = defineProps<{
  /** The chart the tile draws, which sets the height kept for it in every state. */
  chart: 'shares' | 'trend' | 'window'
  tile: RailTileModel
}>()

const { t } = useI18n()

/** Whether the tile waits for figures: its first read, or the next while the last ones stay. */
const busy = computed(() =>
  props.tile.busy || props.tile.state === 'loading' ? 'true' : undefined,
)

/**
 * The wait's words are shown once it has lasted and stay for the minimum after it, while the
 * tile keeps its place and paints nothing before that. The page says it once for all its waits
 * (`useReadWaits`), from the sign this reports.
 */
const { shown } = useLoadingPresence(() => props.tile.state === 'loading')
useReadWaitReport(shown)
const lead = computed(() => (shown.value ? t('platform.states.loading') : props.tile.lead))
const leadDetail = computed(() => (shown.value ? undefined : props.tile.leadDetail))
const leadRuns = computed(() => (shown.value ? undefined : props.tile.leadRuns))

/** Dimmed while its figures are the last view's and a new view is read. */
const pending = useAnewDimmed(usePageStanding(), () => props.tile.busy)
</script>

<template>
  <span
    class="rail-tile"
    :class="{ 'read-pending': pending }"
    :data-state="tile.state"
    :aria-busy="busy"
  >
    <span class="rail-tile-line">
      <span
        v-if="leadRuns"
        v-text-runs="leadRuns"
        v-tooltip.detail="{ text: leadDetail, words: lead }"
        class="rail-tile-lead one-line"
        :class="{ quiet: tile.quiet }"
      />
      <span
        v-else
        v-tooltip.detail="{ text: leadDetail, words: lead }"
        class="rail-tile-lead one-line"
        :class="{ quiet: tile.quiet || shown }"
        >{{ lead }}</span
      >
      <span
        v-if="tile.aside && !shown"
        class="rail-tile-aside"
        >{{ tile.aside }}</span
      >
    </span>
    <span
      class="rail-tile-chart"
      :data-chart="chart"
    >
      <MiniTrend
        v-if="tile.trend && !shown"
        :label="tile.trend.label"
        :points="tile.trend.points"
      />
      <MiniShareBar
        v-else-if="tile.shares && !shown"
        v-tooltip.detail="tile.shares.label"
        :label="tile.shares.label"
        :parts="tile.shares.parts"
      />
      <WindowBar
        v-else-if="tile.meter && !shown"
        v-tooltip.detail="tile.meter.label"
        :label="tile.meter.label"
        :used="tile.meter.used"
        :even="tile.meter.even"
        :forecast="tile.meter.forecast"
        compact
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

  /* A thin window and the pace tick that stands over and under it. */
  &[data-chart='window'] {
    block-size: var(--space-3);
  }
}
</style>

<style scoped src="@/pages/analytics/components/readPending.css"></style>
