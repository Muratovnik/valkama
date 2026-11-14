<script setup lang="ts">
/**
 * Accepting what the agent recommends in several blocks of questions at once.
 *
 * It chooses for the person only on their press, and sends only on a second one. The first opens
 * in place the list of what would go, a line per question: its task's number, its title, and what
 * would be chosen in it, the agent's recommendation filled over what the person had already
 * chosen there (`recommendedAnswers`). A question its recommendation does not answer is not in
 * the list, and the list says how many are not. Accept N sends them: each question is filled, so
 * what it holds is what went, and written by its own record, so the record says how it ended. A
 * question that went folds where it stands; one that did not keeps what was filled, with the
 * reason in its foot. Focus stays here meanwhile and comes, after, to the line that says how many
 * went. While they are out the list stays as it was sent: filled, those questions recommend
 * nothing more, and a list read again from them emptied under the press that sent it.
 */
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import type { Outcome } from '@/features/input-requests/composables/useRequestWrites.ts'
import { unsentChoices } from '@/features/input-requests/utils/answerDisplay.ts'
import { recommendedAnswers } from '@/features/input-requests/utils/questionRecord.ts'
import type {
  QuestionRecord,
  RecommendedAnswer,
} from '@/features/input-requests/utils/questionRecord.ts'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  records: readonly QuestionRecord[]
  /** What each question's form holds now. */
  draftOf: (record: QuestionRecord) => RequestDraft
  /** Fills one question as given and writes it through its record. */
  send: (answer: RecommendedAnswer) => Promise<Outcome>
}>()
const { t } = useI18n()
const listId = useId()
const open = ref(false)
/** What Accept N sent, held while its writes are out. */
const sending = ref<readonly RecommendedAnswer[] | null>(null)
const result = ref<{ sent: number; total: number } | null>(null)
const resultLine = ref<HTMLElement | null>(null)
const split = computed(() => recommendedAnswers(props.records, props.draftOf))
const listed = computed(() => sending.value ?? split.value.ready)
const shown = computed(() => listed.value.length > 0 || open.value || result.value !== null)
const controls = computed(() => (open.value ? listId : undefined))
const busyMark = computed(() => (sending.value ? true : undefined))
const resultText = computed(() => {
  if (!result.value) return ''
  const { sent, total } = result.value
  return sent === total
    ? t('requests.record.sent', { sent, total })
    : t('requests.record.sentPart', { sent, total, failed: total - sent })
})
/** The question as the list names it: its task's number and its title. */
const nameOf = ({ record }: RecommendedAnswer) =>
  `${record.entry.request.reference} · ${record.entry.request.title}`
const chosen = ({ draft, record }: RecommendedAnswer) =>
  unsentChoices(record.entry.request.fields, draft, t)

function toggle() {
  if (sending.value) return
  open.value = !open.value
  if (open.value) result.value = null
}
async function accept() {
  const { ready } = split.value
  if (sending.value || !ready.length) return
  sending.value = ready
  const outcomes = await Promise.all(ready.map((answer) => props.send(answer)))
  sending.value = null
  open.value = false
  result.value = {
    sent: outcomes.filter((outcome) => outcome === 'sent').length,
    total: ready.length,
  }
  await nextTick()
  moveFocus(resultLine.value)
}
</script>

<template>
  <div
    v-if="shown"
    class="request-recommended"
  >
    <div class="request-recommended-line">
      <VButton
        :aria-controls="controls"
        :aria-disabled="busyMark"
        :aria-expanded="open"
        @click="toggle"
        >{{ t('requests.record.acceptAll') }}</VButton
      >
      <p
        v-if="result"
        ref="resultLine"
        class="request-recommended-result focus-landing"
        role="status"
        tabindex="-1"
      >
        {{ resultText }}
      </p>
    </div>
    <div
      v-if="open"
      :id="listId"
      class="request-recommended-list"
    >
      <ul class="request-recommended-items">
        <li
          v-for="answer in listed"
          :key="requestIdentity(answer.record.entry)"
          class="request-recommended-item"
        >
          <span class="request-recommended-name">{{ nameOf(answer) }}</span>
          <span
            v-for="line in chosen(answer)"
            :key="line"
            class="request-recommended-chosen"
            >{{ line }}</span
          >
        </li>
      </ul>
      <p
        v-if="split.rest.length"
        class="request-recommended-left"
      >
        {{ t('requests.record.left', { n: split.rest.length }) }}
      </p>
      <VButton
        v-if="listed.length"
        variant="primary"
        :aria-disabled="busyMark"
        @click="accept"
        >{{ t('requests.record.acceptN', { n: listed.length }) }}</VButton
      >
    </div>
  </div>
</template>

<style scoped>
.request-recommended {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.request-recommended-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  min-width: 0;
}

.request-recommended-result,
.request-recommended-left {
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.request-recommended-result {
  flex: 1 1 auto;
}

.request-recommended-list {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
  min-width: 0;
  padding: var(--space-3);
  background: var(--color-surface-sheet);
  border-radius: var(--radius-card);
}

.request-recommended-items {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

.request-recommended-item {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
}

.request-recommended-name {
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.request-recommended-chosen {
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}
</style>
