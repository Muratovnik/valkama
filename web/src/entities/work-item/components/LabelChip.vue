<script setup lang="ts">
/**
 * One label as a chip: the control fill and muted ink, so it reads as a thing
 * that can be pressed rather than as a hole in the card. As a button it adds
 * its label to the filter, and takes it out again while it is in.
 *
 * `tabbable` is false where a container is one Tab stop — a board tile — and
 * the keyboard reaches the same filter through the card and the bar instead.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    label: string
    /** The label is in the filter now. */
    active?: boolean
    /** A button that filters; otherwise a plain chip. */
    filterable?: boolean
    tabbable?: boolean
  }>(),
  { active: false, filterable: true, tabbable: true },
)

const emit = defineEmits<{ filter: [label: string] }>()

const { t } = useI18n()

const name = computed(() =>
  t(props.active ? 'workItem.facet.filterRemove' : 'workItem.facet.filterAdd', {
    facet: t('workItem.facet.name.labels'),
    value: props.label,
  }),
)

/** Absent rather than false: the attribute is what the style reads. */
const activeMark = computed(() => props.active || undefined)

/** Out of the Tab order inside a container that is one Tab stop. */
const tabStop = computed(() => (props.tabbable ? undefined : -1))

function press(event: MouseEvent) {
  // The chip lies inside something that opens on a click; filtering must not
  // open it as well.
  event.stopPropagation()
  emit('filter', props.label)
}
</script>

<template>
  <button
    v-if="props.filterable"
    class="label-chip filters"
    type="button"
    :aria-label="name"
    :title="name"
    :data-active="activeMark"
    :tabindex="tabStop"
    @click="press"
  >
    <span class="chip-face">{{ props.label }}</span>
  </button>
  <span
    v-else
    class="label-chip"
    ><span class="chip-face">{{ props.label }}</span></span
  >
</template>

<style scoped>
/* The box is what a pointer hits and the face is what is drawn: a button keeps
   the 28px a line of content may spend on a target, and the chip inside it
   stays the height of its text, as a chip that only names a label does. */
.label-chip {
  /* Above a stretched open target drawn earlier in the same container. */
  position: relative;
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  background: none;

  &.filters {
    min-block-size: var(--size-control-inline);
    cursor: pointer;

    &:hover,
    &[data-active] {
      color: var(--color-text);
    }

    &:focus-visible {
      border-radius: var(--radius-status);
      outline: 2px solid var(--color-focus-ring);
      outline-offset: 2px;
    }
  }
}

.chip-face {
  max-width: 100%;
  padding: var(--space-hair) var(--space-2);
  white-space: nowrap;
  background: var(--color-control-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: var(--radius-status);

  /* Pointed at, or in the filter: one step up, the way a control lifts. */
  .label-chip.filters:hover &,
  .label-chip[data-active] & {
    background: var(--color-surface-active);
  }
}
</style>
