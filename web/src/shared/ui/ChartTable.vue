<script setup lang="ts">
/**
 * The table a chart is read as, around the rows a chart's table gives it (`RankedBarsTable`,
 * `PeriodColumnsTable`): the empty state in the chart's own words when there is nothing, else
 * the table under a caption only a screen reader reads. A table wider than its column, as a
 * phone makes one of a period table, scrolls in its own frame instead of widening the page,
 * and Tab reaches that frame, named as the table, only while it scrolls (`keyScroll`); one that
 * would scroll by less than the least target gives that sliver from its headings' floors
 * instead (`useChartTableGive`). Tables stacked one over another that should read as one give
 * each the same `layout`: their columns then take its widths whatever their figures, so a column
 * stands at the same edges in every table, and under its least width a table scrolls. The frame
 * is `data-region="table-frame"` and the empty state `data-region="table-empty"`, for a reader of
 * the page to measure either by. A table whose rows are a tree's, drawn whole, says so with the
 * tree's role (`tree`, `treeGridAttrs`).
 */
import { computed, ref } from 'vue'

import { keyScroll } from '@/shared/lib/keyScroll.ts'
import { treeGridAttrs } from '@/shared/lib/treeRows.ts'
import { useChartTableGive } from '@/shared/ui/chartTableGive.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'

const props = defineProps<{
  /** Nothing to table: the chart's empty words stand instead. */
  empty: boolean
  /** What the table shows, as its caption and the scrolling frame's name. */
  label: string
  words: { empty: string; emptyDescription?: string }
  /**
   * Each column's width, in order, and the least width of the whole; none lets each column take
   * what its figures need.
   */
  layout?: { columns: readonly string[]; least: string }
  /** The rows are a tree's, every one of them drawn. */
  tree?: boolean
}>()

/** Drawn whole, the browser counts the rows itself, so no count is given. */
const tableAttrs = computed(() =>
  props.tree ? treeGridAttrs({ rowCount: 0, windowed: false }) : {},
)

const vKeyScroll = keyScroll

/** The least width of a table laid out alike with others, under which it scrolls. */
const tableStyle = computed(() =>
  props.layout ? { minInlineSize: props.layout.least } : undefined,
)

const frame = ref<HTMLElement | null>(null)
useChartTableGive(frame)
</script>

<template>
  <DataEmptyState
    v-if="empty"
    data-region="table-empty"
    :title="words.empty"
    :description="words.emptyDescription"
    compact
  />
  <div
    v-else
    ref="frame"
    v-key-scroll="label"
    class="chart-table-frame"
    data-region="table-frame"
  >
    <table
      class="chart-table"
      v-bind="tableAttrs"
      :class="{ 'chart-table-fixed': layout }"
      :style="tableStyle"
    >
      <caption class="visually-hidden">
        {{
          label
        }}
      </caption>
      <colgroup v-if="layout">
        <col
          v-for="(width, index) in layout.columns"
          :key="index"
          :style="{ inlineSize: width }"
        />
      </colgroup>
      <slot />
    </table>
  </div>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>
