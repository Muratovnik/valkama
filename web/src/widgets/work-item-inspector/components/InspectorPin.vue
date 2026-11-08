<script setup lang="ts">
/**
 * The pin beside the link in a card's head: it keeps the item in the side panel's list of
 * work whether or not anyone works on it, until a person takes it off.
 *
 * Whether the item is pinned is the live-work frame's to say, since every pinned item is
 * one of its rows; until a frame has arrived there is nothing to say and no pin. Filled,
 * the item is pinned and a press takes the pin off; the name says which a press does. A
 * pin is the person's own list: it writes nothing to the item's history, and what came of
 * the press is said in the shell's corner, as the rail's pin says it.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useOpenNotice } from '@/features/session-open/openNotice.ts'

import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ reference: string }>()

const { t } = useI18n()
const store = useLiveWorkStore()
const say = useOpenNotice()
const busy = ref(false)

const pinned = computed(() => store.pinned(props.reference))
const words = computed(() => (pinned.value ? t('liveWork.unpin') : t('liveWork.pin')))
/** Absent rather than false: a control that is not waiting makes no claim about it. */
const busyMark = computed(() => busy.value || undefined)

async function toggle() {
  if (busy.value || pinned.value === null) return
  const on = !pinned.value
  busy.value = true
  try {
    await store.pin(props.reference, on)
    say(t(on ? 'liveWork.pinned' : 'liveWork.unpinned', { reference: props.reference }), 'done')
  } catch {
    say(t('liveWork.pinFailed'), 'refused')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button
    v-if="pinned !== null"
    v-tooltip="words"
    class="identity-pin"
    type="button"
    :class="{ pinned }"
    :aria-label="words"
    :aria-busy="busyMark"
    @click="toggle"
  >
    <VIcon
      class="identity-pin-glyph"
      name="pin"
      :size="14"
    />
  </button>
</template>

<style scoped>
/* The link's neighbour, and its twin: bare, in the line's ink, a step apart. */
.identity-pin {
  display: inline-flex;
  flex: none;
  justify-content: center;
  align-items: center;
  min-inline-size: var(--size-control-inline);
  min-block-size: var(--size-control-inline);
  padding: 0;
  margin-inline-start: var(--space-1);
  border: 0;
  color: inherit;
  font: inherit;
  background: none;
  border-radius: var(--radius-status);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  &[aria-busy='true'] {
    cursor: progress;
  }
}

/* Pinned, the pin is filled and in the muted ink: a fact about the item, not an offer. */
.identity-pin.pinned {
  color: var(--color-text-muted);

  .identity-pin-glyph {
    fill: currentcolor;
  }
}
</style>
