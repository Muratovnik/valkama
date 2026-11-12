<script setup lang="ts">
/**
 * The bar over every section of the Analytics page: the period, with its two days when it is the
 * reader's own; the filters set, each a chip that takes it out, and the way to add one; how fresh
 * the figures are; and a read of them again. It stays where it is while the rail and the panel
 * under it scroll, since it says what everything under it is of.
 *
 * The bar is one line wherever it has room for the period, its days and the read again, so the
 * panel under it never moves with what the bar holds: the filters (`AnalyticsChips`) take the
 * room the rest leaves, counting those it has none for, and the list of filters they open lies
 * over the panel. The bar is short (`short`) on a phone and where a span of days leaves no room
 * for the freshness's sentence, at 1440 pixels among them.
 *
 * How fresh the figures are is the newest record the store holds, of any session: its time and
 * how old it is now, in seconds under a minute, counted on each second without a read, so a page
 * left open says its figures grow old. Its clock time is the browser's own, as the time axis
 * under it reads. The freshness keeps at least the room of a short age, with figures of one
 * width, so its count going up moves nothing beside it; a longer one takes the width of its
 * words, and only a bar with no room left cuts it, its hint saying it whole; a short bar says
 * the age alone, and the read again by its icon. A live period says beside it, by a mark and how
 * often, that it reads itself again; its hint says it in full. A read again that failed says so
 * beside it (`RefreshFailed`).
 *
 * On a phone the bar is two rows: the periods in one row that scrolls sideways, the chosen one
 * scrolled into view, and under it the filter, the freshness and the read again, by its icon.
 */
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useElementSize, useIntervalFn, useNow } from '@vueuse/core'

import AnalyticsChips from '@/pages/analytics/components/AnalyticsChips.vue'
import RefreshFailed from '@/pages/analytics/components/RefreshFailed.vue'
import { LIVE_INTERVAL } from '@/pages/analytics/composables/useLiveRefresh.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { FilterValues } from '@/pages/analytics/composables/useUsageRead.ts'
import { customDays } from '@/pages/analytics/utils/analyticsPeriod.ts'
import { momentAtOffset } from '@/pages/analytics/utils/readMoments.ts'

import { PERIODS } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView, PeriodPreset } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import { agoWords, spanWordsOf } from '@/shared/lib/timeSpan.ts'
import FieldError from '@/shared/ui/FieldError.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** The dimensions a filter may be set on. */
  dimensions: readonly UsageDimension[]
  /** Why the last filter asked for was not set; empty otherwise. */
  filtersRefused: string
  /** The newest record the store holds, as the answer on show says; undefined with no answer. */
  lastEventAt: string | null | undefined
  /** Whether the period reads itself again (`useLiveRefresh`). */
  live: boolean
  /** The day the read was asked on, the last a custom period can name. */
  today: string
  /** What each filter offers, as the read gave it. */
  values: Partial<Record<UsageDimension, FilterValues>>
  view: AnalyticsView
}>()
/** A change of the view, a filter set anew, or the figures read again. */
const emit = defineEmits<{
  amend: [next: Partial<AnalyticsView>]
  filter: [dimension: UsageDimension, values: (string | null)[]]
  refresh: []
}>()
/** Whether the list of filters is open over the panel. */
const adding = defineModel<boolean>('adding', { required: true })

const { locale, t } = useI18n()
const words = useSpendingWords()

const periodOptions = computed(() =>
  PERIODS.map((value) => ({ value, label: t(`analytics.period.${value}`) })),
)

function choosePeriod(period: PeriodPreset) {
  emit('amend', period === 'custom' ? { period, ...customDays(new Date()) } : { period })
}

