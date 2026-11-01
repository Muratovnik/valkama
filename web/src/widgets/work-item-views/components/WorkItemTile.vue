<script setup lang="ts">
/**
 * One work item as a sheet: its reference, its title, and only the facts that
 * change what a reader would do next.
 *
 * The first line is the item's identity and its exceptions: a priority glyph
 * when the priority is not the ordinary medium, a kind glyph when it is not a
 * plain task, the reference, and on the right only what stops the work — an
 * open blocker, «Ждёт MAIN-12», and a claim whose session is gone. It never
 * wraps; a mark short of room keeps its glyph. Below it the title, at most
 * three lines with the whole of it on hover; the labels on one line, up to
 * three whole chips and «+N» for the rest, which opens the card like the rest
 * of the sheet; and who holds the item and how far its steps are, only when
 * there is something to say.
 *
 * The tile used to print every facet as a word, defaults included: «Средний»
 * on most tiles, the kind word beside it, and «можно брать» on nearly every
 * tile of the two columns where it can be true at all, which is the norm
 * there and so says nothing. What each facet prints, and when, is the facet
 * registry's to say (`surface: 'tile'`); this file only places the runs.
 *
 * The open target is the title, stretched over the whole sheet, so the sheet
 * still opens wherever it is clicked and is still one Tab stop. The marks that
 * filter — the glyphs and the label chips — are buttons beside it rather than
 * inside it, out of the Tab order: a button cannot hold a button, and a board
 * of a thousand tiles stays a handful of Tab stops. The card's labels and the
 * bar's filter reach the same filter from the keyboard.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'
import { printsFacet } from '@/entities/work-item/utils/facets.ts'
import type { FacetContext, FacetId } from '@/entities/work-item/utils/facets.ts'
import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'

const props = withDefaults(
  defineProps<{
    item: WorkItemBrief
    /** The filter in force, so a chip already in it offers to come out. */
    filter?: WorkFilter
    /** The element that says how the tile moves from the keyboard, if it can. */
    hintId?: string
    /** The keys the open target answers to, when the tile can be moved. */
    keyShortcuts?: string
    /** The open target is its stack's Tab stop (0), or reached by the arrows (-1). */
    tabStop?: 0 | -1
    /** The reference of an open item this one waits on, or nothing. */
    waitingOn?: string | null
  }>(),
  {
    filter: () => EMPTY_WORK_FILTER,
    hintId: undefined,
    keyShortcuts: undefined,
    tabStop: 0,
    waitingOn: null,
  },
)

// The stack's Tab stop, its keys and its hint belong to the open target, not to
// the sheet around it.
const emit = defineEmits<{
  filter: [token: WorkFilterToken]
  keydown: [event: KeyboardEvent]
  open: [reference: string]
}>()

const { t } = useI18n()
const id = useId()

/** The runs of the tile, in reading order; the registry decides each mark. */
const LEAD: readonly FacetId[] = ['priority', 'kind']
const EXCEPTIONS: readonly FacetId[] = ['readiness']
const LABELS: readonly FacetId[] = ['labels']
const FACTS: readonly FacetId[] = ['holder', 'steps']

const context = computed<FacetContext>(() => ({ waitingOn: props.waitingOn }))
const prints = (facets: readonly FacetId[]) =>
  facets.some((facet) => printsFacet(facet, 'tile', props.item, context.value))

/** A finished item's former holder is history, not a claim to act on. */
const staleClaim = computed(
  () => props.item.claim_state === 'stale' && !props.item.state.is_terminal,
)
const lead = computed(() => prints(LEAD))
const exceptions = computed(() => prints(EXCEPTIONS) || staleClaim.value)
const labels = computed(() => prints(LABELS))
const facts = computed(() => prints(FACTS))

const exceptionsId = `${id}-exceptions`
const factsId = `${id}-facts`
/**
 * The title is the target's name; what stops the work and who holds it are
 * read after it, then the stack's hint about moving it.
 */
const describedBy = computed(() => {
  const ids = [
    exceptions.value ? exceptionsId : '',
    facts.value ? factsId : '',
    props.hintId ?? '',
  ].filter(Boolean)
  return ids.length ? ids.join(' ') : undefined
})
</script>

