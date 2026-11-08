<script setup lang="ts" generic="Value extends string | string[]">
/**
 * A field that is typed into to find a value in a list, and takes only what the list holds.
 *
 * The model's shape says which kind it is. A string is one value: the list's own words
 * stand in the field, and what is typed there only searches, so a reference that names
 * nothing on the list is never the value; leaving the field puts the chosen words back.
 * An array is several: each stands before the text as a chip that a press or Backspace
 * on an empty field removes, choosing a chosen one again takes it out, and with
 * `createLabel` the typed words can be added as a value the list did not have.
 *
 * Reka's combobox owns the keys and the list's semantics; this owns the search, the
 * chips and Escape. Escape is caught on the field, because the dialog round a field
 * hears it on the document before the list would, and a dialog closing under an open
 * list took the draft with it. With the list closed the key goes on to the dialog.
 *
 * The box draws what `VTextInput` draws — one fill, one hairline, one radius, the same edge
 * on hover and focus, doubled when refused — so the two read as one kind of field side by
 * side; a press anywhere on it is a press on the field. The chips are `SearchComboboxChips`'s,
 * and the highlighted row keeps an edge in a forced palette, where it clears every fill.
 * The popup is ChoiceSelect's surface at the field's own width, so it never reaches past
 * the dialog the field stands in. A long option wraps inside it at a space, a hyphen or
 * after a `/` (`slashBreaks.ts`): an epic's option is its title, and a label is as often
 * a path of words such as `area/web`, so every option breaks the way a title does.
 */
import { computed, ref, useTemplateRef, watch } from 'vue'

import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
} from 'reka-ui'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import { choiceToken, freshToken, searchChoices, tokenValue } from '@/shared/ui/searchChoices.ts'
import SearchComboboxChips from '@/shared/ui/SearchComboboxChips.vue'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'
import VField from '@/shared/ui/VField.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    /** What the list says while nothing on it answers what was typed, or it is empty. */
    emptyLabel: string
    label: string
    modelValue: Value
    options: readonly ChoiceOption[]
    disabled?: boolean
    error?: string
    /** The label for assistive technology only, where the field stands in a line that names it. */
    hideLabel?: boolean
    hint?: string
    /** How many values it may hold; nothing more is offered once it holds them. */
    max?: number
    /** How long one typed value may be. */
    maxlength?: number
    /** The row that adds the typed words as a new value; several values only. */
    createLabel?: (text: string) => string
    /** The name of a chip's remove button. */
    removeLabel?: (label: string) => string
  }>(),
  {
    createLabel: undefined,
    disabled: false,
    error: '',
    hideLabel: false,
    hint: '',
    max: Number.POSITIVE_INFINITY,
    maxlength: 200,
    removeLabel: (label: string) => label,
  },
)
const emit = defineEmits<{ 'update:modelValue': [value: Value] }>()

/**
 * Over the dialog, as every list portalled out of one is. Reka lifts its positioning
 * wrapper to the z-index of the element it is given, and that element is not this
 * file's own, so a scoped class never reaches it: the list stood behind the dialog.
 *
 * A press on the list leaves the focus in the field, as a key does. An option has tabindex
 * -1, so a press gave it the focus, and when choosing one closed the list under it the focus
 * fell to the page: the next Tab started from the top of the document.
 */
const LAYER = { zIndex: 120 }

const open = ref(false)
/** What the field shows: the chosen words, or what is being typed. */
const text = ref('')
/** What was typed since the list opened; the list is searched by this alone. */
const search = ref('')
const field = useTemplateRef<{ $el: HTMLInputElement }>('field')
const root = useTemplateRef<{ highlightedElement?: HTMLElement }>('root')
/** Reka keeps naming the row it last lit after the list has gone, which names nothing. */
const activeRow = computed(() => (open.value ? root.value?.highlightedElement?.id : undefined))

const several = computed(() => Array.isArray(props.modelValue))
const chosen = computed<string[]>(() =>
  Array.isArray(props.modelValue) ? [...props.modelValue] : [props.modelValue],
)
const known = computed(() => new Map(props.options.map((option) => [option.value, option])))
const labelOf = (value: string) => known.value.get(value)?.label ?? value
const full = computed(() => several.value && chosen.value.length >= props.max)
const searched = computed(() =>
  searchChoices({
    chosen: chosen.value,
    creatable: several.value && Boolean(props.createLabel) && !full.value,
    options: props.options,
    query: search.value,
    several: several.value,
  }),
)

