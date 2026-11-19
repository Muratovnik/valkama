<script setup lang="ts">
/**
 * Retry for a card whose last read failed while what it read before still stands: the card keeps
 * showing that, and this offers to read it again at the end of the line above the sections.
 */
import { useI18n } from 'vue-i18n'

import VButton from '@/shared/ui/VButton.vue'

const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="inspector-read-recovery">
    <VButton
      variant="ghost"
      @click="emit('retry')"
    >
      {{ t('platform.actions.retry') }}
    </VButton>
  </div>
</template>

<style scoped>
.inspector-read-recovery {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--space-3);
}
</style>
