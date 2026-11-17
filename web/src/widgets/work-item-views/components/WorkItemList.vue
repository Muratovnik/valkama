<script setup lang="ts">
/**
 * The same work as rows, sortable by the columns that decide what to pick up.
 *
 * A table rather than a wall, because a list answers a different question:
 * across every state at once, what is urgent, what is unheld, what moved last.
 * Kanban answers where the work sits.
 *
 * The title is what a row is read for, so it takes the width the other columns
 * leave; they are as wide as what they hold, and the holder, whose values run
 * long, stops at a measure and ends in an ellipsis with the whole name on
 * hover. Where the list is too narrow for every column, columns give way in a
 * stated order rather than being pushed off the edge (`listColumns.ts`).
 *
 * The rows are one Tab stop, as the board's tiles are: the row last focused.
 * Enter on it or a click anywhere in a row opens the card, and closing the
 * card brings focus back to the row it was opened from (`useListKeys.ts`).
 *
 * A long list draws only the rows in and about its window, with gap rows for
 * the rest, and keeps the Tab stop and the row focus is in drawn wherever it
 * scrolls (`useWindowRows.ts`); a shorter one draws every row
 * (`useStagedRows.ts`). Since the browser's find would reach only the rows
 * drawn, Ctrl+F opens the list's own (`WorkItemListFind.vue`), which reads the
 * words of every row as `listRowWords.ts` says the template draws them.
 *
 * Every facet a row prints comes from the facet registry, in its words, and in
 * the order every surface reads an item in: the kind leads the reference as a
 * glyph, in a slot of its own so a reference stands where the one above it does;
 * the priority column says the priority, the default quietly, and where that
 * column has folded away the priority's glyph follows the reference instead; the holder column says nobody with a dash, never
 * «Можно брать», which is the norm of the backlog and the queue preset's to
 * ask; an open blocker is the one readiness a row says. The glyphs and the
 * labels filter, out of the Tab order: the row stays one stop, and the bar
 * reaches the same filter from the keyboard.
 *
 * Grouped by goal, the list is a tree (`useListTree.ts`) and a `treegrid`: the
 * whole scope as rows by depth, each goal and stage folding what is under it,
 * and under a filter what matched with the path to it, the path's rows in a
 * quieter tone with the count of what matched under them. The row itself takes
 * focus there, not its reference (`useListKeys.ts`); the role and the row's
 * level and place come from `treeRows.ts` alone. Which of the two the list is
 * is decided when it is made, so its host makes it again to change it.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useResizeObserver } from '@vueuse/core'

import { listRefCell } from '@/widgets/work-item-views/components/listRefCell.ts'
import WorkItemListFind from '@/widgets/work-item-views/components/WorkItemListFind.vue'
import WorkItemListHead from '@/widgets/work-item-views/components/WorkItemListHead.vue'
import WorkItemListTreeWords from '@/widgets/work-item-views/components/WorkItemListTreeWords.vue'
import { useListRuns } from '@/widgets/work-item-views/composables/useListRuns.ts'
import { useListSort } from '@/widgets/work-item-views/composables/useListSort.ts'
import { useListTreeRows } from '@/widgets/work-item-views/composables/useListTreeRows.ts'
import { useListWords } from '@/widgets/work-item-views/composables/useListWords.ts'
import { fitFor, isFolded, LIST_COLUMNS } from '@/widgets/work-item-views/utils/listColumns.ts'
import type { SortKey } from '@/widgets/work-item-views/utils/listColumns.ts'
import { factsOf, ROW_FACETS, rowWords } from '@/widgets/work-item-views/utils/listRowWords.ts'

import { holderRef, surfaceMarks } from '@/entities/work-item/utils/facets.ts'
import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { treeGridAttrs, treeRowAttrs } from '@/shared/lib/treeRows.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import { useListKeys } from '@/shared/ui/useListKeys.ts'
import { useWindowRows } from '@/shared/ui/useWindowRows.ts'
import type { ListEntry } from '@/shared/ui/useWindowRows.ts'

const props = withDefaults(
  defineProps<{
    items: WorkItemBrief[]
    links: PlanningEdge[]
    /** The filter in force, so a mark already in it offers to come out. */
    filter?: WorkFilter
    /**
     * The list grouped by goal: the whole scope before the filter, whether a
     * filter is in force, which makes `items` what it let through, and the space
     * whose fold choices it keeps. Null for the flat list.
     */
    tree?: { filtered: boolean; scope: WorkItemBrief[]; space: string } | null
  }>(),
  { filter: () => EMPTY_WORK_FILTER, tree: null },
)

