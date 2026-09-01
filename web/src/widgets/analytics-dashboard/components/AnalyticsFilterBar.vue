<script setup lang="ts">
/**
 * Choosing the slice of data the dashboard is about.
 *
 * This is a separate concern from presenting the numbers, and it was the last
 * two hundred lines of a file that had already grown past a thousand: the
 * facet options, the applied-filter chips, the disclosure panel and its form.
 * The dashboard now receives a slice and renders it; this decides what it is.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { DashboardFilters, DashboardPayload } from '@/shared/types/analytics.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import VButton from '@/shared/ui/VButton.vue'
import VField from '@/shared/ui/VField.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** What the server says is currently applied; the form follows it. */
  applied: DashboardFilters | null
  facets: DashboardPayload['facets'] | null
}>()
const emit = defineEmits<{ apply: [filters: DashboardFilters] }>()
/**
 * The suffix of the i18n key a filter chip is labelled from.
 *
 * The two date bounds are one field split in the payload and one word in the
 * catalogue, so they are named rather than derived.
 */
const FILTER_LABEL_SUFFIXES: Record<string, string> = { date_from: 'From', date_to: 'To' }
function filterLabelSuffix(key: string): string {
  return FILTER_LABEL_SUFFIXES[key] ?? key[0].toUpperCase() + key.slice(1)
}

const { t } = useI18n()

const filters = reactive<DashboardFilters>({
  epic: null,
  client: null,
  agent: null,
  environment: null,
  tool: null,
  status: null,
  date_from: null,
  date_to: null,
  as_of: null,
})
const open = ref(false)

/** The keys an operator can set here; the rest of the payload's filter shape
 *  is set by the surrounding route, not by this bar. */
const filterKeys = ['agent', 'client', 'environment', 'tool', 'date_from', 'date_to'] as const

const appliedCount = computed(() => filterKeys.filter((key) => Boolean(filters[key])).length)
const applied = computed(() =>
  filterKeys
    .filter((key) => Boolean(filters[key]))
    .map((key) => ({
      key,
      label: t(`dashboard.filter${filterLabelSuffix(key)}`),
      value: String(filters[key]),
    })),
)

function facetOptions(rows: DashboardPayload['facets']['agents']): ChoiceOption[] {
  return [
    { value: '', label: t('scope.all') },
    ...rows.map((facet) => ({
      value: facet.value,
      label: `${facet.label ?? facet.value} (${facet.count})`,
    })),
  ]
}

const agentOptions = computed(() => facetOptions(props.facets?.agents ?? []))
const clientOptions = computed(() => facetOptions(props.facets?.clients ?? []))
const environmentOptions = computed(() => facetOptions(props.facets?.environments ?? []))
const toolOptions = computed(() => facetOptions(props.facets?.tools ?? []))

/**
 * The payload states which filters produced it, so a reload, a shared URL or a
 * filter applied elsewhere is reflected in the form rather than contradicted.
 *
 * Only the keys this form owns are taken. It used to `Object.assign` the whole
 * echo, which carried the server's own `from`/`to` spelling into the state —
 * and since the request serializes every key it is handed while Reset clears
 * only the named ones, Reset left the date range in place and the dashboard
 * came back filtered by a range with no chip to show for it.
 */
watch(
  () => props.applied,
  (next) => {
    for (const key of filterKeys) {
      const value = next?.[key] ?? null
      filters[key] =
        (key === 'date_from' || key === 'date_to') && typeof value === 'string'
          ? value.slice(0, 10)
          : value
    }
  },
  { immediate: true, deep: true },
)

function apply() {
  open.value = false
  emit('apply', { ...filters })
}

function reset() {
  for (const key of filterKeys) filters[key] = null
  apply()
}
</script>

