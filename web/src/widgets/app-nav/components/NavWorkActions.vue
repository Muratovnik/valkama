<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import CountBadge from '@/shared/ui/CountBadge.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ pendingCount: number | null }>()
const emit = defineEmits<{ find: []; requests: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="work-actions">
    <button
      class="work-action"
      type="button"
      aria-keyshortcuts="Control+k Meta+k"
      :title="t('finder.trigger')"
      @click="emit('find')"
    >
      <VIcon
        name="search"
        :size="20"
      />
      <span class="action-label">{{ t('finder.trigger') }}</span>
      <kbd
        class="action-shortcut"
        aria-hidden="true"
        >Ctrl K</kbd
      >
    </button>
    <button
      class="work-action"
      type="button"
      :title="t('requests.title')"
      @click="emit('requests')"
    >
      <VIcon
        name="message-square"
        :size="20"
      />
      <span class="action-label">{{ t('requests.title') }}</span>
      <CountBadge
        v-if="pendingCount !== null && pendingCount > 0"
        class="action-count"
        placement="inline"
        :value="pendingCount"
      />
    </button>
  </div>
</template>

<style scoped>
.work-actions {
  display: grid;
  gap: var(--space-half);
}

.work-action {
  position: relative;
  display: flex;
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: var(--size-control-height);
  padding: 0 var(--space-3);
  border: 0;
  color: var(--color-text-on-dark-muted);
  text-align: left;
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text-on-dark);
    background: var(--color-navigation-raised);
  }
}

.action-label {
  min-width: 0;
  font: var(--font-name);
}

.action-shortcut {
  margin-left: auto;
  color: var(--color-navigation-text-muted);
  font: var(--font-detail);
  white-space: nowrap;
}

@container nav (width < 150px) {
  .work-action {
    justify-content: center;
    padding: 0;
  }

  /* Out of sight, never out of the name: each action is named by what it
     shows, its label and any count, so the label stays for a reader once the
     rail has no line for it. The shortcut is never part of the name, at any
     width, because `aria-keyshortcuts` already states it. */
  .action-label {
    position: absolute;
    width: 1px;
    height: 1px;
    white-space: nowrap;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .action-shortcut {
    display: none;
  }

  .action-count {
    position: absolute;
    inset: 0 0 auto auto;
  }
}
</style>
