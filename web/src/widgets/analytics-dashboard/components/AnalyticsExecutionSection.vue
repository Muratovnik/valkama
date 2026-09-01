<script setup lang="ts">
/**
 * What was attempted at this space's work, and how much of it anyone measured.
 *
 * The dashboard could not answer this at all before attempts were a record: it
 * counted work items, their state intervals and the tool events sessions
 * reported, and never how many runs were made at any of it or what they cost.
 *
 * Coverage is a line of its own rather than a footnote, because it is the half
 * that makes the totals readable. Twelve attempts of which two had a journal is
 * a different fact from twelve that all did, and a strip of figures with no
 * such line invites the reader to treat the second as the first.
 *
 * And the coverage line still cannot say *which* two. That is what the way to
 * the rows is for: every figure here opens the attempts behind it, each naming
 * its work item, how it ended, and who answered for its numbers.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import DataTableTrigger from '@/widgets/analytics-dashboard/components/DataTableTrigger.vue'
import { analyticsFormatters } from '@/widgets/analytics-dashboard/utils/analyticsFormat.ts'

import type { DashboardPayload } from '@/shared/types/analytics.ts'

const props = defineProps<{ executions: DashboardPayload['executions'] }>()

const emit = defineEmits<{ 'open-table': [key: 'executions'] }>()

const { t } = useI18n()
const { value, duration } = analyticsFormatters(t)

/** Statuses in the order an attempt passes through them, ending first. */
const ORDER = [
  'complete',
  'partial',
  'refused',
  'failed',
  'cancelled',
  'attached',
  'running',
  'starting',
] as const

const statuses = computed(() => {
  const counted = new Map(props.executions.statuses.map((entry) => [entry.name, entry.attempts]))
  return ORDER.filter((name) => counted.has(name)).map((name) => ({
    name,
    label: t(`execution.status.${name}`),
    attempts: counted.get(name) ?? 0,
  }))
})

/** Total tokens, or nothing. A dash is the honest rendering of an unknown. */
const tokens = computed(() => {
  const total = props.executions.tokens.total.value
  const output = props.executions.tokens.output.value
  return total ?? output
})

const tools = computed(() => props.executions.tools.slice(0, 5))
</script>

<template>
  <div class="execution-analytics">
    <dl
      class="metric-ledger"
      :aria-label="t('dashboard.attempts')"
    >
      <div class="metric-cell metric-primary">
        <dt class="metric-label">{{ t('dashboard.attempts') }}</dt>
        <dd class="metric-figure">{{ value(executions.attempts) }}</dd>
        <small class="metric-basis">{{
          t('dashboard.attemptsEnded', { ended: executions.ended })
        }}</small>
      </div>
      <div class="metric-cell">
        <dt class="metric-label">{{ t('dashboard.delivered') }}</dt>
        <dd class="metric-figure">{{ value(executions.delivered) }}</dd>
        <small class="metric-basis">{{
          t('dashboard.deliveredBasis', { ended: executions.ended })
        }}</small>
      </div>
      <div class="metric-cell">
        <dt class="metric-label">{{ t('dashboard.agentTime') }}</dt>
        <dd class="metric-figure">{{ duration(executions.execution_wall_time.seconds) }}</dd>
        <small class="metric-basis">{{
          t('dashboard.observed', { count: executions.execution_wall_time.observed })
        }}</small>
      </div>
      <div class="metric-cell">
        <dt class="metric-label">{{ t('dashboard.tokens') }}</dt>
        <dd class="metric-figure">{{ value(tokens) }}</dd>
        <small class="metric-basis">{{
          t('dashboard.observed', { count: executions.observed_attempts })
        }}</small>
      </div>
    </dl>

    <p class="execution-coverage">
      {{
        t('dashboard.attemptCoverage', {
          tokens: t(`usage.coverageState.${executions.tokens_coverage}`),
          time: t(`usage.coverageState.${executions.execution_wall_time.coverage}`),
        })
      }}
      <span v-if="executions.truncated"> · {{ t('dashboard.attemptsTruncated') }}</span>
    </p>

    <DataTableTrigger @open="emit('open-table', 'executions')" />

    <div class="execution-lists">
      <section
        class="execution-list"
        :aria-label="t('dashboard.attemptOutcomes')"
      >
        <h3 class="list-title">{{ t('dashboard.attemptOutcomes') }}</h3>
        <p
          v-if="!statuses.length"
          class="list-empty"
        >
          {{ t('dashboard.noAttempts') }}
        </p>
        <dl
          v-else
          class="list-rows"
        >
          <div
            v-for="entry in statuses"
            :key="entry.name"
            class="list-row"
          >
            <dt class="row-name">{{ entry.label }}</dt>
            <dd class="row-count">{{ entry.attempts }}</dd>
          </div>
        </dl>
      </section>

      <section
        class="execution-list"
        :aria-label="t('dashboard.attemptTools')"
      >
        <h3 class="list-title">{{ t('dashboard.attemptTools') }}</h3>
        <p
          v-if="!tools.length"
          class="list-empty"
        >
          {{ t('dashboard.noAttemptTools') }}
        </p>
        <dl
          v-else
          class="list-rows"
        >
          <div
            v-for="entry in tools"
            :key="`${entry.server}-${entry.name}`"
            class="list-row"
          >
            <dt class="row-name">{{ entry.name }}</dt>
            <dd class="row-count">
              {{ entry.calls }}
              <span
                v-if="entry.errors"
                class="row-errors"
                >· {{ t('dashboard.attemptToolErrors', { errors: entry.errors }) }}</span
              >
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </div>
</template>

<style scoped>
.execution-analytics {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}

.metric-ledger {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: var(--space-4);
  margin: 0;
}

.metric-cell {
  display: grid;
  gap: var(--space-hair);
  min-width: 0;
}

.metric-label {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.metric-figure {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-figure);
  font-variant-numeric: tabular-nums;
}

.metric-basis {
  color: var(--color-text-tertiary);
  font: var(--font-chrome);
}

.execution-coverage {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.execution-lists {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--space-5);
  min-width: 0;
}

.execution-list {
  min-width: 0;
}

.list-title {
  margin: 0 0 var(--space-2);
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.list-empty {
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.list-rows {
  display: grid;
  gap: var(--space-1);
  margin: 0;
}

.list-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: baseline;
}

.row-name {
  color: var(--color-text);
  font: var(--font-line);
  overflow-wrap: anywhere;
}

.row-count {
  margin: 0;
  color: var(--color-text);
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
}

.row-errors {
  color: var(--color-warning);
  font: var(--font-detail);
}
</style>
