<script setup lang="ts">
/**
 * One field of a question, drawn as the control its answer needs. Selecting only
 * selects: the card's Send is what sends.
 *
 * Every choice is a full-width row, whether it is one of two or of twenty and whether
 * one answer is taken or several, so there is one thing to learn and every option
 * stays in sight. A row says its label, a quiet word on the one recommended and, by
 * `optionDescriptions`, as much of its description as leaves the labels scannable. The
 * radio is named by its label alone, or a screen reader would read the paragraphs under
 * it on every arrow press; a line of description is its description, a text is not.
 *
 * What is folded opens on its own press, stays open beside another, and neither opens
 * by selecting nor selects by opening. Its toggle is a tab stop only on the row the
 * keyboard stands on, and so is the row's radio while none is chosen, which the browser
 * would otherwise stop on each time: twelve toggles stood between the group and Send.
 *
 * A text answer is written in the markdown editor, because the answered request draws
 * it as markdown: `preview` shows it as it will read, shared by the question's text
 * answers, and Ctrl+Enter sends the answer (`submit`).
 *
 * A refused field says why under itself, and its control carries `aria-invalid` and
 * names that message with `aria-describedby`. The group is a `radiogroup` rather than a
 * `group` because that is a role `aria-invalid` is defined on. It is named by the
 * question it answers, which is what anyone hearing it needs first.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { descriptionViews } from '@/features/input-requests/utils/optionDescriptions.ts'

import type { InputRequestField, InputRequestOption } from '@/shared/api/inputRequestModel.ts'
import { plainText } from '@/shared/lib/richText.ts'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import RichText from '@/shared/ui/RichText.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

type EditorSuggest = InstanceType<typeof MarkdownEditor>['$props']['suggest']

const props = withDefaults(
  defineProps<{
    disabled: boolean
    field: InputRequestField
    /** Why the value was refused; empty while it stands. */
    error?: string
    modelValue?: string | boolean | string[]
    /** The element holding the question this field answers. */
    promptId?: string
    /** Whether it must be answered right now: words of one's own may stand in for it. */
    required?: boolean
    suggest?: EditorSuggest
  }>(),
  { modelValue: undefined, error: '', promptId: undefined, required: true, suggest: undefined },
)
const emit = defineEmits<{
  'submit': []
  'update:modelValue': [value: string | boolean | string[]]
}>()
/** A text answer shows as it will read rather than as it is written. */
const preview = defineModel<boolean>('preview', { default: false })
const { t } = useI18n()
const id = useId()
const legendId = `${id}-legend`
const root = ref<HTMLElement | null>(null)
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const isText = computed(() => props.field.type === 'text')
const isMulti = computed(() => props.field.type === 'multi_choice')
/** Yes and No are two words, so they share one row. */
const isYesNo = computed(() => props.field.type === 'boolean')
const label = computed(
  () => `${props.field.label} · ${t(props.required ? 'requests.required' : 'requests.optional')}`,
)
const textValue = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))
const options = computed<readonly InputRequestOption[]>(() =>
  isYesNo.value
    ? [
        { id: 'true', label: t('requests.yes') },
        { id: 'false', label: t('requests.no') },
      ]
    : props.field.options,
)
const views = computed(() => descriptionViews(options.value))
const errorId = computed(() => (props.error ? `${id}-error` : undefined))
const invalidMark = computed(() => (props.error ? 'true' : undefined))
/** A single answer is a radiogroup, which is where `aria-invalid` is defined; ticks are a group. */
const groupRole = computed(() => (isMulti.value ? undefined : 'radiogroup'))
const groupInvalid = computed(() => (isMulti.value ? undefined : invalidMark.value))
const groupName = computed(() => [props.promptId, legendId].filter(Boolean).join(' '))

function isChosen(option: string) {
  const value = props.modelValue
  if (Array.isArray(value)) return value.includes(option)
  return typeof value === 'boolean' ? String(value) === option : value === option
}
function pick(option: string, event: Event) {
  if (!isMulti.value) {
    emit('update:modelValue', isYesNo.value ? option === 'true' : option)
    return
  }
  const current = Array.isArray(props.modelValue) ? props.modelValue : []
  emit(
    'update:modelValue',
    (event.target as HTMLInputElement).checked
      ? [...current, option]
      : current.filter((entry) => entry !== option),
  )
}

const labelId = (option: string) => `${id}-label-${option}`
const noteId = (option: string) => `${id}-note-${option}`
const descriptionId = (option: string) => `${id}-description-${option}`
const viewOf = (option: string) => views.value.get(option) ?? 'none'
const opens = (option: string) => ['excerpt', 'folded'].includes(viewOf(option))
/** What a screen reader hears after the label: the word on it, and a description of one line. */
function describedBy({ id: option, recommended }: InputRequestOption) {
  const parts = [
    ...(recommended ? [noteId(option)] : []),
    ...(viewOf(option) === 'line' ? [descriptionId(option)] : []),
  ]
  return parts.length ? parts.join(' ') : undefined
}

const opened = ref<ReadonlySet<string>>(new Set())
const isOpen = (option: string) => opened.value.has(option)
function toggleDescription(option: string) {
  const next = new Set(opened.value)
  if (!next.delete(option)) next.add(option)
  opened.value = next
}
const toggleLabel = (option: string) =>
  t(isOpen(option) ? 'platform.actions.collapse' : 'platform.actions.expand')
const toggleName = (option: InputRequestOption) => `${toggleLabel(option.id)}: ${option.label}`
const showsExcerpt = (option: string) => viewOf(option) === 'excerpt' && !isOpen(option)

