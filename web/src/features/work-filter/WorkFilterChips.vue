<script setup lang="ts">
/**
 * The picked facets as chips, each one a button that takes itself out.
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

import type { WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** One of the labels will do, rather than every one of them. */
  labelsAny: boolean
  tokens: readonly WorkFilterToken[]
}>()

const emit = defineEmits<{
  /** Focus leaves the chips for the text, at its end. */
  leave: []
  remove: [token: WorkFilterToken]
}>()

const { t } = useI18n()
const id = useId()

const chips = computed(() => {
  const firstLabel = props.tokens.findIndex((token) => token.facet === 'labels')
  const word = t(`workItem.filter.labelsMatch.${props.labelsAny ? 'any' : 'all'}.join`)
  return props.tokens.map((token, index) => {
    const name = tokenName(token, t)
    // The word before it, from the second label on, which also describes the chip.
    const join = token.facet === 'labels' && index > firstLabel ? word : undefined
    const joinId = `${id}-join-${index}`
    return {
      key: tokenKey(token),
      name,
      join,
      joinId,
      describedBy: join && joinId,
      // Absent rather than false: the attribute is what the style reads.
      preset: token.facet === 'ready' || token.facet === 'held' || undefined,
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
      :data-preset="chip.preset"
    >
      <span
        v-if="chip.join"
        :id="chip.joinId"
        class="filter-chip-join"
        >{{ chip.join }}</span
      >
      <button
        class="filter-chip"
        type="button"
        :aria-describedby="chip.describedBy"
        :aria-label="chip.removeName"
        :title="chip.removeName"
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

/* The label chip's look — control fill, muted ink — one step up, because it
   sits inside a field that already has the control fill. */
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
  background: var(--color-surface-active);
  border-radius: var(--radius-control);
  cursor: pointer;

  /* A forced palette clears the fill, and two chips side by side read as one run of words. */
  @media (forced-colors: active) {
    outline: 1px solid ButtonText;
    outline-offset: -1px;
  }

  &:hover .filter-chip-remove {
    color: var(--color-text);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }
}

.filter-chip-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.filter-chip-remove {
  flex: 0 0 auto;
  color: var(--color-text-muted);
}

/* Where the presets stand pressed beside the field, a preset's chip would say
   the same thing twice. The width is the presets' own (see
   WorkFilterPresets): below it they fold into the menu and the chip is how a
   pressed one shows. */
@container workspace (width >= 1000px) {
  .filter-chip-item[data-preset] {
    display: none;
  }
}
</style>
