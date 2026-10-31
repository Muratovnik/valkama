<script setup lang="ts">
/**
 * The shell's notice at the window's corner: what happened, the one thing that
 * can be done about it when there is one, and a way to put it away.
 *
 * It is announced politely and takes no focus: a notice reports, it does not
 * interrupt what the operator was typing.
 */
import { useI18n } from 'vue-i18n'

import type { ShellNotice } from '@/app/composables/useShellNotice.ts'

import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ notice: ShellNotice }>()
const emit = defineEmits<{ act: []; dismiss: [] }>()
const { t } = useI18n()
</script>

<template>
  <div
    class="notice"
    role="status"
  >
    <span class="notice-message">{{ notice.message }}</span>
    <VButton
      v-if="notice.action"
      class="notice-action"
      size="inline"
      @click="emit('act')"
      >{{ notice.action.label }}</VButton
    >
    <VButton
      class="notice-dismiss"
      variant="ghost"
      size="inline"
      :aria-label="t('notice.dismiss')"
      icon
      @click="emit('dismiss')"
    >
      <VIcon
        name="close"
        :size="16"
      />
    </VButton>
  </div>
</template>

<style scoped>
.notice {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 70;
  display: flex;
  gap: var(--space-2);
  align-items: center;
  max-width: min(520px, calc(100vw - 36px));
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  font: var(--font-detail);
  background: var(--color-surface);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-overlay);
}

.notice-message {
  flex: 1 1 auto;
  min-width: 0;
}

.notice-action,
.notice-dismiss {
  flex: 0 0 auto;
}
</style>
