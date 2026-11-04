<script setup lang="ts">
/**
 * Every project and its spaces, to choose where to work.
 *
 * It is the global scope's page, and it is also the answer to an address that
 * names a project this workstation does not have: that address can never load,
 * so instead of a panel offering «Retry», the page says which project is
 * missing and lays out the ones that exist, each a click away.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import PlanningPortfolio from '@/pages/planning/PlanningPortfolio.vue'

import type { PlatformPlanningReady } from '@/shared/api/platformPlanningTypes.ts'
import { uiUnavailable } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const props = defineProps<{
  portfolio: PlatformUiState<PlatformPlanningReady>
  /** The project the address named and this workstation does not have. */
  missingProject?: string | null
}>()
const emit = defineEmits<{ 'open-project': [projectId: string]; 'retry': [] }>()
const { t } = useI18n()

const missingState = computed(() =>
  props.missingProject
    ? uiUnavailable(t('platform.planning.projectMissing', { project: props.missingProject }))
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
      <PlatformStatePanel
        v-if="missingState"
        class="planning-missing-project"
        :state="missingState"
        :retryable="false"
      />
      <PlatformStatePanel
        :state="portfolio"
        :empty-description="t('platform.planning.noSpacesDetail')"
        @retry="emit('retry')"
      >
        <template #default="{ payload }">
          <PlanningPortfolio
            :projects="payload.projects"
            @open-project="(id) => emit('open-project', id)"
          />
        </template>
      </PlatformStatePanel>
    </div>
  </main>
</template>

<style scoped src="./planning-frame.css"></style>
