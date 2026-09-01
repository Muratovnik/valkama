<script setup lang="ts">
import OverlayHeader from '@/shared/ui/OverlayHeader.vue'

defineProps<{ closeLabel: string; title: string; subtitle?: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <aside
    class="inspector-frame"
    :aria-label="title"
  >
    <OverlayHeader
      :title="title"
      :subtitle="subtitle"
      :close-label="closeLabel"
      @close="emit('close')"
    >
      <template #meta><slot name="meta" /></template>
    </OverlayHeader>
    <div class="inspector-frame-body"><slot /></div>
  </aside>
</template>

<style scoped>
.inspector-frame {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-surface);
}

.inspector-frame-body {
  min-height: 0;
  padding: var(--space-6);
  overflow-y: auto;
}
</style>
