<script setup lang="ts">
/**
 * Comments and work reports on one item, and the composer for the next comment.
 *
 * The composer comes first and the newest entry right under it. It used to sit
 * after every entry ever written, oldest first, so writing a comment on a busy
 * item began with scrolling past all of them, and the latest report — the one a
 * reader came for — was the last thing on the page. The thread itself is
 * `InspectorThread`.
 *
 * A person writes comments here, in the shared markdown editor. Work reports are
 * how agents write, through their tools, and the thread shows them. The form
 * used to offer a report as a second kind of entry, and nobody at the keyboard
 * wanted one: the one report a person writes is the outcome a closing move asks
 * for, so `askOutcome`, which only that refusal reaches, puts
 * `InspectorOutcomeForm` where the composer stands until it is answered.
 *
 * What is written in that form is text nobody has anywhere else, so only sending it
 * or answering the question before leaving lets it go. A step back to the comment
 * keeps it, and the comment then offers the way back to it, so that the question
 * never asks about something the reader cannot find.
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorOutcomeForm from '@/widgets/work-item-inspector/components/InspectorOutcomeForm.vue'
import InspectorThread from '@/widgets/work-item-inspector/components/InspectorThread.vue'
import { anchorState } from '@/widgets/work-item-inspector/utils/checklistAnchor.ts'
import { useDraftSource } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'
import { useInspectorMutation } from '@/widgets/work-item-inspector/utils/useInspectorMutation.ts'
import type { StateMove } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'

import {
  commentWorkItem,
  publishWorkItemReport,
  selectWorkItemSummary,
} from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { workItemSuggest } from '@/shared/lib/workItemSuggest.ts'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ item: WorkItem; writable: boolean }>()
const emit = defineEmits<{ changed: []; refresh: []; resume: [stateKey: string] }>()
const { t } = useI18n()
const note = ref('')
const previewing = ref(false)
const anchor = ref<{ id: string; text: string } | null>(null)
const composer = ref<HTMLFormElement | null>(null)
/** The move waiting on an outcome, while the outcome form stands in the composer's place. */
const closing = ref<StateMove | null>(null)
/** The move an unsent outcome was written for, once the form has made way for the comment. */
const held = ref<StateMove | null>(null)
const outcome = reactive({ done: '', next: '' })
const outcomeForm = ref<InstanceType<typeof InspectorOutcomeForm> | null>(null)

const suggest = workItemSuggest(
  () => props.item.planning_space_id,
  () => props.item.work_item_id,
)

useDraftSource('comment', () => Boolean(note.value.trim()))
useDraftSource('outcome', () => Boolean(outcome.done || outcome.next))

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
  stepAside()
  await revealComposer(props.item.work_item_id)
}
/** The outcome a refused closing move needs, written here and then carried on. */
async function askOutcome(move: StateMove) {
  if (!props.writable || pending.value) return
  closing.value = move
  held.value = null
  const identity = props.item.work_item_id
  await nextTick()
  if (props.item.work_item_id === identity) outcomeForm.value?.reveal()
}
/** The form makes way for the comment, and what is written in it stays, if anything is. */
function stepAside() {
  if (outcome.done || outcome.next) held.value = closing.value ?? held.value
  closing.value = null
}
function backToComment() {
  stepAside()
  void revealComposer(props.item.work_item_id)
}
function resumeOutcome() {
  if (held.value) void askOutcome(held.value)
}
function removeAnchor() {
  anchor.value = null
}
/** How the step this comment is about stands now, which the quote and its hint say. */
const anchorStanding = computed(() =>
  anchor.value ? anchorState(props.item, anchor.value.id, anchor.value.text) : 'current',
)
const anchorLabel = computed(() =>
  anchorStanding.value === 'current'
    ? t('checklistComment.linked')
    : t(`checklistComment.${anchorStanding.value}`),
)
const anchorHint = computed(() =>
  anchorStanding.value === 'current' ? '' : t(`checklistComment.${anchorStanding.value}Hint`),
)
watch(
  () => props.item.work_item_id,
  () => {
    note.value = ''
    previewing.value = false
    anchor.value = null
    closing.value = null
    held.value = null
    Object.assign(outcome, { done: '', next: '' })
  },
)
const { pending, error, submit } = useInspectorMutation(
  () => props.item.work_item_id,
  () => emit('changed'),
)
const canSend = computed(() => Boolean(note.value.trim()))
function publish() {
  if (!props.writable || !canSend.value) return
  const id = props.item.work_item_id
  const target = anchor.value?.id
  void submit(
    () =>
      commentWorkItem({
        id,
        body: note.value,
        ...(target ? { checklist_item_id: target } : {}),
      }),
    () => {
      note.value = ''
      anchor.value = null
      previewing.value = false
    },
  )
}
/**
 * A write that takes away the control holding focus leaves focus on the page. It comes
 * to the comment standing there now, once that stands: a move carried on keeps the card
 * unwritable, and the comment away, until it is through.
 */
