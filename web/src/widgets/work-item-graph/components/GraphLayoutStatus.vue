<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import VButton from '@/shared/ui/VButton.vue'

defineProps<{ failed: boolean; pending: boolean }>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
</script>

<template>
  <div
    v-if="failed"
    class="graph-layout-status"
    role="alert"
  >
    <span>{{ t('graph.layoutFailed') }}</span>
    <VButton
      variant="secondary"
      @click="emit('retry')"
      >{{ t('graph.retry') }}</VButton
    >
  </div>
  <p
    v-else-if="pending"
    class="graph-layout-status"
    role="status"
  >
    {{ t('graph.layoutLoading') }}
  </p>
</template>

<style scoped>
.graph-layout-status {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}
</style>
