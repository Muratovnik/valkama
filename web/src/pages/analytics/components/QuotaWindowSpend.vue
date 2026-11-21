<script setup lang="ts">
/**
 * Where a window of an account went: the work Valkama recorded on the account from the window's
 * start to the answer's moment, by its API price estimate, ranked, each item with its share of
 * that estimate — by task, the first breakdown, by project or by model (`useWindowSpend`). Its
 * items split one whole, the account's estimate, so it is drawn as the page draws a split
 * (`splitView.ts`): by project or by model the ranked bars (`RankedBars`) with the first five items
 * and one line for the rest, or a ring (`DonutChart`) of every item that folds its own rest, each
 * item in a hue of its rank there, a switch beside the breakdowns choosing and the ring first; a
 * person's choice stands until the page is left. By task, named by free text, it is a list only,
 * with no switch: the bars of a list of free text (`RankedBars`'s `freeText`), the rest and work
 * with no task apart under a rule with their bars. Shown as its table (`shown`), it is the bars'
 * table, with no switch: the side panel's switch it stands under chose (`WindowDetail`). It stands
 * in that panel, apart from the window's readings: no dollar meets the window's bar or its step
 * line, and no share here is a share of the quota.
 *
 * Its heading names the stretch it covers and, where it has lines, their sum, said as each line's
 * estimate is: the lines add up, and a reader added them by hand. That it is an estimate at API prices, not quota points,
 * and that work in claude.ai and the desktop app, which the window's share counts, is not in it,
 * the section's «ⓘ» says once for every window (`useSectionCaveats`), and the side panel under its
 * names. No work on the account,
 * work only its organization recorded with no account known, a wait and a read that failed each
 * say so in words of their own; the organization's work with no account is never drawn as the
 * account's. A wait and a failure stay in this block, with a retry.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { useHeadingUnder } from '@/pages/analytics/composables/usePanelOutline.ts'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import { useReadWaitReport } from '@/pages/analytics/composables/useReadWaits.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { useWindowSpend } from '@/pages/analytics/composables/useWindowSpend.ts'
import { namedByText } from '@/pages/analytics/utils/splitView.ts'
import type { SplitView } from '@/pages/analytics/utils/splitView.ts'
import { addSpent, drawnLines, measureOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine } from '@/pages/analytics/utils/usageFigures.ts'
import { shareOf, SPEND_BREAKDOWNS } from '@/pages/analytics/utils/windowSpend.ts'
import type { SpendBy } from '@/pages/analytics/utils/windowSpend.ts'

import type { QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import DonutChart from '@/shared/ui/DonutChart.vue'
import type { DonutWords } from '@/shared/ui/DonutChart.vue'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  account: QuotaAccount
  shown: 'chart' | 'table'
  /** The quota answer's moment at its offset: each time is said at it, and undated on its day. */
  today: string
  window: QuotaShareWindow
}>()

const { t } = useI18n()
const words = useSpendingWords()
const quotaWords = useQuotaWords()
/** Its heading one under its window's. */
const headingAs = useHeadingUnder()

const {
  by,
  drawn: chosen,
  read,
  retry,
} = useWindowSpend({
  account: () => props.account,
  window: () => props.window,
})

const titleId = useId()
const windowName = computed(() => quotaWords.windowName(props.window))

const options = computed(() =>
  SPEND_BREAKDOWNS.map((value) => ({
    value,
    label: t(`analytics.quota.spent.breakdowns.${value}`),
  })),
)
function choose(value: SpendBy) {
  by.value = value
}

/** Whether the breakdown is named by free text, the tasks, which is a list only. */
const listOnly = computed(() => namedByText(by.value))
/** The drawing a person chose, which stands until the page is left; none before they choose. */
const view = computed<SplitView>(() => (listOnly.value ? 'bars' : (chosen.value ?? 'ring')))
const views = computed(() =>
  (['ring', 'bars'] as const).map((value) => ({ value, label: t(`analytics.shown.${value}`) })),
)
function draw(value: SplitView) {
  chosen.value = value
}

