<script setup lang="ts">
/**
 * One value in the side panel over the Analytics page (`DetailPanel`), whatever pressed it: its
 * name in full, and under it what can be done with it — a task's card opened (`openCard`: a plain
 * press opens it over the page, one with a modifier elsewhere) and «Add to filter», which adds the
 * value to its dimension's filter beside the values there and closes the panel (`add`), and which a
 * value the filter holds already offers disabled, as «Already in filter» (`usePageFilter`). Then
 * what it spent, read with
 * the page's period, steps and filters and its own filter (`useValueRead`):
 *
 * - its figures under a heading that names their period as the page names one, «Figures · Nov 9 –
 *   11»: the agent time, the tokens and the cost, its share of the whole the page shows in the
 *   page's measure, with what qualifies them — the time of agents at once added up, the cost an estimate at API
 *   prices, what the tokens count and, read by the minute, that a minute's figures are shared out
 *   (`useSectionCaveats`, of the value's own read) — said once in the «ⓘ» that ends their
 *   heading's line, «About these figures», never as a line of the panel: the section's «ⓘ» that
 *   says them on the page stands under the panel;
 * - for a task, its figures of all time, the agents' time and the cost, as its card reads and
 *   says them and by the card's names for them (`useTaskAllTime`): an epic's of its whole scope,
 *   the agents' time the card's «Agent time», never its «Work on the clock»;
 * - its period step by step, with the period before marked (`ValueDays`);
 * - the models and the accounts it ran on, ranked in the page's measure, each in its hue of the
 *   page with its share of the value's own figure after its amount (`RankedBars`, dense); a value
 *   of the models or the accounts has no list of its own.
 *
 * A task deleted since has no card to open. The first read's wait is
 * one quiet line, reported to the panel's status region (`useReadWaitReport`); a first read that
 * failed says so with a retry, and a read again that failed keeps what it showed and says so as the
 * page's bar does (`RefreshFailed`), in room the actions' row keeps for it while nothing failed:
 * on a phone, said in room of its own, it took a line under the actions and moved the figures
 * 36px down, and gave it back with the next answer. A period before that could not be read is said
 * there too: as a note under the days it moved the lists under them 25px down. A value with
 * nothing in the period says that.
 *
 * What a reader of the panel selects it by: the content is `data-detail="value"`, each part of it
 * `data-part` (`actions`, `figures`, `all-time`, `days`, `model`, `account`) and each figure
 * `data-figure` (`time`, `tokens`, `cost`, `share`; of all time `agents`, `cost` or `failed`).
 */
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import RefreshFailed from '@/pages/analytics/components/RefreshFailed.vue'
import ValueDays from '@/pages/analytics/components/ValueDays.vue'
import ValueFigures from '@/pages/analytics/components/ValueFigures.vue'
import { useColourPlaces } from '@/pages/analytics/composables/useColourPlaces.ts'
import { useLineActions } from '@/pages/analytics/composables/useLineActions.ts'
import { usePageFilter } from '@/pages/analytics/composables/usePageFilter.ts'
import { useReadWaitReport } from '@/pages/analytics/composables/useReadWaits.ts'
import { useSectionCaveats } from '@/pages/analytics/composables/useSectionCaveats.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { useTaskAllTime } from '@/pages/analytics/composables/useTaskAllTime.ts'
import {
  useValueRead,
  valueBreakdowns,
  valueSteps,
} from '@/pages/analytics/composables/useValueRead.ts'
import type { ValueBreakdown } from '@/pages/analytics/composables/useValueRead.ts'
import type { PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'
import { rankedSlots } from '@/pages/analytics/utils/dayFigures.ts'
import {
  breakdownOf,
  drawnLines,
  figureOf,
  measureOf,
  spendingLines,
  spentOf,
} from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine } from '@/pages/analytics/utils/usageFigures.ts'
import { filterKey } from '@/pages/analytics/utils/usageValues.ts'

