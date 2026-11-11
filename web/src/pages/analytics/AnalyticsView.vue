<script setup lang="ts">
/**
 * What agent work was spent on in a period, and how that changed from the period before.
 *
 * One fixed view. Its controls — the period, the dimension the charts break work down by and a
 * filter per dimension — are the page's address: every change is written there, and a reload
 * or a pasted link reads the same view back. The read is asked in the browser's own time, so a
 * day starts at the reader's midnight. While it is read the page waits, fails and stands empty
 * through the product's shared state panel; the controls stay above it in every state, since
 * changing the period is how an empty one is left.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AnalyticsFilters from '@/pages/analytics/components/AnalyticsFilters.vue'
import SpendingReport from '@/pages/analytics/components/SpendingReport.vue'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { useUsageRead } from '@/pages/analytics/composables/useUsageRead.ts'
import { customDays } from '@/pages/analytics/utils/analyticsPeriod.ts'

import {
  localDay,
  orderFilters,
  PERIODS,
  readAddress,
  writeAddress,
} from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView, PeriodPreset } from '@/shared/api/analyticsAddress.ts'
import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import { reportAnalyticsUse } from '@/shared/api/analyticsUses.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'
import VDisclosure from '@/shared/ui/VDisclosure.vue'
import VField from '@/shared/ui/VField.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = withDefaults(
  defineProps<{
    /** The project the page is scoped to; every figure is that project's. */
    projectId?: string | null
    /** The module's part of the address: what `writeAddress` wrote, or nothing. */
    routeState?: Readonly<Record<string, string | number | boolean>>
  }>(),
  { routeState: undefined, projectId: null },
)
const emit = defineEmits<{ state: [state: Record<string, string | number | boolean>] }>()

const { t } = useI18n()
// Once per opening: the stage sets this page up each time it is navigated to.
reportAnalyticsUse('page_open')
const words = useSpendingWords()

const view = computed(() => readAddress(props.routeState))

function change(next: Partial<AnalyticsView>) {
  emit('state', writeAddress({ ...view.value, ...next }))
}

const read = useUsageRead({ view: () => view.value, projectId: () => props.projectId })

const periodOptions = computed(() =>
  PERIODS.map((value) => ({ value, label: t(`analytics.period.${value}`) })),
)

function choosePeriod(period: PeriodPreset) {
  change(period === 'custom' ? { period, ...customDays(new Date()) } : { period })
}

const today = computed(() => localDay(read.askedAt.value))
const rangeError = computed(() =>
  view.value.period === 'custom' &&
  view.value.from &&
  view.value.to &&
  view.value.to < view.value.from
    ? t('analytics.period.reversed')
    : '',
)

/** The dimensions a person filters on: at a project's scope its project is already chosen. */
const filterDimensions = computed<UsageDimension[]>(() =>
  USAGE_DIMENSIONS.filter((dimension) => !(props.projectId && dimension === 'project')),
)

const byOptions = computed(() =>
  filterDimensions.value.map((value) => ({ value, label: words.dimension(value) })),
)

function chooseBy(value: string) {
  const by = filterDimensions.value.find((dimension) => dimension === value)
  if (by) change({ by })
}

const filterCount = computed(
  () => filterDimensions.value.filter((dimension) => view.value.filters[dimension]?.length).length,
)
const filtersTitle = computed(() =>
  filterCount.value
    ? t('analytics.filters.titleCount', { count: filterCount.value })
    : t('analytics.filters.title'),
)
const filtersOpen = ref(false)
watch(
  [filtersOpen, () => read.bounds.value],
  ([open]) => {
    if (open) void read.offer(filterDimensions.value)
  },
  { immediate: true },
)

function filter(dimension: UsageDimension, values: (string | null)[]) {
  change({ filters: orderFilters({ ...view.value.filters, [dimension]: values }) })
}

const emptyDescription = computed(() =>
  read.bounds.value ? t('analytics.empty.description') : t('analytics.period.incomplete'),
)
</script>

<template>
  <section
    class="analytics-page"
    :aria-label="t('analytics.title')"
  >
    <div class="analytics-controls">
      <VField
        as="div"
        :label="t('analytics.period.label')"
      >
        <SegmentedControl
          class="analytics-period"
          size="compact"
          :label="t('analytics.period.label')"
          :model-value="view.period"
          :options="periodOptions"
          @update:model-value="choosePeriod"
        />
      </VField>
      <template v-if="view.period === 'custom'">
        <VTextInput
          class="analytics-day"
          type="date"
          size="compact"
          :label="t('analytics.period.from')"
          :model-value="view.from"
          :max="today"
          @update:model-value="(from) => change({ from: String(from) })"
        />
        <VTextInput
          class="analytics-day"
          type="date"
          size="compact"
          :label="t('analytics.period.to')"
          :model-value="view.to"
          :max="today"
          :error="rangeError"
          @update:model-value="(to) => change({ to: String(to) })"
        />
      </template>
      <VField
        as="div"
        :label="t('analytics.by')"
      >
        <ChoiceSelect
          size="compact"
          :label="t('analytics.by')"
          :model-value="view.by"
          :options="byOptions"
          @update:model-value="chooseBy"
        />
      </VField>
    </div>

    <VDisclosure v-model:open="filtersOpen">
      <template #summary>
        {{ filtersTitle }}
      </template>
      <div class="analytics-filter-body">
        <AnalyticsFilters
          :dimensions="filterDimensions"
          :filters="view.filters"
          :values="read.filterValues.value"
          @filter="filter"
        />
        <VButton
          v-if="filterCount"
          class="analytics-filter-clear"
          variant="text"
          size="compact"
          @click="change({ filters: {} })"
        >
          {{ t('analytics.filters.clear') }}
        </VButton>
      </div>
    </VDisclosure>

    <PlatformStatePanel
      :state="read.state.value"
      :empty-description="emptyDescription"
      @retry="read.retry"
    >
      <template #default="{ payload }">
        <SpendingReport
          :usage="payload"
          :accounts="read.accounts.value"
          :read-at="read.askedAt.value"
          :measure="view.measure"
          @update:measure="(measure) => change({ measure })"
          @retry="read.retry"
        />
      </template>
    </PlatformStatePanel>
  </section>
</template>

<style scoped>
.analytics-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-5);
  min-width: 0;
  color: var(--color-text);
}

/* The period and the breakdown on one line of labelled fields, their controls on one edge,
   wrapping to as many lines as a narrow page needs. */
.analytics-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-5);
  align-items: end;
  min-width: 0;
}

.analytics-period {
  flex-wrap: wrap;
  max-width: 100%;
}

.analytics-day {
  inline-size: 11rem;
}

.analytics-filter-body {
  display: grid;
  gap: var(--space-3);
}

.analytics-filter-clear {
  justify-self: start;
}
</style>
