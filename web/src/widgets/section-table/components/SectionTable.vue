<script setup lang="ts">
/**
 * A table that fills its section: the page's heading over it (`head`), its notes (the default
 * slot), and its frame, held to about the window's height and scrolling inside itself both ways.
 * Its heading row stays at the frame's top edge and the names heading its rows at its start, each
 * held there by the browser as the frame scrolls (`position: sticky`), and a row brought into view
 * by the focus stands clear of the heading row and of a total the page keeps at the bottom edge
 * (`foot`). A table shorter than that height stands at its own. It holds no words of its own: its
 * name, its columns' and what an empty table says are the page's.
 *
 * Each column's heading sorts by it (`sort`, through the page's `useColumnSort`), and the sorted
 * column's heading is marked, in the ink of the figures with its arrow and a rule under it. A
 * column of figures is as wide as its figures need and the first column takes the rest. Whether
 * the columns fit the frame decides how the table stands, never the window's width
 * (`useTableFit`, its step on the root as `data-fit`): headings over figures on one line while
 * that keeps every column in the frame (`one`), on two once it would not (`two`), and every
 * column at the least that breaks no word where two lines still do not (`least`), the page
 * letting its own columns give way there; a page may keep its headings to two lines instead
 * (`least` off). Where even that does not fit, a table of figures keeps two lines and scrolls
 * sideways in its frame, the first column held at its start.
 *
 * The page's rows (`rows`) are rows of the table's body, each written with the cells the columns
 * name; a page whose rows are a tree's says so (`tree`). While the page has nothing to table yet
 * (`held`) the frame stays away and the page's `held` slot stands in its place. Asked to (`reveal`), the table brings itself into view with
 * the focus on it.
 *
 * The frame's height is the window's less what stands over the table, which the page says on the
 * table with `--size-section-table-over`.
 *
 * A table of records read as words rather than compared as figures, as Agent decisions' (`stack`),
 * stands as one block a record as soon as its columns do not fit its frame (`data-fit="stack"`),
 * at any width: the cells of a row flow on lines one after another, a cell the page gives a line
 * of its own taking it, and the heading row is a line of its sort buttons over them, held at the
 * frame's top. Stacked only on a phone, its frame showed «What was decided» past its edge at 1024
 * and 760.
 */
import { computed, ref } from 'vue'

import type { SortMark } from '@/widgets/section-table/composables/useColumnSort.ts'
import { useTableFit } from '@/widgets/section-table/composables/useTableFit.ts'
import type { TableFitRule } from '@/widgets/section-table/composables/useTableFit.ts'

import ChartTable from '@/shared/ui/ChartTable.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    /** The columns, the first one's heading over the names; each sorts the rows by its column. */
    columns: readonly { key: string; text: string; chosen?: boolean; numeric?: boolean }[]
    /** Nothing to table: the page's empty words stand in the frame's place. */
    empty: boolean
    /** What an empty table says. */
    emptyWords: { empty: string; emptyDescription?: string }
    /** The table's name: its caption, its frame's and the section's. */
    label: string
    /** The sorted column's mark, by its key. */
    marks: Partial<Record<string, SortMark>>
    /** The page has nothing to table yet: its `held` slot stands in the frame's place. */
    held?: boolean
    /** What changes what the table holds, which its headings' lines are measured again for. */
    holds?: readonly unknown[]
    /**
     * Where two lines over its figures do not fit, its columns come down to their least before it
     * scrolls; without it, its headings keep to two lines and it scrolls.
     */
    least?: boolean
    /** Where its columns do not fit, each row stands as a block of its cells rather than scrolling. */
    stack?: boolean
    /** The rows are a tree's, every one of them drawn (`ChartTable`). */
    tree?: boolean
    /** What a heading's press does, in words, for each column's words. */
    sortWords: (column: string) => string
  }>(),
  { held: false, holds: () => [], least: true, stack: false, tree: false },
)
/** A column's heading pressed to sort by it. */
const emit = defineEmits<{ sort: [column: string] }>()
defineSlots<{
  /** The notes between the heading and the frame. */
  default?: () => unknown
  /** The table's foot, a `<tfoot>` the page writes. */
  foot?: () => unknown
  /** The page's heading over the table. */
  head?: () => unknown
  /** What stands in the frame's place while the page has nothing to table yet. */
  held?: () => unknown
  /** The rows of the table's body. */
  rows?: () => unknown
}>()

const root = ref<HTMLElement | null>(null)

/**
 * A table with figures has headings to give room, and scrolls with them on two lines where even
 * its least does not fit; one of words alone stands as it is.
 */
