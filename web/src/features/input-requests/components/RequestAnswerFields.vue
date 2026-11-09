<script setup lang="ts">
/**
 * The fields of a question being answered, and the field of the comment on the whole
 * question, whose press the card places in the block's head. That comment explains an answer
 * and does not stand in for one: it takes nothing away from what is required.
 *
 * Text is markdown, and the fields share one Write | Preview choice: several text
 * answers are one answer being written, and a choice per field would let them disagree
 * about which view is showing. The card owns what was refused and what Ctrl+Enter
 * sends; this owns the view and where focus goes. Each edit is handed up as the whole draft
 * it makes, because one press may change several fields: accepting a point fills its steps.
 *
 * A question with a verdict, a group or a field under another is answered row by row
 * (`RequestReview`); its foot then stays in sight under it, and says what is undecided.
 *
 * Each field is one question of its block to the rail of the list (`data-rail-question`,
 * `RequestRail`), named by its label.
 */
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestField from '@/features/input-requests/components/RequestField.vue'
import RequestNote from '@/features/input-requests/components/RequestNote.vue'
import RequestReview from '@/features/input-requests/components/RequestReview.vue'
import { useRequestNote } from '@/features/input-requests/composables/useRequestNote.ts'
import { isStructured } from '@/features/input-requests/utils/reviewForm.ts'
import { editField } from '@/features/input-requests/utils/validateAnswers.ts'
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
  edit: [draft: RequestDraft]
  note: [value: string]
  submit: []
}>()
const { t } = useI18n()
const previewing = ref(false)
const controls: Record<string, { focus: () => void } | null> = {}
const questionNote = ref<InstanceType<typeof RequestNote> | null>(null)
const {
  open: noteOpen,
  press: pressNote,
  written: noteWritten,
} = useRequestNote(
  () => props.draft.note,
  previewing,
  () => questionNote.value,
)

const structured = computed(() => isStructured(props.fields))
/** The fields drawn one under another, as a question without rows has them. */
const plainFields = computed(() => (structured.value ? [] : props.fields))
const review = ref<InstanceType<typeof RequestReview> | null>(null)
const undecided = computed(() => review.value?.undecided ?? 0)
const edit = (field: InputRequestField, change: FieldEdit) =>
  emit('edit', editField(props.draft, field.id, change))
function fieldError(field: InputRequestField) {
  return props.refused.includes(field.id) ? t(`requests.missing.${field.type}`) : ''
}
/** Take focus to one field; a text answer can only be fixed where it is written. */
async function focusField(id: string) {
  if (review.value) {
    await review.value.focusField(id)
    return
  }
  previewing.value = false
  await nextTick()
  controls[id]?.focus()
}
defineExpose({ focusField, noteOpen, noteWritten, pressNote, structured, undecided })
</script>

<template>
  <div class="request-fields">
    <RequestReview
      v-if="structured"
      ref="review"
      v-model:preview="previewing"
      :disabled="disabled"
      :draft="draft"
      :fields="fields"
      :prompt-id="promptId"
      :refused="refused"
      :suggest="suggest"
      @edit="emit('edit', $event)"
      @submit="emit('submit')"
    />
    <RequestField
      v-for="field in plainFields"
      :key="field.id"
      :ref="(control) => (controls[field.id] = control as { focus: () => void } | null)"
      v-model:preview="previewing"
      :data-rail-question="field.label"
      :field="field"
      :model-value="draft.answers[field.id]"
      :comment="draft.comments[field.id]"
      :disabled="disabled"
      :error="fieldError(field)"
      :prompt-id="promptId"
      :suggest="suggest"
      @edit="edit(field, $event)"
      @submit="emit('submit')"
    />
    <RequestNote
      v-if="noteOpen"
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
/* What sticks in the fields, a review's count, stands under the block's head where one sticks
   (`--request-head-height`, from `RequestCard`), and where the panel keeps it otherwise. */
.request-fields {
  --size-stuck-top: calc(var(--request-stuck-base, 0px) + var(--request-head-height, 0px));

  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
</style>
