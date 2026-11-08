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
 * Every facet a row prints comes from the facet registry, in its words, and in
 * the order every surface reads an item in: the kind leads the reference as a
 * glyph, in a slot of its own so a reference stands where the one above it does;
 * the priority column says the priority, the default quietly, and where that
 * column has folded away the priority's glyph follows the reference instead; the holder column says nobody with a dash, never
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
import { useStagedRows } from '@/widgets/work-item-views/composables/useStagedRows.ts'
import { fitFor, isFolded, LIST_COLUMNS } from '@/widgets/work-item-views/utils/listColumns.ts'
import type { SortKey } from '@/widgets/work-item-views/utils/listColumns.ts'

import { drawMarks, drawWordCell } from '@/entities/work-item/components/drawMarks.ts'
import { useMarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import {
  facetMarks,
  holderRef,
  leadMarks,
  surfaceMarks,
} from '@/entities/work-item/utils/facets.ts'
import type { FacetContext, FacetId, FacetMark } from '@/entities/work-item/utils/facets.ts'
import { waitingOn } from '@/entities/work-item/utils/waiting.ts'
import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'

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
const fit = computed(() => fitFor(width.value))
const wide = computed(() => fit.value === 'wide')
const narrow = computed(() => fit.value === 'narrow')

const { holderOf, updatedOf } = useListWords(() => props.items)

const words = useMarkWords()
/** The first word a row's facet prints, as a width in its column. */
const facetWord = (item: WorkItemBrief, facet: FacetId) => {
  const [mark] = facetMarks(facet, 'list', item)
  return mark ? words.say(mark.text) : ''
}
const staged = useStagedRows<WorkItemBrief>({
  columns: [
    { font: '--font-line', word: (item) => item.reference },
    { font: '--font-line', word: (item) => item.title },
    { font: '--font-field-label', word: (item) => item.state.name },
    { font: '--font-detail', word: (item) => facetWord(item, 'priority') },
    { font: '--font-detail', word: holderOf },
    { font: '--font-detail', word: (item) => facetWord(item, 'steps') },
    { font: '--font-line', word: updatedOf },
  ],
  root: () => root.value,
  rows: () => rows.value,
})
onMounted(() => {
  width.value = root.value?.clientWidth ?? 0
  measured.value = true
  staged.stage()
})
const drawnRows = computed(() => (measured.value ? staged.rows.value : []))
const heldForWidths = (item: WorkItemBrief) => staged.held(item)

const waiting = computed(() => waitingOn(props.links, props.items))
/**
 * What a row's marks need beyond the item. The width only decides whether
 * labels print, which happens from 900px of list, so a row is drawn again
 * when it crosses that and not on every pixel.
 */
function context(item: WorkItemBrief): FacetContext {
  return { waitingOn: waiting.value.get(item.work_item_id) ?? null, width: width.value }
}
/** A glyph is a 14px mark; on a phone's list it is read, and the bar filters. */
const glyphsFilter = computed(() => !narrow.value)

/** The facets of a row's runs, each in the place the row gives it. */
const UNDER: readonly FacetId[] = ['readiness', 'labels']
const STATE: readonly FacetId[] = ['state']
const PRIORITY: readonly FacetId[] = ['priority']
const HOLDER: readonly FacetId[] = ['holder']
const STEPS: readonly FacetId[] = ['steps']

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
    staged.held(item),
    tabStop(item),
    waiting.value.get(item.work_item_id),
    fit.value,
    width.value >= 900,
    props.filter,
    locale.value,
  ]
}

const pass = (token: WorkFilterToken) => emit('filter', token)

/**
 * A row's runs are drawn here as plain elements. A row holds seven of them, and
 * a component for each came to eleven instances a row, some fourteen thousand on
 * a space of a thousand rows, for marks that hold no state of their own.
 */
const facts = (item: WorkItemBrief, facets: readonly FacetId[], asked: FacetContext = {}) =>
  drawMarks(surfaceMarks('list', item, asked, facets), { surface: 'list', words })
