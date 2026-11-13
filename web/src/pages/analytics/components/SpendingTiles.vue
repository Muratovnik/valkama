<script setup lang="ts">
/**
 * The period's three figures — agent time, tokens and the cost estimated at API prices — each
 * with how it moved from the period it is compared with, named by its days. They are also the
 * choice of what the charts below draw: one radio group, each tile a segment, the chosen one
 * pressed, and marked by a check beside its name as well as by its ground. The tokens say what
 * they count — what was processed anew, by kind — and the cache reads they leave apart. The
 * change and each note keep one line, so the three tiles stand one height at every width; a
 * tile's hint says it whole — its name, figure, change and notes — while any of them is cut,
 * and the tile's name says it all too.
 *
 * Beside each figure its measure stands step by step over the period the main chart draws — its
 * days, the hours of a single day, the minutes of the live hour — as a small trend
 * (`MiniTrend`) whose words say what it draws, as the rail's tile of the overview says its own.
 * It takes the place of the figure's line and keeps it with nothing to draw, so a new answer
 * changes the columns' heights and nothing around them.
 *
 * That the cost is an estimate and not a bill, and what the tokens count, the section's «ⓘ» says
 * (`useSectionCaveats`); tokens with no price are said in words under the cost, never folded into
 * a zero: a cost of nothing and a cost nobody knows are different.
 * A change is an arrow and words, never a colour alone. A period before with nothing in it says
 * so rather than inventing a percentage, a rise from a base too little for a share
 * (`risenFromLittle`) says what it rose from, and a figure absent on either side — no price, no
 * token counted — gives no change, with words that say which side has none.
 *
 * Under the change the tokens and the cost say what an hour of agent time took of them, beside
 * the period before's (`perHour`): «$17.9/h, was 8.1». The line's hint says what it is of, the
 * cost's as the estimate it is. A period that worked no time has no such figure, and a period
 * before that was not read or worked none gives no «was»; the line keeps its place either way,
 * so the tile's height is the same whatever the answer.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useOverviewWords } from '@/pages/analytics/composables/useOverviewWords.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { risenFromLittle } from '@/pages/analytics/utils/overviewFigures.ts'
import { perHour, tileFigures } from '@/pages/analytics/utils/panelAnswer.ts'
import { overviewFigures } from '@/pages/analytics/utils/railFigures.ts'
import { changeOf } from '@/pages/analytics/utils/usageFigures.ts'

import { MEASURES } from '@/shared/api/analyticsAddress.ts'
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage } from '@/shared/api/analyticsApi.ts'
import { sentences } from '@/shared/lib/sentences.ts'
import MiniTrend from '@/shared/ui/MiniTrend.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** When the answer was asked for, which says which step is not over yet. */
  readAt: Date
  /** The answer the figures are of: its total, its steps and the period before, if read. */
  usage: Usage
}>()
const measure = defineModel<Measure>('measure', { required: true })

const { t } = useI18n()
const words = useSpendingWords()
const overviewWords = useOverviewWords()

const figures = computed(() => tileFigures(props.usage))

/** The change of a measure, said against the days it is compared with; none when not read. */
function moved(value: Measure) {
  const { before, total } = figures.value
  if (!before) return { direction: 'unread', words: t('analytics.change.unread') }
  const change = changeOf(value, total, before.spent)
  const period = words.period(before.from, before.to)
  const steep = change.direction === 'up' && risenFromLittle(value, total, before.spent)
  return {
    direction: change.direction,
    words: steep
      ? overviewWords.risenFrom(value, before.spent, period)
      : words.change(value, change, period),
  }
}

/** What an hour of agent time took of a measure, in words; none of time, or without time. */
function rateOf(value: Measure) {
  if (value === 'time') return null
  const { before, total } = figures.value
  const rate = perHour(value, total, before?.spent ?? null)
  return rate ? words.perHour(value, rate) : null
}