import { MEASURES } from '@/shared/api/analyticsAddress.ts'
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type {
  Usage,
  UsageDimension,
  UsageFilters,
  UsageGroupValue,
} from '@/shared/api/analyticsApi.ts'
import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import DrawerFrame from '@/shared/ui/DrawerFrame.vue'
import FieldError from '@/shared/ui/FieldError.vue'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'
import { vTextRuns } from '@/shared/ui/textRuns.ts'
import VButton from '@/shared/ui/VButton.vue'
import { vWholeWords } from '@/shared/ui/wholeWords.ts'

const props = defineProps<{
  by: UsageDimension
  /** The period the page's answer is compared with; null when it was not read. */
  compared: PeriodBounds | null
  /** The filters the page's answer was read with. */
  filters: UsageFilters
  measure: Measure
  /** Why the last adding to the filter asked here was not made, in words; empty otherwise. */
  notice: string
  /** The page's answer the value is read for; null while there is none. */
  page: Usage | null
  /** Whether the page's period spent nothing, so the value has nothing to read. */
  pageEmpty: boolean
  /** When the page's answer was asked for, which says which step is not over yet. */
  readAt: Date
  /** The value's id, or null for work with no value in the dimension. */
  value: string | null
  /** Whether the period is live, «Now» or «Today». */
  live?: boolean
}>()
/** The panel closed; the value added to the page's filter, by its name; the name it heads it by. */
const emit = defineEmits<{ add: [label: string]; close: []; named: [title: string] }>()

const { t } = useI18n()
const words = useSpendingWords()
const actions = useLineActions()
const places = useColourPlaces()
const caveats = useSectionCaveats()

const { state, retry } = useValueRead({
  by: () => props.by,
  value: () => props.value,
  page: () => props.page,
  filters: () => props.filters,
  compared: () => props.compared,
})

const answers = computed(() => (state.value.status === 'ready' ? state.value.answers : null))
const steps = computed(() => (answers.value ? valueSteps(answers.value) : null))
/** The steps of the period before, read with the answers. */
const before = computed(() => (state.value.status === 'ready' ? state.value.before : null))
/** Whether those steps were asked and could not be read. */
const beforeFailed = computed(() => state.value.status === 'ready' && state.value.beforeFailed)

/**
 * The value as the answers name it, with its title and number; as its id alone, or as work with
 * no value, while none has named it.
 */
const named = computed<UsageGroupValue>(() => {
  const found = steps.value?.rows.find((row) => row.group[props.by])?.group[props.by]
  return found ?? { id: props.value, unknown: false }
})
const name = computed(() => words.valueLabel(props.by, named.value))
/** The name in runs, where it holds a task's title: its code is drawn as code in the heading. */
const nameRuns = computed(() => words.valueRuns(props.by, named.value))
watch(name, (title) => emit('named', title), { immediate: true })
const card = computed(() => actions.taskLink(props.by, named.value))
/** A middle press on the card's link opens it elsewhere, and is a press on it all the same. */
function openCard(event: MouseEvent) {
  if (card.value && (event.type === 'click' || event.button === 1))
    actions.openCard(card.value, event)
}
/** What narrowing does past narrowing, said where it is not plain; no description otherwise. */
/** Whether the page's filter holds the value already, which leaves nothing to add. */
const pageFilter = usePageFilter()
const filtered = computed(() => pageFilter?.has(props.by, props.value) ?? false)
const addWords = computed(() =>
  filtered.value ? t('analytics.filters.held') : t('analytics.filters.add'),
)
/** A read again that failed, said beside the actions while what it replaced stays. */
const failedAgain = computed(() => state.value.status === 'ready' && state.value.failedAgain)

/** The first read's wait, shown once it has lasted and held for the minimum. */
const { shown: waiting } = useLoadingPresence(
  () => state.value.status === 'loading' && !props.pageEmpty,
)
useReadWaitReport(waiting)
/** The wait's words, once it has lasted; the room it holds stays empty until then. */
const waitWords = computed(() => (waiting.value ? t('platform.states.loading') : ''))

