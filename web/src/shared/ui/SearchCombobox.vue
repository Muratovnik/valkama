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
 * A host whose list is too long to hand over whole, such as a space's cards, fills `options`
 * from what is typed: each search is told (`search`), as the list opens and as words change.
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
 *
 * One chosen value too long for its field ends in an ellipsis, whole in the field's hint, as a
 * one-line label does: a field draws its words without one, so they stood cut at the box's edge
 * with nothing to say there were more. While nobody types, the words are drawn over the field,
 * whose own stay what is read and edited (`data-chosen-words`); a press anywhere on them is a
 * press on the field.
 * The popup is ChoiceSelect's surface at the field's own width, so it never reaches past
 * the dialog the field stands in. A long option wraps inside it at a space, a hyphen or
 * after a `/` (`slashBreaks.ts`): a goal's option is its title, and a label is as often
 * a path of words such as `area/web`, so every option breaks the way a title does. An option
 * the host gave runs (`ChoiceOption.runs`) is drawn in them, a goal's code as code.
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

import { placeFocus } from '@/shared/lib/scriptedFocus.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import { choiceToken, freshToken, searchChoices, tokenValue } from '@/shared/ui/searchChoices.ts'
import SearchComboboxChips from '@/shared/ui/SearchComboboxChips.vue'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'
import { vTextRuns } from '@/shared/ui/textRuns.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
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
    /**
     * What the empty field says to do, in the field rather than a hint under it: a hint
     * under one field of a pair stood that field taller than the other.
     */
    placeholder?: string
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
    placeholder: '',
    removeLabel: (label: string) => label,
  },
)
const emit = defineEmits<{ 'search': [query: string]; 'update:modelValue': [value: Value] }>()

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
const runsOf = (value: string) => known.value.get(value)?.runs
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
/** The chosen words stand drawn over the field, cut where they must be: nobody is typing there. */
const covered = computed(
  () => !several.value && !open.value && shownLabel.value !== '' && text.value === shownLabel.value,
)
/** Those words whole, for the field's hint while they stand drawn over it. */
const coveredWords = computed(() => (covered.value ? shownLabel.value : ''))
const chips = computed(() =>
  several.value
    ? chosen.value.map((value) => ({ value, label: labelOf(value), runs: runsOf(value) }))
    : [],
)
/** Absent rather than false, because `aria-invalid="false"` is a claim and not a default. */
const invalidMark = computed(() => (props.error ? 'true' : undefined))
/**
 * The chosen words, standing in an emptied field while the list is open; else what the field
 * says to do while it holds nothing.
 */
const standIn = computed(() => {
  if (open.value && !several.value) return shownLabel.value
  const empty = several.value ? !chosen.value.length : !internal.value
  return empty && props.placeholder ? props.placeholder : undefined
})
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
  if (value) emit('search', '')
}

function typed(event: Event) {
  search.value = (event.target as HTMLInputElement).value
  emit('search', search.value)
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
  placeFocus(field.value?.$el)
}

/**
 * Focus in the field and the list open, for a host that shows the field on a press of its own.
 * It opens through the field's own press: a list opened from outside Reka counts as nobody
 * typing, and Reka then empties the field at each change of the value, so a write that lands
 * while the person types took the letters typed before it.
 */
function show() {
  const input = field.value?.$el
  placeFocus(input)
  input?.click()
}

/**
 * A press anywhere in the box but on a chip is a press on the field, which opens the
 * list the way the field's own press does.
 */
function pressBox(event: MouseEvent) {
  const input = field.value?.$el
  if (props.disabled || !input || event.target === input) return
  if ((event.target as Element).closest('button')) return
  placeFocus(input)
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
        <span
          v-tooltip.clipped="coveredWords"
          class="combo-field"
        >
          <ComboboxInput
            :id="controlId"
            ref="field"
            v-model="text"
            class="combo-input"
            :class="{ 'is-covered': covered }"
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
          <span
            v-if="covered"
            class="combo-shown one-line"
            aria-hidden="true"
            data-chosen-words
            >{{ shownLabel }}</span
          >
        </span>
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
                    v-if="option.runs"
                    v-text-runs="option.runs"
                    class="combo-title"
                  />
                  <strong
                    v-else
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

<style scoped src="./searchCombobox.css"></style>
