<script setup lang="ts">
/**
 * `StepLine` as a table: a row a reading, oldest first as the line draws them, its moment heading
 * the row, then its value and its source. It is the line's accessible equivalent and stands
 * beside it or instead of it; every reading the line draws is a row here.
 */
import ChartTable from '@/shared/ui/ChartTable.vue'
import type { StepPoint, StepWords } from '@/shared/ui/windowGeometry.ts'

defineProps<{
  /** What the table shows, as its caption: «Readings of the five hours of Work». */
  label: string
  points: readonly StepPoint[]
  words: StepWords
}>()
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
    </tbody>
  </ChartTable>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>
