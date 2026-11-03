<script setup lang="ts">
import { computed } from 'vue'

import OverlayHeader from '@/shared/ui/OverlayHeader.vue'
import OverlayHost from '@/shared/ui/OverlayHost.vue'
import type { OverlayPaneNames, PaneFit } from '@/shared/ui/overlayPanes.ts'

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
    pane?: OverlayPaneNames | null
    paneRoom?: number
    placement?: 'center' | 'top'
    subtitle?: string
    surfaceClass?: string
  }>(),
  { subtitle: '', surfaceClass: '', busy: false, context: '', error: '', placement: 'center' },
)

const emit = defineEmits<{
  'close': []
  'pane-close': []
  'pane-fit': [fit: PaneFit | null]
  'submit': []
}>()

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
    :placement="placement"
    :pane="pane"
    :pane-room="paneRoom"
    @close="emit('close')"
    @pane-close="emit('pane-close')"
    @pane-fit="(fit) => emit('pane-fit', fit)"
  >
    <form
      class="dialog-frame"
      :class="{ 'is-paired': pane }"
      :aria-busy="busyMark"
      @submit.prevent="emit('submit')"
    >
      <OverlayHeader
        :title="title"
        :subtitle="subtitle"
        :context="context"
        :close-label="closeLabel"
        :focusable-title="Boolean(pane)"
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
    <!-- Outside the form: a button in a form sends it unless told otherwise, and what is
         read beside a dialog must not answer for it. -->
    <template #pane>
      <slot name="pane" />
    </template>
  </OverlayHost>
</template>

<style scoped>
.dialog-frame {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-columns: minmax(0, 1fr);
  max-height: calc(100dvh - 40px);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  background: var(--color-surface);
  overflow: hidden;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-overlay);

  &.is-paired {
    flex: 1 1 auto;
  }
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
