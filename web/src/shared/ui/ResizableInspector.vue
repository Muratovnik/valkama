<script setup lang="ts">
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  SESSION_INSPECTOR_STORAGE_KEY,
} from '@/shared/lib/shellLayout.ts'
import OverlayHost from '@/shared/ui/OverlayHost.vue'
import type { OverlayPaneNames, PaneFit } from '@/shared/ui/overlayPanes.ts'

/**
 * A panel at the window's right edge, resized by its left one. A card and a session
 * stand on the drawer layer; a document opened from a card or from a dialog stands on
 * the command layer, over what it was opened from, which stays mounted under it.
 */
withDefaults(
  defineProps<{
    label: string
    open: boolean
    contentKey?: string
    defaultWidth?: number
    layer?: 'drawer' | 'command'
    maxWidth?: number
    minWidth?: number
    pane?: OverlayPaneNames | null
    paneRoom?: number
    resizeLabel?: string
    storageKey?: string
    surfaceClass?: string
  }>(),
  {
    defaultWidth: 620,
    layer: 'drawer',
    maxWidth: INSPECTOR_MAX_WIDTH,
    minWidth: INSPECTOR_MIN_WIDTH,
    resizeLabel: '',
    storageKey: SESSION_INSPECTOR_STORAGE_KEY,
    surfaceClass: 'resizable-inspector',
  },
)

const emit = defineEmits<{
  'close': []
  'pane-close': []
  'pane-fit': [fit: PaneFit | null]
}>()
</script>

<template>
  <OverlayHost
    variant="drawer"
    :layer="layer"
    :open="open"
    :aria-label="label"
    :content-key="contentKey"
    :surface-class="surfaceClass"
    :resize-label="resizeLabel || label"
    :width-storage-key="storageKey"
    :drawer-default-width="defaultWidth"
    :drawer-min-width="minWidth"
    :drawer-max-width="maxWidth"
    :pane="pane"
    :pane-room="paneRoom"
    resizable
    @close="emit('close')"
    @pane-close="emit('pane-close')"
    @pane-fit="(fit) => emit('pane-fit', fit)"
  >
    <slot :close="() => emit('close')" />
    <template #pane>
      <slot name="pane" />
    </template>
  </OverlayHost>
</template>
