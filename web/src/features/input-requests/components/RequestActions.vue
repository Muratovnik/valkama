<script setup lang="ts">
/**
 * What a question can do from its foot, and where.
 *
 * No press on a question nobody has put anything into writes, whatever came to stand under
 * the pointer. Don't answer alone could write at one press, so it first asks whether it is
 * meant. Its two answers take the two buttons in their places, each holding room for its
 * other word, so that nothing moves: the way back stands in the very box of the press, and
 * pressing again without moving only goes back. The asking moves nothing and lies on nothing,
 * since nobody should refuse without seeing the end of what will not go: it takes the place of
 * the read of its status, which a press would end the step on anyway,
 * and that place is kept as wide as the asking needs on two lines. On a row as narrow as a
 * phone's that place is the line above the buttons, which those two hold, and which stays the
 * asking's alone only where neither is offered. Under them it fell out of the window
 * with a foot at the window's edge, and no scroll can bring it back without ending the step.
 * Kept beside the controls as a room of its own, it sent the two to the next line where
 * everything else fitted.
 *
 * The same buttons stay under the keyboard for the same reason, so focus has nowhere to fall.
 *
 * While the form of a change is open, which an icon on the question's head opens, the same two
 * places hold Cancel and Save. Cancel is always there to press: whatever else is wrong, the way
 * out of the form is not.
 *
 * The two are one pair and wrap as one: on a row short of room they go to the next line
 * together, at its end. Wrapped one by one, Send stood alone under Don't answer once Check
 * status had joined the row, and Save under Cancel on a phone.
 *
 * What the host puts in the slot stands first in the row: the press of the comment on a list
 * under a comment, on the row's left end, as what comes before all of this. The read of its
 * status stands after it, at the row's start at every width. A question's block has no press
 * here: its comment is in its head, and the way to its task is the number in that head. On a phone's row
 * the place is the line above the buttons, and the comment's press stands on the buttons' line
 * where it fits beside the two answers. Where it does not, at 320 and 340px, it stands first
 * on the place's line instead, and the place takes the rest of that line, its controls
 * wrapping inside it: kept on the buttons' line there it took a line alone between the place
 * and the buttons.
 * Led by the press at every phone's width, the place left the press alone over the buttons
 * where it held nothing but the asking's room, and put «Проверить статус» on a line of its own.
 *
 * In the list of everything waiting, a question that no longer waits stays until it is
 * removed, so it offers that, last, where the next step of a question stands.
 *
 * A list under a comment is not declined (`declinable` false): nobody waits on it, so it has
 * only its way on, in its own words (`sendWord`), until a change of it is open. The row is
 * the same row: with no asking there is no place kept for it, nor room for Don't answer in the
 * way on, which stood 9px wider than its words for it in English, so what stands before the way on
 * is only what is offered there, and with nothing offered the way on ends the comment's line.
 *
 * A question of a kind other than a choice is answered by its own row of buttons (`answers`),
 * one press each, standing where the two answers do and wrapping as one as they do. Wider
 * together than a whole line, they wrap among themselves inside it, each line ending at the
 * row's end: held to one line, a task's four answers ran 121px past the record at 390px in
 * Russian, its last answer out of the window. Nobody
 * declines it, but an answer that cannot be taken back asks first, as Don't answer does, and
 * in the same way: its own box says Back, so a second press without moving only goes back, the
 * box beside it says the answer in the danger's ink, and the asking, in its own words, takes the
 * same place. Every box holds room for each word it can come to say, so nothing moves. The
 * answer that puts the question off opens its choice of a day in place (`later`), and says so.
 *
 * An answer that cannot be sent yet (`blocked`), as a group's Do and Later… with no finding
 * ticked, is unavailable, and why stands under the answers at their end, as it stands under an
 * unavailable Put off. Its box is unavailable only while it says its own answer: as the box an
 * asking confirms in, it confirms. That line holds the room of each reason an answer can come
 * to give (`blockable`) while the question waits, so a tick taken away or given back moves
 * nothing under it: given its room only while it stood, it moved the next question down and up.
 * While the choice of a day stands open, the reason stands under its Put off alone, which it
 * keeps unavailable too, and this line keeps only its room: said in both places, it read twice
 * on one screen. The answers it blocks name it there (`blockedId`, which the foot gives both).
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import type { KindAnswer } from '@/features/input-requests/utils/questionRecord.ts'

import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    busy: boolean
    /** The form of a change is open. */
    changing: boolean
    /** Whether declining was asked for, and the next word on it decides. */
    declining: boolean
    disabled: boolean
    /** It stopped waiting, in a list it can be taken out of. */
    dismissable: boolean
    refreshable: boolean
    waiting: boolean
    /** A kind's own answers, in place of the two; none for a choice. */
    answers?: readonly KindAnswer[]
    /** The answer whose step of asking stands, by its place among them. */
    asking?: number | null
    /** The id of the reason a blocked answer names, wherever it stands. */
    blockedId?: string
    /** Somebody waits on the answer, so it can be refused. */
    declinable?: boolean
    /** Whether the choice of a day the answer that puts off opens is open, and its id. */
    later?: { controls: string; open: boolean } | null
    /** What Send says, where it sends something other than an answer. */
    sendWord?: string
  }>(),
  {
    answers: () => [],
    asking: null,
    blockedId: undefined,
    declinable: true,
    later: null,
    sendWord: undefined,
  },
)
const emit = defineEmits<{
  /** A press on a kind's answer, by its place; `confirmed` once its step of asking was answered. */
  'answer': [index: number, confirmed: boolean]
  'dismiss': []
  'onward': []
  'refresh': []
  'way-out': []
}>()
const { t } = useI18n()
const ownBlockedId = useId()
const blockedId = computed(() => props.blockedId ?? ownBlockedId)
const root = ref<HTMLElement | null>(null)
/** Absent rather than false, because `aria-disabled="false"` is a claim and not a default. */
const busyMark = computed(() => props.busy || undefined)
const asksTwo = computed(() => props.waiting || props.changing)
/** It waits and can be refused, so the step of declining may come and needs its place. */
const declines = computed(() => props.waiting && props.declinable)
const offersWayOut = computed(() => props.changing || props.declinable)
/** It waits for one of its kind's answers rather than for its form. */
const byAnswers = computed(() => props.waiting && props.answers.length > 0)
/** Why an answer cannot be sent yet, under the answers; empty while each can. */
const blockedWhy = computed(() =>
  byAnswers.value ? (props.answers.find((answer) => answer.blocked)?.blocked ?? '') : '',
)
/** Every reason an answer can come to give under the answers, one a line: the line's room. */
const blockedRoom = computed(() =>
  byAnswers.value
    ? [...new Set(props.answers.flatMap(({ blockable }) => blockable ?? []))].join('\n')
    : '',
)
/** The reason stands here, unless under the open choice of a day, which says it there. */
const blockedHere = computed(() => Boolean(blockedWhy.value) && !props.later?.open)
/** The box an answer's step asks in: the next one, or the one before where it is the last. */
const confirmAt = (index: number) => (index + 1 < props.answers.length ? index + 1 : index - 1)
const askedWords = (index: number) =>
  t('requests.record.asked', { answer: props.answers[index]?.label ?? '' })
