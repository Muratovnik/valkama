<script setup lang="ts">
/**
 * A question no longer waiting: what was asked, and under it how that ended. An answer
 * stands as a reply, with who gave it and when; one field reads as a sentence, several
 * with their labels. A question declined or closed says so on one quiet line.
 *
 * A note still in the form when the question closed some other way is the only copy of
 * what was written. It stays in view under its own words, and it never joins the reply.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { displayAnswer } from '@/features/input-requests/utils/answerDisplay.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import RichText from '@/shared/ui/RichText.vue'

const props = defineProps<{
  request: InputRequestEntry['request']
  /** What was still being written when the question closed. */
  unsent: string
}>()
const { t, d } = useI18n()
const answered = computed(() => props.request.status === 'answered')
const when = computed(() => {
  const at = props.request.resolved_at
  return at ? d(new Date(at), 'activity') : ''
})
/** "You" is the server's word about the call that closed this: a name is only what it signed. */
const replier = computed(() => {
  const { answered_by: by, by_person: person } = props.request
  if (person) return t('requests.youAnswered')
  return by ? t('requests.agentAnswered', { actor: actorName(by) }) : t('requests.answered')
})
/**
 * The fields that have an answer, as the reader reads them. Words written are markdown; a
 * label chosen is the text the form showed, whatever characters it happens to hold.
 */
const replies = computed(() =>
  props.request.fields
    .filter((field) => props.request.answers?.[field.id] !== undefined)
    .map((field) => ({
      id: field.id,
      label: field.label,
      rich: field.type === 'text',
      value: displayAnswer(field, props.request.answers?.[field.id], t),
    })),
)
const onlyReply = computed(() => {
  const [first] = replies.value
  return replies.value.length === 1 && props.request.fields.length === 1 && first?.value
    ? first
    : null
})
const labelled = computed(() => (onlyReply.value ? [] : replies.value))
const note = computed(() => props.request.note ?? '')
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
      class="request-reply request-state"
      role="status"
      tabindex="-1"
    >
      <div class="request-reply-meta">
        <span>{{ replier }}</span>
        <span>{{ when }}</span>
      </div>
      <template v-if="onlyReply">
        <RichText
          v-if="onlyReply.rich"
          class="request-reply-text"
          :source="onlyReply.value"
        />
        <p
          v-else
          class="request-reply-text request-reply-chosen"
        >
          {{ onlyReply.value }}
        </p>
      </template>
      <dl
        v-if="labelled.length"
        class="request-outcome"
        :aria-label="t('requests.outcome')"
      >
        <template
          v-for="reply in labelled"
          :key="reply.id"
          ><dt class="request-term">{{ reply.label }}</dt>
          <dd class="request-value">
            <RichText
              v-if="reply.rich"
              :source="reply.value"
            />
            <template v-else>{{ reply.value }}</template>
          </dd></template
        >
      </dl>
      <RichText
        v-if="note"
        class="request-reply-text"
        :source="note"
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
      v-if="unsent"
      class="request-unsent"
    >
      <p class="request-unsent-note">{{ t('requests.draftKept') }}</p>
      <p class="request-unsent-text">{{ unsent }}</p>
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
  gap: var(--space-1);
  min-width: 0;
  padding-inline-start: var(--space-3);
  border-inline-start: 1px solid var(--color-rule-strong);
}

.request-reply-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: space-between;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.request-reply-text {
  font: var(--font-editor);
}

.request-reply-chosen {
  margin: 0;
  overflow-wrap: anywhere;
}

.request-outcome {
  display: grid;
  gap: var(--space-half);
  margin: 0;
  font: var(--font-editor);
}

.request-term {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.request-value {
  margin: 0 0 var(--space-1);
  overflow-wrap: anywhere;
}

.request-closed {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* Only the app moves focus to how a question ended, and Tab never stops here, so the
   ring shows whenever it holds focus: it is the one sign of where the reader was taken.
   These words run to both edges of the line, so the ring stands clear of them. */
.request-state:focus {
  border-radius: var(--radius-control);
  outline: 2px solid var(--color-focus-ring);
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
