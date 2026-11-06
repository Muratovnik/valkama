<script setup lang="ts">
/**
 * A list an agent put under its comment: what it offers, ticked here and sent at one press. It
 * is a question with one field of ticks, written by the same writes, and it stands in the
 * comment's sheet under the comment's words, whose head already names who wrote it and when.
 *
 * Nobody waits on it, so nothing declines it and nothing counts it as waiting. Ticking only
 * ticks, as choosing does in a question: five ticks sent one by one would wake the agent five
 * times. A send with nothing ticked goes too, and tells the agent the list is not decided
 * (`checkAnswers`). The rows are a question's (`RequestOption`), denser and with no ground, their boxes on
 * the edge of the comment's words, and the comment on the ticks opens from the left end of the
 * buttons' row as a question's does.
 *
 * Sent, it reads as a record (`CommentListRecord`), with the way to change it. The change is a
 * question's: the form opens on what was sent, is saved against the revision it opened on, and
 * asks before throwing anything away.
 *
 * A closed task freezes it: a tick would reach no one, so there is nothing to press. What was
 * ticked and not sent stays in sight, and stands ticked again once the task reopens.
 */
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener } from '@vueuse/core'

import CommentListRecord from '@/features/input-requests/components/CommentListRecord.vue'
import RequestChosen from '@/features/input-requests/components/RequestChosen.vue'
import RequestFoot from '@/features/input-requests/components/RequestFoot.vue'
import RequestNote from '@/features/input-requests/components/RequestNote.vue'
import RequestOption from '@/features/input-requests/components/RequestOption.vue'
import { useAnswerChange } from '@/features/input-requests/composables/useAnswerChange.ts'
import { useOpenedOptions } from '@/features/input-requests/composables/useOpenedOptions.ts'
import { useRequestFocus } from '@/features/input-requests/composables/useRequestFocus.ts'
import { useRequestNote } from '@/features/input-requests/composables/useRequestNote.ts'
import { useRequestWrites } from '@/features/input-requests/composables/useRequestWrites.ts'
import { differsFromAnswer, unsentWords } from '@/features/input-requests/utils/answerChange.ts'
import { unsentChoices } from '@/features/input-requests/utils/answerDisplay.ts'
import { descriptionViews } from '@/features/input-requests/utils/optionDescriptions.ts'
import {
  editField,
  hasDraft,
  stillRefused,
} from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import FieldError from '@/shared/ui/FieldError.vue'
import type MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'

const props = withDefaults(
  defineProps<{
    draft: RequestDraft
    entry: InputRequestEntry
    /** The list's task is closed, so nothing ticked here would reach anyone. */
    itemClosed?: boolean
    suggest?: InstanceType<typeof MarkdownEditor>['$props']['suggest']
  }>(),
  { itemClosed: false, suggest: undefined },
)
const emit = defineEmits<{
  'update:draft': [draft: RequestDraft]
  'updated': [entry: InputRequestEntry]
}>()
const { t } = useI18n()
const id = useId()
const [labelId, outcomeId, errorId] = [`${id}-label`, `${id}-outcome`, `${id}-error`]
const root = ref<HTMLElement | null>(null)
const foot = ref<InstanceType<typeof RequestFoot> | null>(null)
const noteEditor = ref<InstanceType<typeof RequestNote> | null>(null)
const { focusOutcome, reveal } = useRequestFocus(root)

const {
  busy,
  canRefresh,
  changeable,
  changing,
  error,
  fieldsDisabled,
  forget,
  refresh,
  refused,
  request,
  resolve,
  sendDisabled,
  unchanged,
} = useRequestWrites({
  draft: () => props.draft,
  entry: () => props.entry,
  itemClosed: () => props.itemClosed,
  write: (draft) => emit('update:draft', draft),
  failed: async () => {
    await nextTick()
    foot.value?.focusError()
  },
  refuse: async () => {
    await nextTick()
    moveFocus(root.value?.querySelector<HTMLElement>('input'))
  },
  settled: async (result, reread) => {
    await nextTick()
    if (reread) reveal()
    else focusOutcome()
    emit('updated', result)
  },
})

