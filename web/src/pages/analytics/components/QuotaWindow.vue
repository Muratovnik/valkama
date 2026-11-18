<script setup lang="ts">
/**
 * One window of one account in the quota panel, in three parts 12px apart: what stands now, the
 * step line of its readings (`StepLine`) and «Where the window went», which opens what used the
 * window in the side panel over the page (`WindowDetail`).
 *
 * What stands now leads with one line, the share spent as the window's figure and its state in
 * words beside it, «75% used · silent 3 d», over the bar with its pace tick (`WindowBar`), then
 * the forecast in the text's ink and when the window resets, in absolute and relative time,
 * quieter. The bar draws the forecast as a hatched tail past the share spent, and the forecast's
 * line, right under it, leads with «Forecast ·», as the step line's legend names its corridor: the
 * hatch was once a silent window's and nothing on the page said so. The line starts where the
 * lines under it do; a swatch hung in the card's gutter before it once said the same as the tail
 * above it. Where steady use
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
 * silent window's line stops at its last reading, since nothing was measured after it, while a
 * fresh one's holds to now, a source writing a reading only when a value changes. A window past
 * its reset by the panel's moment has neither and shows its whole window alone, even
 * where its answer was read before the reset. Where the window's count restarted inside it, the
 * line marks each restart at its fall and the table lists it among the readings
 * (`restarts`): the line would otherwise fall to nothing with no word of why.
 *
 * What used the window is the work Valkama recorded on the account since the window's start, by
 * its API price estimate, on an axis of its own (`QuotaWindowSpend`). A window that names no start
 * has no span to read it over, and offers none. The button that opens it is `data-spend`.
 *
 * A window is fresh or silent by the panel's moment, as its reset is: a reading that was fresh
 * when the answer came turns silent once it is older than the answer's `fresh_for_seconds`.
 *
 * What a reader of the page selects it by: the window is `data-window`, its kind, with its state
 * at the panel's moment in `data-state`; each line of its facts is `data-fact` (`forecast`, `reset`, `even`,
 * `latest`).
 */
import { computed } from 'vue'
import { Translation, useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import { useWindowDetail } from '@/pages/analytics/composables/useDetail.ts'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import {
  accountKey,
  forecastCourses,
  forecastEnds,
  stands,
  stateAt,
  windowKey,
} from '@/pages/analytics/utils/quotaFigures.ts'
import { momentAtOffset, offsetOf } from '@/pages/analytics/utils/readMoments.ts'
import { seatOf } from '@/pages/analytics/utils/windowSpend.ts'

import type { QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import StepLine from '@/shared/ui/StepLine.vue'
import StepLineTable from '@/shared/ui/StepLineTable.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import WindowBar from '@/shared/ui/WindowBar.vue'
import { stepTop } from '@/shared/ui/windowGeometry.ts'
import type { StepAhead, StepWords } from '@/shared/ui/windowGeometry.ts'

const props = defineProps<{
  account: QuotaAccount
  /** How old a reading may be and still be fresh, in seconds: the answer's `fresh_for_seconds`. */
  freshFor: number
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
/** Whether the window has reset by the panel's moment, though its answer was read before that. */
const ended = computed(() => !stands(props.window, props.now))
/** The window's state at the panel's moment, though its answer may have called it fresh. */
const state = computed(() => stateAt(props.window, props.now, props.freshFor))
/**
 * The window's forecast as its drawings take it, from the answer's moment to the reset, while the
 * window stands at the panel's moment: a window past its reset forecasts nothing more.
 */
const courses = computed(() =>
  ended.value ? null : forecastCourses(props.window, Date.parse(props.today)),
)
/**
 * The window's lead and its bar: the share and the state the line says, the forecast's share at
 * the reset its tail draws, and what the bar's hint adds. A silent window says how long it has
 * been silent, so it never reads as fresh.
 */
const bar = computed(() => {
  const { window, now, today, freshFor } = props
  const forecast = forecastEnds(courses.value)
  const used = window.latest.used_percent
  return {
    share: words.share(used),
    state: words.stateWords(window, now, freshFor),
    label: words.barRead(window, now, today, freshFor),
    hint: words.meterHint(window, now, today, freshFor),
    forecast,
  }
})
/** Whether the window has a pace: it named its start and its reset. */
const paced = computed(() => props.window.even_percent !== null)
const points = computed(() => words.points(props.window, props.today))
const restarts = computed(() => words.restarts(props.window, props.today))
/** Whether what used the window can be read: the account has a seat and the window a start. */
const spends = computed(() => seatOf(props.account) !== null && props.window.started_at !== null)
/** What opens the side panel on what used the window; none outside the page. */
const openSpend = useWindowDetail()
function spend() {
  openSpend?.(accountKey(props.account), windowKey(props.window), name.value)
}

/**
 * The facts said in words: the forecast, in the text's ink where there is one, and the reset; past
 * the reset the reset alone, which says so. A table leaves the forecast to its account's table and
 * adds what the bar's hint holds and that table does not: the latest reading, and that there is
 * no pace, where that table has only a dash for it.
 */
const facts = computed(() => {
  const { window, now, today, shown, freshFor } = props
  const reset = { key: 'reset', text: words.reset(window, now, today), quiet: true }
  if (shown === 'chart') {
    const forecast = {
      key: 'forecast',
      text: words.forecastLine(window, today),
      quiet: window.forecast === null,
    }
    return ended.value ? [reset] : [forecast, reset]
  }
  const latest = { key: 'latest', text: words.latest(window, now, today, freshFor), quiet: true }
  return [
    reset,
    ...(paced.value ? [] : [{ key: 'even', text: words.even(window), quiet: true }]),
    latest,
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
  const { window, now, today, freshFor } = props
  if (ended.value || !window.readings.length) return null
  const found = courses.value
  const ends = forecastEnds(found)
  return {
    value: window.latest.used_percent,
    now: words.nowTarget(window, now, today, freshFor),
    silent: state.value === 'silent',
    forecast:
      found && ends ? { ...words.forecastTarget(window, ends, now, today), ...found } : null,
  }
})
const readingsLabel = computed(() =>
  words.readingsLabel(props.account, props.window, props.now, props.today),
)
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
    :data-state="state"
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
            {{ fact.text }}
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
        :ended="ended"
        :restarts="restarts"
      />
      <StepLineTable
        v-else
        class="quota-window-readings"
        :label="readingsCaption"
        :points="points"
        :words="stepWords"
        :forecast="ahead?.forecast ?? null"
        :restarts="restarts"
      />
      <VButton
        v-if="spends && openSpend"
        class="quota-window-uses"
        size="compact"
        data-spend
        @click="spend"
      >
        {{ t('analytics.detail.window.open') }}
      </VButton>
    </div>
  </PanelLevel>
</template>

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

/* «Where the window went» is a control of the window, at its start rather than across it. */
.quota-window-uses {
  justify-self: start;
}
</style>
