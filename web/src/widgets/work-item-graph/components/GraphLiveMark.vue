<script setup lang="ts">
/**
 * What an agent's session behind a card is doing now: the product's three
 * working dots and a word. The dots pulse only for a turn running while the
 * field's motion runs; an item the session holds while its turn is about other
 * work, a session that waits and one fallen silent hold them still, and so
 * does a paused field. The word carries the state, so no colour
 * has to.
 */
import { computed } from 'vue'

import { useLiveWord } from '@/widgets/work-item-graph/composables/useGraphMotion.ts'
import type { LiveWork } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

const { live, still = false } = defineProps<{
  live: LiveWork
  /** The field's motion does not run: paused, or reduced. */
  still?: boolean
}>()

const liveWord = useLiveWord()
const word = computed(() => liveWord(live))
const resting = computed(() => still || live.state !== 'working')
</script>

<template>
  <span
    class="graph-live"
    :data-live="live.state"
  >
    <span
      class="work-dots"
      aria-hidden="true"
      :class="{ still: resting }"
      ><i /><i /><i
    /></span>
    <span class="graph-live-word">{{ word }}</span>
  </span>
</template>

<style scoped>
/* The word is the one mark of the state that is not a colour, so it never
   gives way: whatever stands beside it does. */
.graph-live {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
  color: var(--color-info);
}

.graph-live-word {
  white-space: nowrap;
}
</style>
