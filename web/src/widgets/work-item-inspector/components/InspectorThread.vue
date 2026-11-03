<script setup lang="ts">
/**
 * The threads of an item: its questions, comments and work reports with what answers them,
 * in the order `threadRows` gives them, with what still waits for an answer on top.
 *
 * Every comment is the text its author wrote, drawn as markdown, and held to a
 * few lines until expanded — a report included, which used to be printed in
 * full and was the wall of text a long thread was made of. A comment written
 * on a checklist step quotes the step as it stood, and says when the step has
 * changed or gone since.
 *
 * A question is the widget that answers it (`RequestCard`), which reads as a comment
 * here. What is selected or written in it lives here, for as long as the card is open,
 * and is a draft: leaving asks first. A note still written when its question closed some
 * other way stays one, because it is the only copy of what was written.
 *
 * A thread takes its place when it is first seen here and keeps it for as long as the card
 * is open, so a reply arriving moves nothing: the thread says «New reply» instead. The
 * unresolved view hides what is settled, except a thread marked while the view stands,
 * which stays where the reader's hands are until the view changes, and any thread holding
 * words not sent yet.
 *
 * A question folding lifts all that stands below it, a report's Make task outcome among it,
 * so a stray press reaches nothing anywhere in the thread.
 */
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorCommentThread from '@/widgets/work-item-inspector/components/InspectorCommentThread.vue'
import InspectorThreadReplies from '@/widgets/work-item-inspector/components/InspectorThreadReplies.vue'
import {
  hasNewReply,
  isUnresolved,
  keepThreadPlaces,
  threadGroups,
  threadRows,
} from '@/widgets/work-item-inspector/utils/threadRows.ts'
import type {
  ThreadFilter,
  ThreadPlace,
  ThreadRow,
} from '@/widgets/work-item-inspector/utils/threadRows.ts'
import { useDraftSource } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'
import {
  anchored,
  entryAnchor,
  provideThreadForms,
  replyAnchor,
  useThreadForms,
} from '@/widgets/work-item-inspector/utils/useThreadForms.ts'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { holdsDraft } from '@/features/input-requests/utils/answerChange.ts'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { stopStrayPresses } from '@/shared/ui/strayPress.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    item: WorkItem
    pending: boolean
    questions: readonly InputRequestEntry[]
    suggest: InstanceType<typeof RequestCard>['$props']['suggest']
    writable: boolean
    filter?: ThreadFilter
  }>(),
  { filter: 'all' },
)
const emit = defineEmits<{
  'answered': [entry: InputRequestEntry]
  'changed': []
  'refresh': []
  'select': [commentId: number]
  'show-all': []
}>()
const { t, d } = useI18n()

const thread = ref<HTMLElement | null>(null)
watch(thread, stopStrayPresses, { flush: 'post' })

const drafts = ref<Record<string, RequestDraft>>({})
const draftFor = (entry: InputRequestEntry) => drafts.value[requestIdentity(entry)] ?? EMPTY_DRAFT
// The rule `RequestList` asks by too: a change of the answer counts once it says something new.
useDraftSource('answer', () =>
  props.questions.some((entry) => holdsDraft(entry.request, draftFor(entry))),
)

const forms = useThreadForms(
  () => props.item.work_item_id,
  () => emit('changed'),
)
provideThreadForms(forms)
const { hasDraft: holdsWords, held, isOpen, pending: writing, settleFocus, show } = forms
const busy = computed(() => props.pending || writing.value)

/** What has waited while this card is open, which stays where it stood once answered. */
const kept = ref(new Set<string>())
watch(
  () => props.questions,
  (entries) => {
    for (const { request } of entries)
      if (request.status === 'pending') kept.value.add(request.request_id)
  },
  { immediate: true },
)
const groups = computed(() => threadGroups(props.item.comments, props.questions))
const places = shallowRef<ReadonlyMap<string, ThreadPlace>>(new Map())
watch(
  [() => props.item.work_item_id, groups] as const,
  ([identity, rows], before) => {
    places.value = keepThreadPlaces(rows, identity === before?.[0] ? places.value : new Map())
  },
  { immediate: true },
)
const rows = computed(() => threadRows(groups.value, kept.value, places.value))
const shown = computed(() =>
  props.filter === 'all' ? rows.value : rows.value.filter((row) => stays(row)),
)
const hiddenRows = computed(() => rows.value.filter((row) => !shown.value.includes(row)))
const hiddenCount = computed(() => hiddenRows.value.length)
const emptyLine = computed(() =>
  t(rows.value.length ? 'threads.noneUnresolved' : 'workItem.noDiscussion'),
)
function stays(row: ThreadRow) {
  return (
    isUnresolved(row, kept.value) ||
    held.value.has(row.key) ||
    isOpen(row.key) ||
    holdsWords(row.key) ||
    // The task's outcome is what the card's link to the report leads to.
    (row.kind === 'comment' && row.comment.id === props.item.summary_comment_id)
  )
}
watch(
  () => props.filter,
  () => (held.value = new Set()),
)
watch(rows, settleFocus, { flush: 'post' })

