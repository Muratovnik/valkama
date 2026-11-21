<script setup lang="ts">
/**
 * One column per period — a day or an hour — stacked by a few series, such as the accounts the
 * work ran under. The value axis starts at zero and names a few round steps; the time axis
 * names as many periods as it has room for, counted back from the last. A period still running
 * is hatched (`hatch.css`), so a short last column does not read as a drop, and while one is on
 * the plot the legend names the hatch (`words.hatch`); a change at the start of a period
 * (the account switched) is a line up the plot in the gap before it, which the legend names while
 * the plot marks one (`words.change`), and the period's hint, name and table row say what changed —
 * a period that acts has it in its name after the action — and no row of the chart is kept for
 * it, above the plot or under it.
 * A period compared with this one (`before`) stands on the same scale as a tick at its height
 * across each column, an edge in the text's main ink and not a hue, named in the legend, and the
 * period's hint says its figure. The tick reaches 4px past each side of its column, where no
 * border between two segments ever reaches, so it is never read as a gap in a grey stack; where a
 * period's room leaves less, it reaches what it can and stays a hair inside that room
 * (`periodPlot.css`). The tick and the line of a change are layers beside the data, which their
 * keys in the legend turn off and on for every chart at once (`chartLayersStore`): a layer turned
 * off is not drawn, and no hint, name or step of the scale counts it, so a period before that was
 * taller no longer holds the scale up; its key stays, and nothing else says it is off. The
 * columns are the data and always show. A series with no figure in a period (`absent`, such as
 * work with no price) draws nothing there, and the hint and the period's name say so rather than a zero. A period whose
 * figures are not in yet (`pending`) stands as a hatched ground the plot's height, never a column
 * of zero, and its hint and name say it has no data yet. `PeriodColumnsTable` is the same periods
 * as a table.
 *
 * Series are told apart by the legend's words and by the hue `seriesSlots()` pinned to each
 * name, never by the hue alone. No line stands over the plot: a period and a legend entry say
 * what they hold in a hint (`markHints.ts`), under the pointer or the keyboard, and the hint lies
 * over the page, so pointing moves nothing. A period is one place for the pointer: its whole
 * height and its half of the gap to each neighbour, its segments and the ground between them
 * (`data-tooltip-area`), so crossing it never swaps one hint for another. Its hint says each
 * series' share of it too, stands at its stack, the mark it declares (`data-hint-mark`), its top
 * level with the stack's, to the right where there is room, and stays put while the pointer
 * crosses the period and focus climbs into its segments; a segment has none of its own, and
 * marks its series' row in the period's hint while the pointer or focus is on it
 * (`data-tooltip-row`). The hint draws its shares bare where the chart says how (`formatPart`).
 * The time axis keeps its names apart, measured in the axis's own font (`dayTicks`).
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
 * sideways inside it, the scale staying in view, and fades toward an edge past which periods are
 * hidden. A past span opens on its first periods; a `live` one, whose last periods move on with
 * the clock, opens on its running period at the frame's end and keeps it there until the reader
 * scrolls away (`usePlotFrame`). The plot's x scale is one share of its width per period, from
 * the field's start (`field`, `--period-count`).
 *
 * A chart that `frames` takes a span of its periods as well as one: a frame dragged along the
 * plot with a mouse or a pen, or stretched from the period the keyboard stands on with Shift and
 * an arrow, covers whole periods (`usePeriodFrame`), and goes out as `span` with the keys of its
 * first and last period once the pointer or Shift lets it go. A press that does not drag stays
 * the press of what it landed on, and Escape lets a frame go.
 *
 * What a reader of the page selects it by: the figure is `data-chart="periods"`, and its legend
 * the list `ChartLegend` declares (`data-hint-list="legend"`); its regions are `data-region` —
 * the `frame` the plot scrolls in, the `plot`, its `scale` up the side, the `field` the periods
 * stand in and the `axis` under it. A period is its slot (`data-tooltip-area`, its key
 * `data-key`) and its stack the mark its hint speaks for (`data-hint-mark`); a segment carries its
 * series (`data-series`). The marks drawn up the plot are `data-mark` — a `change` at a period's
 * start and the tick of the period compared with, `before`.
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
import { periodHint, seriesHint } from '@/shared/ui/markHints.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import { FRAME_KEYS } from '@/shared/ui/useAxisFrame.ts'
import { cellId, useChartCursor } from '@/shared/ui/useChartCursor.ts'
import { usePeriodFrame } from '@/shared/ui/usePeriodFrame.ts'
import { usePeriodLayers } from '@/shared/ui/usePeriodLayers.ts'
import { usePlotFrame } from '@/shared/ui/usePlotFrame.ts'

const props = withDefaults(
  defineProps<
    PeriodChartProps & {
      /** Whether a frame along the plot takes a span of its periods (`span`). */
      frames?: boolean
      /**
       * Whether the span is live, moving on with the clock: it opens on its period still running
       * (`incomplete`), its last where none is, rather than on its first.
       */
      live?: boolean
    }
  >(),
  { formatPart: undefined, formatShare: undefined, marks: () => [], frames: false, live: false },
)

const emit = defineEmits<{
  follow: [series: string, press: MouseEvent]
  period: [key: string]
  series: [key: string]
  /** A span of periods framed: the keys of its first and its last, in the order of time. */
  span: [first: string, last: string]
}>()

