<script setup lang="ts">
/**
 * One column per period — a day or an hour — stacked by a few series, such as the accounts the
 * work ran under. The value axis starts at zero and names a few round steps; the time axis
 * names as many periods as it has room for, counted back from the last. A period still running
 * is hatched, so a short last column does not read as a drop; a change at the start of a period
 * (the account switched) is a line up the plot in the gap before it, and the period's hint, name
 * and table row say what changed: no row of the chart is kept for it, above the plot or under it.
 * A period compared with this one (`before`) stands on the same scale as a short mark at its
 * height over each column, an edge and not a hue, named in the legend, and the period's hint says
 * its figure. A series with no figure in a period (`absent`, such as work with no price) draws
 * nothing there, and the hint and the period's name say so rather than a zero. A period whose
 * figures are not in yet (`pending`) stands as a hatched ground the plot's height, never a column
 * of zero, and its hint and name say it has no data yet. `PeriodColumnsTable` is the same periods
 * as a table.
 *
 * Series are told apart by the legend's words and by the hue `seriesSlots()` pinned to each
 * name, never by the hue alone. No line stands over the plot: every mark — a period, a segment,
 * a legend entry — says what it holds in its own hint at the mark (`markHints.ts`), under the
 * pointer or the keyboard, and the hint lies over the page, so pointing moves nothing. The time
 * axis keeps its names apart, measured in the axis's own font (`dayTicks`).
 *
 * Presentational: data and words come in, a press goes out as what its mark is. A period that
 * names its `action` is a button sent out as `period` with its key; a segment or legend entry of
 * a series that acts (`MarkAction`) as `series` with the series' key, or as `follow` with the
 * press where the series leads somewhere (`href`). A press lands on what it lands on: on a
 * segment it is the segment's, above the stack the period's. The rest only show.
 * Every period is a place for the keyboard, one stop for Tab (`useChartCursor`); the arrows move
 * between periods, and up and down between a period and its segments that act.
 *
 * A period is never narrower than a pointer can hit, and no wider than that forces a span to be:
 * one that fits the chart at that width never scrolls. A span wider than the chart scrolls
 * sideways inside it, the scale staying in view, opens on its first periods and fades toward an
 * edge past which periods are hidden. The plot's x scale is one share of its width per period,
 * from the field's start (`field`, `--period-count`).
 *
 * A chart that `frames` takes a span of its periods as well as one: a frame dragged along the
 * plot with a mouse or a pen, or stretched from the period the keyboard stands on with Shift and
 * an arrow, covers whole periods (`usePeriodFrame`), and goes out as `span` with the keys of its
 * first and last period once the pointer or Shift lets it go. A press that does not drag stays
 * the press of what it landed on, and Escape lets a frame go.
 */
import { computed, ref } from 'vue'

import { useEventListener } from '@vueuse/core'

import { pressedLast } from '@/shared/lib/pressFocus.ts'
import { drawnWidth } from '@/shared/lib/textWidth.ts'
import type {
  PeriodChartProps,
  PeriodSeries,
  PlacedTick,
  StackedColumn,
  StackSegment,
} from '@/shared/ui/chartGeometry.ts'
import {
  columnSummary,
  columnWidth,
  dayTicks,
  markActs,
  markTag,
  markType,
  roundAxis,
  segmentPlace,
  segmentSummary,
  stackColumns,
} from '@/shared/ui/chartGeometry.ts'
import ChartLegend from '@/shared/ui/ChartLegend.vue'
import ChartTicks from '@/shared/ui/ChartTicks.vue'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import { periodHint, segmentHint, seriesHint } from '@/shared/ui/markHints.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import { FRAME_KEYS } from '@/shared/ui/useAxisFrame.ts'
import { cellId, useChartCursor } from '@/shared/ui/useChartCursor.ts'
import { usePeriodFrame } from '@/shared/ui/usePeriodFrame.ts'
import { usePlotFrame } from '@/shared/ui/usePlotFrame.ts'

const props = withDefaults(
  defineProps<
    PeriodChartProps & {
      /** Whether a frame along the plot takes a span of its periods (`span`). */
      frames?: boolean
    }
  >(),
  { formatShare: undefined, marks: () => [], frames: false },
)

const emit = defineEmits<{
  follow: [series: string, press: MouseEvent]
  period: [key: string]
  series: [key: string]
  /** A span of periods framed: the keys of its first and its last, in the order of time. */
  span: [first: string, last: string]
}>()

const axis = computed(() => props.valueAxis ?? roundAxis(props.formatValue))
const chart = computed(() => stackColumns(props.columns, props.series, props.marks, axis.value))
/** The name of the mark of a period compared with, where the chart draws one. */
const outline = computed(() =>
  props.columns.some((column) => column.before) ? props.words.before : undefined,
)
const empty = computed(() => !props.columns.length || !props.series.length)