/**
 * What the step asks, where one may come: declining, or an answer of a kind that asks first.
 * While none stands, the words of the first that would, which keep the place.
 */
const stepWords = computed(() => {
  if (byAnswers.value) {
    const step = props.asking ?? props.answers.findIndex((answer) => answer.twoStep)
    return step >= 0 ? askedWords(step) : undefined
  }
  return declines.value ? t('requests.declineAsked') : undefined
})
/** Something stands before the two answers, or their asking needs the place. */
const leads = computed(() => Boolean(stepWords.value) || props.refreshable)
/**
 * What a kind's answer says now and in which ink, every other word its box may come to say, and,
 * for the answer that puts off, the choice of a day it opens.
 */
function kindButton(answer: KindAnswer, index: number) {
  const step = props.asking
  const words = [
    answer.label,
    ...(answer.twoStep ? [t('requests.back')] : []),
    ...props.answers.flatMap((other, at) =>
      other.twoStep && confirmAt(at) === index ? [other.label] : [],
    ),
  ]
  const opens = answer.later ? (props.later ?? { controls: '', open: false }) : null
  const box = {
    away: step === index,
    // Unavailable only while it says its own answer: lent to an asking, it confirms that.
    blocked: false,
    controls: opens?.open ? opens.controls : undefined,
    expanded: opens ? opens.open : undefined,
    room: words.join('\n'),
    why: undefined as string | undefined,
  }
  if (step === index) return { ...box, variant: 'secondary' as const, word: t('requests.back') }
  if (step !== null && confirmAt(step) === index)
    return { ...box, variant: 'danger' as const, word: props.answers[step]?.label ?? '' }
  const blocked = {
    blocked: Boolean(answer.blocked),
    why: answer.blocked ? blockedId.value : undefined,
  }
  return { ...box, ...blocked, variant: 'secondary' as const, word: answer.label }
}
/** A lone answer that asks has no box beside it, so its asking brings one. */
const loneStep = computed(() =>
  props.asking !== null && confirmAt(props.asking) < 0 ? props.answers[props.asking] : undefined,
)
const wayOutDisabled = computed(() => !props.changing && props.disabled)
const wayOut = computed(() => {
  if (props.changing) {
    const word = t('requests.cancel')
    return { room: word, variant: 'ghost' as const, word }
  }
  const [word, room] = [t('requests.back'), t('requests.decline')]
  return props.declining
    ? { room, variant: 'secondary' as const, word }
    : { room: word, variant: 'ghost' as const, word: room }
})
const onward = computed(() => {
  if (props.changing) {
    const word = t('requests.saveChange')
    return { room: word, variant: 'primary' as const, word }
  }
  const [decline, send] = [t('requests.decline'), props.sendWord ?? t('requests.answer')]
  if (props.declining) return { room: send, variant: 'danger' as const, word: decline }
  // Room for the other word only where it can come: what declines nothing keeps none.
  return { room: declines.value ? decline : send, variant: 'primary' as const, word: send }
})

