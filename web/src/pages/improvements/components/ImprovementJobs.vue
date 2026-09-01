<script setup lang="ts">
/**
 * What the analyzer is doing now, as a strip that scrolls sideways.
 *
 * A job is a transient: it appears, runs and disappears, so it gets a lane of its
 * own beside the count rather than a column in the page's grid. Only a job the
 * server says is cancellable shows the control, and only one cancellation is in
 * flight at a time — the id of that one is what disables the rest.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ImprovementJob } from '@/entities/improvement/utils/improvementDerivations'
import { canCancelImprovementJob } from '@/entities/improvement/utils/improvementDerivations'

import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ cancellingJobId: number | null; jobs: ImprovementJob[] }>()
const emit = defineEmits<{ cancel: [job: ImprovementJob] }>()
const { t } = useI18n()

/** One cancellation at a time, so while any job is being cancelled none can start. */
const cancelling = computed(() => props.cancellingJobId !== null)

/** The button says what a click will do, and keeps saying it while the click is in flight. */
function cancelLabel(job: ImprovementJob) {
  return props.cancellingJobId === job.id ? t('improvements.cancelling') : t('improvements.cancel')
}
</script>

<template>
  <section
    class="jobs-panel"
    :aria-label="t('improvements.jobs')"
  >
    <header class="jobs-head">
      <div>
        <SectionHeading>{{ t('improvements.jobs') }}</SectionHeading>
      </div>
      <strong class="jobs-count">{{ jobs.length }}</strong>
    </header>
    <p
      v-if="!jobs.length"
      class="jobs-empty"
    >
      {{ t('improvements.noJobs') }}
    </p>
    <ol
      v-else
      class="jobs-scroll"
    >
      <li
        v-for="job in jobs"
        :key="job.id"
        class="job-row"
      >
        <span class="job-identity">
          <strong class="job-name">#{{ job.id }} · {{ t(`improvements.kind.${job.kind}`) }}</strong>
          <SemanticState
            dimension="job"
            :state="job.state"
            :label="t(`improvements.state.${job.state}`)"
          />
        </span>
        <div class="job-actions">
          <span class="job-client">{{ job.client }}</span>
          <VButton
            v-if="canCancelImprovementJob(job)"
            variant="danger"
            :disabled="cancelling"
            @click="emit('cancel', job)"
          >
            {{ cancelLabel(job) }}
          </VButton>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.jobs-panel {
  display: flex;
  min-width: 0;
  margin-top: var(--space-4);
  background: var(--color-surface);
  overflow: hidden;
  border-radius: var(--radius-card);
}

.jobs-head {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: center;
  width: 160px;
  padding: var(--space-3) var(--space-4);
  border-right: 1px solid var(--color-rule);
}

.jobs-count {
  color: var(--color-action-primary);
  font-size: var(--font-size-module);
}

.jobs-empty {
  align-self: center;
  padding: var(--space-3) var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.jobs-scroll {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-color: var(--color-rule-strong) transparent;
  scrollbar-width: thin;
}

.job-row {
  display: grid;
  flex: 0 0 auto;
  gap: var(--space-2);
  align-content: center;
  width: 230px;
  padding: var(--space-3) var(--space-4);
  border-right: 1px solid var(--color-rule);
}

.job-identity {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
  align-items: center;
  min-width: 0;
}

.job-name {
  font-size: var(--font-size-dense);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.job-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
  align-items: center;
  min-height: var(--size-control-height-compact);
}

.job-client {
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Narrow enough and the strip stops being a strip: the count moves above the
   lane instead of beside it. */
@container workspace (width <= 636px) {
  .jobs-panel {
    display: grid;
  }

  .jobs-head {
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid var(--color-rule);
  }
}
</style>
