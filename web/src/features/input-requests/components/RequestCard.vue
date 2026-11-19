<script setup lang="ts">
/**
 * One question, the same wherever it is answered: in a card's discussion, where it
 * reads as a comment, and in the list of everything waiting (`standalone`), which adds whose
 * task it is and the way to it in a head that stays in sight while the block scrolls.
 *
 * A question asked here is one block of questions, its fields: what acts on the whole block,
 * the comment on it, stands in the block's head, at the end of its first line beside what the
 * host puts there, and never among the buttons of its foot, where it read as one more of them
 * and said nothing of which block it was on. In the list that head is the one that sticks
 * (`RequestHeader`), and what sticks under it (a review's count) is told its height.
 *
 * Selecting does nothing but select, and nothing is chosen for the person but at their own
 * press, such as accepting what is recommended: Send is what
 * sends, every kind of field goes through it, and a send that fails keeps all of it with
 * the reason in the foot. Once the question is no longer waiting it folds (`RequestFold`).
 *
 * An answer can be changed while its task is open, from an icon on the head of the question,
 * where the host's own icons (`actions`) stand beside it. The same form opens on the answer in
 * force, and Save does nothing until the form says something else. Cancel with something
 * changed asks first, with focus on the way back, and Escape from inside is that same Cancel.
 * While the form stands the time beside the icon does not move: in a card the comment on the
 * block takes the icon's room, and in the list, where that comment is in the head that sticks,
 * the icon keeps its room unseen.
 *
 * Folding takes the controls that had focus away, whoever answered, so focus goes to the
 * question, described by how it ended: the person stays on the question they were in, and
 * after a key the ring goes round it, as round a thread that folds. A deadline passing does
 * the same, with the question described by its deadline, and so does the list moving on to
 * the next question, which its title names. What is held belongs to the
 * host, which outlives this while a dialog closes and opens and which the draft guard asks.
 * Folding also lifts what stands below it, so a press that lands here only because of that
 * reaches nothing: it was meant for another question.
 *
 * It is the frame of a question of every kind (`QuestionRecord`). A choice of options is
 * answered by its form, as above. Any other kind draws its own content in `subject`, which is
 * handed the question and whether what it offers to tick takes nothing now (`disabled`), and is
 * answered by its kind's row of buttons in the foot: one press
 * writes, through the same write as Send, what that answer says over what the form holds; an
 * answer that cannot be taken back asks first, as Don't answer does, and the answer that puts
 * the question off opens the choice of a day in place (`RequestLater`). One the server refuses
 * with the list of open work it would cancel shows that list in the foot and asks again, and
 * its confirmed retry confirms that list (`useKindAnswers`). Its history, a change of
 * its answer, its fold and what it left unsent are this frame's, whatever its kind. Where the
 * listing says the question's space and project, its head says them.
 *
 * A write started elsewhere for several questions at once goes through `send`, with the draft
 * it fills and a right to move focus of its own, and is told how it ended.
 */
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener } from '@vueuse/core'

import RequestAnswerFields from '@/features/input-requests/components/RequestAnswerFields.vue'
import RequestFold from '@/features/input-requests/components/RequestFold.vue'
import RequestFoot from '@/features/input-requests/components/RequestFoot.vue'
import RequestHead from '@/features/input-requests/components/RequestHead.vue'
import { useAnswerChange } from '@/features/input-requests/composables/useAnswerChange.ts'
import { useBlockNote } from '@/features/input-requests/composables/useBlockNote.ts'
import { useKindAnswers } from '@/features/input-requests/composables/useKindAnswers.ts'
import { useRequestFocus } from '@/features/input-requests/composables/useRequestFocus.ts'
import { useRequestWrites } from '@/features/input-requests/composables/useRequestWrites.ts'
import { useUncoveredFocus } from '@/features/input-requests/composables/useUncoveredFocus.ts'
import { ANSWER_VERSION_LIMIT, unsentWords } from '@/features/input-requests/utils/answerChange.ts'
import { unsentChoices } from '@/features/input-requests/utils/answerDisplay.ts'
import type { QuestionRecord } from '@/features/input-requests/utils/questionRecord.ts'
import { hasDraft, stillRefused } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import { provideDocumentLinks } from '@/entities/project-document/documentLinks.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { NO_FOCUS_RIGHT } from '@/shared/lib/focusRight.ts'
import type { FocusRight } from '@/shared/lib/focusRight.ts'
import { unbroken } from '@/shared/lib/unbroken.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import type MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import RichText from '@/shared/ui/RichText.vue'
import { stopStrayPresses } from '@/shared/ui/strayPress.ts'

