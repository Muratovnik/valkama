<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * The overview of the Analytics page, where the page opens: the period at a glance. Its chart
 * keeps a field tall enough to read (`fit`), and where the window has no room for it the panel
 * scrolls rather than the chart shrinking.
 *
 * - The period's three figures, which also choose the page's measure (`SpendingTiles`).
 * - The period's chart by day, or by hour for a single day, across the panel's whole width,
 *   stacked by task, with the period the figures are compared with outlined behind it on the
 *   same scale (`usePeriodBefore`) and the marks of where the accounts changed.
 * - Under it one row of cards: what changed most from the period before, task by task, then the
 *   first five values of each dimension a person asks about most — tasks, models and projects;
 *   no project at a project's scope, where every figure is that project's — each asked of the
 *   same read (`useTopValues`). A card's heading opens its section and a row opens its value's
 *   side panel, as a bar of that section does. The roles have no card: there are two of them, and the rail's
 *   tile says both.
 *
 * Its own answer is the read by task, beside the period before; a press that could not do what
 * it asked says why where it was pressed. Its heading names it, and the heading's «ⓘ» says which
 * projects its figures are of (`scope`) and their caveats once (`useSectionCaveats`).
 */
import { useResizeObserver } from '@vueuse/core'

import OverviewChanges from '@/pages/analytics/components/OverviewChanges.vue'
import OverviewTop from '@/pages/analytics/components/OverviewTop.vue'
import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import SectionScope from '@/pages/analytics/components/SectionScope.vue'
import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import { useNarrowCharts } from '@/pages/analytics/composables/useNarrowCharts.ts'
import { OVERVIEW_CARDS } from '@/pages/analytics/composables/useOverviewWords.ts'
import type { OverviewCard } from '@/pages/analytics/composables/useOverviewWords.ts'
import { usePeriodBefore } from '@/pages/analytics/composables/usePeriodBefore.ts'
import { useAnewDimmed, usePanelStanding } from '@/pages/analytics/composables/useReadStanding.ts'
import { useSectionCaveats } from '@/pages/analytics/composables/useSectionCaveats.ts'
import { useTopValues } from '@/pages/analytics/composables/useTopValues.ts'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import type { OwnPeriod, PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'
import { refusedIn } from '@/pages/analytics/utils/panelAnswer.ts'
import type { Refusal, ReportPart } from '@/pages/analytics/utils/panelAnswer.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import { pageDimensionOf } from '@/shared/api/analyticsApi.ts'
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
  /** Why the last press in a part of the overview did not do what it asked; null otherwise. */
  refused: Refusal | null
  /** Which projects the figures are of, as a sentence: one project's, or every project's. */
  scope: string
  usage: Usage
  /** Whether the period is live, «Now» or «Today»: its chart opens on the step running. */
  live?: boolean
}>()
/**
 * Read the answer again; open a dimension's section; open the side panel of a value of a
 * dimension; narrow the view to a period pressed or to the periods framed in the overview's chart.
 */
const emit = defineEmits<{
  frame: [span: OwnPeriod, label: string]
  inspect: [dimension: UsageDimension, value: string | null, label: string, part: ReportPart]
  open: [dimension: UsageDimension]
  retry: []
  step: [span: OwnPeriod, label: string]
}>()
const measure = defineModel<Measure>('measure', { required: true })
const { t } = useI18n()
const caveats = useSectionCaveats()
/** Which projects the figures are of, then the caveats of them, as its heading's «ⓘ» says. */
const about = computed(() => [props.scope, ...caveats.spending(props.usage)])

/** The dimension the answer was read by, which the chart stacks: the overview's tasks. */
const by = computed<UsageDimension>(() => pageDimensionOf(props.usage) ?? 'work_item')

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

/** The chart's own column decides whether it opens as its table. */
const chartColumn = ref<HTMLElement | null>(null)
const narrow = useNarrowCharts(chartColumn)

const noticeIn = (part: ReportPart) => refusedIn(props.refused, part)

/** Dimmed while a new view is read in place of this answer (`readPending.css`). */
const pending = useAnewDimmed(usePanelStanding())

