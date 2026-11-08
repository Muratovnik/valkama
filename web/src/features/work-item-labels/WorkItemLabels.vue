<script setup lang="ts">
/**
 * An item's labels where they can be changed. Each chip filters the Work view, as a label
 * does anywhere, and on a writable item ends in a × that takes the label off. A «+» after
 * the last one opens a field in its place that finds a label the space already has or adds
 * the words typed as a new one, as the new-task dialog does; choosing one attaches it and
 * gives the «+» back. Escape, or leaving the field, gives it back with nothing attached.
 *
 * This says what the labels should become and nothing more: the host writes it and shows a
 * write that failed. A chip taken off hands focus to the chip that takes its place, or to the
 * «+» after the last, once the written list arrives; a label attached hands it to the «+».
 */
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { injectSpaceLabels } from '@/features/work-item-labels/spaceLabels.ts'

import LabelChip from '@/entities/work-item/components/LabelChip.vue'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'
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
const list = useTemplateRef<HTMLElement>('list')
const plus = useTemplateRef<InstanceType<typeof VButton>>('plus')
const field = useTemplateRef<{ show: () => void }>('field')

const adding = ref(false)
/** The field holds no value of its own: what is chosen there is attached at once. */
const none: string[] = []
const known = injectSpaceLabels()
const options = computed<ChoiceOption[]>(() =>
  known.value
    .filter((label) => !props.labels.includes(label))
    .map((label) => ({ value: label, label })),
)
const room = computed(() => props.labels.length < MAX_LABELS)
const removeLabel = (label: string) => (props.writable ? t('compose.removeLabel', { label }) : '')
const createLabel = (label: string) => t('compose.addLabel', { label })

async function openField() {
  adding.value = true
  await nextTick()
  field.value?.show()
}

async function closeField(refocus: boolean) {
  adding.value = false
  if (!refocus) return
  await nextTick()
  ;(plus.value?.$el as HTMLElement | undefined)?.focus()
}

function attach(values: string[]) {
  const [label] = values
  void closeField(true)
  if (label && !props.labels.includes(label)) emit('labels', [...props.labels, label])
}

/** With the list shut, Escape is the field's to answer: it puts the «+» back. */
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault()
  event.stopPropagation()
  void closeField(true)
}

/** Focus gone somewhere else on the page: the field goes, and the «+» stays where focus is not. */
function focusout(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  if (next && (event.currentTarget as HTMLElement).contains(next)) return
  void closeField(false)
}

/** The place of a chip just taken off, until the list comes back without it. */
let taken: number | null = null

function detach(label: string) {
  taken = props.labels.indexOf(label)
  emit(
    'labels',
    props.labels.filter((other) => other !== label),
  )
}

watch(
  () => props.labels.length,
  async () => {
    const place = taken
    taken = null
    if (place === null) return
    await nextTick()
    const chips = list.value?.querySelectorAll<HTMLElement>('.label-chip') ?? []
    const next = chips[Math.min(place, chips.length - 1)] ?? (plus.value?.$el as HTMLElement)
    next?.focus()
  },
)
</script>

<template>
  <ul
    ref="list"
    class="item-labels"
  >
    <li
      v-for="label in labels"
      :key="label"
    >
      <LabelChip
        :label="label"
        :remove-label="removeLabel(label)"
        @filter="(chosen) => emit('filter', chosen)"
        @remove="detach"
      />
    </li>
    <li
      v-if="writable && room"
      class="item-labels-add"
    >
      <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
      <div
        v-if="adding"
        class="item-labels-field"
        @keydown="keydown"
        @focusout="focusout"
      >
        <SearchCombobox
          ref="field"
          :model-value="none"
          :label="t('workItem.head.addLabel')"
          :options="options"
          :empty-label="t('compose.labelsEmpty')"
          :create-label="createLabel"
          :maxlength="64"
          hide-label
          @update:model-value="attach"
        />
      </div>
      <VButton
        v-else
        ref="plus"
        variant="ghost"
        size="inline"
        :aria-label="t('workItem.head.addLabel')"
        :title="t('workItem.head.addLabel')"
        icon
        @click="openField"
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
}

/* Wide enough for a label of a few words; on a narrow line it takes the line. */
.item-labels-field {
  width: 16rem;
  max-width: 100%;
}

.item-labels-add {
  display: inline-flex;
  max-width: 100%;
}
</style>
