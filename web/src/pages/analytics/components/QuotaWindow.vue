<script setup lang="ts">
/**
 * One window of one account in the quota panel, in three parts 12px apart: what stands now, the
 * step line of its readings (`StepLine`) and what used the window (`QuotaWindowSpend`).
 *
 * What stands now leads with one line, the share spent as the window's figure and its state in
 * words beside it, «75% used · silent 3 d», over the bar with its pace tick (`WindowBar`), then
 * the forecast in the text's ink and when the window resets, in absolute and relative time,
 * quieter. The bar draws the forecast as a hatched tail past the share spent, and the forecast's
 * line leads with the key of that hatch, a swatch and «Forecast ·», the swatch while a tail is
 * drawn: the hatch was once a silent window's and nothing on the page said so. Where steady use
 * would stand and how old the latest reading is and who read it are the bar's hint and its words
 * for a screen reader, not lines of the block: four lines of the same weight once stood over
 * every window. As a table the bar is a row of its account's table, which holds the share, the
 * pace, the state and the forecast, and the window prints its reset and its latest reading in
 * words, since a table has no hint to hold them; the pace stands there only as words that it has
 * none, which the table's dash does not say. The readings are a table of their own, closed by the
 * forecast.
 *
 * The five hours forecast a point: it lasts to the reset, runs out at a time, or is spent. A week
 * forecasts a range, said never past 100 % (`useQuotaWords`); both are drawn from one mapping
 * (`forecastCourses`). A window too new for a forecast says so in the quiet ink and draws no
 * tail. A silent window's share is as solid as a fresh one's, since a reading is final however
 * old: it says «silent» and for how long, and its hint when its reading last changed; a fresh 0 %
 * is a bar with no fill that says «0% used» and «fresh». While the window stands, its step line
 * points at where it stands now and runs its forecast's corridor to the reset (`StepLine`); a
 * window past its reset has neither.
 *
 * What used the window is the work Valkama recorded on the account since the window's start, by
 * its API price estimate, on an axis of its own. A window that names no start has no span to read
 * it over, and shows none.
 */
