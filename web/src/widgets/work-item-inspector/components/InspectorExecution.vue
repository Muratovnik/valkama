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
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import HistoryFilterBar from '@/widgets/work-item-inspector/components/HistoryFilterBar.vue'
import {
  groupHistory,
  matchesRecorded,
} from '@/widgets/work-item-inspector/utils/historyRecords.ts'

import type { Execution } from '@/shared/api/executionModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  busy: boolean
  error: string
  executions: readonly Execution[]
  loading: boolean
  writable: boolean
  identity?: string
}>()

const emit = defineEmits<{
  launch: []
  session: [sessionId: string, clientFamily: string]
  stop: [reference: string]
}>()

const { t, d, locale } = useI18n()
const query = ref('')
const selected = ref<Record<string, string>>({ status: '', client: '' })
function reset() {
  query.value = ''
  selected.value = { status: '', client: '' }
}
watch(() => props.identity ?? props.executions[0]?.work_item_id, reset)
const choices = computed(() => [
  {
    id: 'status',
    label: t('history.status'),
    options: [
      { value: '', label: t('history.allStatuses') },
      ...[...new Set(props.executions.map((attempt) => attempt.status))].map((value) => ({
        value,
        label: t(`execution.status.${value}`),
      })),
    ],
  },
  {
    id: 'client',
    label: t('history.client'),
    options: [
      { value: '', label: t('history.allClients') },
      ...[...new Set(props.executions.map((attempt) => attempt.client_family).filter(Boolean))].map(
        (value) => ({ value, label: value }),
      ),
    ],
  },
])
const groups = computed(() => {
  const { status, client } = selected.value
  return groupHistory(
    props.executions.filter(
      (attempt) =>
        (!status || attempt.status === status) &&
        (!client || attempt.client_family === client) &&
        matchesRecorded(attempt, query.value),
    ),
    (attempt) => attempt.started_at,
  )
})
function groupLabel(date: Date | null) {
  return date
    ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(date)
    : t('history.unknownDate')
}
function commits(attempt: Execution) {
  return attempt.final_artifact?.commits.join(' · ') ?? ''
}

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
    <p class="quiet">{{ t('history.executionScope') }}</p>

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

    <template v-else>
      <HistoryFilterBar
        v-model:query="query"
        v-model:selected="selected"
        :search-label="t('history.search')"
        :choices="choices"
      />
      <DataEmptyState
        v-if="!groups.length"
        :title="t('history.noMatches')"
        compact
      >
        <template #action
          ><VButton @click="reset">{{ t('history.reset') }}</VButton></template
        >
      </DataEmptyState>
      <section
        v-for="group in groups"
        :key="group.key"
        class="history-group"
      >
        <SectionHeading
          as="h4"
          level="panel"
          >{{ groupLabel(group.date) }}</SectionHeading
        >
        <ol class="attempt-list">
          <li
            v-for="attempt in group.records"
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
            <details class="attempt-context">
              <summary>{{ t('history.detail') }}</summary>
              <p
                v-if="attempt.result?.oracle"
                class="attempt-delivery"
              >
                {{ attempt.result.oracle }}
              </p>
              <p class="attempt-shape">{{ attempt.execution_id }} · {{ attempt.cwd }}</p>
              <p
                v-if="attempt.ended_at"
                class="attempt-when"
              >
                {{ when(attempt.ended_at) }}
              </p>
              <p
                v-if="attempt.base_artifact?.head"
                class="attempt-shape"
              >
                {{ attempt.base_artifact.head }}
              </p>
              <p
                v-if="attempt.final_artifact?.commits.length"
                class="attempt-shape"
              >
                {{ commits(attempt) }}
              </p>
              <p
                v-for="entry in attempt.sessions"
                :key="entry.session_id"
                class="attempt-shape"
              >
                {{ entry.session_id }} · {{ entry.status }} · {{ entry.attention }}
              </p>
            </details>

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
  </section>
</template>

<style scoped>
.executions,
.history-group {
  display: grid;
  gap: var(--space-heading-content);
}

.attempt-context {
  color: var(--color-text-muted);
  font: var(--font-detail);
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
  gap: var(--space-label-value);
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