/** What the panel says under its actions: the value's parts, nothing spent, a failure or a wait. */
const shows = computed(() => {
  if (props.pageEmpty) return 'empty'
  if (waiting.value) return 'waiting'
  if (state.value.status === 'failed') return 'failed'
  const usage = steps.value
  if (!usage) return 'waiting'
  return usage.rows.length ? 'spent' : 'empty'
})

/** A task's figures of all time, as its card says them (`useTaskAllTime`). */
const allTime = useTaskAllTime({
  item: () => {
    const reference = card.value ? named.value.reference : null
    return reference ? { reference, epic: named.value.kind === 'epic' } : null
  },
  readAt: () => props.readAt,
})

const spent = computed(() => (steps.value ? spentOf(steps.value.total) : null))
/** Its share of what the page shows in the page's measure; none where that is nothing. */
const share = computed(() => {
  const page = props.page
  if (!spent.value || !page) return null
  const whole = measureOf(props.measure, spentOf(page.total))
  const part = measureOf(props.measure, spent.value)
  return whole && part !== null ? part / whole : null
})
const figures = computed(() => {
  const own = spent.value
  if (!own) return []
  const each = MEASURES.map((measure) => ({
    key: measure,
    name: words.measure(measure),
    text: words.lineFigure(measure, own),
  }))
  const ratio = share.value
  return [
    ...each,
    ...(ratio === null
      ? []
      : [
          {
            key: 'share',
            name: t('analytics.detail.share'),
            text: t('analytics.detail.shareOf', {
              share: words.share(ratio),
              measure: words.measure(props.measure),
            }),
          },
        ]),
  ]
})
/** The figures' heading, with the period they are of as the page names a period. */
const figuresTitle = computed(() => {
  const period = steps.value?.period
  const figures = t('analytics.detail.figures')
  return period
    ? t('analytics.detail.figuresOf', { figures, period: words.period(period.from, period.to) })
    : figures
})

/** What qualifies the figures, as the section's «ⓘ» under the panel says it of the page's. */
const about = computed(() => (steps.value ? caveats.spending(steps.value) : []))

/** The value's hue on the page, as its bar and its stack draw it (`rankedSlots`). */
const hue = computed(() => {
  const rows = places.rows(props.by) ?? props.page?.rows ?? []
  const key = props.value === null ? 'none' : filterKey(props.value)
  return rankedSlots(rows, props.by, props.measure).get(key) ?? 'other'
})

const weight = (line: SpendingLine) => measureOf(props.measure, line.spent) ?? 0

/**
 * The models or the accounts the value ran on, ranked in the measure, each in its page's hue and
 * with its share of what they all add up to.
 */
function rankedOf(breakdown: ValueBreakdown, usage: Usage): RankedRow[] {
  const hues = rankedSlots(places.rows(breakdown) ?? usage.rows, breakdown, props.measure)
  const all = spendingLines(
    usage.rows,
    breakdownOf(breakdown),
    props.measure,
    Number.POSITIVE_INFINITY,
  )
  const whole = all.reduce((sum, line) => sum + weight(line), 0)
  const listed = all
    .filter((line) => line.kind !== 'other' && figureOf(props.measure, line.spent) !== 0)
    .sort((left, right) => weight(right) - weight(left))
  return drawnLines(props.measure, listed).map((line) => ({
    key: line.key,
    label: words.lineLabel(breakdown, line),
    labelRuns: words.lineRuns(breakdown, line),
    detail: words.valueDetail(breakdown, line.value),
    value: weight(line),
    valueText: words.lineShare(props.measure, line.spent, whole),
    slot: hues.get(line.key) ?? 'other',
    quiet: line.kind !== 'category',
  }))
}

