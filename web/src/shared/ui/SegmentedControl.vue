<script setup lang="ts" generic="T extends string">
/**
 * One control for "pick one of a few visible alternatives".
 *
 * Four screens had grown their own: the planning view switch, two chart view
 * switches, and the session group filter. They agreed on nothing — border
 * radius, active treatment, height and keyboard behavior all differed — because
 * nothing owned the answer. A pressed segment is a lighter ground and a heavier
 * label, never the accent color: the accent means selection of an object, and
 * spending it on a view preference makes both meanings weaker.
 *
 * To the keyboard and a screen reader it is a radio group, the pattern for one choice of
 * a few (WAI-ARIA APG): Tab reaches the group once, on the chosen segment, and the arrows,
 * Home and End move focus and the choice together. It was a group of pressed buttons
 * before, each its own Tab stop, and the arrows a radio group answers to did nothing.
 *
 * A row that switches what a panel shows — a card's sections, Settings' sections, an
 * editor's Write and Preview — is tabs in that pattern, not a value: given `tabs`, the row is
 * a tab list, each segment a tab naming the panel it shows (`TabPanel` names it back), and
 * only Left, Right, Home and End move along it. Where a panel shows at once the arrows show
 * it as they reach its tab; where showing one starts work that takes a while (`manual`),
 * they move focus only, and Enter or Space shows it. A filter or a view of the same content
 * stays a radio group: picking one changes a value and no panel takes the tab's name.
 *
 * A radio group may hold no value yet, as a point of a review nobody has decided (`null`): no
 * segment is pressed, Tab stops on the first and chooses nothing, and an arrow or a press is
 * what chooses. A segment can say more about itself to a reader (`describedBy`), as Accept does
 * when choosing it opens a field below.
 *
 * A host that gives the row a line of its own makes it its line's width with a class on the
 * tag, and shares that width among the segments by `--segmented-option-grow`.
 */
import { computed } from 'vue'

import type { TabIds } from '@/shared/ui/tabIds.ts'

// The segment shape stays inline: naming it would have to be exported for the
// generic component's own declaration, and an export nothing imports is dead
// weight the dead-code gate is right to reject.
const props = withDefaults(
  defineProps<{
    label: string
    modelValue: T | null
    options: readonly {
      label: string
      value: T
      describedBy?: string
      disabled?: boolean
    }[]
    /** Whether the arrows show a tab's panel as they reach it, or Enter does. */
    activation?: 'automatic' | 'manual'
    /** `inline` rides a row of icon buttons: an editor's toolbar, at their 28px. */
    size?: 'default' | 'compact' | 'inline'
    /** The ids that make the row a tab list over the panel it shows. */
    tabs?: TabIds | null
  }>(),
  { size: 'default', tabs: null, activation: 'automatic' },
)

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

/** The segment the model is currently on, which the marks, the Tab stop and the keys ask about. */
function isCurrent(option: { value: T }) {
  return option.value === props.modelValue
}

function select(option: { value: T; disabled?: boolean }) {
  if (option.disabled || isCurrent(option)) return
  emit('update:modelValue', option.value)
}

/** A tab list over a panel, or a radio group of values. */
const groupRole = computed(() => (props.tabs ? 'tablist' : 'radiogroup'))

/** What a segment is to a screen reader: a tab naming the panel it shows, or a radio. */
function segmentRole(option: { value: T }) {
  const { tabs } = props
  if (!tabs) return { 'role': 'radio', 'aria-checked': isCurrent(option) }
  // Only the panel shown is in the page, so only its tab points at it.
  const shown = isCurrent(option)
  return {
    'id': tabs.tab(option.value),
    'role': 'tab',
    'aria-selected': shown,
    'aria-controls': shown ? tabs.panel(option.value) : undefined,
  }
}

/** The one Tab stop: the chosen segment, or the first that can be chosen when it cannot. */
const stop = computed(() => {
  const current = props.options.find((option) => isCurrent(option) && !option.disabled)
  return (current ?? props.options.find((option) => !option.disabled))?.value
})
function tabStop(option: { value: T }) {
  return option.value === stop.value ? 0 : -1
}

const STEPS: Record<string, (at: number, last: number) => number> = {
  ArrowRight: (at) => at + 1,
  ArrowDown: (at) => at + 1,
  ArrowLeft: (at) => at - 1,
  ArrowUp: (at) => at - 1,
  Home: () => 0,
  End: (_, last) => last,
}
/** A row of tabs is walked along the row; Up and Down are the page's. */
const ACROSS = new Set(['ArrowDown', 'ArrowUp'])

