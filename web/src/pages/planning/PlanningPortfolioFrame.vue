<script setup lang="ts">
/**
 * Every space, to choose where to work.
 *
 * It is the page of «All spaces», and it is also the answer to an address that
 * names a space this workstation does not have: that address can never load,
 * so instead of a panel offering «Retry», the page says which space is
 * missing and lays out the ones that exist, each a click away.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import PlanningPortfolio from '@/pages/planning/PlanningPortfolio.vue'

import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformPlanningReady } from '@/shared/api/platformPlanningTypes.ts'
import { uiUnavailable } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const props = defineProps<{
  portfolio: PlatformUiState<PlatformPlanningReady>
  /** The key of the space the address named and this workstation does not have. */
  missingSpace?: string | null
}>()
const emit = defineEmits<{ 'open-space': [space: PlanningSpaceRef]; 'retry': [] }>()
const { t } = useI18n()

const missingState = computed(() =>
  props.missingSpace
    ? uiUnavailable(t('platform.planning.spaceMissing', { space: props.missingSpace }))
    : null,
)
</script>

<template>
  <main
    class="planning-frame"
    tabindex="-1"
    data-scroll-owner="planning-portfolio"
    :aria-label="t('platform.modules.planning')"
  >
    <div class="planning-frame-content">
      <div
        v-if="missingState"
        class="planning-missing-space"
      >
        <PlatformStatePanel
          :state="missingState"
          :retryable="false"
        />
      </div>
      <PlatformStatePanel
        :state="portfolio"
        :empty-description="t('platform.planning.noSpacesDetail')"
        @retry="emit('retry')"
      >
        <template #default="{ payload }">
          <PlanningPortfolio
            :spaces="payload.spaces"
            @open-space="(space) => emit('open-space', space)"
          />
        </template>
      </PlatformStatePanel>
    </div>
  </main>
</template>

<style scoped src="./planning-frame.css"></style>
