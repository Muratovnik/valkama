<script setup lang="ts">
/**
 * A frame header's fold: the chevron that leads the reference line, one button with one
 * action. Its name, walk target, stop and listeners are the header's, and fall through.
 *
 * Its target is a square as large as DESIGN.md asks of an icon at the least scale the
 * field opens at to be read (`READABLE_ZOOM`, 0.75): 28px under a fine pointer, 44px under a
 * finger or on a phone's width. Sized in the field's units, the chevron's 36 by 26 were 27
 * by 19 pixels there. The square runs from the chevron's row up and back, over the header's
 * padding and out past the frame's corner into the air the layout leaves round a frame, and
 * stops short of the reference line beside it and the title under it, which are the epic's;
 * the header draws no taller for it. Its ring encloses the chevron and nothing else.
 *
 * Zoomed out past reading, the fold is the work under no epic's one button: its reach runs
 * across its whole band and the air above and below it (`foldIsTarget`), and the fold
 * itself stays the chevron's square, so the face and the ring it draws under the pointer
 * and the keyboard cover the chevron and none of the band's words or its edge. Stretched
 * over the band, with the reach above them, its face had covered all of them. The square
 * grows with the band's first row, which it leads, and its ring with the band (the header's
 * `--lead-row` and `--ring`): left at the reading size, far out the ring was 4px across and
 * under half a pixel wide beside words 12px tall.
 */
import { computed } from 'vue'

import VIcon from '@/shared/ui/VIcon.vue'

const { folded, overview = false } = defineProps<{
  folded: boolean
  overview?: boolean
}>()

const chevron = computed(() => (folded ? 'chevron-right' : 'chevron-down'))
</script>

<template>
  <button
    class="graph-frame-fold"
    type="button"
    :class="{ overview }"
  >
    <VIcon
      class="fold-glyph"
      :name="chevron"
      :size="16"
    />
  </button>
</template>

<style scoped>
/* As tall as the reference line it leads, in the header's first row. */
.graph-frame-fold {
  /* The scale the field opens at to be read: `READABLE_ZOOM` in `graphCamera.ts`. */
  --graph-reading-scale: 0.75;
  --fold-target: calc(var(--size-control-inline) / var(--graph-reading-scale));

  position: relative;
  z-index: 1;
  display: grid;
  grid-area: 1 / 1;
  place-items: center start;
  place-self: start start;
  min-width: 0;
  inline-size: 16px;
  block-size: 1lh;
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: inherit;
  font: var(--font-detail);
  background: transparent;
  border-radius: var(--radius-status);
  cursor: pointer;

  /* A pseudo-element of its own until the shared reach (`reach.css`) can size a target
     for a field the camera scales; that unification should take this one over. */
  &::before {
    content: '';
    position: absolute;
    inset-block-end: 0;
    inset-inline-end: calc(-1 * var(--space-half));
    inline-size: var(--fold-target);
    block-size: var(--fold-target);
  }

  &:hover {
    background: var(--color-surface-hover);
  }

  /* Inside the button's edge, so that it keeps off the title's line, which starts two units
     under the button; the chevron's drawing stands four units in from that edge. */
  &:focus-visible {
    background: var(--color-surface-hover);
    outline: solid var(--color-focus-ring);
    outline-width: var(--ring, 2px);
    outline-offset: calc(-1 * var(--ring-air, var(--space-half)));
  }

  @media (pointer: coarse) {
    --fold-target: calc(var(--size-control-target) / var(--graph-reading-scale));
  }
}

@container workspace (width <= 586px) {
  .graph-frame-fold {
    --fold-target: calc(var(--size-control-target) / var(--graph-reading-scale));
  }
}

/* Zoomed out the band is the button, and its target runs on into the air above and below
   it that the layout leaves empty: 36px, the least air between two frames. The reach is
   laid over the header (`GraphFrameHead` places it), and the fold keeps the chevron's square. */
.graph-frame-fold.overview {
  position: static;
  inline-size: var(--lead-row, 16px);
  block-size: var(--lead-row, 1lh);

  .fold-glyph {
    inline-size: 100%;
    block-size: 100%;
  }

  &::before {
    inset: -36px 0;
    inline-size: auto;
    block-size: auto;
  }
}
</style>
