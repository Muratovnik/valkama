<script setup lang="ts">
/**
 * One window of one account in the quota panel: its name and «Breakdown» on one line, a compact
 * button at the line's end that opens what used the window in the side panel over the page
 * (`WindowDetail`), the name cut short before the button wraps under it; then, 12px apart, what
 * stands now and the step line of its readings (`StepLine`). Under the line the button once
 * stood alone, far from the name of what it breaks down.
 *
 * What stands now leads with one line, the share spent as the window's figure and its state in
 * words beside it, «75% used · no data for 3 d», over the bar with its pace tick (`WindowBar`), then
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
 * old: it says «no data» and for how long, and its hint when its reading last changed; a fresh 0 %
 * is a bar with no fill that says «0% used» and «up to date». The bar and the figures over it are
 * the current window's; the step line under them is decided for the whole section (`line`,
 * `sectionLines`): where the page's period starts no further back from now than the window lasts,
 * the window alone across the plot; where it starts further back, every window of its kind and
 * account the period overlaps, each whole from its start to its reset, its count falling to
 * nothing at each reset (`lineRestarts`), the earlier ones in the neutral ink of a window past its
 * reset and the current one at the right end; on the one time scale the section's lines share, as
 * long as the longest of them, to its own reset. Its axis names the start of the first window it holds and the current window's
 * reset, each under the moment it stands at (`StepLine`'s `holds`). While the window stands, the
 * line marks now, points at where it stands now and runs its forecast's line to its end. A window past its reset by the panel's moment (`ended`) has neither, even where its
 * answer was read before the reset; it leads with that it reset with no reading since, its share
 * before the reset a quieter line under that, over its bar drawn in the neutral ink with no tick
 * (`WindowBar`'s `muted`), and its line in the same ink: led by its share in the series' hue, the
 * last window's figure read as the share spent now. Running or past its reset, a window silent by then
 * (`silent`) has its line stop at its last reading, since nothing was measured after it, while a
 * fresh one's holds to the answer's moment or the reset, a source writing a reading only when a
 * value changes. Where the window's count restarted inside it, the
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
 * Under the window stands how its previous window ended, a line that opens that window in the
 * card's place and steps back from there (`QuotaPastWindow`), where the step line does not hold
 * that window already (`holdsPrevious`); while one is open, nothing of this window stands beside
 * it — its lead, bar, facts, readings and «Breakdown» are hidden.
 *
 * What a reader of the page selects it by: the window is `data-window`, its kind, with its state
 * at the panel's moment in `data-state`; each line of its facts is `data-fact` (`forecast`, `reset`, `even`,
 * `latest`); the lines over its bar are `data-lead`, `share` for a standing window's, `ended` and
 * `before` for one past its reset.
 */
