<script setup lang="ts">
/**
 * A question no longer waiting: what was asked, and under it how that ended. An answer
 * stands as a reply, with who gave it and when, and every field shows all it offered with
 * what was chosen set apart, because an answer read without its options says neither what
 * was weighed nor what was left. A question declined or closed says so on one quiet line.
 *
 * Only that first line of the reply is a status, and it is what focus comes to. Everything
 * under it is there to be read on, and a live region around twelve options would read all
 * of them out each time an answer arrived.
 *
 * Words still in the form when the question closed some other way are the only copy of
 * what was written. They stay in view under their own words, and never join the reply. A
 * choice made there was never sent either, so it is said too, one line per field, ahead of
 * the words; a form that held only a choice used to fold as if it had held nothing.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestFieldAnswer from '@/features/input-requests/components/RequestFieldAnswer.vue'
import RequestHistory from '@/features/input-requests/components/RequestHistory.vue'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import MetaLine from '@/shared/ui/MetaLine.vue'
import RichText from '@/shared/ui/RichText.vue'

const props = defineProps<{
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
  return at ? d(new Date(at), 'activity') : ''
})
/** The time of the answer in force, which says it replaced another once there is one. */
const answerTime = computed(() =>
  props.request.history.length ? t('requests.changedAt', { time: when.value }) : when.value,
)
/** "You" is the server's word about the call that closed this: a name is only what it signed. */
const replier = computed(() => {
  const { answered_by: by, by_person: person } = props.request
  if (person) return t('requests.youAnswered')
  return by ? t('requests.agentAnswered', { actor: actorName(by) }) : t('requests.answered')
})
/** One text field reads as the sentence it is, with nothing to tell it from. */
const bareText = computed(() => props.request.fields.length === 1)
const note = computed(() => props.request.note ?? '')
/** What the note over the unsent part says it is: what was chosen, written, or both. */
const unsentNote = computed(() => {
  if (!props.unsentChosen.length) return t('requests.draftKept')
  return t(props.unsent ? 'requests.draftKeptBoth' : 'requests.draftKeptChosen')
})
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
        class="request-reply-meta request-state"
        role="status"
        tabindex="-1"
        :when="answerTime"
        >{{ replier }}</MetaLine
      >
      <RequestFieldAnswer
        v-for="field in request.fields"
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
      class="request-closed request-state"
      role="status"
      tabindex="-1"
    >
      {{ closing }}<template v-if="when"> · {{ when }}</template>
    </p>
    <div
      v-if="unsent || unsentChosen.length"
      class="request-unsent"
    >
      <p class="request-unsent-note">{{ unsentNote }}</p>
      <p
        v-for="line in unsentChosen"
        :key="line"
        class="request-unsent-text"
      >
        {{ line }}
      </p>
      <p
        v-if="unsent"
        class="request-unsent-text"
      >
        {{ unsent }}
      </p>
    </div>
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
  padding-inline-start: var(--space-3);
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

/* The app moves focus to how a question ended and rings it (`moveFocus`); a press here
   rings nothing. These words run to both edges of the line, so the ring stands clear of them. */
.request-state:focus-visible {
  border-radius: var(--radius-control);
  outline-offset: var(--space-1);
}

.request-unsent {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.request-unsent-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.request-unsent-text {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-editor);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
