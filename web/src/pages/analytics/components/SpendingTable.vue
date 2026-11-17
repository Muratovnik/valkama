<script setup lang="ts">
/**
 * The table of a dimension's panel: every value beside the period before, or with the section split
 * by a second dimension every pair, «claude-opus-5-5 · high», read from the answer by both, with
 * each row's tokens by kind under the measure «tokens» (`useTableModel`). A figure the read does not hold says so in words; a period before that was
 * not read is said once, over the table.
 *
 * Its frame is held to about the window's height and scrolls inside itself both ways: its heading
 * row stays at the frame's top edge, its total at the bottom edge and its names at its start,
 * each held there by the browser as the frame scrolls (`position: sticky`), and a row brought into
 * view by the focus stands clear of the heading row and the total. A table shorter than that
 * height stands at its own. Each column's heading sorts by it, largest first, then the other way; the first sort is the chosen
 * measure. A row is one line: the figures take what they need, the name the rest down to its
 * least, cut where the column is narrower (`SpendingTableName`). A cost that leaves tokens without
 * a price says how many on a second line of its cell, under its amount (`SpendingTableFigure`):
 * that row is taller, and its column is as wide as the longer of the two lines. A window too
 * narrow for that column scrolls the table sideways in its frame, the names held at its start.
 *
 * The sorted column's heading is marked, in the ink of the figures with its arrow and a rule under
 * it. The heading row over the frame (`SpendingTableHead`) counts the rows, gives their whole account
 * and order in its hint, and holds the download; the download it asks for is what the table shows,
 * in its order, as a CSV file (`tableFile`). A row's name pressed to narrow the view goes out as
 * `narrow`. Asked to (`reveal`), it brings itself into view with the focus on it.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import SpendingTableFigure from '@/pages/analytics/components/SpendingTableFigure.vue'
import SpendingTableHead from '@/pages/analytics/components/SpendingTableHead.vue'
import SpendingTableName from '@/pages/analytics/components/SpendingTableName.vue'
import type { CrossRead } from '@/pages/analytics/composables/useCrossRead.ts'
import { useHeadingLines } from '@/pages/analytics/composables/useHeadingLines.ts'
import { useReadWaitReport } from '@/pages/analytics/composables/useReadWaits.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { useTableModel } from '@/pages/analytics/composables/useTableModel.ts'
import { NAME_COLUMN, useTableSort } from '@/pages/analytics/composables/useTableSort.ts'
import { tableFile } from '@/pages/analytics/utils/spendingCsv.ts'

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
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

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
  /** Why the last press here did not narrow the view, in words; empty otherwise. */
  notice?: string
}>()
/** A value pressed to narrow the view to it; the crossed read again. */
const emit = defineEmits<{
  narrow: [value: string | null, label: string]
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

const model = useTableModel(() => ({
  by: props.by,
  measure: props.measure,
  usage: tableUsage.value,
  across: crossed.value?.across ?? null,
}))

const { sort, sortBy, lines, direction, marks } = useTableSort(model, () => locale.value)

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

const emptyWords = computed(() => ({ empty: t('analytics.bars.empty') }))

const root = ref<HTMLElement | null>(null)

/** Its headings over figures on one line, or on two where one would widen it past its frame. */
const headingLines = useHeadingLines(root, [model, held])

/** Brings the table into view, its heading row at the top, with the focus on it. */
function reveal() {
  const table = root.value
  if (!table) return
  table.focus({ preventScroll: true })
  table.scrollIntoView({ block: 'start' })
}
defineExpose({ reveal })
</script>

<template>
  <section
    ref="root"
    class="spending-table"
    tabindex="-1"
    :data-measure="measure"
    :data-headings="headingLines"
    :data-rows="rows"
    :aria-label="model.title"
  >
    <SpendingTableHead
      :by="by"
      :lines="model.lines"
      :measure="measure"
      :split="Boolean(across)"
      :summary="summary"
      :title="model.title"
      :waiting="waiting"
      @download="download"
    />
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
    <div
      v-if="held"
      class="spending-table-waiting"
    >
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
    <ChartTable
      v-else
      class="spending-table-frame"
      :label="model.title"
      :empty="!model.lines.length"
      :words="emptyWords"
    >
      <thead>
        <tr class="table-head">
          <th
            v-for="column in headings"
            :key="column.key"
            scope="col"
            class="chart-cell chart-heading"
            :data-numeric="column.numeric"
            :data-chosen="column.chosen"
            :aria-sort="marks[column.key]?.aria"
          >
            <button
              v-tooltip.clipped="column.text"
              type="button"
              class="table-sort"
              :aria-description="t('analytics.panel.table.sortBy', { column: column.text })"
              @click="sortBy(column.key)"
            >
              {{ column.text }}
              <VIcon
                v-if="marks[column.key]"
                class="table-sort-icon"
                :name="marks[column.key]?.icon ?? 'arrow-down'"
                :size="12"
              />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
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
            @narrow="(value, label) => emit('narrow', value, label)"
          />
          <SpendingTableFigure
            v-for="cell in line.cells"
            :key="cell.key"
            :cell="cell"
          />
        </tr>
      </tbody>
      <tfoot>
        <tr class="table-total">
          <th
            scope="row"
            class="chart-cell chart-name"
          >
            {{ t('analytics.panel.table.total') }}
          </th>
          <SpendingTableFigure
            v-for="cell in model.total"
            :key="cell.key"
            :cell="cell"
          />
        </tr>
      </tfoot>
    </ChartTable>
  </section>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped src="@/shared/ui/rowStates.css"></style>

<style scoped>
/* The heading row, the notes and the frame, top to bottom, each as tall as it is. Its headings
   ask it how wide it is. Focused from a link to it, it rings itself inside its edge. */
.spending-table {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
  container-type: inline-size;

  &:focus-visible {
    outline-offset: var(--space-half);
  }
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

/* The frame is held to the window's height, less what stands over the panel and the table's own
   heading row, so at 1280×800 and 1440×900 the table and its heading row stand in the window
   together; it scrolls inside itself both ways. A shorter table stands at its own height. Its
   heading row and total stay at its edges and its names at its start, held by the browser as it
   scrolls: moved by the panel's scroll through a view timeline instead, they lagged a frame
   behind the rows and shook. The room kept at its edges (`scroll-padding`) is the heading row's
   two lines and the total's, so a row the focus brings into view stands clear of both. */
.spending-table-frame {
  max-block-size: calc(100dvh - 13rem);
  overflow: auto;
  scroll-padding-block: 4rem 3rem;
}

/* The heading row and the total over the rows, the names' corner over both. */
.table-head .chart-cell {
  position: sticky;
  inset-block-start: 0;
  z-index: 3;
  background: var(--color-chart-table-ground, var(--color-canvas));
  box-shadow: inset 0 -1px var(--color-rule);

  &:first-child {
    z-index: 4;
  }
}

.table-total .chart-cell {
  position: sticky;
  inset-block-end: 0;
  z-index: 2;
  color: var(--color-text);
  background: var(--color-chart-table-ground, var(--color-canvas));
  box-shadow: inset 0 1px var(--color-rule);

  &.chart-name {
    z-index: 3;
  }
}

/* A heading that sorts: the heading's own words, pressed as a whole, with the way it runs. */
.table-sort {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: inherit;
  background: none;
  cursor: pointer;

  [data-numeric='true'] > & {
    justify-content: flex-end;
  }
}

/* The column the rows are sorted by: its heading in the ink of the figures, with its arrow and a
   rule under it, so the order reads without the hint. */
.table-head .chart-heading[aria-sort] {
  color: var(--color-text);
  box-shadow: inset 0 -2px var(--color-text-muted);
}

/* The chosen measure, now and before, in the ink the figures of a chart are read in. */
.chart-cell[data-chosen='true'] {
  color: var(--color-text);
}

/* A row is one line: each figure and its heading take what they need, the name the rest, cut
   where it is longer (`SpendingTableName`); a figure's remark takes a second line of its own
   (`SpendingTableFigure`). Where the headings on one line would widen the table past its frame,
   they take a second line instead (`headingLines`). */
.chart-cell[data-numeric='true'] {
  inline-size: 1px;
}

.chart-heading[data-numeric='true'] {
  min-inline-size: 0;
  white-space: nowrap;
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

/* The headings over figures on two lines, each column at its least: the frame of a narrower
   table, a period before named with its hours, or the tokens by kind after the change under the
   measure «tokens», whose table is wider than its frame and whose kinds are reached by the frame's
   own scroll. The change then stands inside the frame's edge rather than past it. */
.spending-table[data-headings='two'] .chart-heading[data-numeric='true'] {
  min-inline-size: 7em;
  white-space: normal;
}
</style>
