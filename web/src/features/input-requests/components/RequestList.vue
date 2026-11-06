<script setup lang="ts">
/**
 * The questions of one scope, with the state of reading them.
 *
 * Refresh stands on the same line as the sentence that says what it would
 * refresh — the count, the failure, or that there is nothing — or inside the
 * empty state when there is nothing at all. It used to stand alone on a row of
 * its own above that sentence, a button with nothing beside it to act on.
 *
 * Answering or declining a question removes the buttons that were focused, and
 * focus used to fall to the page under the dialog. The list moves it on: to the
 * next open question, or, with none left, to how the one just answered ended.
 * It went to the count line at the top once, which scrolled a long list away
 * from the card the reader was in.
 *
 * A refresh the reader asked for that fails puts focus on the sentence saying
 * so; one the poll started leaves focus where it is.
 *
 * A question that stopped waiting can be removed from here. Focus goes to the question
 * after it, or the one before, and with none left to the way to read the list again.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { holdsDraft } from '@/features/input-requests/utils/answerChange.ts'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestEntry, InputRequestList } from '@/shared/api/inputRequestModel.ts'
import { skippedSourceReason } from '@/shared/api/planningTarget.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { projectTitle, useProjectTitles } from '@/shared/lib/projectTitles.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  drafts: Record<string, RequestDraft>
  entries: InputRequestEntry[]
  failed: boolean
  loading: boolean
  partial: boolean
  result: InputRequestList | null
}>()
const emit = defineEmits<{
  dismiss: [entry: InputRequestEntry]
  draft: [key: string, value: RequestDraft]
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
  return t(props.partial ? 'requests.partialEmpty' : 'requests.empty')
})
/**
 * The questions still waiting, which is what the rail counts. Answered ones stay
 * on screen with their outcome, so counting the cards said 2 beside a rail's 1.
 */
const waiting = computed(
  () => props.entries.filter((entry) => entry.request.status === 'pending').length,
)
/** The same condition the rail's count carries as its plus: a source or a page was not read. */
const incomplete = computed(() => props.partial || Boolean(props.result?.has_more))
/** Whether a question here holds anything typed or chosen that a failed read must not cost. */
const drafted = computed(() =>
  props.entries.some((entry) => holdsDraft(entry.request, props.drafts[requestIdentity(entry)])),
)
/** What the refresh beside it would change: the first read, its failure, or the count. */
const statusText = computed(() => {
  if (props.loading && !props.result) return t('requests.loading')
  if (props.failed) return t(drafted.value ? 'requests.error' : 'requests.errorBare')
  if (waiting.value)
    return t(incomplete.value ? 'requests.countIncomplete' : 'requests.count', {
      count: waiting.value,
    })
  // The questions below stay to say how they ended: none of them waits, and the line says that
  // of them rather than that there are none.
  if (props.entries.length) return t('requests.noneWaiting')
  return ''
})
const projects = useProjectTitles()
/** The sources not read, each with the reason the finder names it by. */
const skipped = computed(() =>
  (props.result?.coverage ?? [])
    .filter((source) => source.status === 'unavailable')
    .map((source) => {
      const reason = skippedSourceReason(source.reason)
      return {
        key: JSON.stringify([source.project_id, source.space_ref]),
        text: t('requests.sourceUnavailable', {
          project: projectTitle(projects.value, source.project_id),
          space: source.space_ref.space_key,
          reason: t(
            reason === 'requests_unavailable' ? 'requests.unreadable' : `finder.reasons.${reason}`,
          ),
        }),
      }
    }),
)
type CardHandle = { focus: () => void; focusOutcome: () => void; holdsFocus: () => boolean }
const cards: Record<string, CardHandle | null> = {}
const errorLine = ref<HTMLElement | null>(null)
const emptyRefresh = ref<InstanceType<typeof VButton> | null>(null)
/** A refresh the reader pressed is still running; its failure is theirs to hear about. */
const asked = ref(false)
function askRefresh() {
  asked.value = true
  emit('refresh')
}
watch(
  () => props.loading,
  async (loading) => {
    if (loading || !asked.value) return
    asked.value = false
    if (!props.failed) return
    await nextTick()
    moveFocus(errorLine.value)
  },
)
async function dismiss(entry: InputRequestEntry) {
  const at = props.entries.findIndex(
    (candidate) => requestIdentity(candidate) === requestIdentity(entry),
  )
  const neighbour = props.entries[at + 1] ?? props.entries[at - 1]
  emit('dismiss', entry)
  await nextTick()
  if (neighbour) cards[requestIdentity(neighbour)]?.focus()
  else moveFocus(emptyRefresh.value?.$el as HTMLElement | undefined)
}
/** Whether the keyboard is inside this question, which the list must not take away. */
function holdsFocus(entry: InputRequestEntry) {
  return cards[requestIdentity(entry)]?.holdsFocus() ?? false
}
function draftFor(entry: InputRequestEntry) {
  return props.drafts[requestIdentity(entry)] ?? EMPTY_DRAFT
}
async function updated(entry: InputRequestEntry) {
  emit('updated', entry)
  const key = requestIdentity(entry)
  // A form still open keeps the keyboard, and a changed answer is still this question's.
  if (entry.request.status === 'pending' || props.drafts[key]?.changing != null) return
  await nextTick()
  if (entry.request.answer_version > 1) {
    cards[key]?.focusOutcome()
    return
  }
  const at = props.entries.findIndex((candidate) => requestIdentity(candidate) === key)
  const next = [...props.entries.slice(at + 1), ...props.entries.slice(0, Math.max(at, 0))].find(
    (candidate) => candidate.request.status === 'pending',
  )
  if (next) cards[requestIdentity(next)]?.focus()
  else cards[key]?.focusOutcome()
}
defineExpose({ holdsFocus })
</script>

<template>
  <div
    class="request-list"
    :aria-busy="busyMark"
  >
    <div
      v-if="statusText"
      class="request-toolbar"
    >
      <p
        v-if="failed"
        ref="errorLine"
        class="request-error focus-landing"
        role="alert"
        tabindex="-1"
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
      <!-- Not disabled while a read runs: the focused button would drop focus to
           the page, and a second press while one is running starts nothing. -->
      <VButton @click="askRefresh">{{ t('requests.refresh') }}</VButton>
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
    <p
      v-for="source in skipped"
      :key="source.key"
      class="request-note"
    >
      {{ source.text }}
    </p>
    <DataEmptyState
      v-if="empty"
      :title="emptyLabel"
      compact
    >
      <template #action>
        <VButton
          ref="emptyRefresh"
          @click="askRefresh"
          >{{ t('requests.refresh') }}</VButton
        >
      </template>
    </DataEmptyState>
    <RequestCard
      v-for="entry in entries"
      :key="requestIdentity(entry)"
      :ref="(card) => (cards[requestIdentity(entry)] = card as CardHandle | null)"
      :entry="entry"
      :draft="draftFor(entry)"
      standalone
      @update:draft="emit('draft', requestIdentity(entry), $event)"
      @updated="updated"
      @dismiss="dismiss"
      @select="emit('select', $event)"
    />
  </div>
</template>

<style scoped>
/* The column is the list's width, whatever a card holds that will not break. */
.request-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
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

/* Across the line up to the refresh, so that the ring focus brings stands round the line as it
   does round a failed send, and not round the words alone like a chip. */
.request-error {
  flex: 1 1 auto;
  color: var(--color-danger);
}

.request-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
  overflow-wrap: anywhere;
}
</style>
