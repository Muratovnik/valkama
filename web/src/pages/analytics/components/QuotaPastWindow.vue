<script setup lang="ts">
/**
 * How a quota window's previous window ended, and that window shown in the current one's place
 * (`QuotaWindow`), stepped back from there one window at a time.
 *
 * Under the window stands one quiet line: «Previous window: until Nov 19, 05:00 — 9%», the moment
 * that window reset and its last share, with «ran out» where a reading of it
 * reached the whole window; or «Previous window: no readings» where the store keeps none, which is
 * text and no control. Where the window's step line holds that window already (`held`), as it does
 * over a period longer than the window, no line stands: it would name a window drawn right above
 * it. The line with a window is a button: it opens that window in the card, read
 * when asked (`usePastWindow`). While a past window is open, the card holds it and nothing of the
 * current window — its share, its bar, its forecast and its breakdown stand hidden — and says so
 * plainly: «Past window: Nov 12, 05:00 – Nov 19, 05:00», its share at the reset, «Earlier» to step
 * to the window before it while one is kept («No readings earlier» once none is), and «Current
 * window» to return. Its readings are the step line of a window past its reset, on an axis of its
 * own from its start to its reset, and as a table its readings' table. The focus goes to «Current
 * window» on opening, stays on «Earlier» while it steps back, and returns to the line on closing.
 * Open, it lays its parts on the rows the current window's parts and the line under them take
 * (`QuotaWindow`'s rows): what it says on the first, its line's head and its plot on the next, so
 * its plot starts level with the plot of the window beside it.
 *
 * What a reader of the page selects it by: `data-past` — `line` the button, `none` the line with no
 * window, `view` the open window, `shown` its heading, `lead` its share, `earlier`, `no-earlier` and
 * `current` its controls, `status` a wait, a failure or a window no longer kept.
 */
import { computed, nextTick, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePastWindow } from '@/pages/analytics/composables/usePastWindow.ts'
import { useQuotaStepWords } from '@/pages/analytics/composables/useQuotaStepWords.ts'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import { stateAt } from '@/pages/analytics/utils/quotaFigures.ts'
import { momentAtOffset, offsetOf } from '@/pages/analytics/utils/readMoments.ts'

import type { QuotaAccount, QuotaEndedWindow, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import StepLine from '@/shared/ui/StepLine.vue'
import StepLineTable from '@/shared/ui/StepLineTable.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  account: QuotaAccount
  /** How old a reading may be and still be fresh, in seconds: the answer's `fresh_for_seconds`. */
  freshFor: number
  /** The moment the panel stands at, in ms. */
  now: number
  shown: 'chart' | 'table'
  /** The answer's moment at its offset: each time is said at it, and undated on its day. */
  today: string
  /** The current window, whose predecessor the line names. */
  window: QuotaShareWindow
  /** Whether the current window's step line holds its predecessor, so no line names it. */
  held?: boolean
}>()

/** Whether a past window stands in the current one's place. */
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const words = useQuotaWords()
const stepWordsOf = useQuotaStepWords()

const past = usePastWindow({
  account: () => props.account,
  offset: () => offsetOf(props.today),
  window: () => props.window,
})
const { shown: pastShown, status } = past
const lineButton = useTemplateRef<InstanceType<typeof VButton>>('lineButton')
const currentButton = useTemplateRef<InstanceType<typeof VButton>>('currentButton')

/** «until Nov 19, 05:00 — 9%», with that it ran out where it did, for the line and «Earlier». */
function endedWords(ended: QuotaEndedWindow) {
  const values = {
    at: words.moment(ended.resets_at, props.today),
    share: words.share(ended.latest.used_percent),
  }
  return ended.ran_out
    ? t('analytics.quota.past.lineRanOut', values)
    : t('analytics.quota.past.line', values)
}

const line = computed(() =>
  props.window.previous ? endedWords(props.window.previous) : t('analytics.quota.past.none'),
)

const span = computed(() => {
  const shown = pastShown.value
  if (!shown) return null
  return {
    from: words.moment(shown.started_at ?? shown.latest.at, props.today),
    to: words.moment(shown.resets_at ?? shown.latest.at, props.today),
  }
})
/** The open window's heading: its span, or the line's words until it is read. */
const heading = computed(() =>
  span.value ? t('analytics.quota.past.shown', span.value) : line.value,
)
const lead = computed(() => (pastShown.value ? words.endedShare(pastShown.value) : ''))
const earlier = computed(() => {
  const before = pastShown.value?.previous
  if (!before) return null
  const values = {
    at: words.moment(before.resets_at, props.today),
    share: words.share(before.latest.used_percent),
  }
  return t('analytics.quota.past.earlierName', values)
})

/** The span of the window's line: its start to its reset, the line's end where it stops. */
const plot = computed(() => {
  const shown = pastShown.value
  if (!shown) return null
  const from = Date.parse(shown.started_at ?? shown.latest.at)
  const to = Math.max(Date.parse(shown.resets_at ?? shown.latest.at), from + 1)
  return {
    from,
    to,
    // Silent by its reset, nothing was measured after its last reading.
    silent: stateAt(shown, to, props.freshFor) === 'silent',
  }
})
const points = computed(() => (pastShown.value ? words.points(pastShown.value, props.today) : []))
const restarts = computed(() =>
  pastShown.value ? words.restarts(pastShown.value, props.today) : [],
)
const stepWords = computed(() =>
  pastShown.value
    ? stepWordsOf(pastShown.value, points.value, { today: props.today, ended: true })
    : null,
)
const legend = computed(() => ({ line: t('analytics.quota.readings.line') }))
const stepMoment = (at: number) =>
  words.moment(momentAtOffset(at, offsetOf(props.today)), props.today)