const props = withDefaults(
  defineProps<{
    draft: RequestDraft
    entry: InputRequestEntry
    /** Its kind's answers; none for a choice, which its form answers. */
    answers?: QuestionRecord['answers']
    /** The question's task is closed. Left out where that is not known; the server still says. */
    itemClosed?: boolean
    kind?: QuestionRecord['kind']
    project?: QuestionRecord['project']
    space?: QuestionRecord['space']
    standalone?: boolean
    suggest?: InstanceType<typeof MarkdownEditor>['$props']['suggest']
  }>(),
  {
    answers: () => [],
    itemClosed: false,
    kind: 'choice',
    project: null,
    space: null,
    standalone: false,
    suggest: undefined,
  },
)
const emit = defineEmits<{
  'dismiss': [entry: InputRequestEntry]
  'select': [target: PlanningTarget]
  'update:draft': [draft: RequestDraft]
  'updated': [entry: InputRequestEntry, right: FocusRight]
}>()
const { t, d } = useI18n()
const promptId = useId()
const metaId = useId()
const titleId = useId()
const deadlineId = useId()
const outcomeId = useId()
const laterId = useId()
// A path in a question belongs to that question's task, whichever task is open.
provideDocumentLinks(() => ({
  space: planningSpaceEntity(props.entry.target.space_ref).resource_id,
}))
const card = ref<HTMLElement | null>(null)
onMounted(() => stopStrayPresses(card.value))
useUncoveredFocus(card)
const { focus, focusOn, focusOutcome, holdsFocus, reveal } = useRequestFocus(card)
const deadlineLine = ref<HTMLElement | null>(null)
const answerFields = ref<InstanceType<typeof RequestAnswerFields> | null>(null)
const foot = ref<InstanceType<typeof RequestFoot> | null>(null)
const head = ref<InstanceType<typeof RequestHead> | null>(null)
/** What sticks to the panel's top under the head of the block, a review's count, stands under it. */
const headHeight = computed(() =>
  props.standalone && head.value
    ? { '--request-head-height': `${head.value.height}px` }
    : undefined,
)

const {
  busy,
  canRefresh,
  changeable,
  changing,
  declining,
  error,
  fieldsDisabled,
  forget,
  listed,
  pastDue,
  refresh,
  refused,
  request,
  requiresRefresh,
  resolve,
  sendDisabled,
  stepBack,
  supported,
  unchanged,
  writable,
} = useRequestWrites({
  draft: () => props.draft,
  entry: () => props.entry,
  itemClosed: () => props.itemClosed,
  write: (draft) => emit('update:draft', draft),
  failed: async (right) => {
    await nextTick()
    right.take(() => foot.value?.focusError())
  },
  refuse: async (field) => {
    await answerFields.value?.focusField(field)
  },
  settled: async (result, reread, right) => {
    await nextTick()
    right.take(reread ? reveal : focusOutcome)
    emit('updated', result, right)
  },
})

const waiting = computed(() => request.value.status === 'pending')
const inForm = computed(() => waiting.value || changing.value)
const kind = useKindAnswers({
  answers: () => props.answers,
  entry: () => props.entry,
  draft: () => props.draft,
  focusDay: () => foot.value?.focusDay(),
  kind: () => props.kind,
  laterId,
  question: card,
  waiting,
  write: (draft) => emit('update:draft', draft),
  writes: { busy, declining, listed, requiresRefresh, resolve, sendDisabled, stepBack, writable },
})
const { asking, byAnswers, chooseDay, laterControl, offered, putOff } = kind
const { press: pressAnswer, stepStands } = kind
/** Writes what another place filled, for several questions at once, and says how it ended. */
const send = (draft: RequestDraft, right: FocusRight) => resolve('answer', { draft, right })
/**
 * The question stopped waiting, and focus moves only when it fell to the page, where what held
 * it went; a control that stays keeps the focus the person put on it. The person's own write or
 * read moves focus through its right in `settled`. A change from elsewhere while that write is
 * out moves it at once all the same, under no right, so the write's right still stands.
 */
