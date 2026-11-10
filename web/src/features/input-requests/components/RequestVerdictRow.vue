<script setup lang="ts">
/**
 * One point of a review, one row: its label, the three words it is answered with, Accept |
 * Later | Reject, which none is until the person picks one, and the press of its comment; under
 * the label, one quiet line of what it comes to (`RequestPointLine`). Choosing only selects:
 * Send is what sends. The segment never shows what the agent recommends, by colour or by mark,
 * so a recommendation is not mistaken for a choice.
 *
 * The chevron and the label are one press that opens the point in place, as an option's row
 * opens its description: nothing already read moves. The description starts where the quiet
 * line stood, and what the agent recommends follows it in words, with why. Under them, set in
 * behind the thread's rule, hang the fields the verdict opens and the comment's field. A field
 * hangs there whether or not the verdict holds its option yet, read only until it does, so that
 * choosing moves nothing; while the point is closed, the line names what was chosen there.
 * Which points are open is the review's to hold (`open`), so that a refusal can open one.
 *
 * Its comment is the one a field with options has: with no verdict chosen it is sent as the
 * point's own option, and with one as a note on it (`checkAnswers`). Its field hangs in the
 * open point, so its press on a closed point opens the point too.
 *
 * Where choosing Accept opens a field below, the segment says so to a reader before it is
 * pressed, and focus stays in the segments when it opens (WCAG 3.2.2). The press that opens the
 * point and the agent's words are tab stops only while focus is in the row: twenty-five of them
 * stood between the segments and Send.
 *
 * Where the row is 30rem wide or more, which a card's drawer is, the segments stand at the end
 * of the label's line; narrower, on a line of their own across the row, between the label and
 * the quiet line, so that opening the point moves them no more than it moves the label. A finger
 * gets the target it needs, and so does the comment's press, growing its own box (`reach-grow`),
 * which stands on the label's first line however the label wraps (`LineEnd`).
 */
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestNote from '@/features/input-requests/components/RequestNote.vue'
import RequestNoteToggle from '@/features/input-requests/components/RequestNoteToggle.vue'
import RequestPointLine from '@/features/input-requests/components/RequestPointLine.vue'
import { useRequestNote } from '@/features/input-requests/composables/useRequestNote.ts'
import { descriptionViews } from '@/features/input-requests/utils/optionDescriptions.ts'
import type { PointWay, Verdict } from '@/features/input-requests/utils/reviewForm.ts'
import type { FieldEdit } from '@/features/input-requests/utils/validateAnswers.ts'

