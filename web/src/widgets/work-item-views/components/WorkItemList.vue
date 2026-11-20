<script setup lang="ts">
/**
 * The same work as rows, in the queue's order unless the view says another, and
 * sortable by the columns that decide what to pick up.
 *
 * A table rather than a wall, because a list answers a different question:
 * across every state at once, what is urgent, what is unheld, what moved last.
 * Kanban answers where the work sits.
 *
 * The title is what a row is read for, so it takes the width the other columns
 * leave; they are as wide as what they hold, and the holder, whose values run
 * long, stops at a measure and ends in an ellipsis with the whole name on
 * hover. Where the list is too narrow for every column, columns give way in a
 * stated order rather than being pushed off the edge (`listColumns.ts`). «Project»
 * stands only where the host gives the space's projects: a space of several, with no
 * project chosen, as a tile marks its project.
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
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { listFindWords } from '@/widgets/work-item-views/components/listFindWords.ts'
import { listGroupCell, listRefCell } from '@/widgets/work-item-views/components/listRefCell.ts'
import { listUnderTitle } from '@/widgets/work-item-views/components/listUnderTitle.ts'
import WorkItemListFind from '@/widgets/work-item-views/components/WorkItemListFind.vue'
import WorkItemListHead from '@/widgets/work-item-views/components/WorkItemListHead.vue'
import WorkItemListTreeWords from '@/widgets/work-item-views/components/WorkItemListTreeWords.vue'
import { useListFit } from '@/widgets/work-item-views/composables/useListFit.ts'
import { useListGoalSpend } from '@/widgets/work-item-views/composables/useListGoalSpend.ts'
import { useListRuns } from '@/widgets/work-item-views/composables/useListRuns.ts'
import { useListTreeRows } from '@/widgets/work-item-views/composables/useListTreeRows.ts'
import type { ListTreeScope } from '@/widgets/work-item-views/composables/useListTreeRows.ts'
import { useListWords } from '@/widgets/work-item-views/composables/useListWords.ts'
import type { SpaceProject } from '@/widgets/work-item-views/utils/boardLanes.ts'
import { drawnColumns, isFolded, sortsChosen } from '@/widgets/work-item-views/utils/listColumns.ts'
import type { SortKey } from '@/widgets/work-item-views/utils/listColumns.ts'
import { ROW_FACETS } from '@/widgets/work-item-views/utils/listRowWords.ts'
import { orderedWork, QUEUE_ORDER } from '@/widgets/work-item-views/utils/workOrder.ts'
import type { ViewSort } from '@/widgets/work-item-views/utils/workOrder.ts'

import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { treeGridAttrs, treeRowAttrs } from '@/shared/lib/treeRows.ts'
import { useStandingName } from '@/shared/lib/useStateName.ts'
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
    /** A goal's row says what it spent: the list's work is in the store the read answers for. */
    goalVolumes?: boolean
    /**
     * The space's projects where a row names its own; null where the list draws no
     * «Project». Read as the list is made, as `tree` is: its host makes it again to change it.
     */
    projects?: readonly SpaceProject[] | null
    /** The order the rows stand in, which the host keeps; in a tree, inside each container. */
    sort?: ViewSort
    /** The whole space, where each row's goal and stages are found; the rows' own by default. */
    spaceItems?: WorkItemBrief[]
    /**
     * The list grouped by goal or by project: the whole scope before the filter,
     * whether a filter is in force, which makes `items` what it let through, and the
     * space whose fold choices it keeps. Null for the flat list.
     */
    tree?: ListTreeScope | null
  }>(),
  { filter: () => EMPTY_WORK_FILTER, tree: null, sort: () => QUEUE_ORDER },
)

/** A mark asks for a filter; a row opens a card by its reference; a column header asks for an order. */
const emit = defineEmits<{ filter: [WorkFilterToken]; open: [string]; sort: [ViewSort] }>()

const { t, locale } = useI18n()

/** The items a row can stand for: in a tree, the path to a match as well. */
const source = computed(() => props.tree?.scope ?? props.items)
const stateName = useStandingName()
const space = () => props.spaceItems ?? source.value
const sorted = computed(() => orderedWork(source.value, props.sort, stateName, { space: space() }))

/** The tree by goal shows where a row stands by its place, so it draws no «Goal and stage». */
const drawsGoal = !props.tree || props.tree.grouping === 'project'
/** The list by project names a row's project by its group. */
const projects = () => (props.tree?.grouping === 'project' ? null : (props.projects ?? null))
const drawsProject = Boolean(projects())
const columns = drawnColumns({ goal: drawsGoal, project: drawsProject })

const root = ref<HTMLElement | null>(null)
// The tree's first column is wider by its lead, which the other columns do not have.
const { fit, measured, narrow, width } = useListFit(root, drawsGoal && drawsProject, () =>
  tree.lead(),
)

