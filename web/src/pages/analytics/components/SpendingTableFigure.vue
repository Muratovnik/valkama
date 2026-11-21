<script setup lang="ts">
/**
 * A cell of figures in a dimension's table, a row's or the total's: its figure, and under it what
 * the figure leaves out (`FigureWords`), the tokens a cost has no price for, «40 тыс. токенов без
 * цены», in the quiet ink, with the figure on the row's line beside the others. The remark wraps
 * inside the width the column's figures give it, between its words and between a count and its
 * noun, never inside the count: the column is as wide as its figures, and a row with a remark is
 * taller instead. On one line of its own the remark still set the column, 192 pixels where its
 * figures asked about 100, and pushed the change past a frame of 686 pixels; beside the figure,
 * «≈ 1 109,00 $, 40 тыс. токенов без цены» made it 273. The cell still says the two as one, with
 * the comma between them, as the bars and a hint say them (`besides`).
 *
 * The table lays the cell out (`SpendingTable`): its width, its ink when it holds the chosen
 * measure, and its place in the total row that stays at the panel's edge. The cell is marked
 * with its column's key (`data-measure`: a measure, `before`, `change` or a kind of tokens), for
 * a reader of the page to find a column's cells by.
 */
import { computed } from 'vue'

import type { TableCell } from '@/pages/analytics/composables/useTableModel.ts'

import { REMARK_JOINT } from '@/shared/ui/chartGeometry.ts'

const props = defineProps<{ cell: TableCell }>()

/**
 * The remark with a break allowed wherever a no-break space joins words, «тыс. токенов»,
 * and kept inside a count, «40 тыс.», whose space follows its digits.
 */
const remark = computed(() => props.cell.remark.replaceAll(/(?<!\d) /gu, ' '))
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
      <span class="chart-detail figure-remark">{{ remark }}</span>
    </template>
  </td>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped>
/* The remark asks its column for no width of its own (`contain`): it takes the width the
   figures give the column and wraps in it, between words, its last line never one short word
   alone («цены»). */
.figure-remark {
  contain: inline-size;
  white-space: normal;
  text-wrap: balance;
}
</style>
