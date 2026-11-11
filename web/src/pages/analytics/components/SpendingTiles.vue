<script setup lang="ts">
/**
 * The period's three figures — agent time, tokens and the cost estimated at API prices — each
 * with how it moved from the period before of the same length. They are also the choice of what
 * the charts below draw: one radio group, each tile a segment, the chosen one pressed.
 *
 * The cost says it is an estimate and not a bill, and tokens with no price are said in words
 * under it, never folded into a zero: a cost of nothing and a cost nobody knows are different.
 * A change is an arrow and words, never a colour alone, and a period before with nothing in it
 * says so rather than inventing a percentage.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { changeOf, measureOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { Change, Spent } from '@/pages/analytics/utils/usageFigures.ts'

import { MEASURES } from '@/shared/api/analyticsAddress.ts'
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

const props = defineProps<{
  /** What the period before spent, and when it was; null when it was not read. */
  before: { from: string; spent: Spent; to: string } | null
  total: Spent
}>()
const measure = defineModel<Measure>('measure', { required: true })

const { t } = useI18n()
const words = useSpendingWords()

/** The period compared with by its days; a period before that was not read says that instead. */
function changeWords(moved: Change) {
  const { before } = props
  return before
    ? words.change(moved, words.days(before.from, before.to))
    : t('analytics.change.unread')
}

const tiles = computed(() =>
  MEASURES.map((value) => {
    const moved = changeOf(
      measureOf(value, props.total),
      props.before ? measureOf(value, props.before.spent) : null,
    )
    const notes =
      value === 'cost'
        ? [t('analytics.figures.costNote'), words.unpriced(props.total)].filter(Boolean)
        : []
    return {
      value,
      label: words.measure(value),
      figure: words.figure(value, props.total),
      change: changeWords(moved),
      direction: moved.direction,
      notes,
    }
  }),
)

const byValue = computed(() => new Map(tiles.value.map((tile) => [tile.value, tile])))
const tileOf = (value: Measure) => byValue.value.get(value)
</script>

<template>
  <SegmentedControl
    v-model="measure"
    class="spending-tiles"
    size="tile"
    :label="t('analytics.measures.label')"
    :options="tiles"
  >
    <template #option="{ option }">
      <span class="tile-name">{{ option.label }}</span>
      <span
        class="tile-figure"
        :data-measure="option.value"
        >{{ tileOf(option.value)?.figure }}</span
      >
      <span
        class="tile-change"
        :data-direction="tileOf(option.value)?.direction"
        >{{ tileOf(option.value)?.change }}</span
      >
      <span
        v-for="note in tileOf(option.value)?.notes"
        :key="note"
        class="tile-note"
        >{{ note }}</span
      >
    </template>
  </SegmentedControl>
</template>

<style scoped>
.spending-tiles {
  inline-size: 100%;
}

.tile-name {
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

.tile-figure {
  color: var(--color-text);
  font: var(--font-drawer-title);
  font-variant-numeric: tabular-nums;
}

.tile-change,
.tile-note {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.tile-note {
  color: var(--color-text-tertiary);
}
</style>
