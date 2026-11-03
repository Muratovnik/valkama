<script setup lang="ts">
/**
 * One field of an answered question: everything it offered, with what was chosen set apart,
 * so the answer can be read against what it was chosen from. The rows are the form's own
 * (`RequestOption`), folded by the same press, with no control in them.
 *
 * The list is a list and not disabled radios, which a screen reader cannot walk with arrows.
 * Colour is not what says which was chosen: the row says it in a word, which is also what is
 * left of it in a forced palette.
 *
 * Your own option stands as a chosen row with its words under it, and only where it was
 * used: the row was on offer everywhere and says nothing where it was left alone. A comment
 * is a quote under the field. A field with nothing given says so, as an older answer may
 * have left one with a comment standing in for it.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestOption from '@/features/input-requests/components/RequestOption.vue'
import { fieldOptions } from '@/features/input-requests/utils/answerDisplay.ts'
import { descriptionViews } from '@/features/input-requests/utils/optionDescriptions.ts'

import type { InputAnswers, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import RichText from '@/shared/ui/RichText.vue'
import VIcon from '@/shared/ui/VIcon.vue'

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
const opened = ref<ReadonlySet<string>>(new Set())
const isOpen = (option: string) => opened.value.has(option)
function toggle(option: string) {
  const next = new Set(opened.value)
  if (!next.delete(option)) next.add(option)
  opened.value = next
}
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
      <p
        v-else
        class="request-answer-none"
      >
        {{ t('requests.noAnswer') }}
      </p>
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
          >
            <span class="request-answer-mark">
              <VIcon
                v-if="isChosen(option.id)"
                name="check"
                :size="14"
              />
            </span>
          </RequestOption>
        </li>
        <li v-if="own">
          <RequestOption
            view="none"
            :option="ownOption"
            chosen
          >
            <span class="request-answer-mark">
              <VIcon
                name="check"
                :size="14"
              />
            </span>
            <template #below>
              <RichText :source="own" />
            </template>
          </RequestOption>
        </li>
      </ul>
      <p
        v-if="!given"
        class="request-answer-none"
      >
        {{ t('requests.noAnswer') }}
      </p>
    </template>
    <blockquote
      v-if="note"
      class="request-answer-note"
      :aria-label="t('requests.fieldNote')"
    >
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

/* In the room a form's control takes, so the rows read the same with it gone. */
.request-answer-mark {
  display: inline-flex;
  flex: none;
  justify-content: center;
  align-items: center;
  inline-size: var(--font-size-interface);
  block-size: 1lh;
}

.request-answer-none {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* A quote under the field, set in as a reply to a prompt is. */
.request-answer-note {
  min-width: 0;
  padding-inline-start: var(--space-2);
  margin: var(--space-1) 0 0;
  border-inline-start: 1px solid var(--color-rule-strong);
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
