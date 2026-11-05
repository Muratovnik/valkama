<script setup lang="ts">
/**
 * What a question can do from its foot, and where.
 *
 * No press on a question nobody has put anything into writes, whatever came to stand under
 * the pointer. Don't answer alone could write at one press, so it first asks whether it is
 * meant. Its two answers take the two buttons in their places, each holding room for its
 * other word, so that nothing moves: the way back stands in the very box of the press, and
 * pressing again without moving only goes back. The asking moves nothing and lies on nothing,
 * since nobody should refuse without seeing the end of what will not go: it has its room kept
 * in the buttons' own row, just before the two it asks between, and on a row of its own above
 * them only where that row has no room. Under them it fell out of the window with a foot at the
 * window's edge, and no scroll can bring it back without ending the step.
 *
 * The same buttons stay under the keyboard for the same reason, so focus has nowhere to fall.
 *
 * While the form of a change is open, which an icon on the question's head opens, the same two
 * places hold Cancel and Save. Cancel is always there to press: whatever else is wrong, the way
 * out of the form is not.
 *
 * What the host puts in the slot stands first in the row: the press of the comment on the
 * question, on the row's left end, as what comes before all of this.
 *
 * In the list of everything waiting, a question that no longer waits stays until it is
 * removed, so it offers that, last, where the next step of a question stands.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
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
}>()
const emit = defineEmits<{
  'dismiss': []
  'onward': []
  'open': []
  'refresh': []
  'way-out': []
}>()
const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
/** Absent rather than false, because `aria-disabled="false"` is a claim and not a default. */
const busyMark = computed(() => props.busy || undefined)
const asksTwo = computed(() => props.waiting || props.changing)
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
  const [word, room] = [t('requests.decline'), t('requests.answer')]
  return props.declining
    ? { room, variant: 'danger' as const, word }
    : { room: word, variant: 'primary' as const, word: room }
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
  >
    <slot />
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
    <!-- Next to the two answers it asks between. -->
    <div
      v-if="waiting"
      class="request-asked-room"
      :data-room="t('requests.declineAsked')"
    >
      <p
        v-if="declining"
        class="request-asked"
        role="alert"
      >
        {{ t('requests.declineAsked') }}
      </p>
    </div>
    <VButton
      v-if="asksTwo"
      class="request-way-out request-held"
      :aria-disabled="busyMark"
      :data-room="wayOut.room"
      :disabled="wayOutDisabled"
      :variant="wayOut.variant"
      @click="pressWayOut"
      >{{ wayOut.word }}</VButton
    >
    <VButton
      v-if="asksTwo"
      class="request-onward request-held"
      :aria-disabled="busyMark"
      :data-room="onward.room"
      :disabled="disabled"
      :variant="onward.variant"
      @click="emit('onward')"
      >{{ onward.word }}</VButton
    >
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

/* What the host puts first stands on the row's left end, its glyph on the axis of the radios. */
:slotted(*) {
  position: relative;
  inset-inline-start: calc(
    var(--space-3) + (var(--font-size-interface) - var(--size-control-inline)) / 2
  );
  margin-inline-end: auto;
}

/* On the room kept for it, which lies just where it does, so nothing has to move when it comes.
   Its words, unseen, give it the height they will need. */
.request-asked-room {
  position: relative;
  flex: 1 1 10rem;
  min-width: 0;
  font: var(--font-detail);
  text-align: end;

  &::before {
    content: attr(data-room);
    visibility: hidden;
  }
}

.request-asked {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
}

/* No room beside the buttons: a row of its own above them, the room kept as it is beside them. */
@container (width <= 30rem) {
  .request-asked-room {
    flex: 0 0 100%;
    order: -1;
  }
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
