<script setup lang="ts">
/**
 * `StepLine` as a table: a row a reading, oldest first as the line draws them, its moment heading
 * the row, then its value and its source, and after the readings a row of the forecast its
 * corridor draws, headed by what it is, with its figure at the reset and what that leaves out —
 * when the reset is, and when the window runs out before it. It is the line's accessible
 * equivalent and stands beside it or instead of it; every reading the line draws is a row here,
 * and so is its forecast. Where the line stands now is no row: the window's own lines say its
 * latest reading in words beside this table.
 */
import { computed } from 'vue'

import ChartTable from '@/shared/ui/ChartTable.vue'
import type { StepPoint, StepTarget, StepWords } from '@/shared/ui/windowGeometry.ts'

const props = defineProps<{
  /** What the table shows, as its caption: «Readings of the five hours of Work». */
  label: string
  points: readonly StepPoint[]
  words: StepWords
  /** The forecast to the window's reset, its last row; none adds none. */
  forecast?: StepTarget | null
}>()

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
        v-for="point in points"
        :key="point.key"
        :data-key="point.key"
      >
        <th
          scope="row"
          class="chart-cell chart-name"
        >
          {{ point.timeText }}
        </th>
        <td
          class="chart-cell"
          data-numeric="true"
        >
          {{ point.valueText }}
        </td>
        <td class="chart-cell">
          {{ point.noteText }}
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
