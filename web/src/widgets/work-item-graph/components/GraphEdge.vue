<script setup lang="ts">
/**
 * One drawn line, along the route the layout gave it.
 *
 * A line live work runs along carries a comet while the field's motion runs:
 * one short bright stroke in the hue of work under way, running from the
 * line's start to its arrow every 2.4s over the line it rides, solid or dashed
 * as that is. It is not Vue Flow's running dash, which would run over the
 * whole line and say «context» with the dash this field already spends on it.
 * Paused or under reduced motion there is no comet at all — a frozen one would
 * be a dot stuck at the arrow — and the line itself is held wider instead.
 */
import { computed } from 'vue'

import { BaseEdge } from '@vue-flow/core'
import type { EdgeProps } from '@vue-flow/core'
import type { ElkPoint } from 'elkjs/lib/elk-api'

import type { GraphMotion } from '@/widgets/work-item-graph/composables/useGraphMotion.ts'

import type { PlanningEdge } from '@/shared/api/planningModel.ts'

const props = defineProps<
  Pick<
    EdgeProps<{ kind: PlanningEdge['kind']; points: ElkPoint[]; live?: boolean }>,
    'id' | 'data' | 'markerEnd'
  > & { motion?: GraphMotion }
>()
const path = computed(
  () =>
    props.data?.points
      .map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`)
      .join(' ') ?? '',
)
const comet = computed(() => Boolean(props.data?.live) && props.motion === 'running')
</script>

<template>
  <BaseEdge
    :id="id"
    :path="path"
    :marker-end="markerEnd"
  />
  <path
    v-if="comet"
    class="graph-comet"
    pathLength="100"
    :d="path"
  />
</template>

<style scoped>
/* A sixteenth of the line, from where it starts to where its arrow is: the
   path is measured as 100 whatever its length, so every comet takes as long. */
.graph-comet {
  fill: none;
  stroke: var(--color-info);
  stroke-dasharray: 6 94;
  stroke-linecap: round;
  stroke-width: 2.4;
  animation: graph-comet 2.4s linear infinite;
  pointer-events: none;
}

@keyframes graph-comet {
  from {
    stroke-dashoffset: 6;
  }

  to {
    stroke-dashoffset: -94;
  }
}

@media (forced-colors: active) {
  .graph-comet {
    stroke: Highlight;
    stroke-width: 3;
    forced-color-adjust: none;
  }
}
</style>