const lists = computed(() =>
  valueBreakdowns(props.by).flatMap((breakdown) => {
    const usage = answers.value?.[breakdown]
    if (!usage) return []
    const title = t(
      breakdown === 'model' ? 'analytics.detail.byModel' : 'analytics.detail.byAccount',
    )
    return [
      {
        breakdown,
        title,
        rows: rankedOf(breakdown, usage),
        words: {
          category: words.dimension(breakdown),
          value: words.measure(props.measure),
          empty: t('analytics.overview.cards.empty'),
        },
      },
    ]
  }),
)
</script>

<template>
  <DrawerFrame
    :title="name"
    :close-label="t('analytics.detail.close')"
    @close="emit('close')"
  >
    <template
      v-if="nameRuns"
      #title
    >
      <span v-text-runs="nameRuns" />
    </template>
    <!-- A model id is one name: its heading breaks between words, never at its hyphen. -->
    <template
      v-else-if="by === 'model'"
      #title
    >
      <span v-whole-words="name" />
    </template>
    <template #facts>
      <div
        class="value-actions"
        data-part="actions"
      >
        <a
          v-if="card"
          class="value-card"
          :href="card.href"
          @click="openCard"
          @auxclick="openCard"
          >{{ t('analytics.detail.card') }}</a
        >
        <VButton
          size="compact"
          :disabled="filtered"
          @click="emit('add', name)"
        >
          {{ addWords }}
        </VButton>
        <RefreshFailed
          :failed="failedAgain"
          held
          @retry="retry"
        />
      </div>
      <FieldError
        v-if="notice"
        role="alert"
      >
        {{ notice }}
      </FieldError>
    </template>
    <div
      class="value-detail"
      data-detail="value"
    >
      <p
        v-if="shows === 'waiting'"
        class="value-detail-wait"
      >
        {{ waitWords }}
      </p>
      <div
        v-else-if="shows === 'failed'"
        class="value-detail-failed"
      >
        <DataEmptyState
          :title="t('analytics.detail.failed')"
          inline
        />
        <VButton
          size="compact"
          @click="retry"
        >
          {{ t('platform.actions.retry') }}
        </VButton>
      </div>
      <DataEmptyState
        v-else-if="shows === 'empty'"
        :title="t('analytics.detail.empty')"
        inline
      />
      <PanelLevel
        v-else
        level="group"
        as="div"
      >
        <PanelLevel
          level="block"
          data-part="figures"
          :title="figuresTitle"
          :about="about"
          :about-label="t('analytics.detail.about')"
        >
          <ValueFigures :figures="figures" />
        </PanelLevel>
        <PanelLevel
          v-if="allTime"
          level="block"
          data-part="all-time"
          :title="allTime.title"
        >
          <ValueFigures :figures="allTime.figures" />
        </PanelLevel>
        <ValueDays
          v-if="steps"
          data-part="days"
          :before="before"
          :before-failed="beforeFailed"
          :measure="measure"
          :name="name"
          :name-runs="nameRuns"
          :read-at="readAt"
          :hue="hue"
          :usage="steps"
          :live="live"
        />
        <PanelLevel
          v-for="list in lists"
          :key="list.breakdown"
          level="block"
          :title="list.title"
          :data-part="list.breakdown"
        >
          <RankedBars
            :label="list.title"
            :rows="list.rows"
            :words="list.words"
            dense
          />
        </PanelLevel>
      </PanelLevel>
    </div>
  </DrawerFrame>
</template>

<style scoped>
/* What can be done with the value, on one line under its name while it fits. */
.value-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
}

/* A link to the card in the words of the page's links. */
.value-card {
  color: var(--color-text);
  font: var(--font-detail);
  text-decoration: underline;
  text-decoration-color: var(--color-rule-strong);
  text-underline-offset: var(--space-half);

  &:hover {
    text-decoration-color: currentcolor;
  }
}

.value-detail {
  min-width: 0;
}

.value-detail-wait {
  min-block-size: 1lh;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.value-detail-failed {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
}
</style>
