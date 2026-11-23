<script setup lang="ts">
/**
 * The table of a dimension's panel: every value beside the period before, or with the section split
 * by a second dimension every pair, «claude-opus-5-5 · high», read from the answer by both, with
 * each row's tokens by kind under the measure «tokens» (`useTableModel`). A figure the read does not hold says so in words; a period before that was
 * not read is said once, over the table.
 *
 * It is a section's table (`SectionTable`): its frame is held to about the window's height and
 * scrolls inside itself both ways, its heading row at the frame's top edge, its total at the bottom
 * edge and its names at its start, each held there as the frame scrolls, and a row brought into
 * view by the focus stands clear of the heading row and the total. A table shorter than that
 * height stands at its own. Each column's heading sorts by it, largest first, then the other way
 * (`useTableSort`); the first sort is the chosen measure. A row is one line: the figures take what they need, the name the rest down to its
 * least, cut where the column is narrower (`SpendingTableName`). Asked to (`twoLineNames`), as the
 * side panel's narrow table is, names of free text, tasks and sessions, take two lines at most, as
 * a ranked list does in a narrow place: cut to one line there, a task's name showed its reference
 * alone. Its figures stay on the name's first line. A cost that leaves tokens without
 * a price says how many on a second line of its cell, under its amount (`SpendingTableFigure`):
 * that row is taller, and its column is as wide as the longer of the two lines. A window too
 * narrow for that column scrolls the table sideways in its frame, the names held at its start.
 * Its headings keep to two lines rather than come down to their longest word (`least` off), as
 * the owner chose for Analytics: a second line and the sideways scroll; at 900px the week's
 * «Before, Nov 2 – 4» came down to three lines with it.
 *
 * The sorted column's heading is marked, in the ink of the figures with its arrow and a rule under
 * it. The heading row over the frame (`SpendingTableHead`) counts the rows, gives their whole account
 * and order in its hint, and holds the download; the download it asks for is what the table shows,
 * in its order, as a CSV file (`tableFile`). A row's name pressed to open the value's side panel
 * goes out as `inspect`. Asked to (`reveal`), it brings itself into view with the focus on it.
 *
 * Given words to find (`find`), it shows only the rows whose name holds them, whatever their case,
 * and says when none does; its count and its download are of the rows shown. Its total is then
 * of the rows shown too, «Total of those found», with the period's own, «Total for the period»,
 * as a row of its own under it: a total of the period under one found row read as that row's.
 * The totals are marked `data-total` (`found`, `period`).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import SpendingTableFigure from '@/pages/analytics/components/SpendingTableFigure.vue'
import SpendingTableHead from '@/pages/analytics/components/SpendingTableHead.vue'
import SpendingTableName from '@/pages/analytics/components/SpendingTableName.vue'
import type { CrossRead } from '@/pages/analytics/composables/useCrossRead.ts'
import { useReadWaitReport } from '@/pages/analytics/composables/useReadWaits.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { useTableModel } from '@/pages/analytics/composables/useTableModel.ts'
import { NAME_COLUMN, useTableSort } from '@/pages/analytics/composables/useTableSort.ts'
import { tableFile } from '@/pages/analytics/utils/spendingCsv.ts'
import { namedByText } from '@/pages/analytics/utils/splitView.ts'

import SectionTable from '@/widgets/section-table/components/SectionTable.vue'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type {
  Usage,
  UsageDimension,
  UsageFilters,
  UsageGroupValue,
} from '@/shared/api/analyticsApi.ts'
import { offerDownload } from '@/shared/lib/fileDownload.ts'
import FieldError from '@/shared/ui/FieldError.vue'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  /** The second dimension the section is split by; null for none. */
  across: UsageDimension | null
  by: UsageDimension
  /** The read by both dimensions, while the section is split. */
  cross: CrossRead
  /** The filters the answer was read with, which the downloaded file names. */
  filters: UsageFilters
  measure: Measure
  usage: Usage
  /** Words a row's name must hold to be shown; every row without them. */
  find?: string
  /** Why the last press here did not open what it asked for, in words; empty otherwise. */
  notice?: string
  /** Names of free text take two lines at most, as a narrow place asks; one line otherwise. */
  twoLineNames?: boolean
}>()
/** A value pressed to open its side panel; the crossed read again. */
const emit = defineEmits<{
  inspect: [value: string | null, label: string]
  reread: []
}>()

const { locale, t } = useI18n()
const words = useSpendingWords()

