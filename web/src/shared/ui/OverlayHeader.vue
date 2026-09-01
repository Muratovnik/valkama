<script setup lang="ts">
/**
 * The head every overlay wears: what this is, what it is about, and the way
 * out. A dialog and an inspector are different surfaces, but their heads were
 * the same eight lines of markup and twenty of layout in two files, already
 * drifting — one drew a border around its close button and the other did not.
 */
import VIcon from '@/shared/ui/VIcon.vue'

withDefaults(
  defineProps<{
    closeLabel: string
    title: string
    /** Which record the overlay is about: an identifier and its title. */
    context?: string
    subtitle?: string
  }>(),
  { subtitle: '', context: '' },
)

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <header class="overlay-header">
    <div class="overlay-header-title">
      <h2 class="overlay-header-name">{{ title }}</h2>
      <p
        v-if="subtitle"
        class="overlay-header-subtitle"
      >
        {{ subtitle }}
      </p>
      <span
        v-if="context"
        class="overlay-header-context"
        >{{ context }}</span
      >
      <slot name="meta" />
    </div>
    <button
      class="overlay-header-close"
      type="button"
      :aria-label="closeLabel"
      @click="emit('close')"
    >
      <VIcon name="close" />
    </button>
  </header>
</template>

<style scoped>
.overlay-header {
  display: flex;
  gap: var(--space-4);
  justify-content: space-between;
  align-items: flex-start;
  padding: var(--space-6);
  border-bottom: 1px solid var(--color-rule);
}

.overlay-header-title {
  min-width: 0;
}

/* An overlay title is the module step, the same one the context bar spends on
   the module name. Four overlays had four sizes for this — 19, 20, 20, 21 —
   which is the drift the ramp exists to stop. */
.overlay-header-name {
  margin: 0;
  font-size: var(--font-size-module);
  line-height: var(--line-height-snug);
  font-weight: 700;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}

.overlay-header-subtitle {
  max-width: 65ch;
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-interface);
  line-height: var(--line-height-normal);
}

.overlay-header-context {
  display: block;
  color: var(--color-text-muted);
  font: var(--font-context);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The head already draws the rule under itself; a second outline around the
   close button inside it is the ration DESIGN.md spends elsewhere. */
.overlay-header-close {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: var(--size-control-target);
  height: var(--size-control-target);
  padding: 0;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
    border-color: var(--color-rule);
  }
}
</style>
