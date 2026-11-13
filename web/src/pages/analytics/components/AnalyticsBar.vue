<script setup lang="ts">
/**
 * The bar over every section of the Analytics page: the period, with the ends of the reader's own
 * beside it, its two days or the name of a span between two moments (`AnalyticsOwnPeriod`); the
 * filters set, each a chip that takes it out, and the way to add one; how fresh the figures are;
 * and a read of them again. It stays where it is while the rail and the panel under it scroll,
 * since it says what everything under it is of.
 *
 * The bar is one line wherever it has room for the period, its days and the read again, so the
 * panel under it never moves with what the bar holds: the filters (`AnalyticsChips`) take the
 * room the rest leaves, counting those it has none for, and the list of filters they open lies
 * over the panel. A bar with no room for that one line is two rows of one height whatever period
 * is chosen: the periods and the filters, then the ends of the reader's own period at the start of
 * the second and the freshness with the read again at its end.
 *
 * How fresh the figures are is one element of one width: a live period's mark and the age of the
 * newest record the store holds, of any session, counted on each second (`useFreshness`), «● 15 s
 * ago». Its room is that of the widest age, in figures of one width, so the age counting up moves
 * nothing beside it, and the sentence whole — the record's moment and, for a live period, how
 * often it reads itself again — is its hint. A read again that failed says so beside it
 * (`RefreshFailed`).
 *
 * A line with no room for all of that gives up what matters least first, and never runs past its
 * end (`useBarRoom`): the words of its buttons go first, the read again then said by its icon,
 * then the room between its parts narrows, then the age is said by its span, «● 15 s», in the
 * room of the widest span, and then the failure's words go to its disc and its retry. Past all of
 * that a span's name is cut at its end, its hint saying it whole. The age's span is never given
 * up, and neither is a day of the period: its fields are as wide as a date needs.
 *
 * On a phone the bar is two rows: the periods in one row that scrolls sideways, the chosen one
 * scrolled into view, and under it the filter, the freshness and the read again, by its icon.
 */
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useElementSize } from '@vueuse/core'

import AnalyticsChips from '@/pages/analytics/components/AnalyticsChips.vue'
import AnalyticsOwnPeriod from '@/pages/analytics/components/AnalyticsOwnPeriod.vue'
import RefreshFailed from '@/pages/analytics/components/RefreshFailed.vue'
import { useBarRoom } from '@/pages/analytics/composables/useBarRoom.ts'
import { useFreshness } from '@/pages/analytics/composables/useFreshness.ts'
import { LIVE_INTERVAL } from '@/pages/analytics/composables/useLiveRefresh.ts'
import { usePageStanding } from '@/pages/analytics/composables/useReadStanding.ts'
import type { FilterValues } from '@/pages/analytics/composables/useUsageRead.ts'
import { customDays } from '@/pages/analytics/utils/analyticsPeriod.ts'

import { PERIODS } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView, PeriodPreset } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import FieldError from '@/shared/ui/FieldError.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

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
 * What the line gives up while it has no room for all it holds (`useBarRoom`): its buttons' words,
 * the room between its parts, the word around the age, the failure's words while a read again
 * failed, and a span's name.
 */
const line = useTemplateRef<HTMLElement>('line')
const refreshButton = useTemplateRef<{ $el: HTMLElement }>('refreshButton')
const { failed } = usePageStanding()
const room = useBarRoom({
  line,
  last: () => refreshButton.value?.$el,
  order: () =>
    failed.value ? ['words', 'gaps', 'ago', 'failure', 'span'] : ['words', 'gaps', 'ago', 'span'],
  observed: [line],
  holds: [
    () => props.live,
    () => [props.view.period, props.view.from, props.view.to],
    () => props.view.filters,
    locale,
  ],
})

/**
 * Whether the bar says its buttons by their icons: on a phone, or on a line that had to give their
 * words up.
 */
const bar = useTemplateRef<HTMLElement>('bar')
const { width: barWidth } = useElementSize(bar)
const short = computed(() => {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const ems = barWidth.value / rem
  return (ems > 0 && ems <= 30) || room.gave('words')
})
/**
 * Whether the room between the parts narrowed, the age said by its span alone («15 s», its hint
 * and its hidden words saying «ago»), the failure said briefly, and a span's name cut.
 */
const tight = computed(() => room.gave('gaps'))
const bare = computed(() => room.gave('ago'))
const brief = computed(() => room.gave('failure'))
const spanCut = computed(() => room.gave('span'))

/** That the period is live and how often it reads itself again, as the freshness's hint says. */
const liveWords = computed(() =>
  t('analytics.time.live', {
    interval: t('analytics.time.seconds', { count: LIVE_INTERVAL / 1000 }),
  }),
)

const { fresh, widest } = useFreshness(() => props.lastEventAt)
/** The forms of the age whose widest the freshness keeps the room of, as the line says it. */
const freshRoom = computed(() => (bare.value ? widest.value.bare : widest.value.whole))
/** The freshness's hint, a fact a line: the sentence of the newest record; the period live. */
const freshHint = computed(() =>
  [fresh.value?.at ? fresh.value.words : '', props.live ? liveWords.value : '']
    .filter(Boolean)
    .join('\n'),
)
</script>

