<script setup lang="ts">
/**
 * One group of sessions as a ledger, and every label a row needs.
 *
 * The seven derivations here all answer the same shape of question — what does
 * this row say about one session — and none of them is asked anywhere else. What
 * a row states is not always what its status field holds: a terminal event is
 * authoritative, but an unacknowledged reason beside it is the more useful
 * sentence, so `failureLabel` prefers the reason and never renders both.
 *
 * Below 700px the table stops being a table. The rows become blocks and the
 * headings go to screen readers only, which is why the container query lives with
 * the table rather than with the page around it.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  displayName,
  lastActivityLabel,
  sessionIdentity,
  sessionTone,
  stepSummary,
} from '@/entities/session/sessionDerivations.ts'

import { markSessionSeen } from '@/shared/api/api'
import { uiEmpty } from '@/shared/api/platformUiState.ts'
import { sessionSemanticState } from '@/shared/api/sessionSemanticState.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import type { AgentSession } from '@/shared/types/session.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ selectedId: string | null; sessions: AgentSession[] }>()
const emit = defineEmits<{ select: [session: AgentSession] }>()
const { t, te } = useI18n()
const acknowledgementFailures = ref<Record<string, TypedFailure>>({})

async function acknowledge(session: AgentSession) {
  try {
    await markSessionSeen(session.id)
    const next = { ...acknowledgementFailures.value }
    delete next[session.id]
    acknowledgementFailures.value = next
  } catch (error) {
    acknowledgementFailures.value = {
      ...acknowledgementFailures.value,
      [session.id]: typedFailure(error, 'mutation_failed'),
    }
  }
}

function acknowledgementFailure(session: AgentSession): string {
  const failure = acknowledgementFailures.value[session.id]
  if (failure === undefined) return ''
  const message = failureMessage(failure)
  return t(message.key, message.params ?? {})
}

/** Whether this row is the one the drawer beside the table is showing. */
function isSelected(session: AgentSession) {
  return props.selectedId === session.id
}

/** The selected row is the current one in its table; every other row carries no mark. */
function currentMark(session: AgentSession): 'true' | undefined {
  return isSelected(session) ? 'true' : undefined
}

function quiet(session: AgentSession): string {
  const label = lastActivityLabel(session.quiet_seconds)
  return t(label.key, { count: label.count })
}

function attentionLabel(session: AgentSession): string {
  // Adapters may introduce a new reason before the catalog knows it; showing
  // the raw reason beats showing a missing-key path.
  const key = `monitor.attention.${session.attention}`
  return te(key) ? t(key) : session.attention
}

function failureLabel(session: AgentSession): string {
  // A terminal event is authoritative. If it also carries an unacknowledged
  // reason, use that one label and do not render a second failure chip.
  return session.attention && !session.attention_seen
    ? attentionLabel(session)
    : t('monitor.status.failed')
}

function ringing(session: AgentSession): boolean {
  return session.status !== 'ended' && Boolean(session.attention) && !session.attention_seen
}

function stateLabel(session: AgentSession): string {
  if (session.status === 'failed') return failureLabel(session)
  if (ringing(session)) return attentionLabel(session)
  if (sessionTone(session) === 'stale') return t('monitor.status.stale')
  if (session.status === 'active' && stepSummary(session)) return t('monitor.groups.working')
  if (session.status === 'active') return t('monitor.attention.waiting')
  return t(`monitor.status.${session.status}`)
}

function stateKey(session: AgentSession): 'attention' | 'failed' | 'working' | 'waiting' | 'ended' {
  return sessionSemanticState(session)
}

function clientIcon(session: AgentSession): 'codex' | 'claude' | 'client' {
  const family = sessionIdentity(session).family
  return family === 'codex' || family === 'claude' ? family : 'client'
}
</script>

