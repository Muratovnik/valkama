<script setup lang="ts">
/**
 * The frame a labelled control sits in: its label, the control, an optional hint.
 *
 * Three dialogs had each grown their own `.field`, and each one paired it with
 * its own control styling — one filled the input with `--color-control-surface` and
 * another with `--color-surface-recess`, and all three hard-coded a 4px radius while
 * the token said 8px.
 *
 * The frame is a component of its own because half of what it holds is not a
 * native control: `SelectionControl` and `SegmentedControl` carry their own
 * accessible name, so their frame must be a `div` rather than a `<label>` that
 * would wrap a second name around them.
 */
withDefaults(defineProps<{ label: string; as?: 'label' | 'div'; hint?: string }>(), {
  hint: '',
  as: 'label',
})
</script>

<template>
  <component
    :is="as"
    class="field"
  >
    <span class="field-label">{{ label }}</span>
    <slot />
    <small
      v-if="hint"
      class="field-hint"
      >{{ hint }}</small
    >
  </component>
</template>

<style scoped>
.field {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.field-label {
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

.field-hint {
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
