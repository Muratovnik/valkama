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
 * An answer can be changed while its task is open. The same form opens on the answer in
 * force, and Save does nothing until the form says something else. Cancel with something
 * changed asks first, with focus on the way back, and Escape from inside is that same Cancel.
 *
 * Folding takes the controls that had focus away, whoever answered, so focus goes to how
 * it ended: the person stays on the question they were in. What is held belongs to the
 * host, which outlives this while a dialog closes and opens and which the draft guard asks.
 * Folding also lifts what stands below it, so a press that lands here only because of that
 * reaches nothing: it was meant for another question.
 */
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener } from '@vueuse/core'

import RequestActions from '@/features/input-requests/components/RequestActions.vue'
import RequestAnswerFields from '@/features/input-requests/components/RequestAnswerFields.vue'
import RequestFold from '@/features/input-requests/components/RequestFold.vue'
import RequestHeader from '@/features/input-requests/components/RequestHeader.vue'
import { useAnswerChange } from '@/features/input-requests/composables/useAnswerChange.ts'
import { useRequestWrites } from '@/features/input-requests/composables/useRequestWrites.ts'
import { useStepAttention } from '@/features/input-requests/composables/useStepAttention.ts'
import { ANSWER_VERSION_LIMIT, unsentWords } from '@/features/input-requests/utils/answerChange.ts'
import {
  editField,
  EMPTY_DRAFT,
  hasDraft,
} from '@/features/input-requests/utils/validateAnswers.ts'
import type { FieldEdit, RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import { provideDocumentLinks } from '@/entities/project-document/documentLinks.ts'

import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { revealFrame } from '@/shared/lib/revealFrame.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'
import type MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
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
  'select': [target: PlanningTarget]
  'update:draft': [draft: RequestDraft]
  'updated': [entry: InputRequestEntry]
}>()
const { t, d } = useI18n()
const promptId = useId()
// A path in a question belongs to that question's task, whichever task is open.
provideDocumentLinks(() => ({
  space: planningSpaceEntity(props.entry.target.space_ref).resource_id,
}))
const card = ref<HTMLElement | null>(null)
onMounted(() => stopStrayPresses(card.value))
const errorLine = ref<HTMLElement | null>(null)
const deadlineLine = ref<HTMLElement | null>(null)
const answerFields = ref<InstanceType<typeof RequestAnswerFields> | null>(null)
const actions = ref<InstanceType<typeof RequestActions> | null>(null)

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
    moveFocus(errorLine.value)
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
/** A deadline disables what had focus, so focus goes to why, as it does when a write fails. */
watch(pastDue, async (past) => {
  if (!past || !card.value?.contains(document.activeElement)) return
  await nextTick()
  moveFocus(deadlineLine.value)
})
const offersChange = computed(() => changeable.value && !changing.value)
const hasFoot = computed(() =>
  [inForm.value, offersChange.value, canRefresh.value, props.standalone, error.value].some(Boolean),
)
const busyMark = computed(() => busy.value || undefined)
const fieldsDisabled = computed(() => busy.value || !(changing.value || writable.value))
const sendDisabled = computed(() =>
  changing.value
    ? !changeable.value || requiresRefresh.value || unchanged.value
    : !writable.value || requiresRefresh.value,
)
const noting = computed(() => answerFields.value?.noteOpen ?? false)
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
/** What the form still held when the question closed some other way. */
const unsent = computed(() => (inForm.value ? '' : unsentWords(props.draft)))
const change = useAnswerChange({
  busy,
  focusCancel: () => actions.value?.focusWayOut(),
  focusChange: () => actions.value?.focusChange(),
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
    time: request.value.expires_at ? stamp(request.value.expires_at) : '',
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
    actions.value?.focusWayOut()
  }
})

/**
 * Choosing or writing means answering after all, and Send must be Send again by the time it
 * is pressed: while the asking stands, the same place declines for good.
 */