/** The one field of ticks a list is, and what it offers. */
const field = computed(() => request.value.fields[0])
const options = computed(() => field.value?.options ?? [])
const views = computed(() => descriptionViews(options.value))
const viewOf = (option: string) => views.value.get(option) ?? 'none'
const fieldId = computed(() => field.value?.id ?? '')
const ticked = computed(() => {
  const value = props.draft.answers[fieldId.value]
  return Array.isArray(value) ? value : []
})
const isTicked = (option: string) => ticked.value.includes(option)

/** Closed under it: by the card's own read, or by the list's, whichever came first. */
const frozen = computed(() => props.itemClosed || request.value.expired_reason === 'task_closed')
const waiting = computed(() => request.value.status === 'pending' && !frozen.value)
const inForm = computed(() => waiting.value || (changing.value && !frozen.value))
const busyMark = computed(() => busy.value || undefined)
/** A form says what it is busy with; a record is described by how it stands. */
const describedBy = computed(() => (inForm.value ? undefined : outcomeId))
const offered = computed(() => changeable.value && !frozen.value)
const refusal = computed(() => (refused.value.length ? t('requests.missing.multi_choice') : ''))
const refusalId = computed(() => (refusal.value ? errorId : undefined))
const invalidMark = computed(() => (refusal.value ? 'true' : undefined))
/** Under the rows: that a change is open, or that nothing can be sent from this source. */
const fact = computed(() => {
  if (changing.value) return t('requests.list.changing')
  return props.entry.target.writable ? '' : t('requests.readonly')
})

/** The ticks and the words a closing left in the form, which were never sent. */
const leftOver = computed(() => {
  if (inForm.value) return false
  const { draft } = props
  return draft.changing === null ? hasDraft(draft) : differsFromAnswer(request.value, draft)
})
const unsent = computed(() => (leftOver.value ? unsentWords(request.value, props.draft) : ''))
const unsentChosen = computed(() =>
  leftOver.value ? unsentChoices(request.value.fields, props.draft, t) : [],
)

const previewing = ref(false)
const {
  open: noteOpen,
  press: pressNote,
  written: noteWritten,
} = useRequestNote(
  () => props.draft.note,
  previewing,
  () => noteEditor.value,
)
const noteToggle = computed(() => ({
  disabled: fieldsDisabled.value,
  open: noteOpen.value,
  title: t('requests.list.note'),
  written: noteWritten.value,
}))
const errorText = computed(() => {
  const kept = hasDraft(props.draft) ? '' : 'Bare'
  return error.value ? t(`requests.${error.value}${kept}`) : ''
})

const change = useAnswerChange({
  busy,
  focusCancel: () => foot.value?.focusWayOut(),
  focusChange: () =>
    root.value?.querySelector<HTMLElement>('.comment-list-change')?.focus({ preventScroll: true }),
  forget,
  request,
  reveal,
  unchanged,
  unsent,
  write: (draft) => emit('update:draft', draft),
})
/** Escape inside a change is its Cancel, as in a question. */
useEventListener(root, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.isComposing || !changing.value) return
  event.preventDefault()
  event.stopPropagation()
  if (change.asking.value) void change.keep()
  else change.cancel()
})

function pick(option: string, event: Event) {
  const { checked } = event.target as HTMLInputElement
  const value = checked ? [...ticked.value, option] : ticked.value.filter((one) => one !== option)
  const next = editField(props.draft, fieldId.value, { value })
  refused.value = stillRefused(refused.value, props.draft, next)
  emit('update:draft', next)
}
const onward = () => void resolve(changing.value ? 'change' : 'answer')
const writeNote = (note: string) => emit('update:draft', { ...props.draft, note })