/**
 * The chart's drawing field — where its columns stand, without the scale's figures and the
 * steps' names — is never lower than `FLOOR`, whatever else the overview holds: the figures,
 * the marks and notes of where the accounts changed, the cards. Over the floor it takes the room
 * the panel's box leaves under the cards, so a tall window gives that room to the chart; a box
 * that lacks the room for the floor scrolls, and the chart keeps it. `grow` is what the field
 * adds to the floor, worked out from the room the content leaves with that addition in place,
 * so a second look at the same box finds the same answer and changes nothing.
 *
 * A box short of the floor by no more than the air the panel keeps under its content gives up
 * that much of the air instead (`air`): the content stands whole inside the box, and a scroll
 * would have moved nothing but a few pixels of air. Shorter still, the panel keeps all its air
 * and scrolls, and what it scrolls to is content.
 */
const FLOOR = 200
const panel = ref<HTMLElement | null>(null)
const grow = ref(0)
const air = ref(0)

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
    air.value = 0
    return
  }
  // Where the content's end would stand unscrolled: a scrolled box has moved it up by its scroll.
  const end = own.getBoundingClientRect().bottom + frame.scrollTop
  const padding = Number.parseFloat(getComputedStyle(frame).paddingBlockEnd) || 0
  const room = frame.getBoundingClientRect().bottom - padding - end
  const next = Math.max(0, Math.floor(grow.value + room))
  // How far the content still reaches into the air with the field at `next`: only at the floor.
  const short = next - grow.value - room
  air.value = short > 0 && short <= padding ? Math.ceil(short) : 0
  grow.value = next
}

useResizeObserver(panel, fit)
useResizeObserver(() => (panel.value ? scroller(panel.value) : null), fit)
</script>

<template>
  <div
    ref="panel"
    class="overview-panel"
    :class="{ 'read-pending': pending }"
    :style="{ '--overview-field-height': `${FLOOR + grow}px`, '--overview-air': `${air}px` }"
  >
    <PanelLevel
      level="section"
      as="div"
      :title="t('analytics.frame.overview')"
      :about="about"
    >
      <template #beside>
        <SectionScope />
      </template>
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
          :live="live"
          :notice="noticeIn('days')"
          :read-at="readAt"
          :usage="usage"
          brief
          @frame="(span, label) => emit('frame', span, label)"
          @step="(span, label) => emit('step', span, label)"
          @inspect="(value, label) => emit('inspect', by, value, label, 'days')"
        />
      </div>
      <FieldError
        v-if="noticeIn('bars')"
        role="alert"
      >
        {{ noticeIn('bars') }}
      </FieldError>
      <PanelLevel
        class="overview-cards"
        level="group"
        as="div"
        columns="fit"
        column-min="10rem"
      >
        <OverviewChanges
          :measure="measure"
          :usage="usage"
          @inspect="(value, label) => emit('inspect', 'work_item', value, label, 'bars')"
          @retry="emit('retry')"
        />
        <OverviewTop
          v-for="card in cards"
          :key="card"
          :dimension="card"
          :measure="measure"
          :read="top.reads.value[card] ?? 'loading'"
          @open="emit('open', card)"
          @inspect="(value, label) => emit('inspect', card, value, label, 'bars')"
        />
      </PanelLevel>
    </PanelLevel>
  </div>
</template>

<style scoped>
/* A section of the panel (`PanelLevel`): the figures across it, the chart across it under them,
   and the cards — what changed first — in one row under the chart while they fit, as many to a
   line as fit otherwise, and one to a line on a phone, a block's air apart. */
.overview-panel {
  /* The chart's drawing field: its floor, and what it adds to fill the panel's box (`fit`). */
  --overview-field-height: 200px;

  /* The air under the content the panel gives up rather than scroll by it alone (`fit`). */
  --overview-air: 0px;

  min-width: 0;
  margin-block-end: calc(-1 * var(--overview-air));
  container-type: inline-size;
}

.overview-chart {
  min-width: 0;

  /* The field's floor, and the room the panel's box leaves over it (`fit`). */
  & :deep(.period-field) {
    block-size: var(--overview-field-height, 200px);
  }
}
</style>

<style scoped src="@/pages/analytics/components/readPending.css"></style>
