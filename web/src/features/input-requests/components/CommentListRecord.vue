<script setup lang="ts">
/**
 * A list under a comment once it is not a form: sent, or frozen by its closed task.
 *
 * Every row stays, with a mark where its box stood, so the words stand where they stood while
 * it was a form; the word on a ticked row is left to a reader, and the mark is what a forced
 * palette keeps. One line says how many were ticked and when, with the way to change them at
 * the end of that line. Frozen, the line says how to tick again instead, and what was ticked
 * and not sent stays in sight under it (`RequestUnsent`).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestOption from '@/features/input-requests/components/RequestOption.vue'
import RequestUnsent from '@/features/input-requests/components/RequestUnsent.vue'
import { useFolds } from '@/features/input-requests/composables/useFolds.ts'
import { descriptionViews } from '@/features/input-requests/utils/optionDescriptions.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import { unbroken } from '@/shared/lib/unbroken.ts'
import RichText from '@/shared/ui/RichText.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  busy: boolean
  /** Its task is closed, so nothing ticked would reach anyone. */
  frozen: boolean
  labelId: string
  /** Its answer can be changed from here. */
  offered: boolean
  /** The id of the line that says how it stands, which describes the list. */
  outcomeId: string
  request: InputRequestEntry['request']
  /** What was still being written when its task closed. */
  unsent: string
  /** What was ticked and not sent when its task closed, a line per field. */
  unsentChosen: readonly string[]
}>()
const emit = defineEmits<{ amend: [] }>()
const { t, d } = useI18n()

const field = computed(() => props.request.fields[0])
const options = computed(() => field.value?.options ?? [])
const views = computed(() => descriptionViews(options.value))
const viewOf = (option: string) => views.value.get(option) ?? 'none'
const sent = computed(() => {
  const value = field.value ? props.request.answers?.[field.value.id] : undefined
  return Array.isArray(value) ? value : []
})
const isSent = (option: string) => sent.value.includes(option)
const answered = computed(() => props.request.status === 'answered')
const note = computed(() => props.request.note ?? '')
/** The frozen words stand on a line of their own under what was ticked. */
const frozenBelow = computed(() => props.frozen && answered.value)

/** How many were ticked and when, or how the list ended where it was not answered. */
const outcome = computed(() => {
  const { answered_by: by, by_person: person, resolved_at: at, status } = props.request
  if (!answered.value) return props.frozen ? t('requests.list.frozen') : t(`requests.${status}`)
  const counted = { n: sent.value.length, total: options.value.length }
  const said = person
    ? t('requests.list.youTicked', counted)
    : [t('requests.list.ticked', counted), by ? actorName(by) : ''].filter(Boolean).join(' · ')
  return [said, at ? unbroken(d(new Date(at), 'activity')) : ''].filter(Boolean).join(' · ')
})

const { isOpen, toggle } = useFolds()
</script>

<template>
  <p
    :id="labelId"
    class="comment-list-label"
  >
    {{ field?.label }}
  </p>
  <!-- A list drawn with no marks loses its role in some browsers, so the role stays said. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-redundant-roles -->
  <ul
    class="comment-list-record"
    role="list"
    :aria-labelledby="labelId"
  >
    <li
      v-for="option in options"
      :key="option.id"
    >
      <RequestOption
        :chosen="isSent(option.id)"
        :open="isOpen(option.id)"
        :option="option"
        :view="viewOf(option.id)"
        dense
        @update:open="toggle(option.id)"
      >
        <span class="comment-list-mark">
          <VIcon
            v-if="isSent(option.id)"
            class="comment-list-check"
            name="check"
            :size="21"
          />
        </span>
      </RequestOption>
    </li>
  </ul>
  <blockquote
    v-if="note"
    class="comment-list-note"
    :aria-label="t('requests.list.note')"
  >
    <span class="comment-list-note-label">{{ t('requests.list.note') }}</span>
    <RichText :source="note" />
  </blockquote>
  <div class="comment-list-outcome">
    <p
      :id="outcomeId"
      class="comment-list-state request-state"
      role="status"
    >
      {{ outcome }}
    </p>
    <VButton
      v-if="offered"
      class="comment-list-change"
      variant="ghost"
      :disabled="busy"
      @click="emit('amend')"
      >{{ t('requests.list.change') }}</VButton
    >
  </div>
  <p
    v-if="frozenBelow"
    class="comment-list-state"
  >
    {{ t('requests.list.frozen') }}
  </p>
  <RequestUnsent
    :unsent="unsent"
    :unsent-chosen="unsentChosen"
  />
</template>

<style scoped>
/* A field's caption, as a question's field has one. */
.comment-list-label {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

.comment-list-record {
  display: grid;
  min-width: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* In the box's place and of its size, so the words stand where they stood while it was a form.
   The check is drawn across the box's width, its strokes from one edge of it to the other. */
.comment-list-mark {
  position: relative;
  display: inline-block;
  inline-size: var(--font-size-interface);
  block-size: var(--font-size-interface);
  margin-inline-end: var(--space-2);
  translate: 0 calc((1lh - var(--font-size-interface)) / 2);
}

.comment-list-check {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  translate: -50% -50%;
}

.comment-list-note {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
  margin: 0;
  font: var(--font-editor);
}

.comment-list-note-label {
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

/* The line and the way to change it at the row's end, under it where the row has no room. */
.comment-list-outcome {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: space-between;
  align-items: center;
  min-width: 0;
}

.comment-list-state {
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.comment-list-change {
  margin-inline-start: auto;
}
</style>
