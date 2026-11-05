<script setup lang="ts">
/**
 * One thread under a comment or a report: the root as a sheet, what can be done to it, and
 * its replies.
 *
 * The whole thread is one `article`, named by the root's meta line and, once marked, by the
 * mark. A resolved one folds to the mark and the first line of the root, unless a form was
 * left open in it: the words in there outrank the fold. Folding takes away what held focus,
 * whoever marked it, so focus goes to the article, the element that stays.
 *
 * What can be done to the root stands on its head as icons, read from the right: the mark,
 * replying, making steps of its list where it has one, and on a report making it the
 * outcome, so the first two never move. The mark's
 * icon names what a press will do, and the line of the mark says how the thread stands.
 */
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorEntrySteps from '@/widgets/work-item-inspector/components/InspectorEntrySteps.vue'
import InspectorReport from '@/widgets/work-item-inspector/components/InspectorReport.vue'
import InspectorStepsAction from '@/widgets/work-item-inspector/components/InspectorStepsAction.vue'
import InspectorThreadReplies from '@/widgets/work-item-inspector/components/InspectorThreadReplies.vue'
import { anchorState } from '@/widgets/work-item-inspector/utils/checklistAnchor.ts'
import type { ThreadRow } from '@/widgets/work-item-inspector/utils/threadRows.ts'
import {
  entryAnchor,
  injectThreadForms,
  replyAnchor,
  resolveAnchor,
} from '@/widgets/work-item-inspector/utils/useThreadForms.ts'

import ResolveForm from '@/features/discussion-thread/components/ResolveForm.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { referenceSpaceKey } from '@/shared/lib/referenceLinks.ts'
import { plainText } from '@/shared/lib/richText.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import EntryAction from '@/shared/ui/EntryAction.vue'
import EntryHead from '@/shared/ui/EntryHead.vue'
import type MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import MetaLine from '@/shared/ui/MetaLine.vue'

const props = withDefaults(
  defineProps<{
    fresh: boolean
    item: WorkItem
    pending: boolean
    row: Extract<ThreadRow, { kind: 'comment' }>
    writable: boolean
    suggest?: InstanceType<typeof MarkdownEditor>['$props']['suggest']
    when: (value: string | null) => string
  }>(),
  { suggest: undefined },
)
const emit = defineEmits<{ refresh: []; select: [commentId: number] }>()
const { t } = useI18n()
const {
  cancel,
  decisions,
  errorAt,
  expanded,
  hasDraft,
  isOpen,
  pending: writing,
  sendReopen,
  sendResolve,
  show,
  toggle,
} = injectThreadForms()

const metaId = useId()
const markId = useId()
const entry = ref<HTMLElement | null>(null)
const root = computed(() => props.row.comment)
const key = computed(() => props.row.key)
const mark = computed(() => root.value.resolution)
const busy = computed(() => props.pending || writing.value)
const formOpen = computed(() => isOpen(key.value))
const resolving = computed(() => isOpen(key.value, 'resolve'))
const folded = computed(
  () => Boolean(mark.value) && !expanded.value.has(key.value) && !formOpen.value,
)
const labelledBy = computed(() => (mark.value ? `${markId} ${metaId}` : metaId))
const entryId = computed(() => entryAnchor(root.value.id))
const replyId = computed(() => replyAnchor(key.value))
const resolveId = computed(() => resolveAnchor(key.value))
const resolveError = computed(() => errorAt(key.value, 'resolve'))
const reopenError = computed(() => errorAt(key.value, 'reopen'))
const decision = computed({
  get: () => decisions.value[key.value] ?? '',
  set: (value) => (decisions.value[key.value] = value),
})
const parent = computed(() => ({ reply_to: root.value.id }))

const isOutcome = computed(() => root.value.id === props.item.summary_comment_id)
const reportLabel = computed(() =>
  t(isOutcome.value ? 'workItem.currentOutcome' : 'workItem.workReport'),
)
const quoteLabel = computed(() => {
  const standing = anchorState(
    props.item,
    root.value.checklist_item_id ?? '',
    root.value.checklist_item_text,
  )
  return t(`checklistComment.${standing}`)
})
const authorName = computed(() =>
  root.value.by_person === true
    ? t('threads.you')
    : actorName(root.value.author) || t('workItem.unknownAuthor'),
)
const authorSession = computed(() =>
  root.value.by_person === true ? '' : actorSession(root.value.author),
)
const markLine = computed(() => {
  const given = mark.value
  if (!given) return ''
  const who = given.by_person === true ? t('threads.you') : actorName(given.by)
  const when = props.when(given.at)
  return given.text
    ? t('threads.resolvedWith', { who, when, decision: given.text })
    : t('threads.resolvedLine', { who, when })
})
const foldToggleLabel = computed(() => t(folded.value ? 'threads.expand' : 'threads.collapse'))
const foldToggleIcon = computed(() => (folded.value ? 'chevron-down' : 'chevron-up'))
const expandedMark = computed(() => !folded.value)
const resolveIcon = computed(() => (mark.value ? 'reopen' : 'resolve'))
const resolveLabel = computed(() => t(mark.value ? 'threads.reopen' : 'threads.resolve'))
const firstLine = computed(() =>
  plainText(root.value.report ? root.value.report.done : root.value.body),
)
const replyCount = computed(() =>
  props.row.replies.length ? t('threads.replyCount', props.row.replies.length) : '',
)
/** A reply newer than the mark says the thread was spoken in since someone closed it. */
const replyAfterMark = computed(() => {
  const given = mark.value
  if (!given) return false
  const marked = Date.parse(given.at)
  return props.row.replies.some((reply) => reply.at !== null && Date.parse(reply.at) > marked)
})
const canMark = computed(() => !mark.value)
/** What a reader of the thread should know about it, each said in words. */
const flags = computed(() => [
  ...(replyAfterMark.value ? [t('threads.replyAfterMark')] : []),
  ...(props.fresh ? [t('threads.newReply')] : []),
  ...(hasDraft(key.value) && !formOpen.value ? [t('threads.draft')] : []),
])
const hasFlags = computed(() => flags.value.length > 0)

