<script setup lang="ts">
/**
 * A question answered row by row, the whole of it in the thread where it was asked: its points
 * in their groups (`RequestGroup`), each answered with a verdict (`RequestVerdictRow`), and what
 * a point's answer opens right under it, shown only while that answer holds.
 *
 * Its head counts what is decided and fills every point still undecided with what the agent
 * recommends, at one press. That press chooses for the person only where they had not, sends
 * nothing and is undone by hand; focus stays on it, and what it did is said once. While any of
 * the form is in view the head stays at the top of the panel that scrolls it, as the card's
 * foot stays at the bottom, so the count and Send are in sight on a form of twenty-five fields.
 * Neither may cover what has focus: the card moves what it would cover clear of them.
 *
 * Every other field is the one a plain question has (`RequestField`).
 */
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestField from '@/features/input-requests/components/RequestField.vue'
import RequestGroup from '@/features/input-requests/components/RequestGroup.vue'
import RequestVerdictRow from '@/features/input-requests/components/RequestVerdictRow.vue'
import {
  childrenOf,
  chooseVerdict,
  fillRecommended,
  sections,
  shortName,
  shownVerdicts,
  undecidedVerdicts,
} from '@/features/input-requests/utils/reviewForm.ts'
import type { Verdict } from '@/features/input-requests/utils/reviewForm.ts'
import { chosenOwn, editField, isShown } from '@/features/input-requests/utils/validateAnswers.ts'
import type { FieldEdit, RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { plainText } from '@/shared/lib/richText.ts'
import type MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import VButton from '@/shared/ui/VButton.vue'

type EditorSuggest = InstanceType<typeof MarkdownEditor>['$props']['suggest']

const props = withDefaults(
  defineProps<{
    disabled: boolean
    draft: RequestDraft
    fields: readonly InputRequestField[]
    promptId: string
    refused: readonly string[]
    suggest?: EditorSuggest
  }>(),
  { suggest: undefined },
)
const emit = defineEmits<{ edit: [draft: RequestDraft]; submit: [] }>()
const preview = defineModel<boolean>('preview', { default: false })
const { t } = useI18n()

/** The few undecided points named in the head; past this many the count says enough. */
const NAMED = 3
const groups = computed(() => sections(props.fields))
const verdicts = computed(() => shownVerdicts(props.fields, props.draft.answers))
const undecided = computed(() => undecidedVerdicts(props.fields, props.draft))
const decidedLine = computed(() => {
  const total = verdicts.value.length
  const count = t('requests.review.decided', { done: total - undecided.value.length, total })
  const names = undecided.value.map((field) => plainText(shortName(field)))
  return names.length && names.length <= NAMED
    ? `${count} · ${t('requests.review.undecidedNames', { names: names.join(', ') })}`
    : count
})
const recommends = computed(() => props.fields.some((field) => field.recommended))
const announced = ref('')
function fill() {
  const { draft, filled } = fillRecommended(props.fields, props.draft)
  announced.value = filled
    ? t('requests.review.filled', { n: filled }, filled)
    : t('requests.review.nothingToFill')
  if (filled) emit('edit', draft)
}

const closed = ref<ReadonlySet<string>>(new Set())
const isOpen = (group: string | null) => group === null || !closed.value.has(group)
function setOpen(group: string | null, open: boolean) {
  if (group === null) return
  const next = new Set(closed.value)
  if (open) next.delete(group)
  else next.add(group)
  closed.value = next
}
/** A group's points and what stands under them, for its count. */
function groupCount(fields: readonly InputRequestField[]) {
  const shown = shownVerdicts(
    fields.flatMap((field) => [field, ...childrenOf(props.fields, field.id)]),
    props.draft.answers,
  )
  const open = undecidedVerdicts(shown, props.draft).length
  return { decided: shown.length - open, total: shown.length }
}
/** A field drawn as a plain one, and what its answer opens under it while that holds. */
function plainFields(field: InputRequestField) {
  const under = childrenOf(props.fields, field.id).filter((child) =>
    isShown(child, props.draft.answers),
  )
  return field.type === 'verdict' ? under : [field, ...under]
}
/** What Accept opens on a point, by its label. */
function opensOn(field: InputRequestField) {
  const opened = childrenOf(props.fields, field.id).find(
    (child) => child.under?.option === 'accept',
  )
  return opened ? plainText(opened.label) : ''
}
const uid = useId()
const countIdOf = (parent: string) => `${uid}-${parent}-count`
/** The steps of a point are described by how many of them are ticked, which stands on the point. */
const describedBy = (field: InputRequestField) =>
  field.under && field.type === 'multi_choice' ? countIdOf(field.under.field) : undefined
/** How many steps are ticked under a point, while they show. */
function countOn(field: InputRequestField) {
  const steps = childrenOf(props.fields, field.id).find(
    (child) => child.type === 'multi_choice' && isShown(child, props.draft.answers),
  )
  if (!steps) return null
  const value = props.draft.answers[steps.id]
  return { chosen: Array.isArray(value) ? value.length : 0, total: steps.options.length }
}

const isOwnChosen = (field: InputRequestField) => props.draft.ownChosen.includes(field.id)
const isRefused = (field: InputRequestField) => props.refused.includes(field.id)
const ownRefused = (field: InputRequestField) =>
  isRefused(field) && isOwnChosen(field) && !chosenOwn(props.draft, field.id)
const ownError = (field: InputRequestField) => (ownRefused(field) ? t('requests.missing.own') : '')
function fieldError(field: InputRequestField) {
  if (!isRefused(field) || ownRefused(field)) return ''
  if (field.type === 'verdict') return t('requests.review.missingVerdict')
  return field.under
    ? t('requests.review.missingUnder', { field: plainText(field.label) })
    : t(`requests.missing.${field.type}`)
}

const edit = (field: InputRequestField, change: FieldEdit) =>
  emit('edit', editField(props.draft, field.id, change))
const choose = (field: InputRequestField, verdict: Verdict) =>
  emit('edit', chooseVerdict(props.fields, props.draft, field, verdict))

const controls: Record<string, { focus: () => void } | null> = {}
/** Takes focus to one field, opening its group first. */
async function focusField(id: string) {
  const field = props.fields.find((candidate) => candidate.id === id)
  const parent = props.fields.find((candidate) => candidate.id === field?.under?.field)
  setOpen((parent ?? field)?.group ?? null, true)
  preview.value = false
  await nextTick()
  controls[id]?.focus()
}
defineExpose({ focusField, undecided: computed(() => undecided.value.length) })
</script>

<template>
  <div class="request-review">
    <div
      v-if="verdicts.length"
      class="request-review-head"
      data-stuck-edge="start"
    >
      <p class="request-review-count">{{ decidedLine }}</p>
      <VButton
        v-if="recommends"
        class="request-review-fill"
        size="compact"
        :disabled="disabled"
        @click="fill"
        >{{ t('requests.review.fill') }}</VButton
      >
      <p
        class="visually-hidden"
        role="status"
      >
        {{ announced }}
      </p>
    </div>
    <RequestGroup
      v-for="section in groups"
      :key="section.group ?? section.fields[0]?.id"
      v-bind="groupCount(section.fields)"
      :open="isOpen(section.group)"
      :title="section.group"
      @update:open="setOpen(section.group, $event)"
    >
      <template
        v-for="field in section.fields"
        :key="field.id"
      >
        <RequestVerdictRow
          v-if="field.type === 'verdict'"
          :ref="(row) => (controls[field.id] = row as { focus: () => void } | null)"
          v-model:preview="preview"
          :count="countOn(field)"
          :count-id="countIdOf(field.id)"
          :disabled="disabled"
          :error="fieldError(field)"
          :field="field"
          :note="draft.fieldNotes[field.id]"
          :opens="opensOn(field)"
          :own="draft.own[field.id]"
          :own-chosen="isOwnChosen(field)"
          :own-error="ownError(field)"
          :suggest="suggest"
          :value="draft.answers[field.id]"
          @edit="edit(field, $event)"
          @submit="emit('submit')"
          @verdict="choose(field, $event)"
        />
        <RequestField
          v-for="shown in plainFields(field)"
          :key="shown.id"
          :ref="(control) => (controls[shown.id] = control as { focus: () => void } | null)"
          v-model:preview="preview"
          :class="{ 'request-review-under': shown.under }"
          :described-by="describedBy(shown)"
          :field="shown"
          :model-value="draft.answers[shown.id]"
          :note="draft.fieldNotes[shown.id]"
          :own="draft.own[shown.id]"
          :own-chosen="isOwnChosen(shown)"
          :own-error="ownError(shown)"
          :disabled="disabled"
          :error="fieldError(shown)"
          :prompt-id="promptId"
          :suggest="suggest"
          several
          @edit="edit(shown, $event)"
          @submit="emit('submit')"
        />
      </template>
    </RequestGroup>
  </div>
</template>

<style scoped>
.request-review {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}

/* At the top of the panel that scrolls the form, under whatever the panel keeps there
   (`--size-stuck-top`), on the question's own ground so what passes under it is covered. */
.request-review-head {
  position: sticky;
  inset-block-start: var(--size-stuck-top, 0);
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  justify-content: space-between;
  align-items: center;
  min-width: 0;
  padding-block: var(--space-2);
  margin-block: calc(-1 * var(--space-2));
  background: var(--color-surface-sheet);

  /* A forced palette clears that ground, and with it the edge of what stays put. */
  @media (forced-colors: active) {
    outline: 1px solid CanvasText;
  }
}

.request-review-count {
  min-width: 0;
  margin: 0;
  font: var(--font-strong);
}

/* What a point's answer opens stands under it, set in as an answer to it: by the step the
   point's own words stand in from its edge, so the opened rows start under those words. */
.request-review-under {
  margin-inline-start: var(--space-set-in);
}
</style>
