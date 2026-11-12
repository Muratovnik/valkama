<script setup lang="ts">
/**
 * A filter per dimension: the values that spent anything in the period, and «none» as the read
 * admits it — work on no task, a session's own run, a value nobody can place — except for the
 * role, which every stretch has. Choosing several admits any of them; the filters of different
 * dimensions all apply. Each is a field of chips, typed into to find a value.
 *
 * A value the period did not spend, as one a pasted link names, stays chosen under its id: the
 * filter still applies, and taking it out is one press.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useFilterOptions } from '@/pages/analytics/composables/useFilterOptions.ts'
import { useReadWaitReport } from '@/pages/analytics/composables/useReadWaits.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { FilterValues } from '@/pages/analytics/composables/useUsageRead.ts'
import { filterKey, filterValue } from '@/pages/analytics/utils/usageValues.ts'

import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import type { UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'

const props = defineProps<{
  dimensions: readonly UsageDimension[]
  filters: UsageFilters
  values: Partial<Record<UsageDimension, FilterValues>>
}>()
const emit = defineEmits<{ filter: [dimension: UsageDimension, values: (string | null)[]] }>()

const { t } = useI18n()
const words = useSpendingWords()
const { options } = useFilterOptions()

const chosen = (dimension: UsageDimension) =>
  (props.filters[dimension] ?? []).map((value) => filterKey(value))

const removeLabel = (label: string) => t('analytics.filters.remove', { label })

/**
 * A dimension's values are waited for while they are read. Only a dimension with an active filter
 * is read at all (`useUsageRead`), so an unread one is not waiting: it is never a wait to announce.
 */
const waiting = (dimension: UsageDimension) => props.values[dimension] === 'loading'

/**
 * Each dimension's wait, shown by its field once it has lasted (`useLoadingPresence`). Made for
 * every dimension at once, because a field may be drawn for any of them.
 */
const waits = Object.fromEntries(
  USAGE_DIMENSIONS.map((dimension) => [dimension, useLoadingPresence(() => waiting(dimension))]),
) as Record<UsageDimension, ReturnType<typeof useLoadingPresence>>

/** Whether a field's values are shown as waiting: the page says the word once for all of them. */
useReadWaitReport(
  computed(() => props.dimensions.some((dimension) => waits[dimension].shown.value)),
)

function emptyLabel(dimension: UsageDimension) {
  if (waits[dimension].shown.value) return t('platform.states.loading')
  if (waiting(dimension)) return ''
  if (props.values[dimension] === 'failed') return t('analytics.filters.failed')
  return t('analytics.filters.noMatches')
}

/** One field per dimension: its name, what it holds and what it offers. */
const fields = computed(() =>
  props.dimensions.map((dimension) => ({
    dimension,
    label: words.dimension(dimension),
    chosen: chosen(dimension),
    options: options(dimension, props.values[dimension], chosen(dimension)),
    emptyLabel: emptyLabel(dimension),
  })),
)

function choose(dimension: UsageDimension, keys: string[]) {
  emit(
    'filter',
    dimension,
    [...new Set(keys)].map((key) => filterValue(key)),
  )
}
</script>

<template>
  <div class="analytics-filters">
    <SearchCombobox
      v-for="field in fields"
      :key="field.dimension"
      :data-dimension="field.dimension"
      :label="field.label"
      :model-value="field.chosen"
      :options="field.options"
      :empty-label="field.emptyLabel"
      :placeholder="t('analytics.filters.any')"
      :remove-label="removeLabel"
      @update:model-value="(keys) => choose(field.dimension, keys)"
    />
  </div>
</template>

<style scoped>
/* As many fields to a line as fit at a readable width, each line's fields one width. */
.analytics-filters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
  gap: var(--space-3);
  align-items: start;
}
</style>
