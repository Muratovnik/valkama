<script setup lang="ts">
/**
 * What stands under the root of a thread: its replies, the field for the next one, and
 * the line saying a reply went through and its mark did not.
 *
 * A thread of four or more shows its last two until asked, and the button asks in place;
 * what it opens takes focus, so the reader lands on the first reply they had not seen.
 */
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ThreadComment } from '@/widgets/work-item-inspector/utils/threadRows.ts'
import {
  injectThreadForms,
  writtenAnchor,
} from '@/widgets/work-item-inspector/utils/useThreadForms.ts'

import ReplyComposer from '@/features/discussion-thread/components/ReplyComposer.vue'
import type { ThreadParent } from '@/features/discussion-thread/composables/useThreadWrites.ts'

import { actorName, actorSession } from '@/shared/lib/actor.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import type MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    canMark: boolean
    parent: ThreadParent | null
    replies: readonly ThreadComment[]
    /** The root the mark goes on, when this thread's root can carry one. */
    root: number | null
    threadKey: string
    suggest?: InstanceType<typeof MarkdownEditor>['$props']['suggest']
    when: (value: string | null) => string
  }>(),
  { suggest: undefined },
)
const emit = defineEmits<{ refresh: [] }>()
const { t } = useI18n()
const {
  cancel,
  errorAt,
  isOpen,
  markAgain,
  marks,
  pending,
  replies: drafts,
  sendReply,
  unmarked,
} = injectThreadForms()

const SHOWN_WHEN_HELD = 2
const HELD_FROM = 4
const listId = useId()
const list = ref<HTMLElement | null>(null)
const showingAll = ref(false)
const held = computed(() => props.replies.length >= HELD_FROM)
const shown = computed(() =>
  held.value && !showingAll.value ? props.replies.slice(-SHOWN_WHEN_HELD) : props.replies,
)
const toggleLabel = computed(() =>
  showingAll.value
    ? t('threads.hideEarlier')
    : t('threads.showMore', props.replies.length - SHOWN_WHEN_HELD),
)
const failedMark = computed(() => props.root !== null && unmarked.value.has(props.root))
const writing = computed(() => isOpen(props.threadKey, 'reply'))
const replyError = computed(() => errorAt(props.threadKey, 'reply'))
const text = computed({
  get: () => drafts.value[props.threadKey] ?? '',
  set: (value) => (drafts.value[props.threadKey] = value),
})
const mark = computed({
  get: () => marks.value[props.threadKey] ?? false,
  set: (value) => (marks.value[props.threadKey] = value),
})

async function toggleAll() {
  showingAll.value = !showingAll.value
  if (!showingAll.value) return
  await nextTick()
  moveFocus(list.value?.querySelector<HTMLElement>('li'))
}
function authorOf(reply: ThreadComment) {
  return reply.by_person === true
    ? t('threads.you')
    : actorName(reply.author) || t('workItem.unknownAuthor')
}
function sessionOf(reply: ThreadComment) {
  return reply.by_person === true ? '' : actorSession(reply.author)
}
function send() {
  if (props.parent) sendReply(props.threadKey, props.parent, props.root)
}
function retryMark() {
  if (props.root !== null) markAgain(props.threadKey, props.root)
}
</script>

<template>
  <div
    v-if="replies.length || writing || failedMark"
    class="thread-replies"
  >
    <VButton
      v-if="held"
      class="replies-toggle"
      variant="ghost"
      size="inline"
      :aria-expanded="showingAll"
      :aria-controls="listId"
      @click="toggleAll"
      >{{ toggleLabel }}</VButton
    >
    <ol
      v-if="replies.length"
      :id="listId"
      ref="list"
      class="replies"
      :aria-label="t('threads.replies')"
    >
      <li
        v-for="reply in shown"
        :id="writtenAnchor(reply.id)"
        :key="reply.id"
        class="reply"
        tabindex="-1"
      >
        <div class="reply-meta">
          <span>
            {{ authorOf(reply) }}
            <span v-if="sessionOf(reply)">{{ sessionOf(reply) }}</span>
          </span>
          <span>{{ when(reply.at) }}</span>
        </div>
        <CollapsibleText
          class="reply-text"
          :text="reply.body"
          :lines="6"
        />
      </li>
    </ol>
    <p
      v-if="failedMark"
      class="reply-mark-failed"
      role="alert"
    >
      {{ t('threads.markFailed') }}
      <VButton
        variant="ghost"
        size="inline"
        @click="retryMark"
        >{{ t('threads.markAgain') }}</VButton
      >
    </p>
    <ReplyComposer
      v-if="writing"
      v-model:text="text"
      v-model:mark="mark"
      :can-mark="canMark"
      :error="replyError"
      :pending="pending"
      :suggest="suggest"
      @cancel="cancel"
      @refresh="emit('refresh')"
      @submit="send"
    />
  </div>
</template>

<style scoped>
.thread-replies {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.replies-toggle {
  justify-self: start;
}

.replies {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  padding: 0 0 0 var(--space-3);
  margin: 0;
  border-inline-start: 1px solid var(--color-rule-strong);
  list-style: none;
}

/* A reply takes focus from the press that showed it or the write that made it, and
   rings as it does. */
.reply {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  scroll-margin-top: var(--space-4);

  &:focus-visible {
    border-radius: var(--radius-control);
    outline-offset: var(--space-half);
  }
}

.reply-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: space-between;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.reply-text {
  font: var(--font-editor);
}

.reply-mark-failed {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}

@container drawer (width < 520px) {
  .replies {
    padding-inline-start: var(--space-2);
  }
}
</style>
