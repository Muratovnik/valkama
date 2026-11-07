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
 * the way to the task and the read of its status, which a press would end the step on anyway,
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
 * What the host puts in the slot stands first in the row: the press of the comment on the
 * question, on the row's left end, as what comes before all of this. The way to the task and
 * the read of its status stand after it, at the row's start at every width. On a phone's row
 * the comment's press leads them on their line where it and they fit it (`useLeadPlace`): kept
 * on the buttons' line it left «Open task» a line alone above them, and at 320px took a line
 * alone itself, three lines for four controls. Where they do not fit it, or where nothing is
 * offered there, it keeps the buttons' line: taken up anyway, it was left a line alone above
 * them once the place broke onto a line of its own, a line more. The asking changes none of the
 * widths this is read from, so it moves the press nowhere.
 *
 * In the list of everything waiting, a question that no longer waits stays until it is
 * removed, so it offers that, last, where the next step of a question stands.
 *
 * A list under a comment is not declined (`declinable` false): nobody waits on it, so it has
 * only its way on, in its own words (`sendWord`), until a change of it is open. The row is
 * the same row: with no asking there is no place kept for it, nor room for Don't answer in the
 * way on, which stood 9px wider than its words for it in English, so what stands before the way on
 * is only what is offered there, and with nothing offered the way on ends the comment's line.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLeadPlace } from '@/features/input-requests/composables/useLeadPlace.ts'

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
    standalone: boolean
    waiting: boolean
    /** Somebody waits on the answer, so it can be refused. */
    declinable?: boolean
    /** What Send says, where it sends something other than an answer. */
    sendWord?: string
  }>(),
  { declinable: true, sendWord: undefined },
)
const emit = defineEmits<{
  'dismiss': []
  'onward': []
  'open': []
  'refresh': []
  'way-out': []
}>()
const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const { leads: pressLeads } = useLeadPlace(root)
/** Absent rather than false, because `aria-disabled="false"` is a claim and not a default. */
const busyMark = computed(() => props.busy || undefined)
const asksTwo = computed(() => props.waiting || props.changing)
/** It waits and can be refused, so the step of declining may come and needs its place. */
const declines = computed(() => props.waiting && props.declinable)
const offersWayOut = computed(() => props.changing || props.declinable)
/** The words that keep the asking's place while it can be asked, unseen. */
const askingRoom = computed(() => (declines.value ? t('requests.declineAsked') : undefined))
/** Something stands before the two answers, or their asking needs the place. */
const leads = computed(() => declines.value || props.standalone || props.refreshable)
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
defineExpose({ focusWayOut })
</script>

<template>
  <div
    ref="root"
    class="request-actions"
    :class="{ 'press-leads': pressLeads }"
  >
    <slot />
    <!-- What comes before the two answers, and the place their asking takes. -->
    <div
      v-if="leads"
      class="request-lead"
      :class="{ 'is-room': declines, 'is-asking': declining }"
      :data-room="askingRoom"
    >
      <div class="request-lead-controls">
        <VButton
          v-if="standalone"
          variant="ghost"
          @click="emit('open')"
          >{{ t('requests.openTask') }}</VButton
        >
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
        {{ t('requests.declineAsked') }}
      </p>
    </div>
    <div
      v-if="asksTwo"
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
  /* What the place keeps for the asking, read as it is by `useLeadPlace`. */
  --request-room: 12rem;

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
  min-inline-size: min(var(--request-room), 100%);

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

  /* Where it and the controls in the place fit one line, the comment's press stands at the start
     of their line, and the place takes what it leaves of the line. */
  .press-leads :slotted(*) {
    order: -1;
  }

  .press-leads .request-lead {
    flex-basis: auto;
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

/* A button that holds room for its other word. */
.request-actions .request-held {
  flex-direction: column;
  gap: 0;

  &::after {
    content: attr(data-room);
    height: 0;
    overflow: hidden;
    visibility: hidden;
  }
}

/* The same weight in both its words, or their room would differ. */
.request-actions .request-onward {
  font-weight: 600;
}
</style>