const emit = defineEmits<{ filter: [token: WorkFilterToken]; open: [reference: string] }>()

const { t, locale } = useI18n()

/** The items a row can stand for: in a tree, the path to a match as well. */
const source = computed(() => props.tree?.scope ?? props.items)
const { ariaSort, descending, rows: sorted, sortBy, sortKey } = useListSort(() => source.value)

const root = ref<HTMLElement | null>(null)
const width = ref(0)
useResizeObserver(root, ([entry]) => {
  width.value = entry.contentRect.width
})
/**
 * The rows are drawn once the list knows its own width. Drawn before, a phone
 * drew a thousand rows with every column and at once drew them all again with
 * the columns folded, which doubled what opening the list cost there.
 */
const measured = ref(false)
const fit = computed(() => fitFor(width.value))
const wide = computed(() => fit.value === 'wide')
const narrow = computed(() => fit.value === 'narrow')

const tree = useListTreeRows({
  items: () => props.items,
  narrow: () => narrow.value,
  ordered: () => sorted.value,
  tree: () => props.tree,
})
const { cellTab, isPath, matchingOf, nameId } = tree
const { rows, treeOf, underOf } = tree

const { holderOf, updatedOf, widths } = useListWords(() => source.value, tree.indentOf)

// One listener each for the whole list rather than three on every row: a
// space of a thousand rows paid for three thousand of them on every opening.
const keys = useListKeys(
  root,
  () => list,
  (reference) => emit('open', reference),
  tree.focus,
)
const tabStop = (item: WorkItemBrief) => keys.tabStop(item.work_item_id)
const list = useWindowRows<WorkItemBrief>({
  columns: widths,
  key: (item) => item.work_item_id,
  // The Tab stop, whichever of these it is, and the row focus is in.
  pinned: () => [...keys.kept(), rows.value[0]?.work_item_id],
  root,
  rows: () => rows.value,
  ...tree.window,
})
onMounted(() => {
  width.value = root.value?.clientWidth ?? 0
  measured.value = true
})
const entries = computed(() => (measured.value ? list.entries.value : []))
const { rowCount } = list

const runs = useListRuns({
  filter: () => props.filter,
  items: () => source.value,
  links: () => props.links,
  narrow: () => narrow.value,
  onFilter: (token) => emit('filter', token),
  width,
})
const { context, fact, facts, filtering, lead, priorityWord, readWidth, waiting, word } = runs

const { HOLDER, STATE, STEPS, UNDER } = ROW_FACETS

const folded = (key: SortKey) => isFolded(fit.value, key)
/** A row's first cell, drawn with the row rather than as a component of its own. */
const refCell = listRefCell({ after: () => folded('priority'), glyph: lead, keys, tree })
const shownColumns = computed(() => LIST_COLUMNS.filter((column) => !folded(column.key)))
const foldedColumns = computed(() => LIST_COLUMNS.filter((column) => folded(column.key)))
const factFacets = computed(() => factsOf(fit.value))

/**
 * What a row depends on; walking a thousand rows redraws only the two focus moved
 * between. A row in a window is drawn again when its place moves.
 */
function memo(entry: ListEntry<WorkItemBrief>): unknown[] {
  if (entry.kind === 'gap') return [entry.height]
  const item = entry.row
  return [
    ...tree.memoOf(item),
    item,
    list.held(item),
    tabStop(item),
    waiting.value.get(item.work_item_id),
    fit.value,
    readWidth.value,
    props.filter,
    locale.value,
    entry.index,
  ]
}
const rowClass = (entry: ListEntry<WorkItemBrief>) =>
  entry.kind === 'gap' ? 'list-gap' : ['list-row', { 'list-row-held': list.held(entry.row) }]
const gapOf = (gap: { height: number }) => `${gap.height}px`

