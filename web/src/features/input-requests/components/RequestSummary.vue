<script setup lang="ts">
/**
 * A review once answered: one line of how its points were decided, «Accepted 14 · put off 1 ·
 * rejected 1 · own option 1 · undecided 1», and the points that were not simply accepted by
 * name, because they are what anyone reading it after looks for.
 *
 * Every row stands behind «Show all 18 rows», folded at first: a review answered whole runs to
 * thousands of pixels and would push the discussion under it out of reach. Opened, each point
 * says its verdict in a word, its own variant and its comment, and what stood under it shows
 * every option with what was chosen, as any answered field does (`RequestFieldAnswer`). A
 * question with only a few verdicts and no group shows its rows open, as a plain one does.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestFieldAnswer from '@/features/input-requests/components/RequestFieldAnswer.vue'
import {
  childrenOf,
  isReview,
  sections,
  shortName,
} from '@/features/input-requests/utils/reviewForm.ts'
import { isShown } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { plainText } from '@/shared/lib/richText.ts'
import RichText from '@/shared/ui/RichText.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ request: InputRequestEntry['request'] }>()
const { t } = useI18n()
const rowsId = useId()

type Outcome = 'accept' | 'later' | 'own' | 'reject' | 'undecided'
const ORDER: readonly Outcome[] = ['accept', 'later', 'reject', 'own', 'undecided']

const answers = computed(() => props.request.answers ?? {})
const own = computed(() => props.request.own ?? {})
const notes = computed(() => props.request.field_notes ?? {})
/** A point's outcome: its word, its own variant in place of one, or neither. */
function outcomeOf(field: InputRequestField): Outcome {
  const value = answers.value[field.id]
  if (value === 'accept' || value === 'later' || value === 'reject') return value
  return own.value[field.id] ? 'own' : 'undecided'
}
const verdicts = computed(() =>
  props.request.fields.filter((field) => field.type === 'verdict' && isShown(field, answers.value)),
)
const byOutcome = computed(() => {
  const groups = new Map<Outcome, InputRequestField[]>(ORDER.map((outcome) => [outcome, []]))
  for (const field of verdicts.value) groups.get(outcomeOf(field))?.push(field)
  return groups
})
const counts = computed(() => {
  const parts = ORDER.flatMap((outcome) => {
    const n = byOutcome.value.get(outcome)?.length ?? 0
    return n ? [t(`requests.review.count.${outcome}`, { n })] : []
  })
  const [first = '', ...rest] = parts
  return { first: `${first.charAt(0).toLocaleUpperCase()}${first.slice(1)}`, rest }
})
/** What was not simply accepted, by name, in the order of the counts. */
const named = computed(() =>
  ORDER.slice(1)
    .flatMap((outcome) => {
      const fields = byOutcome.value.get(outcome) ?? []
      const names = fields.map((field) => plainText(shortName(field))).join(', ')
      return fields.length ? [t(`requests.review.named.${outcome}`, { names })] : []
    })
    .join(' '),
)

const folds = computed(() => isReview(props.request.fields))
const open = ref(false)
const shown = computed(() => !folds.value || open.value)
const toggleLabel = computed(() =>
  open.value
    ? t('requests.review.hideRows')
    : t('requests.review.showRows', { n: verdicts.value.length }, verdicts.value.length),
)
const groups = computed(() => sections(props.request.fields))
const underOf = (field: InputRequestField) =>
  childrenOf(props.request.fields, field.id).filter((child) => isShown(child, answers.value))
const ownOf = (field: InputRequestField) => own.value[field.id] ?? ''
const noteOf = (field: InputRequestField) => notes.value[field.id] ?? ''
function wordOf(field: InputRequestField) {
  const outcome = outcomeOf(field)
  if (outcome === 'own') return t('requests.ownVariant')
  return outcome === 'undecided'
    ? t('requests.review.undecided')
    : t(`requests.review.said.${outcome}`)
}
</script>

<template>
  <div class="request-summary">
    <p class="request-summary-counts">
      <span class="request-summary-lead">{{ counts.first }}</span>
      <template
        v-for="part in counts.rest"
        :key="part"
      >
        · {{ part }}</template
      >
    </p>
    <p
      v-if="named"
      class="request-summary-named"
    >
      {{ named }}
    </p>
    <VButton
      v-if="folds"
      class="request-summary-toggle"
      variant="text"
      size="inline"
      :aria-controls="rowsId"
      :aria-expanded="open"
      @click="open = !open"
      >{{ toggleLabel }}</VButton
    >
    <div
      v-if="shown"
      :id="rowsId"
      class="request-summary-rows"
    >
      <section
        v-for="section in groups"
        :key="section.group ?? section.fields[0]?.id"
        class="request-summary-group"
      >
        <p
          v-if="section.group"
          class="request-summary-heading"
        >
          {{ section.group }}
        </p>
        <template
          v-for="field in section.fields"
          :key="field.id"
        >
          <div
            v-if="field.type === 'verdict'"
            class="request-summary-point"
          >
            <RichText
              class="request-summary-label"
              :source="field.label"
              inline
            />
            <span class="request-summary-word">{{ wordOf(field) }}</span>
            <RichText
              v-if="ownOf(field)"
              class="request-summary-quote"
              :source="ownOf(field)"
            />
            <blockquote
              v-if="noteOf(field)"
              class="request-summary-quote"
              :aria-label="t('requests.fieldNote')"
            >
              <RichText :source="noteOf(field)" />
            </blockquote>
          </div>
          <RequestFieldAnswer
            v-else
            :bare-text="false"
            :field="field"
            :note="notes[field.id]"
            :own="own[field.id]"
            :value="answers[field.id]"
          />
          <RequestFieldAnswer
            v-for="child in underOf(field)"
            :key="child.id"
            class="request-summary-under"
            :bare-text="false"
            :field="child"
            :note="notes[child.id]"
            :own="own[child.id]"
            :value="answers[child.id]"
          />
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.request-summary {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.request-summary-counts {
  margin: 0;
  font: var(--font-editor);
  overflow-wrap: anywhere;
}

.request-summary-lead {
  font-weight: 600;
}

.request-summary-named {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

/* Reading, not acting: bare, its words where the summary's start. */
.request-summary-toggle {
  justify-self: start;
  margin-inline-start: calc(-1 * var(--space-2));
}

.request-summary-rows,
.request-summary-group {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.request-summary-heading {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

.request-summary-point {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
}

.request-summary-label {
  font: var(--font-strong);
}

.request-summary-word,
.request-summary-quote {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.request-summary-quote {
  padding-inline-start: var(--space-2);
  margin: 0;
}

/* What a point's answer opened stands under it, set in as an answer to it. */
.request-summary-under {
  margin-inline-start: var(--space-4);
}
</style>
