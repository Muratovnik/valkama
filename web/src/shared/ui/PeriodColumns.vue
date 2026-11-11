<script setup lang="ts">
/**
 * One column per period — a day or an hour — stacked by a few series, such as the accounts the
 * work ran under. The value axis starts at zero and names a few round steps; the time axis
 * names as many periods as it has room for, counted back from the last. A period still running
 * is hatched and says so under its name, so a short last column does not read as a drop; a
 * change at the start of a period (the account switched) is a numbered line up the plot, and
 * the note under the chart says what changed. A series with no figure in a period (`absent`, such
 * as work with no price) draws nothing there, and the readout and the period's name say so
 * rather than a zero. `PeriodColumnsTable` is the same periods as a table.
 *
 * Series are told apart by the legend's words and by the hue `seriesSlots()` pinned to each
 * name, never by the hue alone; the line over the plot reads out the period under the pointer
 * or the keyboard, each series by name. Presentational: data and words come in, a press on a
 * period (`actionable: 'column'`) or on one series in it (`'segment'`) goes out as `select`. A
 * period that acts is named by what it does where the caller says (`action`), and what it holds
 * then describes it.
 * The periods are one stop for Tab (`useChartCursor`); the arrows move between them, and up
 * and down between the segments of one where segments act.
 */
import { computed, ref, useId } from 'vue'

import { useResizeObserver } from '@vueuse/core'

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
  dayTicks,
  segmentPlace,
  segmentSummary,
  stackColumns,
} from '@/shared/ui/chartGeometry.ts'
import ChartLegend from '@/shared/ui/ChartLegend.vue'
import ChartTicks from '@/shared/ui/ChartTicks.vue'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import { cellId, useChartCursor } from '@/shared/ui/useChartCursor.ts'

const props = withDefaults(defineProps<PeriodChartProps>(), {
  actionable: null,
  marks: () => [],
})

const emit = defineEmits<{ select: [selection: PeriodSelection] }>()

const chart = computed(() => stackColumns(props.columns, props.series, props.marks))
const empty = computed(() => !props.columns.length || !props.series.length)
const bySegment = computed(() => props.actionable === 'segment')

const field = ref<HTMLElement | null>(null)
const width = ref(0)
useResizeObserver(field, ([entry]) => {
  if (entry) width.value = entry.contentRect.width
})

const scale = computed<PlacedTick[]>(() =>
  chart.value.ticks.map((tick) => ({
    key: tick,
    text: props.formatValue(tick),
    offset: tick / chart.value.top,
    edge: 'middle',
  })),
)
const days = computed(() => dayTicks(props.columns, width.value, props.words.incomplete))

const notes = computed(() => changeNotes(chart.value.columns))
const markers = computed(() => changeMarkers(notes.value, props.columns.length))

const hovered = ref<number | null>(null)
const focused = ref<number | null>(null)
const shownIndex = computed(() => hovered.value ?? focused.value ?? chart.value.columns.length - 1)
const readout = computed(() => {
  const shown = chart.value.columns[shownIndex.value]
  return shown ? columnSummary(shown, props.words, props.formatValue) : ''
})
const isShown = (index: number) => index === shownIndex.value

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

const stackStyle = (one: StackedColumn) => ({
  blockSize: `${(one.total / chart.value.top) * 100}%`,
})
const gridClass = (tick: number) => ({ 'period-baseline': tick === 0 })
const gridStyle = (tick: number) => ({ insetBlockEnd: `${(tick / chart.value.top) * 100}%` })

/** Whether a press acts on what it lands on: a period (`at` null), or a segment of one. */
const acts = (at: number | null) => (at === null ? props.actionable === 'column' : bySegment.value)

function press(one: StackedColumn, at: number | null) {
  const series = at === null ? null : (one.segments[at]?.series.key ?? null)
  if (acts(at) && (at === null || series)) emit('select', { column: one.column.key, series })
}

function focus(index: number, at: number | null) {
  if (!acts(at)) return
  standOn(index, at)
  focused.value = index
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
        v-if="series.length > 1"
        :series="series"
      />
      <p
        class="period-readout"
        aria-hidden="true"
      >
        {{ readout }}
      </p>
      <div
        class="period-plot"
        :style="{ '--period-count': columns.length }"
      >
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
            :style="gridStyle(tick)"
          />
          <div class="period-bars">
            <div
              v-for="(one, index) in chart.columns"
              :key="one.column.key"
              class="period-slot"
              :data-key="one.column.key"
              :data-shown="isShown(index)"
              @pointerenter="hovered = index"
              @pointerleave="hovered = null"
            >
              <component
                :is="columnTag"
                class="period-column"
                v-bind="columnAttrs(one, index)"
                @click="press(one, null)"
                @focus="focus(index, null)"
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
                  :style="stackStyle(one)"
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
                    @focus="focus(index, at)"
                    @blur="focused = null"
                    @keydown="(event: KeyboardEvent) => key(event, at)"
                  />
                </span>
              </component>
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
      <ol
        v-if="notes.length"
        class="period-notes"
      >
        <li
          v-for="note in notes"
          :key="note.number"
          class="period-note"
        >
          <span class="period-note-number">{{ note.number }}</span>
          <span>{{ note.period }}</span>
          <span>{{ note.text }}</span>
        </li>
      </ol>
    </template>
  </figure>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped>
.period-columns {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
}

/* Two lines held for it, so a period that reads out longer than the last does not move the
   plot under the pointer. */
.period-readout {
  min-block-size: 2lh;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
}

/* The scale's figures in a column as wide as the widest, the plot beside them, the change
   numbers over it and the periods' names under it. */
.period-plot {
  --period-count: 1;

  display: grid;
  grid-template-areas:
    '. markers'
    'scale field'
    '. axis';
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: var(--space-2);
  padding-block-start: var(--space-2);
}

.period-markers {
  grid-area: markers;
  padding-block-end: var(--space-1);
}

.period-scale {
  grid-area: scale;
}

.period-axis {
  grid-area: axis;
  padding-block-start: var(--space-2);
}

.period-field {
  position: relative;
  grid-area: field;
  block-size: 160px;
}

/* Hairlines at the scale's steps, recessive; the line at zero is the baseline the columns
   stand on, one step stronger. */
.period-grid {
  position: absolute;
  inset-inline: 0;
  block-size: var(--space-hair);
  background: var(--color-rule);
  transform: translateY(50%);
  pointer-events: none;

  &.period-baseline {
    background: var(--color-rule-strong);
  }

  /* A forced palette drops a painted background; the scale keeps its lines in the quiet ink. */
  @media (forced-colors: active) {
    &,
    &.period-baseline {
      background: GrayText;
      forced-color-adjust: none;
    }
  }
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
  inline-size: min(100%, var(--space-6));

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

/* A change at the start of a period: a line up the plot in the gap before the period. */
.period-mark {
  position: absolute;
  inset-block: 0;
  inset-inline-start: calc(var(--space-hair) - var(--space-half));
  inline-size: var(--space-hair);
  background: var(--color-text-tertiary);
  pointer-events: none;

  /* A change is part of what the chart says, so it keeps its line in a forced palette. */
  @media (forced-colors: active) {
    background: CanvasText;
    forced-color-adjust: none;
  }
}

.period-notes {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  list-style: none;
}

.period-note {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
}

.period-note-number {
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
</style>
