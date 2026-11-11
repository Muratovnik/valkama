<script setup lang="ts">
/**
 * The bar over every section of the Analytics page: the period, with its two days when it is the
 * reader's own; the filters set, each a chip that takes it out, and the way to add one; how fresh
 * the figures are; and a read of them again. It stays where it is while the rail and the panel
 * under it scroll, since it says what everything under it is of.
 *
 * Adding a filter opens a field per dimension under the bar, each offering every value the period
 * spent, as the filters' own disclosure did before the bar had chips; closed, they stay in the
 * document, as that disclosure's did. A chip names its value as its field does, from one list.
 *
 * How fresh the figures are is the newest record the store holds, of any session, as old as it
 * is now: a page left open says its figures grow old.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { useIntervalFn, useNow } from '@vueuse/core'

import AnalyticsFilters from '@/pages/analytics/components/AnalyticsFilters.vue'
import { useFilterOptions } from '@/pages/analytics/composables/useFilterOptions.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { FilterValues } from '@/pages/analytics/composables/useUsageRead.ts'
import { customDays } from '@/pages/analytics/utils/analyticsPeriod.ts'
import { filterKey } from '@/pages/analytics/utils/usageValues.ts'

import { PERIODS } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView, PeriodPreset } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import { agoWords, spanWordsOf } from '@/shared/lib/timeSpan.ts'
import FieldError from '@/shared/ui/FieldError.vue'
import SearchComboboxChips from '@/shared/ui/SearchComboboxChips.vue'
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
/** Whether the field of each dimension is open under the bar. */
const adding = defineModel<boolean>('adding', { required: true })

const { locale, t } = useI18n()
const words = useSpendingWords()
const { options } = useFilterOptions()
const fieldsId = useId()

const periodOptions = computed(() =>
  PERIODS.map((value) => ({ value, label: t(`analytics.period.${value}`) })),
)

function choosePeriod(period: PeriodPreset) {
  emit('amend', period === 'custom' ? { period, ...customDays(new Date()) } : { period })
}

const rangeError = computed(() =>
  props.view.period === 'custom' &&
  props.view.from &&
  props.view.to &&
  props.view.to < props.view.from
    ? t('analytics.period.reversed')
    : '',
)

/** Each value a filter is set to, named as its field names it, in the dimensions' order. */
const chips = computed(() =>
  props.dimensions.flatMap((dimension) => {
    const values = props.view.filters[dimension] ?? []
    const keys = values.map((value) => filterKey(value))
    const named = options(dimension, props.values[dimension], keys)
    return values.map((value, index) => ({
      dimension,
      value,
      key: `${dimension}:${keys[index]}`,
      label: t('analytics.frame.filter', {
        dimension: words.dimension(dimension),
        value: named.find((option) => option.value === keys[index])?.label ?? value,
      }),
    }))
  }),
)

const chipNames = computed(() => chips.value.map(({ key, label }) => ({ value: key, label })))

function takeOut(index: number) {
  const chip = chips.value[index]
  if (!chip) return
  const kept = (props.view.filters[chip.dimension] ?? []).filter((value) => value !== chip.value)
  emit('filter', chip.dimension, kept)
}

const removeLabel = (label: string) => t('analytics.filters.remove', { label })

const now = useNow({ scheduler: (tick) => useIntervalFn(tick, 60_000) })
/** How fresh the figures are, as words and, where there is one, the moment they stand for. */
const fresh = computed(() => {
  if (props.lastEventAt === undefined) return null
  if (props.lastEventAt === null) return { at: '', words: t('analytics.frame.freshNone'), full: '' }
  const at = Date.parse(props.lastEventAt)
  const ago = agoWords(at, Math.max(now.value.getTime(), at), spanWordsOf(t))
  return {
    at: props.lastEventAt,
    words: t('analytics.frame.fresh', { ago }),
    full: new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
      at,
    ),
  }
})
</script>

<template>
  <div class="analytics-bar">
    <div class="analytics-bar-line">
      <SegmentedControl
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
          @update:model-value="(from) => emit('amend', { from: String(from) })"
        />
        <VTextInput
          class="analytics-day"
          type="date"
          size="compact"
          :label="t('analytics.period.to')"
          :model-value="view.to"
          :max="today"
          :error="rangeError"
          @update:model-value="(to) => emit('amend', { to: String(to) })"
        />
      </div>
      <div class="analytics-bar-filters">
        <SearchComboboxChips
          :chips="chipNames"
          :disabled="false"
          :remove-label="removeLabel"
          @remove="takeOut"
        />
        <VButton
          class="analytics-filter-add"
          variant="ghost"
          size="compact"
          :aria-expanded="adding"
          :aria-controls="fieldsId"
          @click="adding = !adding"
        >
          <VIcon
            name="plus"
            :size="16"
          />
          {{ t('analytics.frame.addFilter') }}
        </VButton>
      </div>
      <div class="analytics-bar-read">
        <p
          v-if="fresh"
          class="analytics-bar-fresh"
        >
          <time
            v-if="fresh.at"
            v-tooltip.detail="fresh.full"
            :datetime="fresh.at"
            >{{ fresh.words }}</time
          >
          <template v-else>
            {{ fresh.words }}
          </template>
        </p>
        <VButton
          class="analytics-refresh"
          size="compact"
          @click="emit('refresh')"
        >
          <VIcon
            name="refresh"
            :size="16"
          />
          {{ t('analytics.frame.refresh') }}
        </VButton>
      </div>
    </div>
    <div
      v-show="adding"
      :id="fieldsId"
      class="analytics-filter-body"
    >
      <AnalyticsFilters
        :dimensions="dimensions"
        :filters="view.filters"
        :values="values"
        @filter="(dimension, chosen) => emit('filter', dimension, chosen)"
      />
      <VButton
        v-if="chips.length"
        class="analytics-filter-clear"
        variant="text"
        size="compact"
        @click="emit('amend', { filters: {} })"
      >
        {{ t('analytics.filters.clear') }}
      </VButton>
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
.analytics-bar {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

/* The period, the filters, the freshness and the read again on one line while they fit; the
   filters take the room left, the freshness and the read again keep to the far end, and the
   line wraps as a narrow window needs. */
.analytics-bar-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  min-width: 0;
}

.analytics-period {
  flex-wrap: wrap;
  max-width: 100%;
}

.analytics-bar-days {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: end;
  min-width: 0;
}

.analytics-day {
  inline-size: 11rem;
}

.analytics-bar-filters {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

.analytics-bar-read {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  margin-inline-start: auto;
}

.analytics-bar-fresh {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.analytics-filter-body {
  display: grid;
  gap: var(--space-3);
}

.analytics-filter-clear {
  justify-self: start;
}
</style>