const { isOpen, toggle: toggleDescription } = useOpenedOptions()
/** What is ticked and still folded stands whole under the rows, as a question's choice does. */
const chosenFolded = computed(() =>
  options.value.flatMap(({ id: option, label, description }) =>
    description &&
    ['excerpt', 'folded'].includes(viewOf(option)) &&
    isTicked(option) &&
    !isOpen(option)
      ? [{ id: `${id}-details-${option}`, label, description }]
      : [],
  ),
)
const detailsOf = (option: string) =>
  chosenFolded.value.find((entry) => entry.id === `${id}-details-${option}`)?.id
</script>

<template>
  <div
    ref="root"
    class="comment-list focus-landing"
    tabindex="-1"
    :aria-busy="busyMark"
    :aria-labelledby="labelId"
    :aria-describedby="describedBy"
  >
    <template v-if="inForm">
      <fieldset
        class="comment-list-rows"
        :aria-labelledby="labelId"
        :aria-describedby="refusalId"
        :disabled="fieldsDisabled"
      >
        <legend
          :id="labelId"
          class="comment-list-label"
        >
          {{ field?.label }}
        </legend>
        <RequestOption
          v-for="option in options"
          :key="option.id"
          :chosen="isTicked(option.id)"
          :disabled="fieldsDisabled"
          :open="isOpen(option.id)"
          :option="option"
          :view="viewOf(option.id)"
          dense
          pressable
          @update:open="toggleDescription(option.id)"
        >
          <template #default="row">
            <input
              class="request-option-input"
              type="checkbox"
              :value="option.id"
              :checked="isTicked(option.id)"
              :aria-labelledby="row.labelId"
              :aria-describedby="row.describedBy"
              :aria-details="detailsOf(option.id)"
              :aria-invalid="invalidMark"
              @change="pick(option.id, $event)"
            />
          </template>
        </RequestOption>
      </fieldset>
      <RequestChosen
        :entries="chosenFolded"
        dense
      />
      <FieldError
        v-if="refusal"
        :id="errorId"
        >{{ refusal }}</FieldError
      >
      <p
        v-if="fact"
        class="comment-list-fact"
      >
        {{ fact }}
      </p>
      <RequestNote
        v-if="noteOpen"
        ref="noteEditor"
        v-model:preview="previewing"
        :disabled="fieldsDisabled"
        :label="t('requests.list.note')"
        :maxlength="8000"
        :model-value="draft.note"
        :rows="3"
        :suggest="suggest"
        @update:model-value="writeNote"
        @submit="onward"
      />
      <RequestFoot
        ref="foot"
        :asking-cancel="change.asking.value"
        :busy="busy"
        :cancel-message="t('requests.list.cancelAsked')"
        :changing="changing"
        :declinable="false"
        :declining="false"
        :disabled="sendDisabled"
        :discard-word="t('requests.list.discardChange')"
        :dismissable="false"
        :error="errorText"
        :note="noteToggle"
        :refreshable="canRefresh"
        :send-word="t('requests.list.send')"
        :standalone="false"
        :stuck="false"
        :undecided="0"
        :waiting="waiting"
        @discard="change.end"
        @keep="change.keep"
        @note="pressNote"
        @onward="onward"
        @refresh="refresh"
        @way-out="change.cancel"
      />
    </template>
    <CommentListRecord
      v-else
      :busy="busy"
      :frozen="frozen"
      :label-id="labelId"
      :offered="offered"
      :outcome-id="outcomeId"
      :request="request"
      :unsent="unsent"
      :unsent-chosen="unsentChosen"
      @amend="change.start"
    />
  </div>
</template>

<style scoped>
/* On the comment's words' edge, its rows' boxes and the comment glyph below them included. Its
   words run to that edge, so its ring stands clear of them by the shared `focus-landing` rule. */
.comment-list {
  --request-row-inset: 0px;

  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
  min-width: 0;
}

.comment-list-rows {
  display: grid;
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}

/* A field's caption, as a question's field has one. */
.comment-list-label {
  padding: 0;
  margin-bottom: var(--space-label-value);
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

.comment-list-fact {
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}
</style>
