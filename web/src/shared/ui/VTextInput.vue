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
 * A single-line field with `completion` is a combobox, which is what a one-line
 * text box that drives a list popup is (the Work filter): it says whether the
 * list is open (`expanded`), and its keys reach the host the same way.
 *
 * The value is always emitted as a string. A caller that needs a number
 * converts it, because a control that guesses its own type is how a numeric
 * field ends up holding `NaN` the moment the box is cleared.
 *
 * A one-line field whose room changes with the row it rides — the Work bar's
 * filter is 81px of text on a phone — may name a `shortPlaceholder`. The field
 * measures its whole placeholder against its own text box and shows the short
 * one where the whole one would be cut: «Номер или і» said less than «Поиск».
 */
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'

import { useResizeObserver } from '@vueuse/core'

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
    /** A field that offers a list of completions; see the note above. */
    completion?: { controls: string; activeDescendant?: string; expanded?: boolean }
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
    /** A one-line field's placeholder where the whole one would be cut; see above. */
    shortPlaceholder?: string
    /** `compact` rides a toolbar of compact controls, as `SegmentedControl` does. */
    size?: 'default' | 'compact'
    spellcheck?: boolean
    type?: 'text' | 'number' | 'date' | 'datetime-local'
  }>(),
  {
    hint: '',
    error: '',
    placeholder: '',
    shortPlaceholder: '',
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

/** A one-line field driving a list is a combobox; without a list it is a text box. */
const combobox = computed(() =>
  props.completion
    ? {
        'role': 'combobox',
        'aria-autocomplete': 'list' as const,
        'aria-controls': props.completion.controls,
        'aria-activedescendant': props.completion.activeDescendant,
        'aria-expanded': props.completion.expanded ?? false,
      }
    : {},
)

/**
 * Whether the whole placeholder is wider than the text box it sits in. The
 * whole placeholder is drawn out of sight in the control's font and measured;
 * where nothing can be measured it fits, and the whole one shows.
 */
const ghost = useTemplateRef<HTMLElement>('ghost')
const cut = ref(false)
function measure() {
  const control = element.value
  if (!props.shortPlaceholder || !control || !ghost.value) {
    cut.value = false
    return
  }
  const style = getComputedStyle(control)
  const inset =
    (Number.parseFloat(style.paddingInlineStart) || 0) +
    (Number.parseFloat(style.paddingInlineEnd) || 0)
  cut.value = ghost.value.offsetWidth > control.clientWidth - inset
}
useResizeObserver(element, measure)
watch([() => props.placeholder, () => props.shortPlaceholder], () => nextTick(measure))
// The words are measured again once the product's fonts have arrived.
onMounted(() => void document.fonts?.ready.then(measure))
const shownPlaceholder = computed(() =>
  cut.value && props.shortPlaceholder ? props.shortPlaceholder : props.placeholder,
)

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
      :placeholder="shownPlaceholder"
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
      v-bind="combobox"
      @input="edited"
      @keydown="emit('keydown', $event)"
    />
    <span
      v-if="shortPlaceholder && !rows"
      class="placeholder-room"
      aria-hidden="true"
      ><span
        ref="ghost"
        class="placeholder-ghost"
        >{{ placeholder }}</span
      ></span
    >
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

/* The whole placeholder, drawn to be measured: no room, no pointer, nothing
   for a reader, and nothing that can widen what holds the field. */
.placeholder-room {
  position: absolute;
  inline-size: 0;
  block-size: 0;
  overflow: hidden;
  pointer-events: none;
  visibility: hidden;
}

.placeholder-ghost {
  font: var(--font-control);
  white-space: nowrap;
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
