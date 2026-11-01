<script setup lang="ts">
/**
 * The fields of a question still waiting for its answer.
 *
 * A text answer is markdown, so the fields share one Write | Preview switch:
 * several text answers are one answer being written, and a switch per field
 * would let them disagree about which view is showing. The card owns what was
 * refused and what Ctrl+Enter sends; this owns the view and where focus goes.
 */
import { computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestField from '@/features/input-requests/components/RequestField.vue'

import type { InputAnswers, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { useEditorView } from '@/shared/ui/editorView.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

const props = defineProps<{
  /** What Ctrl+Enter in a text answer does, as the card's own button says it. */
  action: string
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
const { previewing, view, views } = useEditorView()
const controls: Record<string, { focus: () => void } | null> = {}
const writesText = computed(() => props.fields.some((field) => field.type === 'text'))

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
    <SegmentedControl
      v-if="writesText"
      v-model="view"
      class="request-view"
      size="compact"
      :label="t('editor.view')"
      :options="views"
    />
    <RequestField
      v-for="field in fields"
      :key="field.id"
      :ref="(control) => (controls[field.id] = control as { focus: () => void } | null)"
      :field="field"
      :action="action"
      :preview="previewing"
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

.request-view {
  justify-self: start;
}
</style>
