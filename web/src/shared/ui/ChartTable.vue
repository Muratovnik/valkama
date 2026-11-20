<script setup lang="ts">
/**
 * The table a chart is read as, around the rows a chart's table gives it (`RankedBarsTable`,
 * `PeriodColumnsTable`): the empty state in the chart's own words when there is nothing, else
 * the table under a caption only a screen reader reads. A table wider than its column, as a
 * phone makes one of a period table, scrolls in its own frame instead of widening the page,
 * and Tab reaches that frame, named as the table, only while it scrolls (`keyScroll`). The frame
 * is `data-region="table-frame"`, for a reader of the page to measure it by. A table whose rows
 * are a tree's, drawn whole, says so with the tree's role (`tree`, `treeGridAttrs`).
 */
import { computed } from 'vue'

import { keyScroll } from '@/shared/lib/keyScroll.ts'
import { treeGridAttrs } from '@/shared/lib/treeRows.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'

const props = defineProps<{
  /** Nothing to table: the chart's empty words stand instead. */
  empty: boolean
  /** What the table shows, as its caption and the scrolling frame's name. */
  label: string
  words: { empty: string; emptyDescription?: string }
  /** The rows are a tree's, every one of them drawn. */
  tree?: boolean
}>()

/** Drawn whole, the browser counts the rows itself, so no count is given. */
const tableAttrs = computed(() =>
  props.tree ? treeGridAttrs({ rowCount: 0, windowed: false }) : {},
)

const vKeyScroll = keyScroll
</script>

<template>
  <DataEmptyState
    v-if="empty"
    :title="words.empty"
    :description="words.emptyDescription"
    compact
  />
  <div
    v-else
    v-key-scroll="label"
    class="chart-table-frame"
    data-region="table-frame"
  >
    <table
      class="chart-table"
      v-bind="tableAttrs"
    >
      <caption class="visually-hidden">
        {{
          label
        }}
      </caption>
      <slot />
    </table>
  </div>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>