<template>
  <div
    ref="bar"
    class="analytics-bar"
    :class="{ 'analytics-bar-short': short, 'analytics-bar-tight': tight }"
  >
    <div
      ref="line"
      class="analytics-bar-line"
    >
      <SegmentedControl
        ref="periods"
        class="analytics-period"
        size="compact"
        :label="t('analytics.period.label')"
        :model-value="view.period"
        :options="periodOptions"
        @update:model-value="choosePeriod"
      />
      <AnalyticsOwnPeriod
        v-if="view.period === 'custom'"
        class="analytics-bar-own"
        :cut="spanCut"
        :today="today"
        :view="view"
        @amend="(next) => emit('amend', next)"
      />
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
          v-tooltip.detail="freshHint"
          class="analytics-bar-fresh"
          :class="{ 'analytics-bar-fresh-live': live }"
          :data-widest="freshRoom"
        >
          <span class="analytics-bar-fresh-shown">
            <span
              v-if="live"
              class="analytics-bar-fresh-mark"
              aria-hidden="true"
            />
            <template v-if="fresh">
              <time
                v-if="fresh.at"
                :datetime="fresh.at"
                ><span class="visually-hidden">{{ fresh.lead }}</span
                ><span :class="{ 'visually-hidden': bare }">{{ fresh.before }}</span
                >{{ fresh.span
                }}<span :class="{ 'visually-hidden': bare }">{{ fresh.after }}</span></time
              >
              <template v-else>{{ fresh.words }}</template>
            </template>
          </span>
        </p>
        <RefreshFailed
          :brief="brief"
          @retry="emit('refresh')"
        />
        <VButton
          ref="refreshButton"
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
   take the room the rest leaves and give it up first, and then the line gives up its words and
   the room between its parts (`useBarRoom`). A narrow bar is two rows instead (below). */
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

.analytics-bar-read {
  display: flex;
  flex: 0 1 auto;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  min-width: 0;
  margin-inline-start: auto;
}

/* A bar too narrow for the one line is two rows from the start, whatever period is chosen: the
   periods and the filters, then the ends of the reader's own period at the second row's start
   and the freshness with the read again at its end. Otherwise a row wrapped when a part came and
   moved everything under the bar down: beside the periods, an own period's ends pushed the
   filters and then the freshness onto a third row, and the panel moved down 44px. At 1024px the
   line is about 712px, and the periods and two days alone take 693px of it. The second row never
   wraps again, a failure said on it included: it gives way as the one line does, so nothing under
   the bar moves. Pressed past its room it runs past its end, where the room it gives way by is
   measured, and not past its start. The one line needs 50rem in Russian once it has given up all
   it can beside a failure and an age of hours: at 48rem it ran 13px past its end. */
@container (width < 50rem) {
  .analytics-bar-read {
    justify-content: safe flex-end;
  }
}

/* Wider than a phone (below), the two rows are the line wrapped at a break of no height
   (`::before`) before the second row's parts, which carry the room between the rows themselves,
   so the break does not add that room twice. */
@container (30rem < width < 50rem) {
  .analytics-bar-line {
    flex-wrap: wrap;
    row-gap: 0;

    &::before {
      content: '';
      flex-basis: 100%;
      order: 1;
    }

    & > :is(.analytics-bar-own, .analytics-bar-read) {
      order: 1;
      margin-block-start: var(--space-2);
    }
  }

  .analytics-bar-read {
    flex: 1 1 0;
  }
}

/* The freshness, one element of one width: the room of the widest age (`data-widest`, one form a
   line, drawn by nobody and as high as nothing), and a live period's mark before it, a line high
   before the first answer brings its words. What it shows stands at its end, against the read
   again, in figures of one width, so the age counting up moves and resizes nothing beside it. */
.analytics-bar-fresh {
  display: grid;
  flex: none;
  justify-items: end;
  min-block-size: 1lh;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  &::before {
    content: attr(data-widest) / '';
    grid-area: 1 / 1;
    block-size: 0;
    white-space: pre;
    overflow-y: clip;
    visibility: hidden;
  }
}

/* A live period's mark takes its room in the widest's too, so the mark and the age keep one
   width whether the period reads itself again or not. */
.analytics-bar-fresh-live::before {
  padding-inline-start: calc(var(--space-2) + var(--space-1));
}

.analytics-bar-fresh-shown {
  display: flex;
  grid-area: 1 / 1;
  gap: var(--space-1);
  align-items: center;
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

  .analytics-bar-own {
    grid-column: 1 / -1;
  }

  .analytics-bar-read {
    gap: var(--space-2);
    min-width: 0;
  }
}

/* A short bar (`short`) says the read again by its icon. Its words stay in the button for
   assistive technology, hidden from sight. */
.analytics-bar-short .analytics-refresh-words {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  white-space: nowrap;
  overflow: hidden;
  clip-path: inset(50%);
}

/* A line that gave up everything else narrows the room between its parts. */
.analytics-bar-tight :is(.analytics-bar-line, .analytics-bar-read) {
  column-gap: var(--space-2);
}

/* That the period reads itself again: the sign of the hint's words, not their meaning. */
.analytics-bar-fresh-mark {
  flex: none;
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