watch(waiting, async (now) => {
  if (now || !card.value?.contains(document.activeElement)) return
  await nextTick()
  NO_FOCUS_RIGHT.take(focusOutcome)
})
/**
 * A deadline disables the form, so focus in it goes to the question, which says why. What the
 * deadline leaves, the reply icon or the task number, keeps the focus the person put on it.
 */
watch(pastDue, async (past) => {
  if (!past || !card.value?.contains(document.activeElement)) return
  await nextTick()
  NO_FOCUS_RIGHT.take(() => focusOn(deadlineLine.value))
})
/** In the list its title names the question; in a card's discussion, its author and time. */
const labelledBy = computed(() => (props.standalone ? titleId : metaId))
/**
 * The question is described by how it ended once it has, and by its deadline once that has
 * passed: what focus coming to it has to say.
 */
const describedBy = computed(() => {
  if (!inForm.value) return outcomeId
  return pastDue.value && request.value.expires_at ? deadlineId : undefined
})
const hasFoot = computed(() =>
  [inForm.value, canRefresh.value, props.standalone, error.value].some(Boolean),
)
const busyMark = computed(() => busy.value || undefined)
const { noteToggle, pressNote } = useBlockNote({
  disabled: fieldsDisabled,
  fields: answerFields,
  request,
  shown: () => inForm.value && supported.value,
})
/** Why an answered question offers no change, where that is something to know. */
const changeFact = computed(() => {
  if (request.value.status !== 'answered' || !props.entry.target.writable) return ''
  if (props.itemClosed) return t('requests.reopenToChange')
  return request.value.answer_version >= ANSWER_VERSION_LIMIT ? t('requests.versionLimit') : ''
})
/** The error says the draft is kept only when there is one to keep. */
const errorText = computed(() => {
  const kept = hasDraft(props.draft) ? '' : 'Bare'
  return error.value ? t(`requests.${error.value}${kept}`) : ''
})
/** What the form still held when the question closed some other way: words, and what was chosen. */
const unsent = computed(() => (inForm.value ? '' : unsentWords(request.value, props.draft)))
const unsentChosen = computed(() =>
  inForm.value ? [] : unsentChoices(request.value.fields, props.draft, t),
)
const change = useAnswerChange({
  busy,
  focusCancel: () => foot.value?.focusWayOut(),
  focusChange: () =>
    card.value?.querySelector<HTMLElement>('.request-change')?.focus({ preventScroll: true }),
  forget,
  request,
  reveal,
  unchanged,
  unsent,
  write: (draft) => emit('update:draft', draft),
})
const askingCancel = change.asking
const stamp = (value: string) => d(new Date(value), 'activity')
const deadlineLabel = computed(() =>
  t(pastDue.value ? 'requests.deadline' : 'requests.expires', {
    time: request.value.expires_at ? unbroken(stamp(request.value.expires_at)) : '',
  }),
)

function pressWayOut() {
  if (asking.value !== null) kind.back()
  else if (changing.value) change.cancel()
  else if (declining.value) stepBack()
  else void resolve('decline')
}
function pressOnward() {
  if (changing.value) void resolve('change')
  else void resolve(declining.value ? 'decline' : 'answer')
}
/**
 * While it is asked, Escape from inside answers that and leaves the card or the list open.
 * The form of a change is a step of the same kind: Escape is its Cancel.
 */
useEventListener(card, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.isComposing) return
  if (!stepStands.value && !changing.value) return
  event.preventDefault()
  event.stopPropagation()
  if (asking.value !== null) {
    foot.value?.focusWayOut()
    kind.back()
  } else if (askingCancel.value) void change.keep()
  else if (changing.value) change.cancel()
  else {
    stepBack()
    foot.value?.focusWayOut()
  }
})

/**
 * Choosing or writing means answering after all, and Send must be Send again by the time it
 * is pressed: while the asking stands, the same place declines for good.
 */
function edit(next: RequestDraft) {
  stepBack()
  refused.value = stillRefused(refused.value, props.draft, next)
  emit('update:draft', next)
}
function writeNote(note: string) {
  stepBack()
  emit('update:draft', { ...props.draft, note })
}
defineExpose({ focus, focusOutcome, holdsFocus, reveal, send })
</script>