/** The periods' row, which scrolls sideways on a phone, and keeps the chosen one in view. */
const periods = ref<{ $el: HTMLElement } | null>(null)
function showChosen() {
  periods.value?.$el
    .querySelector<HTMLElement>('.active')
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
onMounted(showChosen)
watch(() => props.view.period, showChosen, { flush: 'post' })

/**
 * Whether the bar is short of room for its words: a phone's, or one beside a span of days under
 * 87.5 root ems, where the period, the days and the read again leave the freshness's sentence no
 * room. A short bar says the freshness by its age and its buttons by their icons.
 */
const bar = useTemplateRef<HTMLElement>('bar')
const { width: barWidth } = useElementSize(bar)
const short = computed(() => {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const room = barWidth.value / rem
  return room > 0 && (room <= 30 || (props.view.period === 'custom' && room < 87.5))
})

const rangeError = computed(() =>
  props.view.period === 'custom' &&
  props.view.from &&
  props.view.to &&
  props.view.to < props.view.from
    ? t('analytics.period.reversed')
    : '',
)

/** That the period is live and how often it reads itself again: in full, and as the bar says it. */
const liveInterval = computed(() => t('analytics.time.seconds', { count: LIVE_INTERVAL / 1000 }))
const liveWords = computed(() => t('analytics.time.live', { interval: liveInterval.value }))
const liveShort = computed(() => t('analytics.time.liveShort', { interval: liveInterval.value }))

const now = useNow({ scheduler: (tick) => useIntervalFn(tick, 1000) })
/** How fresh the figures are, as words and, where there is one, the moment they stand for. */
const fresh = computed(() => {
  if (props.lastEventAt === undefined) return null
  if (props.lastEventAt === null) return { at: '', words: t('analytics.frame.freshNone'), full: '' }
  const at = Date.parse(props.lastEventAt)
  const shownAt = Math.max(now.value.getTime(), at)
  const seconds = (count: number) => t('analytics.time.seconds', { count })
  const ago = agoWords(at, shownAt, { ...spanWordsOf(t), seconds })
  // The clock time alone on the day it is seen, with its day before that.
  const today = new Date(at).toDateString() === new Date(shownAt).toDateString()
  const named = words.stepName(momentAtOffset(at), 'minute')
  return {
    at: props.lastEventAt,
    ago,
    words: t('analytics.frame.fresh', { at: today ? named.label : named.fullLabel, ago }),
    full: new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
      at,
    ),
  }
})
</script>

<template>
  <div
    ref="bar"
    class="analytics-bar"
    :class="{ 'analytics-bar-short': short }"
  >
    <div class="analytics-bar-line">
      <SegmentedControl
        ref="periods"
        class="analytics-period"
        size="compact"
        :label="t('analytics.period.label')"
        :model-value="view.period"
        :options="periodOptions"
        @update:model-value="choosePeriod"
      />
      <div
        v-if="view.period === 'custom'"
        class="analytics-bar-days"
      >
        <VTextInput
          class="analytics-day"
          type="date"
          size="compact"
          :label="t('analytics.period.from')"
          :model-value="view.from"
          :max="today"
          hide-label
          @update:model-value="(from) => emit('amend', { from: String(from) })"
        />
        <span
          class="analytics-bar-days-dash"
          aria-hidden="true"
          >–</span
        >
        <VTextInput
          class="analytics-day"
          type="date"
          size="compact"
          :label="t('analytics.period.to')"
          :model-value="view.to"
          :max="today"
          :error="rangeError"
          hide-label
          @update:model-value="(to) => emit('amend', { to: String(to) })"
        />
      </div>
      <AnalyticsChips
        v-model:adding="adding"
        :dimensions="dimensions"
        :filters="view.filters"
        :short="short"
        :values="values"
        @filter="(dimension, chosen) => emit('filter', dimension, chosen)"
        @clear="emit('amend', { filters: {} })"
      />
      <div class="analytics-bar-read">
        <p
          v-if="live"
          v-tooltip.detail="liveWords"
          class="analytics-bar-live"
        >
          <span
            class="analytics-bar-live-mark"
            aria-hidden="true"
          />{{ liveShort }}
        </p>
        <p class="analytics-bar-fresh">
          <template v-if="fresh">
            <time
              v-if="fresh.at"
              v-tooltip.detail="{ text: fresh.full, words: fresh.words }"
              class="analytics-bar-fresh-time one-line"
              :datetime="fresh.at"
              :data-age="fresh.ago"
              ><span class="analytics-bar-fresh-words">{{ fresh.words }}</span></time
            >
            <span
              v-else
              class="analytics-bar-fresh-none one-line"
              >{{ fresh.words }}</span
            >
          </template>
        </p>
        <RefreshFailed @retry="emit('refresh')" />
        <VButton
          class="analytics-refresh"
          size="compact"
          @click="emit('refresh')"
        >
          <VIcon
            name="refresh"
            :size="16"
          />
          <span class="analytics-refresh-words">{{ t('analytics.frame.refresh') }}</span>
        </VButton>
      </div>
    </div>
    <FieldError
      v-if="filtersRefused"
      role="alert"
    >
      {{ filtersRefused }}
    </FieldError>
  </div>
