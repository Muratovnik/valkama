<script setup lang="ts">
/**
 * The bar over every section of the Analytics page: the period, with the ends of the reader's own
 * beside it, its two days or the name of a span between two moments (`AnalyticsOwnPeriod`); the
 * filter's field, the way to add a filter, and each value set, a chip that takes it out
 * (`AnalyticsChips`); how fresh the figures are;
 * and a read of them again. It stays where it is while the rail and the panel under it scroll,
 * since it says what everything under it is of.
 *
 * The bar is one line wherever it has room for the period, its days and the read again, so the
 * panel under it never moves with what the bar holds: the filters (`AnalyticsChips`) take the
 * room the rest leaves, counting those it has none for, and the filter's menu and the list of
 * chips the count opens lie over the panel. A bar with no room for that one line is two rows of one height whatever period
 * is chosen: the periods and the filters, then the ends of the reader's own period at the start of
 * the second and the freshness with the read again at its end.
 *
 * How fresh the figures are is one element of one width: a live period's mark and the age of the
 * newest record the store holds, of any session, counted on each second (`useFreshness`), «● 15 s
 * ago». Its room is that of the widest age, in figures of one width, so the age counting up moves
 * nothing beside it, and the sentence whole — the record's moment and, for a live period, how
 * often it reads itself again — is its hint. The mark claims a live period only while its reads
 * stand: after a read that failed, with figures kept or none to show, it is not drawn, its room
 * kept. A read again that failed says so in words before the age (`RefreshFailed`).
 *
 * A line with no room for all of that gives up what matters least first, and never runs past its
 * end (`useBarRoom`): the words of its buttons go first, the read again then said by its icon,
 * then the room between its parts narrows, then the age is said by its span, «● 15 s», in the
 * room of the widest span, and then a failure's retry gives up its own word, the failure's words
 * then being the retry (`RefreshFailed`). Past all of that a span's name is cut at its end, its
 * hint saying it whole. The age's span is never given up, nor a failure's words, nor a day of the
 * period: its fields are as wide as a date needs. A line that runs past its end with all of that given up gives up the one line last,
 * and is the two rows of a narrower bar, which take their words back: the reader's own days need
 * that up to a window of about 1390px. The line is fitted as if a failure were said, so one said
 * takes only the room the chips had and moves nothing: neither the bar's height nor its controls.
 *
 * On a phone the bar is three rows of one height whatever period is chosen: the periods in one row
 * that scrolls sideways, the chosen one scrolled into view, with the freshness at its end; under
 * it the filter, a failure and the read again, by its icon; and the room of the reader's own days.
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
  /** Whether the view's read failed with nothing to show, which the panel says. */
  readFailed: boolean
  /** The day the read was asked on, the last a custom period can name. */
  today: string
  /** What each filter offers, as the read gave it. */
  values: Partial<Record<UsageDimension, FilterValues>>
  view: AnalyticsView
}>()
/**
 * A change of the view, a filter set anew, the dimensions whose values the filter's menu shows,
 * or the figures read again.
 */
const emit = defineEmits<{
  amend: [next: Partial<AnalyticsView>]
  filter: [dimension: UsageDimension, values: (string | null)[]]
  need: [dimensions: UsageDimension[]]
  refresh: []
}>()

const { locale, t } = useI18n()

const periodOptions = computed(() =>
  PERIODS.map((value) => ({ value, label: t(`analytics.period.${value}`) })),
)

function choosePeriod(period: PeriodPreset) {
  emit('amend', period === 'custom' ? { period, ...customDays(new Date()) } : { period })
}

/**
 * The periods' row, which scrolls sideways on a phone, and keeps the chosen one in view: when it is
 * chosen, and once the line is fitted, which changes the row's room.
 */
const periods = ref<{ $el: HTMLElement } | null>(null)
function showChosen() {
  periods.value?.$el
    .querySelector<HTMLElement>('.active')
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
onMounted(showChosen)

/**
 * What the line gives up while it has no room for all it holds (`useBarRoom`): its buttons' words,
 * the room between its parts, the word around the age, a failure's retry's own word, and a span's
 * name.
 */
const line = useTemplateRef<HTMLElement>('line')
const refreshButton = useTemplateRef<{ $el: HTMLElement }>('refreshButton')
const { failed } = usePageStanding()

/** A width in the root's ems, as the bar's container queries count it. */
function ems(width: number) {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  return width / rem
}

const room = useBarRoom({
  line,
  last: () => refreshButton.value?.$el,
  // On a phone the failure's words wrap rather than run past the row's end, a last resort.
  wrapped: () => {
    const words = line.value?.querySelector<HTMLElement>('.refresh-failed-words')
    if (!words) return false
    const size = Number.parseFloat(getComputedStyle(words).fontSize)
    return words.getBoundingClientRect().height > 1.9 * size
  },
  order: () => ['words', 'gaps', 'ago', 'retry', 'span'],
  observed: [line],
  // Wider than a phone and under 50rem the one line has no room whatever period is chosen.
  narrow: () => {
    const wide = ems(line.value?.getBoundingClientRect().width ?? 0)
    return wide > 30 && wide < 50
  },
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
  const wide = ems(barWidth.value)
  return (wide > 0 && wide <= 30) || room.gave('words')
})
/**
 * Whether the room between the parts narrowed, the age said by its span alone («15 s», its hint
 * and its hidden words saying «ago»), a failure whose words are its retry, and a span's name cut.
 */
const tight = computed(() => room.gave('gaps'))
const bare = computed(() => room.gave('ago'))
const brief = computed(() => room.gave('retry'))
const spanCut = computed(() => room.gave('span'))
/** Whether the bar is two rows: too narrow for one line, or with no room for it after all. */
const twoRows = room.rows
/** Whether the line is being fitted, a failure holding its room unseen. */
const held = room.holding
watch([() => props.view.period, held], showChosen, { flush: 'post' })

/** Whether a read failed: a read again, its figures kept, or the view's, with none to show. */
const readsFailed = computed(() => failed.value || props.readFailed)
/** Whether the live mark stands: a live period whose reads stand. */
const liveShown = computed(() => props.live && !readsFailed.value)

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
  [fresh.value?.at ? fresh.value.words : '', liveShown.value ? liveWords.value : '']
    .filter(Boolean)
    .join('\n'),
)
</script>

