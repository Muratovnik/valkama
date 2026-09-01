<script setup lang="ts">
/**
 * What the session has done, newest first, fetched by the component that shows it.
 *
 * The request is guarded by a token rather than cancelled: a drawer reopened on a
 * second session while the first was still in flight used to render the first
 * one's events under the second one's name.
 */
import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { feedLines } from '@/entities/session/sessionDerivations.ts'

import { fetchSessionFeed } from '@/shared/api/api'
import { uiReady } from '@/shared/api/platformUiState.ts'
import {
  beginResource,
  cancelResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import { resourceUiState } from '@/shared/api/resourceUiState.ts'
import type { Observed } from '@/shared/api/resourceUiState.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import type { SessionFeed as SessionFeedPayload } from '@/shared/types/session.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ revision: string; sessionId: string | null }>()
const { t, d, te } = useI18n()
const resource = ref(createResource<Observed<SessionFeedPayload>>()) as Ref<
  ResourceState<Observed<SessionFeedPayload>>
>
const state = computed(() =>
  resourceUiState(resource.value, {
    empty: (payload) => payload.events.length === 0,
    emptyReason: 'monitor.noEvents',
    failureReason: (failure) => {
      const message = failureMessage(failure)
      return t(message.key, message.params ?? {})
    },
  }),
)
const retryable = computed(() => state.value.status === 'error')
const busy = computed(() => (state.value.status === 'degraded' ? true : undefined))

async function load() {
  const id = props.sessionId
  if (!id) {
    resource.value = cancelResource(resource.value)
    return
  }
  const key = `session:${id}`
  resource.value = beginResource(resource.value, key)
  const generation = resource.value.generation
  try {
    const result = await fetchSessionFeed(id)
    if (result.session !== id) {
      const mismatch = new Error('session_feed_contract_invalid')
      Object.assign(mismatch, { code: 'contract_invalid' })
      throw mismatch
    }
    resource.value = resolveResource(resource.value, generation, key, {
      at: new Date().toISOString(),
      state: uiReady(result),
    })
  } catch (error) {
    resource.value = rejectResource(
      resource.value,
      generation,
      key,
      typedFailure(error, 'session_feed_failed'),
    )
  }
}

watch([() => props.sessionId, () => props.revision], load, { immediate: true })

function formatTime(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? value : d(parsed, 'activity')
}

/** An event title the catalogue knows, or the raw one the server sent. */
function eventTitle(title: string): string {
  const key = `monitor.event.${title}`
  return te(key) ? t(key) : title
}

function feedResult(failed: boolean): 'failed' | 'normal' {
  return failed ? 'failed' : 'normal'
}
</script>

<template>
  <section
    class="feed-section"
    aria-live="polite"
  >
    <h2 class="feed-heading">{{ t('monitor.activity') }}</h2>
    <PlatformStatePanel
      :state="state"
      :retryable="retryable"
      compact
      @retry="load"
    >
      <template #default="{ payload }">
        <div
          v-if="state.status === 'degraded' && state.reason"
          class="feed-recovery"
        >
          <VButton
            variant="ghost"
            @click="load"
            >{{ t('platform.actions.retry') }}</VButton
          >
        </div>
        <ol
          class="feed"
          :aria-busy="busy"
        >
          <li
            v-for="line in feedLines(payload.events)"
            :key="line.id"
            class="feed-line"
            :data-kind="line.klass"
            :data-tone="statePresentation('session-feed-result', feedResult(line.failed)).tone"
          >
            <span class="feed-title">{{ eventTitle(line.title) }}</span>
            <time
              class="feed-time"
              :datetime="line.at"
              >{{ formatTime(line.at) }}</time
            >
            <span
              v-if="line.note"
              class="feed-note"
              >{{ line.note }}</span
            >
          </li>
        </ol>
      </template>
    </PlatformStatePanel>
  </section>
</template>

<style scoped>
.feed-section {
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-rule);
}

.feed-heading {
  margin: 0 0 var(--space-3);
  color: var(--color-text);
  font: 600 var(--font-size-module)/var(--line-height-snug) var(--font-family-interface);
}

.feed {
  padding: 0;
  margin: 0;
  border-left: 1px solid var(--color-rule);
  list-style: none;
}

.feed-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-half) var(--space-3);
  padding: var(--space-2) 0 var(--space-2) var(--space-3);
  font: var(--font-note);

  &[data-kind='stream'] {
    color: var(--color-text-muted);
  }

  &[data-tone='danger'] .feed-title {
    color: var(--color-danger);
  }
}

.feed-time {
  color: var(--color-text-muted);
  white-space: nowrap;
}

.feed-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.feed-note {
  grid-column: 1 / -1;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.feed-recovery {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--space-2);
}
</style>
