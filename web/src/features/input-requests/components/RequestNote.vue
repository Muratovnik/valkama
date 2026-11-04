<script setup lang="ts">
/**
 * A comment one quiet press away, on a field or on the whole question. It answers nothing:
 * a comment beside a choice explains the choice and never stands in for one.
 *
 * It closes again on the same press while it is empty, and never over something written.
 */
import { computed, nextTick, ref } from 'vue'

import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    disabled: boolean
    /** What the toggle says. */
    label: string
    maxlength: number
    modelValue: string
    rows: number
    /** The editor's own name, where the toggle's words would not say what it is about. */
    name?: string
    suggest?: InstanceType<typeof MarkdownEditor>['$props']['suggest']
  }>(),
  { name: undefined, suggest: undefined },
)
const emit = defineEmits<{ 'submit': []; 'update:modelValue': [value: string] }>()
const preview = defineModel<boolean>('preview', { default: false })
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const asked = ref(false)
const written = computed(() => Boolean(props.modelValue.trim()))
const open = computed(() => asked.value || written.value)

async function press() {
  if (!written.value) asked.value = !asked.value
  if (!open.value) return
  preview.value = false
  await nextTick()
  editor.value?.focus()
}
defineExpose({ open })
</script>

<template>
  <div class="request-note">
    <VButton
      class="request-note-toggle"
      variant="text"
      size="inline"
      :disabled="disabled"
      :aria-expanded="open"
      :aria-label="name"
      @click="press"
      >{{ label }}</VButton
    >
    <MarkdownEditor
      v-if="open"
      ref="editor"
      v-model:preview="preview"
      :label="name ?? label"
      :rows="rows"
      :maxlength="maxlength"
      :model-value="modelValue"
      :disabled="disabled"
      :suggest="suggest"
      hide-label
      @update:model-value="emit('update:modelValue', $event)"
      @submit="emit('submit')"
    />
  </div>
</template>

<style scoped>
.request-note {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

/* A comment is one quiet press away: bare, its words where the fields start, the margin
   taking back the inset its fill keeps under the pointer. */
.request-note-toggle {
  justify-self: start;
  margin-inline-start: calc(-1 * var(--space-2));
}
</style>
