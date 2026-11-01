<script setup lang="ts">
/**
 * Comments and work reports on one item, and the composer for the next one.
 *
 * The composer comes first and the newest entry right under it. It used to sit
 * after every entry ever written, oldest first, so writing a comment on a busy
 * item began with scrolling past all of them, and the latest report — the one a
 * reader came for — was the last thing on the page. The thread itself is
 * `InspectorThread`.
 *
 * The composer writes one of two things, chosen up front: a comment, which is
 * free markdown, or a work report, which is a template of three sections the
 * server keeps apart (what was done, why, what next). Both are written in the
 * shared markdown editor — a preview of exactly what the thread will show, `#`
 * to link a task of this space, Ctrl+Enter to send.
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorThread from '@/widgets/work-item-inspector/components/InspectorThread.vue'
import { anchorState } from '@/widgets/work-item-inspector/utils/checklistAnchor.ts'
import { useDraftSource } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'
import { useInspectorMutation } from '@/widgets/work-item-inspector/utils/useInspectorMutation.ts'
import { workItemSuggest } from '@/widgets/work-item-inspector/utils/workItemSuggest.ts'

import {
  commentWorkItem,
  publishWorkItemReport,
  selectWorkItemSummary,
} from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ item: WorkItem; writable: boolean }>()
const emit = defineEmits<{ changed: []; refresh: [] }>()
const { t } = useI18n()
const note = ref('')
const reporting = ref(false)
const previewing = ref(false)
const makeCurrent = ref(false)
const report = reactive({ done: '', next: '', why: '' })
const anchor = ref<{ id: string; text: string } | null>(null)
const composer = ref<HTMLFormElement | null>(null)

const suggest = workItemSuggest(() => props.item)
/** Comment or report, as one choice; a comment on a step cannot be a report. */
const kind = computed({
  get: () => (reporting.value ? 'report' : 'comment'),
  set: (value: 'comment' | 'report') => {
    reporting.value = value === 'report'
  },
})
const kinds = computed(() => [
  { value: 'comment' as const, label: t('workItem.comment') },
  { value: 'report' as const, label: t('workItem.workReport'), disabled: Boolean(anchor.value) },
])
const view = computed({
  get: () => (previewing.value ? 'preview' : 'write'),
  set: (value: 'preview' | 'write') => {
    previewing.value = value === 'preview'
  },
})
const views = computed(() => [
  { value: 'write' as const, label: t('editor.write') },
  { value: 'preview' as const, label: t('editor.preview') },
])

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
/** How the step this comment is about stands now, which the quote and its hint say. */
const anchorStanding = computed(() =>
  anchor.value ? anchorState(props.item, anchor.value.id, anchor.value.text) : 'current',
)
const anchorHint = computed(() =>
  anchorStanding.value === 'current' ? '' : t(`checklistComment.${anchorStanding.value}Hint`),
)
watch(
  () => props.item.work_item_id,
  () => {
    note.value = ''
    reporting.value = false
    previewing.value = false
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
        previewing.value = false
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
        previewing.value = false
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
          <span>{{ t(`checklistComment.${anchorStanding}`) }}</span>
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
      <div class="discussion-toolbar">
        <SegmentedControl
          v-model="kind"
          size="compact"
          :label="t('editor.kind')"
          :options="kinds"
        />
        <SegmentedControl
          v-model="view"
          size="compact"
          :label="t('editor.view')"
          :options="views"
        />
      </div>
      <template v-if="reporting">
        <MarkdownEditor
          v-model="report.done"
          :label="t('workItem.summaryDone')"
          :action="publishLabel"
          :hint="false"
          :preview="previewing"
          :suggest="suggest"
          :rows="3"
          :maxlength="4000"
          :disabled="pending"
          @submit="publish"
        />
        <MarkdownEditor
          v-model="report.why"
          :label="t('workItem.summaryWhy')"
          :action="publishLabel"
          :hint="t('workItem.summaryWhyHint')"
          :preview="previewing"
          :suggest="suggest"
          :rows="2"
          :maxlength="4000"
          :disabled="pending"
          @submit="publish"
        />
        <MarkdownEditor
          v-model="report.next"
          :label="t('workItem.summaryNext')"
          :action="publishLabel"
          :preview="previewing"
          :suggest="suggest"
          :rows="3"
          :maxlength="4000"
          :disabled="pending"
          @submit="publish"
        />
        <label class="discussion-option"
          ><input
            v-model="makeCurrent"
            type="checkbox"
            :disabled="pending"
          />{{ t('workItem.makeOutcome') }}</label
        >
      </template>
      <MarkdownEditor
        v-else
        v-model="note"
        :label="t('workItem.comment')"
        :action="publishLabel"
        :preview="previewing"
        :suggest="suggest"
        :rows="3"
        :maxlength="8000"
        :disabled="pending"
        @submit="publish"
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
    <InspectorThread
      :item="item"
      :pending="pending"
      :writable="writable"
      @select="select"
    />
  </section>
</template>

<style scoped>
.discussion {
  display: grid;
  gap: var(--space-heading-content);
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

/* What is written and how it is looked at, one row: the two choices are made
   before the text, so they lead it, and they are two groups, so they stand
   apart. */
.discussion-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: space-between;
  align-items: center;
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
