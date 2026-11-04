<script setup lang="ts">
/**
 * The field's one switch for live work moving: «Stop the motion», and once it
 * has stopped, «Start the motion».
 *
 * It stands in the strip above the flow at every width, and its place is held
 * whether or not it is offered, so it arriving with the first moving work
 * moves nothing. It is offered while something on the field moves and the
 * system has not asked for less motion: under reduced motion nothing moves and
 * there is nothing to stop. The glyph is small, its pointer target is not.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { GraphMotion } from '@/widgets/work-item-graph/composables/useGraphMotion.ts'

import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const { motion, moving } = defineProps<{
  motion: GraphMotion
  /** Something on the field is live work that moves. */
  moving: boolean
}>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useI18n()

const offered = computed(() => moving && motion !== 'reduced')
const paused = computed(() => motion === 'paused')
const label = computed(() => t(paused.value ? 'graph.motion.resume' : 'graph.motion.pause'))
const glyph = computed(() => (paused.value ? 'play' : 'pause'))
</script>

<template>
  <span class="graph-motion-place">
    <VButton
      v-if="offered"
      class="graph-motion-toggle"
      variant="ghost"
      size="compact"
      :aria-label="label"
      :title="label"
      icon
      @click="emit('toggle')"
    >
      <VIcon
        :name="glyph"
        :size="16"
      />
    </VButton>
  </span>
</template>

<style scoped>
/* The place is the button's whether or not it stands there, one line of the
   strip tall: the button rides the strip's own air above and below it, so the
   strip is no taller for holding it. */
.graph-motion-place {
  position: relative;
  flex: 0 0 auto;
  width: var(--size-control-height-compact);
  height: 24px;
}

/* The pointer target reaches past the glyph's square into the strip's air. */
.graph-motion-toggle {
  position: absolute;
  inset: calc((24px - var(--size-control-height-compact)) / 2) 0;

  &::after {
    content: '';
    position: absolute;
    inset: calc((var(--size-control-height-compact) - var(--size-control-target)) / 2);
  }
}
</style>