/** One mark in a cell of its own. */
const fact = (item: WorkItemBrief, facet: readonly FacetId[]) =>
  drawMarks(surfaceMarks('list', item, {}, facet), { solo: true, surface: 'list', words })
/** A run that filters, out of the Tab order: the row stays one stop. */
const filtering = (marks: readonly FacetMark[], filterable = true) =>
  drawMarks(marks, {
    filter: props.filter,
    filterable,
    onFilter: pass,
    surface: 'list',
    tabbable: false,
    words,
  })
/** A column's word, the mark and nothing round it. */
const word = (item: WorkItemBrief, facets: readonly FacetId[]) =>
  drawWordCell(surfaceMarks('list', item, {}, facets), { surface: 'list', words })
const priorityWord = (item: WorkItemBrief) =>
  drawWordCell(surfaceMarks('list', item, {}, PRIORITY), {
    filter: props.filter,
    filterable: true,
    onFilter: pass,
    surface: 'list',
    tabbable: false,
    words,
  })
/** The glyph before a reference, in its fixed slot. */
const lead = (item: WorkItemBrief, facet: FacetId) =>
  filtering(leadMarks(facet, 'list', item), glyphsFilter.value)

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
          :class="{ 'list-row-held': heldForWidths(item) }"
        >
          <td class="list-cell list-ref-cell">
            <component
              :is="lead(item, 'kind')"
              class="list-slot"
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
            <component
              :is="lead(item, 'priority')"
              v-if="folded('priority')"
              class="list-after"
            />
          </td>
          <td class="list-cell list-title">
            <span
              v-slash-breaks="item.title"
              class="list-name"
            />
            <span
              v-if="wide"
              class="list-under"
              ><component :is="filtering(surfaceMarks('list', item, context(item), UNDER))"
            /></span>
            <span
              v-else
              class="list-facts"
            >
              <component :is="facts(item, factFacets, context(item))" />
              <!-- A dash says "nobody" under a heading; on a line of facts it says nothing. -->
              <component
                :is="facts(item, HOLDER)"
                v-if="holderRef(item)"
              />
              <component
                :is="facts(item, STEPS)"
                v-if="folded('checklist') && item.checklist.length"
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
            <component :is="fact(item, STATE)" />
          </td>
          <td
            v-if="!folded('priority')"
            class="list-cell"
          >
            <component :is="priorityWord(item)" />
          </td>
          <td
            v-if="!folded('claim')"
            class="list-cell list-holder"
          >
            <component
              :is="word(item, HOLDER)"
              class="list-claim"
              :title="holderOf(item)"
            />
          </td>
          <td
            v-if="!folded('checklist')"
            class="list-cell"
            data-numeric="true"
          >
            <component :is="word(item, STEPS)" />
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

/* In the first frame only for the widths it gives its columns. */
.list-row-held {
  visibility: collapse;
}

.list-cell {
  vertical-align: baseline;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-muted);
  font: var(--font-line);
  white-space: nowrap;
}

/* A line of the row, not a control standing in it: at the base rule's height it
   pushed the row's shared baseline down, and every title with it. The whole row
   is what a pointer presses, so this box only has to hold the keyboard's focus. */
.list-open {
  min-block-size: 0;
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

/* The kind leads the reference in a slot of its own whether or not it has a
   glyph, so every reference starts where the one above it does. A slot is a
   line tall: a filtering glyph's 28px reaches into the row's padding. A filled
   slot stands on the row's baseline, which puts its glyph on the middle of the
   reference's letters; an empty one on that middle, or it would heighten the row. */
.list-slot {
  place-content: center center;
  vertical-align: baseline;
  inline-size: var(--list-slot-size);
  block-size: 1lh;
  margin-inline-end: var(--space-1);

  &:empty {
    vertical-align: middle;
  }
}

/* The priority's glyph after the reference, where its column has folded away. */
.list-after {
  margin-inline-start: var(--space-1);
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
   padding is outside it; the whole name is its hover. */
.list-holder {
  max-width: calc(10rem + 2 * var(--space-3));
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-claim {
  cursor: inherit;
}
</style>
