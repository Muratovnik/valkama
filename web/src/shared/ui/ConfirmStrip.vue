<script setup lang="ts">
/**
 * A question asked where the action was taken: one sentence, the way on and the
 * way back.
 *
 * For an action that loses a draft or overrides someone else's decision. It is
 * not a modal: the surface around it stays usable, and the question disappears
 * with either answer. Focus lands on the way back, so a reflexive Enter keeps
 * the work instead of discarding it, and Escape answers it the same way rather
 * than closing whatever surface the strip stands in.
 */
import { onMounted, onUnmounted, ref, useId } from 'vue'

import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    cancelLabel: string
    confirmLabel: string
    message: string
    /**
     * It stands on a sheet, whose ground is the strip's own: there it draws no ground, which
     * could not be told from the sheet's, and no inset, which read as a third left edge.
     */
    onSheet?: boolean
    /** `danger` when going ahead destroys something, such as an unsaved draft. */
    tone?: 'danger' | 'primary'
  }>(),
  { onSheet: false, tone: 'primary' },
)

const emit = defineEmits<{ cancel: []; confirm: [] }>()
const id = useId()
const strip = ref<HTMLElement | null>(null)
// Whatever asked the question, read before the strip takes focus: the answer
// hands focus back to it instead of dropping it on the page body, where a
// keyboard reader has to start the surface over. A trigger that should get it
// back stays mounted (hidden, not removed) while the strip is up.
const active = document.activeElement
const opener = active instanceof HTMLElement && active !== document.body ? active : null

onMounted(() => {
  strip.value?.querySelector<HTMLButtonElement>('.confirm-cancel')?.focus()
})

onUnmounted(() => {
  const now = document.activeElement
  if (opener?.isConnected && (now === null || now === document.body)) opener.focus()
})
</script>

<template>
  <div
    ref="strip"
    class="confirm-strip"
    role="group"
    :class="{ 'on-sheet': props.onSheet }"
    :aria-labelledby="id"
  >
    <p
      :id="id"
      class="confirm-message"
    >
      {{ props.message }}
    </p>
    <div class="confirm-actions">
      <VButton
        class="confirm-cancel"
        @click="emit('cancel')"
        @keydown.esc.stop.prevent="emit('cancel')"
        >{{ props.cancelLabel }}</VButton
      >
      <VButton
        class="confirm-go"
        :variant="props.tone"
        @click="emit('confirm')"
        @keydown.esc.stop.prevent="emit('cancel')"
        >{{ props.confirmLabel }}</VButton
      >
    </div>
  </div>
</template>

<style scoped>
/* A ground one step above the surface it interrupts, and no outline: the
   question is an object lying on the panel, not a second panel. */
.confirm-strip {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-surface-muted);
  border-radius: var(--radius-card);
}

/* On a sheet of its own ground: the words and buttons on the column's edge. */
.confirm-strip.on-sheet {
  padding: 0;
  background: none;
}

.confirm-message {
  margin: 0;
  color: var(--color-text);
  font: var(--font-note);
  overflow-wrap: anywhere;
}

/* At the strip's end, as every form's buttons stand, on whichever line they take; started at
   its beginning they read as a list once they wrapped. */
.confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
}
</style>
