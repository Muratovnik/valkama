<script setup lang="ts">
/**
 * One window of one account in the quota panel: its name, its bar with the pace tick and its
 * share in words (`WindowBar`), and its facts — when it resets, in absolute and relative time,
 * its forecast, where steady use would stand, and how old its latest reading is and who read it —
 * over the step line of its readings (`StepLine`). As a table the bar is a row of its account's
 * table, and the readings are a table of their own.
 *
 * The five hours forecast a point: it lasts to the reset, runs out at a time, or is spent. A week
 * forecasts a range, said never past 100 % (`useQuotaWords`). A silent window is hatched, says
 * «silent» and when its reading last changed; a fresh 0 % is a bar with no fill that says
 * «0% used» and «fresh».
 *
 * Under its readings stands what used the window (`QuotaWindowSpend`): the work Valkama recorded
 * on the account since the window's start, by its API price estimate, on an axis of its own. A
 * window that names no start has no span to read it over, and shows none.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import QuotaWindowSpend from '@/pages/analytics/components/QuotaWindowSpend.vue'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import { momentAtOffset, offsetOf } from '@/pages/analytics/utils/readMoments.ts'
import { seatOf } from '@/pages/analytics/utils/windowSpend.ts'

import type { QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import StepLine from '@/shared/ui/StepLine.vue'
import StepLineTable from '@/shared/ui/StepLineTable.vue'
import WindowBar from '@/shared/ui/WindowBar.vue'
import { stepTop } from '@/shared/ui/windowGeometry.ts'
import type { StepWords } from '@/shared/ui/windowGeometry.ts'

const props = defineProps<{
  account: QuotaAccount
  /** The moment the panel stands at, in ms. */
  now: number
  shown: 'chart' | 'table'
  /** The answer's moment at its offset: each time is said at it, and undated on its day. */
  today: string
  window: QuotaShareWindow
}>()

const { t } = useI18n()
const words = useQuotaWords()

const name = computed(() => words.windowName(props.window))
/** The bar in words; a window no longer fresh is hatched, so a silent one never reads as fresh. */
const bar = computed(() => ({
  label: words.barLabel(props.window),
  held: props.window.state !== 'fresh',
  value: words.used(props.window),
  note: words.state(props.window),
}))
/** Whether the window has a pace: it named its start and its reset. */
const paced = computed(() => props.window.even_percent !== null)
const points = computed(() => words.points(props.window, props.today))
/** Whether what used the window can be read: the account has a seat and the window a start. */
const spends = computed(() => seatOf(props.account) !== null && props.window.started_at !== null)

const facts = computed(() => {
  const { window, now, today } = props
  return [
    { key: 'reset', text: words.reset(window, now, today) },
    { key: 'forecast', text: words.forecast(window, today) },
    { key: 'even', text: words.even(window) },
    { key: 'latest', text: words.latest(window, now, today) },
  ]
})

/**
 * The span the line runs over: the window's start to its reset. A window that has named neither
 * runs from its first reading to the answer's moment. The line opens on the window's start to now
 * and the forecast past it, and has a switch to the whole of this span (`StepLine`).
 */
const span = computed(() => {
  const { window, today } = props
  const start = window.started_at ?? window.readings[0]?.at ?? today
  const reset = window.resets_at ?? today
  const from = Date.parse(start)
  const to = Math.max(Date.parse(reset), from + 1)
  return { from, to, end: Math.min(Date.parse(today), to) }
})

/**
 * A moment of the line's axis, said as the answer's own times are: at the answer's offset, the
 * reader's clock when it was read, and dated against the answer's day.
 */
const stepMoment = (at: number) =>
  words.moment(momentAtOffset(at, offsetOf(props.today)), props.today)

const stepWords = computed<StepWords>(() => ({
  ahead: t('analytics.quota.readings.ahead'),
  whole: t('analytics.quota.readings.whole'),
  views: t('analytics.quota.readings.views', { window: name.value }),
  top: t('analytics.quota.readings.top', { share: words.share(stepTop(points.value)) }),
  time: t('analytics.quota.readings.time'),
  value: t('analytics.quota.readings.value'),
  note: t('analytics.quota.readings.note'),
  empty: t('analytics.quota.readings.empty'),
}))
const legend = computed(() => ({
  line: t('analytics.quota.readings.line'),
  ...(props.window.even_percent === null ? {} : { even: t('analytics.quota.readings.even') }),
}))
const readingsLabel = computed(() => words.readingsLabel(props.account, props.window, props.today))
const readingsCaption = computed(() =>
  t('analytics.quota.readings.caption', {
    window: name.value,
    account: words.accountName(props.account),
  }),
)
</script>

<template>
  <PanelLevel
    class="quota-window"
    level="block"
    :title="name"
    :data-window="window.kind"
    :data-state="window.state"
  >
    <WindowBar
      v-if="shown === 'chart'"
      class="quota-window-bar"
      :label="bar.label"
      :used="window.latest.used_percent"
      :even="window.even_percent"
      :held="bar.held"
      :value="bar.value"
      :note="bar.note"
    />
    <ul class="quota-window-facts">
      <li
        v-for="fact in facts"
        :key="fact.key"
        :data-fact="fact.key"
      >
        {{ fact.text }}
      </li>
    </ul>
    <StepLine
      v-if="shown === 'chart'"
      class="quota-window-readings"
      :label="readingsLabel"
      :from="span.from"
      :to="span.to"
      :end="span.end"
      :points="points"
      :words="stepWords"
      :moment="stepMoment"
      :even="paced"
      :legend="legend"
    />
    <StepLineTable
      v-else
      class="quota-window-readings"
      :label="readingsCaption"
      :points="points"
      :words="stepWords"
    />
    <QuotaWindowSpend
      v-if="spends"
      class="quota-window-uses"
      :account="account"
      :window="window"
      :today="today"
      :shown="shown"
    />
  </PanelLevel>
</template>

<style scoped>
.quota-window-facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  padding: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  list-style: none;
}
</style>