/** Whether anything in the chart acts, which gives its periods their least width. */
const acting = computed(
  () => props.columns.some((column) => column.action) || props.series.some((one) => markActs(one)),
)
const frame = ref<HTMLElement | null>(null)
const plot = ref<HTMLElement | null>(null)
const field = ref<HTMLElement | null>(null)
const { gutter, hidden, reveal, width } = usePlotFrame(
  frame,
  plot,
  field,
  () => `${props.columns.length}:${props.columns[0]?.key ?? ''}:${props.columns.at(-1)?.key ?? ''}`,
)

/**
 * The edges of the frame periods are hidden past, as attributes its fade is drawn by: one stands
 * only where periods are hidden, because the style asks whether it is there, not what it says.
 */
const hiddenEdges = computed(() => ({
  'data-hidden-start': hidden.value.start ? '' : undefined,
  'data-hidden-end': hidden.value.end ? '' : undefined,
}))

const scale = computed<PlacedTick[]>(() =>
  chart.value.steps.map((step) => ({
    key: step.value,
    text: step.text,
    offset: step.value / chart.value.top,
    edge: 'middle',
  })),
)
/**
 * The product's fonts can arrive after the axis was laid out, and its names were then measured in
 * a fallback: each arrival measures them again.
 */
const fontsArrived = ref(0)
useEventListener(
  () => (typeof document === 'undefined' ? undefined : document.fonts),
  'loadingdone',
  () => (fontsArrived.value += 1),
)

/** The names of the time axis, each measured in the axis's font (`ChartTicks`, `--font-count`). */
const days = computed(() => {
  void fontsArrived.value
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-count').trim()
  const measure = (text: string) => drawnWidth(text, font)
  return dayTicks(props.columns, width.value, props.words.incomplete, measure)
})

const segmentActs = (segment: StackSegment) => markActs(segment.series)
const { move, standOn, tabStop } = useChartCursor(() => chart.value.columns, segmentActs, field)

/** A span of periods, by their places, sent out by their keys. */
function sendSpan(first: number, last: number) {
  const [from, to] = [chart.value.columns[first], chart.value.columns[last]]
  if (from && to) emit('span', from.column.key, to.column.key)
}

const { framed, release, stretch } = usePeriodFrame({
  count: () => chart.value.columns.length,
  done: sendSpan,
  field,
  frames: () => props.frames,
  standOn,
})
const framedStyle = (span: { first: number; last: number }) => ({
  gridColumn: `${span.first + 1} / ${span.last + 2}`,
})

/** A key on a period or a segment of it: a frame stretched, or a move as the chart makes one. */
function press(event: KeyboardEvent, index: number) {
  if (!stretch(event, index)) void move(event)
}

/** What each legend entry says in its hint: its series over the span, and its share. */
const legendHints = computed(() => {
  const hints = new Map(
    props.series.map((one) => [
      one.key,
      seriesHint(one.key, chart.value.columns, props.formatValue, props.formatShare),
    ]),
  )
  const before = props.columns.reduce((sum, column) => sum + (column.before ?? 0), 0)
  if (outline.value) hints.set('outline', props.formatValue(before))
  return hints
})

/** A period that acts is a button; one that only shows is a picture of what it holds. */
const periodTag = (one: StackedColumn) => (one.column.action ? 'button' : 'div')

function columnAttrs(one: StackedColumn, index: number) {
  const acts = Boolean(one.column.action)
  return {
    'type': acts ? 'button' : undefined,
    'role': acts ? undefined : 'img',
    'aria-label': one.column.action ?? columnSummary(one, props.words, props.formatValue),
    'tabindex': tabStop(index, null),
    'data-cell': cellId(index, null),
    'aria-keyshortcuts': props.frames ? FRAME_KEYS : undefined,
  }
}

/** Where a segment stands in its stack (`segmentPlace`); a layout, never a paint. */
function segmentStyle(one: StackedColumn, at: number) {
  const place = segmentPlace(one, at)
  return { insetBlockEnd: place.insetBlockEnd, blockSize: place.blockSize }
}

/** A segment's own element: a link or button of its series where that acts, else a hue only. */
function segmentAttrs(one: StackedColumn, index: number, at: number) {
  const segment = one.segments[at]
  if (!segment || !markActs(segment.series)) return { 'aria-hidden': 'true' }
  const name = segmentSummary(one, segment, props.words, props.formatValue)
  return {
    'href': segment.series.href,
    'type': markType(segment.series),
    'aria-label': segment.series.action ?? name,
    'tabindex': tabStop(index, at),
    'data-cell': cellId(index, at),
  }
}

/** A figure on the chart's scale: a stack's height, or the level a line stands at. */
const heightOf = (figure: number) => ({ blockSize: `${(figure / chart.value.top) * 100}%` })
const levelOf = (figure: number) => ({ insetBlockEnd: `${(figure / chart.value.top) * 100}%` })
const gridClass = (tick: number) => ({ 'period-baseline': tick === 0 })

