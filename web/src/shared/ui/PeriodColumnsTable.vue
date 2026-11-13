<script setup lang="ts">
/**
 * `PeriodColumns` as a table: a row per period in time order, a column per series in the
 * stack's order, the period's sum, and a note of what the chart marks on it — that it is still
 * running, that it has no data yet, what has no figure, what changed at its start. Every number
 * the chart draws is here,
 * a series with nothing in a period included; a figure nobody has, and the sum of a period with
 * no data yet, reads as a dash and never as a zero. A period compared with has a column of its own, after the sum. It is the chart's
 * accessible equivalent and may stand beside it or instead of it: what a press does in the
 * chart it does here, a period's from the period's name, sent out as `period`, and a series'
 * from its figures, sent out as `series` or, where the series leads somewhere, as `follow` with
 * the press. A period's name that acts heads its row, so it is named by the period, and what
 * pressing it does is its description. A row takes the states the page's rows share
 * (`rowStates.css`) as a row of several controls: its ground under the pointer, and the
 * keyboard's ring round the cell of the control focused.
 */
import { computed } from 'vue'

import type { PeriodChartProps, PeriodSeries } from '@/shared/ui/chartGeometry.ts'
import {
  columnNotes,
  hasSum,
  markActs,
  markTag,
  markType,
  stackColumns,
} from '@/shared/ui/chartGeometry.ts'
import ChartTable from '@/shared/ui/ChartTable.vue'

const props = withDefaults(defineProps<PeriodChartProps>(), {
  formatShare: undefined,
  marks: () => [],
})

const emit = defineEmits<{
  follow: [series: string, press: MouseEvent]
  period: [key: string]
  series: [key: string]
}>()

const rows = computed(() =>
  stackColumns(props.columns, props.series, props.marks).columns.map((one) => ({
    one,
    name: one.column.fullLabel ?? one.column.label,
    notes: columnNotes(one, props.words).join('; '),
    /** Each series' amount as the chart draws it; one with no segment reads as zero. */
    held: new Map(one.segments.map((segment) => [segment.series.key, segment.value])),
  })),
)

type TableRow = (typeof rows.value)[number]

/**
 * A series' figure in a period as the chart draws it: one with nothing drawn reads as zero, and
 * one with no figure there as absent (null), which the cell says with a dash and its words.
 */
function amount(row: TableRow, series: PeriodSeries) {
  const held = row.held.get(series.key)
  return held === undefined && row.one.absent.includes(series) ? null : props.formatValue(held ?? 0)
}

/** What an absent figure reads as: a dash, with the words beside it for a screen reader. */
const ABSENT = '—'

/** The period's sum; absent (null) when nothing is drawn and a series has no figure. */
const sum = (row: TableRow) => (hasSum(row.one) ? props.formatValue(row.one.total) : null)

/** A figure the chart draws of a series that acts does what its segment does. */
const opens = (row: TableRow, series: PeriodSeries) => markActs(series) && row.held.has(series.key)

function pressSeries(series: PeriodSeries, event: MouseEvent) {
  if (series.href) emit('follow', series.key, event)
  else emit('series', series.key)
}

/** A middle press on a series' link opens it elsewhere, and is a press on it all the same. */
function pressSeriesAside(series: PeriodSeries, event: MouseEvent) {
  if (series.href && event.button === 1) emit('follow', series.key, event)
}

/** Whether a period is compared with, which gives its figures a column after the sum. */
const compared = computed(() => props.columns.some((column) => column.before !== undefined))

/** The figure of the period compared with; null where it has none. */
const before = (row: TableRow) =>
  typeof row.one.column.before === 'number' ? props.formatValue(row.one.column.before) : null

/** Nothing to table: the chart's empty words stand instead. */
const empty = computed(() => !props.columns.length || !props.series.length)
</script>

<template>
  <ChartTable
    :label="label"
    :empty="empty"
    :words="words"
  >
    <thead>
      <tr>
        <th
          scope="col"
          class="chart-cell chart-heading"
        >
          {{ words.period }}
        </th>
        <th
          v-for="one in series"
          :key="one.key"
          scope="col"
          class="chart-cell chart-heading"
          data-numeric="true"
        >
          {{ one.label }}
        </th>
        <th
          scope="col"
          class="chart-cell chart-heading"
          data-numeric="true"
        >
          {{ words.total }}
        </th>
        <th
          v-if="compared"
          scope="col"
          class="chart-cell chart-heading"
          data-numeric="true"
        >
          {{ words.before }}
        </th>
        <th
          scope="col"
          class="chart-cell chart-heading"
        >
          {{ words.note }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="row in rows"
        :key="row.one.column.key"
        class="row-state tabular cells"
        :data-key="row.one.column.key"
      >
        <th
          scope="row"
          class="chart-cell chart-name"
        >
          <button
            v-if="row.one.column.action"
            type="button"
            class="chart-press"
            :aria-description="row.one.column.action"
            @click="emit('period', row.one.column.key)"
          >
            {{ row.name }}
          </button>
          <template v-else>{{ row.name }}</template>
        </th>
        <td
          v-for="one in series"
          :key="one.key"
          class="chart-cell"
          data-numeric="true"
        >
          <component
            :is="markTag(one, 'span')"
            v-if="opens(row, one)"
            class="chart-press"
            :type="markType(one)"
            :href="one.href"
            :aria-description="one.action"
            :data-series="one.key"
            @click="(event: MouseEvent) => pressSeries(one, event)"
            @auxclick="(event: MouseEvent) => pressSeriesAside(one, event)"
          >
            {{ amount(row, one) }}
          </component>
          <template v-else-if="amount(row, one) === null">
            <span aria-hidden="true">{{ ABSENT }}</span>
            <span class="visually-hidden">{{ words.absent }}</span>
          </template>
          <template v-else>{{ amount(row, one) }}</template>
        </td>
        <td
          class="chart-cell"
          data-numeric="true"
        >
          <template v-if="row.one.column.pending">
            <span aria-hidden="true">{{ ABSENT }}</span>
            <span class="visually-hidden">{{ words.pending }}</span>
          </template>
          <template v-else-if="sum(row) === null">
            <span aria-hidden="true">{{ ABSENT }}</span>
            <span class="visually-hidden">{{ words.absent }}</span>
          </template>
          <template v-else>{{ sum(row) }}</template>
        </td>
        <td
          v-if="compared"
          class="chart-cell"
          data-numeric="true"
        >
          <template v-if="before(row) === null">
            <span aria-hidden="true">{{ ABSENT }}</span>
            <span class="visually-hidden">{{ words.absent }}</span>
          </template>
          <template v-else>{{ before(row) }}</template>
        </td>
        <td class="chart-cell">{{ row.notes }}</td>
      </tr>
    </tbody>
  </ChartTable>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped src="@/shared/ui/rowStates.css"></style>
