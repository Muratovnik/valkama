<script setup lang="ts">
/**
 * Where a window of an account went: the work Valkama recorded on the account from the window's
 * start to the answer's moment, by its API price estimate, ranked, each item with its share of
 * that estimate — by task, the first breakdown, by project or by model (`useWindowSpend`). It is
 * the page's ranked bars (`RankedBars`), or their table, with the first five items and one line
 * for the rest, and it stands under the window's readings on an axis of its own: no dollar meets
 * the window's bar or its step line, and no share here is a share of the quota.
 *
 * Its heading names the stretch it covers. That it is an estimate at API prices, not quota points,
 * and that work in claude.ai and the desktop app, which the window's share counts, is not in it,
 * the section's «ⓘ» says once for every window (`useSectionCaveats`). No work on the account,
 * work only its organization recorded with no account known, a wait and a read that failed each
 * say so in words of their own; the organization's work with no account is never drawn as the
 * account's. A wait and a failure stay in this block, with a retry.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import { useReadWaitReport } from '@/pages/analytics/composables/useReadWaits.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { useWindowSpend } from '@/pages/analytics/composables/useWindowSpend.ts'
import { measureOf } from '@/pages/analytics/utils/usageFigures.ts'
import { shareOf, SPEND_BREAKDOWNS } from '@/pages/analytics/utils/windowSpend.ts'
import type { SpendBy } from '@/pages/analytics/utils/windowSpend.ts'

import type { QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  account: QuotaAccount
  shown: 'chart' | 'table'
  /** The quota answer's own moment, whose day a time is said on without its date. */
  today: string
  window: QuotaShareWindow
}>()

const { t } = useI18n()
const words = useSpendingWords()
const quotaWords = useQuotaWords()

const { by, read, retry } = useWindowSpend({
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

/** The heading, with the stretch the figures cover: the window's start to the moment read to. */
const heading = computed(() => {
  const period = answer.value?.period
  const from = period?.from ?? props.window.started_at ?? props.today
  const to = period?.to ?? props.today
  return t('analytics.quota.spent.title', {
    from: quotaWords.moment(from, props.today),
    to: quotaWords.moment(to, props.today),
  })
})

const cost = (spent: Parameters<typeof words.lineFigure>[1]) => words.lineFigure('cost', spent)

/** Each line its name, its estimate and its share of the account's estimate, in one value. */
const rows = computed<RankedRow[]>(() => {
  const held = answer.value
  if (!held) return []
  const { lines, total } = held.spent
  return lines.map((line) => {
    const share = shareOf(line, total)
    const figure = cost(line.spent)
    return {
      key: line.key,
      label: words.lineLabel(held.by, line),
      detail: words.valueDetail(held.by, line.value),
      kind: line.kind,
      quiet: line.kind === 'none' || line.kind === 'unknown',
      slot: line.kind === 'category' ? 1 : 'other',
      value: measureOf('cost', line.spent) ?? 0,
      valueText:
        share === null
          ? figure
          : t('analytics.quota.spent.share', { cost: figure, share: words.share(share) }),
    }
  })
})

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
      <h5
        :id="titleId"
        class="window-spend-title"
      >
        {{ heading }}
      </h5>
      <SegmentedControl
        size="compact"
        :model-value="by"
        :label="t('analytics.quota.spent.by', { window: windowName })"
        :options="options"
        @update:model-value="choose"
      />
    </div>
    <div
      class="window-spend-body"
      :class="{ 'read-pending': dimmed }"
    >
      <template v-if="answer">
        <template v-if="state === 'spent'">
          <RankedBars
            v-if="shown === 'chart'"
            :label="chartLabel"
            :rows="rows"
            :words="barWords"
            rank-all
          />
          <RankedBarsTable
            v-else
            :label="chartLabel"
            :rows="rows"
            :words="barWords"
            rank-all
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