/** The first read's wait, shown once it has lasted and held for the minimum. */
const { shown: waiting } = useLoadingPresence(() => read.value.status === 'loading')
useReadWaitReport(waiting)
/** The word on screen, once the wait has lasted. */
const waitWord = computed(() => (waiting.value ? t('platform.states.loading') : ''))

/** The answer on show, while no wait holds the block. */
const answer = computed(() => (read.value.status === 'ready' && !waiting.value ? read.value : null))
/**
 * Dimmed while another breakdown is read in its place (`readPending.css`); a read again of the
 * same breakdown, a newer step of the window, dims nothing.
 */
const dimmed = computed(() => Boolean(answer.value?.refreshing && answer.value.by !== by.value))

/** What the block says: the account's work, none, only work no account is known for, or neither yet. */
const state = computed(() => {
  if (answer.value) {
    const { lines, unplaced } = answer.value.spent
    if (lines.length) return 'spent'
    return unplaced ? 'unplaced' : 'none'
  }
  return read.value.status === 'failed' && !waiting.value ? 'failed' : 'loading'
})

const cost = (spent: Parameters<typeof words.lineFigure>[1]) => words.lineFigure('cost', spent)

/** The sum of the lines the block shows, said as a line's estimate is; none with no lines. */
const total = computed(() => {
  const [first, ...rest] = (answer.value?.spent.lines ?? []).map((line) => line.spent)
  if (!first) return null
  let sum = first
  for (const spent of rest) sum = addSpent(sum, spent)
  return cost(sum)
})

/**
 * The heading, with the stretch the figures cover — the window's start to the moment read to —
 * and the sum of its lines where it has any.
 */
const heading = computed(() => {
  const period = answer.value?.period
  const from = period?.from ?? props.window.started_at ?? props.today
  const to = period?.to ?? props.today
  const stretch = {
    from: quotaWords.moment(from, props.today),
    to: quotaWords.moment(to, props.today),
  }
  return total.value === null
    ? t('analytics.quota.spent.title', stretch)
    : t('analytics.quota.spent.titleTotal', { ...stretch, total: total.value })
})

/** A line as a row of either drawing: its name, what it leaves out and its estimate. */
function rowOf(held: NonNullable<typeof answer.value>, line: SpendingLine) {
  return {
    key: line.key,
    label: words.lineLabel(held.by, line),
    labelRuns: words.lineRuns(held.by, line),
    detail: words.valueDetail(held.by, line.value),
    kind: line.kind,
    quiet: line.kind === 'none' || line.kind === 'unknown',
    value: measureOf('cost', line.spent) ?? 0,
  }
}

/**
 * Each line of the bars its name, its estimate and its share of the account's estimate, in one
 * value, every bar in the one hue: the bars compare the items, which no hue tells apart.
 */
const rows = computed<RankedRow[]>(() => {
  const held = answer.value
  if (!held) return []
  const { lines, total } = held.spent
  return drawnLines('cost', lines).map((line) => ({
    ...rowOf(held, line),
    slot: line.kind === 'category' ? 1 : 'other',
    valueText: words.withShare(cost(line.spent), shareOf(line, total)),
  }))
})
/**
 * Each item of the ring by its estimate alone, since its legend says the share: an item in the hue
 * of its place in the ring, work with no item or unknown in the neutral of work apart.
 */
const parts = computed<RankedRow[]>(() => {
  const held = answer.value
  if (!held) return []
  return drawnLines('cost', held.spent.parts).map((line) => ({
    ...rowOf(held, line),
    slot: line.kind === 'category' ? undefined : 'apart',
    valueText: cost(line.spent),
  }))
})
/** What every item of the ring adds up to, the ones it leaves out too: what its shares are of. */
const partsWhole = computed(() =>
  (answer.value?.spent.parts ?? []).reduce(
    (sum, line) => sum + (measureOf('cost', line.spent) ?? 0),
    0,
  ),
)
const ringWords = computed<DonutWords>(() => ({
  empty: t('analytics.quota.spent.none'),
  rest: (count) => t('analytics.values.other', { count }, count),
}))
const formatCost = (amount: number) => words.scale('cost', amount)

