<script setup lang="ts">
/**
 * The field's camera controls, in the strip under it.
 *
 * They stand outside the flow, so no node is ever drawn under them, whatever
 * the camera does. That is also why they are not Vue Flow's `Controls` panel:
 * the panel finds the camera through the flow it is rendered in, and these are
 * rendered beside it, so they name the field's camera by its id. Each button is
 * still Vue Flow's own camera button, and the zoom steps stop where the field's
 * zoom does, as the panel's would.
 *
 * The zoom glyphs carry accessible names; camera destinations have visible labels.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { ControlButton } from '@vue-flow/controls'
import { useVueFlow } from '@vue-flow/core'
import type { FitViewParams } from '@vue-flow/core'

import { GRAPH_FLOW_ID } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

const props = defineProps<{ fitOptions: FitViewParams }>()
const { t } = useI18n()
const { fitView, maxZoom, minZoom, viewport, zoomIn, zoomOut } = useVueFlow({ id: GRAPH_FLOW_ID })
const atMax = computed(() => viewport.value.zoom >= maxZoom.value)
const atMin = computed(() => viewport.value.zoom <= minZoom.value)
</script>

<template>
  <div class="graph-controls">
    <ControlButton
      class="control-button"
      :disabled="atMax"
      @click="zoomIn()"
    >
      <span
        class="control-glyph"
        aria-hidden="true"
        >+</span
      >
      <span class="visually-hidden">{{ t('graph.zoomIn') }}</span>
    </ControlButton>
    <ControlButton
      class="control-button"
      :disabled="atMin"
      @click="zoomOut()"
    >
      <span
        class="control-glyph"
        aria-hidden="true"
        >−</span
      >
      <span class="visually-hidden">{{ t('graph.zoomOut') }}</span>
    </ControlButton>
    <ControlButton
      class="control-button control-action"
      @click="fitView(props.fitOptions)"
    >
      {{ t('graph.zoomReset') }}
    </ControlButton>
  </div>
</template>

<style scoped>
.control-glyph {
  display: block;
  color: var(--color-text);
  font: 600 var(--font-size-emphasis)/var(--line-height-flat) var(--font-family-interface);
}

.graph-controls {
  display: flex;
  flex-flow: row wrap;
  justify-self: start;
  max-width: calc(100% - var(--space-6));
  margin: var(--space-2) var(--space-3) var(--space-3);
  border: 1px solid var(--color-rule);
  overflow: hidden;
  border-radius: var(--radius-status);
}

.control-button {
  box-sizing: border-box;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-right: 1px solid var(--color-rule);
  color: var(--color-text-muted);
  background: var(--color-surface-sheet);

  &:last-child {
    border-right: 0;
  }

  /* One step above the sheet the buttons rest on: `--color-surface-muted` is the
     sheet's own tone, so a hover written with it drew nothing — and the keyboard's
     focus, which had its ring taken away for that fill, drew nothing either. */
  &:hover:not(:disabled) {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    color: var(--color-text);
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }
}

.control-action {
  width: auto;
  padding: 0 var(--space-3);
  font: var(--font-chip);
}

/* A phone-wide field is about three hundred pixels: the four controls keep one
   row there by giving up some of the air round them, the glyph buttons a
   little width, and the labelled ones some of their inner air. */
@container workspace (width <= 586px) {
  .graph-controls {
    max-width: calc(100% - var(--space-2));
    margin: var(--space-1) var(--space-1) var(--space-2);
  }

  .control-button {
    width: 30px;
  }

  .control-action {
    width: auto;
    padding: 0 var(--space-2);
  }
}
</style>
