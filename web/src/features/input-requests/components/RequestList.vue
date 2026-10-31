<script setup lang="ts">
/**
 * The questions of one scope, with the state of reading them.
 *
 * Refresh stands on the same line as the sentence that says what it would
 * refresh — the count, the failure, or that there is nothing — or inside the
 * empty state when there is nothing at all. It used to stand alone on a row of
 * its own above that sentence, a button with nothing beside it to act on. A
 * host that already has a heading row puts the refresh there instead.
 */
import { computed } from 'vue'
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
/** What the refresh beside it would change: the first read, its failure, or the count. */
const statusText = computed(() => {
  if (props.loading && !props.result) return t('requests.loading')
  if (props.failed) return t('requests.error')
  if (props.entries.length) return t('requests.count', { count: props.entries.length })
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
function draftFor(entry: InputRequestEntry) {
  return props.drafts[requestIdentity(entry)] ?? {}
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
        class="request-status"
        role="status"
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
      :entry="entry"
      :draft="draftFor(entry)"
      :show-task-link="!item"
      @update:draft="emit('draft', requestIdentity(entry), $event)"
      @updated="emit('updated', $event)"
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

.request-note,
.request-empty {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
  overflow-wrap: anywhere;
}
</style>
