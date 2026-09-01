<script setup lang="ts">
import type { SelectionMode } from '@/shared/lib/uiSystem.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

withDefaults(
  defineProps<{
    label: string
    modelValue: string
    options: ChoiceOption[]
    disabled?: boolean
    emptyLabel?: string
    mode?: SelectionMode | 'auto'
    placeholder?: string
    searchable?: boolean
    searchPlaceholder?: string
  }>(),
  {
    placeholder: '',
    searchPlaceholder: '',
    emptyLabel: '',
    mode: 'auto',
    searchable: false,
    disabled: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <ChoiceSelect
    :model-value="modelValue"
    :options="options"
    :label="label"
    :placeholder="placeholder"
    :search-label="searchPlaceholder"
    :empty-label="emptyLabel"
    :searchable="searchable"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