<template>
  <div class="filter-summary">
    <button
      type="button"
      class="filter-toggle"
      aria-controls="analytics-filter-panel"
      :aria-expanded="open"
      @click="open = !open"
    >
      {{ t('dashboard.showFilters', { count: appliedCount }) }}
    </button>
    <span
      v-for="item in applied"
      :key="item.key"
      class="filter-chip"
      ><b>{{ item.label }}</b
      >{{ item.value }}</span
    >
    <button
      v-if="appliedCount"
      type="button"
      class="filter-reset"
      @click="reset"
    >
      {{ t('dashboard.resetFilters') }}
    </button>
  </div>

  <form
    v-if="open"
    id="analytics-filter-panel"
    class="analytics-filters"
    aria-controls="analytics-results"
    :aria-label="t('dashboard.filters')"
    @submit.prevent="apply"
  >
    <VField
      as="div"
      :label="t('dashboard.filterAgent')"
    >
      <SelectionControl
        mode="combobox"
        :model-value="filters.agent ?? ''"
        :options="agentOptions"
        :label="t('dashboard.filterAgent')"
        searchable
        @update:model-value="filters.agent = $event || null"
      />
    </VField>
    <VField
      as="div"
      :label="t('dashboard.filterClient')"
    >
      <SelectionControl
        mode="combobox"
        :model-value="filters.client ?? ''"
        :options="clientOptions"
        :label="t('dashboard.filterClient')"
        @update:model-value="filters.client = $event || null"
      />
    </VField>
    <VField
      as="div"
      :label="t('dashboard.filterEnvironment')"
    >
      <SelectionControl
        mode="combobox"
        :model-value="filters.environment ?? ''"
        :options="environmentOptions"
        :label="t('dashboard.filterEnvironment')"
        searchable
        @update:model-value="filters.environment = $event || null"
      />
    </VField>
    <VField
      as="div"
      :label="t('dashboard.filterTool')"
    >
      <SelectionControl
        mode="combobox"
        :model-value="filters.tool ?? ''"
        :options="toolOptions"
        :label="t('dashboard.filterTool')"
        searchable
        @update:model-value="filters.tool = $event || null"
      />
    </VField>
    <!-- An empty date box is an absent bound, which the payload spells `null`. -->
    <VTextInput
      type="date"
      :model-value="filters.date_from ?? ''"
      :label="t('dashboard.filterFrom')"
      @update:model-value="filters.date_from = $event || null"
    />
    <VTextInput
      type="date"
      :model-value="filters.date_to ?? ''"
      :label="t('dashboard.filterTo')"
      @update:model-value="filters.date_to = $event || null"
    />
    <div class="filter-actions">
      <VButton
        variant="primary"
        type="submit"
        >{{ t('dashboard.applyFilters') }}</VButton
      >
      <VButton @click="reset">{{ t('dashboard.resetFilters') }}</VButton>
    </div>
  </form>
</template>

<style scoped>
.filter-summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin: var(--space-4) 0 var(--space-3);
}

.filter-toggle,
.filter-reset {
  min-height: 44px;
  padding: 0 var(--space-4);
  color: var(--color-text);
  background: var(--color-control-surface);
  border-radius: var(--radius-control);
  cursor: pointer;
}

.filter-reset {
  margin-inline-start: auto;
}

/* The lifted tone belongs to the open state, not to the resting control: an
   always-active fill said "pressed" about a disclosure that was closed. */
.filter-toggle:hover,
.filter-reset:hover,
.filter-toggle[aria-expanded='true'] {
  background: var(--color-surface-active);
}

.filter-chip {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  max-width: 260px;
  min-height: 32px;
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
  background: var(--color-control-surface);
  overflow: hidden;

  b {
    color: var(--color-text);
    font-weight: 600;
  }
}

.analytics-filters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  padding: var(--space-4);
  margin: 0 0 var(--space-4);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}

.filter-actions {
  display: flex;
  grid-column: 1 / -1;
  gap: var(--space-2);
  justify-content: flex-end;
}

/* The panel answers to the width it was given, not the window's. The dashboard
   sits beside a navigation rail that collapses and a drawer that opens, so the
   same viewport hands this panel several different widths. */
@container filters (width < 760px) {
  .analytics-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container filters (width < 520px) {
  .analytics-filters {
    grid-template-columns: 1fr;
  }
}

@container filters (width < 340px) {
  .filter-actions {
    display: grid;
  }

  .filter-reset {
    margin-inline-start: 0;
  }
}
</style>
