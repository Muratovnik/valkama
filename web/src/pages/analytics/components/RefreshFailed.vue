<script setup lang="ts">
/**
 * That the last read again of the view on show failed, said in the bar before the age of the
 * figures it could not replace, with the way to ask once more: «Could not refresh · Retry». The
 * figures stay on show (`useReadStanding`); the words go when an answer replaces them. Nothing is
 * drawn while every read stands; while the bar fits its line the failure holds its room unseen
 * (`held`), so a failure said takes only room the line left and moves nothing.
 *
 * The words are said at every width, and the retry is reached at every width. On a line that has
 * nothing else left to give up for them (`brief`), a phone's among them, the retry gives up its own
 * word and its room, and the words are the retry: pressed, they ask once more, their name is
 * «Could not refresh · Retry», and their hint says what a press does. Dropped there instead, the
 * failure on a phone and beside a span of days said in Russian offered no retry of its own.
 *
 * A part that reads apart from the page — the side panel over it — says its own failure the same
 * way (`failed`), whatever the page's reads say, and holds its room as the bar does (`held`).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePageStanding } from '@/pages/analytics/composables/useReadStanding.ts'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    /** The bar's line has no room for the retry's own word: the words are the retry. */
    brief?: boolean
    /** Whether the read again failed, for a part that reads apart; the page's reads otherwise. */
    failed?: boolean
    /** The bar is fitting its line: the failure takes its room, drawn by nobody, failed or not. */
    held?: boolean
  }>(),
  { failed: undefined },
)
/** Read the view again. */
const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()
const standing = usePageStanding()
const failed = computed(() => props.failed ?? standing.failed.value)
</script>

<template>
  <p
    v-if="failed || held"
    class="refresh-failed"
    role="status"
    :class="{ 'refresh-failed-held': !failed }"
  >
    <span
      class="refresh-failed-mark disc-mark"
      aria-hidden="true"
    />
    <VButton
      v-if="brief"
      v-tooltip.detail="t('platform.actions.retry')"
      class="refresh-failed-retry refresh-failed-whole"
      variant="text"
      size="inline"
      @click="emit('retry')"
    >
      <span class="refresh-failed-words">{{ t('analytics.frame.refreshFailed') }}</span
      ><span class="visually-hidden"> · {{ t('platform.actions.retry') }}</span>
    </VButton>
    <template v-else>
      <span class="refresh-failed-words">{{ t('analytics.frame.refreshFailed') }} · </span>
      <VButton
        class="refresh-failed-retry"
        variant="text"
        size="inline"
        @click="emit('retry')"
      >
        {{ t('platform.actions.retry') }}
      </VButton>
    </template>
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

/* The words that are the retry wrap where the failure's words do, a phone's row being one such
   place, and give way in the failure's room as the words alone did, rather than holding a
   button's one line past the row's end. */
.refresh-failed .refresh-failed-whole {
  flex: 0 1 auto;
  min-width: 0;
  text-align: start;
  white-space: inherit;
}

/* The retry's ring stands inside its own box, as a period's does in its track: drawn round it, it
   touched the disc a gap of 4px before it at every width, and round the words wrapped onto two
   lines on a phone it stood 1.6px past the 36px row they share with the refresh. */
.refresh-failed .refresh-failed-retry:focus-visible {
  outline-offset: calc(-1 * var(--size-focus-ring));
}

/* Held while the bar fits its line: its room taken, nothing of it seen or heard. */
.refresh-failed-held {
  visibility: hidden;
}

/* The failure's disc (`discMark.css`), in the colour a failure is marked in. */
.refresh-failed-mark {
  background: var(--color-danger);
}
</style>

<style scoped src="@/pages/analytics/components/discMark.css"></style>
