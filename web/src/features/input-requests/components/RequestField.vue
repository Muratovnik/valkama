<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'
const props = defineProps<{
  disabled: boolean
  field: InputRequestField
  modelValue?: string | boolean | string[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string | boolean | string[]] }>()
const { t } = useI18n()
const value = computed(() => props.modelValue)
const label = computed(
  () =>
    `${props.field.label} · ${t(props.field.required ? 'requests.required' : 'requests.optional')}`,
)
const textValue = computed(() => (typeof value.value === 'string' ? value.value : ''))
const selectText = computed(() => {
  if (typeof value.value === 'boolean') return String(value.value)
  if (typeof value.value === 'string') return value.value
  return ''
})
const selectOptions = computed(() => {
  const options: ChoiceOption[] = []
  if (props.field.type === 'boolean') {
    options.push(
      { value: 'true', label: t('requests.yes') },
      { value: 'false', label: t('requests.no') },
    )
  } else if (props.field.type === 'choice') {
    options.push(
      ...props.field.options.map((option) => ({ value: option.id, label: option.label })),
    )
  }

  return [{ value: '', label: t('requests.choose') }, ...options]
})
function selected(option: string) {
  return Array.isArray(value.value) && value.value.includes(option)
}
function selectValue(next: string) {
  emit('update:modelValue', props.field.type === 'boolean' && next !== '' ? next === 'true' : next)
}
function toggle(option: string, event: Event) {
  const current = Array.isArray(value.value) ? value.value : []
  emit(
    'update:modelValue',
    (event.target as HTMLInputElement).checked
      ? [...current, option]
      : current.filter((entry) => entry !== option),
  )
}
</script>
<template>
  <VTextInput
    v-if="field.type === 'text'"
    :label="label"
    :rows="2"
    :maxlength="8000"
    :model-value="textValue"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <div
    v-else-if="field.type === 'choice' || field.type === 'boolean'"
    class="request-field"
  >
    <span>{{ label }}</span>
    <ChoiceSelect
      :label="label"
      :model-value="selectText"
      :options="selectOptions"
      :disabled="disabled"
      :placeholder="t('requests.choose')"
      @update:model-value="selectValue"
    />
  </div>
  <fieldset
    v-else
    class="request-choices"
    :disabled="disabled"
  >
    <legend class="request-legend">{{ label }}</legend>
    <label
      v-for="option in field.options"
      :key="option.id"
      class="request-check"
      ><input
        type="checkbox"
        :value="option.id"
        :checked="selected(option.id)"
        @change="toggle(option.id, $event)"
      />{{ option.label }}</label
    >
  </fieldset>
</template>
<style scoped>
.request-field {
  display: grid;
  gap: var(--space-2);
  font-size: var(--font-size-interface);
}

.request-choices {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}

.request-legend {
  margin-bottom: var(--space-2);
  font-size: var(--font-size-interface);
}

.request-check {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--size-control-height);
  font-size: var(--font-size-interface);
}
</style>
