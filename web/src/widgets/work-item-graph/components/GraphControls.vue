<script setup lang="ts">
/**
 * Vue Flow's camera controls, drawn in this product's chrome.
 *
 * The zoom glyphs carry accessible names; camera destinations have visible labels.
 *
 * The rules below reach into the library's own DOM, which is why this file is on
 * `scopeEscapeOwners`: `.vue-flow__controls` and its buttons are Vue Flow's
 * elements and there is no class of ours to hand them.
 */
import { useI18n } from 'vue-i18n'

import { ControlButton, Controls } from '@vue-flow/controls'
import { useVueFlow } from '@vue-flow/core'
import type { FitViewParams } from '@vue-flow/core'

const props = defineProps<{ fitOptions: FitViewParams }>()
const emit = defineEmits<{ 'focus-work': [] }>()
const { t } = useI18n()
const { fitView } = useVueFlow()
</script>

<template>
  <Controls
    class="graph-controls"
    position="bottom-left"
    :show-interactive="false"
    :show-fit-view="false"
  >
    <template #icon-zoom-in>
      <span
        class="control-glyph"
        aria-hidden="true"
        >+</span
      >
      <span class="visually-hidden">{{ t('graph.zoomIn') }}</span>
    </template>
    <template #icon-zoom-out>
      <span
        class="control-glyph"
        aria-hidden="true"
        >−</span
      >
      <span class="visually-hidden">{{ t('graph.zoomOut') }}</span>
    </template>
    <ControlButton
      class="control-action"
      @click="emit('focus-work')"
    >
      {{ t('graph.focusWork') }}
    </ControlButton>
    <ControlButton
      class="control-action"
      @click="fitView(props.fitOptions)"
    >
      {{ t('graph.zoomReset') }}
    </ControlButton>
  </Controls>
</template>

<style scoped>
.control-glyph {
  display: block;
  color: var(--color-text);
  font: 600 var(--font-size-emphasis)/var(--line-height-flat) var(--font-family-interface);
}

.control-action {
  font: var(--font-chip);
}

.graph-controls {
  display: flex;
  flex-flow: row wrap;
  max-width: calc(100% - var(--space-8));
  margin: 0 0 var(--space-4) var(--space-4);
  border: 1px solid var(--color-rule);
  overflow: hidden;
  border-radius: var(--radius-status);
  box-shadow: none;
}

:deep(.vue-flow__controls-button) {
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-right: 1px solid var(--color-rule);
  color: var(--color-text-muted);
  background: var(--color-surface-sheet);
}

:deep(.vue-flow__controls-button:last-child) {
  border-right: 0;
}

:deep(.vue-flow__controls-button.control-action) {
  width: auto;
  padding: 0 var(--space-3);
}

:deep(
  :is(.vue-flow__controls-button:hover:not(:disabled), .vue-flow__controls-button:focus-visible)
) {
  color: var(--color-text);
  background: var(--color-surface-muted);
  outline: none;
}

:deep(.vue-flow__controls-button:disabled) {
  opacity: 0.35;
}
</style>
