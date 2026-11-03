<script setup lang="ts">
/**
 * The head every overlay wears: what this is, what it is about, and the way
 * out. A dialog and an inspector are different surfaces, but their heads were
 * the same eight lines of markup and twenty of layout in two files, already
 * drifting — one drew a border around its close button and the other did not.
 */
import { computed, ref } from 'vue'

import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    closeLabel: string
    title: string
    /** Which record the overlay is about: an identifier and its title. */
    context?: string
    /** The title can hold focus, for a host whose content takes it only once it arrives. */
    focusableTitle?: boolean
    /** A title that may run long stays on its line, and the whole of it is elsewhere. */
    singleLine?: boolean
    subtitle?: string
  }>(),
  { subtitle: '', context: '', focusableTitle: false, singleLine: false },
)

const emit = defineEmits<{ close: [] }>()

const name = ref<HTMLElement | null>(null)
const nameFocus = computed(() => (props.focusableTitle ? -1 : undefined))
defineExpose({ focusTitle: () => name.value?.focus({ preventScroll: true }) })
</script>

<template>
  <header class="overlay-header">
    <slot name="start" />
    <div class="overlay-header-title">
      <h2
        ref="name"
        class="overlay-header-name"
        :class="{ 'single-line': singleLine }"
        :tabindex="nameFocus"
      >
        {{ title }}
      </h2>
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
    <slot name="actions" />
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
  flex: 1 1 auto;
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
  outline: none;

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  &.single-line {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
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