function focusWayOut() {
  root.value?.querySelector<HTMLElement>('.request-way-out')?.focus({ preventScroll: true })
}
function pressWayOut() {
  emit('way-out')
  focusWayOut()
}
/** A kind's box: its own answer, the way back from a step, or the answer that step asks for. */
function pressKind(index: number) {
  const step = props.asking
  if (step === index) pressWayOut()
  else if (step !== null && confirmAt(step) === index) emit('answer', step, true)
  else emit('answer', index, false)
}
defineExpose({ focusWayOut })
</script>

<template>
  <div
    ref="root"
    class="request-actions"
  >
    <slot />
    <!-- What comes before the two answers, and the place their asking takes. -->
    <div
      v-if="leads"
      class="request-lead"
      :class="{ 'is-room': Boolean(stepWords), 'is-asking': declining }"
      :data-room="stepWords"
    >
      <div class="request-lead-controls">
        <VButton
          v-if="refreshable"
          :aria-disabled="busyMark"
          @click="emit('refresh')"
          >{{ t('requests.checkStatus') }}</VButton
        >
      </div>
      <p
        v-if="declining"
        class="request-asked"
        role="alert"
      >
        {{ stepWords }}
      </p>
    </div>
    <div
      v-if="byAnswers"
      class="request-pair is-answers"
    >
      <VButton
        v-for="(answer, index) in answers"
        :key="index"
        class="request-held"
        :class="{ 'request-way-out': kindButton(answer, index).away }"
        :aria-controls="kindButton(answer, index).controls"
        :aria-describedby="kindButton(answer, index).why"
        :aria-disabled="busyMark"
        :aria-expanded="kindButton(answer, index).expanded"
        :data-room="kindButton(answer, index).room"
        :disabled="disabled || kindButton(answer, index).blocked"
        :variant="kindButton(answer, index).variant"
        @click="pressKind(index)"
        >{{ kindButton(answer, index).word }}</VButton
      >
      <VButton
        v-if="loneStep"
        variant="danger"
        :aria-disabled="busyMark"
        :disabled="disabled"
        @click="emit('answer', asking ?? -1, true)"
        >{{ loneStep.label }}</VButton
      >
    </div>
    <div
      v-else-if="asksTwo"
      class="request-pair"
    >
      <VButton
        v-if="offersWayOut"
        class="request-way-out request-held"
        :aria-disabled="busyMark"
        :data-room="wayOut.room"
        :disabled="wayOutDisabled"
        :variant="wayOut.variant"
        @click="pressWayOut"
        >{{ wayOut.word }}</VButton
      >
      <VButton
        class="request-onward request-held"
        :aria-disabled="busyMark"
        :data-room="onward.room"
        :disabled="disabled"
        :variant="onward.variant"
        @click="emit('onward')"
        >{{ onward.word }}</VButton
      >
    </div>
    <div
      v-if="blockedRoom || blockedWhy"
      class="request-blocked-place"
      :data-room="blockedRoom"
    >
      <p
        v-if="blockedHere"
        :id="blockedId"
        class="request-blocked"
      >
        {{ blockedWhy }}
      </p>
    </div>
    <VButton
      v-if="dismissable"
      variant="ghost"
      @click="emit('dismiss')"
      >{{ t('requests.dismiss') }}</VButton
    >
  </div>
</template>

<style scoped>
.request-actions {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
  align-items: center;
}

