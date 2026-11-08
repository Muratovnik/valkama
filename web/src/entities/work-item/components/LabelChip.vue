<script setup lang="ts">
/**
 * One label as a chip, wherever a label stands alone: `drawChip` says how it looks.
 *
 * Where it can be taken off its item, the chip ends in a ×, a button of its own beside the
 * one that filters, drawn inside the chip's face. It shows while the chip is pointed at or
 * holds focus, and always where nothing can point; its room is kept in the face either way,
 * so a chip never grows under the pointer and pushes the next one along or onto a new line.
 */
import { drawChip } from '@/entities/work-item/components/drawMarks.ts'
import { useMarkWords } from '@/entities/work-item/composables/useMarkWords.ts'

import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    label: string
    /** The label is in the filter now. */
    active?: boolean
    /** A button that filters; otherwise a plain chip. */
    filterable?: boolean
    /** The name of the button that takes the label off, which makes the chip offer it. */
    removeLabel?: string
    tabbable?: boolean
  }>(),
  { active: false, filterable: true, removeLabel: '', tabbable: true },
)

const emit = defineEmits<{ filter: [label: string]; remove: [label: string] }>()

const words = useMarkWords()

const chip = () =>
  drawChip({
    active: props.active,
    filterable: props.filterable,
    label: props.label,
    onFilter: (label) => emit('filter', label),
    tabbable: props.tabbable,
    words,
  })
</script>

<template>
  <span
    v-if="removeLabel"
    class="label-chip-pair"
  >
    <component :is="chip()" />
    <button
      class="label-chip-remove"
      type="button"
      :aria-label="removeLabel"
      :title="removeLabel"
      @click.stop="emit('remove', label)"
    >
      <VIcon
        name="close"
        :size="12"
        :stroke-width="2"
      />
    </button>
  </span>
  <component
    :is="chip()"
    v-else
  />
</template>

<style scoped>
/* The face keeps the ×'s room at its end: the × is 24px wide with its 12px glyph at its middle,
   so the glyph starts 18px in from the face's edge, and the words stop a letter's gap before
   it. The face's own end padding is part of that room. */
.label-chip-pair {
  --chip-face-room: calc(var(--size-label-remove) / 2 + 6px + var(--space-1) - var(--space-2));
  --size-label-remove: 24px;

  position: relative;
  display: inline-flex;
  max-width: 100%;
}

/* Above the filter's own target, which reaches across the chip: the end of the chip is the ×. */
.label-chip-remove {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  display: grid;
  place-items: center;
  width: var(--size-label-remove);

  /* The chip's height, not a control row's: the base floor would hang it below the chip. */
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  background: none;
  border-radius: var(--radius-status);
  opacity: 0;
  cursor: pointer;

  .label-chip-pair:is(:hover, :focus-within) & {
    opacity: 1;
  }

  &:hover {
    color: var(--color-text);
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: -2px;
  }

  @media (hover: none) {
    opacity: 1;
  }

  @media (forced-colors: active) {
    opacity: 1;
  }
}
</style>