const tiles = computed(() =>
  MEASURES.map((value) => {
    const { total } = figures.value
    const change = moved(value)
    const notes = {
      time: [],
      tokens: words.tokenKinds(props.usage.total.tokens),
      cost: [words.unpriced(total)].filter(Boolean),
    }[value]
    const label = words.measure(value)
    const figure = words.figure(value, total)
    const steps = overviewFigures(props.usage, value, props.readAt)
    const said = rateOf(value)
    // The line per hour as its hint takes it: what it is of, and its own words.
    const rate = said ? { text: said.detail, words: said.line } : null
    const rateWhole = said ? `${said.detail}: ${said.line}` : ''
    return {
      value,
      label,
      figure,
      trend: words.trend(value, steps, props.usage.period.step),
      change: change.words,
      direction: change.direction,
      rate,
      notes,
      whole: sentences([label, figure, change.words, rateWhole, ...notes]),
    }
  }),
)

const byValue = computed(() => new Map(tiles.value.map((tile) => [tile.value, tile])))
const tileOf = (value: Measure) => byValue.value.get(value)
</script>

<template>
  <SegmentedControl
    v-model="measure"
    class="spending-tiles"
    size="tile"
    :label="t('analytics.measures.label')"
    :options="tiles"
  >
    <template #option="{ option, chosen }">
      <span
        v-tooltip.clipped="tileOf(option.value)?.whole"
        class="tile-body"
      >
        <span class="tile-name">
          {{ option.label }}
          <VIcon
            v-if="chosen"
            class="tile-chosen"
            name="check"
            :size="14"
          />
        </span>
        <span class="tile-lead">
          <span
            class="tile-figure one-line"
            :data-measure="option.value"
            >{{ tileOf(option.value)?.figure }}</span
          >
          <span class="tile-trend">
            <MiniTrend
              v-if="tileOf(option.value)"
              :label="tileOf(option.value)?.trend.label ?? ''"
              :points="tileOf(option.value)?.trend.points ?? []"
            />
          </span>
        </span>
        <span
          class="tile-change one-line"
          :data-direction="tileOf(option.value)?.direction"
          >{{ tileOf(option.value)?.change }}</span
        >
        <span
          v-if="option.value !== 'time'"
          v-tooltip.detail="tileOf(option.value)?.rate"
          class="tile-rate one-line"
          >{{ tileOf(option.value)?.rate?.words }}</span
        >
        <span
          v-for="note in tileOf(option.value)?.notes"
          :key="note"
          class="tile-note one-line"
          >{{ note }}</span
        >
      </span>
    </template>
  </SegmentedControl>
</template>

<style scoped>
.spending-tiles {
  inline-size: 100%;
}

/* What a tile says, its whole box: the hint stands on all of it, whichever line is cut. */
.tile-body {
  display: grid;
  gap: var(--space-1);
  align-content: start;
  min-width: 0;
}

.tile-name {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

.tile-chosen {
  flex: none;
  color: var(--color-text);
}

/* The figure and its trend on one line: the figure as wide as itself, the trend after it at the
   tile's end, as wide as it may be up to its own measure and never so narrow it says nothing.
   A narrow tile takes its room from the trend alone: the figure does not shrink, so it is cut
   only where even the trend at its narrowest leaves it too little, which its largest width says.
   A share of the shrink however small, a third of a pixel of a hundred, cost the figure its last
   characters to the ellipsis. The trend is about as tall as the figure's line, and keeps its
   place with nothing to draw. */
.tile-lead {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: flex-end;
  min-width: 0;
}

.tile-trend {
  display: grid;
  flex: 0 100 8rem;
  min-inline-size: var(--space-12);
}

.tile-figure {
  flex: none;
  max-inline-size: calc(100% - var(--space-12) - var(--space-3));
  color: var(--color-text);
  font: var(--font-drawer-title);
  font-variant-numeric: tabular-nums;
}

.tile-change,
.tile-rate,
.tile-note {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* A line per hour keeps its place with nothing to say, so the tile keeps its height. */
.tile-rate {
  min-block-size: 1lh;
  font-variant-numeric: tabular-nums;
}

/* The change and each note keep one line, so the tiles stand one height at every width. */
.tile-note {
  min-width: 0;
  color: var(--color-text-tertiary);
}
</style>
