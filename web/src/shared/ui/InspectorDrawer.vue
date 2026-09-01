<script setup lang="ts">
import OverlayHost from '@/shared/ui/OverlayHost.vue'

withDefaults(
  defineProps<{
    open: boolean
    ariaLabel?: string
    drawerDefaultWidth?: number
    drawerMaxWidth?: number
    drawerMinWidth?: number
    interactive?: boolean
    panelClass?: string
    resizeLabel?: string
    title?: string
    widthStorageKey?: string
  }>(),
  { title: '', ariaLabel: '', panelClass: '', resizeLabel: '', interactive: true },
)

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <OverlayHost
    layer="drawer"
    variant="drawer"
    :open="open"
    :title="title"
    :aria-label="ariaLabel"
    :surface-class="panelClass"
    :resize-label="resizeLabel"
    :width-storage-key="widthStorageKey"
    :drawer-default-width="drawerDefaultWidth"
    :drawer-min-width="drawerMinWidth"
    :drawer-max-width="drawerMaxWidth"
    :interactive="interactive"
    :resizable="true"
    @close="emit('close')"
  >
    <slot />
  </OverlayHost>
</template>