const chartLabel = computed(() =>
  t('analytics.quota.spent.label', {
    window: windowName.value,
    account: quotaWords.accountName(props.account),
    by: t(`analytics.byDimension.${answer.value?.by ?? by.value}`),
  }),
)
const barWords = computed(() => ({
  category: words.dimension(answer.value?.by ?? by.value),
  value: t('analytics.quota.spent.value'),
  empty: t('analytics.quota.spent.none'),
}))

/** Work of the organization with no account known: said apart, never one of the lines. */
const apart = computed(() => {
  const unplaced = answer.value?.spent.unplaced
  return unplaced ? cost(unplaced) : ''
})

const failedAgain = computed(() =>
  answer.value?.failedAgain
    ? t('analytics.quota.spent.failedAgain', {
        to: quotaWords.moment(answer.value.period.to, props.today),
      })
    : '',
)
</script>

<template>
  <section
    class="window-spend"
    :data-state="state"
    :aria-labelledby="titleId"
  >
    <div class="window-spend-head">
      <component
        :is="headingAs"
        :id="titleId"
        class="window-spend-title"
      >
        {{ heading }}
      </component>
      <SegmentedControl
        size="compact"
        :model-value="by"
        :label="t('analytics.quota.spent.by', { window: windowName })"
        :options="options"
        @update:model-value="choose"
      />
      <!-- Only over a drawing of two: a window with nothing to draw has no view to choose. -->
      <SegmentedControl
        v-if="shown === 'chart' && state === 'spent' && !listOnly"
        size="compact"
        :model-value="view"
        :label="t('analytics.shown.label', { chart: heading })"
        :options="views"
        @update:model-value="draw"
      />
    </div>
    <div
      class="window-spend-body"
      :class="{ 'read-pending': dimmed }"
    >
      <template v-if="answer">
        <template v-if="state === 'spent'">
          <DonutChart
            v-if="shown === 'chart' && view === 'ring'"
            :label="chartLabel"
            :rows="parts"
            :whole="partsWhole"
            :words="ringWords"
            :format-value="formatCost"
            :format-part="words.share"
            :format-share="words.markShare"
          />
          <RankedBars
            v-else-if="shown === 'chart'"
            :label="chartLabel"
            :rows="rows"
            :words="barWords"
            :rank-all="!listOnly"
            :free-text="listOnly"
          />
          <RankedBarsTable
            v-else
            :label="chartLabel"
            :rows="rows"
            :words="barWords"
            :rank-all="!listOnly"
          />
          <p
            v-if="apart"
            class="window-spend-note"
            data-note="unplaced"
          >
            {{ t('analytics.quota.spent.apart', { cost: apart }) }}
          </p>
        </template>
        <p
          v-else-if="state === 'unplaced'"
          class="window-spend-note"
        >
          {{ t('analytics.quota.spent.unplaced', { cost: apart }) }}
        </p>
        <p
          v-else
          class="window-spend-note"
        >
          {{ t('analytics.quota.spent.none') }}
        </p>
        <p
          v-if="failedAgain"
          class="window-spend-failed"
          role="status"
        >
          {{ failedAgain }}
          <VButton
            variant="text"
            size="inline"
            @click="retry"
          >
            {{ t('platform.actions.retry') }}
          </VButton>
        </p>
      </template>
      <p
        v-else-if="state === 'failed'"
        class="window-spend-failed"
        role="status"
      >
        {{ t('analytics.quota.spent.failed') }}
        <VButton
          variant="text"
          size="inline"
          @click="retry"
        >
          {{ t('platform.actions.retry') }}
        </VButton>
      </p>
      <p
        v-else
        class="window-spend-note"
      >
        {{ waitWord }}
      </p>
    </div>
  </section>
</template>

<style scoped src="@/pages/analytics/components/readPending.css"></style>

<style scoped>
/* Under the window's readings, a line of its block on an axis of its own: its title and its
   breakdowns on one line, then its bars. */
.window-spend {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
  min-width: 0;
}

.window-spend-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  justify-content: space-between;
  align-items: center;
  min-width: 0;
}

.window-spend-title {
  margin: 0;
  font: var(--font-field-label);
}

.window-spend-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
  min-width: 0;
}

/* A state in words, one quiet line in the bars' place; it keeps that place while it waits. */
.window-spend-note,
.window-spend-failed {
  min-block-size: 1lh;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
