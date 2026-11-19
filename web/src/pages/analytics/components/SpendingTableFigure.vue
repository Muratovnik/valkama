<script setup lang="ts">
/**
 * A cell of figures in a dimension's table, a row's or the total's: its figure, and under it what
 * the figure leaves out (`FigureWords`), the tokens a cost has no price for, «40 тыс. токенов без
 * цены», on a second line in the quiet ink, with the figure on the row's line beside the others.
 * The column is then as wide as the longer of the two rather than both: «≈ 1 109,00 $, 40 тыс.
 * токенов без цены» on one line made the cost column 273 pixels wide. The cell still says the two
 * as one, with the comma between them, as the bars and a hint say them (`besides`).
 *
 * The table lays the cell out (`SpendingTable`): its width, its ink when it holds the chosen
 * measure, and its place in the total row that stays at the panel's edge.
 */
import type { TableCell } from '@/pages/analytics/composables/useTableModel.ts'

import { REMARK_JOINT } from '@/shared/ui/chartGeometry.ts'

defineProps<{ cell: TableCell }>()
</script>

<template>
  <td
    class="chart-cell"
    data-numeric="true"
    :data-measure="cell.key"
    :data-chosen="cell.chosen"
  >
    <span>{{ cell.text }}</span>
    <template v-if="cell.remark">
      <span class="visually-hidden">{{ REMARK_JOINT }}</span>
      <span class="chart-detail">{{ cell.remark }}</span>
    </template>
  </td>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>
