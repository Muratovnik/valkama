<script setup lang="ts">
/**
 * The row of the Analytics filter's chips (`useAnalyticsFilter`): each value a filter is set to, a
 * chip that takes it out (`FacetFilterChips`), and «Clear filters» at their end, the way the Work
 * bar ends the line under its row with the way out of its filter. With no filter set it holds
 * nothing and takes no room. The bar places it: under its line, or on a phone right under the
 * field.
 *
 * It stays while the chips come and go, so the chip after the last one taken out can hand the
 * focus back to the field.
 */
import { useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import type { AnalyticsFilter } from '@/pages/analytics/composables/useAnalyticsFilter.ts'

import FacetFilterChips from '@/shared/ui/FacetFilterChips.vue'
import VButton from '@/shared/ui/VButton.vue'

defineProps<{
  filter: AnalyticsFilter
}>()

const { t } = useI18n()

const list = useTemplateRef<{ focusLast: () => boolean }>('list')

defineExpose({ focusLast: () => list.value?.focusLast() ?? false })
</script>

<template>
  <div class="analytics-chip-row">
    <FacetFilterChips
      ref="list"
      :chips="filter.chips.value"
      :label="t('analytics.filters.chips')"
      @leave="filter.focusField"
      @remove="filter.takeOut"
    />
    <VButton
      v-if="filter.chips.value.length"
      size="inline"
      variant="ghost"
      @click="filter.clear"
      >{{ t('analytics.filters.clear') }}</VButton
    >
  </div>
</template>

<style scoped>
/* One line of chips, wrapping where it has no room for them, the way out at its end. */
.analytics-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  min-inline-size: 0;

  &:empty {
    display: none;
  }
}
</style>
