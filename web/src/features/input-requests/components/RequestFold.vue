<script setup lang="ts">
/**
 * A question no longer waiting: what was asked, and under it how that ended. An answer
 * stands as a reply, with who gave it and when, and every field shows all it offered with
 * what was chosen set apart, because an answer read without its options says neither what
 * was weighed nor what was left. A question declined or closed says so on one quiet line.
 *
 * Only that first line of the reply is a status, and it describes the question focus comes
 * to (`outcomeId`). Everything under it is there to be read on, and a live region around
 * twelve options would read all of them out each time an answer arrived.
 *
 * A question answered row by row reads as a summary instead (`RequestSummary`): how its points
 * were decided, with every row behind a press on a review that would run to a screen and more.
 *
 * Words still in the form when the question closed some other way are the only copy of
 * what was written. They stay in view (`RequestUnsent`), and never join the reply.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestFieldAnswer from '@/features/input-requests/components/RequestFieldAnswer.vue'
import RequestHistory from '@/features/input-requests/components/RequestHistory.vue'
import RequestSummary from '@/features/input-requests/components/RequestSummary.vue'
import RequestUnsent from '@/features/input-requests/components/RequestUnsent.vue'
import { isStructured } from '@/features/input-requests/utils/reviewForm.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import { unbroken } from '@/shared/lib/unbroken.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import MetaLine from '@/shared/ui/MetaLine.vue'
import RichText from '@/shared/ui/RichText.vue'

const props = defineProps<{
  /** The id of the line that says how the question ended, which describes the question. */
  outcomeId: string
  request: InputRequestEntry['request']
  /** What was still being written when the question closed. */
  unsent: string
  /** What was chosen and not sent when it closed, a line per field. */
  unsentChosen: readonly string[]
}>()
const { t, d } = useI18n()
const answered = computed(() => props.request.status === 'answered')
const when = computed(() => {
  const at = props.request.resolved_at
  return at ? unbroken(d(new Date(at), 'activity')) : ''
})
/** The time of the answer in force, which says it replaced another once there is one. */
const answerTime = computed(() =>
  props.request.history.length ? t('requests.changedAt', { time: when.value }) : when.value,
)
/**
 * "You" is the server's word about the call that closed this, and so is "agent": a name is only
 * what it signed. With no call behind the answer, as before calls were recorded, it is a name.
 */
const replier = computed(() => {
  const { answered_by: by, by_person: person } = props.request
  if (person) return t('requests.youAnswered')
  if (!by) return t('requests.answered')
  const signed = person === false ? 'requests.agentAnswered' : 'requests.answeredBy'
  return t(signed, { actor: actorName(by) })
})
const structured = computed(() => isStructured(props.request.fields))
/** One text field reads as the sentence it is, with nothing to tell it from. */
const bareText = computed(() => props.request.fields.length === 1)
const note = computed(() => props.request.note ?? '')
/** Each field answered on its own, where the question is not answered row by row. */
const plainFields = computed(() => (structured.value ? [] : props.request.fields))
const closing = computed(() => {
  const { status, answered_by: by, by_person: person } = props.request
  if (status === 'answered') return ''
  if (status === 'declined' && person) return t('requests.youDeclined')
  if (status === 'declined' && by) return t('requests.agentDeclined', { actor: actorName(by) })
  const state = t(`requests.${status}`)
  if (!by) return state
  const signed = person === false ? 'requests.agentResolved' : 'requests.resolvedBy'
  return `${state} · ${t(signed, { actor: actorName(by) })}`
})
</script>

<template>
  <div class="request-fold">
    <CollapsibleText
      class="request-prompt"
      :reset-key="request.request_id"
      :lines="4"
    >
      <RichText :source="request.prompt" />
    </CollapsibleText>
    <div
      v-if="answered"
      class="request-reply"
    >
      <MetaLine
        :id="outcomeId"
        class="request-reply-meta request-state"
        role="status"
        :when="answerTime"
        phrase
        >{{ replier }}</MetaLine
      >
      <RequestSummary
        v-if="structured"
        :request="request"
      />
      <RequestFieldAnswer
        v-for="field in plainFields"
        :key="field.id"
        :bare-text="bareText"
        :field="field"
        :note="request.field_notes?.[field.id]"
        :own="request.own?.[field.id]"
        :value="request.answers?.[field.id]"
      />
      <blockquote
        v-if="note"
        class="request-reply-note"
        :aria-label="t('requests.questionNote')"
      >
        <span class="request-reply-note-label">{{ t('requests.questionNote') }}</span>
        <RichText :source="note" />
      </blockquote>
      <RequestHistory
        v-if="request.history.length"
        :request="request"
      />
    </div>
    <p
      v-else
      :id="outcomeId"
      class="request-closed request-state"
      role="status"
    >
      {{ closing }}<template v-if="when"> · {{ when }}</template>
    </p>
    <RequestUnsent
      :unsent="unsent"
      :unsent-chosen="unsentChosen"
    />
  </div>
</template>

<style scoped>
.request-fold {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.request-prompt {
  font: var(--font-editor);
}

/* A reply to the prompt above it, set in from it as a quote is. */
.request-reply {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  padding-inline-start: var(--space-set-in);
  border-inline-start: 1px solid var(--color-rule-strong);
}

.request-reply-note {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
  margin: 0;
  font: var(--font-editor);
}

.request-reply-note-label {
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

.request-closed {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
