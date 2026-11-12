<script setup lang="ts">
/**
 * One column per period — a day or an hour — stacked by a few series, such as the accounts the
 * work ran under. The value axis starts at zero and names a few round steps; the time axis
 * names as many periods as it has room for, counted back from the last. A period still running
 * is hatched and says so under its name, so a short last column does not read as a drop; a
 * change at the start of a period (the account switched) is a numbered line up the plot, and
 * the note under the chart says what changed. A period compared with this one (`before`) stands
 * on the same scale as a short mark at its height over each column, an edge and not a hue, named
 * in the legend, and the readout says its figure in words. A series with no figure in a period
 * (`absent`, such as work with no price) draws nothing there, and the readout and the period's
 * name say so rather than a zero. A period whose figures are not in yet (`pending`) stands as a
 * hatched ground the plot's height, never a column of zero, and the readout and its name say it
 * has no data yet. `PeriodColumnsTable` is the same periods as a table.
 *
 * Series are told apart by the legend's words and by the hue `seriesSlots()` pinned to each
 * name, never by the hue alone; the line over the plot reads out the period under the pointer
 * or the keyboard, each series by name, and the last period when neither stands on one. That
 * readout is two lines high whatever it says (`usePeriodReadout`), and each note under the
 * chart one (`PeriodNotes`): a longer line ends in an ellipsis and is whole in its hint, in the
 * period's name and in the table, so pointing at a period, leaving it or a new answer moves
 * nothing on the page.
 *
 * Presentational: data and words come in, a press on a period (`actionable: 'column'`) or on
 * one series in it (`'segment'`) goes out as `select`. A
 * period that acts is named by what it does where the caller says (`action`), and what it holds
 * then describes it.
 * The periods are one stop for Tab (`useChartCursor`); the arrows move between them, and up
 * and down between the segments of one where segments act.
 *
 * A period that acts is never narrower than a pointer can hit. A span of such periods wider
 * than the chart scrolls sideways inside it, the scale staying in view, and opens on its last
 * periods, the ones nearest now; where nothing acts the periods share the width they are given.
 */
import { computed, ref, useId } from 'vue'

import { pressedLast } from '@/shared/lib/pressFocus.ts'
import type {
  PeriodChartProps,
  PeriodSelection,
  PlacedTick,
  StackedColumn,
} from '@/shared/ui/chartGeometry.ts'
import {
  changeMarkers,
  changeNotes,
  columnSummary,
  columnWidth,
  dayTicks,
  foldChanges,
  roundAxis,
  segmentPlace,
  segmentSummary,
  stackColumns,
} from '@/shared/ui/chartGeometry.ts'
import ChartLegend from '@/shared/ui/ChartLegend.vue'
import ChartTicks from '@/shared/ui/ChartTicks.vue'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import PeriodNotes from '@/shared/ui/PeriodNotes.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import { cellId, useChartCursor } from '@/shared/ui/useChartCursor.ts'
import { usePeriodReadout } from '@/shared/ui/usePeriodReadout.ts'
import { usePlotFrame } from '@/shared/ui/usePlotFrame.ts'

const props = withDefaults(defineProps<PeriodChartProps>(), {
  actionable: null,
  marks: () => [],
})

const emit = defineEmits<{ select: [selection: PeriodSelection] }>()

const axis = computed(() => props.valueAxis ?? roundAxis(props.formatValue))
const chart = computed(() => stackColumns(props.columns, props.series, props.marks, axis.value))
/** The name of the mark of a period compared with, where the chart draws one. */
const outline = computed(() =>
  props.columns.some((column) => column.before) ? props.words.before : undefined,
)
const empty = computed(() => !props.columns.length || !props.series.length)
const bySegment = computed(() => props.actionable === 'segment')

const acting = computed(() => props.actionable !== null)
const frame = ref<HTMLElement | null>(null)
const plot = ref<HTMLElement | null>(null)
const field = ref<HTMLElement | null>(null)
const { gutter, reveal, width } = usePlotFrame(
  frame,
  plot,
  field,
  () => `${props.columns.length}:${props.columns[0]?.key ?? ''}:${props.columns.at(-1)?.key ?? ''}`,
)

const scale = computed<PlacedTick[]>(() =>
  chart.value.steps.map((step) => ({
    key: step.value,
    text: step.text,
    offset: step.value / chart.value.top,
    edge: 'middle',
  })),
)
const days = computed(() => dayTicks(props.columns, width.value, props.words.incomplete))

