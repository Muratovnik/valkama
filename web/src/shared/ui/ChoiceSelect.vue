<script setup lang="ts" generic="Option extends ChoiceOption">
/**
 * A host may draw the chosen value its own way through the `value` slot — a state with its
 * dot — and each option through the `option` slot: a host that draws its values with more
 * than words, a priority's glyph or a state's dot, draws both, so a list and its button say
 * a value one way. What a value means stays the option's note under it in the list.
 * A host's drawing keeps the one-line rule the default title has, and its box says the value's
 * words whole while it is cut: the trigger's box the chosen value's, as each row its option's.
 */
import { computed, nextTick, ref } from 'vue'

import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'

import { choiceValueCodec, decodeChoiceValue, encodeChoiceValue } from '@/shared/ui/choiceControls'
import type { ChoiceOption } from '@/shared/ui/choiceControls'
import ControlIcon from '@/shared/ui/ControlIcon.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: string
    options: readonly Option[]
    /** The id of the message that says why the choice was refused. */
    describedby?: string
    disabled?: boolean
    emptyLabel?: string
    invalid?: boolean
    placeholder?: string
    searchable?: boolean
    searchLabel?: string
    /**
     * `compact` rides a toolbar of compact controls, as `SegmentedControl` does;
     * `heading` rides a table's heading row, in the heading's font.
     */
    size?: 'default' | 'compact' | 'heading'
  }>(),
  {
    size: 'default',
    searchable: false,
    placeholder: '',
    searchLabel: 'Search',
    emptyLabel: 'No matches',
    disabled: false,
    describedby: undefined,
    invalid: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
/** Absent rather than false, because `aria-invalid="false"` is a claim and not a default. */
const invalidMark = computed(() => (props.invalid ? 'true' : undefined))
/** A heading's trigger keeps to its neighbours' size, chevron included. */
const chevronSize = computed(() => (props.size === 'heading' ? 14 : 18))
const open = ref(false)
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const codec = computed(() => choiceValueCodec(props.options))
const selected = computed(() => props.options.find((option) => option.value === props.modelValue))
// Null rather than undefined when no option is chosen. Reka decides once, at
// mount, whether it follows the model or keeps its own: mounted on undefined it
// keeps its own for life, so a parent that answered a choice by staying unset
// (a state move the server refused) left the item selected inside the list, and
// choosing it again changed nothing and sent nothing.
const internalValue = computed(() => encodeChoiceValue(codec.value, props.modelValue) ?? null)
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return needle
    ? props.options.filter((option) =>
        `${option.label} ${option.description ?? ''}`.toLocaleLowerCase().includes(needle),
      )
    : [...props.options]
})

function updateValue(value: unknown) {
  if (typeof value !== 'string') return
  const decoded = decodeChoiceValue(codec.value, value)
  if (decoded === null || decoded === props.modelValue) return
  emit('update:modelValue', decoded)
}

function optionToken(value: string): string {
  const token = encodeChoiceValue(codec.value, value)
  if (token === null) throw new Error('choice option is outside the current codec')
  return token
}

function updateOpen(value: boolean) {
  open.value = value
  if (!value) {
    query.value = ''
    return
  }
  if (props.searchable) void nextTick(() => searchInput.value?.focus())
}
</script>

