<script setup lang="ts">
/**
 * What an agent's session behind a card is doing now: the session's one sign
 * (`SessionSign`), as the side panel and a tile draw it, and a word. Only the sign
 * of an item an agent is seen working on turns, and only while the field's motion
 * runs; an item the session holds while it is about other work, a session that
 * asks or waits and one fallen silent draw signs that never move, and a paused
 * field holds the working one still. The word and the shape carry the state, so no
 * colour has to.
 */
import { computed } from 'vue'

import { signOf, useLiveWord } from '@/widgets/work-item-graph/composables/useGraphMotion.ts'
import type { LiveWork } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import SessionSign from '@/shared/ui/SessionSign.vue'

const { live, still = false } = defineProps<{
  live: LiveWork
  /** The field's motion does not run: paused, or reduced. */
  still?: boolean
}>()

const liveWord = useLiveWord()
const word = computed(() => liveWord(live))
const sign = computed(() => signOf(live))
</script>

<template>
  <span
    class="graph-live"
    :data-live="sign"
  >
    <SessionSign
      class="graph-live-sign"
      :sign="sign"
      :still="still"
    />
    <span class="graph-live-word">{{ word }}</span>
  </span>
</template>

<style scoped>
/* The word says the state in full, so it never gives way: whatever stands
   beside it does. It is in the line's own ink; the sign carries the hue. The mark
   is a line of text, so it stands on the baseline the holder's name stands on. */
.graph-live {
  display: inline-block;
  flex: 0 0 auto;
  white-space: nowrap;
}

/* The sign in that line, its middle on the middle of the line's capitals
   (`--size-text-middle`), as a mark's glyph stands (`facetMarks.css`): centred on
   the line's box it stood 0.8px low beside the word. Its box is 14px. */
.graph-live-sign {
  display: inline;
  vertical-align: calc(var(--size-text-middle) - 7px);
  margin-inline-end: var(--space-1);
}

.graph-live-word {
  white-space: nowrap;
}
</style>
