<script setup lang="ts">
/**
 * What a question can do from its foot, and where.
 *
 * No press on a question nobody has put anything into writes, whatever came to stand under
 * the pointer. Don't answer alone could write at one press, so it first asks whether it is
 * meant. Its two answers take the two buttons in their places, each holding room for its
 * other word, so that nothing moves: the way back stands in the very box of the press, and
 * pressing again without moving only goes back. The asking lies over what is above the
 * buttons and takes no height, since any height would move them. A comment on the question
 * that stands open is not to be lain on, since nobody should refuse without seeing the end of
 * what will not go, so while it is open the asking has its room kept, asked or not: in the
 * buttons' own row, just before the two it asks between, where the row has room for it, and
 * on a row of its own above them only where it has none. Kept on a row of its own at every width, the room stood as a
 * void of about 45px between the comment and the buttons, where everything else is 12px.
 *
 * The same buttons stay under the keyboard for the same reason, so focus has nowhere to fall.
 *
 * An answered question offers to change its answer here, where a question offers everything
 * else, and while that form is open the same two places hold Cancel and Save. Cancel is
 * always there to press: whatever else is wrong, the way out of the form is not.
 *
 * In the list of everything waiting, a question that no longer waits stays until it is
 * removed, so it offers that, last, where the next step of a question stands.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  busy: boolean
  /** The answer can be changed from here and its form is not open. */
  changeable: boolean
  /** The form of a change is open. */
  changing: boolean
  /** Whether declining was asked for, and the next word on it decides. */
  declining: boolean
  disabled: boolean
  /** It stopped waiting, in a list it can be taken out of. */
  dismissable: boolean
  /** A comment on the question stands open above the foot. */
  noting: boolean
  refreshable: boolean
  standalone: boolean
  waiting: boolean
}>()
const emit = defineEmits<{
  'dismiss': []
  'onward': []
  'open': []
  'refresh': []
  'start-change': []
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
function focusChange() {
  root.value?.querySelector<HTMLElement>('.request-change')?.focus({ preventScroll: true })
}
function pressWayOut() {
  emit('way-out')
  focusWayOut()
}
defineExpose({ focusChange, focusWayOut })
</script>

<template>
  <div
    ref="root"
    class="request-actions"
    :class="{ noting }"
  >
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
    <VButton
      v-if="changeable"
      class="request-change"
      variant="ghost"
      @click="emit('start-change')"
      >{{ t('requests.changeAnswer') }}</VButton
    >
    <!-- Next to the two answers it asks between. -->
    <div
      v-if="noting"
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
    <p
      v-else-if="declining"
      class="request-asked"
      role="alert"
    >
      {{ t('requests.declineAsked') }}
    </p>
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
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
  margin-inline-start: auto;
}

/* Lying on what is above the buttons, against the foot around them, on the ground a question
   like this has elsewhere. In a dialog, which stands centred, height pushed down would pull
   the buttons up as well. */
.request-asked {
  position: absolute;
  inset-inline-end: 0;
  bottom: 100%;
  padding: var(--space-1) var(--space-2);
  margin: 0 0 var(--space-1);
  color: var(--color-text);
  font: var(--font-detail);
  background: var(--color-surface-muted);
  border-radius: var(--radius-control);
}

/* Where it cannot stand clear of the comment's press it covers that whole, not half a word. */
@container (width <= 30rem) {
  .request-asked {
    inset-inline-start: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    min-height: var(--size-control-height);
    text-align: end;
  }
}

/* On the room kept for it, which lies just where it does, so nothing has to move when it comes.
   The room takes what the row leaves before the buttons, and a row of its own only where the
   row leaves less than its least. Its words, unseen, give it the height they will need. */
.request-actions.noting {
  flex: 0 0 100%;
  align-items: center;
}

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

  .request-asked {
    inset: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    min-height: 0;
    padding: 0;
    margin: 0;
    background: none;
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
