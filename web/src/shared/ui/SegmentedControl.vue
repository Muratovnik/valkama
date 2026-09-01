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
 */
// The segment shape stays inline: naming it would have to be exported for the
// generic component's own declaration, and an export nothing imports is dead
// weight the dead-code gate is right to reject.
const props = withDefaults(
  defineProps<{
    label: string
    modelValue: T
    options: readonly { label: string; value: T; disabled?: boolean; title?: string }[]
    size?: 'default' | 'compact'
  }>(),
  { size: 'default' },
)

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

/** The segment the model is currently on, which three things ask about. */
function isCurrent(option: { value: T }) {
  return option.value === props.modelValue
}

function select(option: { value: T; disabled?: boolean }) {
  if (option.disabled || isCurrent(option)) return
  emit('update:modelValue', option.value)
}
</script>

<template>
  <div
    class="segmented"
    role="group"
    :class="[`size-${size}`]"
    :aria-label="label"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="segmented-option"
      :class="{ active: isCurrent(option) }"
      :aria-pressed="isCurrent(option)"
      :disabled="option.disabled"
      :title="option.title"
      @click="select(option)"
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
}

/* `compact` is for a control that rides a chart header, where the surrounding
   row is already shorter than a form row. Both sizes subtract the same inset,
   so a track keeps its exact declared height whichever it is. */
.segmented-option {
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

.segmented-option:hover:not(:disabled, .active) {
  color: var(--color-text);
}

.segmented-option.active {
  color: var(--color-text);
  font-weight: 600;
  background: var(--color-surface-active);
}

.segmented-option:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.segmented-option:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -2px;
}
</style>