type CardHandle = { focus: () => void; reveal: () => void }
const cards: Record<string, CardHandle | null> = {}
/** Brings the question still waiting, the newest of them, into view. */
function revealQuestion() {
  const first = rows.value.find(
    (row) => row.kind === 'question' && row.entry.request.status === 'pending',
  )
  if (first) cards[first.key]?.reveal()
}
/** What was hidden comes back in place, and the reader lands on the first of it. */
async function showAll() {
  const first = hiddenRows.value[0]
  emit('show-all')
  await nextTick()
  if (first?.kind === 'question') cards[first.key]?.focus()
  else if (first?.kind === 'comment') moveFocus(anchored(entryAnchor(first.comment.id)))
}

function when(value: string | null) {
  if (value === null) return t('workItem.unknownTime')
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}
function fresh(row: ThreadRow) {
  return hasNewReply(row, places.value.get(row.key))
}
function draftSetAside(row: ThreadRow) {
  return holdsWords(row.key) && !isOpen(row.key)
}
function questionParent(row: Extract<ThreadRow, { kind: 'question' }>) {
  return { reply_to_request: row.entry.request.request_id }
}
defineExpose({ revealQuestion })
</script>

<template>
  <ol
    v-if="shown.length"
    ref="thread"
    class="thread"
  >
    <template
      v-for="row in shown"
      :key="row.key"
    >
      <li
        v-if="row.kind === 'question'"
        :id="row.key"
        class="thread-question"
      >
        <RequestCard
          :ref="(card) => (cards[row.key] = card as CardHandle | null)"
          :entry="row.entry"
          :draft="draftFor(row.entry)"
          :item-closed="item.state.is_terminal"
          :suggest="suggest"
          @update:draft="drafts[requestIdentity(row.entry)] = $event"
          @updated="emit('answered', $event)"
        />
        <div
          v-if="writable || row.replies.length"
          class="thread-tail"
        >
          <div
            v-if="writable"
            class="thread-tail-actions"
          >
            <VButton
              :id="replyAnchor(row.key)"
              variant="ghost"
              size="inline"
              :disabled="busy"
              @click="show(row.key, 'reply')"
              >{{ t('threads.replyInThread') }}</VButton
            >
            <span
              v-if="fresh(row)"
              class="thread-tail-flag"
              >{{ t('threads.newReply') }}</span
            >
            <span
              v-if="draftSetAside(row)"
              class="thread-tail-flag"
              >{{ t('threads.draft') }}</span
            >
          </div>
          <InspectorThreadReplies
            :can-mark="false"
            :parent="questionParent(row)"
            :replies="row.replies"
            :root="null"
            :suggest="suggest"
            :thread-key="row.key"
            :when="when"
            @refresh="emit('refresh')"
          />
        </div>
      </li>
      <li
        v-else-if="row.kind === 'comment'"
        class="thread-row"
      >
        <InspectorCommentThread
          :fresh="fresh(row)"
          :item="item"
          :pending="pending"
          :row="row"
          :suggest="suggest"
          :when="when"
          :writable="writable"
          @refresh="emit('refresh')"
          @select="emit('select', $event)"
        />
      </li>
      <li
        v-else
        class="thread-row thread-tail"
      >
        <p class="thread-tail-flag">{{ t('threads.detached') }}</p>
        <InspectorThreadReplies
          :can-mark="false"
          :parent="null"
          :replies="row.replies"
          :root="null"
          :thread-key="row.key"
          :when="when"
        />
      </li>
    </template>
  </ol>
  <p
    v-else
    class="thread-empty"
  >
    {{ emptyLine }}
  </p>
  <p
    v-if="hiddenCount"
    class="thread-hidden"
  >
    {{ t('threads.hidden', { n: hiddenCount }) }}
    <VButton
      variant="ghost"
      size="inline"
      @click="showAll"
      >{{ t('threads.showAll') }}</VButton
    >
  </p>
</template>

<style scoped>
.thread {
  display: grid;
  gap: var(--space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.thread-row {
  min-width: 0;
}

/* The widget is its own sheet, here and in the list of everything waiting. */
.thread-question {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
}

/* What hangs under a question reads as the same sheet going on: its ground, and only the
   hairline of a gap between them. */
.thread-tail {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface-sheet);
  border-radius: var(--radius-card);
}

/* A forced palette clears the sheets, and with them where a thread ends. */
@media (forced-colors: active) {
  .thread-question,
  .thread-row.thread-tail {
    border-radius: var(--radius-card);
    outline: 1px solid;
    outline-offset: -1px;
  }
}

.thread-tail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  align-items: center;
}

.thread-tail-flag {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.thread-empty {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.thread-hidden {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