const notes = computed(() => changeNotes(chart.value.columns))
const folded = computed(() => foldChanges(notes.value, props.words))
const markers = computed(() =>
  changeMarkers(notes.value, props.columns.length, folded.value === null),
)

const { focused, readout, isShown, point, hold } = usePeriodReadout(
  () => chart.value.columns,
  () => props.words,
  () => props.formatValue,
)

const { move, standOn, tabStop } = useChartCursor(
  () => chart.value.columns,
  () => bySegment.value,
  field,
)

const columnTag = computed(() => (props.actionable === 'column' ? 'button' : 'div'))
const segmentTag = computed(() => (bySegment.value ? 'button' : 'span'))

const ids = useId()
/** What a period holds, as words; the id of those words where they describe a named action. */
const summaryOf = (one: StackedColumn) => columnSummary(one, props.words, props.formatValue)
const summaryId = (one: StackedColumn, index: number) =>
  props.actionable === 'column' && one.column.action ? `${ids}-${index}` : undefined

/** A period's own element: a button where periods act, a named image where nothing does. */
function columnAttrs(one: StackedColumn, index: number) {
  const name = summaryOf(one)
  if (props.actionable === 'column')
    return {
      'type': 'button',
      'aria-label': one.column.action ?? name,
      'aria-describedby': summaryId(one, index),
      'tabindex': tabStop(index, null),
      'data-cell': cellId(index, null),
    }
  // Where segments act, each names itself and the period around them names nothing.
  if (bySegment.value) return {}
  return { 'role': 'img', 'aria-label': name }
}

/** Where a segment stands in its stack (`segmentPlace`); a layout, never a paint. */
function segmentStyle(one: StackedColumn, at: number) {
  const place = segmentPlace(one, at)
  return { insetBlockEnd: place.insetBlockEnd, blockSize: place.blockSize }
}

/** A segment's own element: a named button where segments act, a block of hue otherwise. */
function segmentAttrs(one: StackedColumn, index: number, at: number) {
  const segment = one.segments[at]
  if (!bySegment.value || !segment) return {}
  return {
    'type': 'button',
    'aria-label': segmentSummary(one, segment, props.words, props.formatValue),
    'tabindex': tabStop(index, at),
    'data-cell': cellId(index, at),
  }
}

/** A figure on the chart's scale: a stack's height, or the level a line stands at. */
const heightOf = (figure: number) => ({ blockSize: `${(figure / chart.value.top) * 100}%` })
const levelOf = (figure: number) => ({ insetBlockEnd: `${(figure / chart.value.top) * 100}%` })
const gridClass = (tick: number) => ({ 'period-baseline': tick === 0 })

/** Whether a press acts on what it lands on: a period (`at` null), or a segment of one. */
const acts = (at: number | null) => (at === null ? props.actionable === 'column' : bySegment.value)

function press(one: StackedColumn, at: number | null) {
  const series = at === null ? null : (one.segments[at]?.series.key ?? null)
  if (acts(at) && (at === null || series)) emit('select', { column: one.column.key, series })
}

/**
 * A period or segment that takes focus is stood on; one the keyboard reached is brought clear of
 * the scale too, while a press leaves the plot where the pointer found it.
 */
function focus(event: FocusEvent, index: number, at: number | null) {
  if (!acts(at)) return
  standOn(index, at)
  focused.value = index
  if (!pressedLast() && event.currentTarget instanceof HTMLElement) reveal(event.currentTarget)
}

function key(event: KeyboardEvent, at: number | null) {
  if (acts(at)) void move(event)
}
</script>

