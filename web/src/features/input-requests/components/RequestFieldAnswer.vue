<script setup lang="ts">
/**
 * One field of an answered question: everything it offered, with what was chosen set apart,
 * so the answer can be read against what it was chosen from. The rows are the form's own
 * (`RequestOption`), folded by the same press, with no control in them and no room kept for
 * one: their words start at the row's inset, on what was chosen and on what was passed over.
 *
 * The list is a list and not disabled radios, which a screen reader cannot walk with arrows.
 * Colour is not what says which was chosen: the row says it in a word, which is also what is
 * left of it in a forced palette.
 *
 * Your own option stands as a chosen row with its words under it, and only where it was
 * used: the row was on offer everywhere and says nothing where it was left alone. A comment
 * is a quote under the field, named on screen as the comment on the whole question is. A
 * field with nothing given says so, as an older answer may have left one with a comment
 * standing in for it.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestOption from '@/features/input-requests/components/RequestOption.vue'
import { useFolds } from '@/features/input-requests/composables/useFolds.ts'
import { fieldOptions } from '@/features/input-requests/utils/answerDisplay.ts'
import { descriptionViews } from '@/features/input-requests/utils/optionDescriptions.ts'

import type { InputAnswers, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import RichText from '@/shared/ui/RichText.vue'

const props = defineProps<{
  /** Set off by its words alone, where the question has this one text field to read. */
  bareText: boolean
  field: InputRequestField
  note: string | undefined
  own: string | undefined
  value: InputAnswers[string] | undefined
}>()
const { t } = useI18n()
const labelId = useId()
const isText = computed(() => props.field.type === 'text')
const options = computed(() => fieldOptions(props.field, t))
const views = computed(() => descriptionViews(options.value))
const viewOf = (option: string) => views.value.get(option) ?? 'none'
const ownOption = computed(() => ({ id: '_own', label: t('requests.ownVariant') }))
const given = computed(() => {
  const value = props.value
  if (props.own) return true
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== ''
})
const textValue = computed(() => (typeof props.value === 'string' ? props.value : ''))

function isChosen(option: string) {
  const value = props.value
  if (Array.isArray(value)) return value.includes(option)
  return typeof value === 'boolean' ? String(value) === option : value === option
}
const { isOpen, toggle } = useFolds()
</script>

<template>
  <div
    class="request-answer"
    role="group"
    :aria-labelledby="labelId"
  >
    <p
      :id="labelId"
      class="request-answer-label"
      :class="{ 'visually-hidden': isText && bareText }"
    >
      {{ field.label }}
    </p>
    <template v-if="isText">
      <RichText
        v-if="given"
        class="request-answer-text"
        :source="textValue"
      />
      <DataEmptyState
        v-else
        :title="t('requests.noAnswer')"
        inline
      />
    </template>
    <template v-else>
      <!-- A list drawn with no marks loses its role in some browsers, so the role stays said. -->
      <!-- eslint-disable-next-line vuejs-accessibility/no-redundant-roles -->
      <ul
        class="request-answer-options"
        role="list"
      >
        <li
          v-for="option in options"
          :key="option.id"
        >
          <RequestOption
            :chosen="isChosen(option.id)"
            :open="isOpen(option.id)"
            :option="option"
            :view="viewOf(option.id)"
            @update:open="toggle(option.id)"
          />
        </li>
        <li v-if="own">
          <RequestOption
            view="none"
            :option="ownOption"
            chosen
          >
            <template #below>
              <RichText :source="own" />
            </template>
          </RequestOption>
        </li>
      </ul>
      <DataEmptyState
        v-if="!given"
        :title="t('requests.noAnswer')"
        inline
      />
    </template>
    <blockquote
      v-if="note"
      class="request-answer-note"
      :aria-label="t('requests.fieldNote')"
    >
      <span class="request-answer-note-label">{{ t('requests.fieldNote') }}</span>
      <RichText :source="note" />
    </blockquote>
  </div>
</template>

<style scoped>
.request-answer {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.request-answer-label {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-field-label);
  overflow-wrap: anywhere;
}

.request-answer-text {
  font: var(--font-editor);
}

.request-answer-options {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* A quote under the field, set in as a reply to a prompt is, and signed as the comment on
   the whole question is: its words on screen, over the text. */
.request-answer-note {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
  padding-inline-start: var(--space-2);
  margin: var(--space-1) 0 0;
  border-inline-start: 1px solid var(--color-rule-strong);
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.request-answer-note-label {
  font: var(--font-field-label);
}
</style>
