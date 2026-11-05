<script setup lang="ts">
/**
 * The shell's notice at the window's corner: what happened, the one thing that
 * can be done about it when there is one, and a way to put it away.
 *
 * It is announced politely and takes no focus: a notice reports, it does not
 * interrupt what the operator was typing. The status region is always there,
 * so that a notice arriving in it is announced rather than appearing with its
 * region; the box that shows the words comes and goes.
 *
 * It lies above every overlay, because a card or a dialog is where most presses
 * that say something happen, and under them it was said to nobody.
 *
 * How long it stays is `useNoticeCountdown`'s, and going by itself is the same as being
 * put away, for its region too.
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useNoticeCountdown } from '@/app/composables/useNoticeCountdown.ts'
import type { ShellNotice } from '@/app/composables/useShellNotice.ts'

import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ notice: ShellNotice | null }>()
const emit = defineEmits<{ act: []; dismiss: [] }>()
const { t } = useI18n()
const { focused, hovered } = useNoticeCountdown(
  () => props.notice,
  () => emit('dismiss'),
)
/**
 * Long enough for a screen reader to take the empty region as a change. NVDA and
 * JAWS read an identical sentence a second time only after a clear and a pause;
 * 100 ms is what Angular's LiveAnnouncer settled on for the same reason.
 */
const REANNOUNCE_MS = 100
/** The sentence and what can be done about it, which the box's own words stand in for. */
const spoken = ref('')
watch(
  () => props.notice,
  (notice, _previous, onCleanup) => {
    const sentence = [notice?.message, notice?.action?.label].filter(Boolean).join(' ')
    if (!spoken.value || !sentence) {
      spoken.value = sentence
      return
    }
    spoken.value = ''
    const timer = setTimeout(() => {
      spoken.value = sentence
    }, REANNOUNCE_MS)
    onCleanup(() => clearTimeout(timer))
  },
  { immediate: true },
)
</script>

<template>
  <div
    v-if="notice"
    class="notice"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
    @focusin="focused = true"
    @focusout="focused = false"
  >
    <span
      class="notice-message"
      aria-hidden="true"
      >{{ notice.message }}</span
    >
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
  <span
    class="visually-hidden"
    role="status"
    >{{ spoken }}</span
  >
</template>

<style scoped>
.notice {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 110;
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

/* A notice names what it is about, and a file's name may be one long word. */
.notice-message {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.notice-action,
.notice-dismiss {
  flex: 0 0 auto;
}
</style>
