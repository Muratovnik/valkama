<script setup lang="ts">
/**
 * The thread of an item: its questions, comments and work reports, in the order
 * `threadRows` gives them, with what still waits for an answer on top.
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
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorReport from '@/widgets/work-item-inspector/components/InspectorReport.vue'
import { anchorState } from '@/widgets/work-item-inspector/utils/checklistAnchor.ts'
import { threadRows } from '@/widgets/work-item-inspector/utils/threadRows.ts'
import { useDraftSource } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import { EMPTY_DRAFT, hasDraft } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  item: WorkItem
  pending: boolean
  questions: readonly InputRequestEntry[]
  suggest: InstanceType<typeof RequestCard>['$props']['suggest']
  writable: boolean
}>()
const emit = defineEmits<{ answered: [entry: InputRequestEntry]; select: [commentId: number] }>()
const { t, d } = useI18n()

const drafts = ref<Record<string, RequestDraft>>({})
const draftFor = (entry: InputRequestEntry) => drafts.value[requestIdentity(entry)] ?? EMPTY_DRAFT
useDraftSource('answer', () =>
  props.questions.some((entry) => {
    const draft = draftFor(entry)
    return entry.request.status === 'pending' ? hasDraft(draft) : Boolean(draft.note.trim())
  }),
)

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
const rows = computed(() => threadRows(props.item.comments, props.questions, kept.value))

type CardHandle = { reveal: () => void }
const cards: Record<string, CardHandle | null> = {}
/** Brings the question still waiting, the newest of them, into view. */
function revealQuestion() {
  const first = rows.value.find(
    (row) => row.kind === 'question' && row.entry.request.status === 'pending',
  )
  if (first) cards[first.key]?.reveal()
}

function isOutcome(commentId: number) {
  return commentId === props.item.summary_comment_id
}
function reportLabel(commentId: number) {
  return t(isOutcome(commentId) ? 'workItem.currentOutcome' : 'workItem.workReport')
}
function quoteLabel(id: string, text: string | null | undefined) {
  return t(`checklistComment.${anchorState(props.item, id, text)}`)
}
function when(value: string | null) {
  if (value === null) return t('workItem.unknownTime')
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}
defineExpose({ revealQuestion })
</script>

<template>
  <ol
    v-if="rows.length"
    class="thread"
  >
    <template
      v-for="row in rows"
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
          :suggest="suggest"
          @update:draft="drafts[requestIdentity(row.entry)] = $event"
          @updated="emit('answered', $event)"
        />
      </li>
      <li
        v-else
        :id="`work-report-${row.comment.id}`"
        class="thread-entry"
        tabindex="-1"
      >
        <div class="thread-meta">
          <span
            >{{ actorName(row.comment.author) || t('workItem.unknownAuthor') }}
            <span v-if="actorSession(row.comment.author)">{{
              actorSession(row.comment.author)
            }}</span></span
          >
          <span>{{ when(row.comment.at) }}</span>
        </div>
        <template v-if="row.comment.kind === 'report' && row.comment.report">
          <strong class="thread-label">{{ reportLabel(row.comment.id) }}</strong>
          <CollapsibleText
            class="thread-text"
            :reset-key="row.comment.id"
            :lines="10"
          >
            <InspectorReport :report="row.comment.report" />
          </CollapsibleText>
          <VButton
            v-if="writable && !isOutcome(row.comment.id)"
            class="thread-action"
            :disabled="pending"
            @click="emit('select', row.comment.id)"
            >{{ t('workItem.makeOutcome') }}</VButton
          >
        </template>
        <blockquote
          v-if="row.comment.kind === 'comment' && row.comment.checklist_item_id"
          class="thread-quote"
        >
          <strong>{{
            quoteLabel(row.comment.checklist_item_id, row.comment.checklist_item_text)
          }}</strong>
          <p class="thread-quote-text">{{ row.comment.checklist_item_text }}</p>
        </blockquote>
        <CollapsibleText
          v-if="row.comment.kind === 'comment'"
          class="thread-text"
          :text="row.comment.body"
        />
      </li>
    </template>
  </ol>
  <p
    v-else
    class="thread-empty"
  >
    {{ t('workItem.noDiscussion') }}
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

/* The widget is its own sheet, here and in the list of everything waiting. */
.thread-question {
  min-width: 0;
}

/* A sheet on the drawer's ground: the card is visible, so its padding reads
   as the card's inset rather than as text shifted off the column. */
.thread-entry {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3);
  background: var(--color-surface-sheet);
  border-radius: var(--radius-card);
  scroll-margin-top: var(--space-4);
}

.thread-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: space-between;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.thread-label {
  font: var(--font-strong);
}

.thread-text {
  font: var(--font-editor);
}

.thread-action {
  justify-self: start;
}

.thread-quote {
  display: grid;
  gap: var(--space-2);
  padding-inline-start: var(--space-3);
  margin: 0;
  border-inline-start: 1px solid var(--color-rule-strong);
  color: var(--color-text-muted);
  font: var(--font-line);
}

.thread-quote-text {
  margin: 0;
  font: var(--font-editor);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.thread-empty {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