const readingsLabel = computed(() =>
  pastShown.value
    ? words.readingsLabel(props.account, pastShown.value, { now: props.now, today: props.today })
    : '',
)
const caption = computed(() =>
  t('analytics.quota.readings.caption', {
    window: words.windowName(props.window),
    account: words.accountName(props.account),
  }),
)
const viewLabel = computed(() =>
  span.value
    ? t('analytics.quota.past.label', { window: words.windowName(props.window), ...span.value })
    : words.windowName(props.window),
)

const focus = (button: InstanceType<typeof VButton> | null) =>
  (button?.$el as HTMLElement | undefined)?.focus()

async function show() {
  open.value = true
  const reading = past.open()
  await nextTick()
  focus(currentButton.value)
  await reading
}

/** Step back; «Earlier» keeps the focus, or hands it to «Current window» once none is earlier. */
async function back() {
  await past.back()
  await nextTick()
  if (!earlier.value) focus(currentButton.value)
}

async function close() {
  past.close()
  open.value = false
  await nextTick()
  focus(lineButton.value)
}
</script>

<template>
  <section
    v-if="open"
    class="quota-past"
    data-past="view"
    :aria-label="viewLabel"
  >
    <div class="quota-past-says">
      <div class="quota-past-head">
        <p
          class="quota-past-heading"
          data-past="shown"
        >
          {{ heading }}
        </p>
        <div class="quota-past-controls">
          <VButton
            v-if="earlier"
            size="compact"
            data-past="earlier"
            :aria-label="earlier"
            @click="back"
          >
            {{ t('analytics.quota.past.earlier') }}
          </VButton>
          <span
            v-else-if="pastShown"
            class="quota-past-quiet"
            data-past="no-earlier"
          >
            {{ t('analytics.quota.past.noEarlier') }}
          </span>
          <VButton
            ref="currentButton"
            size="compact"
            data-past="current"
            @click="close"
          >
            {{ t('analytics.quota.past.current') }}
          </VButton>
        </div>
      </div>
      <p
        v-if="pastShown"
        class="quota-past-lead"
        data-past="lead"
      >
        {{ lead }}
      </p>
      <p
        v-if="status === 'reading'"
        class="quota-past-quiet"
        role="status"
        data-past="status"
      >
        {{ t('analytics.quota.past.reading') }}
      </p>
      <p
        v-else-if="status === 'failed'"
        class="quota-past-quiet"
        role="alert"
        data-past="status"
      >
        {{ t('analytics.quota.past.failed') }}
        <VButton
          size="inline"
          variant="text"
          @click="past.retry"
        >
          {{ t('analytics.quota.past.retry') }}
        </VButton>
      </p>
      <p
        v-else-if="status === 'gone'"
        class="quota-past-quiet"
        data-past="status"
      >
        {{ t('analytics.quota.past.gone') }}
      </p>
    </div>
    <template v-if="plot && stepWords">
      <StepLine
        v-if="shown === 'chart'"
        class="quota-past-readings quota-past-line-of"
        :label="readingsLabel"
        :from="plot.from"
        :to="plot.to"
        :end="plot.to"
        :points="points"
        :words="stepWords"
        :moment="stepMoment"
        :legend="legend"
        :restarts="restarts"
        :silent="plot.silent"
        ended
      />
      <StepLineTable
        v-else
        class="quota-past-readings"
        :label="caption"
        :points="points"
        :words="stepWords"
        :restarts="restarts"
      />
    </template>
  </section>
  <VButton
    v-else-if="window.previous && !held"
    ref="lineButton"
    class="quota-past-line"
    variant="text"
    size="inline"
    data-past="line"
    @click="show"
  >
    {{ line }}
  </VButton>
  <p
    v-else-if="!window.previous"
    class="quota-past-quiet quota-past-none"
    data-past="none"
  >
    {{ line }}
  </p>
</template>

<style scoped>
/* The open window on the rows of the current one's parts and the line under them: what it says,
   then its readings over two rows, its line's head and its plot, as far apart as the current
   window's parts, so its line's head stands level with the neighbour's too. */
.quota-past {
  display: grid;
  grid-template-rows: subgrid;
  grid-template-columns: minmax(0, 1fr);
  grid-row: span 4;
  gap: var(--space-heading-content);
  align-items: start;
  min-width: 0;
}

/* Its heading row, its share and what it waits on, a block's lines apart. */
.quota-past-says {
  display: grid;
  gap: var(--space-2);
  align-content: start;
  min-width: 0;
}

.quota-past-readings {
  grid-row: span 2;
}

.quota-past-line-of {
  grid-template-rows: subgrid;
}

/* Its heading and its controls on one row, the controls at the row's end; a narrow window puts
   them under the heading. */
.quota-past-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  min-width: 0;
}

.quota-past-heading {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
  font-weight: 600;
}

.quota-past-controls {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
  margin-inline-start: auto;
}

.quota-past-lead {
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
}

.quota-past-quiet {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* The line under the window starts where the lines above it do: the margin takes back the inset
   the button's fill keeps under the pointer. */
.quota-past-line {
  justify-self: start;
  margin-inline-start: calc(-1 * var(--space-fill-inset));
}

.quota-past-none {
  white-space: nowrap;
}
</style>