<template>
  <div
    class="choice-select"
    :class="`size-${size}`"
  >
    <SelectRoot
      :model-value="internalValue"
      :open="open"
      :disabled="disabled"
      @update:model-value="updateValue"
      @update:open="updateOpen"
    >
      <SelectTrigger
        class="choice-trigger"
        :class="{ 'has-icon': selected?.icon }"
        :aria-label="label"
        :aria-invalid="invalidMark"
        :aria-describedby="describedby"
      >
        <ControlIcon
          v-if="selected?.icon"
          class="choice-icon"
          :name="selected.icon"
          :size="24"
        />
        <span
          v-tooltip.clipped="$slots.value && selected?.label"
          class="choice-value"
        >
          <SelectValue
            class="choice-value-content"
            :placeholder="placeholder"
          >
            <slot
              name="value"
              :selected="selected"
            >
              <strong
                v-tooltip.detail="{ text: selected?.title, words: selected?.label }"
                class="choice-title one-line"
                :class="{ placeholder: !selected }"
                >{{ selected?.label || placeholder }}</strong
              >
              <small
                v-if="selected?.description"
                v-tooltip.clipped="selected.description"
                class="choice-note one-line"
                >{{ selected.description }}</small
              >
            </slot>
          </SelectValue>
        </span>
        <ControlIcon
          class="choice-chevron"
          name="chevron"
          :size="chevronSize"
        />
      </SelectTrigger>

      <SelectPortal>
        <SelectContent
          class="choice-popup"
          position="popper"
          sticky="always"
          :side-offset="5"
          :collision-padding="12"
          :avoid-collisions="true"
          :hide-when-detached="true"
          :body-lock="false"
        >
          <label
            v-if="searchable"
            class="choice-search"
            @keydown.stop
          >
            <ControlIcon
              name="search"
              class="choice-search-icon"
            />
            <span class="visually-hidden">{{ searchLabel }}</span>
            <input
              ref="searchInput"
              v-model="query"
              class="choice-search-field"
              type="search"
              :placeholder="searchLabel"
              :aria-label="searchLabel"
              @keydown.esc.prevent.stop="open = false"
            />
          </label>
          <SelectViewport class="choice-viewport">
            <SelectItem
              v-for="option in filtered"
              :key="option.value"
              v-tooltip.detail="{ text: option.title, words: option.label }"
              class="choice-option"
              :class="{ 'has-icon': option.icon }"
              :value="optionToken(option.value)"
              :disabled="option.disabled"
              :text-value="`${option.label} ${option.description ?? ''}`"
            >
              <ControlIcon
                v-if="option.icon"
                class="choice-icon"
                :name="option.icon"
                :size="24"
              />
              <SelectItemText as-child>
                <span class="choice-value">
                  <slot
                    name="option"
                    :option="option"
                    ><strong class="choice-title one-line">{{ option.label }}</strong></slot
                  >
                  <small
                    v-if="option.description"
                    v-tooltip.clipped="option.description"
                    class="choice-note one-line"
                    >{{ option.description }}</small
                  >
                </span>
              </SelectItemText>
              <SelectItemIndicator
                ><ControlIcon
                  class="choice-check"
                  name="check"
              /></SelectItemIndicator>
            </SelectItem>
            <p
              v-if="!filtered.length"
              class="choice-empty"
            >
              {{ emptyLabel }}
            </p>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </div>
</template>

<style>
.choice-select {
  min-width: 0;
}

.choice-trigger {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  min-height: var(--size-control-height);
  padding: var(--space-2) var(--space-3);
  border: 0;
  color: var(--color-text);
  text-align: left;
  background: var(--color-choice-trigger-fill, var(--color-control-surface));
  border-radius: var(--radius-control);
  cursor: pointer;

  /* A forced palette clears the fill that made this a control; see `VButton`. */
  @media (forced-colors: active) {
    outline: 1px solid ButtonText;
    outline-offset: -1px;
  }
}

/* The icon is the option's identity, so it carries more of the trigger than the caption does:
   the control reads as one object. The trigger and the list item are the same control and take
   the same size; two numbers here would be the same drift the ramp exists to end. */
.choice-trigger.has-icon {
  grid-template-columns: 24px minmax(0, 1fr) 18px;
}

/* The compact trigger stands as tall as a compact segmented track beside it,
   and is no wider than its value needs, as a compact segment is. */
.choice-select.size-compact .choice-trigger {
  gap: var(--space-2);
  min-height: var(--size-control-height-compact);
  padding: 0 var(--space-2) 0 var(--space-3);
}

