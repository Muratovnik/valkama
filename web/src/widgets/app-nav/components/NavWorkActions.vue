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
        class="action-icon"
        name="message-square"
        :size="20"
      />
      <span class="action-label">{{ t('requests.title') }}</span>
      <!-- Questions waiting are work for the reader: in the hint's grey, beside
           the Ctrl K shortcut, the number read as part of the furniture. -->
      <CountBadge
        v-if="pendingCount !== null && pendingCount > 0"
        class="action-count"
        placement="inline"
        tone="waiting"
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

  /* No line for the count, so it shares the icon's cell and rides its top
     corner, as the module list's count does. It was asked to be
     `position: absolute`, which the badge's own inline placement outranks, so it
     stayed in the row beside the icon and squeezed the glyph to 12px. One cell
     overrides nothing the badge says about itself. */
  .work-action:has(.action-count) {
    display: grid;
    grid-template-columns: 1fr;
    place-items: center;
  }

  :is(.action-icon, .action-count) {
    grid-area: 1/1;
  }

  .action-count {
    place-self: start end;
  }
}
</style>
