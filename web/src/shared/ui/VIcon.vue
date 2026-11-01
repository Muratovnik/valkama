<script setup lang="ts">
import { iconGlyph } from '@/shared/ui/iconGlyph.ts'

const props = withDefaults(
  defineProps<{
    /** Manifest-owned icon key. Unknown keys intentionally get one generic glyph. */
    name: string
    size?: number
    strokeWidth?: number
  }>(),
  { size: 20, strokeWidth: 1.8 },
)
</script>

<template>
  <component :is="iconGlyph(props.name, { size: props.size, strokeWidth: props.strokeWidth })" />
</template>
