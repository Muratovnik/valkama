<script setup lang="ts">
/**
 * One field of a question, drawn as the control its answer needs. Selecting only
 * selects: the card's Send is what sends.
 *
 * Every choice is a full-width row, whether it is one of two or of twenty and whether
 * one answer is taken or several, so there is one thing to learn and every option
 * stays in sight (`RequestOption`). The radio is named by its label alone, or a screen
 * reader would read the paragraphs under it on every arrow press; a line of description
 * is its description, a text is not.
 *
 * What is folded opens on its own press, stays open beside another and selects nothing.
 * What is chosen is never left folded: it stands whole under the options
 * (`RequestChosen`) unless it is open in its row, so the toggle of a chosen row only moves
 * it between the two and Send never sends what was not shown. Its toggle is a tab stop
 * only on the row the keyboard stands on, and so is the row's radio while none is chosen,
 * which the browser would otherwise stop on each time: twelve toggles stood between the
 * group and Send.
 *
 * A text answer is written in the markdown editor, because the answered request draws
 * it as markdown: `preview` shows it as it will read, shared by the question's text
 * answers, and Ctrl+Enter sends the answer (`submit`). It takes no comment, being its
 * author's own words already.
 *
 * Every field with options has one comment, which opens from the end of the line naming it
 * and stands under the options. With nothing chosen its words are the answer, sent as the
 * person's own option; with something chosen they are a note on it (`checkAnswers`). A row of
 * its own for that option and a comment beside it were two places to write one thing in.
 *
 * A refused field says why under itself, with the mark that tells a refusal from the text
 * around it where colour does not show (`FieldError`), and its control carries
 * `aria-invalid` and names that message with `aria-describedby`. The group is a `radiogroup` rather than a
 * `group` because that is a role `aria-invalid` is defined on. It is named by the
 * question it answers, which is what anyone hearing it needs first.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestChosen from '@/features/input-requests/components/RequestChosen.vue'
import RequestNote from '@/features/input-requests/components/RequestNote.vue'
import RequestNoteToggle from '@/features/input-requests/components/RequestNoteToggle.vue'
import RequestOption from '@/features/input-requests/components/RequestOption.vue'
import { useOpenedOptions } from '@/features/input-requests/composables/useOpenedOptions.ts'
import { useRequestNote } from '@/features/input-requests/composables/useRequestNote.ts'
import { fieldOptions } from '@/features/input-requests/utils/answerDisplay.ts'
import { descriptionViews } from '@/features/input-requests/utils/optionDescriptions.ts'
import { moveRadioChoice } from '@/features/input-requests/utils/radioArrows.ts'
import type { FieldEdit } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import FieldError from '@/shared/ui/FieldError.vue'
import LineEnd from '@/shared/ui/LineEnd.vue'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'

type EditorSuggest = InstanceType<typeof MarkdownEditor>['$props']['suggest']

const props = withDefaults(
  defineProps<{
    disabled: boolean
    field: InputRequestField
    /** The field's comment. */
    comment?: string
    /** What else describes the group, by id: the count of a point's steps. */
    describedBy?: string
    /** Why the value was refused; empty while it stands. */
    error?: string
    modelValue?: string | boolean | string[]
    /** The element holding the question this field answers. */
    promptId?: string
    suggest?: EditorSuggest
  }>(),
  {
    comment: '',
    describedBy: undefined,
    error: '',
    modelValue: undefined,
    promptId: undefined,
    suggest: undefined,
  },
)
const emit = defineEmits<{ edit: [edit: FieldEdit]; submit: [] }>()
/** A text answer shows as it will read rather than as it is written. */
const preview = defineModel<boolean>('preview', { default: false })
const { t } = useI18n()
const id = useId()
const legendId = `${id}-legend`
const root = ref<HTMLElement | null>(null)
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const isText = computed(() => props.field.type === 'text')
const isMulti = computed(() => props.field.type === 'multi_choice')
const isYesNo = computed(() => props.field.type === 'boolean')
const label = computed(
  () =>
    `${props.field.label} · ${t(props.field.required ? 'requests.required' : 'requests.optional')}`,
)
const textValue = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))
const options = computed(() => fieldOptions(props.field, t))
const views = computed(() => descriptionViews(options.value))
const errorId = computed(() => (props.error ? `${id}-error` : undefined))
const groupDescription = computed(
  () => [errorId.value, props.describedBy].filter(Boolean).join(' ') || undefined,
)
const invalidMark = computed(() => (props.error ? 'true' : undefined))
/** A single answer is a radiogroup, which is where `aria-invalid` is defined; ticks are a group. */
const groupRole = computed(() => (isMulti.value ? undefined : 'radiogroup'))
const groupInvalid = computed(() => (isMulti.value ? undefined : invalidMark.value))
const groupName = computed(() => [props.promptId, legendId].filter(Boolean).join(' '))
const viewOf = (option: string) => views.value.get(option) ?? 'none'
const opens = (option: string) => ['excerpt', 'folded'].includes(viewOf(option))

function isChosen(option: string) {
  const value = props.modelValue
  if (Array.isArray(value)) return value.includes(option)
  return typeof value === 'boolean' ? String(value) === option : value === option
}
function pick(option: string, event: Event) {
  const { checked } = event.target as HTMLInputElement
  if (isMulti.value) {
    const current = Array.isArray(props.modelValue) ? props.modelValue : []
    emit('edit', {
      value: checked ? [...current, option] : current.filter((entry) => entry !== option),
    })
    return
  }
  emit('edit', { value: isYesNo.value ? option === 'true' : option })
}