<template>
  <div class="session-table-wrap">
    <table class="session-table">
      <thead>
        <tr>
          <th scope="col">{{ t('monitor.state') }}</th>
          <th scope="col">{{ t('monitor.client') }}</th>
          <th scope="col">{{ t('monitor.sessionDetails') }}</th>
          <th scope="col">{{ t('monitor.lastActivity') }}</th>
          <th scope="col">
            <span class="visually-hidden">{{ t('monitor.markRead') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="session in sessions"
          :key="session.id"
          class="session-open session"
          tabindex="0"
          :class="{ selected: isSelected(session) }"
          :aria-current="currentMark(session)"
          @click="emit('select', session)"
          @keydown.enter.prevent="emit('select', session)"
          @keydown.space.prevent="emit('select', session)"
        >
          <td class="state-cell">
            <!-- A ledger column of bordered pills is a column of boxes; the dot
                 and its label carry the state and let the row stay one object. -->
            <SemanticState
              dimension="session"
              :state="stateKey(session)"
              :label="stateLabel(session)"
            />
          </td>
          <td class="client-cell">
            <span class="client-cell-content"
              ><VIcon
                :name="clientIcon(session)"
                :size="18"
              /><span class="client">{{ sessionIdentity(session).reporter }}</span></span
            >
          </td>
          <td>
            <span class="session-copy">
              <strong class="name">{{ displayName(session) }}</strong>
              <span class="session-meta">
                <span
                  v-if="stepSummary(session)"
                  class="step"
                  >{{ t('monitor.inProgress') }}</span
                >
                <span v-else-if="session.status === 'failed'">{{ failureLabel(session) }}</span>
                <span v-else-if="sessionTone(session) === 'stale'">{{
                  t('monitor.status.stale')
                }}</span>
                <span v-else-if="session.status === 'active'">{{ t('monitor.idleStep') }}</span>
                <span v-else>{{ t(`monitor.status.${session.status}`) }}</span>
              </span>
            </span>
          </td>
          <td>
            <time :datetime="session.last_seen">{{ quiet(session) }}</time>
          </td>
          <td class="ack-cell">
            <button
              v-if="ringing(session)"
              type="button"
              class="ack-inline"
              :aria-label="t('monitor.markRead')"
              :title="t('monitor.markRead')"
              @click.stop="acknowledge(session)"
            >
              <VIcon
                name="check"
                :size="18"
              /><span class="visually-hidden">{{ t('monitor.markRead') }}</span>
            </button>
            <span
              v-if="acknowledgementFailure(session)"
              class="ack-failure"
              role="alert"
            >
              {{ acknowledgementFailure(session) }}
              <VButton
                v-if="acknowledgementFailures[session.id]?.retryable"
                variant="ghost"
                @click.stop="acknowledge(session)"
              >
                {{ t('platform.actions.retry') }}
              </VButton>
            </span>
          </td>
        </tr>
      </tbody>
    </table>
    <PlatformStatePanel
      v-if="!sessions.length"
      class="filter-empty"
      :state="uiEmpty(t('monitor.filterEmpty'))"
      :retryable="false"
      compact
    />
  </div>
</template>

<style scoped>
.session-table-wrap {
  max-width: var(--size-module-column);
  margin: 0 auto;
  background: var(--color-surface);
  overflow-x: auto;
  border-radius: var(--radius-card);
}

.session-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;

  /* A column heading names a column; it does not compete with the rows under it.
     Weight and tone carry that rank at the reading size the rest of the table
     uses, and the hairline under the row is the one divider it needs — a filled
     band above that hairline was two hard divides saying the same thing. */
  th {
    padding: var(--space-2) calc(var(--size-column-gutter) / 2);
    border-bottom: 1px solid var(--color-rule);
    color: var(--color-text-muted);
    font: var(--font-column-head);
    text-align: left;

    &:first-child {
      width: 150px;
    }

    &:nth-child(2) {
      width: 130px;
    }

    &:nth-child(4) {
      width: 190px;
    }

    &:last-child {
      width: 64px;
    }
  }
}

.session td {
  vertical-align: middle;
  min-width: 0;

  /* Half the column gutter on each side of a cell puts a whole one between two
     columns, which is the same distance the grid-built tables spend as a gap. */
  padding: var(--space-2) calc(var(--size-column-gutter) / 2);
  border-bottom: 1px solid var(--color-rule);
}

.session:last-child td {
  border-bottom: 0;
}

.session-open {
  color: var(--color-text);
  cursor: pointer;

  time {
    color: var(--color-text-muted);
    font: var(--font-detail);
    white-space: nowrap;
  }

  &:hover {
    background: var(--color-surface-hover);
  }

  &.selected {
    background: var(--color-surface-selected);
    box-shadow: inset 3px 0 var(--color-action-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -3px;
  }
}

:is(.state-cell, .client-cell) {
  white-space: nowrap;
}

.client-cell-content {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  vertical-align: middle;
  min-width: 0;
}

.client {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.session-copy {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.name {
  min-width: 0;
  font: var(--font-row-title);
  overflow-wrap: anywhere;
}

.session-meta {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);

  & > :first-child {
    overflow-wrap: anywhere;
  }
}

.ack-cell {
  text-align: right;
}

.ack-failure {
  display: grid;
  gap: var(--space-1);
  justify-items: end;
  color: var(--color-danger);
  font: var(--font-note);
}

/* Acknowledging is a quiet confirmation on a row that already carries its own
   state, so the control is a ghost until the pointer is on it. */
.ack-inline {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  align-self: center;
  width: var(--size-control-target);
  min-width: var(--size-control-target);
  height: var(--size-control-target);
  min-height: var(--size-control-target);
  padding: 0;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 3px;
  }

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }
}

/* Below this the table stops being a table: a row becomes a block, the headings
   go to screen readers only, and the acknowledge control leaves the flow for the
   right edge of the block it belongs to. The container is the ledger the page
   declares, because what fits is a question about that column and not the window. */
@container session-ledger (max-width:700px) {
  .session-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .session-table,
  .session-table tbody,
  .session-table tr,
  .session-table td {
    display: block;
    width: 100%;
  }

  .session-table tr {
    position: relative;
    padding: var(--space-3) var(--space-15) var(--space-3) var(--space-3);
    border-bottom: 1px solid var(--color-rule);

    &:last-child {
      border-bottom: 0;
    }
  }

  .session td {
    padding: var(--space-half) 0;
    border: 0;
  }

  .session .ack-cell {
    position: absolute;
    top: 50%;
    right: 8px;
    width: var(--size-control-target);
    transform: translateY(-50%);
  }

  :is(.state-cell, .client-cell) {
    margin-bottom: var(--space-1);
  }

  .session-open time {
    white-space: normal;
  }
}
</style>
