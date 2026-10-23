<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorReport from '@/widgets/work-item-inspector/components/InspectorReport.vue'
import { useInspectorMutation } from '@/widgets/work-item-inspector/utils/useInspectorMutation.ts'

import {
  commentWorkItem,
  publishWorkItemReport,
  selectWorkItemSummary,
} from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{ item: WorkItem; writable: boolean }>()
const emit = defineEmits<{ changed: []; refresh: [] }>()
const { t, d } = useI18n()
const note = ref('')
const reporting = ref(false)
const makeCurrent = ref(false)
const report = reactive({ done: '', next: '', why: '' })
function commentTime(at: string | null) {
  const time = at === null ? Number.NaN : Date.parse(at)
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time
}
const comments = computed(() =>
  [...props.item.comments].sort(
    (left, right) => commentTime(left.at) - commentTime(right.at) || left.id - right.id,
  ),
)
watch(
  () => props.item.work_item_id,
  () => {
    note.value = ''
    reporting.value = false
    makeCurrent.value = false
    Object.assign(report, { done: '', next: '', why: '' })
  },
)
const { pending, errorKey, submit } = useInspectorMutation(
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
    void submit(
      () => commentWorkItem({ id, body: note.value.trim() }),
      () => {
        note.value = ''
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
</script>

<template>
  <section class="discussion">
    <SectionHeading
      as="h3"
      level="panel"
      >{{ t('workItem.discussion') }}</SectionHeading
    >
    <ol
      v-if="item.comments.length"
      class="discussion-feed"
    >
      <li
        v-for="entry in comments"
        :id="`work-report-${entry.id}`"
        :key="entry.id"
        class="discussion-entry"
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
        <p
          v-else
          class="discussion-body"
        >
          {{ entry.body }}
        </p>
      </li>
    </ol>
    <p
      v-else
      class="discussion-empty"
    >
      {{ t('workItem.noDiscussion') }}
    </p>
    <p
      v-if="errorKey"
      class="discussion-error"
      role="alert"
    >
      {{ t(errorKey) }}
    </p>
    <VButton
      v-if="errorKey && writable"
      class="discussion-action"
      :disabled="pending"
      @click="emit('refresh')"
      >{{ t('workItem.refreshDraft') }}</VButton
    >
    <form
      v-if="writable"
      class="discussion-form"
      @submit.prevent="publish"
    >
      <label class="discussion-option"
        ><input
          v-model="reporting"
          type="checkbox"
          :disabled="pending"
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
      <VButton
        class="discussion-action"
        type="submit"
        variant="primary"
        :disabled="pending || !canSend"
        >{{ publishLabel }}</VButton
      >
    </form>
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
  font: var(--font-line);
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

.discussion-form {
  display: grid;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-rule);
}

.discussion-option {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  font: var(--font-line);
}

.discussion-action {
  justify-self: start;
}
</style>