/* In a table's heading the trigger says what its neighbours say, in their font and with the
   least around it: at a phone's width a compact trigger's 46px left «Обновлено» 56 of its 77. */
.choice-select.size-heading .choice-trigger {
  grid-template-columns: minmax(0, 1fr) 14px;
  gap: var(--space-1);
  min-height: var(--size-control-height-compact);
  padding: 0 var(--space-1) 0 var(--space-2);

  .choice-title {
    font: var(--font-column-head);
  }
}

/* A host on another ramp, the chrome, names its two fills through `--color-choice-trigger-fill`
   and `--color-choice-trigger-fill-hover` rather than restyling these states from outside, which
   lit up a disabled trigger on hover: the host's rule had no `:not(:disabled)` in it. */
.choice-trigger:hover:not(:disabled),
.choice-trigger[data-state='open'] {
  background: var(--color-choice-trigger-fill-hover, var(--color-surface-active));
}

.choice-trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Each glyph's size is the one it is drawn at (`size` on the icon): 24 for an option's
   identity, 18 for the chevron, 14 in a heading's, 20 for the check and the search. */
.choice-chevron {
  color: var(--color-text-muted);
  transition: transform var(--duration-quick) var(--ease-out);

  .choice-trigger[data-state='open'] & {
    transform: rotate(180deg);
  }
}

.choice-value {
  min-width: 0;
  overflow: hidden;
}

/* What the host draws stands in a box and not on a line of text, where an inline box hangs from
   the line's baseline: a state's word stood 0.75px under the facts beside the trigger. The track
   is told its width, or a long label holds the trigger open and no ellipsis ever appears. */
.choice-value-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.choice-title {
  display: block;
  font: var(--font-row-title);

  &.placeholder {
    color: var(--color-text-muted);
  }
}

.choice-note {
  display: block;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.choice-popup {
  z-index: 120;
  min-width: var(--reka-select-trigger-width);
  max-width: min(440px, calc(100vw - 24px));
  max-height: var(--reka-select-content-available-height);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  background: var(--color-surface);
  overflow: hidden;
  border-radius: var(--radius-control);
  box-shadow: 0 14px 34px var(--color-shadow);
}

.choice-search {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: var(--space-2);
  align-items: center;
  padding: 0 var(--space-2);
  margin: var(--space-2);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text-muted);
  background: var(--color-control-surface);
  border-radius: var(--radius-control);
}

.choice-search-field {
  width: 100%;
  min-height: var(--size-control-height-compact);
  padding: 0;
  border: 0;
  color: var(--color-text);
  background: transparent;
  outline: 0;
}

.choice-viewport {
  max-height: min(320px, var(--reka-select-content-available-height));
  padding: var(--space-1);
  overflow-y: auto;
}

.choice-option {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  gap: var(--space-3);
  align-items: center;
  min-height: var(--size-control-height);
  padding: var(--space-2);
  border-radius: var(--radius-status);
  cursor: pointer;

  &.has-icon {
    grid-template-columns: 24px minmax(0, 1fr) 18px;
  }

  &[data-highlighted] {
    background: var(--color-surface-active);
  }

  &[data-disabled] {
    color: var(--color-text-muted);
    opacity: 0.58;
    cursor: not-allowed;
  }

  &[data-state='checked'] {
    font-weight: 600;
  }
}

.choice-check {
  width: 18px;
  height: 18px;
  color: var(--color-text);
}

.choice-empty {
  padding: var(--space-4);
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-interface);
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .choice-chevron {
    transition: none;
  }
}
</style>

<style scoped>
/* What a host draws in an option's place — a state with its dot, a priority with its glyph — is
   held to the row's width, so its word gives way and ends in its own ellipsis, as the default
   title does, and the row's hint says the option's words whole. Unheld, an inline box as wide
   as its word ran past the row and was cut with no ellipsis and nothing to read it by. */
.choice-value > :slotted(*) {
  max-width: 100%;
}
</style>