const figures = computed(() => props.columns.some(({ numeric }) => numeric))
const rule = computed((): TableFitRule =>
  figures.value
    ? { steps: props.least ? ['one', 'two', 'least'] : ['one', 'two'], otherwise: 'two' }
    : { steps: ['one'], otherwise: 'one' },
)
/** How it stands in its frame: the first step whose columns fit, else stacked or scrolling. */
const fit = useTableFit(root, [() => props.holds, () => props.held], () =>
  props.stack ? { ...rule.value, otherwise: 'stack' } : rule.value,
)

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
    class="section-table"
    tabindex="-1"
    :data-fit="fit"
    :aria-label="label"
  >
    <slot name="head" />
    <slot />
    <slot
      v-if="held"
      name="held"
    />
    <ChartTable
      v-else
      class="section-table-frame"
      :label="label"
      :empty="empty"
      :words="emptyWords"
      :tree="tree"
    >
      <thead class="section-table-head">
        <tr class="table-head">
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            class="chart-cell chart-heading"
            :data-numeric="Boolean(column.numeric)"
            :data-chosen="Boolean(column.chosen)"
            :aria-sort="marks[column.key]?.aria"
          >
            <button
              v-tooltip.clipped="column.text"
              type="button"
              class="table-sort"
              :aria-description="sortWords(column.text)"
              @click="emit('sort', column.key)"
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
      <tbody class="section-table-body">
        <slot name="rows" />
      </tbody>
      <slot name="foot" />
    </ChartTable>
  </section>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped>
/* The heading, the notes and the frame, top to bottom, each as tall as it is. Its headings ask it
   how wide it is. Focused from a link to it, it rings itself inside its edge. */
.section-table {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
  container-type: inline-size;

  &:focus-visible {
    outline-offset: var(--space-half);
  }
}

/* The frame is held to the window's height, less what stands over the table and its own heading
   (`--size-section-table-over`, which the page declares on the table), so in Analytics at
   1280×800 and 1440×900 the table and its heading row stand in the window together; it scrolls inside itself
   both ways. A shorter table stands at its own height. Its heading row and a total stay at its
   edges and its names at its start, held by the browser as it scrolls: moved by the panel's scroll
   through a view timeline instead, they lagged a frame behind the rows and shook. The room kept at
   its edges (`scroll-padding`) is the heading row's two lines and a total's, or the room of the
   page's foot where it holds more (`--size-section-table-foot`), so a row the focus brings into
   view stands clear of both. */
.section-table-frame {
  max-block-size: calc(100dvh - var(--size-section-table-over, 13rem));
  overflow: auto;
  scroll-padding-block: 4rem var(--size-section-table-foot, 3rem);
}

/* The heading row over the rows, the names' corner over both. */
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

/* A chosen column, such as the measure, in the ink the figures of a chart are read in. */
.chart-cell[data-chosen='true'] {
  color: var(--color-text);
}

/* A row is one line: each figure and its heading take what they need, the first column the rest.
   Where the headings on one line would widen the table past its frame, they take a second line
   instead (`fit`). */
.chart-cell[data-numeric='true'] {
  inline-size: 1px;
}

.chart-heading[data-numeric='true'] {
  min-inline-size: 0;
  white-space: nowrap;
}

/* The headings over figures on two lines, each column at its least: the frame of a narrower table,
   or headings longer than its frame has room for on one line. A figure then stands inside the
   frame's edge rather than past it. Where the least would leave the table a sliver past its
   frame, the headings give it (`ChartTable`). */
.section-table[data-fit='two'] .chart-heading[data-numeric='true'] {
  min-inline-size: calc(7em - var(--chart-table-give, 0px));
  white-space: normal;
}

/* Where two lines still leave a column past the frame, each heading over figures is as narrow as
   its longest word, which it never breaks: at 1280 in Russian the goals of Volumes kept «Закрыто»
   and «При принятии» at 7em, 18px wider than their words, with «Осталось ≈» past the frame. */
.section-table[data-fit='least'] .chart-heading[data-numeric='true'] {
  white-space: normal;
}

/* A table of records as words whose columns do not fit (`stack`): each row a block whose cells
   flow on lines, the heading row a line of its sort buttons that stays at the frame's top. */
.section-table[data-fit='stack'] :is(.section-table-head, .section-table-body) {
  display: block;
}

.section-table[data-fit='stack'] .section-table-head {
  position: sticky;
  inset-block-start: 0;
  z-index: 3;
  background: var(--color-chart-table-ground, var(--color-canvas));
  box-shadow: inset 0 -1px var(--color-rule);
}

.section-table[data-fit='stack'] .table-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  padding: var(--space-2) var(--space-3);

  & .chart-cell {
    position: static;
    padding: 0;
    box-shadow: none;
  }
}

.section-table[data-fit='stack'] .section-table-body > :slotted(*) {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  padding: var(--space-2) var(--space-3);
}

.section-table[data-fit='stack'] :slotted(.chart-cell) {
  position: static;
  min-inline-size: 0;
  padding: 0;
  background: none;
}
</style>
