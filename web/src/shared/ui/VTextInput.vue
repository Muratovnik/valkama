<script setup lang="ts">
/**
 * The product's text control: one line, or several when `rows` is set.
 *
 * A single component owns both because they are one control with one fill, one
 * hairline and one radius; splitting them is how the app ended up with three
 * different inputs in three dialogs. Dates keep the platform picker: a native
 * `date` control is already localized, keyboard-complete and screen-reader
 * complete, and the shared part worth owning is the field around it.
 *
 * The value is always emitted as a string. A caller that needs a number
 * converts it, because a control that guesses its own type is how a numeric
 * field ends up holding `NaN` the moment the box is cleared.
 */
import VField from '@/shared/ui/VField.vue'

withDefaults(
  defineProps<{
    label: string
    modelValue: string | number
    autocomplete?: 'off'
    /**
     * Only for the first field of a dialog the operator opened on purpose,
     * which is the case the accessibility rule against autofocus excludes.
     */
    autofocus?: boolean
    disabled?: boolean
    hint?: string
    inputmode?: 'numeric'
    list?: string
    max?: string
    maxlength?: number
    min?: string
    placeholder?: string
    /** Any positive value makes this a textarea of that many rows. */
    rows?: number
    spellcheck?: boolean
    type?: 'text' | 'number' | 'date' | 'datetime-local'
  }>(),
  {
    hint: '',
    placeholder: '',
    type: 'text',
    rows: 0,
    inputmode: undefined,
    min: undefined,
    max: undefined,
    maxlength: undefined,
    list: undefined,
    autocomplete: undefined,
    spellcheck: undefined,
    disabled: false,
    autofocus: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function edited(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement).value)
}
</script>

<template>
  <!-- The wrapping element is the label, which is what associates the control. -->
  <!-- eslint-disable vuejs-accessibility/no-autofocus -->
  <VField
    :label="label"
    :hint="hint"
  >
    <textarea
      v-if="rows"
      class="control"
      :rows="rows"
      :value="String(modelValue)"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :disabled="disabled"
      :autofocus="autofocus"
      :aria-label="label"
      @input="edited"
    />
    <input
      v-else
      class="control"
      :type="type"
      :value="String(modelValue)"
      :placeholder="placeholder"
      :inputmode="inputmode"
      :min="min"
      :max="max"
      :maxlength="maxlength"
      :list="list"
      :autocomplete="autocomplete"
      :spellcheck="spellcheck"
      :disabled="disabled"
      :autofocus="autofocus"
      :aria-label="label"
      @input="edited"
    />
  </VField>
</template>

<style scoped>
.control {
  width: 100%;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  font: var(--font-note);
  background: var(--color-control-surface);
  border-radius: var(--radius-control);

  &:not(textarea) {
    block-size: var(--size-control-height);
  }
}

textarea.control {
  /* How tall a note wants to be is the form's business, not the field's: a card
     comment and a profile prompt are two different amounts of writing. Both used
     to reach `:deep(textarea)` for it, which is this component's element rather
     than its root, so no class could carry it. The host declares the property on
     whatever it already puts a class on and inheritance does the rest. */
  min-height: var(--size-text-area-min-height, auto);
  resize: vertical;
}

.control:hover:not(:disabled) {
  border-color: var(--color-action-primary);
}

.control:disabled {
  color: var(--color-text-disabled);
  background: var(--color-control-disabled-surface);
  border-color: var(--color-rule);
  cursor: not-allowed;
}
</style>
