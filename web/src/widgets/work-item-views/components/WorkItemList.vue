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
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useResizeObserver } from '@vueuse/core'

import WorkItemListHead from '@/widgets/work-item-views/components/WorkItemListHead.vue'
import { useListKeys } from '@/widgets/work-item-views/composables/useListKeys.ts'
import { useListSort } from '@/widgets/work-item-views/composables/useListSort.ts'
import { useListWords } from '@/widgets/work-item-views/composables/useListWords.ts'
import { fitFor, isFolded, LIST_COLUMNS } from '@/widgets/work-item-views/utils/listColumns.ts'
import type { SortKey } from '@/widgets/work-item-views/utils/listColumns.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'

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
/**
 * The rows are drawn once the list knows its own width. Drawn before, a phone
 * drew a thousand rows with every column and at once drew them all again with
 * the columns folded, which doubled what opening the list cost there.
 */
const measured = ref(false)
onMounted(() => {
  width.value = root.value?.clientWidth ?? 0
  measured.value = true
})
const drawnRows = computed(() => (measured.value ? rows.value : []))
const fit = computed(() => fitFor(width.value))
const wide = computed(() => fit.value === 'wide')
const narrow = computed(() => fit.value === 'narrow')

const { ready, wordsOf } = useListWords(() => props.items)

/** A dash says "nobody" under a heading; on a line of facts it says nothing, so it is left out. */
function holdsClaimFact(item: WorkItemBrief): boolean {
  return wordsOf(item).claim !== '—'
}

const folded = (key: SortKey) => isFolded(fit.value, key)
const shownColumns = computed(() => LIST_COLUMNS.filter((column) => !folded(column.key)))
const foldedColumns = computed(() => LIST_COLUMNS.filter((column) => folded(column.key)))

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

// One listener each for the whole list rather than three on every row: a
// space of a thousand rows paid for three thousand of them on every opening.
useListKeys(root, {
  focus: (id) => {
    active.value = id
  },
  open: (reference) => emit('open', reference),
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
          v-for="item in drawnRows"
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
                >{{ wordsOf(item).stepsFact }}</span
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
            {{ wordsOf(item).steps }}
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
