<script setup lang="ts">
/**
 * The overview of the Analytics page, where the page opens: the period at a glance, laid out to be
 * taken in without scrolling on a desktop screen.
 *
 * - The period's three figures, which also choose the page's measure (`SpendingTiles`).
 * - The period's chart by day, or by hour for a single day, stacked by task, with the period the
 *   figures are compared with outlined behind it on the same scale (`usePeriodBefore`) and the
 *   marks of where the accounts changed.
 * - Beside it, what changed most from the period before, task by task.
 * - Under them, a card of the first five values of each dimension a person asks about most —
 *   tasks, models, roles and projects; no project at a project's scope, where every figure is
 *   that project's — each asked of the same read (`useTopValues`). A card's heading opens its
 *   section and a row narrows the view, as a bar of that section does.
 *
 * Its own answer is the read by task, beside the period before; a press that could not narrow
 * the view says why where it was pressed.
 */
import { computed, ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import OverviewChanges from '@/pages/analytics/components/OverviewChanges.vue'
import OverviewTop from '@/pages/analytics/components/OverviewTop.vue'
import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import { OVERVIEW_CARDS } from '@/pages/analytics/composables/useOverviewWords.ts'
import type { OverviewCard } from '@/pages/analytics/composables/useOverviewWords.ts'
import { usePeriodBefore } from '@/pages/analytics/composables/usePeriodBefore.ts'
import { useTopValues } from '@/pages/analytics/composables/useTopValues.ts'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import type { PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'
import type { ReportPart } from '@/pages/analytics/utils/panelAnswer.ts'
import { spentOf } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'
import FieldError from '@/shared/ui/FieldError.vue'

const props = defineProps<{
  /** The period by account behind the answer, for where the accounts that worked changed. */
  accounts: AccountsRead
  /** The period the figures are compared with, which the chart outlines; null when not read. */
  compared: PeriodBounds | null
  /** The filters the answer was read with, its scope's project among them. */
  filters: UsageFilters
  /** The period the answer was asked for, as it was asked, which each card reads too. */
  period: PeriodBounds | null
  /** Whether the page is scoped to one project, which leaves the projects out. */
  projectScoped: boolean
  /** When the answer was asked for, which says which step is not over yet. */
  readAt: Date
  /** Why the last press in a part of the overview did not narrow the view; null otherwise. */
  refused: { part: ReportPart; words: string } | null
  usage: Usage
}>()
/**
 * Read the answer again; open a dimension's section; narrow the view to a value of a dimension,
 * or to a day, as pressed in a part of the overview.
 */
const emit = defineEmits<{
  day: [day: string, label: string]
  narrow: [dimension: UsageDimension, value: string | null, label: string, part: ReportPart]
  open: [dimension: UsageDimension]
  retry: []
}>()
const measure = defineModel<Measure>('measure', { required: true })

const total = computed(() => spentOf(props.usage.total))
const before = computed(() => {
  const { comparison } = props.usage
  return comparison ? { ...comparison.period, spent: spentOf(comparison.total) } : null
})

/** The dimension the answer was read by, which the chart stacks: the overview's tasks. */
const by = computed<UsageDimension>(() => props.usage.group_by[0] ?? 'work_item')

const cards = computed<OverviewCard[]>(() =>
  OVERVIEW_CARDS.filter((card) => !(props.projectScoped && card === 'project')),
)

const beforeSteps = usePeriodBefore({
  usage: () => props.usage,
  filters: () => props.filters,
  compared: () => props.compared,
})
const top = useTopValues({
  usage: () => props.usage,
  filters: () => props.filters,
  period: () => props.period,
  dimensions: () => cards.value,
})

/** Under this width, in pixels, a row of columns crowds itself and the chart opens as a table. */
const NARROW = 560
const chartColumn = ref<HTMLElement | null>(null)
const width = ref<number | null>(null)
useResizeObserver(chartColumn, ([entry]) => {
  if (entry) width.value = entry.contentRect.width
})
const narrow = computed(() => width.value !== null && width.value < NARROW)

const noticeIn = (part: ReportPart) => (props.refused?.part === part ? props.refused.words : '')
</script>

<template>
  <div class="overview-panel">
    <SpendingTiles
      v-model:measure="measure"
      :split="usage.total.tokens"
      :total="total"
      :before="before"
    />
    <div class="overview-middle">
      <div
        ref="chartColumn"
        class="overview-chart"
      >
        <SpendingDays
          :accounts="accounts"
          :before="beforeSteps"
          :by="by"
          :measure="measure"
          :narrow="narrow"
          :notice="noticeIn('days')"
          :read-at="readAt"
          :usage="usage"
          brief
          @day="(day, label) => emit('day', day, label)"
        />
      </div>
      <OverviewChanges
        :measure="measure"
        :usage="usage"
        @retry="emit('retry')"
      />
    </div>
    <FieldError
      v-if="noticeIn('bars')"
      role="alert"
    >
      {{ noticeIn('bars') }}
    </FieldError>
    <div class="overview-cards">
      <OverviewTop
        v-for="card in cards"
        :key="card"
        :dimension="card"
        :measure="measure"
        :read="top.reads.value[card] ?? 'loading'"
        @open="emit('open', card)"
        @narrow="(value, label) => emit('narrow', card, value, label, 'bars')"
      />
    </div>
  </div>
</template>

<style scoped>
/* The figures across the panel; the chart and what changed side by side under them, the chart
   taking the most of the width; the cards in one row under those while they fit, as many to a
   line as fit otherwise. A narrow panel stands each part under the one before. */
.overview-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  min-width: 0;
  container-type: inline-size;
}

.overview-middle {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: var(--space-6);
  align-items: start;
}

.overview-chart {
  min-width: 0;
}

.overview-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
  gap: var(--space-5);
}

@container (width < 48rem) {
  .overview-middle {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
