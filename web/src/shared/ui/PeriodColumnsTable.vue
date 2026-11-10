<script setup lang="ts">
/**
 * `PeriodColumns` as a table: a row per period in time order, a column per series in the
 * stack's order, the period's sum, and a note of what the chart marks on it — that it is still
 * running, what changed at its start. Every number the chart draws is here, a series with
 * nothing in a period included. It is the chart's accessible equivalent and may stand beside
 * it or instead of it: what a press opens in the chart, a period or one series in it, opens
 * here from the period's name or from the series' figure.
 */
import { computed } from 'vue'

import type { PeriodChartProps, PeriodSelection, PeriodSeries } from '@/shared/ui/chartGeometry.ts'
import { columnNotes, stackColumns } from '@/shared/ui/chartGeometry.ts'
import ChartTable from '@/shared/ui/ChartTable.vue'

const props = withDefaults(defineProps<PeriodChartProps>(), {
  actionable: null,
  marks: () => [],
})

const emit = defineEmits<{ select: [selection: PeriodSelection] }>()

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

/** A series' figure in a period as the chart draws it: one with nothing drawn reads as zero. */
const amount = (row: TableRow, series: PeriodSeries) =>
  props.formatValue(row.held.get(series.key) ?? 0)

/** Where segments act, a figure the chart draws opens the same series as its segment. */
const opens = (row: TableRow, series: PeriodSeries) =>
  props.actionable === 'segment' && row.held.has(series.key)

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
        :data-key="row.one.column.key"
      >
        <th
          scope="row"
          class="chart-cell chart-name"
        >
          <button
            v-if="actionable === 'column'"
            type="button"
            class="chart-press"
            @click="emit('select', { column: row.one.column.key, series: null })"
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
          <button
            v-if="opens(row, one)"
            type="button"
            class="chart-press"
            :data-series="one.key"
            @click="emit('select', { column: row.one.column.key, series: one.key })"
          >
            {{ amount(row, one) }}
          </button>
          <template v-else>{{ amount(row, one) }}</template>
        </td>
        <td
          class="chart-cell"
          data-numeric="true"
        >
          {{ formatValue(row.one.total) }}
        </td>
        <td class="chart-cell">{{ row.notes }}</td>
      </tr>
    </tbody>
  </ChartTable>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>