let focusOwed = false
function payFocus() {
  if (!focusOwed || !composer.value) return
  focusOwed = false
  if (document.activeElement === document.body) composer.value.focus({ preventScroll: true })
}
watch(composer, payFocus, { flush: 'post' })
function oweFocus() {
  focusOwed = true
  void nextTick(payFocus)
}
/**
 * The text is sent, so it is done with, and the move it was written for goes on. A
 * report made the outcome meanwhile may have carried that move already.
 */
function outcomeSent() {
  const move = closing.value
  closing.value = null
  held.value = null
  Object.assign(outcome, { done: '', next: '' })
  oweFocus()
  if (move && move.key !== props.item.state.key) emit('resume', move.key)
}
/** A report made the outcome answers the form's question and leaves what is written in it. */
function reportSelected() {
  const move = closing.value
  stepAside()
  oweFocus()
  if (move) emit('resume', move.key)
}
function publishOutcome() {
  if (!props.writable) return
  void submit(
    () =>
      publishWorkItemReport({
        id: props.item.work_item_id,
        report: { ...outcome },
        make_current: true,
        expected_revision: props.item.revision,
      }),
    outcomeSent,
  )
}
function select(commentId: number) {
  if (!props.writable) return
  void submit(
    () =>
      selectWorkItemSummary({
        id: props.item.work_item_id,
        comment_id: commentId,
        expected_revision: props.item.revision,
      }),
    reportSelected,
  )
}
defineExpose({ askOutcome, discussStep })
</script>

<template>
  <section class="discussion">
    <SectionHeader
      :title="t('workItem.discussion')"
      :count="item.comments.length || ''"
    />
    <InspectorOutcomeForm
      v-if="writable && closing"
      ref="outcomeForm"
      v-model:done="outcome.done"
      v-model:next="outcome.next"
      :closing="closing.name"
      :error="error"
      :pending="pending"
      :suggest="suggest"
      @back="backToComment"
      @refresh="emit('refresh')"
      @submit="publishOutcome"
    />
    <form
      v-else-if="writable"
      ref="composer"
      class="discussion-form"
      tabindex="-1"
      :aria-label="t('checklistComment.composer')"
      @submit.prevent="publish"
    >
      <VButton
        v-if="held"
        class="held-outcome"
        variant="ghost"
        size="inline"
        :disabled="pending"
        @click="resumeOutcome"
        >{{ t('workItem.closing.resume') }}</VButton
      >
      <div
        v-if="anchor"
        class="step-context"
      >
        <div class="step-head">
          <strong class="step-label">{{ anchorLabel }}</strong>
          <VButton
            variant="ghost"
            size="inline"
            :disabled="pending"
            @click="removeAnchor"
            >{{ t('checklistComment.remove') }}</VButton
          >
        </div>
        <blockquote class="step-quote">
          <p class="discussion-body">{{ anchor.text }}</p>
        </blockquote>
        <p
          v-if="anchorHint"
          class="discussion-empty"
        >
          {{ anchorHint }}
        </p>
      </div>
      <MarkdownEditor
        v-model="note"
        v-model:preview="previewing"
        :label="t('workItem.comment')"
        :placeholder="t('checklistComment.composer')"
        :suggest="suggest"
        :rows="5"
        :maxlength="8000"
        :disabled="pending"
        :error="error"
        hide-label
        @submit="publish"
      >
        <template #actions>
          <VButton
            v-if="error"
            :disabled="pending"
            @click="emit('refresh')"
            >{{ t('workItem.refreshDraft') }}</VButton
          >
          <VButton
            type="submit"
            variant="primary"
            :disabled="pending || !canSend"
            >{{ t('workItem.noteSend') }}</VButton
          >
        </template>
      </MarkdownEditor>
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

.discussion-form {
  display: grid;
  gap: var(--space-3);
}

.held-outcome {
  justify-self: start;
}

.step-context {
  display: grid;
  gap: var(--space-1);
}

.step-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  justify-content: space-between;
  align-items: center;
}

.step-label {
  font: var(--font-strong);
}

.step-quote {
  padding-inline-start: var(--space-3);
  margin: 0;
  border-inline-start: 1px solid var(--color-rule-strong);
  color: var(--color-text-muted);
}
</style>
