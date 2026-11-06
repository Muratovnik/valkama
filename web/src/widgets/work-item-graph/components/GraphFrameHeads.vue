<script setup lang="ts">
/**
 * Every frame's header the next layout will place, drawn once more where nothing shows
 * it, to be measured before the field is laid out. A header is as tall as its lines,
 * and only the header can say how many lines its title and its counts break into: the
 * same component, the same fonts and the same width are the measure, so the room the
 * layout leaves is the room the header takes. Counting letters would have guessed at a
 * break the browser makes. A frame that folds is measured folded, with the line that says
 * what a fold hides: open, it keeps that line's room, so it is one header either way and
 * folding moves nothing.
 *
 * It measures again whenever the frames change and whenever a header's lines do, as when
 * the font the page waited for arrives; a layout runs only when a height changed.
 */
import { onMounted, useTemplateRef, watch } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import GraphFrameHead from '@/widgets/work-item-graph/components/GraphFrameHead.vue'
import type { MeasuredHeaders } from '@/widgets/work-item-graph/composables/useGraphProjection.ts'
import type { FrameProjection } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import { FOLDED_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

const { projection } = defineProps<{ projection: FrameProjection }>()
const emit = defineEmits<{ measured: [headers: MeasuredHeaders] }>()

const shelf = useTemplateRef<HTMLElement>('shelf')

function measure() {
  const heads = [...(shelf.value?.children ?? [])]
  const heights = new Map(
    projection.frames.map((frame, index) => [
      frame.id,
      heads[index]?.getBoundingClientRect().height ?? 0,
    ]),
  )
  emit('measured', { key: projection.key, heights })
}

// Once the headers of the frames now projected are drawn, and whenever one changes size.
onMounted(measure)
watch(() => projection, measure, { flush: 'post' })
useResizeObserver(shelf, measure)
</script>

<template>
  <div
    class="graph-frame-heads"
    aria-hidden="true"
    inert
  >
    <div
      ref="shelf"
      :style="{ width: `${FOLDED_WIDTH}px` }"
    >
      <GraphFrameHead
        v-for="frame in projection.frames"
        :key="frame.id"
        :frame="{ ...frame, folded: frame.foldable }"
        measure
      />
    </div>
  </div>
</template>

<style scoped>
/* Laid out and never seen: no size of its own, so nothing round it moves or scrolls. */
.graph-frame-heads {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
  visibility: hidden;
}
</style>