import { computed, ref } from 'vue'
import { Translation, useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import QuotaPastWindow from '@/pages/analytics/components/QuotaPastWindow.vue'
import { useWindowDetail } from '@/pages/analytics/composables/useDetail.ts'
import { useQuotaStepWords } from '@/pages/analytics/composables/useQuotaStepWords.ts'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import {
  accountKey,
  forecastCourses,
  forecastEnds,
  stands,
  stateAt,
  windowKey,
} from '@/pages/analytics/utils/quotaFigures.ts'
import { holdsPrevious, ownLine } from '@/pages/analytics/utils/quotaLine.ts'
import type { QuotaLine } from '@/pages/analytics/utils/quotaLine.ts'
import { momentAtOffset, offsetOf } from '@/pages/analytics/utils/readMoments.ts'
import { seatOf } from '@/pages/analytics/utils/windowSpend.ts'

import type { QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import StepLine from '@/shared/ui/StepLine.vue'
import StepLineTable from '@/shared/ui/StepLineTable.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import WindowBar from '@/shared/ui/WindowBar.vue'
import type { StepAhead } from '@/shared/ui/windowGeometry.ts'

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
  /**
   * What its step line draws, decided for the whole section (`sectionLines`): the windows it holds
   * and the span it runs over; unset, its own window alone.
   */
  line?: QuotaLine
}>()

const { t } = useI18n()
const words = useQuotaWords()

const name = computed(() => words.windowName(props.window))
/** Whether the window has reset by the panel's moment, though its answer was read before that. */
const ended = computed(() => !stands(props.window, props.now))
/** The window's state at the panel's moment, though its answer may have called it fresh. */
const state = computed(() => stateAt(props.window, props.now, props.freshFor))
/**
 * Whether the window was silent by the moment it stands to: the panel's, or its reset where it has
 * passed. Nothing was measured after its last reading, so its line ends there.
 */
const silent = computed(() => {
  const { window, now, freshFor } = props
  const reset = window.resets_at === null ? now : Date.parse(window.resets_at)
  return stateAt(window, Math.min(now, reset), freshFor) === 'silent'
})
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
 * been silent, so it never reads as fresh. Past its reset it leads with that (`ended`), and its
 * hint says its latest reading alone, since it draws no pace.
 */
const bar = computed(() => {
  const { window, now, today, freshFor } = props
  const forecast = forecastEnds(courses.value)
  const used = window.latest.used_percent
  return {
    share: words.share(used),
    state: words.stateWords(window, now, freshFor),
    ended: words.ended(window, now, today),
    // Past the reset no pace stands, so no tick is drawn.
    even: ended.value ? null : window.even_percent,
    label: words.barRead(window, now, today, freshFor),
    hint: ended.value
      ? words.latest(window, now, today, freshFor)
      : words.meterHint(window, now, today, freshFor),
    forecast,
  }
})
/** Whether the window has a pace: it named its start and its reset. */
const paced = computed(() => props.window.even_percent !== null)
/** What the step line draws: the section's decision, or the window alone. */
const drawn = computed(() => props.line ?? ownLine(props.window, props.today))
const points = computed(() => words.linePoints(props.window, props.today, drawn.value.earlier))
const restarts = computed(() => words.lineRestarts(props.window, props.today, drawn.value.earlier))
/** Whether what used the window can be read: the account has a seat and the window a start. */
const spends = computed(() => seatOf(props.account) !== null && props.window.started_at !== null)
/** What opens the side panel on what used the window; none outside the page. */
const openSpend = useWindowDetail()
function spend() {
  openSpend?.(accountKey(props.account), windowKey(props.window), name.value)
}

/**
 * The facts said in words: the forecast, in the text's ink where there is one, and the reset; past
 * the reset none, since the lead says when it reset. A table leaves the forecast to its account's table and
 * adds what the bar's hint holds and that table does not: the latest reading, and that there is
 * no pace, where that table has only a dash for it. Past the reset it says no reset either: the
 * account's table says it where the share stood.
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
    return ended.value ? [] : [forecast, reset]
  }
  const latest = { key: 'latest', text: words.latest(window, now, today, freshFor), quiet: true }
  return [
    ...(ended.value ? [] : [reset]),
    ...(paced.value ? [] : [{ key: 'even', text: words.even(window), quiet: true }]),
    latest,
  ]
})

/** The span the line runs over, and where its readings end: the answer's moment, or the reset. */
const span = computed(() => ({
  ...drawn.value.span,
  end: Math.min(Date.parse(props.today), drawn.value.current.to),
}))

/**
 * A moment of the line's axis, said as the answer's own times are: at the answer's offset, the
 * reader's clock when it was read, and dated against the answer's day.
 */
const stepMoment = (at: number) =>
  words.moment(momentAtOffset(at, offsetOf(props.today)), props.today)

const stepWordsOf = useQuotaStepWords()
/**
 * The rows of the account's grid a window lays itself on, so two side by side line up row by row
 * (`PanelLevel`'s `rows`): its heading; what stands now; its line's head; its plot and axis; and
 * the line of the window before it. A past window open in its place lays itself on the same.
 */
const WINDOW_ROWS = 5

/** The line's words: its axis names the start of the first window it holds and the reset. */
const stepWords = computed(() =>
  stepWordsOf(props.window, points.value, {
    today: props.today,
    ended: ended.value,
    start: drawn.value.start,
  }),
)
/** Whether a past window stands in this one's place (`QuotaPastWindow`). */
const past = ref(false)
const legend = computed(() => ({
  line: t('analytics.quota.readings.line'),
  ahead: t('analytics.quota.forecastKey'),
  earlier: t('analytics.quota.readings.earlier'),
  ...(props.window.even_percent === null ? {} : { even: t('analytics.quota.readings.even') }),
}))
/** Whether the line holds the window before this one, which then needs no line of its own. */
const held = computed(() => holdsPrevious(props.window, drawn.value))

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
    forecast:
      found && ends ? { ...words.forecastTarget(window, ends, now, today), ...found } : null,
  }
})
const readingsLabel = computed(() =>
  words.readingsLabel(props.account, props.window, {
    now: props.now,
    today: props.today,
    earlier: drawn.value.earlier,
  }),
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
    :rows="WINDOW_ROWS"
    one-line
  >
    <template
      v-if="spends && openSpend && !past"
      #actions="{ size }"
    >
      <VButton
        :size="size"
        data-spend
        @click="spend"
      >
        {{ t('analytics.detail.window.open') }}
      </VButton>
    </template>
    <div
      v-show="!past"
      class="quota-window-parts"
    >
      <div class="quota-window-summary">
        <template v-if="shown === 'chart'">
          <template v-if="bar.ended">
            <p
              class="quota-window-lead quota-window-ended"
              data-lead="ended"
            >
              {{ bar.ended.lead }}
            </p>
            <p
              class="quota-window-lead"
              data-lead="before"
            >
              {{ bar.ended.before }}
            </p>
          </template>
          <Translation
            v-else
            class="quota-window-lead"
            keypath="analytics.quota.lead"
            tag="p"
            data-lead="share"
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
            :even="bar.even"
            :forecast="bar.forecast"
            :muted="ended"
          />
        </template>
        <ul
          v-if="facts.length"
          class="quota-window-facts"
        >
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
        class="quota-window-readings quota-window-line"
        :label="readingsLabel"
        :from="span.from"
        :to="span.to"
        :end="span.end"
        :current="drawn.current"
        :holds="drawn.holds"
        :points="points"
        :words="stepWords"
        :moment="stepMoment"
        :even="paced"
        :legend="legend"
        :ahead="ahead"
        :ended="ended"
        :silent="silent"
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
    </div>
    <QuotaPastWindow
      v-model:open="past"
      :held="held"
      :account="account"
      :fresh-for="freshFor"
      :now="now"
      :shown="shown"
      :today="today"
      :window="window"
    />
  </PanelLevel>
</template>

<style scoped>
/* The window's two parts — what stands now and its readings — stand as far apart as a heading
   from what it heads, each with its own lines closer inside it, and closer than two windows stand
   (16px), so one stacked under another never reads as a part of it. At the block's 8px, the facts
   ran into the readings' head. They take the rows the window lays them on (`WINDOW_ROWS`): what
   stands now one, the readings two, the line's head and its plot each on a row of its own; each
   part at its row's top, which a neighbour's taller part may make taller than it. */
.quota-window-parts {
  display: grid;
  grid-template-rows: subgrid;
  grid-template-columns: minmax(0, 1fr);
  grid-row: span 3;
  gap: var(--space-heading-content);
  align-items: start;
  min-width: 0;
}

.quota-window-readings {
  grid-row: span 2;
}

.quota-window-line {
  grid-template-rows: subgrid;
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

/* Past its reset the window leads with that, in the text's ink, and no figure leads it. */
.quota-window-ended {
  color: var(--color-text);
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
</style>
