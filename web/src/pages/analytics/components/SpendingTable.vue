<script setup lang="ts">
/**
 * The table of a dimension's panel: every value beside the period before, or crossed with a second
 * dimension chosen over it, with each value's tokens by kind under the measure «tokens»
 * (`useTableModel`). A figure the read does not hold says so in words; a period before that was
 * not read is said once, over the table.
 *
 * It takes the height its panel leaves it and scrolls in its own frame, which keeps a wheel to
 * itself: the heading row, the names and the total row stay in view however far it scrolls. Each
 * column's heading sorts by it, largest first, then the other way; the first sort is the chosen
 * measure, or the total of a crossed table. A row is one line: its name is cut where the column is
 * narrower (`SpendingTableName`), and the figures take what they need, the name the rest.
 *
 * The sorted column's heading is marked, in the ink of the figures with its arrow and a rule under
 * it. The heading row over the frame (`SpendingTableHead`) counts the rows, gives their whole account
 * and order in its hint, and holds the controls; the download it asks for is what the table shows,
 * in its order, as a CSV file (`tableFile`). A row's name pressed to narrow the view goes out as
 * `narrow`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import SpendingTableHead from '@/pages/analytics/components/SpendingTableHead.vue'
import SpendingTableName from '@/pages/analytics/components/SpendingTableName.vue'
import type { CrossRead } from '@/pages/analytics/composables/useCrossRead.ts'
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
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** The second dimension the table is crossed with; null for none. */
  across: UsageDimension | null
  by: UsageDimension
  /** The read by both dimensions, while the table is crossed. */
  cross: CrossRead
  /** The dimensions the table may be crossed with. */
  dimensions: readonly UsageDimension[]
  /** The filters the answer was read with, which the downloaded file names. */
  filters: UsageFilters
  measure: Measure
  usage: Usage
  /** Why the last press here did not narrow the view, in words; empty otherwise. */
  notice?: string
}>()
/** A value pressed to narrow the view to it; a second dimension chosen; the crossed read again. */
const emit = defineEmits<{
  'narrow': [value: string | null, label: string]
  'reread': []
  'update:across': [across: UsageDimension | null]
}>()

const { locale, t } = useI18n()
const words = useSpendingWords()

/** The crossed answer on show, once there is one for the second dimension chosen. */
const crossed = computed(() => {
  const read = props.cross
  return props.across && 'usage' in read && read.usage
    ? { across: props.across, usage: read.usage }
    : null
})
/** A second dimension is chosen and its read has not landed: it is being read, or failed. */
const waiting = computed(() => Boolean(props.across) && !crossed.value)
/** The crossed read is under way: a wait, unlike a failure, which says so in its place. */
const reading = computed(() => waiting.value && props.cross.status !== 'failed')
/** The wait's words, shown once it has lasted and held for the minimum (`useLoadingPresence`). */
const { shown } = useLoadingPresence(() => reading.value)
/** Said to assistive technology at once, from the region in the markup before the wait starts. */
const said = computed(() => (reading.value ? t('platform.states.loading') : ''))
/** The same word on screen, once the wait has lasted. */
const waitWord = computed(() => (shown.value ? t('platform.states.loading') : ''))
/** The table stays away while the wait is under way or shown, so the minimum keeps its words. */
const held = computed(() => waiting.value || shown.value)
const acrossWords = computed(() => (props.across ? t(`analytics.byDimension.${props.across}`) : ''))

const model = useTableModel(() => ({
  by: props.by,
  measure: props.measure,
  usage: props.usage,
  cross: crossed.value,
}))

const { sort, sortBy, lines, direction, marks } = useTableSort(model, () => locale.value)

/** Every column's heading, the names' first; each sorts the rows by its column. */
const headings = computed(() => [
  {
    key: NAME_COLUMN,
    text: words.dimension(props.by),
    chosen: false,
    numeric: false,
    detail: undefined,
  },
  ...model.value.columns.map((column) => ({ ...column, numeric: true })),
])

/** The whole account of the rows (`counts` of the model), and their order. */
const summary = computed(() => {
  const column = headings.value.find(({ key }) => key === sort.value.column)?.text ?? ''
  const way = t(`analytics.panel.table.direction.${direction.value}`)
  return `${model.value.counts}, ${t('analytics.panel.table.sorted', { column, direction: way })}`
})

