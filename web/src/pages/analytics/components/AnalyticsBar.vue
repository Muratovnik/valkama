<script setup lang="ts">
/**
 * The bar over every section of the Analytics page, a period bar (`PeriodBar`) filled with the
 * page's own: its periods, with the ends of the reader's own beside them, its two days or the name
 * of a span between two moments; the filter's field, the way to add a filter
 * (`AnalyticsFilterField`, `useAnalyticsFilter`); how fresh the figures are; and a read of them
 * again. Each value a filter is set to is a chip that takes it out, in a row of its own under the
 * line, with «Clear filters» at its end (`AnalyticsChipRow`), as the Work bar places its chips.
 * The bar's line, its two rows and a phone's rows are the period bar's, which keeps the panel
 * under it from moving with what the bar holds: the filter's field takes the room the rest
 * leaves, never less than its words need, and its menu lies over the panel. The chips' row comes
 * with the first filter set and goes with the last, so the panel moves down by that row then, and
 * by nothing else the filters do.
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
 * end: the words of its buttons go first, the read again then said by its icon, then the room
 * between its parts narrows, then the age is said by its span, «● 15 s», in the room of the widest
 * span, and then a failure's retry gives up its own word, the failure's words then being the retry
 * (`RefreshFailed`). Past all of that a span's name is cut at its end, its hint saying it whole.
 * The age's span is never given up, nor a failure's words, nor a day of the period: its fields are
 * as wide as a date needs. The one line needs 50rem in Russian once it has given up all it can
 * beside a failure and an age of hours: at 48rem it ran 13px past its end; the reader's own days
 * need the one line given up up to a window of about 1390px. The line is fitted as if a failure
 * were said, so one said takes only room of the field's past its words and moves the start of
 * nothing: neither the bar's height nor its controls.
 *
 * On a phone the periods take the first row whole; under it the filter, a failure, the freshness
 * and the read again, by its icon; with a filter set, the chips' row right under them, where one
 * chip yields its room to «Clear filters» and the two keep one line whatever name comes; and,
 * once chosen, the reader's own days. On the narrowest phone the freshness stands in the
 * periods' row, leaving a failure its room: in the cell their short last line leaves, past
 * «Custom», or at the row's end where they leave no such cell. It stays the freshness there,
 * never a period: words in the muted detail ink on the track's ground, with no ground, edge or
 * press of their own, and outside the choice for assistive technology.
 */
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import AnalyticsChipRow from '@/pages/analytics/components/AnalyticsChipRow.vue'
import AnalyticsFilterField from '@/pages/analytics/components/AnalyticsFilterField.vue'
import RefreshFailed from '@/pages/analytics/components/RefreshFailed.vue'
import { useAnalyticsFilter } from '@/pages/analytics/composables/useAnalyticsFilter.ts'
import { useFreshness } from '@/pages/analytics/composables/useFreshness.ts'
import { LIVE_INTERVAL } from '@/pages/analytics/composables/useLiveRefresh.ts'
import { usePageStanding } from '@/pages/analytics/composables/useReadStanding.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { FilterValues } from '@/pages/analytics/composables/useUsageRead.ts'
import { customDays } from '@/pages/analytics/utils/analyticsPeriod.ts'

import PeriodBar from '@/widgets/period-bar/components/PeriodBar.vue'

import { isMomentSpan, PERIODS } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView, PeriodPreset } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
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

const { t } = useI18n()
const spending = useSpendingWords()

const periodOptions = computed(() =>
  PERIODS.map((value) => ({ value, label: t(`analytics.period.${value}`) })),
)
const barWords = computed(() => ({
  from: t('analytics.period.from'),
  label: t('analytics.period.label'),
  reversed: t('analytics.period.reversed'),
  to: t('analytics.period.to'),
}))

/** The filter on the shared field and chips (`useAnalyticsFilter`), which the bar places. */
const filter = useAnalyticsFilter({
  clear: () => emit('amend', { filters: {} }),
  dimensions: () => props.dimensions,
  filter: (dimension, chosen) => emit('filter', dimension, chosen),
  filters: () => props.view.filters,
  need: (needed) => emit('need', needed),
  values: () => props.values,
})
/** Whether a filter is set, its chips then taking a row of their own. */
const filtered = computed(() => filter.chips.value.length > 0)
/** Whether one chip stands alone, which on a phone yields its room to «Clear filters». */
const oneChip = computed(() => filter.chips.value.length === 1)

function choosePeriod(period: PeriodPreset) {
  emit('amend', period === 'custom' ? { period, ...customDays(new Date()) } : { period })
}

/** The name of a span between two moments; null for a span of days. */
const spanName = computed(() =>
  isMomentSpan(props.view) ? spending.span(props.view.from, props.view.to) : null,
)

/**
 * What the line gives up while it has no room for all it holds: its buttons' words, the room
 * between its parts, the word around the age, a failure's retry's own word, and a span's name.
 */
const ORDER = ['words', 'gaps', 'ago', 'retry', 'span'] as const
/**
 * What else the line is fitted again for: whether the period is live. The filters set stand in a
 * row of their own, so they change nothing on the line.
 */
const holds = computed(() => [props.live])

/** The period bar, which says what its line gave up. */
const bar = useTemplateRef<{ gave: (part: string) => boolean }>('bar')
/** Whether the age is said by its span alone, «15 s», its hint and hidden words saying «ago». */
const bare = computed(() => bar.value?.gave('ago') ?? false)
/** Whether a failure's words are its retry, the retry having given up its own word. */
const brief = computed(() => bar.value?.gave('retry') ?? false)

/** On a phone the failure's words wrap rather than run past the row's end, a last resort. */
function wrapped(line: HTMLElement) {
  const words = line.querySelector<HTMLElement>('.refresh-failed-words')
  if (!words) return false
  const size = Number.parseFloat(getComputedStyle(words).fontSize)
  return words.getBoundingClientRect().height > 1.9 * size
}