<template>
  <div
    ref="bar"
    class="analytics-bar"
    :class="{
      'analytics-bar-short': short,
      'analytics-bar-tight': tight,
      'analytics-bar-rows': twoRows,
    }"
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
        :dimensions="dimensions"
        :filters="view.filters"
        :short="short"
        :values="values"
        @filter="(dimension, chosen) => emit('filter', dimension, chosen)"
        @clear="emit('amend', { filters: {} })"
        @need="(needed) => emit('need', needed)"
      />
      <div class="analytics-bar-read">
        <RefreshFailed
          class="analytics-bar-failed"
          :brief="brief"
          :held="held"
          @retry="emit('refresh')"
        />
        <p
          v-tooltip.detail="freshHint"
          class="analytics-bar-fresh"
          :class="{ 'analytics-bar-fresh-live': live }"
          :data-widest="freshRoom"
        >
          <span class="analytics-bar-fresh-shown">
            <span
              v-if="liveShown"
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
        <VButton
          ref="refreshButton"
          v-tooltip.clipped="t('analytics.frame.refresh')"
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
   the room between its parts (`useBarRoom`). A bar with no room for it is two rows (below). */
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

/* Two rows (`analytics-bar-rows`, `useBarRoom`): the periods and the filters, then the ends of
   the reader's own period at the second row's start and the freshness with the read again at its
   end. A bar too narrow for the one line is two rows from the start, whatever period is chosen.
   Otherwise a row wrapped when a part came and moved everything under the bar down: beside the
   periods, an own period's ends pushed the filters and then the freshness onto a third row, and
   the panel moved down 44px. At 1024px the line is about 712px, and the periods and two days alone
   take 693px of it. The one line needs 50rem in Russian once it has given up all it can beside a
   failure and an age of hours: at 48rem it ran 13px past its end. A wider bar is two rows only
   when its one line, with every other part given up, still runs past its end: beside the reader's
   own days with a failure said, in Russian, «Refresh» ran 188px past the bar at 1108px, and
   pressed it scrolled the bar sideways. A bar that has room for the one line stays one line.

   The second row never wraps again, a failure said on it included: it gives way as the one line
   does, so nothing under the bar moves. Pressed past its room it runs past its end, where the room
   it gives way by is measured, and not past its start. Wider than a phone (below), the two rows
   are the line wrapped at a break of no height (`::before`) before the second row's parts, which
   carry the room between the rows themselves, so the break does not add that room twice. */
@container (width > 30rem) {
  .analytics-bar-rows .analytics-bar-line {
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

  .analytics-bar-rows .analytics-bar-read {
    flex: 1 1 0;
    justify-content: safe flex-end;
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

/* A phone: three rows of one height whatever period is chosen. The periods one row that scrolls
   sideways, with the freshness at its end; the filter, a failure and the read again, by its icon
   alone, the row under it; and the room of the reader's own days. A span of days chosen used to
   take a row of its own and move everything under the bar down 44px, and a failure's words had no
   room beside the freshness, so the disc stood alone. The failure has a column of its own under
   the periods, the column of the freshness's start beside it its own too, so nothing moves when
   it is said. The freshness's group lends the rows its parts. */
@container (width <= 30rem) {
  .analytics-bar-line {
    display: grid;
    grid-template-rows: auto auto var(--size-control-height-compact);
    grid-template-columns: minmax(min-content, 1fr) auto auto auto;
    gap: var(--space-2);
  }

  .analytics-bar-read {
    display: contents;
  }

  .analytics-period {
    flex-wrap: nowrap;
    grid-area: 1 / 1 / 2 / 3;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;

    /* As wide as its row leaves it, which its periods side by side would otherwise widen. */
    contain: inline-size;
  }

  .analytics-bar-fresh {
    grid-area: 1 / 3 / 2 / 5;
    align-self: center;
  }

  /* Its words wrap onto a second line in the row's height only where a narrow phone has no room
     left for them on one (`useBarRoom`): at 360px in Russian they ran 30px past the window. */
  .analytics-bar-line .analytics-bar-failed {
    grid-area: 2 / 2 / 3 / 3;
    white-space: normal;
  }

  .analytics-refresh {
    grid-area: 2 / 4 / 3 / 5;
  }

  .analytics-bar-own {
    grid-area: 3 / 1 / 4 / -1;
  }
}

/* A short bar (`short`) says the read again by its icon. Its words stay in the button for
   assistive technology, hidden from sight, and its hint names it. */
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

/* A phone's rows already part their parts by that narrow gap; giving it up, they narrow it again,
   which a failure said beside the filter and the read again needs. */
@container (width <= 30rem) {
  .analytics-bar-tight .analytics-bar-line {
    column-gap: var(--space-1);
  }
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