const nameOf = (value: UsageGroupValue) => words.valueLabel(props.by, value)

function download() {
  const { by, filters, measure, usage } = props
  const source = { by, filters, measure, usage, order: lines.value.map(({ key }) => key) }
  const file = tableFile({ ...source, name: nameOf, cross: crossed.value, column: words.lineLabel })
  offerDownload(file.name, file.text, 'text/csv;charset=utf-8')
}

const emptyWords = computed(() => ({ empty: t('analytics.bars.empty') }))
</script>

<template>
  <section class="spending-table">
    <SpendingTableHead
      :across="across"
      :by="by"
      :dimensions="dimensions"
      :lines="model.lines"
      :measure="measure"
      :summary="summary"
      :title="model.title"
      :waiting="waiting"
      @download="download"
      @update:across="(next) => emit('update:across', next)"
    >
      <template
        v-if="$slots.actions"
        #actions
      >
        <slot name="actions" />
      </template>
    </SpendingTableHead>
    <FieldError
      v-if="notice"
      role="alert"
    >
      {{ notice }}
    </FieldError>
    <p
      v-if="!usage.comparison && !across"
      class="spending-table-note"
    >
      {{ t('analytics.table.unread') }}
    </p>
    <p
      v-if="measure === 'tokens'"
      class="spending-table-kinds"
    >
      {{ t('analytics.panel.table.kinds.note') }}
    </p>
    <span
      class="visually-hidden"
      role="status"
      >{{ said }}</span
    >
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
              v-tooltip.detail="{ text: column.detail, words: column.text }"
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
          :class="{ 'chart-rest': line.rest }"
          :data-key="line.key"
        >
          <SpendingTableName
            :by="by"
            :line="line"
            @narrow="(value, label) => emit('narrow', value, label)"
          />
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
      <tfoot>
        <tr class="table-total">
          <th
            scope="row"
            class="chart-cell chart-name"
          >
            {{ t('analytics.panel.table.total') }}
          </th>
          <td
            v-for="cell in model.total"
            :key="cell.key"
            class="chart-cell"
            data-numeric="true"
            :data-measure="cell.key"
            :data-chosen="cell.chosen"
          >
            {{ cell.text }}
          </td>
        </tr>
      </tfoot>
    </ChartTable>
  </section>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped>
/* The heading row, the notes and the frame, top to bottom: the frame takes what the panel
   leaves, and scrolls; the rest keep their size. Its headings ask it how wide it is. */
.spending-table {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  min-block-size: 0;
  container-type: inline-size;

  /* Held to a height, only the frame gives way: a part with a declared least height (a
     control's) would otherwise shrink to it and spill onto the next. */
  & > :not(.spending-table-frame) {
    flex-shrink: 0;
  }
}

.spending-table-note,
.spending-table-kinds,
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

/* Its own scroll both ways, which a wheel over it never hands on to the panel. Where the panel
   does not hold it to a height, as on a phone, it stops at most of the window's. */
.spending-table-frame {
  flex: 1 1 auto;
  min-block-size: 0;
  max-block-size: 70svh;
  overflow: auto;
  overscroll-behavior: contain;
}

/* The heading row stays at the frame's top and the total at its bottom, each over the rows that
   pass under it on the canvas the table stands on; their corners stay over both. */
.table-head .chart-cell {
  position: sticky;
  inset-block-start: 0;
  z-index: 2;
  background: var(--color-canvas);
  box-shadow: inset 0 -1px var(--color-rule);

  &:first-child {
    z-index: 3;
  }
}

.table-total .chart-cell {
  position: sticky;
  inset-block-end: 0;
  z-index: 2;
  color: var(--color-text);
  background: var(--color-canvas);
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
   where it is longer (`SpendingTableName`). In a narrower table a heading may take a second line
   rather than widen its column past its figures. */
.chart-cell[data-numeric='true'] {
  inline-size: 1px;
}

.chart-heading[data-numeric='true'] {
  min-inline-size: 0;
  white-space: nowrap;
}

/* The name's column takes all the width the figures leave: as wide as the table, less what the
   figures' columns need, and never wider than its frame because of a long name. */
.chart-name {
  inline-size: 100%;
  min-inline-size: 12rem;
  max-inline-size: 0;
}

@container (width < 50rem) {
  .chart-heading[data-numeric='true'] {
    min-inline-size: 7em;
    white-space: normal;
  }
}
</style>
