<script setup lang="ts">
/**
 * `RankedBars` as a table: the same rows in the same order, each name with the value it reads
 * as. It is the chart's accessible equivalent and may stand beside it or instead of it; a row
 * that opens something in the chart opens it from its name here, as `select` with its key, and
 * a row that leads somewhere is a link from its name, pressed as `follow`.
 */
import { computed } from 'vue'

import type { RankedRow, RankedWords } from '@/shared/ui/chartGeometry.ts'
import { rankRows } from '@/shared/ui/chartGeometry.ts'
import ChartTable from '@/shared/ui/ChartTable.vue'

const props = defineProps<{
  /** What the table shows, as its caption: "Time by project". */
  label: string
  rows: readonly RankedRow[]
  words: RankedWords
}>()

const emit = defineEmits<{ follow: [key: string, press: MouseEvent]; select: [key: string] }>()

/** A middle press on a link opens it elsewhere, and is a press on it all the same. */
function pressAside(key: string, event: MouseEvent) {
  if (event.button === 1) emit('follow', key, event)
}

const ordered = computed(() => {
  const { ranked, rest } = rankRows(props.rows)
  return [...ranked, ...rest].map((row) => ({ ...row, rest: row.kind !== 'category' }))
})

/** Nothing to table: the chart's empty words stand instead. */
const empty = computed(() => !props.rows.length)
</script>

<template>
  <ChartTable
    :label="label"
    :empty="empty"
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
          scope="col"
          class="chart-cell chart-heading"
          data-numeric="true"
        >
          {{ words.value }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="row in ordered"
        :key="row.key"
        :class="{ 'chart-rest': row.rest }"
        :data-kind="row.kind"
      >
        <th
          scope="row"
          class="chart-cell chart-name"
        >
          <a
            v-if="row.href"
            class="chart-press"
            :href="row.href"
            :data-key="row.key"
            @click="(event: MouseEvent) => emit('follow', row.key, event)"
            @auxclick="(event: MouseEvent) => pressAside(row.key, event)"
          >
            {{ row.label }}
          </a>
          <button
            v-else-if="row.actionable"
            type="button"
            class="chart-press"
            :aria-label="row.action"
            :data-key="row.key"
            @click="emit('select', row.key)"
          >
            {{ row.label }}
          </button>
          <template v-else>{{ row.label }}</template>
        </th>
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
