<script setup lang="ts">
/**
 * Comments and work reports on one item, and the composer for the next one.
 *
 * The composer comes first and the newest entry right under it. It used to sit
 * after every entry ever written, oldest first, so writing a comment on a busy
 * item began with scrolling past all of them, and the latest report — the one a
 * reader came for — was the last thing on the page. Long entries are held to a
 * few lines until expanded, so one report a screen long no longer pushes the
 * rest of the thread out of reach.
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorReport from '@/widgets/work-item-inspector/components/InspectorReport.vue'
import { useDraftSource } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'
import { useInspectorMutation } from '@/widgets/work-item-inspector/utils/useInspectorMutation.ts'

import {
  commentWorkItem,
  publishWorkItemReport,
  selectWorkItemSummary,
} from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{ item: WorkItem; writable: boolean }>()
const emit = defineEmits<{ changed: []; refresh: [] }>()
const { t, d } = useI18n()
const note = ref('')
const reporting = ref(false)
const makeCurrent = ref(false)
const report = reactive({ done: '', next: '', why: '' })
const anchor = ref<{ id: string; text: string } | null>(null)
const composer = ref<HTMLFormElement | null>(null)

useDraftSource('comment', () => Boolean(note.value.trim()))
useDraftSource('report', () => reporting.value && Boolean(report.done || report.next || report.why))

async function revealComposer(identity: string) {
  await nextTick()
  if (props.item.work_item_id !== identity || !props.writable) return
  composer.value?.focus({ preventScroll: true })
  composer.value?.scrollIntoView?.({ block: 'nearest' })
}
async function discussStep(stepId: string) {
  if (!props.writable || pending.value) return
  const step = props.item.checklist.find((entry) => entry.id === stepId)
  if (!step) return
  anchor.value = { id: step.id, text: step.text }
  reporting.value = false
  await revealComposer(props.item.work_item_id)
}
/** A work report that becomes the item's outcome: what closing the item asks for. */
async function startReport() {
  if (!props.writable || pending.value) return
  anchor.value = null
  reporting.value = true
  makeCurrent.value = true
  await revealComposer(props.item.work_item_id)
}
function removeAnchor() {
  anchor.value = null
}
function anchorState(id: string, text: string | null | undefined) {
  const step = props.item.checklist.find((entry) => entry.id === id)
  if (!step) return 'removed'
  return step.text === text ? 'current' : 'changed'
}
function quoteLabel(id: string, text: string | null | undefined) {
  return t(`checklistComment.${anchorState(id, text)}`)
}
const anchorHint = computed(() => {
  if (!anchor.value) return ''
  const state = anchorState(anchor.value.id, anchor.value.text)
  return state === 'current' ? '' : t(`checklistComment.${state}Hint`)
})
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
watch(
  () => props.item.work_item_id,
  () => {
    note.value = ''
    reporting.value = false
    makeCurrent.value = false
    anchor.value = null
    Object.assign(report, { done: '', next: '', why: '' })
  },
)
const { pending, errorKey, errorReason, submit } = useInspectorMutation(
  () => props.item.work_item_id,
  () => emit('changed'),
)
const canSend = computed(() =>
  reporting.value ? Boolean(report.done.trim() && report.next.trim()) : Boolean(note.value.trim()),
)
const publishLabel = computed(() =>
  t(reporting.value ? 'workItem.publishReport' : 'workItem.noteSend'),
)
function reportLabel(commentId: number) {
  return t(
    commentId === props.item.summary_comment_id ? 'workItem.currentOutcome' : 'workItem.workReport',
  )
}
function when(value: string | null) {
  if (value === null) return t('workItem.unknownTime')
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}
function publish() {
  if (!props.writable || !canSend.value) return
  const id = props.item.work_item_id
  if (reporting.value) {
    void submit(
      () =>
        publishWorkItemReport({
          id,
          report: { ...report },
          make_current: makeCurrent.value,
          ...(makeCurrent.value ? { expected_revision: props.item.revision } : {}),
        }),
      () => {
        Object.assign(report, { done: '', next: '', why: '' })
        makeCurrent.value = false
      },
    )
  } else {
    const target = anchor.value?.id
    void submit(
      () =>
        commentWorkItem({
          id,
          body: note.value.trim(),
          ...(target ? { checklist_item_id: target } : {}),
        }),
      () => {
        note.value = ''
        anchor.value = null
      },
    )
  }
}
function select(commentId: number) {
  if (!props.writable) return
  void submit(() =>
    selectWorkItemSummary({
      id: props.item.work_item_id,
      comment_id: commentId,
      expected_revision: props.item.revision,
    }),
  )
}
defineExpose({ discussStep, startReport })
</script>

