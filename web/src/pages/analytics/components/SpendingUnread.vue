<script setup lang="ts">
/**
 * What an answer is missing when its period before could not be read: said as a status a screen
 * reader hears too, with the page's own way to read it again. The figures stand, with no change
 * beside them.
 */
import { useI18n } from 'vue-i18n'

import VButton from '@/shared/ui/VButton.vue'

/** Read the answer again. */
const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()
</script>

<template>
  <div class="spending-unread">
    <p
      class="spending-unread-words"
      role="status"
    >
      {{ t('analytics.unread') }}
    </p>
    <VButton
      size="compact"
      @click="emit('retry')"
    >
      {{ t('platform.actions.retry') }}
    </VButton>
  </div>
</template>

<style scoped>
/* The words and the button on one line while they fit, the button under the words when they do
   not. A status edge on a muted ground, as the product marks a read that came back short. */
.spending-unread {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-inline-start: 3px solid var(--color-warning);
  background: var(--color-surface-muted);
}

.spending-unread-words {
  flex: 1 1 16rem;
  min-width: 0;
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
}
</style>
