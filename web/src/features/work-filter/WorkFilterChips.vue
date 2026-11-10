<script setup lang="ts">
/**
 * The picked facets as chips, each one a button that takes itself out. A
 * facet's value has a toggle before it, the operator (`ToggleChip`): «=» or,
 * pressed, «≠», which turns the value into one the work must not carry — Linear's
 * «is» and «is not», switched on the chip rather than asked for on every pick.
 *
 * They stand on the bar's line of state, beside the counts they explain,
 * rather than inside the field: at the widths the bar has, three chips left
 * the text no room. Each is a Tab stop; the field's caret also reaches the
 * last one with ←, the arrows move between them, and → past the last one, or
 * Escape, goes back to the text.
 *
 * The labels say how they combine, in the word between two of them, so the
 * filter reads whole without its menu open.
 */
import { computed, nextTick, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { tokenKey, tokenName } from '@/features/work-filter/filterOptions.ts'

import type { ValueToken, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import ToggleChip from '@/shared/ui/ToggleChip.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** One of the labels will do, rather than every one of them. */
  labelsAny: boolean
  tokens: readonly WorkFilterToken[]
}>()

const emit = defineEmits<{
  /** Focus leaves the chips for the text, at its end. */
  leave: []
  /** The value switched between «is» and «is not». */
  negate: [token: ValueToken]
  remove: [token: WorkFilterToken]
}>()

const { t } = useI18n()
const id = useId()

const chips = computed(() => {
  const firstLabel = props.tokens.findIndex((token) => token.facet === 'labels')
  const word = t(`workItem.filter.labelsMatch.${props.labelsAny ? 'any' : 'all'}.join`)
  const and = t('workItem.filter.labelsMatch.all.join')
  return props.tokens.map((token, index) => {
    const name = tokenName(token, t)
    // The word before it, from the second label on, which also describes the chip.
    // A label negated is kept out whatever «any» lets in, so the word before it is always «and».
    const joined = token.facet === 'labels' && token.not ? and : word
    const join = token.facet === 'labels' && index > firstLabel ? joined : undefined
    const joinId = `${id}-join-${index}`
    const value = 'value' in token ? token : undefined
    return {
      key: tokenKey(token),
      name,
      join,
      joinId,
      describedBy: join && joinId,
      // The operator's name is the value's whole, so it says what it would switch.
      operator: value && {
        token: value,
        pressed: value.not === true,
        sign: value.not ? '≠' : '=',
        name: t('workItem.filter.negate', {
          name: tokenName({ ...value, not: undefined } as ValueToken, t),
        }),
      },
      removeName: t('workItem.filter.remove', { name }),
      token,
    }
  })
})

const list = useTemplateRef<HTMLElement>('list')

/**
 * Focus a chip by its place; past either end is the caller's to decide. Read
 * from the list as drawn, which is in order and already without a chip just
 * taken out; a ref array in a loop keeps neither promise.
 */
function focusAt(index: number): boolean {
  const button = list.value?.querySelectorAll<HTMLButtonElement>('.filter-chip')[index]
  if (!button || button.offsetParent === null) return false
  button.focus()
  return true
}

function focusLast(): boolean {
  return focusAt(props.tokens.length - 1)
}

function remove(index: number) {
  const chip = chips.value[index]
  if (!chip) return
  emit('remove', chip.token)
  // The chip before takes focus, the next one when the first went, and the
  // text when none is left.
  void nextTick(() => focusAt(Math.max(0, index - 1)) || emit('leave'))
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
    :aria-label="t('workItem.filter.tokens')"
  >
    <li
      v-for="(chip, index) in chips"
      :key="chip.key"
      class="filter-chip-item"
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
          @toggle="emit('negate', chip.operator.token)"
        >
          <span class="filter-chip-sign">{{ chip.operator.sign }}</span>
        </ToggleChip>
        <button
          class="filter-chip"
          type="button"
          :aria-describedby="chip.describedBy"
          :aria-label="chip.removeName"
          @click="remove(index)"
          @keydown="keydown($event, index)"
        >
          <span class="filter-chip-name">{{ chip.name }}</span>
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
   squeezing every chip to its cross or leaving one where nothing reaches it. */
.filter-chip-item {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
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
   sits inside a field that already has the control fill. The fill is the pill's. */
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

.filter-chip-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.filter-chip-remove {
  color: var(--color-text-muted);
}
</style>

<style scoped src="@/shared/ui/reach.css"></style>