const axis = computed(() => props.valueAxis ?? roundAxis(props.formatValue))
/** The layers beside the data, as the plot draws them and as the legend names them. */
const { change, columns: drawnColumns, marks: drawnMarks, outline } = usePeriodLayers(() => props)
const chart = computed(() =>
  stackColumns(drawnColumns.value, props.series, drawnMarks.value, axis.value),
)
/** The name of the hatch while a period still running is on the plot, which is hatched. */
const hatch = computed(() =>
  props.columns.some((column) => column.incomplete) ? props.words.hatch : undefined,
)
const empty = computed(() => !props.columns.length || !props.series.length)

/** Whether anything in the chart acts, which gives its periods their least width. */
const acting = computed(
  () => props.columns.some((column) => column.action) || props.series.some((one) => markActs(one)),
)
const frame = ref<HTMLElement | null>(null)
const plot = ref<HTMLElement | null>(null)
const field = ref<HTMLElement | null>(null)
/** The period a live span keeps in view: the one still running, else its last. */
const running = computed(() => {
  if (!props.live) return null
  const still = props.columns.filter((column) => column.incomplete)
  return (still.at(-1) ?? props.columns.at(-1))?.key ?? null
})
const { gutter, hidden, reveal, width } = usePlotFrame(frame, plot, field, {
  keys: () => props.columns.map((column) => column.key),
  running: () => running.value,
})

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

/**
 * The names of the time axis, each measured in the axis's font and its figures of one width
 * (`ChartTicks`, `--font-count`, `tabular-nums`).
 */
const days = computed(() => {
  void fontsArrived.value
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-count').trim()
  const measure = (text: string) => drawnWidth(text, font, 'tabular')
  return dayTicks(props.columns, width.value, measure)
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
      seriesHint(one, chart.value.columns, props.formatValue, props.formatShare),
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
    'aria-label': one.column.action
      ? [one.column.action, ...one.marks].join('. ')
      : columnSummary(one, props.words, props.formatValue),
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
  const name = segmentSummary(one, segment, props)
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
    data-chart="periods"
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
        v-if="series.length > 1 || outline || hatch || change"
        :series="series"
        :hatch="hatch"
        :outline="outline"
        :change="change"
        :hints="legendHints"
        @follow="(key, event) => emit('follow', key, event)"
        @select="(key) => emit('series', key)"
      />
      <!-- The chart's frame: a period's hint stands at its stack inside it. -->
      <div
        ref="frame"
        class="period-frame"
        data-region="frame"
        :class="{ 'period-acting': acting }"
        :style="{ '--period-gutter': gutter }"
        v-bind="hiddenEdges"
        data-hint-frame
      >
        <div
          ref="plot"
          class="period-plot"
          data-region="plot"
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
            data-region="scale"
            along="block"
            :ticks="scale"
          />
          <div
            ref="field"
            class="period-field"
            data-region="field"
          >
            <span
              v-for="tick in chart.ticks"
              :key="tick"
              class="period-grid"
              aria-hidden="true"
              :class="gridClass(tick)"
              :style="levelOf(tick)"
            />
            <!-- A period's hint stands at its stack, the mark it declares. -->
            <div class="period-bars">
              <div
                v-for="(one, index) in chart.columns"
                :key="one.column.key"
                class="period-slot"
                :data-key="one.column.key"
                data-tooltip-area
              >
                <span
                  v-if="one.column.pending"
                  class="period-pending"
                  aria-hidden="true"
                />
                <component
                  :is="periodTag(one)"
                  v-tooltip.detail="periodHint(one, $props)"
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
                  data-hint-mark
                >
                  <component
                    :is="markTag(segment.series, 'span')"
                    v-for="(segment, at) in one.segments"
                    :key="segment.series.key"
                    class="period-segment series-fill"
                    :class="{ hatched: one.column.incomplete }"
                    :data-slot="segment.series.slot"
                    :data-series="segment.series.key"
                    :data-tooltip-row="segment.series.key"
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
                  data-mark="before"
                  :style="levelOf(one.column.before ?? 0)"
                />
                <span
                  v-if="one.marks.length"
                  class="period-mark"
                  aria-hidden="true"
                  data-mark="change"
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
            data-region="axis"
            along="inline"
            :ticks="days"
          />
        </div>
      </div>
    </template>
  </figure>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped src="@/shared/ui/hatch.css"></style>

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

/* The stack stands over its period, centred on its foot; the pointer passes through its gaps to
   the period, and stops on a segment. */
.period-stack {
  position: absolute;
  inset-block-end: 0;
  inset-inline: 0;
  inline-size: min(100%, var(--period-column));
  margin-inline: auto;
  pointer-events: none;
}

/* Each series a block of its own hue, a 2px gap of ground between them; the top of the stack
   is rounded and its foot square on the baseline. Every segment of the period under the pointer
   or the keyboard lifts, as every mark lifts (`seriesFill.css`), and so does a segment pointed at
   or focused on its own: the period and the segment are each a place the pointer stands. */
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

  &:is(:hover, :focus-visible),
  .period-column:is(:hover, :focus-visible) + .period-stack > & {
    background: var(--series-lifted);
  }
}
</style>
