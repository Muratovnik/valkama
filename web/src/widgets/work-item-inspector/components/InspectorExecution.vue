<script setup lang="ts">
/**
 * Every attempt at this item: what ran, what it said, and what the checkout did.
 *
 * The two halves are deliberately separate. What the client reported is a
 * claim — `complete` is a sentence a model wrote — and what the repository
 * shows is evidence. An attempt that reported a delivery and changed no file is
 * readable here precisely because the two are shown side by side rather than
 * summarised into one verdict.
 *
 * A section, not a dashboard. Counts and durations come from the record; nothing
 * here derives a rate or a trend, because Analytics owns that and a second
 * answer computed in a drawer is the kind that disagrees.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { Execution } from '@/shared/api/executionModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  busy: boolean
  error: string
  executions: readonly Execution[]
  loading: boolean
  writable: boolean
}>()

const emit = defineEmits<{
  launch: []
  session: [sessionId: string, clientFamily: string]
  stop: [reference: string]
}>()

const { t, d } = useI18n()

/** A live attempt is the one a stop applies to; there is at most one. */
const live = computed(() => props.executions.find((attempt) => attempt.presence !== 'terminal'))

const canLaunch = computed(() => props.writable && !props.busy && live.value === undefined)

function when(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}

/** The one line that says which client ran this and how it was asked to. */
function shape(attempt: Execution): string {
  return [attempt.client_family, attempt.role, attempt.model, attempt.effort, attempt.environment]
    .filter(Boolean)
    .join(' · ')
}

/**
 * What the checkout did, in the units a reader checks a delivery against. A
 * count the platform never observed is left out entirely rather than shown as
 * zero: that distinction is the whole reason the record carries a quality.
 */
function evidence(attempt: Execution): string {
  const final = attempt.final_artifact
  if (!final || final.quality !== 'observed') return t('execution.evidenceUnknown')
  if (final.changed_files === null) return t('execution.evidenceUnknown')
  return t('execution.evidence', {
    files: final.changed_files,
    insertions: final.insertions ?? 0,
    deletions: final.deletions ?? 0,
    commits: final.commits.length,
  })
}
</script>

<template>
  <section class="executions">
    <SectionHeading
      as="h3"
      level="panel"
      >{{ t('execution.heading') }}</SectionHeading
    >
    <p class="quiet">{{ t('execution.intro') }}</p>

    <div
      v-if="writable"
      class="execution-actions"
    >
      <VButton
        variant="primary"
        :disabled="!canLaunch"
        @click="emit('launch')"
      >
        {{ t('execution.launch') }}
      </VButton>
      <VButton
        v-if="live"
        :disabled="busy"
        @click="emit('stop', live.execution_id)"
      >
        {{ t('execution.stop') }}
      </VButton>
    </div>

    <p
      v-if="loading"
      class="quiet"
      role="status"
    >
      {{ t('execution.loading') }}
    </p>
    <p
      v-else-if="error"
      class="execution-error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-else-if="!executions.length"
      class="quiet"
    >
      {{ t('execution.none') }}
    </p>

    <ol
      v-else
      class="attempt-list"
    >
      <li
        v-for="attempt in executions"
        :key="attempt.execution_id"
        class="attempt"
      >
        <div class="attempt-head">
          <SemanticState
            dimension="execution"
            :state="attempt.status"
            :label="t(`execution.status.${attempt.status}`)"
            compact
          />
          <span class="attempt-shape">{{ shape(attempt) }}</span>
          <span class="attempt-when">{{ when(attempt.started_at) }}</span>
        </div>

        <p
          v-if="attempt.result?.delivery"
          class="attempt-delivery"
        >
          {{ attempt.result.delivery }}
        </p>
        <p
          v-if="attempt.result?.unresolved"
          class="attempt-unresolved"
        >
          {{ t('execution.unresolved', { detail: attempt.result.unresolved }) }}
        </p>

        <dl class="attempt-facts">
          <div class="attempt-fact">
            <dt class="fact-name">{{ t('execution.changed') }}</dt>
            <dd class="fact-value">{{ evidence(attempt) }}</dd>
          </div>
          <div
            v-if="attempt.exit_code !== null"
            class="attempt-fact"
          >
            <dt class="fact-name">{{ t('execution.exitCode') }}</dt>
            <dd class="fact-value">{{ attempt.exit_code }}</dd>
          </div>
          <div
            v-if="attempt.result && !attempt.result.structured"
            class="attempt-fact"
          >
            <dt class="fact-name">{{ t('execution.structured') }}</dt>
            <dd class="fact-value">{{ t('execution.unstructured') }}</dd>
          </div>
        </dl>

        <ul
          v-if="attempt.sessions.length"
          class="attempt-sessions"
        >
          <li
            v-for="entry in attempt.sessions"
            :key="entry.session_id"
          >
            <button
              class="attempt-session"
              type="button"
              :title="entry.session_id"
              @click="emit('session', entry.session_id, entry.client)"
            >
              {{ t(`execution.relation.${entry.relation}`) }} · {{ actorName(entry.client) }}
            </button>
          </li>
        </ul>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.executions {
  display: grid;
  gap: var(--space-3);
}

.quiet {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.execution-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}

.execution-actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.attempt-list {
  display: grid;
  gap: var(--space-4);
  padding: 0;
  margin: 0;
  list-style: none;
}

.attempt {
  display: grid;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-rule);
}

.attempt-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: baseline;
}

.attempt-shape {
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.attempt-when {
  margin-inline-start: auto;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
}

.attempt-delivery {
  margin: 0;
  color: var(--color-text);
  font: var(--font-line);
  overflow-wrap: anywhere;
}

.attempt-unresolved {
  margin: 0;
  color: var(--color-warning);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.attempt-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: var(--space-2) var(--space-4);
  margin: 0;
}

.attempt-fact {
  display: grid;
  gap: var(--space-hair);
  min-width: 0;
}

.fact-name {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.fact-value {
  margin: 0;
  color: var(--color-text);
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
}

.attempt-sessions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.attempt-session {
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
  background: none;
  cursor: pointer;

  &:is(:hover, :focus-visible) {
    color: var(--color-text);
    text-decoration: underline;
  }
}
</style>
