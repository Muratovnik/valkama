<script setup lang="ts">
/**
 * What a goal or a stage spent, on its card under the line of what its work took: both numbers
 * of the Volumes page's row for it, without the cancelled and with them, in that page's words
 * (`useGoalSpendWords`), so the goal reads the same on its card, in the Work list and on the
 * page. The line above is the whole tree's usage read, the cancelled work in it; this one says
 * how much of that the cancelled work took.
 *
 * It reads `goal-volumes` for the card alone, again with the card's other numbers, and only on a
 * goal or a stage of the store this service writes. A card without its row yet, or whose read
 * failed, has no line: a figure is never what a card waits on. A figure the read has no data for
 * is «—», its hint saying why. Each number carries `data-spend`: `spent` or `spent-all`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { injectInspectorUsage } from '@/widgets/work-item-inspector/utils/useInspectorRecord.ts'

import { useGoalSpendWords } from '@/entities/work-item/composables/useGoalSpendWords.ts'
import { useGoalVolumes } from '@/entities/work-item/composables/useGoalVolumes.ts'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const { t } = useI18n()
const words = useGoalSpendWords()
const usage = injectInspectorUsage()

const { rows } = useGoalVolumes({
  enabled: () => Boolean(usage?.readable() && usage.isContainer.value),
  ids: () => (usage ? [usage.reference()] : []),
  news: () => usage?.news(),
})

const figures = computed(() => {
  const row = usage ? rows.value.get(usage.reference()) : undefined
  if (!row || !usage?.isContainer.value) return []
  return [
    { key: 'spent', label: t('volumes.goals.spent'), figure: words.spent(row.spent) },
    {
      key: 'spent-all',
      label: t('volumes.goals.spentAll'),
      figure: words.spent(row.spent_with_cancelled),
    },
    // A figure with nothing to explain has no description, so nothing empty is read out.
  ].map((part) => ({ ...part, description: part.figure.hint || undefined }))
})
</script>

<template>
  <p
    v-if="figures.length"
    class="goal-spend"
    data-part="goal-spend"
  >
    <span
      v-for="part in figures"
      :key="part.key"
      v-tooltip.detail="part.figure.hint"
      class="goal-spend-figure"
      :data-spend="part.key"
      :aria-description="part.description"
    >
      <span class="goal-spend-label">{{ part.label }}</span> {{ part.figure.text }}
    </span>
  </p>
</template>

<style scoped>
/* A quiet line of two figures that wraps between them, never inside one. */
.goal-spend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-half) var(--space-3);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.goal-spend-figure {
  white-space: nowrap;
}

.goal-spend-label {
  color: var(--color-text-tertiary);
}
</style>
