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
 * ↑ and ↓ walk the rows, Home and End go to the ends, Enter opens the card,
 * and closing the card brings focus back to the row it was opened from.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener, useResizeObserver } from '@vueuse/core'

import { useListSort } from '@/widgets/work-item-views/composables/useListSort.ts'
import { useListWords } from '@/widgets/work-item-views/composables/useListWords.ts'
import {
  fitFor,
  isFolded,
  LIST_COLUMNS,
  stepsOf,
} from '@/widgets/work-item-views/utils/listColumns.ts'
import type { ListColumn, SortKey } from '@/widgets/work-item-views/utils/listColumns.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  items: WorkItemBrief[]
  links: PlanningEdge[]
}>()

const emit = defineEmits<{ open: [reference: string] }>()

const { t, locale } = useI18n()

const { ariaSort, descending, rows, sortBy, sortKey } = useListSort(() => props.items)

const root = ref<HTMLElement | null>(null)
const width = ref(0)
useResizeObserver(root, ([entry]) => {
  width.value = entry.contentRect.width
})
const fit = computed(() => fitFor(width.value))
const wide = computed(() => fit.value === 'wide')

const { ready, wordsOf } = useListWords(() => props.items)

/**
 * The three cells whose content is a decision, named where the decision is made.
 *
 * A column that sorts numerically must carry the mark and every other column must
 * not carry it at all — `data-numeric="false"` styles as a truthy attribute
 * selector, which is how the text columns once came out right-aligned.
 */
const numericMark = (column: { numeric?: boolean }) => (column.numeric ? 'true' : undefined)

/** Checklist progress as a fraction under the «Steps» heading, or a dash for none. */
function checklistLabel(item: WorkItemBrief): string {
  const progress = stepsOf(item)
  return progress.total ? t('workItem.list.steps', progress) : '—'
}

/** A dash says "nobody" under a heading; on a line of facts it says nothing, so it is left out. */
function holdsClaimFact(item: WorkItemBrief): boolean {
  return wordsOf(item).claim !== '—'
}

/** The same progress as a fact under the title, where no heading names it. */
function checklistFact(item: WorkItemBrief): string {
  return t('workItem.checklistProgress', stepsOf(item))
}

const folded = (key: SortKey) => isFolded(fit.value, key)
const shownColumns = computed(() => LIST_COLUMNS.filter((column) => !folded(column.key)))
const foldedColumns = computed(() => LIST_COLUMNS.filter((column) => folded(column.key)))

/** The sorts a heading offers: its own, and on the title's the columns folded under it. */
function sortsIn(column: ListColumn): ListColumn[] {
  return column.key === 'title' ? [column, ...foldedColumns.value] : [column]
}

function headClass(column: ListColumn) {
  return { 'list-head-title': column.key === 'title' }
}

/** A sort a heading carries for a column folded under it, rather than its own. */
function sortClass(sort: ListColumn, column: ListColumn) {
  return { folded: sort.key !== column.key }
}

/**
 * The row that is the list's Tab stop: the one last focused while it is still
 * listed, otherwise the first. Held by item, so it follows a row a sort moved.
 */
const active = ref<string | null>(null)
const stop = computed(() => {
  const held = rows.value.some((item) => item.work_item_id === active.value)
  return held ? active.value : (rows.value[0]?.work_item_id ?? null)
})

function tabStop(item: WorkItemBrief): 0 | -1 {
  return item.work_item_id === stop.value ? 0 : -1
}

/** What a row depends on; walking a thousand rows redraws only the two focus moved between. */
function memo(item: WorkItemBrief): unknown[] {
  return [item, tabStop(item), ready.value.has(item.work_item_id), fit.value, locale.value]
}

/** The row button an event happened on, if it happened on one. */
function rowButton(event: Event): HTMLElement | null {
  const target = event.target as Partial<Element> | null
  return target?.closest?.<HTMLElement>('.list-open') ?? null
}

