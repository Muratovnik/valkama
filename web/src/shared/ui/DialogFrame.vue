<script setup lang="ts">
import { computed } from 'vue'

import OverlayHeader from '@/shared/ui/OverlayHeader.vue'
import OverlayHost from '@/shared/ui/OverlayHost.vue'

const props = withDefaults(
  defineProps<{
    closeLabel: string
    open: boolean
    title: string
    busy?: boolean
    /** Which record this dialog is about: a card number and its title. */
    context?: string
    /** Why the last submit did not go through. */
    error?: string
    subtitle?: string
    surfaceClass?: string
  }>(),
  { subtitle: '', surfaceClass: '', busy: false, context: '', error: '' },
)

const emit = defineEmits<{ close: []; submit: [] }>()

/** Absent rather than false, because `aria-busy="false"` is a claim and not a default. */
const busyMark = computed(() => props.busy || undefined)
</script>

<template>
  <OverlayHost
    layer="command"
    :open="open"
    :title="title"
    :aria-label="title"
    :surface-class="surfaceClass"
    @close="emit('close')"
  >
    <form
      class="dialog-frame"
      :aria-busy="busyMark"
      @submit.prevent="emit('submit')"
    >
      <OverlayHeader
        :title="title"
        :subtitle="subtitle"
        :context="context"
        :close-label="closeLabel"
        @close="emit('close')"
      />
      <div class="dialog-frame-body">
        <slot />
        <!-- A refused submit is announced where the operator is looking: at the
             end of the form they just tried to send, not in a corner banner. -->
        <p
          v-if="error"
          class="dialog-frame-error"
          role="alert"
        >
          {{ error }}
        </p>
      </div>
      <footer
        v-if="$slots.footer"
        class="dialog-frame-footer"
      >
        <slot name="footer" />
      </footer>
    </form>
  </OverlayHost>
</template>

<style scoped>
.dialog-frame {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  max-height: calc(100dvh - 40px);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  background: var(--color-surface);
  overflow: hidden;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-overlay);
}

.dialog-frame-body {
  display: grid;
  gap: var(--space-6);
  min-height: 0;
  padding: var(--space-6);
  overflow-y: auto;
}

.dialog-frame-error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-dense);
}

.dialog-frame-footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: flex-end;
  align-items: center;
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--color-rule);
}
</style>
