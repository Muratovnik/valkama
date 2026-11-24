<script setup lang="ts">
/**
 * What a filter holds as chips (`FacetFilter`), each one a button that takes
 * itself out; the host names each chip and says what taking it out does. A
 * value the host lets be negated has a toggle before it, the operator
 * (`ToggleChip`): «=» or, pressed, «≠», which turns the value into one the
 * filtered must not carry — Linear's «is» and «is not», switched on the chip
 * rather than asked for on every pick.
 *
 * The host places them, beside what they explain, rather than inside the
 * field: at the widths a bar has, three chips left the text no room. Each is a
 * Tab stop; the field's caret also reaches the last one with ←, the arrows
 * move between them, and → past the last one, or Escape, goes back to the text.
 *
 * A chip may follow a word that says how it combines with the one before
 * (`join`), which also describes it, so the filter reads whole without its
 * menu open. Each chip's item carries `data-filter-chip`, the hook a host
 * measures the chips by and a test selects them by.
 *
 * A chip keeps its words and the row wraps. A host that would rather a chip
 * yield its room, as the Analytics bar's one chip on a phone does beside its
 * «Clear filters», declares `--filter-chip-shrink: 1`: the chip then narrows to
 * what its row leaves, its name cut as a one-line label is, with its hint. A
 * name given in its two parts (`parts`) that has no room whole there drops the
 * words that say what the value is and shows the value's start: «Задача:» took
 * all of a 320px phone's room and the value showed as its ellipsis alone.
 */
import { computed, useId, useTemplateRef, watch } from 'vue'

import { placeFocus } from '@/shared/lib/scriptedFocus.ts'
import { vTextRuns } from '@/shared/ui/textRuns.ts'
import type { TextRun } from '@/shared/ui/textRuns.ts'
import ToggleChip from '@/shared/ui/ToggleChip.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

/** One chip, as its host names it. */
export interface FacetChip {
  /** Unique among the chips, and the same while the value is in either way. */
  key: string
  /** «Label: ui», whole; its hint where the chip cuts it. */
  name: string
  /** The remove button's name. */
  removeName: string
  /** The word before it, which says how it combines with the chip before. */
  join?: string
  /** The «is» / «is not» toggle, for a value that can be negated; named for what it would switch. */
  operator?: { name: string; pressed: boolean }
  /**
   * The name as the words that say what the value is and the value after them, «Задача: » and
   * «MAIN-1 One», the value as runs where it has them. A chip that yields its room
   * (`--filter-chip-shrink`) and has none for the whole name drops the words; `name` and the
   * remove button's name keep them. A chip not named yet says its name whole.
   */
  parts?: { lead: string; value: string; runs?: readonly TextRun[] }
  /**
   * The value's name is not read yet: the chip stands in the room of the widest chip, so the name
   * that comes in its place can only narrow it, as a cut name did.
   */
  pending?: boolean
  /** The name as runs, where it holds a title: a task's code drawn as code. */
  runs?: readonly TextRun[]
}

const props = defineProps<{
  chips: readonly FacetChip[]
  /** The list's name. */
  label: string
}>()

const emit = defineEmits<{
  /** Focus leaves the chips for the text, at its end. */
  leave: []
  /** The value switched between «is» and «is not». */
  negate: [key: string]
  remove: [key: string]
}>()

const id = useId()

const chips = computed(() =>
  props.chips.map((chip, index) => {
    const joinId = `${id}-join-${index}`
    return {
      ...chip,
      joinId,
      describedBy: chip.join && joinId,
      sign: chip.operator?.pressed ? '≠' : '=',
    }
  }),
)

const list = useTemplateRef<HTMLElement>('list')

/**
 * Focus a chip by its place; past either end is the caller's to decide. Read
 * from the list as drawn, which is in order and already without a chip just
 * taken out; a ref array in a loop keeps neither promise.
 */
function focusAt(index: number): boolean {
  const button = list.value?.querySelectorAll<HTMLButtonElement>('.filter-chip')[index]
  if (!button || button.offsetParent === null) return false
  placeFocus(button)
  return true
}

function focusLast(): boolean {
  return focusAt(props.chips.length - 1)
}

/**
 * The place of the chip last taken out, until the chips without it are drawn:
 * a host may take it out later than the press, as one whose filter rides the
 * address does once the route has moved.
 */
let removed: number | null = null

// The chip before takes focus, the next one when the first went, and the
// text when none is left.
watch(
  () => props.chips,
  () => {
    if (removed === null) return
    const index = removed
    removed = null
    if (!focusAt(Math.max(0, index - 1))) emit('leave')
  },
  { flush: 'post' },
)

function remove(index: number) {
  const chip = chips.value[index]
  if (!chip) return
  removed = index
  emit('remove', chip.key)
}

function keydown(event: KeyboardEvent, index: number) {
  switch (event.key) {
    case 'ArrowLeft': {
      focusAt(Math.max(0, index - 1))
      break
    }
    case 'ArrowRight': {
      if (!focusAt(index + 1)) emit('leave')
      break
    }
    case 'Backspace':
    case 'Delete': {
      remove(index)
      break
    }
    case 'Escape': {
      event.stopPropagation()
      emit('leave')
      break
    }
    default: {
      return
    }
  }
  event.preventDefault()
}

defineExpose({ focusLast })
</script>

