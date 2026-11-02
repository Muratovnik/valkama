<script setup lang="ts">
/**
 * The fields of a question still waiting for its answer, and the way to answer it in
 * one's own words, which is there on every question and stands in for what is required.
 * It closes again while it is empty, and never over something written in it.
 *
 * Text is markdown, and the fields share one Write | Preview choice: several text
 * answers are one answer being written, and a choice per field would let them disagree
 * about which view is showing. The card owns what was refused and what Ctrl+Enter
 * sends; this owns the view and where focus goes.
 */
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestField from '@/features/input-requests/components/RequestField.vue'

import type { InputAnswers, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import VButton from '@/shared/ui/VButton.vue'

type EditorSuggest = InstanceType<typeof MarkdownEditor>['$props']['suggest']

const props = withDefaults(
  defineProps<{
    disabled: boolean
    draft: InputAnswers
    fields: readonly InputRequestField[]
    note: string
    /** The element holding the question these fields answer. */
    promptId: string
    /** The fields the last send refused, by id. */
    refused: readonly string[]
    suggest?: EditorSuggest
  }>(),
  { suggest: undefined },
)
const emit = defineEmits<{
  edit: [field: InputRequestField, value: string | boolean | string[]]
  note: [value: string]
  submit: []
}>()
const { t } = useI18n()
const previewing = ref(false)
const controls: Record<string, { focus: () => void } | null> = {}
const ownEditor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const asked = ref(false)
const written = computed(() => Boolean(props.note.trim()))
const ownOpen = computed(() => asked.value || written.value)

function fieldError(field: InputRequestField) {
  return props.refused.includes(field.id) ? t(`requests.missing.${field.type}`) : ''
}
function isRequired(field: InputRequestField) {
  return field.required && !written.value
}
async function focusOwn() {
  previewing.value = false
  await nextTick()
  ownEditor.value?.focus()
}
function pressOwn() {
  if (!written.value) asked.value = !asked.value
  if (ownOpen.value) void focusOwn()
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
      :prompt-id="promptId"
      :required="isRequired(field)"
      :suggest="suggest"
      @update:model-value="emit('edit', field, $event)"
      @submit="emit('submit')"
    />
    <div class="request-own">
      <VButton
        class="request-own-toggle"
        variant="ghost"
        size="inline"
        :disabled="disabled"
        :aria-expanded="ownOpen"
        @click="pressOwn"
        >{{ t('requests.ownAnswer') }}</VButton
      >
      <MarkdownEditor
        v-if="ownOpen"
        ref="ownEditor"
        v-model:preview="previewing"
        :label="t('requests.ownAnswer')"
        :rows="3"
        :maxlength="8000"
        :model-value="note"
        :disabled="disabled"
        :suggest="suggest"
        hide-label
        @update:model-value="emit('note', $event)"
        @submit="emit('submit')"
      />
    </div>
  </div>
</template>

<style scoped>
.request-fields,
.request-own {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.request-own {
  gap: var(--space-2);
}

.request-own-toggle {
  justify-self: start;
}
</style>
