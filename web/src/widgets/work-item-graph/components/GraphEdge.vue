<script setup lang="ts">
/**
 * One drawn line, along the route the layout gave it.
 *
 * A line live work runs along carries a comet while the field's motion runs:
 * one short bright stroke in the hue of work under way, running from the
 * line's start to its arrow over the line it rides, solid or dashed as that is.
 * It has one length and one speed on every line (`cometRun`), so how long it
 * takes depends on the line, which is measured once and again only when its path
 * changes, and only while it carries a comet. It is not Vue Flow's running dash,
 * which would run over the whole line and say «context» with the dash this field
 * already spends on it. Paused or under reduced motion there is no comet at all —
 * a frozen one would be a dot stuck at the arrow — and the line itself is held
 * wider instead.
 */
import { computed, ref, useTemplateRef, watch } from 'vue'

import { BaseEdge } from '@vue-flow/core'
import type { EdgeProps } from '@vue-flow/core'
import type { ElkPoint } from 'elkjs/lib/elk-api'

import type { GraphMotion } from '@/widgets/work-item-graph/composables/useGraphMotion.ts'
import { cometRun } from '@/widgets/work-item-graph/utils/graphComet.ts'

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
const cometPath = useTemplateRef<SVGPathElement>('comet-path')
const lineLength = ref(0)
watch([path, cometPath], () => (lineLength.value = cometPath.value?.getTotalLength() ?? 0), {
  flush: 'post',
})
const cometStyle = computed(() => {
  const run = cometRun(lineLength.value)
  return {
    '--comet-dash': `${run.dash} ${run.gap}`,
    '--comet-from': run.from,
    '--comet-to': run.to,
    '--comet-pass': `${run.seconds}s`,
  }
})
</script>

<template>
  <BaseEdge
    :id="id"
    :path="path"
    :marker-end="markerEnd"
  />
  <path
    v-if="comet"
    ref="comet-path"
    class="graph-comet"
    :style="cometStyle"
    :d="path"
  />
</template>

<style scoped>
/* One length and one speed in the field's units, so a longer line takes longer:
   `cometRun` says what each of these is for this line. */
.graph-comet {
  --comet-dash: 0 1;
  --comet-from: 0;
  --comet-to: 0;
  --comet-pass: 1s;

  fill: none;
  stroke: var(--color-info);
  stroke-dasharray: var(--comet-dash);
  stroke-linecap: round;
  stroke-width: 2.4;
  animation: graph-comet var(--comet-pass) linear infinite;
  pointer-events: none;
}

@keyframes graph-comet {
  from {
    stroke-dashoffset: var(--comet-from);
  }

  to {
    stroke-dashoffset: var(--comet-to);
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