function pressPeriod(one: StackedColumn) {
  if (one.column.action) emit('period', one.column.key)
}

/** A series pressed, on its segment or its legend entry: followed where it leads, else opened. */
function pressSeries(series: PeriodSeries, event: MouseEvent) {
  if (series.href) emit('follow', series.key, event)
  else if (series.actionable) emit('series', series.key)
}

/** A middle press on a series' link opens it elsewhere, and is a press on it all the same. */
function pressSeriesAside(series: PeriodSeries, event: MouseEvent) {
  if (series.href && event.button === 1) emit('follow', series.key, event)
}

/**
 * A period or segment that takes focus is stood on; one the keyboard reached is brought clear of
 * the scale too, while a press leaves the plot where the pointer found it.
 */
function focus(event: FocusEvent, index: number, at: number | null) {
  standOn(index, at)
  if (!pressedLast() && event.currentTarget instanceof HTMLElement) reveal(event.currentTarget)
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
        :hints="legendHints"
        @follow="(key, event) => emit('follow', key, event)"
        @select="(key) => emit('series', key)"
      />
      <div
        ref="frame"
        class="period-frame"
        :class="{ 'period-acting': acting }"
        :style="{ '--period-gutter': gutter }"
        v-bind="hiddenEdges"
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
              >
                <span
                  v-if="one.column.pending"
                  class="period-pending"
                  aria-hidden="true"
                />
                <component
                  :is="periodTag(one)"
                  v-tooltip.detail="periodHint(one, words, formatValue)"
                  class="period-column"
                  v-bind="columnAttrs(one, index)"
                  @click="pressPeriod(one)"
                  @focus="(event: FocusEvent) => focus(event, index, null)"
                  @keydown="(event: KeyboardEvent) => press(event, index)"
                  @keyup="release"
                />
                <span
                  class="period-stack"
                  :class="{ 'period-incomplete': one.column.incomplete }"
                  :style="heightOf(one.total)"
                >
                  <component
                    :is="markTag(segment.series, 'span')"
                    v-for="(segment, at) in one.segments"
                    :key="segment.series.key"
                    v-tooltip.detail="segmentHint(one, segment, props)"
                    class="period-segment series-fill"
                    :data-slot="segment.series.slot"
                    :data-series="segment.series.key"
                    :style="segmentStyle(one, at)"
                    v-bind="segmentAttrs(one, index, at)"
                    @click="(event: MouseEvent) => pressSeries(segment.series, event)"
                    @auxclick="(event: MouseEvent) => pressSeriesAside(segment.series, event)"
                    @focus="(event: FocusEvent) => focus(event, index, at)"
                    @keydown="(event: KeyboardEvent) => press(event, index)"
                    @keyup="release"
                  />
                </span>
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
            <div
              v-if="framed"
              class="period-spans"
              aria-hidden="true"
            >
              <span
                class="axis-frame"
                :style="framedStyle(framed)"
              />
            </div>
          </div>
          <ChartTicks
            class="period-axis"
            along="inline"
            :ticks="days"
          />
        </div>
      </div>
    </template>
  </figure>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped src="@/shared/ui/periodPlot.css"></style>

<style scoped src="@/shared/ui/axisFrame.css"></style>

<style scoped>
.period-columns {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
}

/* The field is as tall as it was with a line of words over the plot, which the plot now holds:
   the chart keeps its height and the drawing gains that line and the gap under it. */
.period-field {
  position: relative;
  grid-area: field;
  block-size: calc(160px + var(--font-size-dense) * var(--line-height-snug) + var(--space-2));
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

/* The whole height of its period is what a pointer points at and presses, never only the painted
   part: above its stack and in the gaps between its segments. A period that acts is a line of the
   chart, not a control standing in it. */
.period-column {
  flex: 1;
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

/* The stack stands over its period, centred on its foot; the pointer passes through its gaps to
   the period, and stops on a segment. The period under the pointer or the keyboard lifts. */
.period-stack {
  position: absolute;
  inset-block-end: 0;
  inset-inline: 0;
  inline-size: min(100%, var(--period-column));
  margin-inline: auto;
  pointer-events: none;

  .period-column:is(:hover, :focus-visible) + & {
    filter: brightness(1.2);
  }
}

/* Each series a block of its own hue, a 2px gap of ground between them; the top of the stack
   is rounded and its foot square on the baseline. A segment under the pointer or the keyboard
   lifts on its own. */
.period-segment {
  position: absolute;
  inset-inline: 0;
  display: block;
  min-block-size: 0;
  padding: 0;
  border: 0;
  pointer-events: auto;

  &:last-child {
    border-start-start-radius: calc(var(--radius-status) - var(--space-half));
    border-start-end-radius: calc(var(--radius-status) - var(--space-half));
  }

  &:is([type='button'], [href]) {
    cursor: pointer;
  }

  &:is(:hover, :focus-visible) {
    filter: brightness(1.2);
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