import { computed } from 'vue'
import { Translation, useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import QuotaWindowSpend from '@/pages/analytics/components/QuotaWindowSpend.vue'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import { forecastCourses, forecastEnds, stands } from '@/pages/analytics/utils/quotaFigures.ts'
import { momentAtOffset, offsetOf } from '@/pages/analytics/utils/readMoments.ts'
import { seatOf } from '@/pages/analytics/utils/windowSpend.ts'

import type { QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import StepLine from '@/shared/ui/StepLine.vue'
import StepLineTable from '@/shared/ui/StepLineTable.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import WindowBar from '@/shared/ui/WindowBar.vue'
import { stepTop } from '@/shared/ui/windowGeometry.ts'
import type { StepAhead, StepWords } from '@/shared/ui/windowGeometry.ts'

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
/**
 * The window's forecast as its drawings take it, from the answer's moment to the reset, while the
 * window stands at the panel's moment: a window past its reset forecasts nothing more.
 */
const courses = computed(() => {
  const { window, now, today } = props
  return stands(window, now) ? forecastCourses(window, Date.parse(today)) : null
})
/**
 * The window's lead and its bar: the share and the state the line says, the forecast's share at
 * the reset its tail draws, and what the bar's hint adds. A silent window says how long it has
 * been silent, so it never reads as fresh.
 */
const bar = computed(() => {
  const { window, now, today } = props
  const forecast = forecastEnds(courses.value)
  const used = window.latest.used_percent
  return {
    share: words.share(used),
    state: words.stateAt(window, now),
    label: words.barRead(window, now, today),
    hint: words.meterHint(window, now, today),
    forecast,
    /** Whether the bar draws a tail, whose hatch the forecast's line names. */
    hatched: forecast !== null && used < 100 && forecast.high > used,
  }
})
/** Whether the window has a pace: it named its start and its reset. */
const paced = computed(() => props.window.even_percent !== null)
const points = computed(() => words.points(props.window, props.today))
/** Whether what used the window can be read: the account has a seat and the window a start. */
const spends = computed(() => seatOf(props.account) !== null && props.window.started_at !== null)

/**
 * The facts said in words: the forecast after its key, in the text's ink where there is one, and
 * the reset. A table leaves the forecast to its account's table and adds what the bar's hint
 * holds and that table does not: the latest reading, and that there is no pace, where that table
 * has only a dash for it. `swatch` is whether the line leads with the key of the bar's hatch.
 */
const facts = computed(() => {
  const { window, now, today, shown } = props
  const reset = { key: 'reset', text: words.reset(window, now, today), quiet: true, swatch: false }
  if (shown === 'chart') {
    const forecast = {
      key: 'forecast',
      text: words.forecastLine(window, today),
      quiet: window.forecast === null,
      swatch: bar.value.hatched,
    }
    return [forecast, reset]
  }
  const latest = { key: 'latest', text: words.latest(window, now, today), quiet: true }
  return [
    reset,
    ...(paced.value ? [] : [{ key: 'even', text: words.even(window), quiet: true, swatch: false }]),
    { ...latest, swatch: false },
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
  past: t('analytics.quota.readings.past'),
}))
const legend = computed(() => ({
  line: t('analytics.quota.readings.line'),
  ahead: t('analytics.quota.forecastKey'),
  ...(props.window.even_percent === null ? {} : { even: t('analytics.quota.readings.even') }),
}))

/**
 * What the line draws past its readings while the window stands: where it stands now, and the
 * corridor of its forecast to the reset with what its end says, where the window has one to draw.
 */
const ahead = computed<StepAhead | null>(() => {
  const { window, now, today } = props
  if (!stands(window, now) || !window.readings.length) return null
  const found = courses.value
  const ends = forecastEnds(found)
  return {
    value: window.latest.used_percent,
    now: words.nowTarget(window, now, today),
    forecast:
      found && ends ? { ...words.forecastTarget(window, ends, now, today), ...found } : null,
  }
})
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
    <div class="quota-window-parts">
      <div class="quota-window-summary">
        <template v-if="shown === 'chart'">
          <Translation
            class="quota-window-lead"
            keypath="analytics.quota.lead"
            tag="p"
          >
            <template #share>
              <span class="quota-window-share">{{ bar.share }}</span>
            </template>
            <template #state>{{ bar.state }}</template>
          </Translation>
          <WindowBar
            v-tooltip.detail="bar.hint"
            class="quota-window-bar"
            :label="bar.label"
            :used="window.latest.used_percent"
            :even="window.even_percent"
            :forecast="bar.forecast"
          />
        </template>
        <ul class="quota-window-facts">
          <li
            v-for="fact in facts"
            :key="fact.key"
            :class="{ 'quota-window-quiet': fact.quiet }"
            :data-fact="fact.key"
          >
            <span
              v-if="fact.swatch"
              class="quota-window-swatch forecast-hatch"
              aria-hidden="true"
            />{{ fact.text }}
          </li>
        </ul>
      </div>
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
        :ahead="ahead"
      />
      <StepLineTable
        v-else
        class="quota-window-readings"
        :label="readingsCaption"
        :points="points"
        :words="stepWords"
        :forecast="ahead?.forecast ?? null"
      />
      <QuotaWindowSpend
        v-if="spends"
        class="quota-window-uses"
        :account="account"
        :window="window"
        :today="today"
        :shown="shown"
      />
    </div>
  </PanelLevel>
</template>

<style scoped src="@/shared/ui/forecastHatch.css"></style>

<style scoped>
/* The window's three parts — what stands now, its readings and what used it — stand as far apart
   as a heading from what it heads, each with its own lines closer inside it, and closer than two
   windows stand (16px), so one stacked under another never reads as a part of it. At the block's
   8px for all, the facts ran into the readings' switch and the axis's moments into the heading
   of what used the window. */
.quota-window-parts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-heading-content);
  min-width: 0;
}

/* The lead, the bar and the facts, a line apart each; the bar keeps its own room over and under
   its track for the tick. */
.quota-window-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-1);
  min-width: 0;
}

/* The share as the window's figure, the state after it in the quiet ink, on one baseline. */
.quota-window-lead {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.quota-window-share {
  color: var(--color-text);
  font: var(--font-drawer-title);
}

.quota-window-facts {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
  list-style: none;
}

.quota-window-quiet {
  color: var(--color-text-muted);
}

/* The key of the bar's hatch, as the step line's legend draws it: a short bar of the stripes on
   the line's baseline, before the words that name it. */
.quota-window-swatch {
  display: inline-block;
  vertical-align: baseline;
  inline-size: var(--space-3);
  block-size: var(--space-2);
  margin-inline-end: var(--space-1);
  border-radius: 999px;
}
</style>
