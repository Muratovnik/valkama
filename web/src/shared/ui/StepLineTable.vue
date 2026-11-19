<script setup lang="ts">
/**
 * `StepLine` as a table: a row a reading, oldest first as the line draws them, its moment heading
 * the row, then its value and its source, and after the readings a row of the forecast its
 * corridor draws, headed by what it is, with its figure at the reset and what that leaves out —
 * when the reset is, and when the window runs out before it. A restart of the window's count is a
 * row among the readings, before the reading at its moment as the line walks them (`stepStops`):
 * its moment heading it, no value, and what it is with what it leaves out — that the reset did
 * not move. It is the line's accessible equivalent and stands beside it or instead of it; every
 * reading and restart the line draws is a row here, and so is its forecast. Where the line stands
 * now is no row: the window's own lines say its latest reading in words beside this table. Each
 * row is `data-key`: a reading's key, a restart's, and `forecast` for the forecast's.
 */
import { computed } from 'vue'

import ChartTable from '@/shared/ui/ChartTable.vue'
import { stepStops } from '@/shared/ui/windowGeometry.ts'
import type { StepPoint, StepRestart, StepTarget, StepWords } from '@/shared/ui/windowGeometry.ts'

const props = defineProps<{
  /** What the table shows, as its caption: «Readings of the five hours of Work». */
  label: string
  points: readonly StepPoint[]
  words: StepWords
  /** The forecast to the window's reset, its last row; none adds none. */
  forecast?: StepTarget | null
  /** Where the window's count restarted, each at the moment of one of `points`. */
  restarts?: readonly StepRestart[]
}>()

/** The readings and the restarts as rows, in the order the line walks them. */
const rows = computed(() =>
  stepStops(props.points, props.restarts ?? []).flatMap(({ index, kind }) => {
    if (kind === 'reading') {
      const point = props.points[index]
      return point
        ? [{ key: point.key, head: point.timeText, value: point.valueText, note: point.noteText }]
        : []
    }
    const restart = props.restarts?.[index]
    return restart
      ? [
          {
            key: restart.key,
            head: restart.timeText,
            value: '',
            note: [restart.name, ...restart.notes].join('; '),
          },
        ]
      : []
  }),
)

/** What the forecast's figure leaves out, its lines said as one cell. */
const forecastNotes = computed(() => props.forecast?.notes.join('; ') ?? '')
</script>

<template>
  <ChartTable
    :label="label"
    :empty="!points.length"
    :words="words"
  >
    <thead>
      <tr>
        <th
          scope="col"
          class="chart-cell chart-heading"
        >
          {{ words.time }}
        </th>
        <th
          scope="col"
          class="chart-cell chart-heading"
          data-numeric="true"
        >
          {{ words.value }}
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
        :key="row.key"
        :data-key="row.key"
      >
        <th
          scope="row"
          class="chart-cell chart-name"
        >
          {{ row.head }}
        </th>
        <td
          class="chart-cell"
          data-numeric="true"
        >
          {{ row.value }}
        </td>
        <td class="chart-cell">
          {{ row.note }}
        </td>
      </tr>
      <tr
        v-if="forecast"
        data-key="forecast"
      >
        <th
          scope="row"
          class="chart-cell chart-name"
        >
          {{ forecast.name }}
        </th>
        <td
          class="chart-cell"
          data-numeric="true"
        >
          {{ forecast.figure }}
        </td>
        <td class="chart-cell">
          {{ forecastNotes }}
        </td>
      </tr>
    </tbody>
  </ChartTable>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>
