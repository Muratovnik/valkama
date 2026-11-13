<script setup lang="ts">
/**
 * The bar of the list's find (`WorkItemListFind.vue`): the term, which match is
 * current of how many, the steps between them, and the way out.
 *
 * It stands over the list's top end corner, under the head, as the browser's
 * find bar stands over a page: the rows scroll under it, the head's sorts stay
 * in reach, and opening it moves nothing. It is a search landmark with its own
 * name; the count is a polite status, so a step is heard as «3 of 12» and a term
 * that matches nothing as «No matches», and the field is described by it.
 *
 * It is a control of the screen and is not printed.
 *
 * Enter and Shift+Enter in the field step, and Escape anywhere in the bar closes
 * it. The steps stay focusable while there is nothing to step to, which is how a
 * change of the list that leaves no match keeps focus where it was. The count is
 * as wide as its widest form for the matches there are, so walking them moves
 * none of the bar's buttons.
 */
import { computed, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener } from '@vueuse/core'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** The current match's order among them, from 0; -1 with none. */
  at: number
  modelValue: string
  /** Whether a term is being looked for. */
  searching: boolean
  total: number
}>()

const emit = defineEmits<{
  'close': []
  'step': [by: 1 | -1]
  'update:modelValue': [text: string]
}>()

const { t } = useI18n()
const countId = `list-find-count-${useId()}`
const root = useTemplateRef<HTMLElement>('root')
const field = useTemplateRef<InstanceType<typeof VTextInput>>('field')

const count = computed(() => {
  if (!props.searching) return ''
  if (!props.total) return t('workItem.list.find.none')
  return t('workItem.list.find.count', { at: Math.max(props.at, 0) + 1, total: props.total })
})
const widest = computed(() =>
  props.total ? t('workItem.list.find.count', { at: props.total, total: props.total }) : '',
)
const stuck = computed(() => (props.total ? undefined : 'true'))

function stepBy(by: 1 | -1) {
  if (props.total) emit('step', by)
}

function fieldKeys(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()
  stepBy(event.shiftKey ? -1 : 1)
}

useEventListener(root, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.isComposing) return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
})

defineExpose({
  element: () => root.value,
  /** Focus in the field, its text selected, so typing replaces the last term. */
  focus() {
    const control = field.value?.control()
    control?.focus()
    if (control instanceof HTMLInputElement) control.select()
  },
})
</script>

<template>
  <div
    ref="root"
    class="list-find"
    role="search"
    :aria-label="t('workItem.list.find.region')"
  >
    <VTextInput
      ref="field"
      class="list-find-field"
      size="compact"
      autocomplete="off"
      :spellcheck="false"
      :label="t('workItem.list.find.label')"
      :placeholder="t('workItem.list.find.placeholder')"
      :describedby="countId"
      :model-value="modelValue"
      hide-label
      @update:model-value="(text) => emit('update:modelValue', text)"
      @keydown="fieldKeys"
    />
    <span
      :id="countId"
      class="list-find-count"
      role="status"
    >
      <span
        class="list-find-widest"
        aria-hidden="true"
        >{{ widest }}</span
      >
      <span class="list-find-now">{{ count }}</span>
    </span>
    <VButton
      v-tooltip.name="t('workItem.list.find.previous')"
      variant="ghost"
      size="compact"
      :aria-label="t('workItem.list.find.previous')"
      :aria-disabled="stuck"
      icon
      @click="stepBy(-1)"
    >
      <VIcon
        name="arrow-up"
        :size="16"
      />
    </VButton>
    <VButton
      v-tooltip.name="t('workItem.list.find.next')"
      variant="ghost"
      size="compact"
      :aria-label="t('workItem.list.find.next')"
      :aria-disabled="stuck"
      icon
      @click="stepBy(1)"
    >
      <VIcon
        name="arrow-down"
        :size="16"
      />
    </VButton>
    <VButton
      v-tooltip.name="t('workItem.list.find.close')"
      variant="ghost"
      size="compact"
      :aria-label="t('workItem.list.find.close')"
      icon
      @click="emit('close')"
    >
      <VIcon
        name="close"
        :size="16"
      />
    </VButton>
  </div>
</template>

<style scoped>
/* Over the list's top end corner, under its head and clear of its scroll bar, at the
   room the frame declares for both (`WorkItemListFind.vue`); as wide as a term and its
   count need, and no wider than the list leaves. A floating surface, lifted as a
   choice list is. */
.list-find {
  position: absolute;
  inset-block-start: calc(var(--list-head-size) + var(--space-2));
  inset-inline-end: calc(var(--list-gutter) + var(--space-2));
  z-index: 2;
  display: flex;
  gap: var(--space-1);
  align-items: center;
  inline-size: min(24rem, calc(100% - var(--list-gutter) - 2 * var(--space-2)));
  padding: var(--space-1);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  background: var(--color-surface);
  border-radius: var(--radius-control);
  box-shadow: 0 14px 34px var(--color-shadow);

  @media print {
    display: none;
  }
}

.list-find-field {
  flex: 1 1 0;
  min-width: 0;
}

/* The words and the room of their widest form in one cell, at the steps' side. */
.list-find-count {
  display: inline-grid;
  flex: 0 0 auto;
  justify-items: end;
  padding-inline: var(--space-1);
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.list-find-widest,
.list-find-now {
  grid-area: 1 / 1;
}

.list-find-widest {
  visibility: hidden;
}

/* A list narrower than the bar's measure gives the term a line of its own, and the count
   and the steps the line under it: on one line at 390px the field kept three letters'
   room beside «Нет совпадений». */
@container work-list (width < 25rem) {
  .list-find {
    flex-wrap: wrap;
  }

  .list-find-field {
    flex-basis: 100%;
  }

  .list-find-count {
    flex: 1 1 auto;
    justify-items: start;
  }
}
</style>
