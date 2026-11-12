<script setup lang="ts">
import { computed, ref } from 'vue'

/**
 * The overview of the Analytics page, where the page opens: the period at a glance, laid out to be
 * taken in without scrolling on a desktop screen.
 *
 * - The period's three figures, which also choose the page's measure (`SpendingTiles`).
 * - The period's chart by day, or by hour for a single day, across the panel's whole width,
 *   stacked by task, with the period the figures are compared with outlined behind it on the
 *   same scale (`usePeriodBefore`) and the marks of where the accounts changed.
 * - Under it one row of cards: what changed most from the period before, task by task, then the
 *   first five values of each dimension a person asks about most — tasks, models and projects;
 *   no project at a project's scope, where every figure is that project's — each asked of the
 *   same read (`useTopValues`). A card's heading opens its section and a row narrows the view,
 *   as a bar of that section does. The roles have no card: there are two of them, and the rail's
 *   tile says both.
 *
 * Its own answer is the read by task, beside the period before; a press that could not narrow
 * the view says why where it was pressed.
 */
import { useResizeObserver } from '@vueuse/core'

import OverviewChanges from '@/pages/analytics/components/OverviewChanges.vue'
import OverviewTop from '@/pages/analytics/components/OverviewTop.vue'
import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import { useNarrowCharts } from '@/pages/analytics/composables/useNarrowCharts.ts'
import { OVERVIEW_CARDS } from '@/pages/analytics/composables/useOverviewWords.ts'
import type { OverviewCard } from '@/pages/analytics/composables/useOverviewWords.ts'
import { usePeriodBefore } from '@/pages/analytics/composables/usePeriodBefore.ts'
import { useAnewDimmed, usePanelStanding } from '@/pages/analytics/composables/useReadStanding.ts'
import { useTopValues } from '@/pages/analytics/composables/useTopValues.ts'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import type { PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'
import { refusedIn } from '@/pages/analytics/utils/panelAnswer.ts'
import type { Refusal, ReportPart } from '@/pages/analytics/utils/panelAnswer.ts'

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
  refused: Refusal | null
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

/** The dimension the answer was read by, which the chart stacks: the overview's tasks. */
const by = computed<UsageDimension>(() => props.usage.group_by[0] ?? 'work_item')

const cards = computed<OverviewCard[]>(() =>
  OVERVIEW_CARDS.filter((card) => card !== 'role' && !(props.projectScoped && card === 'project')),
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

/** The chart's own column decides whether it opens as its table. */
const chartColumn = ref<HTMLElement | null>(null)
const narrow = useNarrowCharts(chartColumn)

const noticeIn = (part: ReportPart) => refusedIn(props.refused, part)

/** Dimmed while a new view is read in place of this answer (`readPending.css`). */
const pending = useAnewDimmed(usePanelStanding())

/**
 * The chart's plot takes up what the panel's box leaves over or lacks: a tall window's room
 * under the cards makes it higher, and a short one takes from it, down to `FLOOR`, before the
 * panel scrolls. Where even the floor would not spare the scroll the plot keeps its own height,
 * since giving it up would buy nothing. The change is what the plot adds to its own height (or
 * takes from it), worked out from the room the content leaves with that change in place, so a
 * second look at the same box finds the same answer and changes nothing.
 */
const OWN = 160
const FLOOR = 100
const panel = ref<HTMLElement | null>(null)
const grow = ref(0)

/** The box the panel scrolls in: the nearest one around it that scrolls. */
function scroller(from: HTMLElement) {
  for (let box = from.parentElement; box; box = box.parentElement)
    if (/auto|scroll/u.test(getComputedStyle(box).overflowY)) return box
  return null
}

function fit() {
  const own = panel.value
  const frame = own && scroller(own)
  if (!own || !frame) {
    grow.value = 0
    return
  }
  const bottom = frame.getBoundingClientRect().bottom + frame.scrollTop
  const padding = Number.parseFloat(getComputedStyle(frame).paddingBlockEnd) || 0
  const room = bottom - padding - own.getBoundingClientRect().bottom
  const fits = Math.floor(grow.value + room)
  grow.value = fits < FLOOR - OWN ? 0 : fits
}

useResizeObserver(panel, fit)
useResizeObserver(() => (panel.value ? scroller(panel.value) : null), fit)
</script>

<template>
  <div
    ref="panel"
    class="overview-panel"
    :class="{ 'read-pending': pending }"
    :style="{ '--overview-plot-grow': `${grow}px` }"
  >
    <SpendingTiles
      v-model:measure="measure"
      :usage="usage"
      :read-at="readAt"
    />
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
    <FieldError
      v-if="noticeIn('bars')"
      role="alert"
    >
      {{ noticeIn('bars') }}
    </FieldError>
    <div class="overview-cards">
      <OverviewChanges
        :measure="measure"
        :usage="usage"
        @retry="emit('retry')"
      />
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
/* The figures across the panel, the chart across it under them, and the cards — what changed
   first — in one row under the chart while they fit, as many to a line as fit otherwise, and
   one to a line on a phone. */
.overview-panel {
  /* What the plot adds to its height, or takes from it, to fill the panel's box; set by `fit`. */
  --overview-plot-grow: 0px;

  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
  container-type: inline-size;
}

.overview-chart {
  min-width: 0;

  /* The plot's own height, and what the panel's box leaves over or lacks (`fit`). */
  & :deep(.period-field) {
    block-size: calc(160px + var(--overview-plot-grow, 0px));
  }
}

.overview-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
  gap: var(--space-5);
}
</style>

<style scoped src="@/pages/analytics/components/readPending.css"></style>
