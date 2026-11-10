<script setup lang="ts">
/**
 * The table a chart is read as, around the rows a chart's table gives it (`RankedBarsTable`,
 * `PeriodColumnsTable`): the empty state in the chart's own words when there is nothing, else
 * the table under a caption only a screen reader reads. A table wider than its column, as a
 * phone makes one of a period table, scrolls in its own frame instead of widening the page,
 * and Tab reaches that frame, named as the table, only while it scrolls (`keyScroll`).
 */
import { keyScroll } from '@/shared/lib/keyScroll.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'

defineProps<{
  /** Nothing to table: the chart's empty words stand instead. */
  empty: boolean
  /** What the table shows, as its caption and the scrolling frame's name. */
  label: string
  words: { empty: string; emptyDescription?: string }
}>()

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
  >
    <table class="chart-table">
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
