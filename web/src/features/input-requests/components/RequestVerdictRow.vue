<script setup lang="ts">
/**
 * One point of a review: its label and the start of its description, and the three words it
 * is answered with, Accept | Later | Reject, which none is until the person picks one. Choosing
 * only selects: Send is what sends.
 *
 * What the agent recommends is said in words while the row is undecided or decided otherwise;
 * eighteen identical words on rows that agree said nothing. The segment itself never shows it,
 * by colour or by mark, so a recommendation is not mistaken for a choice.
 *
 * An own variant is an icon beside the comment's, not a fourth segment, which a phone's width
 * has no room for: it opens a field in place of the verdict and takes the verdict away, as your
 * own option takes a radio's. Taking it back hides the field and keeps the words, unsent.
 *
 * Where choosing Accept opens a field below (the steps of the point, or its way), the segment
 * says so to a reader before it is pressed, and focus stays in the segments when it opens
 * (WCAG 3.2.2). How many of the steps are ticked stands under the label.
 *
 * Its description folds as an option's does (`optionDescriptions`), and its toggle is a tab
 * stop only while focus is in the row: twenty-five toggles stood between the segments and Send.
 *
 * Side by side where the row is wide, the segments go under the label on a row of their own,
 * across its whole width, where it is not; a phone gets the target a finger needs.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestNote from '@/features/input-requests/components/RequestNote.vue'
import RequestNoteToggle from '@/features/input-requests/components/RequestNoteToggle.vue'
import { useRequestNote } from '@/features/input-requests/composables/useRequestNote.ts'
import { descriptionViews } from '@/features/input-requests/utils/optionDescriptions.ts'
import type { Verdict } from '@/features/input-requests/utils/reviewForm.ts'
import type { FieldEdit } from '@/features/input-requests/utils/validateAnswers.ts'

import { VERDICTS } from '@/shared/api/inputRequestModel.ts'
import type { InputAnswers, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { plainText } from '@/shared/lib/richText.ts'
import FieldError from '@/shared/ui/FieldError.vue'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import RichText from '@/shared/ui/RichText.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

type EditorSuggest = InstanceType<typeof MarkdownEditor>['$props']['suggest']

const props = withDefaults(
  defineProps<{
    disabled: boolean
    field: InputRequestField
    /** How many of the steps under it are ticked, of how many. */
    count?: { chosen: number; total: number } | null
    /** The id that count stands under, which the steps name as what describes them. */
    countId?: string
    /** Why the row was refused; empty while it stands. */
    error?: string
    note?: string
    /** What choosing Accept opens below, by its label; empty where it opens nothing. */
    opens?: string
    own?: string
    ownChosen?: boolean
    ownError?: string
    suggest?: EditorSuggest
    value?: InputAnswers[string]
  }>(),
  {
    count: null,
    countId: undefined,
    error: '',
    note: '',
    opens: '',
    own: '',
    ownChosen: false,
    ownError: '',
    suggest: undefined,
    value: undefined,
  },
)
const emit = defineEmits<{ edit: [edit: FieldEdit]; submit: []; verdict: [verdict: Verdict] }>()
const preview = defineModel<boolean>('preview', { default: false })
const { t } = useI18n()
const id = useId()
const labelId = `${id}-label`
const opensId = `${id}-opens`
const errorId = `${id}-error`
const detailId = `${id}-detail`

const verdict = computed(() =>
  (VERDICTS as readonly unknown[]).includes(props.value) ? (props.value as Verdict) : null,
)
const segments = computed(() =>
  VERDICTS.map((word) => ({
    value: word,
    label: t(`requests.review.verdict.${word}`),
    disabled: props.disabled,
    describedBy: word === 'accept' && props.opens ? opensId : undefined,
  })),
)
const name = computed(() => plainText(props.field.label))
const advice = computed(() => {
  const { recommended } = props.field
  return recommended && verdict.value !== recommended
    ? t('requests.review.recommends', { verdict: t(`requests.review.advice.${recommended}`) })
    : ''
})

/** The point's description folds by the rule an option's does. */
const view = computed(() => {
  const { description, label } = props.field
  const point = { id: 'point', label, ...(description ? { description } : {}) }
  return descriptionViews([point]).get('point') ?? 'none'
})
const folds = computed(() => view.value === 'excerpt' || view.value === 'folded')
const open = ref(false)
const toggleLabel = computed(() =>
  t(open.value ? 'platform.actions.collapse' : 'platform.actions.expand'),
)
/** Focus is somewhere in the row, which is what makes its toggle a tab stop. */
const standing = ref(false)
const toggleStop = computed(() => (standing.value ? 0 : -1))
const detailShown = computed(() => (open.value ? detailId : undefined))
const errorShown = computed(() => (props.error ? errorId : undefined))
/** Absent rather than false, because `aria-invalid="false"` is a claim and not a default. */
const invalidMark = computed(() => (props.error ? 'true' : undefined))
function leave(event: FocusEvent) {
  const next = event.relatedTarget
  if (!(next instanceof Node) || !(event.currentTarget as Node).contains(next))
    standing.value = false
}

const ownEditor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const root = ref<HTMLElement | null>(null)
const noteEditor = ref<InstanceType<typeof RequestNote> | null>(null)
const {
  open: noteOpen,
  press: pressNote,
  written: noteWritten,
} = useRequestNote(
  () => props.note,
  preview,
  () => noteEditor.value,
)
/** In place of the verdict, or back out of it with the words kept. */
function pressOwn() {
  emit('edit', props.ownChosen ? { ownChosen: false } : { ownChosen: true, value: null })
}
/** Moves focus to what is to be fixed: the own variant's text, or the segments. */
function focus() {
  if (props.ownError && ownEditor.value) {
    ownEditor.value.focus()
    return
  }
  moveFocus(root.value?.querySelector<HTMLElement>('[role="radiogroup"] [tabindex="0"]'))
}
defineExpose({ focus })
</script>