/** A bare arrow, Home or End moves focus between rows and scrolls nothing else. */
function walked(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const row = rowButton(event)?.closest('tr')
  const body = row?.parentElement
  if (!row || !body) return
  const next = {
    ArrowDown: row.nextElementSibling,
    ArrowUp: row.previousElementSibling,
    End: body.lastElementChild,
    Home: body.firstElementChild,
  }[event.key]
  if (next === undefined) return
  event.preventDefault()
  next?.querySelector<HTMLElement>('.list-open')?.focus()
}

// One listener each for the whole list rather than three on every row: a
// space of a thousand rows paid for three thousand of them on every opening.
useEventListener(root, 'keydown', walked)
useEventListener(root, 'focusin', (event: FocusEvent) => {
  const id = rowButton(event)?.dataset.id
  if (id !== undefined) active.value = id
})
useEventListener(root, 'click', (event: MouseEvent) => {
  const reference = rowButton(event)?.dataset.reference
  if (reference !== undefined) emit('open', reference)
})
</script>

<template>
  <div
    ref="root"
    class="work-item-list"
    :data-fit="fit"
  >
    <table class="list-table">
      <caption class="visually-hidden">
        {{
          t('workItem.list.caption')
        }}
      </caption>
      <thead>
        <tr>
          <th
            v-for="column in shownColumns"
            :key="column.key"
            scope="col"
            class="list-head"
            :class="headClass(column)"
            :aria-sort="ariaSort(column.key)"
            :data-numeric="numericMark(column)"
          >
            <span class="list-sorts">
              <button
                v-for="sort in sortsIn(column)"
                :key="sort.key"
                type="button"
                class="list-sort"
                :class="sortClass(sort, column)"
                @click="sortBy(sort.key)"
              >
                {{ t(sort.label) }}
                <VIcon
                  v-if="sortKey === sort.key"
                  name="chevron-down"
                  class="list-sort-mark"
                  :class="{ ascending: !descending }"
                  :size="14"
                />
              </button>
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in rows"
          :key="item.work_item_id"
          v-memo="memo(item)"
          class="list-row"
        >
          <td
            class="list-cell"
            data-numeric="true"
          >
            <button
              type="button"
              class="list-open"
              :tabindex="tabStop(item)"
              :data-id="item.work_item_id"
              :data-reference="item.reference"
            >
              {{ item.reference }}
            </button>
          </td>
          <td class="list-cell list-title">
            <span class="list-name">{{ item.title }}</span>
            <span
              v-if="item.kind !== 'task'"
              class="list-kind"
              >{{ t(`workItem.kind.${item.kind}`) }}</span
            >
            <span
              v-if="!wide"
              class="list-facts"
            >
              <SemanticState
                v-if="folded('state')"
                dimension="work-item-state"
                :state="item.state.category"
                :label="item.state.name"
              />
              <span class="list-fact">{{ t(`priority.${item.priority}`) }}</span>
              <span
                v-if="holdsClaimFact(item)"
                class="list-fact list-fact-claim"
                >{{ wordsOf(item).claim }}</span
              >
              <span
                v-if="folded('checklist') && item.checklist.length"
                class="list-fact"
                >{{ checklistFact(item) }}</span
              >
              <span
                v-if="folded('updated')"
                class="list-fact"
                >{{ wordsOf(item).updated }}</span
              >
            </span>
          </td>
          <td
            v-if="!folded('state')"
            class="list-cell"
          >
            <SemanticState
              dimension="work-item-state"
              :state="item.state.category"
              :label="item.state.name"
            />
          </td>
          <td
            v-if="!folded('priority')"
            class="list-cell"
          >
            {{ t(`priority.${item.priority}`) }}
          </td>
          <td
            v-if="!folded('claim')"
            class="list-cell"
          >
            <span
              class="list-claim"
              :title="wordsOf(item).claim"
              >{{ wordsOf(item).claim }}</span
            >
          </td>
          <td
            v-if="!folded('checklist')"
            class="list-cell"
            data-numeric="true"
          >
            {{ checklistLabel(item) }}
          </td>
          <td
            v-if="!folded('updated')"
            class="list-cell"
          >
            {{ wordsOf(item).updated }}
          </td>
        </tr>
      </tbody>
    </table>
    <DataEmptyState
      v-if="!rows.length"
      :title="t('workItem.listEmpty')"
      compact
    />
  </div>