const tree = useListTreeRows({
  items: () => props.items,
  narrow: () => narrow.value,
  ordered: () => sorted.value,
  tree: () => props.tree,
})
const { cellTab, isGroup, isPath, matchingOf, nameId, rows, treeOf, underOf } = tree

const words = useListWords(() => source.value, tree.indentOf, space, projects)
const { goalCellOf, goalOf, holderOf, projectCellOf, projectOf, updatedOf, widths } = words

// One listener each for the whole list rather than three on every row: a
// space of a thousand rows paid for three thousand of them on every opening.
// A group's row is named by its id where a card's is by its reference: it folds instead.
const openRow = (reference: string) =>
  tree.isGroup({ work_item_id: reference }) ? keys.toggle(reference) : emit('open', reference)
const keys = useListKeys(root, () => list, openRow, tree.focus)
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
const entries = computed(() => (measured.value ? list.entries.value : []))
const { rowCount } = list
const spend = useListGoalSpend(props, entries, tree)
const spendLine = spend.line

const runs = useListRuns({
  filter: () => props.filter,
  items: () => source.value,
  links: () => props.links,
  narrow: () => narrow.value,
  onFilter: (token) => emit('filter', token),
  width,
})
const { fact, lead, priorityWord, readWidth, waiting, word } = runs

const { HOLDER, STATE, STEPS } = ROW_FACETS

const folded = (key: SortKey) => isFolded(fit.value, key)
/** A row's first cell, drawn with the row rather than as a component of its own. */
const refCell = listRefCell({ after: () => folded('priority'), glyph: lead, keys, tree })
const shownColumns = computed(() => columns.filter((column) => !folded(column.key)))
const groupCell = listGroupCell({ columns: () => shownColumns.value.length, keys, tree })
const foldedColumns = computed(() => columns.filter((column) => folded(column.key)))

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
    goalOf(item),
    list.held(item),
    tabStop(item),
    spend.memoOf(item),
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
    'data-reference': tree.referenceOf(entry.row),
    'tabindex': tabStop(entry.row),
  }
}
const tableAttrs = computed(() =>
  tree.isTree
    ? treeGridAttrs({ rowCount: rowCount.value ?? 0, windowed: rowCount.value !== undefined })
    : { 'aria-rowcount': rowCount.value },
)
/** What a row prints under its title; «Goal › Stage» leads it where its column folded. */
const underTitle = listUnderTitle({
  fit: () => fit.value,
  folded,
  goal: (item) => (drawsGoal && folded('goal') ? goalOf(item) : ''),
  project: (item) => (drawsProject && folded('project') ? projectOf(item) : ''),
  runs,
  updated: updatedOf,
})

/** A row's words for the list's find, as the template below draws them. */
const said = listFindWords({ drawsGoal, drawsProject, fit, runs, spend, tree, words })
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
          :columns="shownColumns"
          :folded="foldedColumns"
          :choice="sortsChosen(fit)"
          :sort="props.sort"
          @sort="emit('sort', $event)"
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
            <component
              :is="groupCell(entry.row)"
              v-else-if="isGroup(entry.row)"
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
                <component :is="underTitle(entry.row)" />
                <component :is="spendLine(entry.row)" />
              </td>
              <td
                v-if="drawsGoal && !folded('goal')"
                v-tooltip.clipped="goalOf(entry.row)"
                class="list-cell list-goal one-line"
                :tabindex="cellTab"
              >
                {{ goalCellOf(entry.row) }}
              </td>
              <td
                v-if="drawsProject && !folded('project')"
                v-tooltip.clipped="projectOf(entry.row)"
                class="list-cell list-project one-line"
                :tabindex="cellTab"
              >
                {{ projectCellOf(entry.row) }}
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
   reference's heading there; the cells and the sorts share one inset, halved on a
   narrow list, as DESIGN.md says under «Work». */
.work-item-list {
  --space-list-inset: var(--space-3);
  --list-slot-size: var(--size-control-inline);
  --list-reference-start: calc(var(--space-list-inset) + var(--list-slot-size) + var(--space-1));

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
    --space-list-inset: var(--space-2);
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
  padding: var(--space-2) var(--space-list-inset);
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

/* An open blocker and the labels, on their own line under the title; empty, an inline
   box that takes no room. */
.list-under:not(:empty) {
  display: block;
  padding-top: var(--space-1);
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

/* The columns whose values run long stop at a measure, and the cell's padding is
   outside it; the cell is one line (`.one-line`), and the whole name or path is its
   hover while the cell cuts it. */
.list-holder,
.list-goal,
.list-project {
  max-width: calc(10rem + 2 * var(--space-list-inset));
}

.list-claim {
  cursor: inherit;
}
</style>
