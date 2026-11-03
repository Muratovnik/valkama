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
import { useRequestWrites } from '@/features/input-requests/composables/useRequestWrites.ts'
import { EMPTY_DRAFT, hasDraft } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import { projectTitle, useProjectTitles } from '@/shared/lib/projectTitles.ts'
import { revealFrame } from '@/shared/lib/revealFrame.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import type MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import RichText from '@/shared/ui/RichText.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import { stopStrayPresses } from '@/shared/ui/strayPress.ts'

const props = withDefaults(
  defineProps<{
    draft: RequestDraft
    entry: InputRequestEntry
    standalone?: boolean
    suggest?: InstanceType<typeof MarkdownEditor>['$props']['suggest']
  }>(),
  { standalone: false, suggest: undefined },
)
const emit = defineEmits<{
  'select': [target: PlanningTarget]
  'update:draft': [draft: RequestDraft]
  'updated': [entry: InputRequestEntry]
}>()
const { t, d } = useI18n()
const promptId = useId()
const card = ref<HTMLElement | null>(null)
onMounted(() => stopStrayPresses(card.value))
const errorLine = ref<HTMLElement | null>(null)
const answerFields = ref<InstanceType<typeof RequestAnswerFields> | null>(null)
const actions = ref<InstanceType<typeof RequestActions> | null>(null)

const {
  busy,
  canRefresh,
  declining,
  error,
  keep,
  pastDue,
  refresh,
  refused,
  request,
  requiresRefresh,
  resolve,
  supported,
  writable,
} = useRequestWrites({
  draft: () => props.draft,
  entry: () => props.entry,
  failed: async () => {
    await nextTick()
    errorLine.value?.focus()
  },
  refuse: async (field) => {
    await answerFields.value?.focusField(field)
  },
  settled: async (result, action) => {
    if (action === 'answer') emit('update:draft', EMPTY_DRAFT)
    await nextTick()
    focusOutcome()
    emit('updated', result)
  },
})

const waiting = computed(() => request.value.status === 'pending')
watch(waiting, async (now) => {
  if (now || !card.value?.contains(document.activeElement)) return
  await nextTick()
  focusOutcome()
})
const hasFoot = computed(
  () => waiting.value || canRefresh.value || props.standalone || Boolean(error.value),
)
const busyMark = computed(() => busy.value || undefined)
const fieldsDisabled = computed(() => !writable.value || busy.value)
const sendDisabled = computed(() => !writable.value || requiresRefresh.value)
/** The error says the draft is kept only when there is one to keep. */
const errorText = computed(() => {
  const kept = hasDraft(props.draft) ? '' : 'Bare'
  return error.value ? t(`requests.${error.value}${kept}`) : ''
})
/** What the form still held when the question closed some other way. */
const unsent = computed(() => (waiting.value ? '' : props.draft.note.trim()))
const stamp = (value: string) => d(new Date(value), 'activity')
const deadlineLabel = computed(() =>
  t(pastDue.value ? 'requests.deadline' : 'requests.expires', {
    time: request.value.expires_at ? stamp(request.value.expires_at) : '',
  }),
)
/** Project and task; the space key is left out where the reference already begins with it. */
const projects = useProjectTitles()
const context = computed(() => {
  const { project_id: id, space_ref: space } = props.entry.target
  const project = projectTitle(projects.value, id)
  const reference = request.value.reference
  return reference.startsWith(`${space.space_key}-`)
    ? `${project} · ${reference}`
    : `${project} · ${space.space_key} · ${reference}`
})
/** An agent asks, whatever name it signs with: this interface asks nothing. */
const authorName = computed(() => actorName(request.value.author))
const authorSession = computed(() => actorSession(request.value.author))

function pressWayOut() {
  if (declining.value) keep()
  else void resolve('decline')
}
function pressOnward() {
  void resolve(declining.value ? 'decline' : 'answer')
}
/** While it is asked, Escape answers that and leaves the card or the list around it open. */
useEventListener(card, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.isComposing || !declining.value) return
  event.preventDefault()
  event.stopPropagation()
  keep()
  actions.value?.focusWayOut()
})

/**
 * Choosing or writing means answering after all, and Send must be Send again by the time it
 * is pressed: while the asking stands, the same place declines for good.
 */
function edit(field: InputRequestField, value: string | boolean | string[]) {
  keep()
  emit('update:draft', {
    ...props.draft,
    answers: { ...props.draft.answers, [field.id]: value },
  })
  refused.value = refused.value.filter((id) => id !== field.id)
}
function writeNote(note: string) {
  keep()
  emit('update:draft', { ...props.draft, note })
  // Words of one's own stand in for whatever was refused for being empty.
  if (note.trim()) refused.value = []
}
/** Moves focus to this question's heading, or to the question where it has none. */
function focus() {
  ;(card.value?.querySelector<HTMLElement>('.request-title') ?? card.value)?.focus()
}
/** Moves focus to how this question ended, or to the question while it still waits. */
function focusOutcome() {
  const line = card.value?.querySelector<HTMLElement>('.request-state')
  if (line) line.focus()
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
    <header
      v-if="standalone"
      class="request-header"
    >
      <p class="request-context">{{ context }}</p>
      <SectionHeading
        class="request-title"
        as="h3"
        level="panel"
        tabindex="-1"
        >{{ request.title }}</SectionHeading
      >
      <p
        v-if="request.execution_id"
        class="request-fact"
      >
        {{ t('requests.execution', { id: request.execution_id }) }}
      </p>
      <p
        v-if="request.session_id"
        class="request-fact"
      >
        {{ t('requests.session', { id: request.session_id }) }}
      </p>
    </header>
    <div class="request-meta">
      <span
        >{{ authorName }} <span v-if="authorSession">{{ authorSession }}</span></span
      >
      <span>{{ stamp(request.created_at) }}</span>
    </div>
    <template v-if="waiting">
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
        class="request-fact"
      >
        {{ deadlineLabel }}
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
        :draft="draft.answers"
        :note="draft.note"
        :prompt-id="promptId"
        :refused="refused"
        :disabled="fieldsDisabled"
        :suggest="suggest"
        @edit="edit"
        @note="writeNote"
        @submit="resolve('answer')"
      />
    </template>
    <RequestFold
      v-else
      :request="request"
      :unsent="unsent"
    />
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
      <RequestActions
        ref="actions"
        :busy="busy"
        :declining="declining"
        :disabled="sendDisabled"
        :refreshable="canRefresh"
        :standalone="standalone"
        :waiting="waiting"
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

.request-header {
  display: grid;
  gap: var(--space-1);
}

.request-title {
  overflow-wrap: anywhere;
}

/* Only the app moves focus to these, to the next question and to why a write did not
   go through, and Tab never stops on them, so the ring shows whenever they hold focus:
   it is the one sign of where the reader was taken. */
:is(.request-card, .request-title, .request-error):focus {
  border-radius: var(--radius-control);
  outline: 2px solid var(--color-focus-ring);
  outline-offset: var(--space-1);
}

.request-card:focus {
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

.request-context,
.request-fact {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.request-prompt {
  font: var(--font-editor);
}

/* What `RequestActions` asks lies against this, and takes no room in it. */
.request-foot {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  min-width: 0;
}

.request-error {
  flex: 1 1 16rem;
  min-width: 0;
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
