<script setup lang="ts">
/**
 * The questions of one scope, with the state of reading them.
 *
 * Refresh stands on the same line as the sentence that says what it would
 * refresh — the count, the failure, or that there is nothing — or inside the
 * empty state when there is nothing at all. It used to stand alone on a row of
 * its own above that sentence, a button with nothing beside it to act on. A
 * host that already has a heading row puts the refresh there instead.
 *
 * Answering or declining a question removes the buttons that were focused, and
 * focus used to fall to the page under the dialog. The list moves it on: to the
 * next open question, or, with none left, to the line at the top that says so.
 * A task's own section has no such line once read, so it keeps focus on the
 * question just answered.
 */
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'

import type {
  InputAnswers,
  InputRequestEntry,
  InputRequestList,
} from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    drafts: Record<string, InputAnswers>
    entries: InputRequestEntry[]
    failed: boolean
    loading: boolean
    partial: boolean
    result: InputRequestList | null
    item?: boolean
    /** False when the host carries the refresh in its own heading row. */
    showRefresh?: boolean
  }>(),
  { item: false, showRefresh: true },
)
const emit = defineEmits<{
  draft: [key: string, value: InputAnswers]
  refresh: []
  select: [target: PlanningTarget]
  updated: [entry: InputRequestEntry]
}>()
const { t } = useI18n()
const busyMark = computed(() => props.loading || undefined)
// A poll runs every half minute. Once there is an answer it stays on screen
// while the next one is read, so neither the empty message nor a "checking"
// line blinks in and out of the layout on every poll; `aria-busy` says it.
const empty = computed(() => Boolean(props.result) && !props.failed && !props.entries.length)
const emptyLabel = computed(() => {
  if (props.partial) return t('requests.partialEmpty')
  return t(props.item ? 'requests.itemEmpty' : 'requests.empty')
})
/**
 * The questions still waiting, which is what the rail counts. Answered ones stay
 * on screen with their outcome, so counting the cards said 2 beside a rail's 1.
 */
const waiting = computed(
  () => props.entries.filter((entry) => entry.request.status === 'pending').length,
)
/** What the refresh beside it would change: the first read, its failure, or the count. */
const statusText = computed(() => {
  if (props.loading && !props.result) return t('requests.loading')
  if (props.failed) return t('requests.error')
  if (waiting.value) return t('requests.count', { count: waiting.value })
  if (props.entries.length) return t(props.item ? 'requests.itemEmpty' : 'requests.empty')
  return ''
})
// A host that carries its own refresh still needs the first read and a failure said.
const showToolbar = computed(
  () => Boolean(statusText.value) && (props.showRefresh || !props.result || props.failed),
)
const sources = computed(() =>
  props.result?.coverage.map((source) => ({
    ...source,
    key: JSON.stringify([source.project_id, source.space_ref]),
  })),
)
const cards: Record<string, { focus: () => void } | null> = {}
const status = ref<HTMLElement | null>(null)
function draftFor(entry: InputRequestEntry) {
  return props.drafts[requestIdentity(entry)] ?? {}
}
async function updated(entry: InputRequestEntry) {
  emit('updated', entry)
  if (entry.request.status === 'pending') return
  await nextTick()
  const key = requestIdentity(entry)
  const at = props.entries.findIndex((candidate) => requestIdentity(candidate) === key)
  const next = [...props.entries.slice(at + 1), ...props.entries.slice(0, Math.max(at, 0))].find(
    (candidate) => candidate.request.status === 'pending',
  )
  if (next) cards[requestIdentity(next)]?.focus()
  else if (status.value) status.value.focus()
  else cards[key]?.focus()
}
</script>

<template>
  <div
    class="request-list"
    :aria-busy="busyMark"
  >
    <div
      v-if="showToolbar"
      class="request-toolbar"
    >
      <p
        v-if="failed"
        class="request-error"
        role="alert"
      >
        {{ statusText }}
      </p>
      <p
        v-else
        ref="status"
        class="request-status"
        role="status"
        tabindex="-1"
      >
        {{ statusText }}
      </p>
      <VButton
        v-if="showRefresh"
        :disabled="loading"
        @click="emit('refresh')"
        >{{ t('requests.refresh') }}</VButton
      >
    </div>
    <p
      v-if="partial"
      class="request-note"
      role="status"
    >
      {{ t('requests.partial') }}
    </p>
    <p
      v-if="result?.has_more"
      class="request-note"
      role="status"
    >
      {{ t('requests.truncated') }}
    </p>
    <template
      v-for="source in sources"
      :key="source.key"
    >
      <p
        v-if="source.status === 'unavailable'"
        class="request-note"
      >
        {{
          t('requests.sourceUnavailable', {
            project: source.project_id,
            space: source.space_ref.space_key,
          })
        }}
      </p>
    </template>
    <template v-if="empty">
      <DataEmptyState
        v-if="showRefresh"
        :title="emptyLabel"
        compact
      >
        <template #action>
          <VButton @click="emit('refresh')">{{ t('requests.refresh') }}</VButton>
        </template>
      </DataEmptyState>
      <p
        v-else
        class="request-empty"
        role="status"
      >
        {{ emptyLabel }}
      </p>
    </template>
    <RequestCard
      v-for="entry in entries"
      :key="requestIdentity(entry)"
      :ref="(card) => (cards[requestIdentity(entry)] = card as { focus: () => void } | null)"
      :entry="entry"
      :draft="draftFor(entry)"
      :show-task-link="!item"
      :announce-pending="item"
      @update:draft="emit('draft', requestIdentity(entry), $event)"
      @updated="updated"
      @select="emit('select', $event)"
    />
  </div>
</template>

<style scoped>
.request-list {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

/* The sentence and the refresh it describes share one line; the button keeps
   its size and the sentence takes the rest. */
.request-toolbar {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: center;
}

.request-status,
.request-error {
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.request-error {
  color: var(--color-danger);
}

/* Focus lands on the count line once the last question is answered. */
.request-status:focus {
  outline: none;
}

.request-status:focus-visible {
  border-radius: var(--radius-control);
  outline: 2px solid var(--color-focus-ring);
  outline-offset: var(--space-half);
}

.request-note,
.request-empty {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
  overflow-wrap: anywhere;
}
</style>
