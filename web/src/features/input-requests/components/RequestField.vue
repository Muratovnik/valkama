<script setup lang="ts">
/**
 * One field of a question, drawn as the control its answer needs.
 *
 * Yes/No and a choice among a few options are radio buttons, all visible: one
 * click answers them. They used to be a dropdown whose placeholder was itself a
 * listed, checked option, which made one bit cost three clicks and let the
 * answer be "unset" again from the list. A longer choice keeps the dropdown,
 * with the placeholder only as its empty caption.
 *
 * A text answer is written in the markdown editor, because the answered
 * request draws it as markdown: `preview` shows it as it will read, shared by the
 * question's text answers, and Ctrl+Enter sends the answer (`submit`).
 *
 * A refused field says why under itself, and its control carries
 * `aria-invalid` and names that message with `aria-describedby`. The group is a
 * `radiogroup` rather than a `group` because that is a role `aria-invalid` is
 * defined on.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import VField from '@/shared/ui/VField.vue'

const props = withDefaults(
  defineProps<{
    disabled: boolean
    field: InputRequestField
    /** Why the value was refused; empty while it stands. */
    error?: string
    modelValue?: string | boolean | string[]
  }>(),
  { modelValue: undefined, error: '' },
)
const emit = defineEmits<{
  'submit': []
  'update:modelValue': [value: string | boolean | string[]]
}>()
/** A text answer shows as it will read rather than as it is written. */
const preview = defineModel<boolean>('preview', { default: false })
/** Up to this many options stay visible as radio buttons; more open a list. */
const VISIBLE_CHOICES = 4
const { t } = useI18n()
const id = useId()
const legendId = `${id}-legend`
const root = ref<HTMLElement | { $el: HTMLElement } | null>(null)
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const label = computed(
  () =>
    `${props.field.label} · ${t(props.field.required ? 'requests.required' : 'requests.optional')}`,
)
const textValue = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))
/** The chosen option as the controls spell it: a boolean becomes 'true' or 'false'. */
const chosen = computed(() => {
  if (typeof props.modelValue === 'boolean') return String(props.modelValue)
  return typeof props.modelValue === 'string' ? props.modelValue : ''
})
const options = computed(() =>
  props.field.type === 'boolean'
    ? [
        { value: 'true', label: t('requests.yes') },
        { value: 'false', label: t('requests.no') },
      ]
    : props.field.options.map((option) => ({ value: option.id, label: option.label })),
)
const control = computed(() => {
  if (props.field.type === 'text') return 'text'
  if (props.field.type === 'multi_choice') return 'checks'
  return props.field.type === 'boolean' || options.value.length <= VISIBLE_CHOICES
    ? 'radios'
    : 'select'
})
const errorId = computed(() => (props.error ? `${id}-error` : undefined))
const invalidMark = computed(() => (props.error ? 'true' : undefined))
/** A single answer is a radiogroup, which is where `aria-invalid` is defined; ticks are a group. */
const groupRole = computed(() => (control.value === 'radios' ? 'radiogroup' : undefined))
const groupInvalid = computed(() => (control.value === 'radios' ? invalidMark.value : undefined))
const isChosen = (value: string) => chosen.value === value
/** Yes and No are two words, so they share one row. */
const isYesNo = computed(() => props.field.type === 'boolean')

function choose(next: string) {
  emit('update:modelValue', props.field.type === 'boolean' ? next === 'true' : next)
}
function selected(option: string) {
  return Array.isArray(props.modelValue) && props.modelValue.includes(option)
}
function toggle(option: string, event: Event) {
  const current = Array.isArray(props.modelValue) ? props.modelValue : []
  emit(
    'update:modelValue',
    (event.target as HTMLInputElement).checked
      ? [...current, option]
      : current.filter((entry) => entry !== option),
  )
}
/** Moves focus to the field's control: the chosen radio, or the first one. */
function focus() {
  if (editor.value) {
    editor.value.focus()
    return
  }
  const element = root.value instanceof HTMLElement ? root.value : root.value?.$el
  const target =
    element?.querySelector<HTMLElement>('input:checked') ??
    element?.querySelector<HTMLElement>('input, textarea, button')
  target?.focus()
}
defineExpose({ focus })
</script>

<template>
  <MarkdownEditor
    v-if="control === 'text'"
    ref="editor"
    v-model:preview="preview"
    :label="label"
    :rows="2"
    :maxlength="8000"
    :model-value="textValue"
    :disabled="disabled"
    :error="error"
    quiet-error
    @update:model-value="emit('update:modelValue', $event)"
    @submit="emit('submit')"
  />
  <VField
    v-else-if="control === 'select'"
    ref="root"
    v-slot="{ errorId: messageId }"
    as="div"
    :label="label"
    :error="error"
  >
    <ChoiceSelect
      :label="label"
      :model-value="chosen"
      :options="options"
      :disabled="disabled"
      :placeholder="t('requests.choose')"
      :invalid="Boolean(error)"
      :describedby="messageId"
      @update:model-value="choose"
    />
  </VField>
  <fieldset
    v-else
    ref="root"
    class="request-choices"
    :class="{ 'is-row': isYesNo }"
    :role="groupRole"
    :aria-labelledby="legendId"
    :aria-invalid="groupInvalid"
    :aria-describedby="errorId"
    :disabled="disabled"
  >
    <legend
      :id="legendId"
      class="request-legend"
    >
      {{ label }}
    </legend>
    <template v-if="control === 'radios'">
      <label
        v-for="option in options"
        :key="option.value"
        class="request-check"
        ><input
          type="radio"
          :name="id"
          :value="option.value"
          :checked="isChosen(option.value)"
          @change="choose(option.value)"
        />{{ option.label }}</label
      >
    </template>
    <template v-else>
      <label
        v-for="option in field.options"
        :key="option.id"
        class="request-check"
        ><input
          type="checkbox"
          :value="option.id"
          :checked="selected(option.id)"
          :aria-invalid="invalidMark"
          @change="toggle(option.id, $event)"
        />{{ option.label }}</label
      >
    </template>
    <small
      v-if="error"
      :id="errorId"
      class="request-field-error"
      >{{ error }}</small
    >
  </fieldset>
</template>

<style scoped>
.request-choices {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}

/* Yes and No are two words: they sit side by side, so the answer is one row. */
.request-choices.is-row {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--space-6);

  .request-legend,
  .request-field-error {
    flex: 1 0 100%;
  }
}

/* Read as the label of a text field reads, so the fields of one question do
   not each wear a different caption. */
.request-legend {
  padding: 0;
  margin-bottom: var(--space-label-value);
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

.request-check {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--size-control-height);
  font-size: var(--font-size-interface);
  overflow-wrap: anywhere;
  cursor: pointer;
}

.request-field-error {
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
