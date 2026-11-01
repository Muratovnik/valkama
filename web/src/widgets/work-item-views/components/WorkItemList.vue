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
 * Every facet a row prints comes from the facet registry, in its words: the
 * priority and the kind lead the reference as glyphs, in two slots of their
 * own so a reference stands where the one above it does; the priority column
 * says the default quietly; the holder column says nobody with a dash, never
 * «Можно брать», which is the norm of the backlog and the queue preset's to
 * ask; an open blocker is the one readiness a row says. The glyphs and the
 * labels filter, out of the Tab order: the row stays one stop, and the bar
 * reaches the same filter from the keyboard.
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

import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'
import type { FacetContext } from '@/entities/work-item/utils/facets.ts'
import { waitingOn } from '@/entities/work-item/utils/waiting.ts'
import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'

const props = withDefaults(
  defineProps<{
    items: WorkItemBrief[]
    links: PlanningEdge[]
    /** The filter in force, so a mark already in it offers to come out. */
    filter?: WorkFilter
  }>(),
  { filter: () => EMPTY_WORK_FILTER },
)

const emit = defineEmits<{ filter: [token: WorkFilterToken]; open: [reference: string] }>()

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

const { holderOf, updatedOf } = useListWords(() => props.items)

const waiting = computed(() => waitingOn(props.links, props.items))
/**
 * What a row's marks need beyond the item. The width only decides whether
 * labels print, which happens from 900px of list, so a row is drawn again
 * when it crosses that and not on every pixel.
 */
function context(item: WorkItemBrief): FacetContext {
  return { waitingOn: waiting.value.get(item.work_item_id) ?? null, width: width.value }
}
/** The glyphs before a reference, one fixed slot each. */
const LEAD = ['priority', 'kind'] as const
/** A glyph is a 14px mark; on a phone's list it is read, and the bar filters. */
const glyphsFilter = computed(() => !narrow.value)

const folded = (key: SortKey) => isFolded(fit.value, key)
const shownColumns = computed(() => LIST_COLUMNS.filter((column) => !folded(column.key)))
const foldedColumns = computed(() => LIST_COLUMNS.filter((column) => folded(column.key)))
/** The state, where its column folded, and an open blocker, on the line of facts. */
const factFacets = computed(() =>
  folded('state') ? (['state', 'readiness'] as const) : (['readiness'] as const),
)

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
  return [
    item,
    tabStop(item),
    waiting.value.get(item.work_item_id),
    fit.value,
    width.value >= 900,
    props.filter,
    locale.value,
  ]
}

const pass = (token: WorkFilterToken) => emit('filter', token)

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
          <td class="list-cell list-ref-cell">
            <span class="list-ref">
              <FacetMarks
                v-for="facet in LEAD"
                :key="facet"
                class="list-slot"
                surface="list"
                :item="item"
                :facets="[facet]"
                :filter="props.filter"
                :filterable="glyphsFilter"
                :tabbable="false"
                lead
                @filter="pass"
              />
              <button
                type="button"
                class="list-open"
                :tabindex="tabStop(item)"
                :data-id="item.work_item_id"
                :data-reference="item.reference"
              >
                {{ item.reference }}
              </button>
            </span>
          </td>
          <td class="list-cell list-title">
            <span class="list-name">{{ item.title }}</span>
            <span
              v-if="wide"
              class="list-under"
              ><FacetMarks
                surface="list"
                :item="item"
                :facets="['readiness', 'labels']"
                :context="context(item)"
                :filter="props.filter"
                :tabbable="false"
                filterable
                @filter="pass"
            /></span>
            <span
              v-else
              class="list-facts"
            >
              <FacetMarks
                surface="list"
                :item="item"
                :facets="factFacets"
                :context="context(item)"
              />
              <!-- A dash says "nobody" under a heading; on a line of facts it says nothing. -->
              <FacetMarks
                v-if="item.claim_ref"
                surface="list"
                :item="item"
                :facets="['holder']"
              />
              <FacetMarks
                v-if="folded('checklist') && item.checklist.length"
                surface="list"
                :item="item"
                :facets="['steps']"
              />
              <span
                v-if="folded('updated')"
                class="list-fact"
                >{{ updatedOf(item) }}</span
              >
            </span>
          </td>
          <td
            v-if="!folded('state')"
            class="list-cell"
          >
            <FacetMarks
              surface="list"
              :item="item"
              :facets="['state']"
            />
          </td>
          <td
            v-if="!folded('priority')"
            class="list-cell"
          >
            <FacetMarks
              surface="list"
              :item="item"
              :facets="['priority']"
              :filter="props.filter"
              :tabbable="false"
              filterable
              @filter="pass"
            />
          </td>
          <td
            v-if="!folded('claim')"
            class="list-cell"
          >
            <FacetMarks
              class="list-claim"
              surface="list"
              :item="item"
              :facets="['holder']"
              :title="holderOf(item)"
            />
          </td>
          <td
            v-if="!folded('checklist')"
            class="list-cell"
            data-numeric="true"
          >
            <FacetMarks
              surface="list"
              :item="item"
              :facets="['steps']"
            />
          </td>
          <td
            v-if="!folded('updated')"
            class="list-cell"
          >
            {{ updatedOf(item) }}
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
   under it. Where a reference starts in its cell — the cell's inset and the
   two glyph slots before it — is declared here for the head, which starts the
   reference's heading there rather than over the glyphs. */
.work-item-list {
  --list-slot-size: var(--size-control-inline);
  --list-reference-start: calc(var(--space-3) + 2 * (var(--list-slot-size) + var(--space-1)));

  height: 100%;
  min-height: 0;
  background: var(--color-surface);
  overflow: auto;
  border-radius: var(--radius-card);
  scroll-padding-block: var(--size-control-height) var(--space-1);

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
}

/* The priority and the kind lead the reference, each in a slot of its own
   whether or not it has a glyph, so every reference starts where the one
   above it does. A slot is a line tall: the 28px a filtering glyph is hit by
   reaches past it into the row's own padding rather than heightening it. */
.list-slot {
  place-content: center center;
  vertical-align: middle;
  inline-size: var(--list-slot-size);
  block-size: 1lh;
  margin-inline-end: var(--space-1);
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

/* The one column whose values run long stops at a measure; the whole name is
   its hover. */
.list-claim {
  max-width: 10rem;
}
</style>