/** The row the keyboard stands on, or where it would land. */
const active = ref<string | null>(null)
const chosenOption = computed(() => options.value.find((option) => isChosen(option.id))?.id)
const standing = computed(() => active.value ?? chosenOption.value ?? options.value[0]?.id ?? null)
const toggleStop = (option: string) => (standing.value === option ? 0 : -1)
/** A chosen radio is the group's stop by itself. */
const radioStop = (option: string) =>
  chosenOption.value || standing.value === option ? undefined : -1

/** Moves focus to the field's control: the chosen radio, or the first one. */
function focus() {
  if (editor.value) {
    editor.value.focus()
    return
  }
  const target =
    root.value?.querySelector<HTMLElement>('input:checked') ??
    root.value?.querySelector<HTMLElement>('input')
  target?.focus()
}
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
    @update:model-value="emit('update:modelValue', $event)"
    @submit="emit('submit')"
  />
  <fieldset
    v-else
    ref="root"
    class="request-choices"
    :class="{ 'is-row': isYesNo }"
    :role="groupRole"
    :aria-labelledby="groupName"
    :aria-invalid="groupInvalid"
    :aria-describedby="errorId"
    :disabled="disabled"
  >
    <legend
      :id="legendId"
      class="request-legend"
    >
      {{ label }}
    </legend>
    <div
      v-for="option in options"
      :key="option.id"
      class="request-option"
      :class="{ 'is-chosen': isChosen(option.id) }"
    >
      <label class="request-option-line">
        <input
          v-if="isMulti"
          class="request-option-input"
          type="checkbox"
          :value="option.id"
          :checked="isChosen(option.id)"
          :aria-labelledby="labelId(option.id)"
          :aria-describedby="describedBy(option)"
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
          :aria-labelledby="labelId(option.id)"
          :aria-describedby="describedBy(option)"
          @focus="active = option.id"
          @change="pick(option.id, $event)"
        />
        <span class="request-option-text">
          <span class="request-option-head">
            <span
              :id="labelId(option.id)"
              class="request-option-label"
              >{{ option.label }}</span
            >
            <span
              v-if="option.recommended"
              :id="noteId(option.id)"
              class="request-option-note"
              >{{ t('requests.recommended') }}</span
            >
          </span>
          <RichText
            v-if="option.description && viewOf(option.id) === 'line'"
            :id="descriptionId(option.id)"
            class="request-option-description"
            :source="option.description"
            inline
          />
          <span
            v-else-if="option.description && showsExcerpt(option.id)"
            class="request-option-excerpt"
            >{{ plainText(option.description) }}</span
          >
        </span>
      </label>
      <VButton
        v-if="opens(option.id)"
        class="request-option-toggle"
        variant="ghost"
        size="compact"
        :tabindex="toggleStop(option.id)"
        :title="toggleLabel(option.id)"
        :aria-expanded="isOpen(option.id)"
        :aria-label="toggleName(option)"
        icon
        @click="toggleDescription(option.id)"
      >
        <VIcon
          class="request-option-glyph"
          name="chevron-down"
          :size="16"
        />
      </VButton>
      <RichText
        v-if="option.description && isOpen(option.id)"
        class="request-option-detail"
        :source="option.description"
      />
    </div>
    <small
      v-if="error"
      :id="errorId"
      class="request-field-error"
      >{{ error }}</small
    >
  </fieldset>
</template>

<style scoped>
.request-choices {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}

/* Yes and No are two words: they sit side by side, so the answer is one row. */
.request-choices.is-row {
  display: flex;
  flex-wrap: wrap;

  .request-legend,
  .request-field-error {
    flex: 1 0 100%;
  }

  .request-option {
    flex: 1 1 0;
    min-width: 8rem;
  }
}

/* Read as the label of a text field reads, so the fields of one question do
   not each wear a different caption. */
.request-legend {
  padding: 0;
  margin-bottom: var(--space-label-value);
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

/* A row is all one press, up to its toggle and to what the toggle opened. */
.request-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: var(--space-2);
  align-items: start;
  min-width: 0;
  background: var(--color-control-surface);
  border-radius: var(--radius-control);

  &:hover,
  &.is-chosen {
    background: var(--color-surface-active);
  }
}

.request-option-line {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  font: var(--font-editor);
  cursor: pointer;

  .request-choices:disabled & {
    cursor: default;
  }
}

/* Sized by the type and centred on the first line by its height, however the label wraps. */
.request-option-input {
  flex: none;
  inline-size: var(--font-size-interface);
  block-size: var(--font-size-interface);
  margin: 0;
  font: inherit;
  translate: 0 calc((1lh - var(--font-size-interface)) / 2);
}

.request-option-text {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
}

.request-option-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
  align-items: baseline;
  min-width: 0;
}

.request-option-label {
  min-width: 0;
  font: var(--font-editor);
  overflow-wrap: anywhere;
}

.request-option-note,
.request-option-description,
.request-option-excerpt,
.request-option-detail {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* One quiet line of what the press beside it would open. */
.request-option-excerpt {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.request-option-toggle {
  margin-block-start: var(--space-half);
  margin-inline-end: var(--space-half);

  &[aria-expanded='true'] .request-option-glyph {
    rotate: 180deg;
  }
}

/* Under the row's text, at the same inset, across the room the toggle stood in. */
.request-option-detail {
  grid-column: 1 / -1;
  padding: 0 var(--space-3) var(--space-3)
    calc(var(--space-3) + var(--space-2) + var(--font-size-interface));
}

.request-field-error {
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
