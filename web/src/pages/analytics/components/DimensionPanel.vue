<script setup lang="ts">
/**
 * The panel of one dimension: what one answer of the usage read says of its values. At its top the
 * period's figures, which also choose the measure (`SpendingTiles`); then every value ranked
 * (`SpendingBars`) beside a small chart of the period for each leading value on one scale
 * (`SpendingMultiples`), and the period day by day (`SpendingDays`); under them the table
 * (`SpendingTable`). A value has one hue in the bars, the small charts and the day chart
 * (`valueSlots`), and its name beside it.
 *
 * «Split by» in the section's heading chooses a second dimension, or none, and the address keeps
 * it (`across`). Split, the section is read by both (`useCrossRead`), and the ranked bars, the
 * small charts, the day chart and the table read its pairs, «claude-opus-5-5 · high», each a value
 * with its own hue in the fixed order of their rank over every pair of the read, the tail past the
 * hues in the neutral of «other». While the pairs are first read the charts keep the values.
 *
 * The hues are ranked over the period without the page's filters (`useColourPlaces`), the values'
 * and the pairs' alike, so a filter that takes some away leaves the rest the hues they had.
 *
 * It runs in the panel's one scroll: the figures, the charts at their own height and the table at
 * its full height under them, nothing scrolling up and down on its own. A «To the table» line over
 * the charts, like the line under the ranked list that counts the values it leaves out, brings the
 * table into view with the focus on it (`SpendingTable`'s `reveal`).
 *
 * A value or a day pressed to narrow the view goes out with the dimension the answer was read by
 * and the part of the panel it was pressed in, which says why when it was refused. An answer whose
 * period before could not be read says so above the figures (`SpendingUnread`). Its heading names
 * the dimension the answer was read by, and the heading's «ⓘ» says the caveats of its figures
 * once (`useSectionCaveats`).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import SpendingBars from '@/pages/analytics/components/SpendingBars.vue'
import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import SpendingMultiples from '@/pages/analytics/components/SpendingMultiples.vue'
import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'
import SpendingTableLink from '@/pages/analytics/components/SpendingTableLink.vue'
import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import SpendingUnread from '@/pages/analytics/components/SpendingUnread.vue'
import { useColourPlaces } from '@/pages/analytics/composables/useColourPlaces.ts'
import { useCrossRead } from '@/pages/analytics/composables/useCrossRead.ts'
import { useNarrowCharts } from '@/pages/analytics/composables/useNarrowCharts.ts'
import { useAnewDimmed, usePanelStanding } from '@/pages/analytics/composables/useReadStanding.ts'
import { useSectionCaveats } from '@/pages/analytics/composables/useSectionCaveats.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import type { OwnPeriod } from '@/pages/analytics/utils/analyticsPeriod.ts'
import { valueSlots } from '@/pages/analytics/utils/dayMultiples.ts'
import { refusedIn, tileFigures } from '@/pages/analytics/utils/panelAnswer.ts'
import type { Refusal, ReportPart } from '@/pages/analytics/utils/panelAnswer.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import { pageDimensionOf } from '@/shared/api/analyticsApi.ts'
import type { Usage, UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

const props = defineProps<{
  /** The period by account behind the answer, for where the accounts that worked changed. */
  accounts: AccountsRead
  /** The second dimension the section is split by, as the address holds it; null for none. */
  across: UsageDimension | null
  /** The dimensions the section may be split by, its own aside. */
  dimensions: readonly UsageDimension[]
  /** The filters the answer was read with. */
  filters: UsageFilters
  /** When the answer was asked for, which says which day is not over yet. */
  readAt: Date
  /** Why the last press in a part of the panel did not narrow the view; null otherwise. */
  refused: Refusal | null
  usage: Usage
}>()
/**
 * Read the answer again; narrow the view to a value of the answer's dimension, or to a period
 * pressed or framed in a part of the panel; split the section by a second dimension, or by none.
 */
const emit = defineEmits<{
  'frame': [span: OwnPeriod, label: string]
  'narrow': [dimension: UsageDimension, value: string | null, label: string, part: ReportPart]
  'retry': []
  'step': [span: OwnPeriod, label: string]
  'update:across': [across: UsageDimension | null]
}>()
const { t } = useI18n()
const words = useSpendingWords()
const caveats = useSectionCaveats()
const measure = defineModel<Measure>('measure', { required: true })

/**
 * The dimension the answer was read by, not the one the page now asks for: while a new
 * breakdown is read the last one stays on screen, and its rows name only their own dimension.
 */
const by = computed<UsageDimension>(() => pageDimensionOf(props.usage) ?? 'work_item')
const before = computed(() => tileFigures(props.usage).before)
/** The section's heading and the caveats its «ⓘ» says. */
const title = computed(() => words.dimension(by.value))
const about = computed(() => caveats.spending(props.usage))

/** The second dimension, where it is another than the section's own. */
const across = computed(() => (props.across && props.across !== by.value ? props.across : null))
const cross = useCrossRead({
  usage: () => props.usage,
  across: () => across.value,
  filters: () => props.filters,
})

const places = useColourPlaces()
const slots = computed(() =>
  valueSlots({
    usage: props.usage,
    by: by.value,
    measure: measure.value,
    places: places.rows(by.value),
  }),
)

/** The answer by both dimensions on show, once there is one for the split chosen. */
const crossed = computed(() => {
  const read = cross.state.value
  return across.value && 'usage' in read && read.usage ? read.usage : null
})
/**
 * What the charts read: the answer by the pairs, while split and read, or the section's own
 * values, each with its hues.
 */
