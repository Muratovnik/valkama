<script setup lang="ts">
/**
 * The field of a comment, on a field or on the whole question, under its own words because its
 * press stands elsewhere (`RequestNoteToggle`). It answers nothing: a comment beside a choice
 * explains the choice and never stands in for one.
 */
import { ref } from 'vue'

import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'

withDefaults(
  defineProps<{
    disabled: boolean
    label: string
    maxlength: number
    modelValue: string
    rows: number
    /** What the empty field says it is for, where that depends on the rest of the form. */
    placeholder?: string
    suggest?: InstanceType<typeof MarkdownEditor>['$props']['suggest']
  }>(),
  { placeholder: '', suggest: undefined },
)
const emit = defineEmits<{ 'submit': []; 'update:modelValue': [value: string] }>()
const preview = defineModel<boolean>('preview', { default: false })
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <MarkdownEditor
    ref="editor"
    v-model:preview="preview"
    class="request-note"
    :label="label"
    :rows="rows"
    :maxlength="maxlength"
    :model-value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :suggest="suggest"
    @update:model-value="emit('update:modelValue', $event)"
    @submit="emit('submit')"
  />
</template>
