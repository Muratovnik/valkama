<script setup lang="ts">
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

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: string
    options: readonly ChoiceOption[]
    disabled?: boolean
    emptyLabel?: string
    placeholder?: string
    searchable?: boolean
    searchLabel?: string
  }>(),
  {
    searchable: false,
    placeholder: '',
    searchLabel: 'Search',
    emptyLabel: 'No matches',
    disabled: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const open = ref(false)
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const codec = computed(() => choiceValueCodec(props.options))
const selected = computed(() => props.options.find((option) => option.value === props.modelValue))
const internalValue = computed(() => encodeChoiceValue(codec.value, props.modelValue) ?? undefined)
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle) return [...props.options]
  return props.options.filter((option) =>
    `${option.label} ${option.description ?? ''}`.toLocaleLowerCase().includes(needle),
  )
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
  <div class="choice-select">
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
      >
        <ControlIcon
          v-if="selected?.icon"
          class="choice-icon"
          :name="selected.icon"
        />
        <span class="choice-value">
          <SelectValue :placeholder="placeholder">
            <strong
              class="choice-title"
              :class="{ placeholder: !selected }"
              >{{ selected?.label || placeholder }}</strong
            >
            <small
              v-if="selected?.description"
              class="choice-note"
              >{{ selected.description }}</small
            >
          </SelectValue>
        </span>
        <ControlIcon
          class="choice-chevron"
          name="chevron"
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
              />
              <SelectItemText as-child>
                <span class="choice-value">
                  <strong class="choice-title">{{ option.label }}</strong>
                  <small
                    v-if="option.description"
                    class="choice-note"
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
  background: var(--color-control-surface);
  border-radius: var(--radius-control);
  cursor: pointer;
}

/* The icon is the option's identity — the workspace, the board — and it carries
   more of the trigger than the caption does, so it is drawn at the size that
   makes the control read as one object rather than as a caption with a mark
   beside it. The trigger and the list item are the same control and take the
   same size; two numbers here would be the same drift the ramp exists to end. */
.choice-trigger.has-icon {
  grid-template-columns: 24px minmax(0, 1fr) 18px;
}

.choice-trigger:hover:not(:disabled),
.choice-trigger[data-state='open'] {
  background: var(--color-surface-active);
}

.choice-trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.choice-icon {
  width: 24px;
  height: 24px;
}

.choice-chevron,
.choice-check,
.choice-search-icon {
  width: 20px;
  height: 20px;
}

.choice-chevron {
  width: 18px;
  height: 18px;
  color: var(--color-text-muted);
  transition: transform var(--duration-quick) var(--ease-out);

  .choice-trigger[data-state='open'] & {
    transform: rotate(180deg);
  }
}

.choice-value {
  display: grid;

  /* A grid track is min-content wide unless told otherwise, so the label and
     its description held the trigger open past its own box and the ellipsis
     never got the chance to appear. */
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-hair);
  min-width: 0;
  overflow: hidden;
}

.choice-title {
  display: block;
  font: var(--font-row-title);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &.placeholder {
    color: var(--color-text-muted);
    font-weight: 500;
  }
}

.choice-note {
  display: block;
  color: var(--color-text-muted);
  font: var(--font-detail);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  outline: 0;
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
  color: var(--color-success);
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
