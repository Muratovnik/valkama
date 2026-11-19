<script setup lang="ts">
/**
 * The Analytics filter's field, «Add a filter»: the shared field and its menu (`FacetFilter`)
 * over what the filter is over (`useAnalyticsFilter`), a value with a title drawn in its runs.
 *
 * It takes the room its row leaves, as the Work filter's field does, and never less than its
 * words need: «Add a filter», or on a short bar (`short`) its short «Filter» with less air at its
 * ends; below that its row gives up its other parts first. Its menu is as wide as a value's name
 * needs, not the field's width.
 */
import { useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import type { AnalyticsFilter } from '@/pages/analytics/composables/useAnalyticsFilter.ts'

import FacetFilter from '@/shared/ui/FacetFilter.vue'
import { vTextRuns } from '@/shared/ui/textRuns.ts'

defineProps<{
  filter: AnalyticsFilter
  /** The bar is short of room for words: the field's least is its short word's. */
  short: boolean
}>()

const { t } = useI18n()

const field = useTemplateRef<{ focus: () => void }>('field')
defineExpose({ focus: () => field.value?.focus() })
</script>

<template>
  <FacetFilter
    ref="field"
    class="analytics-filter-add"
    :class="{ 'analytics-filter-add-short': short }"
    :text="filter.text.value"
    :chips="filter.chips.value.length"
    :clear-label="t('analytics.filters.clearText')"
    :label="t('analytics.filters.label')"
    :menu-label="t('analytics.filters.menu')"
    :placeholder="t('analytics.frame.addFilter')"
    :short-placeholder="t('analytics.filters.short')"
    :source="filter.source"
    :words="filter.menuWords.value"
    @chips="filter.focusChips"
    @need="filter.need"
    @pick="filter.pick"
    @remove-last="filter.takeOutLast"
    @update:text="filter.type"
  >
    <template #value="{ option }">
      <span
        v-if="option.runs"
        v-text-runs="option.runs"
      />
      <template v-else>{{ option.text }}</template>
    </template>
  </FacetFilter>
</template>

<style scoped>
.analytics-filter-add {
  --size-facet-filter-menu-width: 24rem;

  min-inline-size: 11rem;
}

.analytics-filter-add-short {
  --space-text-input-inline: var(--space-1);

  min-inline-size: 3.88rem;
}
</style>
