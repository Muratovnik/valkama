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
 * A textarea can also offer completions as it is typed in (`MarkdownEditor`):
 * `completion` names the list it controls and the row that is active, and the
 * keys and the caret are the host's, through `keydown` and `control()`. It
 * stays a multi-line text box rather than becoming a combobox, which has no
 * multi-line form and would have a screen reader announce something else; a
 * text box may carry `aria-autocomplete` and an active descendant. The list
 * itself belongs to the host.
 *
 * The value is always emitted as a string. A caller that needs a number
 * converts it, because a control that guesses its own type is how a numeric
 * field ends up holding `NaN` the moment the box is cleared.
 */
import { computed, ref } from 'vue'

import VField from '@/shared/ui/VField.vue'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: string | number
    autocomplete?: 'off'
    /**
     * Only for the first field of a dialog the operator opened on purpose,
     * which is the case the accessibility rule against autofocus excludes.
     */
    autofocus?: boolean
    /** A textarea that offers a list of completions; see the note above. */
    completion?: { controls: string; activeDescendant?: string }
    disabled?: boolean
    /** Why the value was refused; shown under the control and named by it. */
    error?: string
    /** The label reaches assistive technology only; see `VField`. */
    hideLabel?: boolean
    hint?: string
    inputmode?: 'numeric'
    list?: string
    max?: string
    maxlength?: number
    min?: string
    placeholder?: string
    /** Any positive value selects a textarea; content determines its height. */
    rows?: number
    /** `compact` rides a toolbar of compact controls, as `SegmentedControl` does. */
    size?: 'default' | 'compact'
    spellcheck?: boolean
    type?: 'text' | 'number' | 'date' | 'datetime-local'
  }>(),
  {
    hint: '',
    error: '',
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
    completion: undefined,
    hideLabel: false,
    size: 'default',
  },
)

const emit = defineEmits<{
  'keydown': [event: KeyboardEvent]
  'update:modelValue': [value: string]
}>()
const element = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
/** Absent rather than false, because `aria-invalid="false"` is a claim and not a default. */
const invalidMark = computed(() => (props.error ? 'true' : undefined))

function edited(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement).value)
}

defineExpose({
  /** The native control, for a host that reads or places the caret. */
  control: () => element.value,
})
</script>

<template>
  <!-- The wrapping element is the label, which is what associates the control. -->
  <!-- eslint-disable vuejs-accessibility/no-autofocus -->
  <VField
    v-slot="{ errorId }"
    :label="label"
    :hint="hint"
    :error="error"
    :hide-label="hideLabel"
  >
    <textarea
      v-if="rows"
      ref="element"
      class="control"
      :aria-autocomplete="completion && 'list'"
      :aria-controls="completion?.controls"
      :aria-activedescendant="completion?.activeDescendant"
      :rows="rows"
      :value="String(modelValue)"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :disabled="disabled"
      :autofocus="autofocus"
      :aria-label="label"
      :aria-invalid="invalidMark"
      :aria-describedby="errorId"
      @input="edited"
      @keydown="emit('keydown', $event)"
    />
    <input
      v-else
      ref="element"
      class="control"
      :class="`size-${size}`"
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
      :aria-invalid="invalidMark"
      :aria-describedby="errorId"
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
  font: var(--font-control);
  background: var(--color-control-surface);
  border-radius: var(--radius-control);

  &:not(textarea) {
    block-size: var(--size-control-height);
  }

  &.size-compact {
    block-size: var(--size-control-height-compact);
  }
}

textarea.control {
  /* How tall a note wants to be is the form's business, not the field's: a card
     comment and a profile prompt are two different amounts of writing. Both used
     to reach `:deep(textarea)` for it, which is this component's element rather
     than its root, so no class could carry it. The host declares the property on
     whatever it already puts a class on and inheritance does the rest. */
  min-height: var(--size-text-area-min-height);
  field-sizing: content;
  font: var(--font-editor);
  resize: none;
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
