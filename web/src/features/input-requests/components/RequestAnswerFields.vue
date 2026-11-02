<script setup lang="ts">
/**
 * The fields of a question still waiting for its answer.
 *
 * A text answer is markdown, and the fields share one Write | Preview choice:
 * several text answers are one answer being written, and a choice per field would
 * let them disagree about which view is showing. The card owns what was refused
 * and what Ctrl+Enter sends; this owns the view and where focus goes.
 */
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestField from '@/features/input-requests/components/RequestField.vue'

import type { InputAnswers, InputRequestField } from '@/shared/api/inputRequestModel.ts'

const props = defineProps<{
  disabled: boolean
  draft: InputAnswers
  fields: readonly InputRequestField[]
  /** The fields the last send refused, by id. */
  refused: readonly string[]
}>()
const emit = defineEmits<{
  edit: [field: InputRequestField, value: string | boolean | string[]]
  submit: []
}>()
const { t } = useI18n()
const previewing = ref(false)
const controls: Record<string, { focus: () => void } | null> = {}

function fieldError(field: InputRequestField) {
  return props.refused.includes(field.id) ? t(`requests.missing.${field.type}`) : ''
}
/** Take focus to one field; a text answer can only be fixed where it is written. */
async function focusField(id: string) {
  previewing.value = false
  await nextTick()
  controls[id]?.focus()
}
defineExpose({ focusField })
</script>

<template>
  <div class="request-fields">
    <RequestField
      v-for="field in fields"
      :key="field.id"
      :ref="(control) => (controls[field.id] = control as { focus: () => void } | null)"
      v-model:preview="previewing"
      :field="field"
      :model-value="draft[field.id]"
      :disabled="disabled"
      :error="fieldError(field)"
      @update:model-value="emit('edit', field, $event)"
      @submit="emit('submit')"
    />
  </div>
</template>

<style scoped>
.request-fields {
  display: grid;
  gap: var(--space-4);
}
</style>
