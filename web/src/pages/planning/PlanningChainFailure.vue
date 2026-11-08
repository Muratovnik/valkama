<script setup lang="ts">
/**
 * The chain the address names could not be read, said where the views are.
 *
 * The address keeps the chain, so asking again — here, or by reloading — reads
 * the same one; dismissing it is leaving the chain, which drops it from the
 * address. Asking again is offered only when it could help: a reference no item
 * answers to will not answer the second time either.
 */
import { useI18n } from 'vue-i18n'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ failure: { message: string; retryable: boolean } }>()
const emit = defineEmits<{ dismiss: []; retry: [] }>()
const { t } = useI18n()
</script>

<template>
  <div
    class="chain-failure"
    role="status"
  >
    <span class="chain-failure-message">{{ failure.message }}</span>
    <VButton
      v-if="failure.retryable"
      @click="emit('retry')"
      >{{ t('graph.retry') }}</VButton
    >
    <VButton
      v-tooltip="t('graph.chainDismiss')"
      variant="ghost"
      :aria-label="t('graph.chainDismiss')"
      icon
      @click="emit('dismiss')"
    >
      <VIcon name="close" />
    </VButton>
  </div>
</template>

<style scoped>
.chain-failure {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  padding-bottom: var(--space-3);
  color: var(--color-text);
  font: var(--font-detail);
}

.chain-failure-message {
  flex: 0 1 auto;
  min-width: 0;
}
</style>
