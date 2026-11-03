<script setup lang="ts">
/**
 * The edge a surface or a pane is resized by, built the way ARIA asks of a window
 * splitter: role, orientation, value range, tabindex and its own key handler. Its value is
 * the width of what it sizes. What the keys and the pointer do is `useDrawerWidth`'s.
 * Focus on an open passes over it, by `data-overlay-resizer`: it is not what a surface is
 * opened for.
 */
withDefaults(
  defineProps<{
    label: string
    maximum: number
    minimum: number
    now: number
    /**
     * Where it stands against what it sizes: across the left edge of a drawer; just inside a
     * pane, which leaves the scrollbar of the pane before it free; in the gap before a
     * dialog's pane; and inside the left edge of the window's end, for a pane folded away.
     */
    at?: 'across' | 'inside' | 'gap' | 'end'
    /** What it sizes, when that has an id to name. */
    controls?: string
  }>(),
  { at: 'across', controls: undefined },
)

const emit = defineEmits<{ keydown: [event: KeyboardEvent]; pointerdown: [event: PointerEvent] }>()
</script>

<template>
  <!-- The rule does not count separator among the interactive roles. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <div
    class="overlay-resizer"
    role="separator"
    aria-orientation="vertical"
    tabindex="0"
    :class="`at-${at}`"
    :aria-label="label"
    :aria-controls="controls"
    :aria-valuemin="minimum"
    :aria-valuemax="maximum"
    :aria-valuenow="now"
    data-overlay-resizer
    @pointerdown="emit('pointerdown', $event)"
    @keydown="emit('keydown', $event)"
  >
    <span class="overlay-resizer-grip" />
  </div>
</template>

<style scoped>
.overlay-resizer {
  position: absolute;
  inset: 0 auto 0 -6px;
  z-index: 4;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 12px;
  cursor: col-resize;

  /* The line it thickens is the pane's own edge, so the grip stands on that line. */
  &.at-inside {
    inset-inline-start: -1px;
    justify-content: flex-start;
  }

  &.at-gap {
    inset-inline-start: calc(-1 * var(--space-3));
  }

  &.at-end {
    inset-inline-start: -12px;
    justify-content: flex-end;
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }
}

/* A forced palette takes a background away, and with it the only thing that says the edge
   is there, so the grip names a system colour itself there. */
.overlay-resizer-grip {
  width: 1px;
  height: 56px;
  background: var(--color-rule-strong);

  .overlay-resizer:is(:hover, :focus-visible) & {
    width: 2px;
    background: var(--color-focus-ring);
  }

  @media (forced-colors: active) {
    width: 2px;
    background: CanvasText;
    forced-color-adjust: none;

    .overlay-resizer:is(:hover, :focus-visible) & {
      background: Highlight;
    }
  }
}
</style>
