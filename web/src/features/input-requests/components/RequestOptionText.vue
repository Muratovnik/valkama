<script setup lang="ts">
/**
 * What a row of options says: its label, a quiet word on the recommended one, as much of
 * its description as `optionDescriptions` leaves, and in an answered question whether it
 * was the one chosen.
 *
 * In a form this stands inside the option's `<label>`, where nothing may be pressable: a
 * press would select the option as well as open what it landed on, and the words of a
 * button would join the option's name. So a reference here is the text it was, and the
 * same reference opens from the description's own press, outside the label. In an answered
 * question there is no radio to conflict with, and it opens where it stands (`live`).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { DescriptionView } from '@/features/input-requests/utils/optionDescriptions.ts'

import type { InputRequestOption } from '@/shared/api/inputRequestModel.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import { plainText } from '@/shared/lib/richText.ts'
import RichText from '@/shared/ui/RichText.vue'

const props = defineProps<{
  chosen: boolean
  descriptionId: string
  labelId: string
  live: boolean
  noteId: string
  open: boolean
  option: InputRequestOption
  view: DescriptionView
}>()
const { t } = useI18n()
provideReferenceLinks((reference, parent) => (props.live ? parent(reference) : null))
const description = computed(() => props.option.description)
const showsLine = computed(() => props.view === 'line')
const showsExcerpt = computed(() => props.view === 'excerpt' && !props.open)
const chosenMark = computed(() => props.live && props.chosen)
</script>

<template>
  <span
    class="request-option-text"
    :class="{ 'is-passed': live && !chosen }"
  >
    <span class="request-option-head">
      <span
        :id="labelId"
        class="request-option-label"
        >{{ option.label }}</span
      >
      <span
        v-if="option.recommended"
        :id="noteId"
        class="request-option-note"
        >{{ t('requests.recommended') }}</span
      >
      <span
        v-if="chosenMark"
        class="request-option-mark"
        >{{ t('requests.chosen') }}</span
      >
    </span>
    <RichText
      v-if="description && showsLine"
      :id="descriptionId"
      class="request-option-description"
      :source="description"
      inline
    />
    <span
      v-else-if="description && showsExcerpt"
      class="request-option-excerpt"
      >{{ plainText(description) }}</span
    >
  </span>
</template>

<style scoped>
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

/* Answered, what was not chosen steps back from what was. */
.is-passed .request-option-label {
  color: var(--color-text-muted);
}

.request-option-note,
.request-option-description,
.request-option-excerpt {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* The word is what tells a chosen row from the others wherever colour does not. */
.request-option-mark {
  font: var(--font-strong);
}

/* One quiet line of what the press beside it would open. */
.request-option-excerpt {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
