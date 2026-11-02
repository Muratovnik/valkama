<script setup lang="ts">
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  SESSION_INSPECTOR_STORAGE_KEY,
} from '@/shared/lib/shellLayout.ts'
import OverlayHost from '@/shared/ui/OverlayHost.vue'

withDefaults(
  defineProps<{
    label: string
    open: boolean
    contentKey?: string
    resizeLabel?: string
    storageKey?: string
    surfaceClass?: string
  }>(),
  {
    resizeLabel: '',
    storageKey: SESSION_INSPECTOR_STORAGE_KEY,
    surfaceClass: 'resizable-inspector',
  },
)

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <OverlayHost
    variant="drawer"
    layer="drawer"
    :open="open"
    :aria-label="label"
    :content-key="contentKey"
    :surface-class="surfaceClass"
    :resize-label="resizeLabel || label"
    :width-storage-key="storageKey"
    :drawer-default-width="620"
    :drawer-min-width="INSPECTOR_MIN_WIDTH"
    :drawer-max-width="INSPECTOR_MAX_WIDTH"
    resizable
    @close="emit('close')"
  >
    <slot :close="() => emit('close')" />
  </OverlayHost>
</template>
