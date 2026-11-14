<script setup lang="ts">
/**
 * That the last read again of the view on show failed, said in the bar before the age of the
 * figures it could not replace, with the way to ask once more: «Could not refresh · Retry». The
 * figures stay on show (`useReadStanding`); the words go when an answer replaces them. Nothing is
 * drawn while every read stands; while the bar fits its line the failure holds its room unseen
 * (`held`), so a failure said takes only room the line left and moves nothing.
 *
 * The words are said at every width. On a line that has nothing else left to give up for them
 * (`brief`), a phone's among them, the retry is what goes: the bar's own read again stands beside
 * it and asks the same.
 */
import { useI18n } from 'vue-i18n'

import { usePageStanding } from '@/pages/analytics/composables/useReadStanding.ts'

import VButton from '@/shared/ui/VButton.vue'

defineProps<{
  /** The bar's line has no room for the retry: the disc and the words say it. */
  brief?: boolean
  /** The bar is fitting its line: the failure takes its room, drawn by nobody, failed or not. */
  held?: boolean
}>()
/** Read the view again. */
const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()
const { failed } = usePageStanding()
</script>

<template>
  <p
    v-if="failed || held"
    class="refresh-failed"
    role="status"
    :class="{ 'refresh-failed-held': !failed }"
  >
    <span
      class="refresh-failed-mark"
      aria-hidden="true"
    />
    <span class="refresh-failed-words"
      >{{ t('analytics.frame.refreshFailed') }}<template v-if="!brief"> · </template>
    </span>
    <VButton
      v-if="!brief"
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

/* Held while the bar fits its line: its room taken, nothing of it seen or heard. */
.refresh-failed-held {
  visibility: hidden;
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
</style>
