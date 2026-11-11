<script setup lang="ts">
/**
 * The breakdown as one table beside the period before: every value the period or the period
 * before holds, none folded into «other», with its time, tokens and estimated cost in this period,
 * the chosen measure in the period it is compared with, and how that measure moved by the tiles'
 * own rule (`comparedLines`). A figure the read does not hold says so in words and gives no
 * change; a value that worked only before stands with what it spent now, which is nothing.
 *
 * Largest first in the chosen measure, ties by name. A period before that was not read is said
 * once, over the table, and the table then holds this period alone. Wider than its column, it
 * scrolls in its own frame with each row's name kept in view (`ChartTable`).
 *
 * Its button downloads what it shows, for the whole view, as a CSV file (`spendingCsv`); with no
 * value to list it is disabled, and the words beside it say why.
 *
 * A row's name acts as its value does in the bars (`useLineActions`): a link to a task, or a
 * control that narrows the view to the value, sent out as `narrow`.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLineActions } from '@/pages/analytics/composables/useLineActions.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { csvFileName, spendingCsv } from '@/pages/analytics/utils/spendingCsv.ts'
import { comparedLines } from '@/pages/analytics/utils/usageFigures.ts'

import { MEASURES } from '@/shared/api/analyticsAddress.ts'
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type {
  Usage,
  UsageDimension,
  UsageFilters,
  UsageGroupValue,
} from '@/shared/api/analyticsApi.ts'
import { offerDownload } from '@/shared/lib/fileDownload.ts'
import ChartTable from '@/shared/ui/ChartTable.vue'
import FieldError from '@/shared/ui/FieldError.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  by: UsageDimension
  /** The filters the answer was read with, which the downloaded file names. */
  filters: UsageFilters
  measure: Measure
  usage: Usage
  /** Why the last press here did not narrow the view, in words; empty otherwise. */
  notice?: string
}>()
/** A value pressed to narrow the view to it: its filter value, and its name. */
const emit = defineEmits<{ narrow: [value: string | null, label: string] }>()

const { t } = useI18n()
const words = useSpendingWords()
const actions = useLineActions()

const comparison = computed(() => props.usage.comparison)
const heading = computed(() => words.dimension(props.by))
const before = computed(() =>
  comparison.value ? words.days(comparison.value.period.from, comparison.value.period.to) : '',
)

const title = computed(() => {
  const by = t(`analytics.byDimension.${props.by}`)
  return before.value
    ? t('analytics.table.beside', { by, period: before.value })
    : t('analytics.table.title', { by })
})

/** A column of figures: its heading, and whether it holds the chosen measure. */
interface Column {
  chosen: boolean
  key: Measure | 'before' | 'change'
  text: string
}

/** This period's three measures, then the chosen one before and its change where it was read. */
const columns = computed<Column[]>(() => [
  ...MEASURES.map((name) => ({
    key: name,
    text: words.measure(name),
    chosen: name === props.measure,
  })),
  ...(before.value
    ? [
        {
          key: 'before' as const,
          text: t('analytics.table.before', {
            measure: words.measure(props.measure),
            period: before.value,
          }),
          chosen: true,
        },
        { key: 'change' as const, text: t('analytics.table.change'), chosen: false },
      ]
    : []),
])

const nameOf = (value: UsageGroupValue) => words.valueLabel(props.by, value)

const lines = computed(() =>
  comparedLines({
    rows: props.usage.rows,
    before: comparison.value?.rows ?? null,
    dimension: props.by,
    measure: props.measure,
    name: nameOf,
  }).map((line) => ({
    key: line.key,
    rest: line.kind !== 'category',
    name: nameOf(line.value),
    link: actions.taskLink(props.by, line.value),
    narrowsTo: actions.narrowsTo(props.by, line.value),
    cells: columns.value.map((column) => {
      if (column.key === 'before')
        return { ...column, text: line.before ? words.figure(props.measure, line.before) : '' }
      if (column.key === 'change')
        return { ...column, text: line.change ? words.changeCell(props.measure, line.change) : '' }
      return { ...column, text: words.figure(column.key, line.now) }
    }),
  })),
)

const emptyWords = computed(() => ({ empty: t('analytics.bars.empty') }))

type Line = (typeof lines.value)[number]

function follow(line: Line, event: MouseEvent) {
  if (line.link) actions.follow(line.link, event)
}

/** A middle press on a link opens it elsewhere, and is a press on it all the same. */
function followAside(line: Line, event: MouseEvent) {
  if (event.button === 1) follow(line, event)
}

const narrows = (line: Line) => !line.link && line.narrowsTo !== undefined
const narrowName = (line: Line) => actions.narrowName(line.name)

function narrowTo(line: Line) {
  if (line.narrowsTo !== undefined) emit('narrow', line.narrowsTo, line.name)
}

/** Nothing to download: no value in either period. */
const nothing = computed(() => !lines.value.length)
const nothingId = useId()
const downloadNote = computed(() => (nothing.value ? nothingId : undefined))

function download() {
  const { by, filters, measure, usage } = props
  offerDownload(
    csvFileName(usage, by),
    spendingCsv({ by, filters, measure, usage, name: nameOf }),
    'text/csv;charset=utf-8',
  )
}
</script>

<template>
  <section class="spending-table">
    <SectionHeader
      as="h2"
      level="page"
      :title="title"
    >
      <template #actions="{ size }">
        <span
          v-if="nothing"
          :id="nothingId"
          class="spending-table-note"
        >
          {{ t('analytics.table.nothingToDownload') }}
        </span>
        <VButton
          class="spending-download"
          :size="size"
          :disabled="nothing"
          :aria-describedby="downloadNote"
          @click="download"
        >
          {{ t('analytics.table.download') }}
        </VButton>
      </template>
    </SectionHeader>
    <FieldError
      v-if="notice"
      role="alert"
    >
      {{ notice }}
    </FieldError>
    <p
      v-if="!comparison"
      class="spending-table-note"
    >
      {{ t('analytics.table.unread') }}
    </p>
    <ChartTable
      :label="title"
      :empty="!lines.length"
      :words="emptyWords"
    >
      <thead>
        <tr>
          <th
            scope="col"
            class="chart-cell chart-heading"
          >
            {{ heading }}
          </th>
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            class="chart-cell chart-heading"
            data-numeric="true"
            :data-chosen="column.chosen"
          >
            {{ column.text }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="line in lines"
          :key="line.key"
          :class="{ 'chart-rest': line.rest }"
          :data-key="line.key"
        >
          <th
            scope="row"
            class="chart-cell chart-name"
          >
            <a
              v-if="line.link"
              class="chart-press"
              :href="line.link.href"
              @click="(event: MouseEvent) => follow(line, event)"
              @auxclick="(event: MouseEvent) => followAside(line, event)"
            >
              {{ line.name }}
            </a>
            <button
              v-else-if="narrows(line)"
              type="button"
              class="chart-press"
              :aria-label="narrowName(line)"
              @click="narrowTo(line)"
            >
              {{ line.name }}
            </button>
            <template v-else>{{ line.name }}</template>
          </th>
          <td
            v-for="cell in line.cells"
            :key="cell.key"
            class="chart-cell"
            data-numeric="true"
            :data-measure="cell.key"
            :data-chosen="cell.chosen"
          >
            {{ cell.text }}
          </td>
        </tr>
      </tbody>
    </ChartTable>
  </section>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped>
.spending-table {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
}

.spending-table-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* The chosen measure, now and before, in the ink the figures of a chart are read in. */
.chart-cell[data-chosen='true'] {
  color: var(--color-text);
}
</style>
