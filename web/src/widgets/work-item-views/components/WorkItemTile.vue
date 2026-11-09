<script setup lang="ts">
/**
 * One work item as a sheet: its reference, its title, and only the facts that
 * change what a reader would do next.
 *
 * The first line is the item's head and what stops it: a kind glyph when it is
 * not a plain task, the reference, a priority glyph when the priority is not the
 * ordinary medium — the order every surface reads an item in (`drawHead`) — and
 * on the right only an open blocker, «⛔ MAIN-12». It never wraps; a mark short of
 * room keeps its glyph. Below it the title, at most three lines with the whole of
 * it on hover; the labels on one line, up to three whole chips and «+N» for the
 * rest, which opens the card like the rest of the sheet; and, only when there is
 * something to say, its executor and how far its steps are. The executor is the
 * glyph of the client that holds it, then what that client's session is doing, as
 * the side panel says it: dots that run while it works on the item, held still
 * while it works on others, a ring while it waits for a person. A stale claim's
 * glyph takes the stale tone, and a claim no session stands behind draws nothing.
 * The hover names who holds it and says the rest: the name and «Захват устарел» as
 * words were the longest things on the sheet after its title, and the card and the
 * hover card say both in full.
 *
 * Three tones rank what is on it, and only one thing leads: the title in the
 * full ink at the row-title weight; the holder and what stops the work in the
 * muted ink; the reference and the labels in the tertiary one. A finished tile's
 * title takes the muted ink too, so a column of a thousand closed items does not
 * stand level with the work still open.
 *
 * The tile used to print every facet as a word, defaults included: «Средний»
 * on most tiles, the kind word beside it, and «можно брать» on nearly every
 * tile of the two columns where it can be true at all, which is the norm
 * there and so says nothing. What each facet prints, and when, is the facet
 * registry's to say (`surface: 'tile'`); this file only places the runs.
 *
 * The open target is the title, stretched over the whole sheet, so the sheet
 * still opens wherever it is clicked and is still one Tab stop. The label
 * chips filter, and are buttons beside it rather than inside it, out of the
 * Tab order: a button cannot hold a button, and a board of a thousand tiles
 * stays a handful of Tab stops. The card's labels and the bar's filter reach
 * the same filter from the keyboard. The priority and kind glyphs are read,
 * not pressed — the registry says so for the tile — so they spend their
 * 14px and no pointer box, and the line keeps its room for what stops the
 * work. They and the exceptions lie above the open target to say on hover what
 * they stand for, so a press on them opens the card itself: for a pointer the
 * sheet is one target, and the keyboard's way in stays the open target.
 */