/** Null rather than undefined for none: mounted on undefined, Reka keeps its own model. */
const internal = computed(() => {
  if (several.value) return chosen.value.map((value) => choiceToken(value))
  const value = chosen.value[0] ?? ''
  return known.value.has(value) ? choiceToken(value) : null
})
const display = (entry: unknown) => (typeof entry === 'string' ? labelOf(tokenValue(entry)) : '')
const shownLabel = computed(() => (several.value ? '' : display(internal.value)))
const chips = computed(() =>
  several.value ? chosen.value.map((value) => ({ value, label: labelOf(value) })) : [],
)
/** Absent rather than false, because `aria-invalid="false"` is a claim and not a default. */
const invalidMark = computed(() => (props.error ? 'true' : undefined))
/** The chosen words, standing in an emptied field while the list is open. */
const standIn = computed(() => (open.value && !several.value ? shownLabel.value : undefined))
const unavailable = (option: ChoiceOption) =>
  Boolean(option.disabled) || (full.value && !chosen.value.includes(option.value))

// The words in the field follow the value whenever nobody is typing there.
watch(
  shownLabel,
  (label) => {
    if (!open.value) text.value = label
  },
  { immediate: true },
)

function chose(value: unknown) {
  if (Array.isArray(value)) {
    const tokens = value.filter((entry) => typeof entry === 'string')
    const values = [...new Set(tokens.map((entry) => tokenValue(entry)))]
    emit('update:modelValue', values.filter(Boolean).slice(0, props.max) as Value)
    text.value = ''
    search.value = ''
  } else if (typeof value === 'string') emit('update:modelValue', tokenValue(value) as Value)
}

function opened(value: boolean) {
  open.value = value
  search.value = ''
}

function typed(event: Event) {
  search.value = (event.target as HTMLInputElement).value
}

/**
 * Typing replaces the chosen words rather than adding to them. A press opens the list over an
 * empty search with the chosen words standing in its place, so what is typed next searches from
 * nothing, from any keyboard: a phone's composes even Latin words, past any key handler. Selecting
 * the words did the same, and painted the whole value as selected on every press. Reka puts
 * the words back as the list closes.
 */
function clearWords() {
  if (!several.value && !search.value && text.value === shownLabel.value) text.value = ''
}

function keydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    opened(false)
    text.value = shownLabel.value
  } else if (event.key === 'Enter' && open.value) {
    // Enter on an open list chooses from it, and never sends the form round it.
    event.preventDefault()
  } else if (event.key === 'Backspace' && several.value && !text.value && chosen.value.length) {
    event.preventDefault()
    remove(chosen.value.length - 1)
  }
}

function remove(index: number) {
  emit('update:modelValue', chosen.value.filter((_, place) => place !== index) as Value)
  field.value?.$el.focus()
}

/** Focus in the field and the list open, for a host that shows the field on a press of its own. */
function show() {
  field.value?.$el.focus()
  opened(true)
}

/**
 * A press anywhere in the box but on a chip is a press on the field, which opens the
 * list the way the field's own press does.
 */
function pressBox(event: MouseEvent) {
  const input = field.value?.$el
  if (props.disabled || !input || event.target === input) return
  if ((event.target as Element).closest('button')) return
  input.focus()
  input.click()
}

defineExpose({ show })
</script>