<template>
  <div class="work-item-tile">
    <span class="tile-line">
      <span
        v-if="lead"
        class="tile-lead"
      >
        <FacetMarks
          surface="tile"
          :item="props.item"
          :facets="LEAD"
          :filter="props.filter"
          :tabbable="false"
          filterable
          @filter="emit('filter', $event)"
        />
      </span>
      <span
        class="tile-reference"
        aria-hidden="true"
        >{{ props.item.reference }}</span
      >
      <span
        v-if="exceptions"
        :id="exceptionsId"
        class="tile-exceptions"
      >
        <FacetMarks
          surface="tile"
          :item="props.item"
          :facets="EXCEPTIONS"
          :context="context"
          fold
        />
        <SemanticState
          v-if="staleClaim"
          class="tile-stale"
          dimension="claim-lease"
          state="stale"
          :label="t('workItem.lease.mark')"
        />
      </span>
    </span>
    <button
      class="tile-open"
      type="button"
      :tabindex="props.tabStop"
      :title="props.item.title"
      :aria-keyshortcuts="props.keyShortcuts"
      :aria-describedby="describedBy"
      @click="emit('open', props.item.reference)"
      @keydown="emit('keydown', $event)"
    >
      <span class="visually-hidden">{{ `${props.item.reference} ` }}</span>
      <strong class="tile-title">{{ props.item.title }}</strong>
    </button>
    <FacetMarks
      v-if="labels"
      class="tile-labels"
      surface="tile"
      :item="props.item"
      :facets="LABELS"
      :filter="props.filter"
      :tabbable="false"
      filterable
      fit
      @filter="emit('filter', $event)"
    />
    <FacetMarks
      v-if="facts"
      :id="factsId"
      class="tile-facts"
      surface="tile"
      :item="props.item"
      :facets="FACTS"
    />
  </div>
</template>

<style scoped>
/* A sheet, not a card in a frame: one tonal step above the ground it lies on,
   and no outline. The column already draws itself; a border here would be the
   third rectangle in a row. It is the ground the open target is stretched over,
   so it is what a drag picks up and what a click anywhere on it opens. */
.work-item-tile {
  /* A grid track is min-content wide unless told otherwise, and the min-content
     of a row of labels is those labels at full length — so the tile laid itself
     out wider than its own box and clipped the result inside its padding. */
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-1);
  padding: var(--space-2);
  background: var(--color-surface-sheet);
  border-radius: var(--radius-card);

  &:hover,
  &:has(.tile-open:focus-visible) {
    background: var(--color-surface-hover);
  }

  /* The ring is drawn around the sheet, inside it. A tile fills the width of a
     column that clips its overflow, so a ring drawn outside lost both its sides
     there, and its top or bottom too wherever a scroll left the tile against
     the edge. */
  &:has(.tile-open:focus-visible) {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }
}

/* Identity and exceptions on one line that never wraps: the reference keeps
   its width, and the exceptions on the right give way first. The glyphs' own
   boxes already pad them, so the gap is the small one. */
.tile-line {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* The glyphs filter, and the exceptions say on hover what a folded glyph
   stands for; both come before the open target, which would otherwise lie over
   them and take the pointer. */
.tile-lead,
.tile-exceptions {
  position: relative;
  z-index: 1;
}

.tile-lead {
  display: flex;
  flex: 0 0 auto;
}

.tile-reference {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tile-exceptions {
  display: flex;
  flex: 0 1 auto;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  margin-inline-start: auto;
  overflow: hidden;
}

.tile-stale {
  flex: 0 0 auto;
}

/* The title is the open target, and its box is stretched over the whole sheet,
   so the sheet opens wherever it is clicked; the filter buttons beside it lie
   above that box. */
.tile-open {
  display: block;
  padding: 0;
  border: 0;
  color: var(--color-text);
  text-align: start;
  background: none;
  cursor: pointer;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--radius-card);
  }

  /* The sheet draws the ring, around all of it rather than around the title. */
  &:focus-visible {
    outline: none;
  }
}

/* Three lines at most: a title of eight lines made the tile the tallest thing
   in its column. The whole title is the target's hover text and is in the card. */
.tile-title {
  display: -webkit-box;
  font: var(--font-row-title);
  overflow-wrap: anywhere;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

/* Centre, not baseline: a flex box hands its baseline to its first item, and
   a glyph is a box rather than a line of text, so baseline alignment drags the
   text beside it off the row they share. */
.tile-facts {
  display: flex;
  align-items: center;
}
</style>
