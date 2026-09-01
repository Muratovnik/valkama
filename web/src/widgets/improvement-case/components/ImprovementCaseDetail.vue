<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import EvaluationRequestForm from '@/widgets/improvement-case/components/EvaluationRequestForm.vue'
import ImprovementEvidence from '@/widgets/improvement-case/components/ImprovementEvidence.vue'

import ImprovementStatusBadge from '@/entities/improvement/components/ImprovementStatusBadge.vue'
import type {
  ImprovementAction,
  ImprovementCase,
  ImprovementJob,
  ImprovementJobState,
} from '@/entities/improvement/utils/improvementDerivations'
import {
  allowedActions,
  IMPROVEMENT_ACTIONS,
  improvementEvaluationState,
  improvementMonitoringAgeDays,
} from '@/entities/improvement/utils/improvementDerivations'

import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  item: ImprovementCase | null
  jobs: readonly ImprovementJob[]
  busy?: boolean
}>()
const emit = defineEmits<{
  action: [
    action: ImprovementAction,
    options: {
      expected_revision?: number
      reason?: string
      signal_ids?: number[]
      snooze_until?: string | null
      target_case_id?: number | null
    },
  ]
  evaluate: [phase: 'baseline' | 'candidate', repo: string, git_ref: string]
}>()
const { t } = useI18n()
const reason = ref('')
const target = ref<number | null>(null)
const snooze = ref('')
const signalIds = ref('')
const actions = computed(() => (props.item ? allowedActions(props.item.state) : []))
const scenarioCount = computed(() => props.item?.evaluation_pack?.scenarios?.length ?? 0)
const assertionCount = computed(() => props.item?.evaluation_pack?.assertions?.length ?? 0)
const evaluationRuns = computed(() =>
  (props.item?.eval_runs ?? []).map((run) => ({
    run,
    state: improvementEvaluationState(run, props.jobs),
  })),
)
const monitoringDays = computed(() => improvementMonitoringAgeDays(props.item?.monitoring ?? null))
/** Whether this action is one the case's current state allows. */
/** An empty field means no target card, which is null rather than a zero. */
function setTarget(value: string) {
  target.value = value ? Number(value) : null
}

function allows(action: ImprovementAction): boolean {
  return actions.value.includes(action)
}

/** The evaluation pack as text, formatted once rather than on every render. */
function evaluationPackText(item: ImprovementCase): string {
  return JSON.stringify(item.evaluation_pack, null, 2)
}

function run(action: ImprovementAction) {
  emit('action', action, {
    reason: reason.value,
    target_case_id: target.value,
    snooze_until: snooze.value || null,
    signal_ids: signalIds.value
      .split(',')
      .map((v) => Number(v.trim()))
      .filter(Boolean),
    expected_revision: props.item?.revision,
  })
}
function runState(state: ImprovementJobState): string {
  return t(`improvements.runState.${state}`)
}
</script>
<template>
  <article
    v-if="item"
    class="case-detail"
    :aria-label="t('improvements.detailLabel')"
  >
    <header class="detail-head">
      <div>
        <span class="case-key">{{ item.case_key }}</span>
        <h2>{{ item.title }}</h2>
        <p>
          {{ item.category }} · {{ t('improvements.signals', { count: item.signal_count }) }} ·
          {{ t('improvements.sessions', { count: item.session_count }) }} · {{ item.trend }}
        </p>
      </div>
      <ImprovementStatusBadge
        :state="item.state"
        :severity="item.severity"
      />
    </header>

    <section class="action-panel">
      <h3>{{ t('improvements.actions') }}</h3>
      <div class="action-grid">
        <VButton
          v-for="action in IMPROVEMENT_ACTIONS"
          :key="action"
          :disabled="busy || !allows(action)"
          @click="run(action)"
        >
          {{ t(`improvements.action.${action}`) }}
        </VButton>
      </div>
      <div class="action-fields">
        <VTextInput
          v-model="reason"
          :label="t('improvements.reason')"
          :placeholder="t('improvements.reasonPlaceholder')"
        />
        <VTextInput
          type="number"
          :model-value="target ?? ''"
          :label="t('improvements.targetCase')"
          @update:model-value="setTarget"
        />
        <VTextInput
          v-model="signalIds"
          placeholder="14, 18, 21"
          :label="t('improvements.signalIds')"
        />
        <VTextInput
          v-model="snooze"
          type="datetime-local"
          :label="t('improvements.snoozeUntil')"
        />
      </div>
    </section>

    <div class="detail-columns">
      <section class="detail-panel"><ImprovementEvidence :evidence="item.evidence" /></section>
      <section class="detail-panel proposal">
        <h3>{{ t('improvements.proposal') }}</h3>
        <template v-if="item.proposal"
          ><strong>{{ item.proposal.title || item.proposal.summary }}</strong>
          <p v-if="item.proposal.summary && item.proposal.summary !== item.proposal.title">
            {{ item.proposal.summary }}
          </p>
          <dl>
            <div v-if="item.proposal.target">
              <dt>{{ t('improvements.proposalTarget') }}</dt>
              <dd>{{ item.proposal.target }}</dd>
            </div>
            <div v-if="item.proposal.rationale">
              <dt>{{ t('improvements.proposalRationale') }}</dt>
              <dd>{{ item.proposal.rationale }}</dd>
            </div>
          </dl></template
        >
        <p
          v-else
          class="muted"
        >
          {{ t('improvements.noProposal') }}
        </p>
      </section>
    </div>

    <section class="detail-panel evaluation-panel">
      <div class="evaluation-copy">
        <h3>{{ t('improvements.evaluation') }}</h3>
        <template v-if="item.evaluation_pack"
          ><p class="eval-counts">
            <span>{{ t('improvements.scenarios', { count: scenarioCount }) }}</span
            ><span>{{ t('improvements.assertions', { count: assertionCount }) }}</span>
          </p>
          <details>
            <summary>{{ t('improvements.technicalDetails') }}</summary>
            <pre>{{ evaluationPackText(item) }}</pre>
          </details></template
        >
        <p
          v-else
          class="muted"
        >
          {{ t('improvements.noEvaluation') }}
        </p>
      </div>
      <EvaluationRequestForm
        :busy="busy"
        @evaluate="(phase, repo, gitRef) => emit('evaluate', phase, repo, gitRef)"
      />
    </section>

    <section class="detail-panel monitoring-panel">
      <div>
        <h3>{{ t('improvements.monitoring') }}</h3>
        <strong v-if="item.monitoring && monitoringDays !== null">{{
          t('improvements.monitoringSummary', {
            sessions: item.monitoring.comparable_sessions,
            days: monitoringDays,
          })
        }}</strong
        ><span v-else>{{ t('improvements.monitoringNotStarted') }}</span>
      </div>
      <div>
        <h3>{{ t('improvements.evaluationRuns') }}</h3>
        <p
          v-if="!evaluationRuns.length"
          class="muted"
        >
          {{ t('improvements.noRuns') }}
        </p>
        <ol v-else>
          <li
            v-for="entry in evaluationRuns"
            :key="entry.run.id"
          >
            <span>{{ t(`improvements.phase.${entry.run.phase}`) }}</span
            ><strong
              v-if="entry.state"
              class="evaluation-run-state"
              >{{ runState(entry.state) }}</strong
            ><code>{{ entry.run.git_ref }}</code>
          </li>
        </ol>
      </div>
    </section>
  </article>
  <DataEmptyState
    v-else
    :title="t('improvements.selectCase')"
  />
