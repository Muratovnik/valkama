<script setup lang="ts">
/**
 * What a question of a kind other than a choice shows between its words and its answers: the
 * content its kind needs to be decided, each part under a quiet heading.
 *
 * A review shows the task's outcome under what to check, which is the question's own words. A
 * goal shows its description and conditions and how much open work stands under it; a task in a
 * goal, its description, its goal being named by the question. A group of findings shows the
 * goal it proposes, its findings and why the agent answers as it does. A condition shows what is
 * removed, and what each rewritten step was and becomes, with the agent's reason. A cancel shows
 * what closes and who holds it, and what the sessions at work answered. A confirmation and a
 * return say all they need in their own words: a confirmation adds the outcome the agent wrote.
 *
 * What the question does not carry is read from its card (`useQuestionItem`) when it first comes
 * into view; until it arrives that part takes no room, and a read that fails says so in place.
 *
 * The root names its kind (`data-kind-subject`) and each part its name (`data-kind-part`), the
 * hooks a check selects them by.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useQuestionItem } from '@/features/input-requests/composables/useQuestionItem.ts'
import type { QuestionKind } from '@/features/input-requests/utils/questionRecord.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { holderName } from '@/shared/lib/actor.ts'
import RichText from '@/shared/ui/RichText.vue'

const props = defineProps<{ entry: InputRequestEntry; kind: QuestionKind }>()
const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const readsCard = computed(() => ['goal', 'review', 'task'].includes(props.kind))
const { item, failed } = useQuestionItem(
  () => props.entry,
  () => readsCard.value,
  root,
)
const action = computed(() => props.entry.request.action)
const proposed = computed(() => action.value?.proposed ?? {})
const words = (text: string | undefined | null) => text?.trim() ?? ''
/** A session's answer in the person's words; one the server adds later stands as it came. */
const consentWord = (answer: string) =>
  ['agree', 'moved_out', 'object'].includes(answer)
    ? t(`requests.kinds.consentAnswers.${answer}`)
    : answer
/** The parts of the content, each a heading and its text, steps or rows; empty ones go. */
const parts = computed(() => {
  const found = item.value
  const said = {
    outcome: () =>
      props.kind === 'review' && found
        ? { text: words(found.summary?.done) || t('requests.kinds.noOutcome') }
        : null,
    description: () =>
      (props.kind === 'goal' || props.kind === 'task') && words(found?.description)
        ? { text: words(found?.description), bare: true }
        : null,
    conditions: () => {
      if (props.kind === 'triage' && proposed.value.conditions?.length)
        return { heading: 'proposedGoal', steps: proposed.value.conditions }
      const steps = props.kind === 'goal' ? (found?.checklist ?? []).map(({ text }) => text) : []
      return steps.length ? { steps } : null
    },
    under: () =>
      props.kind === 'goal' && action.value?.cancel_list
        ? { note: t('requests.kinds.under', { n: action.value.cancel_list.cancels.length }) }
        : null,
    findings: () => {
      const items = props.kind === 'triage' ? (proposed.value.items ?? []) : []
      return items.length ? { rows: items.map((one) => [one.reference, one.title]) } : null
    },
    removed: () => {
      const gone = props.kind === 'condition' ? (proposed.value.removed ?? []) : []
      return gone.length ? { steps: gone.map((step) => step.text) } : null
    },
    rewritten: () => {
      const changed = props.kind === 'condition' ? (proposed.value.rewritten ?? []) : []
      return changed.length
        ? { bare: true, pairs: changed.map((step) => [step.from, step.to]) }
        : null
    },
    closes: () => {
      const list = props.kind === 'cancel' ? (action.value?.cancel_list?.cancels ?? []) : []
      return list.length
        ? {
            rows: list.map((one) => [
              one.reference,
              `${one.title} · ${one.holder.map((holder) => holderName(holder)).join(', ') || t('requests.kinds.nobody')}`,
            ]),
          }
        : null
    },
    consent: () => {
      const answers = props.kind === 'cancel' ? (action.value?.consent ?? []) : []
      return answers.length
        ? {
            rows: answers.map((one) => [
              holderName(one.session),
              [one.answer && consentWord(one.answer), one.reason].filter(Boolean).join(': ') ||
                t('requests.kinds.noConsent'),
            ]),
          }
        : null
    },
    why: () => {
      const reasons: Partial<Record<QuestionKind, string>> = {
        triage: words(proposed.value.why),
        condition: words(action.value?.reason),
      }
      const reason = reasons[props.kind]
      return reason ? { text: reason } : null
    },
    summary: () => {
      const summary = proposed.value.summary
      const done =
        props.kind === 'confirm' && summary && 'done' in summary ? words(summary.done) : ''
      return done ? { heading: 'outcome', text: done } : null
    },
  }
  return Object.entries(said).flatMap(([name, part]) => {
    const shown = part()
    return shown ? [{ name, heading: name, ...shown }] : []
  })
})
</script>

<template>
  <div
    ref="root"
    class="kind-subject"
    :data-kind-subject="kind"
  >
    <p
      v-if="failed"
      class="kind-note"
      role="status"
    >
      {{ t('requests.kinds.unread') }}
    </p>
    <section
      v-for="part in parts"
      :key="part.name"
      class="kind-part"
      :data-kind-part="part.name"
    >
      <p
        v-if="!('bare' in part) && !('note' in part)"
        class="kind-label"
      >
        {{ t(`requests.kinds.${part.heading}`) }}
      </p>
      <RichText
        v-if="'text' in part"
        :source="part.text"
      />
      <p
        v-if="'note' in part"
        class="kind-note"
      >
        {{ part.note }}
      </p>
      <ul
        v-if="'steps' in part"
        class="kind-list"
      >
        <li
          v-for="(step, index) in part.steps"
          :key="index"
        >
          {{ step }}
        </li>
      </ul>
      <ul
        v-if="'rows' in part"
        class="kind-list"
      >
        <li
          v-for="([lead, rest], index) in part.rows"
          :key="index"
        >
          <span class="kind-lead">{{ lead }}</span> {{ rest }}
        </li>
      </ul>
      <dl
        v-if="'pairs' in part"
        class="kind-pairs"
      >
        <template
          v-for="([from, to], index) in part.pairs"
          :key="index"
        >
          <dt class="kind-label">{{ t('requests.kinds.was') }}</dt>
          <dd class="kind-step">{{ from }}</dd>
          <dt class="kind-label">{{ t('requests.kinds.becomes') }}</dt>
          <dd class="kind-step">{{ to }}</dd>
        </template>
      </dl>
    </section>
  </div>
</template>

<style scoped>
/* The parts stand at the record's own step, each heading close over what it heads. */
.kind-subject {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
}

.kind-part {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  overflow-wrap: anywhere;
}

.kind-label,
.kind-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.kind-list {
  display: grid;
  gap: var(--space-1);
  padding-inline-start: var(--space-5);
  margin: 0;
}

.kind-lead {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.kind-pairs {
  display: grid;
  gap: var(--space-1);
  margin: 0;
}

.kind-step {
  margin: 0 0 var(--space-2);
}
</style>
