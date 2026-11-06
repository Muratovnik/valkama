<script setup lang="ts">
/**
 * One question, the same wherever it is answered: in a card's discussion, where it
 * reads as a comment, and in the list of everything waiting (`standalone`), which adds
 * whose task it is and the way to it.
 *
 * Selecting does nothing but select, and nothing is chosen for the person: Send is what
 * sends, every kind of field goes through it, and a send that fails keeps all of it with
 * the reason in the foot. Once the question is no longer waiting it folds (`RequestFold`).
 *
 * An answer can be changed while its task is open, from an icon on the head of the question,
 * where the host's own icons (`actions`) stand beside it. The same form opens on the answer in
 * force, and Save does nothing until the form says something else. Cancel with something
 * changed asks first, with focus on the way back, and Escape from inside is that same Cancel.
 * While the form stands the icon keeps its room, so the time beside it does not move.
 *
 * Folding takes the controls that had focus away, whoever answered, so focus goes to the
 * question, described by how it ended: the person stays on the question they were in, and
 * the ring goes round it, as round a thread that folds. A deadline passing does the same,
 * with the question described by its deadline, and so does the list moving on to the next
 * question, which its title names. What is held belongs to the
 * host, which outlives this while a dialog closes and opens and which the draft guard asks.
 * Folding also lifts what stands below it, so a press that lands here only because of that
 * reaches nothing: it was meant for another question.
 */
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener } from '@vueuse/core'

import RequestAnswerFields from '@/features/input-requests/components/RequestAnswerFields.vue'
import RequestFold from '@/features/input-requests/components/RequestFold.vue'
import RequestFoot from '@/features/input-requests/components/RequestFoot.vue'
import RequestHeader from '@/features/input-requests/components/RequestHeader.vue'
import { useAnswerChange } from '@/features/input-requests/composables/useAnswerChange.ts'
import { useRequestFocus } from '@/features/input-requests/composables/useRequestFocus.ts'
import { useRequestWrites } from '@/features/input-requests/composables/useRequestWrites.ts'
import { useStepAttention } from '@/features/input-requests/composables/useStepAttention.ts'
import { useUncoveredFocus } from '@/features/input-requests/composables/useUncoveredFocus.ts'
import { ANSWER_VERSION_LIMIT, unsentWords } from '@/features/input-requests/utils/answerChange.ts'
import { unsentChoices } from '@/features/input-requests/utils/answerDisplay.ts'
import {
  EMPTY_DRAFT,
  hasDraft,
  stillRefused,
} from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import { provideDocumentLinks } from '@/entities/project-document/documentLinks.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import { unbroken } from '@/shared/lib/unbroken.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import EntryAction from '@/shared/ui/EntryAction.vue'
import EntryHead from '@/shared/ui/EntryHead.vue'
import type MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import MetaLine from '@/shared/ui/MetaLine.vue'
import RichText from '@/shared/ui/RichText.vue'
import { stopStrayPresses } from '@/shared/ui/strayPress.ts'

const props = withDefaults(
  defineProps<{
    draft: RequestDraft
    entry: InputRequestEntry
    /** The question's task is closed. Left out where that is not known; the server still says. */
    itemClosed?: boolean
    standalone?: boolean
    suggest?: InstanceType<typeof MarkdownEditor>['$props']['suggest']
  }>(),
  { itemClosed: false, standalone: false, suggest: undefined },
)
const emit = defineEmits<{
  'dismiss': [entry: InputRequestEntry]
  'select': [target: PlanningTarget]
  'update:draft': [draft: RequestDraft]
  'updated': [entry: InputRequestEntry]
}>()
const { t, d } = useI18n()
const promptId = useId()
const metaId = useId()
const titleId = useId()
const deadlineId = useId()
const outcomeId = useId()
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

const {
  busy,
  canRefresh,
  changeable,
  changing,
  declining,
  error,
  forget,
  pastDue,
  refresh,
  refused,
  request,
  requiresRefresh,
  resolve,
  stepBack,
  supported,
  unchanged,
  writable,
} = useRequestWrites({
  draft: () => props.draft,
  entry: () => props.entry,
  itemClosed: () => props.itemClosed,
  failed: async () => {
    await nextTick()
    foot.value?.focusError()
  },
  refuse: async (field) => {
    await answerFields.value?.focusField(field)
  },
  settled: async (result, action) => {
    const reread = action === null && props.draft.changing !== null
    if (action === 'answer' || action === 'change') emit('update:draft', EMPTY_DRAFT)
    // A read while the form is open: from here on the change is written against what it said.
    if (reread) emit('update:draft', { ...props.draft, changing: result.request.revision })
    await nextTick()
    if (reread) reveal()
    else focusOutcome()
    emit('updated', result)
  },
})

