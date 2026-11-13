<script setup lang="ts">
import ChartTable from '@/shared/ui/ChartTable.vue'
/**
 * `WindowBar` as a table: a row a window, its name heading the row, then the share spent, where
 * steady use would stand now and its state, each in words. It is the bars' accessible
 * equivalent and stands beside them or instead of them; every figure a bar draws is a cell here.
 * A row is one window of one account, so no cell adds two of them.
 */
import type { WindowRow, WindowWords } from '@/shared/ui/windowGeometry.ts'

defineProps<{
  /** What the table shows, as its caption: «Five hours of Work». */
  label: string
  rows: readonly WindowRow[]
  words: WindowWords
}>()
</script>

<template>
  <ChartTable
    :label="label"
    :empty="!rows.length"
    :words="words"
  >
    <thead>
      <tr>
        <th
          scope="col"
          class="chart-cell chart-heading"
        >
          {{ words.name }}
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
          data-numeric="true"
        >
          {{ words.even }}
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
          {{ row.label }}
        </th>
        <td
          class="chart-cell"
          data-numeric="true"
        >
          {{ row.valueText }}
        </td>
        <td
          class="chart-cell"
          data-numeric="true"
        >
          {{ row.evenText }}
        </td>
        <td class="chart-cell">
          {{ row.noteText }}
        </td>
      </tr>
    </tbody>
  </ChartTable>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>