<template>
  <figure
    class="period-columns"
    :aria-label="label"
  >
    <DataEmptyState
      v-if="empty"
      :title="words.empty"
      :description="words.emptyDescription"
      compact
    />
    <template v-else>
      <ChartLegend
        v-if="series.length > 1 || outline"
        :series="series"
        :outline="outline"
      />
      <p
        v-tooltip.clipped="readout.whole"
        class="period-readout"
        aria-hidden="true"
        @pointerenter="hold(true)"
        @pointerleave="hold(false)"
      >
        <span class="one-line">{{ readout.head }}</span>
        <span class="one-line">{{ readout.series }}</span>
      </p>
      <div
        ref="frame"
        class="period-frame"
        :class="{ 'period-acting': acting }"
        :style="{ '--period-gutter': gutter }"
      >
        <div
          ref="plot"
          class="period-plot"
          :style="{
            '--period-count': columns.length,
            '--period-column': `${columnWidth(columns.length, width)}px`,
          }"
        >
          <span
            v-if="acting"
            class="period-gutter"
            aria-hidden="true"
          />
          <ChartTicks
            v-if="markers.length"
            class="period-markers"
            along="inline"
            :ticks="markers"
          />
          <ChartTicks
            class="period-scale"
            along="block"
            :ticks="scale"
          />
          <div
            ref="field"
            class="period-field"
          >
            <span
              v-for="tick in chart.ticks"
              :key="tick"
              class="period-grid"
              aria-hidden="true"
              :class="gridClass(tick)"
              :style="levelOf(tick)"
            />
            <div class="period-bars">
              <div
                v-for="(one, index) in chart.columns"
                :key="one.column.key"
                class="period-slot"
                :data-key="one.column.key"
                :data-shown="isShown(index)"
                @pointerenter="point(index)"
                @pointerleave="point(null)"
              >
                <span
                  v-if="one.column.pending"
                  class="period-pending"
                  aria-hidden="true"
                />
                <component
                  :is="columnTag"
                  class="period-column"
                  v-bind="columnAttrs(one, index)"
                  @click="press(one, null)"
                  @focus="(event: FocusEvent) => focus(event, index, null)"
                  @blur="focused = null"
                  @keydown="(event: KeyboardEvent) => key(event, null)"
                >
                  <span
                    v-if="summaryId(one, index)"
                    :id="summaryId(one, index)"
                    class="visually-hidden"
                    >{{ summaryOf(one) }}</span
                  >
                  <span
                    class="period-stack"
                    :class="{ 'period-incomplete': one.column.incomplete }"
                    :style="heightOf(one.total)"
                  >
                    <component
                      :is="segmentTag"
                      v-for="(segment, at) in one.segments"
                      :key="segment.series.key"
                      class="period-segment series-fill"
                      :data-slot="segment.series.slot"
                      :data-series="segment.series.key"
                      :style="segmentStyle(one, at)"
                      v-bind="segmentAttrs(one, index, at)"
                      @click="press(one, at)"
                      @focus="(event: FocusEvent) => focus(event, index, at)"
                      @blur="focused = null"
                      @keydown="(event: KeyboardEvent) => key(event, at)"
                    />
                  </span>
                </component>
                <span
                  v-if="one.column.before"
                  class="period-before"
                  aria-hidden="true"
                  :style="levelOf(one.column.before ?? 0)"
                />
                <span
                  v-if="one.marks.length"
                  class="period-mark"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>
          <ChartTicks
            class="period-axis"
            along="inline"
            :ticks="days"
          />
        </div>
      </div>
      <PeriodNotes
        v-if="notes.length"
        :notes="notes"
        :folded="folded"
      />
    </template>
  </figure>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped src="@/shared/ui/periodPlot.css"></style>

<style scoped>
.period-columns {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
}

.period-field {
  position: relative;
  grid-area: field;
  block-size: 160px;
}

.period-bars {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(var(--period-count), minmax(0, 1fr));
  column-gap: var(--space-half);
}

.period-slot {
  position: relative;
  display: flex;
  min-width: 0;

  /* The period the keyboard stands on keeps its whole focus ring over the scale's ground. */
  &:focus-within {
    z-index: 3;
  }
}

/* The whole height of its period is what a pointer presses, never only the painted part. A
   period that acts is a line of the chart, not a control standing in it. */
.period-column {
  display: flex;
  flex: 1;
  justify-content: center;
  align-items: flex-end;
  min-width: 0;
  min-block-size: 0;
  padding: 0;
  border: 0;
  background: none;
  border-radius: var(--radius-status);

  &[type='button'] {
    cursor: pointer;
  }
}

/* The period under the pointer or the keyboard lifts, and the readout says what it holds. */
.period-stack {
  position: relative;
  inline-size: min(100%, var(--period-column));

  .period-slot[data-shown='true'] & {
    filter: brightness(1.2);
  }
}

/* Each series a block of its own hue, a 2px gap of ground between them; the top of the stack
   is rounded and its foot square on the baseline. */
.period-segment {
  position: absolute;
  inset-inline: 0;
  display: block;
  min-block-size: 0;
  padding: 0;
  border: 0;

  &:last-child {
    border-start-start-radius: calc(var(--radius-status) - var(--space-half));
    border-start-end-radius: calc(var(--radius-status) - var(--space-half));
  }

  &[type='button'] {
    cursor: pointer;
  }

  /* A period still running, hatched in its own hues: what it holds so far, not a drop. */
  .period-incomplete > & {
    mask-image: repeating-linear-gradient(
      135deg,
      black 0 var(--space-half),
      rgb(0 0 0 / 40%) var(--space-half) var(--space-1)
    );
  }
}
</style>
