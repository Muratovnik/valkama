<script setup lang="ts">
/**
 * What an operator can do with a session from here: open it, open the item it is
 * working, or stop the attention mark asking.
 *
 * Opening is the one that can fail, and it fails in four different ways — the
 * opener refused, the path was gone, the client was not installed, or the shell
 * copied a command instead of running one. `openFeedback` turns each into the
 * sentence the catalogue has for it, and falls back to the raw reason rather than
 * to silence.
 */
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import SessionAttach from '@/widgets/session-detail/SessionAttach.vue'

import { openSession } from '@/features/session-open/sessionOpen.ts'
import type { SessionOpenResult } from '@/features/session-open/sessionOpen.ts'

import { markSessionSeen } from '@/shared/api/api'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import { openerFor } from '@/shared/lib/settings'
import { useSettingsStore } from '@/shared/stores/settingsStore'
import type { SessionWorkItemNavigationTarget } from '@/shared/types/reference.ts'
import type { AgentSession } from '@/shared/types/session.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const { session } = defineProps<{ session: AgentSession }>()
const emit = defineEmits<{
  'attached': [reference: string]
  'open-work-item': [target: SessionWorkItemNavigationTarget]
}>()
const { t, te } = useI18n()
const { settings } = storeToRefs(useSettingsStore())
const opening = ref(false)
const openNotice = ref('')
const acknowledgementFailure = ref<TypedFailure | null>(null)

function failureText(failure: TypedFailure): string {
  const message = failureMessage(failure)
  return t(message.key, message.params ?? {})
}

function openFeedback(result: SessionOpenResult): string {
  if (result.ok && result.mode === 'opened') return ''
  if (result.ok && result.mode === 'copied') return t('session.copied')
  const reason = result.error ?? ''
  const key = `session.refused.${reason}`
  return te(key)
    ? t(key)
    : failureText({ code: reason || result.mode, status: null, retryable: false })
}

async function openThisSession() {
  if (opening.value) return
  opening.value = true
  try {
    const result = await openSession(
      {
        id: session.id,
        client: session.client,
        client_family: session.client_family,
        cwd: session.cwd,
        session_cwd: session.cwd,
        space_root: session.space_root,
      },
      openerFor(session.client_family ?? session.client, settings.value),
    )
    openNotice.value = openFeedback(result)
  } catch (error) {
    openNotice.value = failureText(typedFailure(error, 'request_failed'))
  } finally {
    opening.value = false
  }
}

async function acknowledge() {
  try {
    await markSessionSeen(session.id)
    acknowledgementFailure.value = null
  } catch (error) {
    acknowledgementFailure.value = typedFailure(error, 'mutation_failed')
  }
}
</script>

<template>
  <div class="session-actions">
    <button
      type="button"
      class="session-action"
      :disabled="opening"
      @click="openThisSession"
    >
      {{ t('session.open') }}
      <VIcon
        name="external-link"
        :size="16"
      />
    </button>
    <button
      v-if="session.work_item && session.space_root?.resource_ref"
      type="button"
      class="session-action"
      @click="
        emit('open-work-item', {
          resource_ref: session.space_root.resource_ref,
          reference: session.work_item,
          scope: session.scope,
        })
      "
    >
      {{ t('monitor.openWorkItem', { reference: session.work_item }) }}
    </button>
    <button
      v-if="session.attention && !session.attention_seen && session.status !== 'ended'"
      type="button"
      class="session-acknowledge"
      @click="acknowledge"
    >
      {{ t('monitor.markRead') }}
    </button>
    <span
      v-else-if="!session.work_item"
      class="session-no-work-item"
      >{{ t('monitor.noWorkItem') }}</span
    >
  </div>
  <SessionAttach
    v-if="!session.work_item"
    :session-id="session.id"
    @attached="(reference) => emit('attached', reference)"
  />
  <p
    v-if="acknowledgementFailure"
    class="session-action-failure"
    role="alert"
  >
    <span>{{ failureText(acknowledgementFailure) }}</span>
    <VButton
      v-if="acknowledgementFailure.retryable"
      class="session-action-retry"
      variant="ghost"
      @click="acknowledge"
    >
      {{ t('platform.actions.retry') }}
    </VButton>
  </p>
  <p
    v-if="openNotice"
    class="session-action-notice"
  >
    {{ openNotice }}
  </p>
</template>

<style scoped>
.session-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  padding-bottom: var(--space-4);
}

.session-action,
.session-acknowledge {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--size-control-target);
  padding: 0 var(--space-2);
  border: 1px solid transparent;
  color: var(--color-action-primary);
  font: var(--font-strong);
  background: none;
  cursor: pointer;
}

.session-acknowledge {
  color: var(--color-text-muted);
  background: var(--color-control-surface);

  &:hover {
    background: var(--color-surface-hover);
  }
}

.session-action:disabled {
  opacity: 0.55;
  cursor: wait;
}

.session-action-notice {
  margin: 0 0 var(--space-3);
  color: var(--color-success);
  font: var(--font-note);
}

.session-action-failure {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0 0 var(--space-3);
  color: var(--color-danger);
  font: var(--font-note);
}

.session-no-work-item {
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
