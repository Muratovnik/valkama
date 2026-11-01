<script setup lang="ts">
/**
 * The thread of an item: its comments and work reports, newest first.
 *
 * Every entry is the text its author wrote, drawn as markdown, and held to a
 * few lines until expanded — a report included, which used to be printed in
 * full and was the wall of text a long thread was made of. A comment written
 * on a checklist step quotes the step as it stood, and says when the step has
 * changed or gone since.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorReport from '@/widgets/work-item-inspector/components/InspectorReport.vue'
import { anchorState } from '@/widgets/work-item-inspector/utils/checklistAnchor.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ item: WorkItem; pending: boolean; writable: boolean }>()
const emit = defineEmits<{ select: [commentId: number] }>()
const { t, d } = useI18n()

function commentTime(at: string | null) {
  const time = at === null ? Number.NaN : Date.parse(at)
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time
}
/** Newest first; an entry with no recorded time goes last, where its age puts it. */
const comments = computed(() =>
  [...props.item.comments].sort(
    (left, right) => commentTime(right.at) - commentTime(left.at) || right.id - left.id,
  ),
)
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
</script>

<template>
  <ol
    v-if="item.comments.length"
    class="thread"
  >
    <li
      v-for="entry in comments"
      :id="`work-report-${entry.id}`"
      :key="entry.id"
      class="thread-entry"
      tabindex="-1"
    >
      <div class="thread-meta">
        <span
          >{{ actorName(entry.author) || t('workItem.unknownAuthor') }}
          <span v-if="actorSession(entry.author)">{{ actorSession(entry.author) }}</span></span
        >
        <span>{{ when(entry.at) }}</span>
      </div>
      <template v-if="entry.kind === 'report' && entry.report">
        <strong class="thread-label">{{ reportLabel(entry.id) }}</strong>
        <CollapsibleText
          class="thread-text"
          :reset-key="entry.id"
          :lines="10"
        >
          <InspectorReport :report="entry.report" />
        </CollapsibleText>
        <VButton
          v-if="writable && !isOutcome(entry.id)"
          class="thread-action"
          :disabled="pending"
          @click="emit('select', entry.id)"
          >{{ t('workItem.makeOutcome') }}</VButton
        >
      </template>
      <blockquote
        v-if="entry.kind === 'comment' && entry.checklist_item_id"
        class="thread-quote"
      >
        <strong>{{ quoteLabel(entry.checklist_item_id, entry.checklist_item_text) }}</strong>
        <p class="thread-quote-text">{{ entry.checklist_item_text }}</p>
      </blockquote>
      <CollapsibleText
        v-if="entry.kind === 'comment'"
        class="thread-text"
        :text="entry.body"
      />
    </li>
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
