<script setup lang="ts">
/**
 * The foot of a question: what it can do (`RequestActions`), the asking before a change is
 * thrown away, and why the last write did not go through.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestActions from '@/features/input-requests/components/RequestActions.vue'
import RequestNoteToggle from '@/features/input-requests/components/RequestNoteToggle.vue'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'

defineProps<{
  /** Throwing away a change was asked, and the next word decides. */
  askingCancel: boolean
  busy: boolean
  changing: boolean
  declining: boolean
  disabled: boolean
  dismissable: boolean
  /** Why the last write did not go through; empty while nothing failed. */
  error: string
  /** The comment on the question can be opened from here, and how it stands. */
  note: { disabled: boolean; open: boolean; written: boolean } | null
  refreshable: boolean
  standalone: boolean
  waiting: boolean
}>()
const emit = defineEmits<{
  'discard': []
  'dismiss': []
  'keep': []
  'note': []
  'onward': []
  'open': []
  'refresh': []
  'way-out': []
}>()
const { t } = useI18n()
const actions = ref<InstanceType<typeof RequestActions> | null>(null)
const errorLine = ref<HTMLElement | null>(null)

defineExpose({
  focusError: () => moveFocus(errorLine.value),
  focusWayOut: () => actions.value?.focusWayOut(),
})
</script>

<template>
  <footer class="request-foot">
    <ConfirmStrip
      v-if="askingCancel"
      class="request-confirm"
      tone="danger"
      :cancel-label="t('requests.keepChanging')"
      :confirm-label="t('requests.discardChange')"
      :message="t('requests.cancelAsked')"
      @cancel="emit('keep')"
      @confirm="emit('discard')"
    />
    <RequestActions
      v-show="!askingCancel"
      ref="actions"
      :busy="busy"
      :changing="changing"
      :declining="declining"
      :disabled="disabled"
      :dismissable="dismissable"
      :refreshable="refreshable"
      :standalone="standalone"
      :waiting="waiting"
      @dismiss="emit('dismiss')"
      @onward="emit('onward')"
      @open="emit('open')"
      @refresh="emit('refresh')"
      @way-out="emit('way-out')"
    >
      <RequestNoteToggle
        v-if="note"
        :disabled="note.disabled"
        :open="note.open"
        :title="t('requests.questionNote')"
        :written="note.written"
        @press="emit('note')"
      />
    </RequestActions>
    <p
      v-if="error"
      ref="errorLine"
      class="request-error"
      role="alert"
      tabindex="-1"
    >
      {{ error }}
    </p>
  </footer>
</template>

<style scoped>
/* What `RequestActions` asks lies against this, and takes no room in it unless a note is open. */
.request-foot {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  min-width: 0;
  container-type: inline-size;
}

.request-confirm {
  flex: 1 1 100%;
}

.request-error {
  flex: 1 1 100%;
  min-width: 0;
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);

  /* The app moves focus here when a write does not go through, and rings it (`moveFocus`). */
  &:focus-visible {
    border-radius: var(--radius-control);
    outline-offset: var(--space-1);
  }
}
</style>