useStepAttention(card, declining, stepBack)

const waiting = computed(() => request.value.status === 'pending')
const inForm = computed(() => waiting.value || changing.value)
watch(waiting, async (now) => {
  if (now || !card.value?.contains(document.activeElement)) return
  await nextTick()
  focusOutcome()
})
/** A deadline disables what had focus, so focus goes to the question, which says why. */
watch(pastDue, async (past) => {
  if (!past || !card.value?.contains(document.activeElement)) return
  await nextTick()
  focusOn(deadlineLine.value)
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
const fieldsDisabled = computed(() => busy.value || !(changing.value || writable.value))
const sendDisabled = computed(() =>
  changing.value
    ? !changeable.value || requiresRefresh.value || unchanged.value
    : !writable.value || requiresRefresh.value,
)
/** The press of the comment on the question, which stands in the foot while there is a form. */
const noteToggle = computed(() =>
  inForm.value && supported.value
    ? {
        disabled: fieldsDisabled.value,
        open: answerFields.value?.noteOpen ?? false,
        written: answerFields.value?.noteWritten ?? false,
      }
    : null,
)
const pressNote = () => answerFields.value?.pressNote()
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
/** An agent asks, whatever name it signs with: this interface asks nothing. */
const authorName = computed(() => actorName(request.value.author))
const authorSession = computed(() => actorSession(request.value.author))

function pressWayOut() {
  if (changing.value) change.cancel()
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
  if (!declining.value && !changing.value) return
  event.preventDefault()
  event.stopPropagation()
  if (askingCancel.value) void change.keep()
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
defineExpose({ focus, focusOutcome, holdsFocus, reveal })
</script>

<template>
  <article
    ref="card"
    class="request-card"
    tabindex="-1"
    :aria-busy="busyMark"
    :aria-labelledby="labelledBy"
    :aria-describedby="describedBy"
  >
    <RequestHeader
      v-if="standalone"
      :entry="entry"
      :title-id="titleId"
      @select="emit('select', $event)"
    />
    <EntryHead>
      <MetaLine
        :id="metaId"
        class="request-meta"
        :when="stamp(request.created_at)"
        >{{ authorName }} <span v-if="authorSession">{{ authorSession }}</span></MetaLine
      >
      <template #actions>
        <EntryAction
          v-if="changeable || changing"
          class="request-change"
          icon="edit"
          :class="{ 'is-away': changing }"
          :label="t('requests.changeAnswer')"
          @click="change.start"
        />
        <slot name="actions" />
      </template>
    </EntryHead>
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
      :asking-cancel="askingCancel"
      :busy="busy"
      :changing="changing"
      :declining="declining"
      :disabled="sendDisabled"
      :dismissable="standalone && !inForm"
      :error="errorText"
      :note="noteToggle"
      :refreshable="canRefresh"
      :standalone="standalone"
      :stuck="answerFields?.structured ?? false"
      :undecided="answerFields?.undecided ?? 0"
      :waiting="waiting"
      @discard="change.end"
      @dismiss="emit('dismiss', entry)"
      @keep="change.keep"
      @note="pressNote"
      @onward="pressOnward"
      @open="emit('select', entry.target)"
      @refresh="refresh"
      @way-out="pressWayOut"
    />
  </article>
</template>

<style scoped>
/* A sheet on its ground, as a comment is, in the discussion and in the list alike. */
.request-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-3);
  background: var(--color-surface-sheet);
  border-radius: var(--radius-card);
  scroll-margin-top: var(--space-4);
}

/* The app moves focus here, to the question it stays on, and rings it as it does
   (`moveFocus`): it is the one sign of where the reader was taken. A press here takes focus
   too, and rings nothing. The ring is the base one, round the sheet's own corner. */
.request-card:focus-visible {
  border-radius: var(--radius-card);
  outline-offset: var(--space-half);
}

.request-change.is-away {
  visibility: hidden;
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
