<script setup lang="ts">
/**
 * How far the work under a frame has come, as one 3px edge across its header.
 *
 * The card's branch map draws a lane this way, and the frame borrows the
 * reading rather than the component: finished first, then review, work under
 * way, what is blocked and what is ahead, each part as long as the share of
 * the work it holds, in the hues the board and the chain give those groups. A
 * part too short to see is still drawn, as a dot. The words beside it in the
 * header say every number, so the edge carries nothing a reader would miss.
 *
 * A forced palette clears the hues. There the edge keeps its own system
 * colours: finished work filled, work begun drawn as a dashed run, and the rest
 * an empty outlined track.
 */
import { computed } from 'vue'

import type { FrameProgress } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'

const props = defineProps<{ progress: FrameProgress }>()

/** The parts in the order a lane runs, and the chain group whose hue each takes. */
const PARTS = [
  ['done', 'done'],
  ['review', 'review'],
  ['active', 'active'],
  ['blocked', 'blocked'],
  ['ahead', 'queued'],
] as const satisfies readonly (readonly [keyof FrameProgress, ChainGroup])[]

const parts = computed(() =>
  PARTS.filter(([part]) => props.progress[part] > 0).map(([part, group]) => ({
    part,
    group,
    share: props.progress[part],
  })),
)
</script>

<template>
  <span
    class="frame-progress"
    aria-hidden="true"
  >
    <i
      v-for="{ part, group, share } in parts"
      :key="part"
      class="frame-progress-part"
      :data-part="part"
      :data-tone="statePresentation('work-item-chain-group', group).tone"
      :style="{ flexGrow: share }"
    />
  </span>
</template>

<style scoped>
.frame-progress {
  display: flex;
  gap: var(--space-hair);
  width: 100%;
  height: 3px;
  background: var(--color-surface-recess);
  border-radius: var(--radius-status);
}

/* A part never shrinks below its own height, so one task among a hundred
   stays a dot rather than vanishing. */
.frame-progress-part {
  flex: 0 0 0;
  min-width: 3px;
  height: 100%;
  background: var(--color-text-tertiary);
  border-radius: var(--radius-status);

  &[data-tone='success'] {
    background: var(--color-success);
  }

  &[data-tone='warning'] {
    background: var(--color-warning);
  }

  &[data-tone='info'] {
    background: var(--color-info);
  }

  &[data-tone='danger'] {
    background: var(--color-danger);
  }
}

@media (forced-colors: active) {
  .frame-progress {
    color: CanvasText;
    background: Canvas;
    outline: 1px solid CanvasText;
    forced-color-adjust: none;
  }

  /* Every hue cleared — the tones above select by `data-tone`, so this does
     too — and only what is finished filled. */
  .frame-progress-part[data-tone] {
    background: transparent;

    &[data-part='done'] {
      background: CanvasText;
    }

    /* Begun and not finished: review and work under way, as a dashed run. */
    &:is([data-part='review'], [data-part='active']) {
      height: 0;
      border-top: 3px dashed currentcolor;
    }
  }
}
</style>