import { computed, h, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { drawHead, drawMarks } from '@/entities/work-item/components/drawMarks.ts'
import { useLabelFit } from '@/entities/work-item/composables/useLabelRoom.ts'
import { useMarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import { surfaceMarks } from '@/entities/work-item/utils/facets.ts'
import type { FacetContext, FacetId } from '@/entities/work-item/utils/facets.ts'
import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { LiveWork } from '@/shared/api/liveWorkModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = withDefaults(
  defineProps<{
    item: WorkItemBrief
    /** The filter in force, so a chip already in it offers to come out. */
    filter?: WorkFilter
    /** The element that says how the tile moves from the keyboard, if it can. */
    hintId?: string
    /** The keys the open target answers to, when the tile can be moved. */
    keyShortcuts?: string
    /** What an agent's session is doing on the item now, or nothing. */
    live?: LiveWork | null
    /** The open target is its stack's Tab stop (0), or reached by the arrows (-1). */
    tabStop?: 0 | -1
    /** The reference of an open item this one waits on, or nothing. */
    waitingOn?: string | null
  }>(),
  {
    filter: () => EMPTY_WORK_FILTER,
    hintId: undefined,
    keyShortcuts: undefined,
    live: null,
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
const open = () => emit('open', props.item.reference)

const { locale } = useI18n()
const id = useId()

/** The runs of the tile, in reading order; the registry decides each mark. */
const LEAD: readonly FacetId[] = ['kind', 'priority']
const EXCEPTIONS: readonly FacetId[] = ['readiness']
const LABELS: readonly FacetId[] = ['labels']
const FACTS: readonly FacetId[] = ['holder', 'steps']

/** The runs are drawn here as plain elements: a tile holds three or four, a board hundreds. */
const words = useMarkWords()
const context = computed<FacetContext>(() => ({ live: props.live, waitingOn: props.waitingOn }))
const leadRun = computed(() => surfaceMarks('tile', props.item, context.value, LEAD))
const exceptionRun = computed(() => surfaceMarks('tile', props.item, context.value, EXCEPTIONS))
const factRun = computed(() => surfaceMarks('tile', props.item, context.value, FACTS))
/** The number the head holds between its marks: read by the open target, not twice. */
const referenceNode = () =>
  h('span', { 'class': 'tile-reference', 'aria-hidden': 'true' }, props.item.reference)

/** The chips keep one line: as many as it has room for, and «+N» for the rest. */
const room = useLabelFit(useTemplateRef<HTMLElement>('labelLine'), {
  context: () => ({}),
  enabled: () => (props.item.labels?.length ?? 0) > 0,
  item: () => props.item,
  surface: () => 'tile',
  words,
})
const labelRun = computed(() =>
  surfaceMarks(
    'tile',
    props.item,
    room.value === undefined ? {} : { labelRoom: room.value },
    LABELS,
  ),
)

/**
 * What the chips say. A line's first reading changes its room and rarely its
 * chips, and a board's lines are all read in one frame; the runs keep what they
 * drew unless what they say has changed, so that frame redraws almost nothing.
 */
const labelKey = computed(() =>
  labelRun.value.map((mark) => mark.value).join(String.fromCodePoint(0)),
)

const exceptions = computed(() => exceptionRun.value.length > 0)

/** The head names its marks to the open target only when it has any beside the reference. */
const leadId = computed(() => (leadRun.value.length ? `${id}-lead` : undefined))
const exceptionsId = `${id}-exceptions`
const factsId = `${id}-facts`
/**
 * The title is the target's name; the priority and the kind, what stops the
 * work and who holds it are read after it, then the stack's hint about moving
 * it.
 */
const describedBy = computed(() => {
  const ids = [
    leadId.value ?? '',
    exceptions.value ? exceptionsId : '',
    factRun.value.length ? factsId : '',
    props.hintId ?? '',
  ].filter(Boolean)
  return ids.length ? ids.join(' ') : undefined
})
</script>

<template>
  <div
    class="work-item-tile"
    :class="{ finished: props.item.state.is_terminal }"
  >
    <span class="tile-line">
      <component
        :is="drawHead(leadRun, { surface: 'tile', words }, [referenceNode()])"
        :id="leadId"
        v-memo="[leadRun, locale, props.item.reference]"
        class="tile-lead"
        @click="open"
      />
      <component
        :is="drawMarks(exceptionRun, { fold: true, surface: 'tile', words })"
        v-if="exceptions"
        :id="exceptionsId"
        v-memo="[exceptionRun, locale]"
        class="tile-exceptions"
        @click="open"
      />
    </span>
    <button
      v-tooltip="props.item.title"
      class="tile-open"
      type="button"
      :tabindex="props.tabStop"
      :aria-keyshortcuts="props.keyShortcuts"
      :aria-describedby="describedBy"
      @click="open"
      @keydown="emit('keydown', $event)"
    >
      <span class="visually-hidden">{{ `${props.item.reference} ` }}</span>
      <strong
        v-slash-breaks="props.item.title"
        class="tile-title"
      />
    </button>
    <component
      :is="
        drawMarks(labelRun, {
          filter: props.filter,
          filterable: true,
          fit: true,
          onFilter: (token) => emit('filter', token),
          surface: 'tile',
          tabbable: false,
          words,
        })
      "
      v-if="labelRun.length"
      ref="labelLine"
      v-memo="[labelKey, props.filter, locale]"
      class="tile-labels"
    />
    <component
      :is="drawMarks(factRun, { surface: 'tile', words })"
      v-if="factRun.length"
      :id="factsId"
      v-memo="[factRun, locale]"
      class="tile-facts"
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
  padding: var(--space-3);
  background: var(--color-surface-sheet);
  border-radius: var(--radius-card);

  &:hover,
  &:has(.tile-open:focus-visible) {
    background: var(--color-surface-hover);
  }

  /* A forced palette clears the ground that was all its edge, and a column of tiles read
     as one run of text. The palette's ink draws the edge as a border. */
  @media (forced-colors: active) {
    border: 1px solid currentcolor;
  }

  /* The ring is drawn around the sheet, inside it. A tile fills the width of a
     column that clips its overflow, so a ring drawn outside lost both its sides
     there, and its top or bottom too wherever a scroll left the tile against
     the edge. In a forced palette the edge stays and the ring stands 2px inside
     it in the colour of what is chosen: on the edge, in the edge's ink, it only
     made the line thicker. */
  &:has(.tile-open:focus-visible) {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: -2px;

    @media (forced-colors: active) {
      outline-color: Highlight;
      outline-offset: -5px;
    }
  }

  &.finished .tile-open {
    color: var(--color-text-muted);
  }
}

/* Identity and exceptions on one line that never wraps: the reference keeps
   its width, and the exceptions on the right give way first. The gap is the
   one a glyph keeps from its word inside a mark, so the glyphs and the
   reference read as one run. */
.tile-line {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

/* The glyphs and a folded exception say on hover what they stand for; both
   come before the open target, which would otherwise lie over them and take
   the pointer. A press on them, or on the reference between them, opens the
   card all the same. */
.tile-lead,
.tile-exceptions {
  position: relative;
  z-index: 1;
  cursor: pointer;
}

/* The glyphs and the reference between them keep the line's own gap: the wider
   one between marks was room between the 28px pointer boxes they no longer have.
   The head keeps its width, and the exceptions give way.

   The reference is set in the line's own figures, as the blocker's reference at
   its end is. Tabular figures line digits up in a column, and nothing here is one:
   the glyphs before a reference vary from tile to tile, and what follows it stands
   at the line's end. They cost a four-digit reference six pixels, which is the
   difference in a desktop column between a blocker's reference shown whole and
   folded to its glyph, where the key is three letters; a longer key still folds,
   as any exception short of room does. The head keeps the line's tertiary ink for
   it, and its glyphs take their own. */
.tile-line > .tile-lead {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  column-gap: var(--space-1);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

.tile-exceptions {
  flex: 0 1 auto;
  min-width: 0;
  margin-inline-start: auto;
  overflow: hidden;
}

/* The title is the open target, and its box is stretched over the whole sheet,
   so the sheet opens wherever it is clicked; the filter buttons beside it lie
   above that box. The box says how far the pointer reaches, not how tall the
   title stands: with a control's height from the base rule, a title of one line
   stood in the middle of two. */
.tile-open {
  display: block;
  min-block-size: 0;
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
