<script setup lang="ts">
/**
 * One row of a field's options, the same in the form and in the answered question, so that
 * what was chosen from is what was on the screen when it was chosen.
 *
 * In the form the row is a `<label>` around the control its host places in the slot, and
 * all of it is one press, up to its toggle and to what the toggle opened, which stand
 * outside the label because they are pressed for themselves. Answered, there is no control
 * and no press: only the toggle is left (`pressable` false).
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestOptionText from '@/features/input-requests/components/RequestOptionText.vue'
import type { DescriptionView } from '@/features/input-requests/utils/optionDescriptions.ts'

import type { InputRequestOption } from '@/shared/api/inputRequestModel.ts'
import RichText from '@/shared/ui/RichText.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    chosen: boolean
    option: InputRequestOption
    view: DescriptionView
    /** The whole group is out of use, so a press on the row does nothing. */
    disabled?: boolean
    /** The row takes a press. A form's row; an answered question's rows do not. */
    pressable?: boolean
    /** Whether its toggle is a tab stop; a form keeps one, on the row the keyboard stands on. */
    toggleStop?: number
  }>(),
  { disabled: false, pressable: false, toggleStop: undefined },
)
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const id = useId()
const labelId = `${id}-label`
const noteId = `${id}-note`
const descriptionId = `${id}-description`
const opens = computed(() => props.view === 'excerpt' || props.view === 'folded')
const lineTag = computed(() => (props.pressable ? 'label' : 'div'))
const toggleLabel = computed(() =>
  t(open.value ? 'platform.actions.collapse' : 'platform.actions.expand'),
)
/** What a screen reader hears after the label: the word on it, and a description of one line. */
const describedBy = computed(() => {
  const parts = [
    ...(props.option.recommended ? [noteId] : []),
    ...(props.view === 'line' && props.option.description ? [descriptionId] : []),
  ]
  return parts.length ? parts.join(' ') : undefined
})
</script>

<template>
  <div
    class="request-option"
    :class="{ 'is-chosen': chosen, 'is-pressable': pressable && !disabled }"
  >
    <component
      :is="lineTag"
      class="request-option-line"
    >
      <slot
        :label-id="labelId"
        :described-by="describedBy"
      />
      <RequestOptionText
        :chosen="chosen"
        :description-id="descriptionId"
        :label-id="labelId"
        :live="!pressable"
        :note-id="noteId"
        :open="open"
        :option="option"
        :view="view"
      />
    </component>
    <VButton
      v-if="opens"
      class="request-option-toggle"
      variant="text"
      size="compact"
      :tabindex="toggleStop"
      :title="toggleLabel"
      :aria-expanded="open"
      :aria-label="`${toggleLabel}: ${option.label}`"
      icon
      @click="open = !open"
    >
      <VIcon
        class="request-option-glyph"
        name="chevron-down"
        :size="16"
      />
    </VButton>
    <RichText
      v-if="option.description && open"
      class="request-option-detail"
      :source="option.description"
    />
    <div
      v-if="$slots.below"
      class="request-option-below"
    >
      <slot name="below" />
    </div>
  </div>
</template>

<style scoped>
/* A row is all one press, up to its toggle and to what the toggle opened. */
.request-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: var(--space-2);
  align-items: start;
  min-width: 0;
  background: var(--color-control-surface);
  border-radius: var(--radius-control);

  &.is-pressable:hover,
  &.is-chosen {
    background: var(--color-surface-active);
  }

  /* A forced palette clears the ground, which is all that sets a chosen row apart to the eye. */
  @media (forced-colors: active) {
    &.is-chosen {
      outline: 1px solid CanvasText;
      outline-offset: -1px;
    }
  }
}

.request-option-line {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  font: var(--font-editor);

  .is-pressable > & {
    cursor: pointer;
  }
}

.request-option-toggle {
  margin-block-start: var(--space-half);
  margin-inline-end: var(--space-half);

  &[aria-expanded='true'] .request-option-glyph {
    rotate: 180deg;
  }
}

/* Under the row's text, at the same inset, across the room the toggle stood in. */
:is(.request-option-detail, .request-option-below) {
  grid-column: 1 / -1;
  padding: 0 var(--space-3) var(--space-3)
    calc(var(--space-3) + var(--space-2) + var(--font-size-interface));
}

.request-option-detail {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.request-option-below {
  font: var(--font-editor);
}
</style>
