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

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { FilterValues } from '@/pages/analytics/composables/useUsageRead.ts'
import { filterKey, filterValue, valueKey } from '@/pages/analytics/utils/usageValues.ts'

import type { UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'

const props = defineProps<{
  dimensions: readonly UsageDimension[]
  filters: UsageFilters
  values: Partial<Record<UsageDimension, FilterValues>>
}>()
const emit = defineEmits<{ filter: [dimension: UsageDimension, values: (string | null)[]] }>()

const { t } = useI18n()
const words = useSpendingWords()

const chosen = (dimension: UsageDimension) =>
  (props.filters[dimension] ?? []).map((value) => filterKey(value))

const removeLabel = (label: string) => t('analytics.filters.remove', { label })

function options(dimension: UsageDimension): ChoiceOption[] {
  const read = props.values[dimension]
  const found = Array.isArray(read)
    ? read.flatMap((row) => {
        const value = row.group[dimension]
        return !value || value.id === null
          ? []
          : [{ value: valueKey(value), label: words.valueLabel(dimension, value) }]
      })
    : []
  const none = words.noneLabel(dimension)
  const offered = [...(none === null ? [] : [{ value: filterKey(null), label: none }]), ...found]
  const known = new Set(offered.map((option) => option.value))
  const kept = chosen(dimension)
    .filter((key) => !known.has(key))
    .map((key) => ({ value: key, label: filterValue(key) ?? key }))
  return [...offered, ...kept]
}

function emptyLabel(dimension: UsageDimension) {
  const read = props.values[dimension]
  if (read === 'loading' || read === undefined) return t('analytics.filters.reading')
  if (read === 'failed') return t('analytics.filters.failed')
  return t('analytics.filters.noMatches')
}

/** One field per dimension: its name, what it holds and what it offers. */
const fields = computed(() =>
  props.dimensions.map((dimension) => ({
    dimension,
    label: words.dimension(dimension),
    chosen: chosen(dimension),
    options: options(dimension),
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