/* What the two answers leave of their line, or a line of its own where its controls do not fit
   beside them. Its controls, the asking and the asking's words unseen stand in one cell, so the
   place is as tall as the tallest of them. */
.request-lead {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;

  > *,
  &::before {
    grid-area: 1 / 1;
  }
}

/* Wide enough for the asking on two lines, the height of the controls beside it, or on a line of
   its own; the same in every language, since the words do not set it. */
.request-lead.is-room {
  min-inline-size: min(12rem, 100%);

  &::before {
    content: attr(data-room);
    visibility: hidden;
  }
}

/* Its words are laid out at the width the place has and widen nothing, or the asking would
   move the two to the next line as it came. */
.request-lead::before,
.request-asked {
  margin: 0;
  font: var(--font-detail);
  text-align: end;
  contain: inline-size;
}

.request-asked {
  color: var(--color-text);
}

.request-lead-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

/* A press on any of them would end the step, so the asking takes their place while it stands. */
.request-lead.is-asking .request-lead-controls {
  visibility: hidden;
}

/* As narrow as a phone, the place is the line above the buttons, and the comment's press, first
   in the row, stays on theirs. */
@container (width <= 30rem) {
  .request-lead {
    flex-basis: 100%;
    order: -1;
  }
}

/* Too narrow for the press beside the two answers of a question that waits: the press (28px),
   the gap (8px) and the wider of the two languages' pairs, «Don't answer» held twice in English
   (250.4px), are 286.4px, rounded up to 17.92rem so that a row they just fit keeps the press
   beside them, as a card's at 360px (287px) does, and none they miss leaves it alone. There
   the press stands first on the place's line, which takes the rest of that line, no narrower
   than its widest control, which would otherwise lie over the buttons beside it. Wrapping fills
   a line before the next and never sends a control back, so the row cannot find out for itself
   that the press does not fit where it stands: the width is written here, and the row's test
   (`requestRow.ts`) measures the fit at 320, 360, 390 and 430px in both languages. */
@container (width < 17.92rem) {
  .request-actions:has(.request-lead.is-room) {
    .request-lead {
      flex: 1 1 0;
      grid-template-columns: minmax(min-content, 1fr);
    }

    :slotted(*) {
      order: -1;
    }
  }

  /* With controls in the place, the press stands on the axis of their first line: centred on a
     place of two lines it stood between them, on a line of its own. */
  .request-actions:has(.request-lead.is-room .request-lead-controls > *) {
    .request-lead {
      align-self: flex-start;
    }

    :slotted(*) {
      align-self: flex-start;
      margin-block-start: calc(var(--size-control-height) / 2 - var(--size-control-inline) / 2);
    }
  }
}

/* What the host puts first stands on the row's left end, its glyph on the axis of the radios,
   which stand the rows' inset in from it: none where the rows have none (`--request-row-inset`).
   It changes lines by no transition: the reduced-motion rule gives every property one, and the
   frame it took drew the glyph at the far end of the line it was leaving. */
:slotted(*) {
  position: relative;
  inset-inline-start: calc(
    var(--request-row-inset, var(--space-3)) +
      (var(--font-size-interface) - var(--size-control-inline)) / 2
  );
  margin-inline-end: auto;
  transition-property: none;
}

.request-pair {
  display: flex;
  flex: none;
  gap: var(--space-2);
  align-items: center;
}

/* A kind's answers shrink only on a line they cannot fit as one: a row breaks its lines by each
   part's whole width, so beside what comes before them they still go to the next line together,
   and only there, wider than all of it, wrap inside it, each line ending at the row's end. The
   two answers never do: they wrap as one. */
.request-pair.is-answers {
  flex: 0 1 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 0;
}

/* Why an answer is unavailable: a line of its own under the answers, at their end, as tall as
   the tallest reason it holds the room of, which stands unseen in the same cell. */
.request-blocked-place {
  display: grid;
  flex-basis: 100%;
  grid-template-columns: minmax(0, 1fr);

  > *,
  &::before {
    grid-area: 1 / 1;
  }

  &::before {
    content: attr(data-room);
    white-space: pre-line;
    visibility: hidden;
  }
}

.request-blocked,
.request-blocked-place::before {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  text-align: end;
}

/* A button that holds room for its other word. */
.request-actions .request-held {
  flex-direction: column;
  gap: 0;

  /* A room of several words, one a line, is as wide as the widest. */
  &::after {
    content: attr(data-room);
    height: 0;
    white-space: pre-line;
    overflow: hidden;
    visibility: hidden;
  }
}

/* The same weight in both its words, or their room would differ. */
.request-actions .request-onward {
  font-weight: 600;
}
</style>
