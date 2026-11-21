<script setup lang="ts">
/**
 * A question asked in place that waits for a reason (`ConfirmStrip` under a reason field): a
 * cancel's, or a move out of a goal's. The caret starts in the field, there to be typed in;
 * Escape there, or the way back, answers no.
 *
 * The way on sends nothing without a reason: it says `missing` under the strip and puts the
 * caret back in the field, and the words go once one is typed. What the host's write said when
 * it failed stands there too (`failure`); the host keeps the reason as it was.
 */
import { computed, onMounted, ref, useTemplateRef } from 'vue'

import { placeFocus } from '@/shared/lib/scriptedFocus.ts'
import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = withDefaults(
  defineProps<{
    cancelLabel: string
    confirmLabel: string
    /** The field's label. */
    label: string
    message: string
    /** What the strip says while the way on was pressed with no reason. */
    missing: string
    busy?: boolean
    /** Why the host's write did not go through; empty while nothing failed. */
    failure?: string
    tone?: 'danger' | 'primary'
  }>(),
  { busy: false, failure: '', tone: 'primary' },
)
const emit = defineEmits<{ cancel: []; confirm: [reason: string] }>()

const reason = ref('')
/** A missing reason is said once the press asked for it, and only while it is still missing. */
const asked = ref(false)
const error = computed(() => (asked.value && !reason.value.trim() ? props.missing : props.failure))
const field = useTemplateRef<{ control: () => HTMLInputElement | null }>('field')

onMounted(() => placeFocus(field.value?.control()))

function confirm() {
  if (props.busy) return
  if (!reason.value.trim()) {
    asked.value = true
    placeFocus(field.value?.control())
    return
  }
  emit('confirm', reason.value.trim())
}
</script>

<template>
  <div class="reason-strip">
    <VTextInput
      ref="field"
      v-model="reason"
      :label="label"
      :rows="2"
      :maxlength="400"
      :disabled="busy"
      @keydown.esc.stop.prevent="emit('cancel')"
    />
    <ConfirmStrip
      :tone="tone"
      :message="message"
      :confirm-label="confirmLabel"
      :cancel-label="cancelLabel"
      @confirm="confirm"
      @cancel="emit('cancel')"
    />
    <p
      v-if="error"
      class="reason-strip-error"
      role="alert"
    >
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.reason-strip {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.reason-strip-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