</template>

<style scoped>
/* Over the panel, so the list of filters it opens stands over the panel's charts too. */
.analytics-bar {
  position: relative;
  z-index: 1;
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  container-type: inline-size;
}

/* The period, its days, the filters, the freshness and the read again on one line: the filters
   take the room the rest leaves and give it up first, the freshness cut only once they have none.
   A narrow bar wraps the line instead (below). */
.analytics-bar-line {
  position: relative;
  display: flex;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  min-width: 0;
}

.analytics-period {
  flex: none;
  flex-wrap: wrap;
  max-width: 100%;
}

.analytics-bar-days {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

.analytics-day {
  inline-size: 9rem;
}

.analytics-bar-days-dash {
  color: var(--color-text-muted);
}

.analytics-bar-read {
  display: flex;
  flex: 0 1 auto;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  min-width: 0;
  margin-inline-start: auto;
}

/* A bar too narrow for the freshness beside the rest wraps its line, and keeps the read again on
   a line of its own from the start, and the freshness on a line over it, held a line high before
   the first answer brings its words: otherwise a line wrapped when they came, and moved
   everything under the bar down. */
@container (width < 48rem) {
  .analytics-bar-line {
    flex-wrap: wrap;
  }

  .analytics-bar-read {
    flex-basis: 100%;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .analytics-bar-fresh {
    flex-basis: 100%;
    order: -1;
    min-block-size: 1lh;
    text-align: end;
  }
}

/* The freshness keeps at least the room of a short age, «9 s» or «12 min», held by an empty
   item under its words, and its figures one width, so a tick of its count moves and resizes
   nothing beside it. A longer age takes the width of its words; a line with no room left cuts
   them at the end, and the hint says them whole. */
.analytics-bar-fresh {
  display: grid;
  flex: 0 1 auto;
  grid-template-columns: minmax(0, 1fr);
  min-inline-size: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
  text-align: end;

  &::before {
    content: '';
    grid-area: 1 / 1;
    inline-size: 21em;
    max-inline-size: 100%;
  }
}

.analytics-bar-fresh-time,
.analytics-bar-fresh-none {
  grid-area: 1 / 1;
}

/* A phone: the periods one row that scrolls sideways, and the filter, the freshness and the
   read again, by its icon alone, the row under it. */
@container (width <= 30rem) {
  .analytics-bar-line {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2);
  }

  .analytics-period {
    flex-wrap: nowrap;
    grid-column: 1 / -1;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
  }

  .analytics-bar-days {
    grid-column: 1 / -1;
  }

  .analytics-bar-read {
    flex-wrap: nowrap;
    gap: var(--space-2);
    min-width: 0;
  }

  .analytics-bar-fresh {
    flex: 1 1 auto;
    order: 0;
  }
}

/* A short bar (`short`) says only the age of the freshness, the record's clock time left to its
   hint and its name, and the read again by its icon. The whole words stay in each element for
   assistive technology, hidden from sight, and the age the bar shows is drawn and never read
   twice. */
.analytics-bar-short {
  & .analytics-bar-fresh::before {
    content: none;
  }

  & .analytics-bar-fresh-time {
    position: relative;

    &::after {
      content: attr(data-age) / '';
    }
  }

  & :is(.analytics-bar-fresh-words, .analytics-refresh-words) {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    white-space: nowrap;
    overflow: hidden;
    clip-path: inset(50%);
  }
}

/* A live period says so in words; the mark before them is their sign, not their meaning. */
.analytics-bar-live {
  display: flex;
  flex: none;
  gap: var(--space-1);
  align-items: center;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.analytics-bar-live-mark {
  inline-size: var(--space-2);
  block-size: var(--space-2);
  background: var(--color-success);
  border-radius: 50%;

  @media (forced-colors: active) {
    background: CanvasText;
    forced-color-adjust: none;
  }
}
</style>
