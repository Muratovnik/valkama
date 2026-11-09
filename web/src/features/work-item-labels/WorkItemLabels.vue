<script setup lang="ts">
/**
 * An item's labels where they can be changed. Each chip filters the Work view, as a label
 * does anywhere, and is nothing more: a chip is the same at rest and under the pointer, its
 * words centred in it. The labels are changed in one place, the picker the new-task dialog
 * asks with: «+» after the last chip, or a press on the row beside the chips, opens it in the
 * row's place over the space's labels, the most used first, with a check on each the item
 * carries. Choosing one attaches it, choosing a checked one takes it off, and the typed words
 * can be added as a new one. Escape, or leaving the picker, gives the chips back.
 *
 * A × at the end of each chip was the card's second way to take a label off. Its room was
 * kept at rest so a chip would not grow when it appeared, which left every chip's words off
 * its middle; the picker is the one way now, in the card as in the dialog.
 *
 * This says what the labels should become and nothing more: the host writes it and shows a
 * write that failed. Closing the picker hands focus to the «+».
 */
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { injectSpaceLabels } from '@/features/work-item-labels/spaceLabels.ts'

import LabelChip from '@/entities/work-item/components/LabelChip.vue'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  labels: readonly string[]
  writable: boolean
}>()

const emit = defineEmits<{
  filter: [label: string]
  /** What the labels should become: one attached, or one taken off. */
  labels: [labels: string[]]
}>()

/** As many labels as the server keeps on one item. */
const MAX_LABELS = 32

const { t } = useI18n()
const plus = useTemplateRef<InstanceType<typeof VButton>>('plus')
const field = useTemplateRef<{ show: () => void }>('field')

const editing = ref(false)
const known = injectSpaceLabels()
/** The space's labels, and any the item carries that the space's read does not hold yet. */
const options = computed<ChoiceOption[]>(() =>
  [...new Set([...known.value, ...props.labels])].map((label) => ({ value: label, label })),
)
/** The picker's model is the item's labels, so each one stands checked in its list. */
const chosen = computed(() => [...props.labels])
const removeLabel = (label: string) => t('compose.removeLabel', { label })
const createLabel = (label: string) => t('compose.addLabel', { label })

async function openPicker() {
  editing.value = true
  await nextTick()
  field.value?.show()
}

async function closePicker(refocus: boolean) {
  editing.value = false
  if (!refocus) return
  await nextTick()
  ;(plus.value?.$el as HTMLElement | undefined)?.focus()
}

/** A press on the row beside the chips opens the picker; a chip keeps its own press. */
function pressRow(event: MouseEvent) {
  if (!props.writable || (event.target as Element).closest('button')) return
  void openPicker()
}

/** With the list shut, Escape is the picker's to answer: it gives the chips back. */
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault()
  event.stopPropagation()
  void closePicker(true)
}

/** Focus gone somewhere else on the page: the picker goes, and the «+» stays where focus is not. */
function focusout(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  if (next && (event.currentTarget as HTMLElement).contains(next)) return
  void closePicker(false)
}
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <div
    v-if="editing"
    class="item-labels-field"
    @keydown="keydown"
    @focusout="focusout"
  >
    <SearchCombobox
      ref="field"
      :model-value="chosen"
      :label="t('workItem.head.addLabel')"
      :options="options"
      :empty-label="t('compose.labelsEmpty')"
      :create-label="createLabel"
      :remove-label="removeLabel"
      :max="MAX_LABELS"
      :maxlength="64"
      hide-label
      @update:model-value="(next) => emit('labels', next)"
    />
  </div>
  <!-- The «+» is the way in from the keyboard; the row is a larger target for a pointer. -->
  <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
  <ul
    v-else
    class="item-labels"
    :class="{ pressable: writable }"
    @click="pressRow"
  >
    <li
      v-for="label in labels"
      :key="label"
    >
      <LabelChip
        :label="label"
        @filter="(pressed) => emit('filter', pressed)"
      />
    </li>
    <li
      v-if="writable"
      class="item-labels-add"
    >
      <VButton
        ref="plus"
        v-tooltip="t('workItem.head.addLabel')"
        variant="ghost"
        size="inline"
        :aria-label="t('workItem.head.addLabel')"
        icon
        @click="openPicker"
      >
        <VIcon
          name="plus"
          :size="14"
        />
      </VButton>
    </li>
  </ul>
</template>

<style scoped>
.item-labels {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  padding: 0;
  margin: 0;
  list-style: none;

  /* The row's room past the chips is a press that opens the picker too. */
  &.pressable {
    flex: 1 1 auto;
    cursor: pointer;
  }
}

/* The picker takes the row: it holds the item's labels as its chips. */
.item-labels-field {
  flex: 1 1 auto;
  min-width: 0;
}

.item-labels-add {
  display: inline-flex;
  max-width: 100%;
}
</style>
