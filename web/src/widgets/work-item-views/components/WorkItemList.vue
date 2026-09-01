<script setup lang="ts">
/**
 * The same work as rows, sortable by the columns that decide what to pick up.
 *
 * A table rather than a wall, because a list answers a different question:
 * across every state at once, what is urgent, what is unheld, what moved last.
 * Kanban answers where the work sits.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { PRIORITIES, readyIds } from '@/shared/api/planningModel.ts'
import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  items: WorkItemBrief[]
  links: PlanningEdge[]
}>()

const emit = defineEmits<{ open: [reference: string] }>()

const { t, d } = useI18n()

type SortKey = 'reference' | 'title' | 'state' | 'priority' | 'claim' | 'checklist' | 'updated'

const sortKey = ref<SortKey>('updated')
const descending = ref(true)

const ready = computed(() => readyIds(props.items))

const urgency = new Map(PRIORITIES.map((priority, index) => [priority, PRIORITIES.length - index]))

function steps(item: WorkItemBrief): { done: number; total: number } {
  return {
    done: item.checklist.filter((step) => step.done).length,
    total: item.checklist.length,
  }
}

/**
 * The three cells whose content is a decision, named where the decision is made.
 *
 * A column that sorts numerically must carry the mark and every other column must
 * not carry it at all — `data-numeric="false"` styles as a truthy attribute
 * selector, which is how the text columns once came out right-aligned.
 */
const numericMark = (column: { numeric?: boolean }) => (column.numeric ? 'true' : undefined)

/** Who holds the item, or whether it is there to be taken. */
function claimLabel(item: WorkItemBrief): string {
  if (item.claim_ref) return item.claim_ref
  return ready.value.has(item.work_item_id) ? t('workItem.ready') : '—'
}

/** Checklist progress, or a dash for an item that declares no steps. */
function checklistLabel(item: WorkItemBrief): string {
  const progress = steps(item)
  return progress.total ? t('workItem.checklistProgress', progress) : '—'
}

function value(item: WorkItemBrief, key: SortKey): number | string {
  if (key === 'reference') return item.number
  if (key === 'title') return item.title.toLocaleLowerCase()
  if (key === 'state') return item.state.name.toLocaleLowerCase()
  if (key === 'priority') return urgency.get(item.priority) ?? 0
  if (key === 'claim') return item.claim_ref.toLocaleLowerCase()
  if (key === 'checklist') {
    const { done, total } = steps(item)
    return total ? done / total : -1
  }
  return item.updated_at
}

const rows = computed(() => {
  const key = sortKey.value
  const direction = descending.value ? -1 : 1
  return [...props.items].sort((left, right) => {
    const a = value(left, key)
    const b = value(right, key)
    if (a === b) return left.number - right.number
    return (a > b ? 1 : -1) * direction
  })
})

function sortBy(key: SortKey) {
  if (sortKey.value === key) descending.value = !descending.value
  else {
    sortKey.value = key
    // The columns people scan for "what changed" and "what is urgent" read
    // newest and highest first; a name reads A to Z.
    descending.value = key === 'updated' || key === 'priority' || key === 'checklist'
  }
}

function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
  if (sortKey.value !== key) return 'none'
  return descending.value ? 'descending' : 'ascending'
}

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'reference', label: 'workItem.list.reference', numeric: true },
  { key: 'title', label: 'workItem.list.title' },
  { key: 'state', label: 'workItem.list.state' },
  { key: 'priority', label: 'workItem.list.priority' },
  { key: 'claim', label: 'workItem.list.claim' },
  { key: 'checklist', label: 'workItem.list.checklist', numeric: true },
  { key: 'updated', label: 'workItem.list.updated' },
]
</script>

<template>
  <div class="work-item-list">
    <table class="list-table">
      <caption class="visually-hidden">
        {{
          t('workItem.list.caption')
        }}
      </caption>
      <thead>
        <tr>
          <th
            v-for="column in COLUMNS"
            :key="column.key"
            class="list-head"
            scope="col"
            :aria-sort="ariaSort(column.key)"
            :data-numeric="numericMark(column)"
          >
            <button
              type="button"
              class="list-sort"
              @click="sortBy(column.key)"
            >
              {{ t(column.label) }}
              <VIcon
                v-if="sortKey === column.key"
                name="chevron-down"
                class="list-sort-mark"
                :class="{ ascending: !descending }"
                :size="14"
              />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in rows"
          :key="item.work_item_id"
          class="list-row"
        >
          <td
            class="list-cell"
            data-numeric="true"
          >
            <button
              type="button"
              class="list-open"
              @click="emit('open', item.reference)"
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
          </td>
          <td class="list-cell">
            <SemanticState
              dimension="work-item-state"
              :state="item.state.category"
              :label="item.state.name"
            />
          </td>
          <td class="list-cell">{{ t(`priority.${item.priority}`) }}</td>
          <td class="list-cell list-claim">
            {{ claimLabel(item) }}
          </td>
          <td
            class="list-cell"
            data-numeric="true"
          >
            {{ checklistLabel(item) }}
          </td>
          <td class="list-cell">{{ when(item.updated_at) }}</td>
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
.work-item-list {
  height: 100%;
  min-height: 0;
  background: var(--color-surface);
  overflow: auto;
  border-radius: var(--radius-card);
}

.list-table {
  width: 100%;
  border-collapse: collapse;
}

/* The head stays while the rows move, because a sorted column with its label
   scrolled away is a column of unexplained values. */
.list-head {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0;
  text-align: start;
  white-space: nowrap;
  background: var(--color-surface);
}

:is(.list-head, .list-cell)[data-numeric='true'] {
  font-variant-numeric: tabular-nums;
  text-align: end;
}

.list-sort {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-column-head);
  text-align: inherit;
  background: none;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--color-text);
  }

  .list-head[data-numeric='true'] & {
    justify-content: flex-end;
  }
}

/* One chevron, turned over. The icon set holds no upward chevron, and adding a
   second glyph to say the opposite of the first is how two marks for one idea
   start to disagree. */
.list-sort-mark.ascending {
  transform: rotate(180deg);
}

.list-row {
  border-top: 1px solid var(--color-rule);

  &:hover {
    background: var(--color-surface-hover);
  }
}

.list-cell {
  vertical-align: baseline;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-muted);
  font: var(--font-line);
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
  color: var(--color-text);

  .list-kind {
    margin-inline-start: var(--space-2);
  }
}

.list-kind {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.list-claim {
  overflow-wrap: anywhere;
}
</style>