</template>

<style scoped>
/* A row focused from the keyboard stops below the sticky head rather than
   under it. */
.work-item-list {
  height: 100%;
  min-height: 0;
  background: var(--color-surface);
  overflow: auto;
  border-radius: var(--radius-card);
  scroll-padding-block: var(--size-control-height) var(--space-1);
}

.list-table {
  width: 100%;
  border-collapse: collapse;
}

/* The head stays while the rows move, because a sorted column with its label
   scrolled away is a column of unexplained values. Every column but the title
   is as wide as what it holds; the title takes the rest. */
.list-head {
  position: sticky;
  top: 0;
  z-index: 1;
  vertical-align: bottom;
  width: 1%;
  padding: 0;
  text-align: start;
  white-space: nowrap;
  background: var(--color-surface);
}

.list-head-title {
  width: auto;
  white-space: normal;
}

:is(.list-head, .list-cell)[data-numeric='true'] {
  font-variant-numeric: tabular-nums;
  text-align: end;
}

/* A heading's sorts: one, or on the title's heading the title's and those of
   the columns folded under it, side by side. */
.list-sorts {
  display: flex;
  flex-wrap: wrap;

  .list-head[data-numeric='true'] & {
    justify-content: flex-end;
  }
}

.list-sort {
  display: inline-flex;
  flex: 1 1 auto;
  gap: var(--space-1);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-column-head);
  text-align: inherit;
  white-space: nowrap;
  background: none;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--color-text);
  }

  .list-head[data-numeric='true'] & {
    justify-content: flex-end;
  }

  .list-sorts:has(> :nth-child(2)) > & {
    flex: 0 0 auto;
  }

  /* The sorts of the folded columns follow the title's own as one run, in the
     order their facts take under the title, set apart by a dot that is not
     part of any name. */
  &.folded {
    padding-inline: var(--space-1);

    &::before {
      content: '·' / '';
      padding-inline-end: var(--space-1);
    }
  }
}

/* One chevron, turned over. The icon set holds no upward chevron, and adding a
   second glyph to say the opposite of the first is how two marks for one idea
   start to disagree. */
.list-sort-mark.ascending {
  transform: rotate(180deg);
}

/* The row the keyboard is on is marked as the row the pointer is over. */
.list-row {
  border-top: 1px solid var(--color-rule);

  &:hover,
  &:focus-within {
    background: var(--color-surface-hover);
  }
}

.list-cell {
  vertical-align: baseline;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-muted);
  font: var(--font-line);
  white-space: nowrap;
}

.list-open {
  padding: 0;
  border: 0;
  color: var(--color-text);
  font: inherit;
  font-variant-numeric: tabular-nums;
  background: none;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    text-decoration: underline;
  }
}

.list-title {
  min-width: 16ch;
  color: var(--color-text);
  overflow-wrap: anywhere;
  white-space: normal;

  .list-kind {
    margin-inline-start: var(--space-2);
  }
}

.list-kind {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

/* The columns folded under the title, as one muted line of facts that wraps
   rather than running off the row. */
.list-facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  padding-top: var(--space-1);
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.list-fact {
  min-width: 0;
}

.list-fact-claim {
  overflow-wrap: anywhere;
}

/* The one column whose values run long stops at a measure; the whole name is
   its hover. */
.list-claim {
  display: block;
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
