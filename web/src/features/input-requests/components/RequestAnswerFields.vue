<script setup lang="ts">
/**
 * The fields of a question being answered, and the comment on the whole question. A
 * comment explains an answer and does not stand in for one: it takes nothing away from
 * what is required.
 *
 * Text is markdown, and the fields share one Write | Preview choice: several text
 * answers are one answer being written, and a choice per field would let them disagree
 * about which view is showing. The card owns what was refused and what Ctrl+Enter
 * sends; this owns the view and where focus goes.
 */
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestField from '@/features/input-requests/components/RequestField.vue'
import RequestNote from '@/features/input-requests/components/RequestNote.vue'
import { chosenOwn } from '@/features/input-requests/utils/validateAnswers.ts'
import type { FieldEdit, RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'
import type MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'

type EditorSuggest = InstanceType<typeof MarkdownEditor>['$props']['suggest']

const props = withDefaults(
  defineProps<{
    disabled: boolean
    draft: RequestDraft
    fields: readonly InputRequestField[]
    /** The element holding the question these fields answer. */
    promptId: string
    /** The fields the last send refused, by id. */
    refused: readonly string[]
    suggest?: EditorSuggest
  }>(),
  { suggest: undefined },
)
const emit = defineEmits<{
  edit: [field: InputRequestField, edit: FieldEdit]
  note: [value: string]
  submit: []
}>()
const { t } = useI18n()
const previewing = ref(false)
const controls: Record<string, { focus: () => void } | null> = {}
const questionNote = ref<InstanceType<typeof RequestNote> | null>(null)
const noteOpen = computed(() => questionNote.value?.open ?? false)

const isOwnChosen = (field: InputRequestField) => props.draft.ownChosen.includes(field.id)
/** An own variant chosen and left empty, which is said on its own editor. */
function ownRefused(field: InputRequestField) {
  return props.refused.includes(field.id) && isOwnChosen(field) && !chosenOwn(props.draft, field.id)
}
function ownError(field: InputRequestField) {
  return ownRefused(field) ? t('requests.missing.own') : ''
}
function fieldError(field: InputRequestField) {
  return props.refused.includes(field.id) && !ownRefused(field)
    ? t(`requests.missing.${field.type}`)
    : ''
}
/** Take focus to one field; a text answer can only be fixed where it is written. */
async function focusField(id: string) {
  previewing.value = false
  await nextTick()
  controls[id]?.focus()
}
defineExpose({ focusField, noteOpen })
</script>

<template>
  <div class="request-fields">
    <RequestField
      v-for="field in fields"
      :key="field.id"
      :ref="(control) => (controls[field.id] = control as { focus: () => void } | null)"
      v-model:preview="previewing"
      :field="field"
      :model-value="draft.answers[field.id]"
      :note="draft.fieldNotes[field.id]"
      :own="draft.own[field.id]"
      :own-chosen="isOwnChosen(field)"
      :own-error="ownError(field)"
      :disabled="disabled"
      :error="fieldError(field)"
      :prompt-id="promptId"
      :suggest="suggest"
      @edit="emit('edit', field, $event)"
      @submit="emit('submit')"
    />
    <RequestNote
      ref="questionNote"
      v-model:preview="previewing"
      :disabled="disabled"
      :label="t('requests.questionNote')"
      :maxlength="8000"
      :model-value="draft.note"
      :rows="3"
      :suggest="suggest"
      @update:model-value="emit('note', $event)"
      @submit="emit('submit')"
    />
  </div>
</template>

<style scoped>
.request-fields {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
</style>
