<script setup lang="ts">
/**
 * `SmallMultiples` as a table: a row per multiple in the chart's order — the ones on the scale,
 * then the ones apart in the quiet ink — with its amount in each period and its figure for the
 * whole span. A period with no figure says so with a dash, and with `words.absent` to a screen
 * reader. It is the chart's accessible equivalent and may stand beside it or instead of it; wider
 * than its column, it scrolls in its own frame with each row's name in view (`ChartTable`). A name
 * that acts in the chart acts here as well: a link sent out as `follow` with the press, a button
 * as `select` with the key.
 */
import { computed } from 'vue'

import { markActs, markTag, markType } from '@/shared/ui/chartGeometry.ts'
import ChartTable from '@/shared/ui/ChartTable.vue'
import { placeMultiples } from '@/shared/ui/multiplesGeometry.ts'
import type {
  MultiplePeriod,
  MultiplesWords,
  SmallMultiple,
} from '@/shared/ui/multiplesGeometry.ts'
import PairName from '@/shared/ui/PairName.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  /** What the table shows, as its caption. */
  label: string
  multiples: readonly SmallMultiple[]
  periods: readonly MultiplePeriod[]
  words: MultiplesWords
  /** A value as the reader reads it, for each period's amount. */
  formatValue: (value: number) => string
}>()

const emit = defineEmits<{ follow: [key: string, press: MouseEvent]; select: [key: string] }>()

function press(one: SmallMultiple, event: MouseEvent) {
  if (one.href) emit('follow', one.key, event)
  else if (one.actionable) emit('select', one.key)
}

/** A middle press on a link opens it elsewhere, and is a press on it all the same. */
function pressAside(one: SmallMultiple, event: MouseEvent) {
  if (one.href && event.button === 1) emit('follow', one.key, event)
}

/** What an absent figure reads as: a dash, with the words beside it for a screen reader. */
const ABSENT = '—'

const rows = computed(() => {
  const { shared, apart } = placeMultiples(props.multiples)
  return [...shared, ...apart].map((one) => ({
    ...one,
    rest: one.kind === 'none' || one.kind === 'unknown',
    cells: props.periods.map((period, index) => {
      const value = one.values[index]
      return { key: period.key, text: value === null ? null : props.formatValue(value ?? 0) }
    }),
  }))
})
</script>

<template>
  <ChartTable
    :label="label"
    :empty="!multiples.length"
    :words="words"
  >
    <thead>
      <tr>
        <th
          scope="col"
          class="chart-cell chart-heading"
        >
          {{ words.category }}
        </th>
        <th
          v-for="period in periods"
          :key="period.key"
          scope="col"
          class="chart-cell chart-heading"
          data-numeric="true"
        >
          {{ period.label }}
        </th>
        <th
          scope="col"
          class="chart-cell chart-heading"
          data-numeric="true"
        >
          {{ words.total }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="row in rows"
        :key="row.key"
        class="row-state tabular"
        :class="{ 'chart-rest': row.rest }"
        :data-kind="row.kind"
      >
        <th
          scope="row"
          class="chart-cell chart-name"
        >
          <span
            v-tooltip.clipped="row.label"
            class="chart-name-line"
          >
            <component
              :is="markTag(row, 'span')"
              v-if="markActs(row)"
              class="chart-press"
              :type="markType(row)"
              :href="row.href"
              :aria-description="row.action"
              @click="(event: MouseEvent) => press(row, event)"
              @auxclick="(event: MouseEvent) => pressAside(row, event)"
            >
              <span class="two-lines"
                ><PairName
                  :name="row.label"
                  :runs="row.labelRuns"
              /></span>
            </component>
            <span
              v-else
              class="two-lines"
              ><PairName
                :name="row.label"
                :runs="row.labelRuns"
            /></span>
          </span>
        </th>
        <td
          v-for="cell in row.cells"
          :key="cell.key"
          class="chart-cell"
          data-numeric="true"
        >
          <template v-if="cell.text !== null">{{ cell.text }}</template>
          <template v-else>
            <span aria-hidden="true">{{ ABSENT }}</span>
            <span class="visually-hidden">{{ words.absent }}</span>
          </template>
        </td>
        <td
          class="chart-cell"
          data-numeric="true"
        >
          {{ row.valueText }}
        </td>
      </tr>
    </tbody>
  </ChartTable>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped src="@/shared/ui/rowStates.css"></style>
