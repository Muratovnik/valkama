<script setup lang="ts">
/**
 * Where the usage of agent work is read: time, tokens and an estimated API cost.
 *
 * Nothing collects usage yet, so the page has no read of its own and stands in its empty
 * state, which says that rather than drawing numbers or a chart it does not have. The
 * reading that fills it hands its state in through `state`; loading and failure are the
 * product's shared state panel, so the page gains them without a word of its own.
 */
import { useI18n } from 'vue-i18n'

import { reportAnalyticsUse } from '@/shared/api/analyticsUses.ts'
import { uiEmpty } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

withDefaults(defineProps<{ state?: PlatformUiState<never> }>(), {
  state: () => uiEmpty<never>('analytics.empty.title'),
})
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
// Once per opening: the stage sets this page up each time it is navigated to.
reportAnalyticsUse('page_open')
</script>

<template>
  <section
    class="analytics-page"
    :aria-label="t('analytics.title')"
  >
    <PlatformStatePanel
      :state="state"
      :empty-description="t('analytics.empty.description')"
      @retry="emit('retry')"
    />
  </section>
</template>

<style scoped>
.analytics-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  color: var(--color-text);
}
</style>
