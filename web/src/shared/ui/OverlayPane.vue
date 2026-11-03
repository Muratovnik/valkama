<script setup lang="ts">
/**
 * The second pane of a surface: its own scroller, its own width, and the edge that sizes
 * it. The surface stays one dialog with one Tab trap, so the panes are two named regions
 * inside it and not two surfaces, the second of which would have made the first inert.
 *
 * Escape from anywhere in here, its edge included, closes this pane alone: marked handled,
 * it goes no further than the surface's own listener on the document, which leaves it.
 *
 * Folded, the pane keeps its box at its width, so what is in it neither wraps again nor
 * loses its place, and the box is inert and hidden: out of Tab, of F6 and of what is read.
 */
import { computed, useId, watch } from 'vue'

import {
  DOCUMENT_PANE_DEFAULT_WIDTH,
  DOCUMENT_PANE_STORAGE_KEY,
  DRAWER_MIN_WIDTH,
} from '@/shared/lib/shellLayout.ts'
import OverlayResizer from '@/shared/ui/OverlayResizer.vue'
import { useDrawerWidth } from '@/shared/ui/useDrawerWidth.ts'

const props = defineProps<{
  active: boolean
  label: string
  resizeLabel: string
  variant: 'dialog' | 'drawer'
  /** The most the window leaves it. */
  widest: number
}>()
const emit = defineEmits<{ close: []; resizing: [moving: boolean] }>()

const id = useId()
const regionId = `overlay-pane-${id}`
const nameId = `overlay-pane-name-${id}`

const {
  beginResize,
  collapsed,
  drawerMaximum,
  drawerMinimum,
  drawerWidth,
  resizeFromKeyboard,
  resizing,
  restoreDrawerWidth,
} = useDrawerWidth({
  active: () => props.active,
  collapsible: true,
  defaultWidth: () => DOCUMENT_PANE_DEFAULT_WIDTH,
  maxWidth: () => props.widest,
  minWidth: () => DRAWER_MIN_WIDTH,
  resizable: () => true,
  storageKey: () => DOCUMENT_PANE_STORAGE_KEY,
})
restoreDrawerWidth()
watch(resizing, (moving) => emit('resizing', moving))

const paneSize = computed(() => ({ inlineSize: collapsed.value ? '0' : `${drawerWidth.value}px` }))
const regionSize = computed(() => ({ inlineSize: `${drawerWidth.value}px` }))
/** Folded it has no width at all, and a range that says so. */
const edgeMinimum = computed(() => (collapsed.value ? 0 : drawerMinimum.value))
const edgeNow = computed(() => (collapsed.value ? 0 : drawerWidth.value))
const resizerPlace = computed(() => {
  if (props.variant === 'dialog') return 'gap'
  return collapsed.value ? 'end' : 'inside'
})

function dismiss(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || !props.active) return
  event.preventDefault()
  emit('close')
}
</script>

<template>
  <!-- Escape only, for keys that land in the pane on their way up; the controls are inside. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <div
    class="overlay-pane"
    :class="[`overlay-pane-${variant}`, { 'is-collapsed': collapsed }]"
    :style="paneSize"
    @keydown="dismiss"
  >
    <OverlayResizer
      :at="resizerPlace"
      :label="resizeLabel"
      :controls="regionId"
      :minimum="edgeMinimum"
      :maximum="drawerMaximum"
      :now="edgeNow"
      @pointerdown="beginResize"
      @keydown="resizeFromKeyboard"
    />
    <span
      :id="nameId"
      hidden
      >{{ label }}</span
    >
    <div
      :id="regionId"
      class="overlay-pane-region"
      role="region"
      :aria-labelledby="nameId"
      :inert="collapsed"
      :style="regionSize"
      data-overlay-pane
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.overlay-pane {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  min-height: 0;
  color: var(--color-text);

  &.is-collapsed .overlay-pane-region {
    visibility: hidden;
  }
}

/* The one divider between two panes on one ground: a shadow is what separates a drawer
   from what it lies on, and a forced palette keeps this line where it drops the shadow. */
.overlay-pane-drawer .overlay-pane-region {
  border-inline-start: 1px solid var(--color-rule-strong);
  background: var(--color-surface);
}

/* A dialog is a frame, so the pane beside it is one too, with the gap between them for the
   edge that sizes it. */
.overlay-pane-dialog {
  margin-inline-start: var(--space-3);

  /* The room above brings what it holds level with the head of the dialog beside it. */
  & .overlay-pane-region {
    padding-block-start: var(--space-2);
    border: 1px solid var(--color-rule-strong);
    background: var(--color-surface);
    overflow: hidden;
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-overlay);
  }
}

.overlay-pane-region {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  container: overlay / inline-size;
}
</style>