<template>
  <div
    ref="root"
    class="request-point"
    role="group"
    :aria-labelledby="labelId"
    @focusin="standing = true"
    @focusout="leave"
  >
    <div class="request-point-line">
      <div class="request-point-words">
        <RichText
          :id="labelId"
          class="request-point-label"
          :source="field.label"
          inline
        />
        <RichText
          v-if="field.description && view === 'line'"
          class="request-point-description"
          :source="field.description"
          inline
        />
        <span
          v-else-if="field.description && view === 'excerpt' && !open"
          class="request-point-excerpt"
          >{{ plainText(field.description) }}</span
        >
        <span
          v-if="advice || count"
          class="request-point-facts"
        >
          <span
            v-if="count"
            :id="countId"
            >{{ t('requests.review.of', count) }}</span
          >
          <span v-if="advice">{{ advice }}</span>
        </span>
      </div>
      <VButton
        v-if="folds"
        class="request-point-toggle"
        variant="text"
        size="compact"
        :tabindex="toggleStop"
        :title="toggleLabel"
        :aria-controls="detailShown"
        :aria-expanded="open"
        :aria-label="`${toggleLabel}: ${name}`"
        icon
        @click="open = !open"
      >
        <VIcon
          class="request-point-glyph"
          name="chevron-down"
          :size="16"
        />
      </VButton>
      <SegmentedControl
        class="request-point-segments"
        size="compact"
        :label="name"
        :model-value="verdict"
        :options="segments"
        :aria-describedby="errorShown"
        :aria-invalid="invalidMark"
        @update:model-value="emit('verdict', $event)"
      />
      <div class="request-point-tools">
        <VButton
          class="request-point-own"
          variant="text"
          size="inline"
          :class="{ 'is-chosen': ownChosen }"
          :disabled="disabled"
          :title="t('requests.ownVariant')"
          :aria-expanded="ownChosen"
          :aria-label="t('requests.review.ownOption', { field: name })"
          icon
          @click="pressOwn"
        >
          <VIcon
            name="edit"
            :size="16"
          />
        </VButton>
        <RequestNoteToggle
          :disabled="disabled"
          :name="t('requests.fieldNoteName', { field: name })"
          :open="noteOpen"
          :title="t('requests.fieldNote')"
          :written="noteWritten"
          @press="pressNote"
        />
      </div>
    </div>
    <RichText
      v-if="field.description && open"
      :id="detailId"
      class="request-point-detail"
      :source="field.description"
    />
    <span
      v-if="opens"
      :id="opensId"
      class="visually-hidden"
      >{{ t('requests.review.opensBelow', { field: opens }) }}</span
    >
    <MarkdownEditor
      v-if="ownChosen"
      ref="ownEditor"
      v-model:preview="preview"
      :label="t('requests.ownVariantName', { field: name })"
      :rows="2"
      :maxlength="8000"
      :model-value="own"
      :disabled="disabled"
      :error="ownError"
      :suggest="suggest"
      hide-label
      hide-tools
      quiet-error
      @update:model-value="emit('edit', { own: $event })"
      @submit="emit('submit')"
    />
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
      :label="t('requests.fieldNoteName', { field: name })"
      :maxlength="2000"
      :model-value="note"
      :rows="2"
      :suggest="suggest"
      @update:model-value="emit('edit', { note: $event })"
      @submit="emit('submit')"
    />
  </div>
</template>

<style scoped>
/* A point is a block of its own on the question's sheet, as an option's row is, and the
   container its line asks for room. */
.request-point {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--color-control-surface);
  border-radius: var(--radius-control);
  container-type: inline-size;

  /* A forced palette clears the ground, which is all that sets one point off from the next. */
  @media (forced-colors: active) {
    outline: 1px solid CanvasText;
    outline-offset: -1px;
  }
}

/* The words with the presses at their end, then the three words of the verdict on a line of
   their own across the row's width, where a phone's width has room for nothing beside them. */
.request-point-line {
  display: grid;
  grid-template-areas:
    'words toggle tools'
    'segments segments segments';
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--space-2) var(--space-1);
  align-items: start;
  min-width: 0;
}

.request-point-words {
  display: grid;
  grid-area: words;
  gap: var(--space-half);
  min-width: 0;
}

.request-point-label {
  font: var(--font-strong);
}

.request-point-description,
.request-point-excerpt,
.request-point-facts,
.request-point-detail {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* One quiet line of what the press beside it would open, as an option's. */
.request-point-excerpt {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.request-point-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
}

.request-point-toggle {
  grid-area: toggle;

  &[aria-expanded='true'] .request-point-glyph {
    rotate: 180deg;
  }
}

.request-point-tools {
  display: flex;
  grid-area: tools;
  gap: var(--space-1);
  align-items: center;
}

/* The three words share the line, so each is as easy to hit as the others. */
.request-point-segments {
  --segmented-option-grow: 1;

  display: flex;
  grid-area: segments;
  min-width: 0;
}

.request-point-own.is-chosen {
  color: var(--color-text);
  background: var(--color-surface-active);
}

/* Wide enough, the words take the line's start and the verdict its end, as on a page. */
@container (width >= 40rem) {
  .request-point-line {
    grid-template-areas: 'words toggle segments tools';
    grid-template-columns: minmax(0, 1fr) auto auto auto;
  }

  .request-point-segments {
    --segmented-option-grow: 0;
  }
}

/* A finger's whole target where a finger is what presses them. */
@container overlay (width <= 30rem) {
  .request-point-segments {
    --size-control-height-compact: var(--size-control-target);
  }
}
</style>