/** The next segment that can be chosen in the key's direction, around the ends. */
function step(key: string, from: number) {
  const last = props.options.length - 1
  const forward = key === 'ArrowRight' || key === 'ArrowDown' || key === 'Home'
  let at = STEPS[key]?.(from, last) ?? from
  for (let tried = 0; tried <= last; tried += 1) {
    at = (at + last + 1) % (last + 1)
    if (!props.options[at]?.disabled) return at
    at += forward ? 1 : -1
  }
  return from
}

function move(event: KeyboardEvent) {
  if (!Object.hasOwn(STEPS, event.key) || event.altKey || event.ctrlKey || event.metaKey) return
  if (props.tabs && ACROSS.has(event.key)) return
  const segment = event.currentTarget as HTMLButtonElement
  const segments = [...(segment.parentElement?.querySelectorAll('button') ?? [])]
  const from = segments.indexOf(segment)
  if (from < 0) return
  event.preventDefault()
  const to = step(event.key, from)
  // Without a scroll: a host that scrolls the row (the card's sections) brings the segment
  // into it, and a browser asked to show a segment stuck to the top of its scroller moves
  // the scroller to where the segment would stand unstuck.
  segments[to]?.focus({ preventScroll: true })
  const option = props.options[to]
  if (option && !(props.tabs && props.activation === 'manual')) select(option)
}
</script>

<template>
  <div
    class="segmented"
    :role="groupRole"
    :class="`size-${size}`"
    :aria-label="label"
  >
    <button
      v-for="option in options"
      v-bind="segmentRole(option)"
      :key="option.value"
      type="button"
      class="segmented-option"
      :class="{ active: isCurrent(option) }"
      :tabindex="tabStop(option)"
      :disabled="option.disabled"
      :aria-describedby="option.describedBy"
      @click="select(option)"
      @keydown="move"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
/* The track is a recessed ground and nothing more: its tone against the
   surface around it is the whole boundary. A track that was also outlined
   said the same thing twice, one hard divide on top of another.

   The track owns the row height and the segments are derived from it. It used
   to be the other way round — a 44px segment inside a 2px inset — so the track
   stood 48px next to a 44px button and the two never lined up in any toolbar
   they shared. A control that wraps another control cannot size the inner one
   and stay the same height as its neighbours. */
.segmented {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-half);
  min-height: var(--size-control-height);
  padding: var(--space-half);
  background: var(--color-surface-muted);
  border-radius: var(--radius-control);

  /* A forced palette clears this ground too, and with it the one boundary the segments
     share, so the ones not pressed read as words; the track takes an edge, as `VButton` does. */
  @media (forced-colors: active) {
    outline: 1px solid ButtonText;
    outline-offset: -1px;
  }
}

/* `compact` is for a control that rides a chart header, where the surrounding
   row is already shorter than a form row. Both sizes subtract the same inset,
   so a track keeps its exact declared height whichever it is. */
.segmented-option {
  flex-grow: var(--segmented-option-grow, 0);
  min-height: calc(var(--size-control-height) - 2 * var(--space-half));
  padding: 0 var(--space-5);
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-control);
  white-space: nowrap;
  background: transparent;

  /* A corner drawn inside another corner is the outer one less the space
     between them, or the two curves run at different speeds and the gap
     between them thins at the diagonal. Derived rather than measured, so the
     track can change radius without leaving this behind at six pixels. */
  border-radius: calc(var(--radius-control) - var(--space-half));
  cursor: pointer;
}

.segmented.size-compact {
  min-height: var(--size-control-height-compact);

  .segmented-option {
    min-height: calc(var(--size-control-height-compact) - 2 * var(--space-half));
    padding: 0 var(--space-3);
    font-size: var(--font-size-dense);
  }
}

.segmented.size-inline {
  min-height: var(--size-control-inline);

  .segmented-option {
    min-height: calc(var(--size-control-inline) - 2 * var(--space-half));
    padding: 0 var(--space-2);
    font-size: var(--font-size-dense);
  }
}

.segmented-option:hover:not(:disabled, .active) {
  color: var(--color-text);
}

.segmented-option.active {
  color: var(--color-text);
  font-weight: 600;
  background: var(--color-surface-active);

  /* A forced palette clears that ground and repaints the word, and the weight alone does
     not tell two short words apart. So the pressed segment takes the palette's own pair,
     as a pressed chip does, and chooses its own ring since it is out of the palette's reach. */
  @media (forced-colors: active) {
    color: HighlightText;
    background: Highlight;
    forced-color-adjust: none;

    &:focus-visible {
      outline-color: Highlight;
      outline-offset: 2px;
    }
  }
}

.segmented-option:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.segmented-option:focus-visible {
  outline: var(--size-focus-ring) solid var(--color-focus-ring);
  outline-offset: -2px;
}
</style>