<template>
  <VField
    v-slot="{ controlId, describedBy }"
    :label="label"
    :hint="hint"
    :error="error"
    :hide-label="hideLabel"
  >
    <ComboboxRoot
      ref="root"
      :model-value="internal"
      :open="open"
      :multiple="several"
      :disabled="disabled"
      :ignore-filter="true"
      :open-on-click="true"
      @update:model-value="chose"
      @update:open="opened"
    >
      <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
      <ComboboxAnchor
        class="combo-box"
        :class="{ disabled, invalid: error }"
        @click="pressBox"
      >
        <SearchComboboxChips
          v-if="chips.length"
          :chips="chips"
          :disabled="disabled"
          :remove-label="removeLabel"
          @remove="remove"
        />
        <ComboboxInput
          :id="controlId"
          ref="field"
          v-model="text"
          class="combo-input"
          :display-value="display"
          :maxlength="maxlength"
          :aria-describedby="describedBy"
          :aria-activedescendant="activeRow"
          :aria-invalid="invalidMark"
          :placeholder="standIn"
          @input="typed"
          @click="clearWords"
          @keydown="keydown"
        />
        <VIcon
          class="combo-chevron"
          name="chevron-down"
          aria-hidden="true"
          :size="18"
        />
      </ComboboxAnchor>
      <ComboboxPortal>
        <ComboboxContent
          position="popper"
          :side-offset="5"
          :collision-padding="12"
          :hide-when-detached="true"
          :aria-label="label"
          :style="LAYER"
          @pointerdown.prevent
        >
          <div class="combo-popup">
            <ComboboxItem
              v-for="option in searched.found"
              :key="option.value"
              :value="choiceToken(option.value)"
              :disabled="unavailable(option)"
              :text-value="option.label"
              as-child
            >
              <div class="combo-option">
                <span class="combo-value">
                  <strong
                    v-slash-breaks="option.label"
                    class="combo-title"
                  />
                  <small
                    v-if="option.description"
                    class="combo-note"
                    >{{ option.description }}</small
                  >
                </span>
                <VIcon
                  class="combo-check"
                  name="check"
                  :size="18"
                />
              </div>
            </ComboboxItem>
            <ComboboxItem
              v-if="searched.fresh"
              :value="freshToken(searched.fresh)"
              :text-value="searched.fresh"
              as-child
            >
              <div class="combo-option">
                <span class="combo-title">{{ createLabel?.(searched.fresh) }}</span>
                <VIcon
                  class="combo-add"
                  name="plus"
                  :size="18"
                />
              </div>
            </ComboboxItem>
            <p
              v-if="!searched.found.length && !searched.fresh"
              class="combo-empty"
            >
              {{ emptyLabel }}
            </p>
          </div>
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
  </VField>
</template>

<style scoped>
.combo-box {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  align-items: center;
  min-height: var(--size-control-height);
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
  border: 1px solid var(--color-rule-strong);
  background: var(--color-control-surface);
  border-radius: var(--radius-control);
  cursor: text;

  &:hover:not(.disabled, :has(.combo-input:focus-visible)) {
    border-color: var(--color-action-primary);
  }

  &:has(.combo-input:focus-visible) {
    border-color: var(--color-focus-ring);
  }

  &.invalid {
    outline: 1px solid var(--color-text-muted);
    outline-offset: -2px;
  }

  &.disabled {
    color: var(--color-text-disabled);
    background: var(--color-control-disabled-surface);
    border-color: var(--color-rule);
    cursor: not-allowed;
  }
}

.combo-input {
  flex: 1 1 8ch;
  width: 0;
  min-width: 8ch;
  min-height: var(--size-control-inline);
  padding: 0;
  border: 0;
  color: inherit;
  font: var(--font-control);
  background: transparent;
  outline: 0;
}

.combo-chevron {
  flex: 0 0 auto;
  margin-inline-start: auto;
  color: var(--color-text-muted);
  pointer-events: none;
}

.combo-popup {
  width: var(--reka-combobox-trigger-width);
  max-width: calc(100vw - 24px);
  max-height: min(320px, var(--reka-combobox-content-available-height));
  padding: var(--space-1);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  background: var(--color-surface);
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: var(--radius-control);
  box-shadow: 0 14px 34px var(--color-shadow);
}

.combo-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  gap: var(--space-3);
  align-items: center;
  min-height: var(--size-control-height);
  padding: var(--space-2);
  border-radius: var(--radius-status);
  cursor: pointer;

  &[data-highlighted] {
    background: var(--color-surface-active);

    @media (forced-colors: active) {
      outline: var(--size-focus-ring) solid Highlight;
      outline-offset: -2px;
    }
  }

  &[data-disabled] {
    opacity: 0.58;
    cursor: not-allowed;
  }

  &:not([data-state='checked']) .combo-check {
    visibility: hidden;
  }
}

.combo-title {
  display: block;
  font: var(--font-row-title);
  overflow-wrap: anywhere;
}

.combo-note {
  display: block;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.combo-empty {
  padding: var(--space-3);
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-interface);
  text-align: center;
}
</style>
