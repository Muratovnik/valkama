<script setup lang="ts">
/**
 * That the last read again of the view on show failed, said in the bar beside the age of the
 * figures it could not replace, with the way to ask once more: «Could not refresh · Retry». The
 * figures stay on show (`useReadStanding`); the words go when an answer replaces them. Nothing is
 * drawn while every read stands, so the bar keeps its line until there is news. On a phone, where
 * the bar says its age and its refresh by sign alone, the words are left to the status a screen
 * reader hears, and the disc and the retry stand; so too on a line that has nothing else left to
 * give up for them (`brief`).
 */
import { useI18n } from 'vue-i18n'

import { usePageStanding } from '@/pages/analytics/composables/useReadStanding.ts'

import VButton from '@/shared/ui/VButton.vue'

defineProps<{
  /** The bar's line has no room for the words: the disc and the retry say it, as on a phone. */
  brief?: boolean
}>()
/** Read the view again. */
const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()
const { failed } = usePageStanding()
</script>

<template>
  <p
    v-if="failed"
    class="refresh-failed"
    role="status"
  >
    <span
      class="refresh-failed-mark"
      aria-hidden="true"
    />
    <span
      class="refresh-failed-words"
      :class="{ 'visually-hidden': brief }"
      >{{ t('analytics.frame.refreshFailed') }} ·
    </span>
    <VButton
      class="refresh-failed-retry"
      variant="text"
      size="inline"
      @click="emit('retry')"
    >
      {{ t('platform.actions.retry') }}
    </VButton>
  </p>
</template>

<style scoped>
/* A danger disc and words, as a failure is marked in the product, on one line that gives way to
   nothing beside it: the bar's line makes room for it by giving up its other parts
   (`useBarRoom`). */
.refresh-failed {
  position: relative;
  display: flex;
  flex: none;
  gap: var(--space-1);
  align-items: center;
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
  white-space: nowrap;
}

.refresh-failed-mark {
  inline-size: var(--space-2);
  block-size: var(--space-2);
  background: var(--color-danger);
  border-radius: 50%;

  @media (forced-colors: active) {
    background: CanvasText;
    forced-color-adjust: none;
  }
}

/* A phone's bar says its age and its refresh by sign alone: the words stay for a screen reader. */
@container (width <= 30rem) {
  .refresh-failed-words {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    white-space: nowrap;
    overflow: hidden;
    clip-path: inset(50%);
  }
}
</style>