function edit(field: InputRequestField, change: FieldEdit) {
  stepBack()
  emit('update:draft', editField(props.draft, field.id, change))
  // A comment answers nothing, so it leaves what was refused for being empty refused.
  if (change.note === undefined) refused.value = refused.value.filter((id) => id !== field.id)
}
function writeNote(note: string) {
  stepBack()
  emit('update:draft', { ...props.draft, note })
}
/** Moves focus to this question's heading, or to the question where it has none. */
function focus() {
  moveFocus(card.value?.querySelector<HTMLElement>('.request-title') ?? card.value)
}
/** Moves focus to how this question ended, or to the question while it still waits. */
function focusOutcome() {
  const line = card.value?.querySelector<HTMLElement>('.request-state')
  if (line) moveFocus(line)
  else focus()
}
/**
 * Brings the question into view, at its first line under what the scroller keeps over
 * its top, with the keyboard at its first control. Focus alone would scroll the control
 * to the far edge and leave the prompt out of sight.
 */
function reveal() {
  const root = card.value
  const control =
    root?.querySelector<HTMLElement>('input:checked:not(:disabled)') ??
    root?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled)')
  ;(control ?? root)?.focus({ preventScroll: true })
  revealFrame(root)
}
defineExpose({ focus, focusOutcome, reveal })
</script>

<template>
  <article
    ref="card"
    class="request-card"
    tabindex="-1"
    :aria-busy="busyMark"
  >
    <RequestHeader
      v-if="standalone"
      :entry="entry"
    />
    <div class="request-meta">
      <span
        >{{ authorName }} <span v-if="authorSession">{{ authorSession }}</span></span
      >
      <span>{{ stamp(request.created_at) }}</span>
    </div>
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
        ref="deadlineLine"
        class="request-fact request-deadline"
        tabindex="-1"
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
      :request="request"
      :unsent="unsent"
    />
    <p
      v-if="changeFact"
      class="request-fact"
    >
      {{ changeFact }}
    </p>
    <footer
      v-if="hasFoot"
      class="request-foot"
    >
      <p
        v-if="error"
        ref="errorLine"
        class="request-error"
        role="alert"
        tabindex="-1"
      >
        {{ errorText }}
      </p>
      <ConfirmStrip
        v-if="askingCancel"
        class="request-confirm"
        tone="danger"
        :cancel-label="t('requests.keepChanging')"
        :confirm-label="t('requests.discardChange')"
        :message="t('requests.cancelAsked')"
        @cancel="change.keep"
        @confirm="change.end"
      />
      <RequestActions
        v-show="!askingCancel"
        ref="actions"
        :busy="busy"
        :changeable="offersChange"
        :changing="changing"
        :declining="declining"
        :disabled="sendDisabled"
        :noting="noting && !changing"
        :refreshable="canRefresh"
        :standalone="standalone"
        :waiting="waiting"
        @start-change="change.start"
        @onward="pressOnward"
        @open="emit('select', entry.target)"
        @refresh="refresh"
        @way-out="pressWayOut"
      />
    </footer>
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

/* The app moves focus to these, to the next question and to why a write did not go
   through or no longer can, and rings them as it does (`moveFocus`): it is the one sign of
   where the reader was taken. A press on one takes focus too, and rings nothing. The ring
   itself is the base one; here it only stands clear of the words. */
:is(.request-card, .request-error, .request-deadline):focus-visible {
  border-radius: var(--radius-control);
  outline-offset: var(--space-1);
}

.request-card:focus-visible {
  border-radius: var(--radius-card);
  outline-offset: var(--space-half);
}

.request-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: space-between;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
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

/* What `RequestActions` asks lies against this, and takes no room in it unless a note is open. */
.request-foot {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  min-width: 0;
  container-type: inline-size;
}

.request-confirm {
  flex: 1 1 100%;
}

.request-error {
  flex: 1 1 16rem;
  min-width: 0;
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