/** The crossed answer on show, once there is one for the split chosen. */
const crossed = computed(() => {
  const read = props.cross
  return props.across && 'usage' in read && read.usage
    ? { across: props.across, usage: read.usage }
    : null
})
/** A split is chosen and its read has not landed: it is being read, or failed. */
const waiting = computed(() => Boolean(props.across) && !crossed.value)
/** The crossed read is under way: a wait, unlike a failure, which says so in its place. */
const reading = computed(() => waiting.value && props.cross.status !== 'failed')
/** The wait's words, shown once it has lasted and held for the minimum (`useLoadingPresence`). */
const { shown } = useLoadingPresence(() => reading.value)
useReadWaitReport(shown)
/** The word on screen, once the wait has lasted. */
const waitWord = computed(() => (shown.value ? t('platform.states.loading') : ''))
/** The table stays away while the wait is under way or shown, so the minimum keeps its words. */
const held = computed(() => waiting.value || shown.value)
const acrossWords = computed(() => (props.across ? t(`analytics.byDimension.${props.across}`) : ''))

/** The answer the rows are of: by both dimensions while split, the one on show otherwise. */
const tableUsage = computed(() => crossed.value?.usage ?? props.usage)
/** What a row names: a pair of values while split, whose name column keeps more room. */
const rows = computed(() => (crossed.value ? 'pairs' : 'values'))
/** Its names take two lines where they are free text, tasks and sessions, and it is asked to. */
const nameLines = computed(() =>
  props.twoLineNames && namedByText(props.by, crossed.value?.across) ? 2 : 1,
)

const model = useTableModel(() => ({
  by: props.by,
  measure: props.measure,
  usage: tableUsage.value,
  across: crossed.value?.across ?? null,
}))

const { sort, sortBy, lines: sorted, direction, marks } = useTableSort(model, () => locale.value)

/** The words looked for, as a name is compared with them. */
const sought = computed(() => props.find?.trim().toLocaleLowerCase(locale.value) ?? '')
/** The rows shown, in their order: those whose name holds the words looked for. */
const lines = computed(() =>
  sought.value
    ? sorted.value.filter((line) =>
        `${line.name} ${line.nameEnd ?? ''}`.toLocaleLowerCase(locale.value).includes(sought.value),
      )
    : sorted.value,
)

/**
 * The totals under the rows: the period's alone without words looked for; with them, the total of
 * the rows found, column by column, over the period's, each named for what it adds up.
 */
const totals = computed(() => {
  const { total, totalOf } = model.value
  const period = { key: 'period', cells: total }
  if (!sought.value) return [{ ...period, name: t('analytics.panel.table.total') }]
  const found = totalOf(lines.value.map(({ key }) => key))
  return [
    { key: 'found', cells: found, name: t('analytics.panel.table.totalFound') },
    { ...period, name: t('analytics.panel.table.totalPeriod') },
  ]
})
/** Whether two totals stand at the frame's bottom edge (`data-found`). */
const found = computed(() => (totals.value.length > 1 ? '' : undefined))

/** Every column's heading, the names' first; each sorts the rows by its column. */
const headings = computed(() => [
  {
    key: NAME_COLUMN,
    text: words.dimension(props.by),
    chosen: false,
    numeric: false,
  },
  ...model.value.columns.map((column) => ({ ...column, numeric: true })),
])

/** The whole account of the rows (`counts` of the model), and their order. */
const summary = computed(() => {
  const column = headings.value.find(({ key }) => key === sort.value.column)?.text ?? ''
  const way = t(`analytics.panel.table.direction.${direction.value}`)
  return `${model.value.counts}, ${t('analytics.panel.table.sorted', { column, direction: way })}`
})

const nameOf = (value: UsageGroupValue, dimension: UsageDimension = props.by) =>
  words.valueLabel(dimension, value)

function download() {
  const { by, filters, measure } = props
  const order = lines.value.map(({ key }) => key)
  const across = crossed.value?.across ?? null
  const source = { by, across, filters, measure, usage: tableUsage.value, order }
  const file = tableFile({ ...source, name: nameOf })
  offerDownload(file.name, file.text, 'text/csv;charset=utf-8')
}

const emptyWords = computed(() => ({
  empty: sought.value ? t('analytics.filters.noMatches') : t('analytics.bars.empty'),
}))

/** What the headings' lines are measured again for: what the table holds. */
const holds = computed(() => [model.value])
const sortWords = (column: string) => t('analytics.panel.table.sortBy', { column })

const table = ref<InstanceType<typeof SectionTable> | null>(null)
/** Brings the table into view, its heading row at the top, with the focus on it. */
function reveal() {
  table.value?.reveal()
}
defineExpose({ reveal })
</script>