import { VERDICTS } from '@/shared/api/inputRequestModel.ts'
import type { InputAnswers, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { parseRichInline, plainText, unlinked } from '@/shared/lib/richText.ts'
import FieldError from '@/shared/ui/FieldError.vue'
import LineEnd from '@/shared/ui/LineEnd.vue'
import type MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import RichInlines from '@/shared/ui/RichInlines.vue'
import RichText from '@/shared/ui/RichText.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VIcon from '@/shared/ui/VIcon.vue'

type EditorSuggest = InstanceType<typeof MarkdownEditor>['$props']['suggest']

const props = withDefaults(
  defineProps<{
    disabled: boolean
    field: InputRequestField
    /** The point's comment. */
    comment?: string
    /** Why the row was refused; empty while it stands. */
    error?: string
    /** What choosing Accept opens below, by its label; empty where it opens nothing. */
    opens?: string
    suggest?: EditorSuggest
    value?: InputAnswers[string]
    /** What the verdict opened, which the closed row names. */
    way?: PointWay | null
  }>(),
  {
    comment: '',
    error: '',
    opens: '',
    suggest: undefined,
    value: undefined,
    way: null,
  },
)
const emit = defineEmits<{ edit: [edit: FieldEdit]; submit: []; verdict: [verdict: Verdict] }>()
const open = defineModel<boolean>('open', { default: false })
const preview = defineModel<boolean>('preview', { default: false })
const slots = defineSlots<{ under?: () => unknown }>()
const { t } = useI18n()
/** The chevron's size, which is also the row's first column, where nothing else stands. */
const GLYPH = 16
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
/** The label's words without its links: it stands inside the press that opens the point. */
const label = computed(() => unlinked(parseRichInline(props.field.label)))
/** The point's description folds by the rule an option's does. */
const view = computed(() => {
  const { description, label: words } = props.field
  const point = { id: 'point', label: words, ...(description ? { description } : {}) }
  return descriptionViews([point]).get('point') ?? 'none'
})
/** What the agent recommends, said in words in the open point, whatever was chosen. */
const advice = computed(() => {
  const { recommended, why } = props.field
  if (!recommended) return ''
  const word = t(`requests.review.advice.${recommended}`)
  // A space before the why that follows it on the line.
  return why
    ? `${t('requests.review.agentWhy', { verdict: word })} `
    : t('requests.review.agentSays', { verdict: word })
})

/** Focus is somewhere in the row, which is what makes its presses tab stops. */
const standing = ref(false)
const tabStop = computed(() => (standing.value ? 0 : -1))
const errorShown = computed(() => (props.error ? errorId : undefined))
const detailShown = computed(() => (open.value ? detailId : undefined))
/** Absent rather than false, because `aria-invalid="false"` is a claim and not a default. */
const invalidMark = computed(() => (props.error ? 'true' : undefined))
function leave(event: FocusEvent) {
  const next = event.relatedTarget
  if (!(next instanceof Node) || !(event.currentTarget as Node).contains(next))
    standing.value = false
}

const root = ref<HTMLElement | null>(null)
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
/** On a closed point the press opens the point with its comment's field, focused. */
async function pressComment() {
  if (!open.value) {
    open.value = true
    await nextTick()
    if (noteOpen.value) {
      noteEditor.value?.focus()
      return
    }
  }
  await pressNote()
}
const hangs = computed(() => open.value && (Boolean(slots.under) || noteOpen.value))
/** Moves focus to what is to be fixed, the segments. */
function focus() {
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
    <div
      class="request-point-row"
      :style="{ '--request-point-glyph': `${GLYPH}px` }"
    >
      <button
        type="button"
        class="request-point-toggle"
        :tabindex="tabStop"
        :aria-controls="detailShown"
        :aria-expanded="open"
        @click="open = !open"
      >
        <VIcon
          class="request-point-glyph"
          name="chevron-down"
          :size="GLYPH"
        />
        <span
          :id="labelId"
          class="request-point-label"
          ><RichInlines :nodes="label"
        /></span>
      </button>
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
      <LineEnd class="request-point-tools reach-grow">
        <RequestNoteToggle
          :disabled="disabled"
          :name="t('requests.commentName', { field: name })"
          :open="noteOpen && open"
          :title="t('requests.comment')"
          :written="noteWritten"
          @press="pressComment"
        />
      </LineEnd>
      <div
        v-if="open"
        :id="detailId"
        class="request-point-said"
      >
        <RichText
          v-if="field.description"
          class="request-point-detail"
          :source="field.description"
        />
      </div>
      <div
        v-else
        class="request-point-said"
      >
        <RequestPointLine
          :comment="comment"
          :field="field"
          :tab-stop="tabStop"
          :verdict="verdict"
          :view="view"
          :way="way"
        />
      </div>
      <p
        v-if="open && advice"
        class="request-point-advice"
      >
        <span class="request-point-lead">{{ advice }}</span>
        <RichText
          v-if="field.why"
          :source="field.why"
          inline
        />
      </p>
      <span
        v-if="opens"
        :id="opensId"
        class="visually-hidden"
        >{{ t('requests.review.opensBelow', { field: opens }) }}</span
      >
      <FieldError
        v-if="error"
        :id="errorId"
        class="request-point-error"
        >{{ error }}</FieldError
      >
      <div
        v-if="hangs"
        class="request-point-hang"
      >
        <slot name="under" />
        <RequestNote
          v-if="noteOpen"
          ref="noteEditor"
          v-model:preview="preview"
          :disabled="disabled"
          :label="t('requests.commentName', { field: name })"
          :maxlength="2000"
          :model-value="comment"
          :placeholder="t('requests.commentHint')"
          :rows="2"
          :suggest="suggest"
          @update:model-value="emit('edit', { comment: $event })"
          @submit="emit('submit')"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* A point is a row of the review's list, set off from the next by a divider, and the container
   that decides whether its segments share the label's line. */
.request-point {
  min-width: 0;
  padding-block-end: var(--space-2);
  border-block-end: 1px solid var(--color-rule);
  container-type: inline-size;

  &:last-child {
    padding-block-end: 0;
    border-block-end: 0;
  }
}

/* The chevron's column, then the words' column, where every line under the label starts. Its
   rows are tracks with no gap, so a part it does not show leaves none: each brings its step. */
.request-point-row {
  /* The chevron's column, as wide as the chevron: the template sets it from `GLYPH`. */
  --request-point-glyph: 16px;

  display: grid;
  grid-template-areas:
    'chevron label tools'
    'segments segments segments'
    '. said said'
    '. advice advice'
    '. error error'
    '. hang hang';
  grid-template-columns: var(--request-point-glyph) minmax(0, 1fr) auto;
  column-gap: var(--space-2);
  align-items: first baseline;
  min-width: 0;
}

/* The chevron and the label are one press, the chevron in the row's first column and the words
   in its second. A line tall at least, as a compact control is, for a finger to find.

   It repeats the row's columns rather than borrowing them as a subgrid: Chromium leaves the step
   a baseline-aligned subgrid is moved down by out of its row's height, so a label of three lines
   beside the verdict ran into the line under it. */
.request-point-toggle {
  display: grid;
  grid-template-columns: var(--request-point-glyph) minmax(0, 1fr);
  grid-row: 1;
  grid-column: chevron-start / label-end;
  column-gap: var(--space-2);
  align-content: center;
  align-items: baseline;
  min-width: 0;
  min-height: var(--size-control-height-compact);
  padding: 0;
  border: 0;
  color: inherit;
  font: var(--font-strong);
  text-align: start;
  background: transparent;
  cursor: pointer;
}

/* One line tall, so its drawn chevron, centred in the box, sits on the first line's centre. */
.request-point-glyph {
  align-self: start;
  block-size: 1lh;
  color: var(--color-text-muted);

  /* A forced palette leaves a glyph its own muted ink, so the chevron that says open or closed
     names the system ink itself (DESIGN.md, the forced palette). */
  @media (forced-colors: active) {
    color: CanvasText;
    forced-color-adjust: none;
  }

  [aria-expanded='true'] > & {
    rotate: 180deg;
  }
}

.request-point-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* The baseline it lends is the label's line. */
.request-point-tools {
  grid-area: tools;
  font: var(--font-strong);
}

/* The three words share their line, so each is as easy to hit as the others. */
.request-point-segments {
  --segmented-option-grow: 1;

  display: flex;
  grid-area: segments;
  min-width: 0;
  margin-block-start: var(--space-2);
}

.request-point-said {
  grid-area: said;
  min-width: 0;
  margin-block-start: var(--space-half);

  &:empty {
    display: none;
  }
}

/* The quiet line's type, so that the description's first line stands where the line stood. */
.request-point-detail,
.request-point-advice {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.request-point-advice {
  grid-area: advice;
  min-width: 0;
  margin: var(--space-1) 0 0;
}

.request-point-lead {
  color: var(--color-text);
}

.request-point-error {
  grid-area: error;
  margin-block-start: var(--space-1);
}

/* What the verdict opens and the comment hang from the point, set in behind the thread's rule,
   which runs from under the point to the end of the last of them. */
.request-point-hang {
  display: grid;
  grid-area: hang;
  gap: var(--space-3);
  min-width: 0;
  padding-inline-start: var(--space-3);
  margin-block-start: var(--space-2);
  border-inline-start: 1px solid var(--color-rule-strong);
}

/* Wide enough, the words take the line's start and the verdict its end, as on a page. */
@container (width >= 30rem) {
  .request-point-row {
    grid-template-areas:
      'chevron label segments tools'
      '. said said said'
      '. advice advice advice'
      '. error error error'
      '. hang hang hang';
    grid-template-columns: var(--request-point-glyph) minmax(0, 1fr) auto auto;
  }

  .request-point-segments {
    --segmented-option-grow: 0;

    margin-block-start: 0;
  }
}

/* A finger's whole target where a finger is what presses them, as in a narrow sheet the
   comment's press takes it (`RequestNoteToggle`). */
@container overlay (width <= 30rem) {
  .request-point-segments {
    --size-control-height-compact: var(--size-control-target);
  }

  .request-point-tools {
    --size-control-inline: var(--size-control-target);
  }
}
</style>

<style scoped src="@/shared/ui/reach.css"></style>