watch(
  folded,
  async (now) => {
    if (!now || !entry.value?.contains(document.activeElement)) return
    await nextTick()
    moveFocus(entry.value)
  },
  { flush: 'pre' },
)
function pressResolve(press: Event) {
  if (mark.value) sendReopen(key.value, root.value.id)
  else show(key.value, 'resolve', press)
}
function pressReply(press: Event) {
  show(key.value, 'reply', press)
}
function pressFold() {
  toggle(key.value)
}
function sendMark() {
  sendResolve(key.value, root.value.id)
}
</script>

<template>
  <article
    :id="entryId"
    ref="entry"
    tabindex="-1"
    class="thread-entry"
    :class="{ 'is-folded': folded }"
    :aria-labelledby="labelledBy"
  >
    <EntryHead v-if="mark">
      <p
        :id="markId"
        class="thread-mark"
      >
        {{ markLine }}
      </p>
      <template
        v-if="!formOpen"
        #actions
      >
        <EntryAction
          :aria-expanded="expandedMark"
          :icon="foldToggleIcon"
          :label="foldToggleLabel"
          @click="pressFold"
        />
      </template>
    </EntryHead>
    <template v-if="folded">
      <p class="thread-first">
        <span
          :id="metaId"
          class="thread-first-meta"
          >{{ authorName }} · {{ when(root.at) }}</span
        >
        · {{ firstLine }}
      </p>
      <div
        v-if="replyCount || hasFlags"
        class="thread-flags"
      >
        <span
          v-if="replyCount"
          class="thread-flag"
          >{{ replyCount }}</span
        >
        <span
          v-for="flag in flags"
          :key="flag"
          class="thread-flag"
          >{{ flag }}</span
        >
      </div>
    </template>
    <template v-else>
      <EntryHead>
        <MetaLine
          :id="metaId"
          class="thread-meta"
          :when="when(root.at)"
          >{{ authorName }} <span v-if="authorSession">{{ authorSession }}</span></MetaLine
        >
        <template
          v-if="writable"
          #actions
        >
          <EntryAction
            v-if="root.kind === 'report' && root.report && !isOutcome"
            icon="outcome"
            :disabled="busy"
            :label="t('workItem.makeOutcome')"
            @click="emit('select', root.id)"
          />
          <InspectorStepsAction
            :busy="busy"
            :entry="root"
            :thread-key="key"
          />
          <EntryAction
            :id="replyId"
            icon="reply"
            :disabled="busy"
            :label="t('threads.reply')"
            @click="pressReply"
          />
          <EntryAction
            :id="resolveId"
            :disabled="busy"
            :icon="resolveIcon"
            :label="resolveLabel"
            @click="pressResolve"
          />
        </template>
      </EntryHead>
      <template v-if="root.kind === 'report' && root.report">
        <strong class="thread-label">{{ reportLabel }}</strong>
        <CollapsibleText
          class="thread-text"
          :reset-key="root.id"
          :lines="10"
        >
          <InspectorReport :report="root.report" />
        </CollapsibleText>
      </template>
      <blockquote
        v-if="root.kind === 'comment' && root.checklist_item_id"
        class="thread-quote"
      >
        <strong>{{ quoteLabel }}</strong>
        <p class="thread-quote-text">{{ root.checklist_item_text }}</p>
      </blockquote>
      <CollapsibleText
        v-if="root.kind === 'comment'"
        class="thread-text"
        :text="root.body"
      />
      <div
        v-if="hasFlags"
        class="thread-flags"
      >
        <span
          v-for="flag in flags"
          :key="flag"
          class="thread-flag"
          >{{ flag }}</span
        >
      </div>
      <p
        v-if="reopenError"
        class="thread-error"
        role="alert"
      >
        {{ reopenError }}
      </p>
      <InspectorEntrySteps
        :busy="busy"
        :entry="root"
        :thread-key="key"
      />
      <ResolveForm
        v-if="resolving"
        v-model:text="decision"
        :error="resolveError"
        :pending="busy"
        :space-key="referenceSpaceKey(item.reference)"
        @cancel="cancel"
        @refresh="emit('refresh')"
        @submit="sendMark"
      />
      <InspectorThreadReplies
        :busy="busy"
        :can-mark="canMark"
        :parent="parent"
        :replies="row.replies"
        :root="root.id"
        :suggest="suggest"
        :thread-key="key"
        :when="when"
        :writable="writable"
        @refresh="emit('refresh')"
      />
    </template>
  </article>
</template>

<style scoped>
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

  &:focus-visible {
    outline-offset: var(--space-half);
  }

  /* A forced palette clears the sheet, and with it where one thread ends. */
  @media (forced-colors: active) {
    &:not(:focus-visible) {
      outline: 1px solid;
      outline-offset: -1px;
    }
  }
}

.thread-label {
  font: var(--font-strong);
}

.thread-text {
  font: var(--font-editor);
}

.thread-flags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  align-items: center;
  min-width: 0;
}

.thread-flag {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.thread-mark {
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

/* One line of the root: the fold says what the thread was about and no more. */
.thread-first {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.thread-first-meta {
  color: var(--color-text-tertiary);
}

.thread-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}

.thread-quote {
  display: grid;
  gap: var(--space-2);
  padding-inline-start: var(--space-set-in);
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
</style>
