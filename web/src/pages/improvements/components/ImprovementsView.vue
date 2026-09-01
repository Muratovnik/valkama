<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ImprovementJobs from '@/pages/improvements/components/ImprovementJobs.vue'
import ImprovementReadiness from '@/pages/improvements/components/ImprovementReadiness.vue'
import { useImprovementsRuntime } from '@/pages/improvements/composables/useImprovementsRuntime.ts'

import ImprovementCaseDetail from '@/widgets/improvement-case/components/ImprovementCaseDetail.vue'
import ImprovementCaseList from '@/widgets/improvement-case/components/ImprovementCaseList.vue'

import ImprovementProfileDialog from '@/features/improvement-profile/components/ImprovementProfileDialog.vue'

import type { ImprovementState } from '@/entities/improvement/utils/improvementDerivations'

import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    active?: boolean
    scope?: string
    status?: string
  }>(),
  { active: true, scope: 'personal', status: '' },
)
const emit = defineEmits<{
  state: [state: Record<string, string>]
}>()
const { t } = useI18n()

const {
  action,
  activation,
  busy,
  canAnalyze,
  cancelJob,
  cancellingJobId,
  cases,
  evaluate,
  jobs,
  message,
  operationError,
  profile,
  retryLoad,
  runNow,
  saveProfile,
  saving,
  select,
  selected,
  settingsOpen,
  signalSummary,
  state,
  visibleJobs,
} = useImprovementsRuntime({ active: () => props.active, scope: () => props.scope })

const listState = computed(() => props.status as ImprovementState | '')

/** Which client would run the analysis, and how it is configured. */
const runtimeSummary = computed(() => {
  const current = profile.value
  if (!current) return ''
  const client = current.analyzer_client === 'claude' ? 'Claude Code' : 'Codex'
  const configured = [current.analyzer_model, current.reasoning_effort].filter(Boolean)
  return [client, ...(configured.length ? configured : [t('improvements.clientDefault')])].join(
    ' · ',
  )
})

/** Whether the analyzer is switched on, and the runtime that would run it, on one line. */
const runtimeLine = computed(() =>
  [
    profile.value?.enabled ? t('improvements.enabled') : t('improvements.disabled'),
    runtimeSummary.value,
  ].join(' · '),
)

/** An empty filter drops the key from the URL rather than writing an empty one into it. */
function emitStatusFilter(status: string) {
  emit('state', status ? { status } : {})
}
</script>

<template>
  <section
    v-if="active"
    class="improvements-view"
    :aria-label="t('improvements.title')"
  >
    <PlatformStatePanel
      :state="state"
      @retry="retryLoad"
    >
      <div
        v-if="state.status === 'degraded' && state.reason"
        class="improvements-recovery"
      >
        <VButton @click="retryLoad">{{ t('improvements.retry') }}</VButton>
      </div>

      <!-- The context bar names the module and states what it is for. What
           belongs at the top of the page itself is what the operator can do here
           and the runtime that would do it. -->
      <header
        v-if="profile"
        class="improvements-head"
      >
        <p class="improvements-runtime">{{ runtimeLine }}</p>
        <div class="improvements-commands">
          <VButton
            variant="primary"
            :disabled="busy || !canAnalyze"
            @click="runNow"
          >
            <VIcon
              name="play"
              :size="18"
            />
            {{ t('improvements.runNow') }}
          </VButton>
          <VButton
            :aria-label="t('improvements.settingsTitle')"
            :title="t('improvements.settingsTitle')"
            @click="settingsOpen = true"
          >
            <VIcon
              name="settings"
              :size="18"
            />
          </VButton>
        </div>
      </header>

      <p
        v-if="message"
        class="improvements-note success"
        role="status"
      >
        {{ message }}
      </p>
      <p
        v-if="operationError"
        class="improvements-note danger"
        role="alert"
      >
        {{ operationError }}
      </p>

      <ImprovementJobs
        v-if="profile"
        :jobs="visibleJobs"
        :cancelling-job-id="cancellingJobId"
        @cancel="cancelJob"
      />

      <ImprovementReadiness
        v-if="profile && activation"
        :activation="activation"
        :signal-summary="signalSummary"
      />

      <div
        v-if="profile"
        class="improvements-grid"
      >
        <ImprovementCaseList
          :cases="cases"
          :selected-id="selected?.id"
          :state="listState"
          @select="select"
          @state="emitStatusFilter"
        />
        <ImprovementCaseDetail
          :key="`${scope}:${selected?.id ?? 'none'}`"
          :item="selected"
          :jobs="jobs"
          :busy="busy"
          @action="action"
          @evaluate="evaluate"
        />
      </div>
    </PlatformStatePanel>

    <ImprovementProfileDialog
      :open="settingsOpen"
      :profile="profile"
      :saving="saving"
      @close="settingsOpen = false"
      @save="saveProfile"
    />
  </section>
</template>

<style scoped>
.improvements-view {
  min-width: 0;
  color: var(--color-text);
}

.improvements-head {
  display: flex;
  gap: var(--space-6);
  justify-content: space-between;
  align-items: center;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-rule);
}

.improvements-commands {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-2);
  align-items: stretch;
}

.improvements-runtime {
  max-width: 72ch;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.improvements-recovery {
  display: flex;
  justify-content: flex-end;
  padding: var(--space-3) 0 0;
}

.improvements-note {
  display: flex;
  gap: var(--space-4);
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3);
  margin-top: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
  border-radius: var(--radius-control);

  /* Outcome reads from the text and a 3px marker. A tinted panel spends a whole
     surface on a state the sentence already carries, and two of them on one
     screen is what makes a dense board flicker. */
  &.success {
    border-inline-start: 3px solid var(--color-success);
    color: var(--color-success);
  }

  &.danger {
    border-inline-start: 3px solid var(--color-danger);
    color: var(--color-danger);
  }
}

.improvements-grid {
  display: grid;
  grid-template-columns: minmax(300px, 0.7fr) minmax(0, 1.6fr);
  gap: var(--space-4);
  margin-top: var(--space-3);
}

@container workspace (width <= 790px) {
  .improvements-grid {
    grid-template-columns: 1fr;
  }
}

@container workspace (width <= 636px) {
  .improvements-head {
    display: grid;
  }

  .improvements-runtime {
    text-align: left;
  }
}
</style>