<template>
  <article
    ref="card"
    class="request-card"
    tabindex="-1"
    :aria-busy="busyMark"
    :aria-labelledby="labelledBy"
    :aria-describedby="describedBy"
    :style="headHeight"
  >
    <RequestHead
      ref="head"
      :changeable="changeable"
      :changing="changing"
      :entry="entry"
      :meta-id="metaId"
      :note-toggle="noteToggle"
      :project="project"
      :space="space"
      :standalone="standalone"
      :title-id="titleId"
      @change-answer="change.start"
      @note="pressNote"
      @select="emit('select', $event)"
    >
      <template #actions><slot name="actions" /></template>
    </RequestHead>
    <template v-if="inForm">
      <CollapsibleText
        class="request-prompt"
        :reset-key="request.request_id"
      >
        <RichText
          :id="promptId"
          :source="request.prompt"
        />
      </CollapsibleText>
      <p
        v-if="request.expires_at"
        :id="deadlineId"
        ref="deadlineLine"
        class="request-fact"
      >
        {{ deadlineLabel }}
      </p>
      <p
        v-if="changing"
        class="request-fact"
      >
        {{ t('requests.changing') }}
      </p>
      <p
        v-if="!entry.target.writable"
        class="request-fact"
      >
        {{ t('requests.readonly') }}
      </p>
      <p
        v-if="!supported"
        role="alert"
      >
        {{ t('requests.unsupported') }}
      </p>
      <slot
        v-else-if="byAnswers"
        name="subject"
        :entry="entry"
        :disabled="fieldsDisabled"
      />
      <RequestAnswerFields
        v-else
        ref="answerFields"
        :fields="request.fields"
        :draft="draft"
        :prompt-id="promptId"
        :refused="refused"
        :disabled="fieldsDisabled"
        :suggest="suggest"
        @edit="edit"
        @note="writeNote"
        @submit="pressOnward"
      />
    </template>
    <RequestFold
      v-else
      :outcome-id="outcomeId"
      :request="request"
      :unsent="unsent"
      :unsent-chosen="unsentChosen"
    />
    <p
      v-if="changeFact"
      class="request-fact"
    >
      {{ changeFact }}
    </p>
    <RequestFoot
      v-if="hasFoot"
      ref="foot"
      :answers="offered"
      :asking="asking"
      :asking-cancel="askingCancel"
      :busy="busy"
      :changing="changing"
      :declining="stepStands"
      :disabled="sendDisabled"
      :dismissable="standalone && !inForm"
      :error="errorText"
      :refreshable="canRefresh"
      :stuck="answerFields?.structured ?? false"
      :undecided="answerFields?.undecided ?? 0"
      :later="laterControl"
      :listed="listed"
      :waiting="waiting"
      @answer="pressAnswer"
      @day="chooseDay"
      @put-off="putOff"
      @discard="change.end"
      @dismiss="emit('dismiss', entry)"
      @keep="change.keep"
      @onward="pressOnward"
      @refresh="refresh"
      @way-out="pressWayOut"
    />
  </article>
</template>

<style scoped>
/* A sheet on its ground, as a comment is, in the discussion and in the list alike. Its inset is
   handed to the head that sticks, which covers it to the sheet's edges, and where the panel
   keeps what sticks to its top is kept under another name, for what sticks under that head
   (`RequestAnswerFields`) to stand below it by the head's height, which the head measures and
   which is none where no head sticks. */
.request-card {
  --request-sheet-inset: var(--space-3);
  --request-stuck-base: var(--size-stuck-top, 0px);
  --request-head-height: 0px;

  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
  padding: calc(var(--request-sheet-inset));
  background: var(--color-surface-sheet);
  border-radius: var(--radius-card);
  scroll-margin-top: var(--space-4);
}

/* The app moves focus here, to the question it stays on, and after a key rings it as it
   does (`moveFocus`): it is the one sign of where the reader was taken. After a press, and on
   a press here, it takes focus and rings nothing. The ring is the base one, round the sheet's
   own corner. */
.request-card:focus-visible {
  border-radius: var(--radius-card);
  outline-offset: var(--space-half);
}

.request-fact {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.request-prompt {
  font: var(--font-editor);
}
</style>