<template>
  <ul
    v-if="chips.length"
    ref="list"
    class="filter-chips"
    :aria-label="label"
  >
    <li
      v-for="(chip, index) in chips"
      :key="chip.key"
      class="filter-chip-item"
      data-filter-chip
    >
      <span
        v-if="chip.join"
        :id="chip.joinId"
        class="filter-chip-join"
        >{{ chip.join }}</span
      >
      <span class="filter-chip-pill reach-grow">
        <ToggleChip
          v-if="chip.operator"
          v-tooltip.name="chip.operator.name"
          class="filter-chip-operator"
          :pressed="chip.operator.pressed"
          :aria-label="chip.operator.name"
          @toggle="emit('negate', chip.key)"
        >
          <span class="filter-chip-sign">{{ chip.sign }}</span>
        </ToggleChip>
        <button
          v-tooltip.clipped="chip.name"
          class="filter-chip"
          type="button"
          :class="{ 'filter-chip-pending': chip.pending }"
          :aria-describedby="chip.describedBy"
          :aria-label="chip.removeName"
          @click="remove(index)"
          @keydown="keydown($event, index)"
        >
          <span
            v-if="chip.parts && !chip.pending"
            class="filter-chip-name filter-chip-parts"
          >
            <span class="filter-chip-lead">{{ chip.parts.lead }}</span>
            <span
              v-if="chip.parts.runs"
              v-text-runs="chip.parts.runs"
              class="filter-chip-value one-line"
            />
            <span
              v-else
              class="filter-chip-value one-line"
              >{{ chip.parts.value }}</span
            >
          </span>
          <span
            v-else-if="chip.runs"
            v-text-runs="chip.runs"
            class="filter-chip-name one-line"
          />
          <span
            v-else
            class="filter-chip-name one-line"
            >{{ chip.name }}</span
          >
          <VIcon
            class="filter-chip-remove"
            name="close"
            :size="14"
          />
        </button>
      </span>
    </li>
  </ul>
</template>

<style scoped>
.filter-chips {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* A chip keeps its word; a row of them that runs out of room wraps rather than
   squeezing every chip to its cross or leaving one where nothing reaches it. A host may
   let it yield instead (`--filter-chip-shrink`), its name then cut at its end. */
.filter-chip-item {
  display: flex;
  flex: 0 var(--filter-chip-shrink, 0) auto;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
}

.filter-chip-join {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* The chip and its operator as one shape: the fill and the corners are the pill's. */
.filter-chip-pill {
  display: inline-flex;
  min-width: 0;
  background: var(--color-surface-active);
  border-radius: var(--radius-control);

  /* A forced palette clears the fill, and two chips side by side read as one run of words. */
  @media (forced-colors: active) {
    outline: 1px solid ButtonText;
    outline-offset: -1px;
  }
}

/* The operator is the product's toggle, pressed as every toggle is, drawn at the chip's
   height and in its words' size, on the pill's fill rather than a fill of its own. Its sign
   is all it shows, and the chip it opens onto leaves it no room to reach into: a reach would
   take the chip's own presses. So under a finger or at a phone's width the pill grows both
   boxes to the target (`reach-grow`, `reach.css`), the sign's square and the chip's height. */
.filter-chip-operator {
  justify-content: center;
  min-width: var(--size-control-inline);
  min-height: var(--size-control-inline);
  font: var(--font-detail);
  background: transparent;
}

/* The sign is as wide as the wider of the two whichever it shows: «=» and «≠» are not one width
   in the font, and a press grew or shrank the toggle by the difference, which moved its chip's
   words. Both signs stand under the one shown, of no height and unseen, and only
   their width counts. */
.filter-chip-sign {
  display: inline-flex;
  flex-direction: column;
  align-items: center;

  &::before,
  &::after {
    height: 0;
    overflow: hidden;
    visibility: hidden;
  }

  &::before {
    content: '=';
  }

  &::after {
    content: '≠';
  }
}

/* The label chip's look — control fill, muted ink — one step up, because it
   sits beside a field that already has the control fill. The fill is the pill's. */
.filter-chip {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  max-width: 22ch;
  min-height: var(--size-control-inline);
  padding: 0 var(--space-1) 0 var(--space-2);
  border: 0;
  color: var(--color-text);
  font: var(--font-detail);
  white-space: nowrap;
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  /* Beside the operator the sign already holds the start, so the words come closer. */
  .filter-chip-operator + & {
    padding-inline-start: 0;
  }

  &:hover .filter-chip-remove {
    color: var(--color-text);
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: 1px;
  }
}

/* A name in its two parts stands on one line, its value cut at its end. Where the chip yields its
   room (`--filter-chip-shrink`) the value comes first in the row and is drawn after the words
   (`row-reverse`), so a name with no room whole keeps the value on the line the box shows and
   wraps the words onto the line under it, out of sight and still counted as cut, so the hint
   says the name whole. Whether it wraps is the whole name's width against the chip's room, not
   what is cut now, so the words stand or go the same in every state of a width. */
.filter-chip-parts {
  display: flex;
  min-width: 0;
  max-block-size: 1lh;
  overflow: hidden;
}

.filter-chip-lead {
  flex: none;
  white-space: pre;
}

@container style(--filter-chip-shrink: 1) {
  .filter-chip-parts {
    flex-flow: row-reverse wrap;
    justify-content: flex-end;
  }

  .filter-chip-lead {
    order: 1;
  }
}

/* A chip whose value is not named yet takes the widest chip's room, its cross at its end, or
   what its row leaves of it where the chip yields (`--filter-chip-shrink`). */
.filter-chip-pending {
  justify-content: space-between;
  width: 22ch;
}

.filter-chip-remove {
  color: var(--color-text-muted);
}
</style>

<style scoped src="@/shared/ui/reach.css"></style>