<template>
  <section class="discussion">
    <SectionHeader
      :title="t('workItem.discussion')"
      :count="item.comments.length || ''"
    />
    <form
      v-if="writable"
      ref="composer"
      class="discussion-form"
      tabindex="-1"
      :aria-label="t('checklistComment.composer')"
      @submit.prevent="publish"
    >
      <div
        v-if="anchor"
        class="step-context"
      >
        <strong>{{ t('checklistComment.linked') }}</strong>
        <blockquote class="step-quote">
          <span>{{ quoteLabel(anchor.id, anchor.text) }}</span>
          <p class="discussion-body">{{ anchor.text }}</p>
        </blockquote>
        <p
          v-if="anchorHint"
          class="discussion-empty"
        >
          {{ anchorHint }}
        </p>
        <VButton
          class="discussion-action"
          :disabled="pending"
          @click="removeAnchor"
          >{{ t('checklistComment.remove') }}</VButton
        >
        <p class="discussion-empty">{{ t('checklistComment.reportHint') }}</p>
      </div>
      <label class="discussion-option"
        ><input
          v-model="reporting"
          type="checkbox"
          :disabled="pending || Boolean(anchor)"
        />{{ t('workItem.workReport') }}</label
      >
      <template v-if="reporting">
        <VTextInput
          v-model="report.done"
          :label="t('workItem.summaryDone')"
          :rows="3"
          :maxlength="4000"
          :disabled="pending"
        />
        <VTextInput
          v-model="report.why"
          :label="t('workItem.summaryWhy')"
          :hint="t('workItem.summaryWhyHint')"
          :rows="2"
          :maxlength="4000"
          :disabled="pending"
        />
        <VTextInput
          v-model="report.next"
          :label="t('workItem.summaryNext')"
          :rows="3"
          :maxlength="4000"
          :disabled="pending"
        />
        <label class="discussion-option"
          ><input
            v-model="makeCurrent"
            type="checkbox"
            :disabled="pending"
          />{{ t('workItem.makeOutcome') }}</label
        >
      </template>
      <VTextInput
        v-else
        v-model="note"
        :label="t('workItem.comment')"
        :rows="3"
        :maxlength="8000"
        :disabled="pending"
      />
      <p
        v-if="errorKey"
        class="discussion-error"
        role="alert"
      >
        {{ t(errorKey) }}
        <span
          v-if="errorReason"
          class="discussion-reason"
          >{{ errorReason }}</span
        >
      </p>
      <div class="discussion-actions">
        <VButton
          class="discussion-action"
          type="submit"
          variant="primary"
          :disabled="pending || !canSend"
          >{{ publishLabel }}</VButton
        >
        <VButton
          v-if="errorKey"
          class="discussion-action"
          :disabled="pending"
          @click="emit('refresh')"
          >{{ t('workItem.refreshDraft') }}</VButton
        >
      </div>
    </form>
    <ol
      v-if="item.comments.length"
      class="discussion-feed"
    >
      <li
        v-for="entry in comments"
        :id="`work-report-${entry.id}`"
        :key="entry.id"
        class="discussion-entry"
        tabindex="-1"
      >
        <div class="discussion-meta">
          <span
            >{{ actorName(entry.author) || t('workItem.unknownAuthor') }}
            <span v-if="actorSession(entry.author)">{{ actorSession(entry.author) }}</span></span
          >
          <span>{{ when(entry.at) }}</span>
        </div>
        <template v-if="entry.kind === 'report' && entry.report">
          <strong class="discussion-label">{{ reportLabel(entry.id) }}</strong>
          <InspectorReport :report="entry.report" />
          <VButton
            v-if="writable && entry.id !== item.summary_comment_id"
            class="discussion-action"
            :disabled="pending"
            @click="select(entry.id)"
            >{{ t('workItem.makeOutcome') }}</VButton
          >
        </template>
        <blockquote
          v-if="entry.kind === 'comment' && entry.checklist_item_id"
          class="step-quote"
        >
          <strong>{{ quoteLabel(entry.checklist_item_id, entry.checklist_item_text) }}</strong>
          <p class="discussion-body">{{ entry.checklist_item_text }}</p>
        </blockquote>
        <CollapsibleText
          v-if="entry.kind === 'comment'"
          class="discussion-body"
          :text="entry.body"
        />
      </li>
    </ol>
    <p
      v-else
      class="discussion-empty"
    >
      {{ t('workItem.noDiscussion') }}
    </p>
  </section>
</template>

<style scoped>
.discussion {
  display: grid;
  gap: var(--space-heading-content);
}

.discussion-feed {
  display: grid;
  gap: var(--space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

/* A sheet on the drawer's ground: the card is visible, so its padding reads
   as the card's inset rather than as text shifted off the column. */
.discussion-entry {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--color-surface-sheet);
  border-radius: var(--radius-card);
  scroll-margin-top: var(--space-4);
}

.discussion-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: space-between;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.discussion-label {
  font: var(--font-strong);
}

.discussion-body {
  margin: 0;
  font: var(--font-editor);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.discussion-empty {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.discussion-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}

.discussion-reason {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
}

/* The composer leads the section and the thread starts under its rule. */
.discussion-form {
  display: grid;
  gap: var(--space-3);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-rule);
}

.discussion-option {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  font: var(--font-line);
}

.discussion-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.discussion-action {
  justify-self: start;
}

.step-context,
.step-quote {
  display: grid;
  gap: var(--space-2);
}

.step-quote {
  padding-inline-start: var(--space-3);
  margin: 0;
  border-inline-start: 1px solid var(--color-rule-strong);
  color: var(--color-text-muted);
  font: var(--font-line);
}
</style>
