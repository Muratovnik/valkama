<script setup lang="ts">
import { REMARK_JOINT } from '@/shared/ui/chartGeometry.ts'
import ChartTable from '@/shared/ui/ChartTable.vue'
/**
 * `WindowBar` as a table: a row a window, its name heading the row, then the share spent, where
 * steady use would stand now, its state with how long it has been silent, and its forecast, each
 * in words. It is the bars' accessible equivalent and stands beside them or instead of them;
 * every figure a bar draws, its hatched forecast too, is a cell here. A row is one window of one
 * account, so no cell adds two of them. A share's cell may say more under the share, in the
 * quiet ink (`valueDetail`). Each row is `data-key`, its window's key, its share's cell
 * `data-cell="value"` and its forecast's cell `data-cell="forecast"`.
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
        <th
          scope="col"
          class="chart-cell chart-heading"
        >
          {{ words.forecast }}
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
          data-cell="value"
        >
          <span>{{ row.valueText }}</span>
          <template v-if="row.valueDetail">
            <span class="visually-hidden">{{ REMARK_JOINT }}</span>
            <span class="chart-detail">{{ row.valueDetail }}</span>
          </template>
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
        <td
          class="chart-cell"
          data-cell="forecast"
        >
          {{ row.forecastText }}
        </td>
      </tr>
    </tbody>
  </ChartTable>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>
