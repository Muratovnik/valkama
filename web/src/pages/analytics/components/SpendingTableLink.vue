<script setup lang="ts">
/**
 * A line pressed as a link to a section's table: «To the table» over the charts, which the section
 * answers by bringing its table into view with the focus on it, and «All N» under the ranked list,
 * which opens every value of the section in the side panel. What a press does is its host's; this
 * only says it, in the quiet ink of what a list leaves out. It is a line of the list it stands
 * under, with that list's states (`rowStates.css`).
 */
/** Pressed. */
const emit = defineEmits<{ press: [] }>()
defineSlots<{ default: () => unknown }>()
</script>

<template>
  <button
    type="button"
    class="spending-table-link row-state"
    @click="emit('press')"
  >
    <slot />
  </button>
</template>

<style scoped src="@/shared/ui/rowStates.css"></style>

<style scoped>
.spending-table-link {
  display: block;
  min-block-size: var(--size-control-inline);
  padding: var(--space-1) var(--space-2);
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  text-align: start;
  text-decoration: underline;
  text-decoration-color: var(--row-state-underline, var(--color-rule-strong));
  text-underline-offset: var(--space-half);
  cursor: pointer;
}
</style>