</template>
<style scoped>
.case-detail {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.detail-head {
  display: flex;
  gap: var(--space-4);
  justify-content: space-between;
  align-items: flex-start;
  padding: var(--space-1) var(--space-half) var(--space-4);
  border-bottom: 1px solid var(--color-rule);

  h2 {
    margin: var(--space-2) 0 0;
    font-size: var(--font-size-module);
    line-height: var(--line-height-tight);
  }
}

.case-key {
  color: var(--color-action-primary);
  font: var(--font-chip);
}

.detail-head p,
.muted {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.action-panel,
.detail-panel {
  padding: var(--space-4);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}

h3 {
  margin: 0 0 var(--space-3);
  font-size: var(--font-size-emphasis);
}

.action-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.action-fields {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.detail-columns {
  display: grid;
  grid-template-columns: 1.25fr 0.75fr;
  gap: var(--space-3);
}

.proposal {
  strong {
    display: block;
    font-size: var(--font-size-interface);
  }

  p,
  dd {
    color: var(--color-text-muted);
    font: var(--font-note);
  }

  dl {
    display: grid;
    gap: var(--space-3);
    margin: var(--space-4) 0 0;
  }

  dt {
    color: var(--color-action-primary);
    font-size: var(--font-size-dense);
  }

  dd {
    margin: var(--space-1) 0 0;
  }
}

.evaluation-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.7fr);
  gap: var(--space-4);
}

.eval-counts {
  display: flex;
  gap: var(--space-2);

  span {
    padding: var(--space-1) var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-dense);
    background: var(--color-surface-muted);
    border-radius: var(--radius-status);
  }
}

.evaluation-copy details {
  margin-top: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.evaluation-copy pre {
  max-height: 180px;
  color: var(--color-text);
  white-space: pre-wrap;
  overflow: auto;
}

.monitoring-panel {
  display: grid;
  grid-template-columns: 0.55fr 1.45fr;
  gap: var(--space-5);

  & > div + div {
    padding-left: var(--space-5);
    border-left: 1px solid var(--color-rule);
  }

  span {
    color: var(--color-text-muted);
    font-size: var(--font-size-dense);
  }

  ol {
    display: grid;
    gap: var(--space-2);
    padding: 0;
    margin: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: 90px 80px minmax(0, 1fr);
    gap: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-dense);

    & strong {
      color: var(--color-text);
    }
  }

  code {
    grid-column: 3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

@container workspace (width <= 640px) {
  .detail-columns,
  .evaluation-panel,
  .monitoring-panel {
    grid-template-columns: 1fr;
  }

  .action-fields {
    grid-template-columns: repeat(2, 1fr);
  }

  .monitoring-panel > div + div {
    padding: var(--space-5) 0 0;
    border-top: 1px solid var(--color-rule);
    border-left: 0;
  }
}

@container workspace (width <= 496px) {
  .action-fields {
    grid-template-columns: 1fr;
  }

  .detail-head {
    display: grid;
  }
}
</style>
