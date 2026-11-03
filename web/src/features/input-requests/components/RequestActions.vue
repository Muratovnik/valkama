<script setup lang="ts">
/**
 * What a question can do from its foot, and where.
 *
 * No press on a question nobody has put anything into writes, whatever came to stand under
 * the pointer. Don't answer alone could write at one press, so it first asks whether it is
 * meant. Its two answers take the two buttons in their places, each holding room for its
 * other word, so that nothing moves: the way back stands in the very box of the press, and
 * pressing again without moving only goes back. The asking lies over what is above the
 * buttons and takes no height, since any height would move them. An own answer open is not
 * to be lain on, since nobody should refuse without seeing the end of what will not go, so
 * while it is open the asking has its room kept above the buttons, asked or not.
 *
 * The same buttons stay under the keyboard for the same reason, so focus has nowhere to fall.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  busy: boolean
  /** Whether declining was asked for, and the next word on it decides. */
  declining: boolean
  disabled: boolean
  /** An own answer stands open above the foot. */
  noting: boolean
  refreshable: boolean
  standalone: boolean
  waiting: boolean
}>()
const emit = defineEmits<{ 'onward': []; 'open': []; 'refresh': []; 'way-out': [] }>()
const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
/** Absent rather than false, because `aria-disabled="false"` is a claim and not a default. */
const busyMark = computed(() => props.busy || undefined)
const wayOut = computed(() => {
  const [word, room] = [t('requests.back'), t('requests.decline')]
  return props.declining
    ? { room, variant: 'secondary' as const, word }
    : { room: word, variant: 'ghost' as const, word: room }
})
const onward = computed(() => {
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
    :class="{ noting }"
  >
    <span
      v-if="noting"
      class="request-asked-room"
      :data-room="t('requests.declineAsked')"
    />
    <p
      v-if="declining"
      class="request-asked"
      role="alert"
    >
      {{ t('requests.declineAsked') }}
    </p>
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
      v-if="waiting"
      class="request-way-out request-held"
      :aria-disabled="busyMark"
      :data-room="wayOut.room"
      :disabled="disabled"
      :variant="wayOut.variant"
      @click="pressWayOut"
      >{{ wayOut.word }}</VButton
    >
    <VButton
      v-if="waiting"
      class="request-onward request-held"
      :aria-disabled="busyMark"
      :data-room="onward.room"
      :disabled="disabled"
      :variant="onward.variant"
      @click="emit('onward')"
      >{{ onward.word }}</VButton
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

/* Where it cannot stand clear of Your own answer it covers that whole, rather than half a word. */
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

/* On the room kept for it, which lies just where it does, so nothing has to move when it comes. */
.request-actions.noting {
  position: relative;
  flex: 0 0 100%;

  .request-asked {
    inset: 0 0 auto;
    min-height: 0;
    margin: 0;
    text-align: end;
    background: none;
  }
}

.request-asked-room {
  flex: 0 0 100%;
  padding: var(--space-1) var(--space-2);
  font: var(--font-detail);
  text-align: end;
  visibility: hidden;

  &::before {
    content: attr(data-room);
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