const ranked = computed(() =>
  crossed.value
    ? {
        usage: crossed.value,
        across: across.value,
        slots: valueSlots({
          usage: crossed.value,
          by: by.value,
          measure: measure.value,
          across: across.value,
          places: places.rows(by.value, across.value),
        }),
      }
    : { usage: props.usage, across: null, slots: slots.value },
)

/** «Split by»: none, or any dimension of the page but the section's own. */
const NONE = 'none'
const splitOptions = computed(() => [
  { value: NONE, label: t('analytics.panel.split.none') },
  ...props.dimensions
    .filter((dimension) => dimension !== by.value)
    .map((dimension) => ({ value: dimension, label: words.dimension(dimension) })),
])
function chooseSplit(value: string) {
  emit('update:across', props.dimensions.find((dimension) => dimension === value) ?? null)
}

const root = ref<HTMLElement | null>(null)
const narrow = useNarrowCharts(root)

const noticeIn = (part: ReportPart) => refusedIn(props.refused, part)

/** Dimmed while a new view is read in place of this answer (`readPending.css`). */
const pending = useAnewDimmed(usePanelStanding())

/** The table asked for, by the line over the charts or under the ranked list. */
const table = ref<InstanceType<typeof SpendingTable> | null>(null)
const showTable = () => table.value?.reveal()
</script>

<template>
  <div
    ref="root"
    class="dimension-panel"
    :class="{ 'read-pending': pending }"
  >
    <PanelLevel
      class="dimension-section"
      level="section"
      as="div"
      :title="title"
      :about="about"
    >
      <template #actions="{ size }">
        <span
          class="dimension-split-label"
          aria-hidden="true"
          >{{ t('analytics.panel.split.label') }}</span
        >
        <ChoiceSelect
          class="dimension-split"
          :size="size"
          :label="t('analytics.panel.split.label')"
          :model-value="across ?? NONE"
          :options="splitOptions"
          @update:model-value="chooseSplit"
        />
      </template>
      <PanelLevel
        level="group"
        as="div"
      >
        <SpendingUnread
          v-if="!before"
          @retry="emit('retry')"
        />
        <SpendingTiles
          v-model:measure="measure"
          :usage="usage"
          :read-at="readAt"
        />
      </PanelLevel>
      <PanelLevel
        class="dimension-charts"
        level="group"
        as="div"
      >
        <SpendingTableLink
          class="dimension-to-table"
          @press="showTable"
        >
          {{ t('analytics.panel.table.toTable') }}
        </SpendingTableLink>
        <div class="dimension-pair">
          <SpendingBars
            :by="by"
            :across="ranked.across"
            :measure="measure"
            :narrow="narrow"
            :notice="noticeIn('bars')"
            :rows="ranked.usage.rows"
            :slots="ranked.slots"
            @narrow="(value, label) => emit('narrow', by, value, label, 'bars')"
            @more="showTable"
          />
          <SpendingMultiples
            :by="by"
            :across="ranked.across"
            :measure="measure"
            :narrow="narrow"
            :slots="ranked.slots"
            :usage="ranked.usage"
            @narrow="(value, label) => emit('narrow', by, value, label, 'bars')"
          />
        </div>
        <SpendingDays
          :accounts="accounts"
          :by="by"
          :across="ranked.across"
          :measure="measure"
          :narrow="narrow"
          :notice="noticeIn('days')"
          :read-at="readAt"
          :usage="ranked.usage"
          @frame="(span, label) => emit('frame', span, label)"
          @step="(span, label) => emit('step', span, label)"
          @narrow="(value, label) => emit('narrow', by, value, label, 'days')"
        />
      </PanelLevel>
      <SpendingTable
        ref="table"
        :across="across"
        :by="by"
        :cross="cross.state.value"
        :filters="filters"
        :measure="measure"
        :notice="noticeIn('table')"
        :usage="usage"
        @narrow="(value, label) => emit('narrow', by, value, label, 'table')"
        @reread="cross.retry"
      />
    </PanelLevel>
  </div>
</template>

<style scoped>
/* A section of the panel: the figures, the charts and the table one under the next, each as tall
   as what it holds, in the panel's one scroll (`PanelLevel`). Its width says whether two charts
   stand side by side. */
.dimension-panel {
  min-width: 0;
  container-type: inline-size;
}

/* The charts, top to bottom: the line to the table, then the ranked list and the small charts
   side by side where both read well, the list first, then the day chart. The air at the sides
   holds what a chart reaches past its column (a focus ring, a pressed fill), so nothing in it
   stands wider than its box. */
.dimension-charts {
  padding-inline: var(--space-2);
  margin-inline: calc(-1 * var(--space-2));
}

/* The two charts are blocks of the charts' group, its air apart. */
.dimension-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
  min-width: 0;
}

/* «Split by» names the choice beside it, in the quiet ink of a control's own words. */
.dimension-split-label {
  color: var(--color-text-muted);
  font: var(--font-detail);
  white-space: nowrap;
}

/* The line starts on the column's edge, its fill reaching past it under the pointer. */
.dimension-to-table {
  justify-self: start;
  margin-inline-start: calc(-1 * var(--space-2));
}

@container (width >= 48rem) {
  .dimension-pair {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>

<style scoped src="@/pages/analytics/components/readPending.css"></style>