/**
 * What a row says to a reader: in a flat list its place where a window is
 * drawn; in a tree, from `treeRows.ts`, its level, its place beside its
 * siblings and whether it is open, with its name and, as a path, what it is.
 */
function rowAttrs(entry: ListEntry<WorkItemBrief>) {
  if (entry.kind === 'gap') return { 'aria-hidden': true }
  const row = treeOf(entry.row)
  if (!row) return { 'aria-rowindex': entry.rowIndex }
  return {
    ...treeRowAttrs(row, entry.rowIndex),
    'aria-description': tree.describedBy(row),
    'aria-labelledby': tree.labelledBy(entry.row),
    'data-id': row.id,
    'data-reference': entry.row.reference,
    'tabindex': tabStop(entry.row),
  }
}
const tableAttrs = computed(() =>
  tree.isTree
    ? treeGridAttrs({ rowCount: rowCount.value ?? 0, windowed: rowCount.value !== undefined })
    : { 'aria-rowcount': rowCount.value },
)

/** A row's words for the list's find, as the template below draws them. */
const said = (item: WorkItemBrief) =>
  rowWords(item, {
    context: context(item),
    fit: fit.value,
    tree: [matchingOf(item), underOf(item)].filter(Boolean),
    updated: updatedOf(item),
    words: runs.words,
  })
</script>

<template>
  <WorkItemListFind
    :list="list"
    :root="root"
    :rows="rows"
    :words="said"
  >
    <div
      ref="root"
      class="work-item-list"
      :data-fit="fit"
    >
      <table
        class="list-table"
        v-bind="tableAttrs"
        data-hint-list="rows"
      >
        <caption class="visually-hidden">
          {{
            t('workItem.list.caption')
          }}
        </caption>
        <WorkItemListHead
          :sort-state="ariaSort"
          :columns="shownColumns"
          :descending="descending"
          :folded="foldedColumns"
          :narrow="narrow"
          :sort-key="sortKey"
          @sort="sortBy"
        />
        <tbody>
          <tr
            v-for="entry in entries"
            :key="entry.key"
            :ref="list.measure"
            v-memo="memo(entry)"
            v-bind="rowAttrs(entry)"
            :data-index="entry.index"
            :class="rowClass(entry)"
          >
            <td
              v-if="entry.kind === 'gap'"
              class="list-gap-cell"
              :style="{ height: gapOf(entry) }"
            />
            <template v-else>
              <component
                :is="refCell(entry.row)"
                class="list-cell"
              />
              <td
                class="list-cell list-title"
                :tabindex="cellTab"
              >
                <span
                  :id="nameId(entry.row)"
                  v-slash-breaks="entry.row.title"
                  class="list-name"
                  :class="{ 'list-name-path': isPath(entry.row) }"
                />
                <WorkItemListTreeWords
                  v-if="tree.isTree"
                  :matching="matchingOf(entry.row)"
                  :parent="underOf(entry.row)"
                />
                <span
                  v-if="wide"
                  class="list-under"
                  ><component
                    :is="filtering(surfaceMarks('list', entry.row, context(entry.row), UNDER))"
                /></span>
                <span
                  v-else
                  class="list-facts"
                >
                  <component :is="facts(entry.row, factFacets, context(entry.row))" />
                  <!-- A dash says "nobody" under a heading; on a line of facts it says nothing. -->
                  <component
                    :is="facts(entry.row, HOLDER)"
                    v-if="holderRef(entry.row)"
                  />
                  <component
                    :is="facts(entry.row, STEPS)"
                    v-if="folded('checklist') && entry.row.checklist.length"
                  />
                  <span
                    v-if="folded('updated')"
                    class="list-fact"
                    >{{ updatedOf(entry.row) }}</span
                  >
                </span>
              </td>
              <td
                v-if="!folded('state')"
                class="list-cell"
                :tabindex="cellTab"
              >
                <component :is="fact(entry.row, STATE)" />
              </td>
              <td
                v-if="!folded('priority')"
                class="list-cell"
                :tabindex="cellTab"
              >
                <component :is="priorityWord(entry.row)" />
              </td>
              <td
                v-if="!folded('claim')"
                v-tooltip.clipped="holderOf(entry.row)"
                class="list-cell list-holder one-line"
                :tabindex="cellTab"
              >
                <component
                  :is="word(entry.row, HOLDER)"
                  class="list-claim"
                />
              </td>
              <td
                v-if="!folded('checklist')"
                class="list-cell"
                data-numeric="true"
                :tabindex="cellTab"
              >
                <component :is="word(entry.row, STEPS)" />
              </td>
              <td
                v-if="!folded('updated')"
                class="list-cell"
                :tabindex="cellTab"
              >
                {{ updatedOf(entry.row) }}
              </td>
            </template>
          </tr>
        </tbody>
      </table>
      <DataEmptyState
        v-if="!rows.length"
        :title="t('workItem.listEmpty')"
        compact
      />
    </div>
  </WorkItemListFind>
