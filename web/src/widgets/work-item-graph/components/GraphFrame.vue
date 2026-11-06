<script setup lang="ts">
/**
 * An epic on the graph, as the frame round its work: or folded, its header
 * alone (`GraphFrameHead`), at the height the layout gave it.
 *
 * The frame is ground a step above the field and its cards a step above it, so
 * it is told by tone and draws no line. A folded frame says what it hides, in
 * words and as the sheets of a stack under it, counted by the epic and never by a
 * filter, at every zoom: «90 open inside», «90 inside» in the overview, and «+90»
 * where a word could no longer be read.
 *
 * Far out a header is a few pixels and the frame round it is what the hand finds, so
 * the ground of an open frame with an epic opens that epic too. It is a shortcut for
 * the pointer alone: the header's button is the same action for the keyboard, so no
 * new stop stands here, and a drag from the ground moves the field and opens nothing. A
 * finger's tap the browser moves from the ground to a card nearby is given back to the
 * ground (`useGraphGroundTap`).
 *
 * The work under no epic is a frame too, with no epic to open. A frame inside
 * a frame is a well cut into it, a step below. Zoomed out past reading, the
 * header keeps the epic's reference and its edge, grown with the field.
 */
import { computed } from 'vue'

import { Handle, Position } from '@vue-flow/core'

import GraphFrameHead from '@/widgets/work-item-graph/components/GraphFrameHead.vue'
import { NO_EPIC_FRAME } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedFrame } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

const {
  frame,
  far = false,
  overview = false,
  still = false,
  tabStop = null,
  working = 0,
} = defineProps<{
  frame: PlacedFrame
  /** Further still: the overview's words could not be read, so a header says less, larger. */
  far?: boolean
  /** The field is zoomed out past reading: the header is the reference and the edge. */
  overview?: boolean
  /** The field's motion does not run, so the working dots hold still. */
  still?: boolean
  /** The walk target that takes Tab, when it is one of this frame's. */
  tabStop?: string | null
  /**
   * How many items under it, nested frames' included, an agent is working on
   * now: for a folded frame the one sign of the work moving inside it.
   */
  working?: number
}>()
const emit = defineEmits<{
  blur: [target: string]
  focus: [target: string]
  open: [reference: string]
  toggle: [id: string]
}>()

/** The epic to open; the work under no epic has none. */
const epic = computed(() => (frame.id === NO_EPIC_FRAME ? null : frame.epic))
/** A frame inside a frame is a well cut into the one it stands in. */
const nested = computed(() => frame.parentId !== null)
/** Far out, the ground of an open frame opens its epic. A folded frame is all header. */
const groundOpens = computed(() => far && !frame.folded && Boolean(epic.value))

function onGround() {
  if (groundOpens.value && epic.value) emit('open', epic.value.reference)
}
</script>

<template>
  <!-- The header's button is this same action for the keyboard. -->
  <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
  <section
    class="graph-frame"
    :class="{
      far,
      'folded': frame.folded,
      'ground-opens': groundOpens,
      'holding': frame.folded && frame.foldable,
      nested,
      overview,
    }"
    :data-frame="frame.id"
    @click.self="onGround"
  >
    <Handle
      id="target"
      class="graph-frame-handle"
      type="target"
      :position="Position.Left"
      :connectable="false"
    />
    <Handle
      id="source"
      class="graph-frame-handle"
      type="source"
      :position="Position.Right"
      :connectable="false"
    />
    <GraphFrameHead
      :frame="frame"
      :far="far"
      :height="frame.header"
      :overview="overview"
      :still="still"
      :tab-stop="tabStop"
      :working="working"
      @blur="(target) => emit('blur', target)"
      @focus="(target) => emit('focus', target)"
      @open="(reference) => emit('open', reference)"
      @toggle="(id) => emit('toggle', id)"
    />
  </section>
</template>

<style scoped>
.graph-frame-handle {
  opacity: 0;
  pointer-events: none;
}

/* One step above the field, as the board's lane is; a frame inside a frame is
   a well, one step below the frame it is cut into. The cards stand a step
   above either. A press on the frame pans the field, as one behind it would. */
.graph-frame {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--color-surface);
  border-radius: var(--radius-card);

  &.nested {
    background: var(--color-surface-recess);
  }

  &.ground-opens {
    cursor: pointer;

    &:hover {
      background: var(--color-surface-hover);
    }
  }

  /* Folded over work: the sheets of a stack under it, a shape and no hue, inside
     the air the layout leaves below every frame. */
  &.holding {
    box-shadow:
      0 6px 0 -2px var(--color-surface-hover),
      0 12px 0 -4px var(--color-surface-recess);
  }

  &.holding.overview {
    box-shadow:
      0 16px 0 -4px var(--color-surface-hover),
      0 32px 0 -8px var(--color-surface-recess);
  }
}

/* A forced palette clears the ground, so the frame is outlined instead. */
@media (forced-colors: active) {
  .graph-frame {
    outline: 1px solid CanvasText;
  }
}
</style>