<template>
  <SectionTable
    ref="table"
    class="spending-table"
    :columns="headings"
    :data-measure="measure"
    :data-rows="rows"
    :data-found="found"
    :empty="!lines.length"
    :empty-words="emptyWords"
    :held="held"
    :holds="holds"
    :label="model.title"
    :least="false"
    :marks="marks"
    :sort-words="sortWords"
    @sort="sortBy"
  >
    <template #head>
      <SpendingTableHead
        :by="by"
        :lines="lines"
        :measure="measure"
        :split="Boolean(across)"
        :summary="summary"
        :title="model.title"
        :waiting="waiting"
        @download="download"
      />
    </template>
    <FieldError
      v-if="notice"
      role="alert"
    >
      {{ notice }}
    </FieldError>
    <p
      v-if="!tableUsage.comparison && !waiting"
      class="spending-table-note"
    >
      {{ t('analytics.table.unread') }}
    </p>
    <template #held>
      <div class="spending-table-waiting">
        <p
          v-if="cross.status === 'failed'"
          class="spending-table-failed"
          role="alert"
        >
          {{ t('analytics.panel.table.failed', { across: acrossWords }) }}
        </p>
        <p
          v-else
          class="spending-table-reading"
        >
          {{ waitWord }}
        </p>
        <VButton
          v-if="cross.status === 'failed'"
          size="compact"
          @click="emit('reread')"
        >
          {{ t('platform.actions.retry') }}
        </VButton>
      </div>
    </template>
    <template #rows>
      <tr
        v-for="line in lines"
        :key="line.key"
        class="row-state tabular"
        :class="{ 'chart-rest': line.rest }"
        :data-key="line.key"
      >
        <SpendingTableName
          :by="by"
          :line="line"
          :lines="nameLines"
          @inspect="(value, label) => emit('inspect', value, label)"
        />
        <SpendingTableFigure
          v-for="cell in line.cells"
          :key="cell.key"
          :cell="cell"
        />
      </tr>
    </template>
    <template #foot>
      <tfoot class="table-totals">
        <tr
          v-for="total in totals"
          :key="total.key"
          class="table-total"
          :data-total="total.key"
        >
          <th
            scope="row"
            class="chart-cell chart-name"
          >
            {{ total.name }}
          </th>
          <SpendingTableFigure
            v-for="cell in total.cells"
            :key="cell.key"
            :cell="cell"
          />
        </tr>
      </tfoot>
    </template>
  </SectionTable>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped src="@/shared/ui/rowStates.css"></style>

<style scoped>
/* What stands over the table in the window, which its frame's height leaves out (`SectionTable`):
   the context bar, the page's bar, the panel's inset and the table's own heading. */
.spending-table {
  --size-section-table-over: 13rem;
}

.spending-table-note,
.spending-table-reading,
.spending-table-failed {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* The read's wait keeps its line while it is not yet shown, when its words are still empty. */
.spending-table-reading {
  min-block-size: 1lh;
}

.spending-table-waiting {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
}

/* The totals under the rows, held at the frame's bottom edge as one (`SectionTable`): with a
   search, the found rows' total over the period's, neither under the other. The names' corner
   stands over the figures inside them. */
.table-totals {
  position: sticky;
  inset-block-end: 0;
  z-index: 2;
}

.table-total .chart-cell {
  color: var(--color-text);
  background: var(--color-chart-table-ground, var(--color-canvas));
  box-shadow: inset 0 1px var(--color-rule);
}

/* With two totals the room kept at the frame's bottom edge is theirs (`SectionTable`), so the
   focus brings a row clear of both. */
.spending-table[data-found] {
  --size-section-table-foot: 5rem;
}

/* The chosen measure, now and before, in the ink the figures of a chart are read in. */
.chart-cell[data-chosen='true'] {
  color: var(--color-text);
}

/* A row is one line: each figure takes what it needs, the name the rest down to its least, cut
   where it is longer, or on two lines where it is free text and the table is asked to
   (`SpendingTableName`); a figure's remark takes a second line of its own
   (`SpendingTableFigure`). */
.chart-cell[data-numeric='true'] {
  inline-size: 1px;
}

/* The name's column takes all the width the figures leave: as wide as the table, less what the
   figures' columns need, and never wider than its frame because of a long name. It gives them
   room down to the least every chart table keeps its names, eight of its ems (`chartTable.css`):
   a task's reference and the start of its title. Held at 12rem, it left the change of «Today»
   past a frame of 676 pixels, a window of 1280 in Russian; where even the least is too much, the
   table scrolls in its frame with the names held at its start. */
.chart-name {
  inline-size: 100%;
  max-inline-size: 0;
}

/* A pair keeps its second value whole, a model's name as long as «· claude-sonnet-5-5», with
   the start of its first before it (`PairName`): its column keeps the 12rem that holds them. */
.spending-table[data-rows='pairs'] .chart-name {
  min-inline-size: 12rem;
}
</style>