</template>

<style scoped>
/* A row focused from the keyboard stops below the sticky head rather than
   under it. Where a reference starts in its cell — the cell's inset and the
   two glyph slots before it — is declared here for the head, which starts the
   reference's heading there rather than over the glyphs. */
.work-item-list {
  --list-slot-size: var(--size-control-inline);
  --list-reference-start: calc(var(--space-3) + var(--list-slot-size) + var(--space-1));

  height: 100%;
  min-height: 0;
  background: var(--color-surface);
  overflow: auto;
  border-radius: var(--radius-card);
  scroll-padding-block: var(--size-control-height) var(--space-1);

  /* A forced palette clears the ground, and with it the list's bounds on the workspace. A
     border, outside the scroll: the sticky head lay over an outline drawn inside. */
  @media (forced-colors: active) {
    border: 1px solid currentcolor;
  }

  &[data-fit='narrow'] {
    --list-slot-size: var(--space-4);
  }
}

.list-table {
  width: 100%;
  border-collapse: collapse;
}

.list-cell[data-numeric='true'] {
  font-variant-numeric: tabular-nums;
  text-align: end;
}

/* The row the keyboard is on is marked as the row the pointer is over, and the
   whole row says it opens: a click anywhere on it opens the card. The folded
   facts are read, not followed, and keep the text cursor. */
.list-row {
  border-top: 1px solid var(--color-rule);
  cursor: pointer;

  &:hover,
  &:focus-within {
    background: var(--color-surface-hover);
  }
}

/* A tree's row takes focus itself, and its ring stands inside it: outside, the
   list's scroll cut it at the edges. */
.list-row:focus-visible {
  outline-offset: calc(-1 * var(--size-focus-ring));
}

/* Drawn only for the widths it gives its columns: in a short list's first frame,
   and outside a long list's window. */
.list-row-held {
  visibility: collapse;
}

/* A gap stands for the rows a long list does not draw, as tall as they are. */
.list-gap-cell {
  padding: 0;
}

.list-cell {
  vertical-align: baseline;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-muted);
  font: var(--font-line);
  white-space: nowrap;
}

.list-title {
  min-width: 16ch;
  color: var(--color-text);
  overflow-wrap: anywhere;
  white-space: normal;
}

/* A path row's title in the quiet tone of finished work; the words after it say
   what the tone alone would not: how much under it matched. */
.list-name-path {
  color: var(--color-text-muted);
}

/* An open blocker and the labels, on their own line under the title. */
.list-under {
  display: block;
  padding-top: var(--space-1);

  &:empty {
    display: none;
  }
}

/* The columns folded under the title, as one muted line of facts that wraps
   rather than running off the row. A fact does not wrap inside — a holder's
   name, «Waiting on MAIN-12» — so the line takes the title's width rather than
   lending the table its own, and a fact longer than that ends in an ellipsis. */
.list-facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  padding-top: var(--space-1);
  color: var(--color-text-muted);
  font: var(--font-detail);
  contain: inline-size;
}

.list-fact {
  min-width: 0;
}

/* The one column whose values run long stops at a measure, and the cell's
   padding is outside it; the cell is one line (`.one-line`), and the whole name is its
   hover while the cell cuts it. */
.list-holder {
  max-width: calc(10rem + 2 * var(--space-3));
}

.list-claim {
  cursor: inherit;
}
</style>
