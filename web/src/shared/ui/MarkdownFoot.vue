<script setup lang="ts">
/**
 * The foot of `MarkdownEditor`: what is said about the text at its start — the short hint,
 * or why the text was refused in its place — and the host's action for the text at its end.
 * The editor draws it only when there is a refusal to say or an action to offer, and keeps
 * the field's half of the contract: the id the text names as its description and whether
 * the refusal is an alert.
 */
import { useI18n } from 'vue-i18n'

import FieldError from '@/shared/ui/FieldError.vue'

defineProps<{
  /** Why the text was refused; the hint stands in its place while there is none. */
  error: string
  errorId: string
  errorRole?: 'alert'
}>()
const { t } = useI18n()
</script>

<template>
  <div class="markdown-foot">
    <FieldError
      v-if="error"
      :id="errorId"
      class="markdown-error"
      :role="errorRole"
      >{{ error }}</FieldError
    >
    <small
      v-else
      class="markdown-hint"
      >{{ t('editor.hint') }}</small
    >
    <div
      v-if="$slots.actions"
      class="markdown-actions"
    >
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
/* What is said about the text at the start, what is done with it at the end. The
   actions take a line of their own only where the words need the room. */
.markdown-foot {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
}

/* One short line: what gives way next to a wide action is the row, not this. */
.markdown-hint {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  white-space: nowrap;
}

.markdown-error {
  flex: 1 1 8rem;
}

.markdown-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
  margin-inline-start: auto;
}
</style>
