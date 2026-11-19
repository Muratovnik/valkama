<script setup lang="ts">
/**
 * The field's camera controls, in the strip under it.
 *
 * They stand outside the flow, so no node is ever drawn under them, whatever
 * the camera does. That is also why they are not Vue Flow's `Controls` panel:
 * the panel finds the camera through the flow it is rendered in, and these are
 * rendered beside it, so they name the field's camera by its id. Each button is
 * still Vue Flow's own camera button, and the zoom steps stop where the field's
 * zoom does, as the panel's would. «Fit whole graph» says only that it was pressed:
 * the field's camera knows the whole view, which is also that limit.
 *
 * On a phone-wide field that view goes no further out than the cards read: where that
 * floor is the limit (`floored`), the fit shows the drawing's beginning, «Zoom out» turns off there as at any limit, and
 * «Fit whole graph», which stays pressable, says why in its hint, which is also its
 * accessible description, since a turned-off button takes neither the pointer nor focus.
 *
 * The zoom glyphs carry accessible names; camera destinations have visible labels.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { ControlButton } from '@vue-flow/controls'
import { useVueFlow } from '@vue-flow/core'

import { GRAPH_FLOW_ID } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { GRAPH_ZOOM_MIN } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { fieldZoomFloor } from '@/widgets/work-item-graph/utils/graphZoomFloor.ts'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const emit = defineEmits<{ fit: [] }>()
const { t } = useI18n()
const { dimensions, maxZoom, minZoom, viewport, vueFlowRef, zoomIn, zoomOut } = useVueFlow({
  id: GRAPH_FLOW_ID,
})
const atMax = computed(() => viewport.value.zoom >= maxZoom.value)
const atMin = computed(() => viewport.value.zoom <= minZoom.value)
/**
 * The field's limit is its floor: the whole drawing would fit only further out than its cards
 * read. Read again whenever the limit or the field's width moves, the width being what decides
 * whether the field is a phone's.
 */
const floored = computed(() => {
  if (!dimensions.value.width) return false
  const floor = fieldZoomFloor(vueFlowRef.value)
  return floor > GRAPH_ZOOM_MIN && minZoom.value <= floor
})
/** Why the fit stops short and «Zoom out» is off, where the floor is the limit. */
const fitHint = computed(() => (floored.value ? t('graph.zoomFloor') : ''))
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
      v-tooltip.detail="fitHint"
      class="control-button control-action"
      @click="emit('fit')"
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
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
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
