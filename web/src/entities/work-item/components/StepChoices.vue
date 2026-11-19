<script setup lang="ts">
/**
 * Conditions to tick in a window, each a box (`StepMark`) on its text's first line, as the card's
 * checklist draws them: the window that confirms a goal's close ticks what was done, and the one
 * that splits a part off a task chooses what the part takes. Each row carries `data-step` with
 * the step's id; its box is a `checkbox` named by the step's text.
 *
 * The ticked set is the host's (`v-model`), so each window decides what a tick means.
 */
import { useId } from 'vue'

import StepMark from '@/entities/work-item/components/StepMark.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import RichText from '@/shared/ui/RichText.vue'

defineProps<{
  steps: readonly WorkItem['checklist'][number][]
  disabled?: boolean
}>()
/** The ids of the steps ticked. */
const ticked = defineModel<ReadonlySet<string>>({ required: true })
const boxId = useId()

function toggle(id: string) {
  const next = new Set(ticked.value)
  if (!next.delete(id)) next.add(id)
  ticked.value = next
}
const ticks = (id: string) => ticked.value.has(id)
</script>

<template>
  <ul class="step-choices">
    <li
      v-for="step in steps"
      :key="step.id"
      class="step-choice"
      :data-step="step.id"
    >
      <button
        :id="`${boxId}-${step.id}`"
        class="step-choice-box"
        type="button"
        role="checkbox"
        :aria-checked="ticks(step.id)"
        :disabled="disabled"
        @click="toggle(step.id)"
      >
        <StepMark :done="ticks(step.id)" />
      </button>
      <label
        class="step-choice-text"
        :for="`${boxId}-${step.id}`"
        ><RichText
          :source="step.text"
          inline
      /></label>
    </li>
  </ul>
</template>

<style scoped>
.step-choices {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  list-style: none;
}

.step-choice {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: start;
  font: var(--font-line);
}

/* The press around the card's own box (`StepMark`), at the box's size. */
.step-choice-box {
  display: inline-grid;
  place-items: center;
  min-block-size: 0;
  padding: 0;
  border: 0;
  background: none;
  border-radius: var(--radius-status);
  cursor: pointer;

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}

.step-choice-text {
  min-width: 0;
  overflow-wrap: anywhere;
  cursor: pointer;
}
</style>