const { failed } = usePageStanding()
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
  <PeriodBar
    ref="bar"
    class="analytics-bar"
    :from="view.from"
    :holds="holds"
    :line-room="50"
    :order="ORDER"
    :period="view.period"
    :periods="periodOptions"
    :refused="filtersRefused"
    :span-name="spanName"
    :to="view.to"
    :today="today"
    :under="filtered"
    :words="barWords"
    :wrapped="wrapped"
    beside
    @days="(next) => emit('amend', next)"
    @period="choosePeriod"
  >
    <template #default="{ short }">
      <AnalyticsFilterField
        ref="filterField"
        :filter="filter"
        :short="short"
      />
    </template>
    <template #end="{ cell, held, short }">
      <RefreshFailed
        class="analytics-bar-failed"
        :brief="brief"
        :held="held"
        @retry="emit('refresh')"
      />
      <p
        v-tooltip.detail="freshHint"
        class="analytics-bar-fresh"
        :class="{ 'analytics-bar-fresh-live': live, 'analytics-bar-fresh-cell': cell }"
        :data-widest="freshRoom"
      >
        <span class="analytics-bar-fresh-shown">
          <span
            v-if="liveShown"
            class="analytics-bar-fresh-mark disc-mark"
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
        v-tooltip.clipped="t('analytics.frame.refresh')"
        class="analytics-refresh"
        size="compact"
        :class="{ 'analytics-refresh-short': short }"
        @click="emit('refresh')"
      >
        <VIcon
          name="refresh"
          :size="16"
        />
        <span class="analytics-refresh-words">{{ t('analytics.frame.refresh') }}</span>
      </VButton>
    </template>
    <template #under>
      <AnalyticsChipRow
        ref="filterChips"
        class="analytics-bar-chips"
        :class="{ 'analytics-bar-chips-one': oneChip }"
        :filter="filter"
      />
    </template>
  </PeriodBar>
</template>

<style scoped>
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

/* A phone (`PeriodBar`): the periods take the first row whole, and the row under it holds the
   filter, a failure, the freshness and the read again, by its icon alone. Beside the periods the
   freshness left them a row of 216px that scrolled sideways and cut «Сейчас» and «Свой». The
   failure has a column of its own, the freshness one after it, so nothing moves when it is
   said. */
@container (width <= 30rem) {
  .analytics-bar-fresh {
    grid-area: 2 / 3 / 3 / 4;
    align-self: center;
  }

  /* Its words wrap onto a second line in the row's height only where a narrow phone has no room
     left for them on one (`useBarRoom`): at 360px in Russian they ran 30px past the window. */
  .analytics-bar .analytics-bar-failed {
    grid-area: 2 / 2 / 3 / 3;
    white-space: normal;
  }

  .analytics-refresh {
    grid-area: 2 / 4 / 3 / 5;
  }

  /* With a filter set its chips take the row right under the field's (`PeriodBar`'s `under`). */
  .analytics-bar-chips {
    grid-area: 3 / 1 / 4 / -1;
  }

  /* One chip yields its room to «Clear filters» rather than send it to a line of its own: the
     two keep one line whatever name comes, a name with no room cut at its end with its hint
     (`FacetFilterChips`), so the bar keeps its height when the name comes. The widest chip's
     room, held until the first answer, sent «Снять фильтры» to a second line at 380 to 401px in
     Russian, and a short name brought it back: the bar shrank by 32px on the first answer.
     Several chips keep their words and wrap. */
  .analytics-bar .analytics-bar-chips-one {
    --filter-chip-shrink: 1;

    flex-wrap: nowrap;
  }
}

/* The narrowest phone (`PeriodBar`'s `beside`): the freshness in the periods' row, so a failure
   has the row under them beside the filter and the read again. At the row's end, on their first
   line, where the periods leave it the third and fourth columns; in the cell their short last
   line leaves where they keep the whole row (`cell`), on that line's height and as far from the
   track's end as a period's words from its column's edge. It is not drawn as a segment: the
   track's ground under it is the periods', and it takes none of its own.

   In the cell it spans the whole row and stands at its end, so it sizes none of the columns the
   row under the periods shares out: on the third and fourth it held the third as wide as itself
   past the read again, an empty column in the row under them that the field and a failure lost,
   58px for a live period, and at 360px in Russian the failure's words took three lines and the
   bar grew by 11px. Under 19rem, a window under about 400px: at 18rem, in windows of 384 to
   399px, a live period's failure in Russian had 90px beside the field, the freshness and the
   read again, took three lines and grew the bar by 11px. */
@container (width < 19rem) {
  .analytics-bar-fresh {
    grid-area: 1 / 3 / 2 / 5;
    align-content: center;
    align-self: start;
    min-block-size: var(--size-control-height-compact);
  }

  .analytics-bar-fresh-cell {
    grid-column: 1 / -1;
    place-self: end;
    padding-inline-end: var(--space-3);
  }
}

/* A short bar (`short`) says the read again by its icon. Its words stay in the button for
   assistive technology, hidden from sight, and its hint names it. They are hidden by this rule
   rather than the shared `.visually-hidden`, which a hint never counts as cut (`textIsClipped`):
   under that class the short bar's button lost its hint. */
.analytics-refresh-short .analytics-refresh-words {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  white-space: nowrap;
  overflow: hidden;
  clip-path: inset(50%);
}

/* That the period reads itself again: the sign of the hint's words, not their meaning, a disc
   (`discMark.css`). */
.analytics-bar-fresh-mark {
  background: var(--color-success);
}
</style>

<style scoped src="@/pages/analytics/components/discMark.css"></style>
