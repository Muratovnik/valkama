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
 * measure, or the total of a crossed table. Under the frame a line that never scrolls away says how
 * many rows it shows and how they are sorted, and downloads what it shows, in that order, as a CSV
 * file (`tableFile`); with no value to list it is disabled, and words say why.
 *
 * Its panel may set a control of its own before the second dimension's (`actions`).
 *
 * A row's name acts as its value does in the bars (`useLineActions`): a link to a task, or a
 * control that narrows the view to the value, sent out as `narrow`. Either is named by the value,
 * since it heads its row's cells; what pressing it does is its description. A value the page
 * names by the start of its id, an account, has the whole id under its name.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import type { CrossRead } from '@/pages/analytics/composables/useCrossRead.ts'
import { useLineActions } from '@/pages/analytics/composables/useLineActions.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { useTableModel } from '@/pages/analytics/composables/useTableModel.ts'
import type { TableLine } from '@/pages/analytics/composables/useTableModel.ts'
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
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import FieldError from '@/shared/ui/FieldError.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
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
const actions = useLineActions()

/** The crossed answer on show, once there is one for the second dimension chosen. */
const crossed = computed(() => {
  const read = props.cross
  return props.across && 'usage' in read && read.usage
    ? { across: props.across, usage: read.usage }
    : null
})
/** A second dimension is chosen and its read has not landed: it is being read, or failed. */
const waiting = computed(() => Boolean(props.across) && !crossed.value)
const acrossWords = computed(() => (props.across ? t(`analytics.byDimension.${props.across}`) : ''))

const model = useTableModel(() => ({
  by: props.by,
  measure: props.measure,
  usage: props.usage,
  cross: crossed.value,
}))

const NONE = 'none'
const acrossOptions = computed(() => [
  { value: NONE, label: t('analytics.panel.table.acrossNone') },
  ...props.dimensions
    .filter((dimension) => dimension !== props.by)
    .map((dimension) => ({ value: dimension, label: words.dimension(dimension) })),
])
function chooseAcross(value: string) {
  const chosen = props.dimensions.find((dimension) => dimension === value)
  emit('update:across', chosen ?? null)
}

const { sort, sortBy, lines, direction, marks } = useTableSort(model, () => locale.value)

/** Every column's heading, the names' first; each sorts the rows by its column. */
const headings = computed(() => [
  { key: NAME_COLUMN, text: words.dimension(props.by), chosen: false, numeric: false },
  ...model.value.columns.map((column) => ({ ...column, numeric: true })),
])

/** The line under the table: how many rows of how many, and their order. */
const summary = computed(() => {
  const column = headings.value.find(({ key }) => key === sort.value.column)?.text ?? ''
  const way = t(`analytics.panel.table.direction.${direction.value}`)
  const all = model.value.lines.length
  return [
    t('analytics.panel.table.rows', { shown: lines.value.length, all }),
    t('analytics.panel.table.sorted', { column, direction: way }),
  ].join(', ')
})

const nameOf = (value: UsageGroupValue) => words.valueLabel(props.by, value)

const linkOf = (line: TableLine) => actions.taskLink(props.by, line.value)
const narrowsTo = (line: TableLine) => actions.narrowsTo(props.by, line.value)

function follow(line: TableLine, event: MouseEvent) {
  const link = linkOf(line)
  if (link) actions.follow(link, event)
}

/** A middle press on a link opens it elsewhere, and is a press on it all the same. */
function followAside(line: TableLine, event: MouseEvent) {
  if (event.button === 1) follow(line, event)
}

const narrows = (line: TableLine) => !linkOf(line) && narrowsTo(line) !== undefined
const narrowDescription = (line: TableLine) => actions.narrowName(line.name)

function narrowTo(line: TableLine) {
  const value = narrowsTo(line)
  if (value !== undefined) emit('narrow', value, line.name)
}

/** Nothing to download: no value to list, or a crossed table not read yet. */
const nothing = computed(() => !model.value.lines.length)
const nothingId = useId()
const downloadNote = computed(() => (nothing.value ? nothingId : undefined))

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
    <SectionHeader
      as="h2"
      level="page"
      :title="model.title"
    >
      <template #actions="{ size }">
        <slot name="actions" />
        <ChoiceSelect
          class="spending-table-across"
          :size="size"
          :label="t('analytics.panel.table.across')"
          :model-value="across ?? NONE"
          :options="acrossOptions"
          @update:model-value="chooseAcross"
        />
      </template>
    </SectionHeader>
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
    <div
      v-if="waiting"
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
        role="status"
      >
        {{ t('analytics.panel.table.reading', { across: acrossWords }) }}
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
          <th
            scope="row"
            class="chart-cell chart-name"
          >
            <a
              v-if="linkOf(line)"
              class="chart-press"
              :href="linkOf(line)?.href"
              @click="(event: MouseEvent) => follow(line, event)"
              @auxclick="(event: MouseEvent) => followAside(line, event)"
            >
              {{ line.name }}
            </a>
            <button
              v-else-if="narrows(line)"
              type="button"
              class="chart-press"
              :aria-description="narrowDescription(line)"
              @click="narrowTo(line)"
            >
              {{ line.name }}
            </button>
            <template v-else>{{ line.name }}</template>
            <span
              v-if="line.detail"
              class="chart-detail"
              >{{ line.detail }}</span
            >
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
    <div class="spending-table-foot">
      <p
        v-if="!waiting && model.lines.length"
        class="spending-table-summary"
      >
        {{ summary }}
      </p>
      <span
        v-if="nothing"
        :id="nothingId"
        class="spending-table-note"
      >
        {{ t('analytics.table.nothingToDownload') }}
      </span>
      <VButton
        class="spending-download"
        size="compact"
        :disabled="nothing || waiting"
        :aria-describedby="downloadNote"
        @click="download"
      >
        {{ t('analytics.table.download') }}
      </VButton>
    </div>
  </section>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped>
/* The heading, the notes, the frame and the line under it, top to bottom: the frame takes what
   the panel leaves, and scrolls; the rest keep their size. */
.spending-table {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  min-block-size: 0;

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

/* The chosen measure, now and before, in the ink the figures of a chart are read in. */
.chart-cell[data-chosen='true'] {
  color: var(--color-text);
}

.spending-table-foot {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  justify-content: flex-end;
  align-items: center;
}

.spending-table-summary {
  flex: 1 1 16rem;
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