const { isOpen, toggle: toggleDescription } = useOpenedOptions()
const detailsId = (option: string) => `${id}-details-${option}`
/** What is chosen and still folded in its row, in the options' order. */
const chosenFolded = computed(() =>
  options.value.flatMap(({ id: option, label: name, description }) =>
    description && opens(option) && isChosen(option) && !isOpen(option)
      ? [{ id: detailsId(option), label: name, description }]
      : [],
  ),
)
const detailsOf = (option: string) =>
  chosenFolded.value.some((entry) => entry.id === detailsId(option)) ? detailsId(option) : undefined
const moveChoice = (event: KeyboardEvent) => moveRadioChoice(event, '.request-option')

/** The row the keyboard stands on, or where it would land. */
const active = ref<string | null>(null)
const chosenOption = computed(() => options.value.find((option) => isChosen(option.id))?.id)
const standing = computed(() => active.value ?? chosenOption.value ?? options.value[0]?.id ?? null)
const toggleStop = (option: string) => (standing.value === option ? 0 : -1)
/** A chosen radio is the group's stop by itself. */
const radioStop = (option: string) =>
  chosenOption.value || standing.value === option ? undefined : -1

/** Moves focus, ringed after a key, to what is to be fixed: the text, or the group. */
function focus() {
  if (editor.value) {
    editor.value.focus()
    return
  }
  const target =
    root.value?.querySelector<HTMLElement>('input:checked') ??
    root.value?.querySelector<HTMLElement>('input')
  moveFocus(target)
}
const noteEditor = ref<InstanceType<typeof RequestNote> | null>(null)
const {
  open: noteOpen,
  press: pressNote,
  written: noteWritten,
} = useRequestNote(
  () => props.comment,
  preview,
  () => noteEditor.value,
)
defineExpose({ focus })
</script>

<template>
  <MarkdownEditor
    v-if="isText"
    ref="editor"
    v-model:preview="preview"
    :label="label"
    :rows="2"
    :maxlength="8000"
    :model-value="textValue"
    :disabled="disabled"
    :error="error"
    :suggest="suggest"
    quiet-error
    @update:model-value="emit('edit', { value: $event })"
    @submit="emit('submit')"
  />
  <div
    v-else
    class="request-field"
  >
    <fieldset
      ref="root"
      class="request-choices"
      :role="groupRole"
      :aria-labelledby="groupName"
      :aria-invalid="groupInvalid"
      :aria-describedby="groupDescription"
      :disabled="disabled"
    >
      <legend class="request-legend">
        <span :id="legendId">{{ label }}</span>
        <LineEnd>
          <RequestNoteToggle
            class="request-legend-note"
            :disabled="disabled"
            :name="t('requests.commentName', { field: field.label })"
            :open="noteOpen"
            :title="t('requests.comment')"
            :written="noteWritten"
            @press="pressNote"
          />
        </LineEnd>
      </legend>
      <RequestOption
        v-for="option in options"
        :key="option.id"
        :chosen="isChosen(option.id)"
        :disabled="disabled"
        :open="isOpen(option.id)"
        :option="option"
        :toggle-stop="toggleStop(option.id)"
        :view="viewOf(option.id)"
        pressable
        @update:open="toggleDescription(option.id)"
      >
        <template #default="row">
          <input
            v-if="isMulti"
            class="request-option-input"
            type="checkbox"
            :value="option.id"
            :checked="isChosen(option.id)"
            :aria-labelledby="row.labelId"
            :aria-describedby="row.describedBy"
            :aria-details="detailsOf(option.id)"
            :aria-invalid="invalidMark"
            @focus="active = option.id"
            @change="pick(option.id, $event)"
          />
          <input
            v-else
            class="request-option-input"
            type="radio"
            :name="id"
            :value="option.id"
            :checked="isChosen(option.id)"
            :tabindex="radioStop(option.id)"
            :aria-labelledby="row.labelId"
            :aria-describedby="row.describedBy"
            :aria-details="detailsOf(option.id)"
            @focus="active = option.id"
            @keydown="moveChoice"
            @change="pick(option.id, $event)"
          />
        </template>
      </RequestOption>
    </fieldset>
    <RequestChosen :entries="chosenFolded" />
    <FieldError
      v-if="error"
      :id="errorId"
      >{{ error }}</FieldError
    >
    <RequestNote
      v-if="noteOpen"
      ref="noteEditor"
      v-model:preview="preview"
      :disabled="disabled"
      :label="t('requests.commentName', { field: field.label })"
      :maxlength="2000"
      :model-value="comment"
      :placeholder="t('requests.commentHint')"
      :rows="2"
      :suggest="suggest"
      @update:model-value="emit('edit', { comment: $event })"
      @submit="emit('submit')"
    />
  </div>
</template>

<style scoped>
.request-field {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.request-choices {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}

/* Read as the label of a text field reads, so the fields of one question do
   not each wear a different caption. The comment's press stands at its other end, on its first
   line however it wraps. */
.request-legend {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
  align-items: first baseline;
  inline-size: 100%;
  padding: 0;
  margin-bottom: var(--space-label-value);
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

/* Its glyph on the axis of the toggles in the rows below, whichever target it has. */
.request-legend-note {
  position: relative;
  inset-inline-end: calc(
    var(--space-half) + (var(--size-control-height-compact) - var(--size-control-inline)) / 2
  );
}
</style>
