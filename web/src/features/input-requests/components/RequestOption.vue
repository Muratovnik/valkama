<script setup lang="ts">
/**
 * One row of a field's options, the same in the form and in the answered question, so that
 * what was chosen from is what was on the screen when it was chosen.
 *
 * In the form the row is a `<label>` around the control its host places in the slot, and
 * all of it is one press, up to its toggle and to what the toggle opened, which stand
 * outside the label because they are pressed for themselves. Answered, there is no control
 * and no press: only the toggle is left (`pressable` false).
 *
 * One column holds the words, and what the toggle opened and what the host puts under the row
 * stand in that same column, so nothing has to work out where the words are. A control takes
 * the column before it, which has no width where there is no control. The column ends where
 * the excerpt ends, short of the toggle, so opening only adds lines to what was being read.
 * The toggle stands on the label's first line however it wraps (`LineEnd`): set by a margin,
 * it stood 1.5px above that line in a dense row.
 *
 * A dense row (`dense`) is a list's under a comment: no ground and no inset at its start, so
 * its control stands on the edge of the comment's words, and a step less between its lines.
 * The control says what is ticked, and in an answered list a mark in the control's place does,
 * so the word on a chosen row is left to a reader.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestOptionText from '@/features/input-requests/components/RequestOptionText.vue'
import type { DescriptionView } from '@/features/input-requests/utils/optionDescriptions.ts'

import type { InputRequestOption } from '@/shared/api/inputRequestModel.ts'
import LineEnd from '@/shared/ui/LineEnd.vue'
import RichText from '@/shared/ui/RichText.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    chosen: boolean
    option: InputRequestOption
    view: DescriptionView
    /** A list's row under a comment: no ground, no inset at its start, a step less tall. */
    dense?: boolean
    /** The whole group is out of use, so a press on the row does nothing. */
    disabled?: boolean
    /** The row takes a press. A form's row; an answered question's rows do not. */
    pressable?: boolean
    /** Whether its toggle is a tab stop; a form keeps one, on the row the keyboard stands on. */
    toggleStop?: number
  }>(),
  { dense: false, disabled: false, pressable: false, toggleStop: undefined },
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
    :class="{ 'is-chosen': chosen, 'is-dense': dense, 'is-pressable': pressable && !disabled }"
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
        class="request-option-words"
        :chosen="chosen"
        :description-id="descriptionId"
        :label-id="labelId"
        :live="!pressable"
        :note-id="noteId"
        :open="open"
        :quiet-mark="dense"
        :option="option"
        :tab-stop="toggleStop"
        :view="view"
      />
    </component>
    <LineEnd
      v-if="opens"
      class="request-option-end"
    >
      <VButton
        v-tooltip.name="toggleLabel"
        class="request-option-toggle"
        variant="text"
        size="compact"
        :tabindex="toggleStop"
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
    </LineEnd>
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
  grid-template-columns: auto minmax(0, 1fr) auto;
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
    &.is-chosen:not(.is-dense) {
      outline: 1px solid CanvasText;
      outline-offset: -1px;
    }
  }

  /* No ground to set it apart: its control, or the mark in its place, says what is ticked. */
  &.is-dense,
  &.is-dense.is-pressable:hover,
  &.is-dense.is-chosen {
    background: none;
  }
}

.request-option-line {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / 3;
  align-items: start;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  font: var(--font-editor);

  .is-pressable > & {
    cursor: pointer;
  }

  .is-dense > & {
    padding: var(--space-1) 0;
  }
}

/* Sized by the type and centred on the first line by its height, however the label wraps. Its
   margin is the step to the words, which the row's column has only where a control stands. */
:slotted(.request-option-input) {
  inline-size: var(--font-size-interface);
  block-size: var(--font-size-interface);
  margin-block: 0;
  margin-inline: 0 var(--space-2);
  font: inherit;
  translate: 0 calc((1lh - var(--font-size-interface)) / 2);
}

/* The label's first line and the press that ends it meet (`LineEnd`): the row aligns the two by
   their first baselines, and the words lend the line theirs, ahead of the control beside them. */
.request-option-line,
.request-option-words,
.request-option-end {
  align-self: first baseline;
}

.request-option-words {
  grid-column: 2;
}

/* The baseline it lends is that of the label's line. */
.request-option-end {
  font: var(--font-editor);
}

.request-option-toggle {
  margin-inline: var(--space-2) var(--space-half);

  &[aria-expanded='true'] .request-option-glyph {
    rotate: 180deg;
  }

  /* A line's height, as the row's words stand: a header's control would make the row taller. */
  .is-dense > .request-option-end > & {
    --size-control-height-compact: var(--size-control-inline);

    position: relative;
    margin-inline-end: 0;
  }
}

/* A dense row stands a finger's height short of a tap. Where a finger presses, the press reaches
   over the rows beside it by as much as it lacks, as every icon button does (`VButton`, from
   `reach.css`); so it does in a sheet as narrow as a phone's. */
@container overlay (width <= 30rem) {
  .is-dense .request-option-toggle::before {
    content: '';
    position: absolute;
    inset: calc((var(--size-control-height-compact) - var(--size-control-target)) / 2);
  }
}

/* In the words' column, and over the row's lower inset up to the step between the row's own
   lines: the first line of what opened stands where the excerpt's did. The row's inset is
   under it instead, and the press on the row stays whole while the row is closed. */
:is(.request-option-detail, .request-option-below) {
  grid-column: 2;
  padding: 0 var(--space-3) var(--space-2) 0;
  margin-block-start: calc(var(--space-half) - var(--space-2));

  .is-dense > & {
    padding: 0 0 var(--space-1);
    margin-block-start: calc(var(--space-half) - var(--space-1));
  }
}

.request-option-detail {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.request-option-below {
  font: var(--font-editor);
}
</style>
