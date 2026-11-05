<script setup lang="ts">
/**
 * The answers a change replaced, behind a press, newest first: what the agent was told
 * before, who said it and when. The answer in force stands above with its options; these
 * are the record of what stood, one line per field.
 *
 * A review's versions read as what the next answer changed in them, row by row, by the same
 * rule the agent is told a change with (`answerDiff`): twenty-five lines a version are not read.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { answerDiff, diffText } from '@/features/input-requests/utils/answerDiff.ts'
import type { AnswerSide } from '@/features/input-requests/utils/answerDiff.ts'
import { versionLines } from '@/features/input-requests/utils/answerDisplay.ts'
import { isReview } from '@/features/input-requests/utils/reviewForm.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import { plainText } from '@/shared/lib/richText.ts'
import MetaLine from '@/shared/ui/MetaLine.vue'
import VButton from '@/shared/ui/VButton.vue'

type Request = InputRequestEntry['request']

const props = defineProps<{ request: Request }>()
const { t, d } = useI18n()
const open = ref(false)
const review = computed(() => isReview(props.request.fields))
/** The answer in force, as the last side a version is compared with. */
const inForce = computed<AnswerSide>(() => ({
  answers: props.request.answers ?? {},
  field_notes: props.request.field_notes ?? {},
  note: props.request.note,
  own: props.request.own ?? {},
}))
/** A version's lines: each field it answered, or on a review what the next answer changed. */
function linesOf(index: number) {
  const { fields, history } = props.request
  const version = history[index]
  if (!version) return []
  if (!review.value) return versionLines(fields, version, t)
  return answerDiff(fields, version, history[index + 1] ?? inForce.value).map((row, at) => ({
    id: `${at}`,
    text: diffText(fields, row, t),
  }))
}
const versions = computed(() =>
  props.request.history
    .map((version, index) => ({
      ...version,
      lines: linesOf(index),
      who: who(version),
      when: d(new Date(version.answered_at), 'activity'),
    }))
    .reverse(),
)
/** "You" is the server's word about the call, as in the answer in force. */
function who({ by_person: person, answered_by: by }: Request['history'][number]) {
  if (person) return t('requests.you')
  return by ? actorName(by) : ''
}
</script>

<template>
  <div class="request-history">
    <VButton
      class="request-history-toggle"
      variant="text"
      size="inline"
      :aria-expanded="open"
      @click="open = !open"
      >{{ t('requests.previous', { count: request.history.length }) }}</VButton
    >
    <ol
      v-if="open"
      class="request-history-list"
    >
      <li
        v-for="version in versions"
        :key="version.version"
        class="request-history-version"
      >
        <MetaLine
          class="request-history-meta"
          :when="version.when"
          >{{ version.who }}</MetaLine
        >
        <p
          v-for="line in version.lines"
          :key="line.id"
          class="request-history-line"
        >
          {{ line.text }}
        </p>
        <p
          v-if="version.note && !review"
          class="request-history-line"
        >
          {{ t('requests.questionNoteSaid', { text: plainText(version.note) }) }}
        </p>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.request-history {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

/* Earlier answers are read, not acted on: bare, its words where the answer's lines start,
   the margin taking back the inset its fill keeps under the pointer. */
.request-history-toggle {
  justify-self: start;
  margin-inline-start: calc(-1 * var(--space-2));
}

.request-history-list {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

.request-history-version {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
  padding-inline-start: var(--space-2);
  border-inline-start: 1px solid var(--color-rule-strong);
}

.request-history-line {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}
</style>
