<script setup lang="ts">
/**
 * Vue Flow's camera controls, drawn in this product's chrome.
 *
 * The three glyphs are text rather than icons because `VIcon` has no zoom pair and
 * inventing one for three buttons in one widget is a worse trade than a plus, a
 * minus and a return arrow. Each carries its own accessible name, since a glyph is
 * hidden from the reader.
 *
 * The rules below reach into the library's own DOM, which is why this file is on
 * `scopeEscapeOwners`: `.vue-flow__controls` and its buttons are Vue Flow's
 * elements and there is no class of ours to hand them.
 */
import { useI18n } from 'vue-i18n'

import { Controls } from '@vue-flow/controls'
import type { FitViewParams } from '@vue-flow/core'

defineProps<{ fitOptions: FitViewParams }>()
const { t } = useI18n()
</script>

<template>
  <Controls
    position="bottom-left"
    :show-interactive="false"
    :fit-view-params="fitOptions"
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
    <template #icon-fit-view>
      <span
        class="control-glyph fit"
        aria-hidden="true"
        >↺</span
      >
      <span class="visually-hidden">{{ t('graph.zoomReset') }}</span>
    </template>
  </Controls>
</template>

<style scoped>
.control-glyph {
  display: block;
  color: var(--color-text);
  font: 600 var(--font-size-module)/var(--line-height-flat) var(--font-family-interface);

  &.fit {
    font-size: var(--font-size-section);
  }
}

:deep(.vue-flow__controls) {
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
  border-bottom: 1px solid var(--color-rule);
  color: var(--color-text-muted);
  background: var(--color-surface-sheet);
}

:deep(.vue-flow__controls-button:last-child) {
  border-bottom: 0;
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
