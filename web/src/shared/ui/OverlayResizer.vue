<script setup lang="ts">
/**
 * The edge a surface or a pane is resized by, built the way ARIA asks of a window
 * splitter: role, orientation, value range, tabindex and its own key handler. Its value is
 * the width of what it sizes. What the keys and the pointer do is `useDrawerWidth`'s.
 * Focus on an open passes over it, by `data-overlay-resizer`: it is not what a surface is
 * opened for.
 *
 * With what it sizes folded away it is all that is left of it, so it stands as a strip with
 * that thing's name on it, says it is folded in its value text, and a press brings it back:
 * a 12px line with nothing on it was a pane gone without a trace. The name it shows is then
 * its name, as a window splitter is named by the pane it sizes, so a voice command that
 * says what is on the strip finds it; what it sizes moves to its description.
 */
import { computed, useId } from 'vue'

import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    label: string
    maximum: number
    minimum: number
    now: number
    /**
     * Where it stands against what it sizes: across the left edge of a drawer; just inside a
     * pane, which leaves the scrollbar of the pane before it free; in the gap before a
     * dialog's pane; inside the left edge of the window's end, for a pane folded away; and
     * across the right edge of the rail, which is sized by its end.
     */
    at?: 'across' | 'inside' | 'gap' | 'end' | 'after'
    /** What it sizes, when that has an id to name. */
    controls?: string
    /** What it sizes is folded away: that thing's name, and the words for its state. */
    folded?: { name: string; state: string }
  }>(),
  { at: 'across', controls: undefined, folded: undefined },
)
const emit = defineEmits<{ keydown: [event: KeyboardEvent]; pointerdown: [event: PointerEvent] }>()

const descriptionId = `overlay-resizer-purpose-${useId()}`
/** Folded, the words it shows name it, and what it does describes it. */
const name = computed(() => props.folded?.name ?? props.label)
const describedBy = computed(() => (props.folded ? descriptionId : undefined))
</script>

<template>
  <!-- The rule does not count separator among the interactive roles. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <div
    class="overlay-resizer"
    role="separator"
    aria-orientation="vertical"
    tabindex="0"
    :class="[`at-${at}`, { 'is-folded': folded }]"
    :aria-label="name"
    :aria-describedby="describedBy"
    :aria-valuetext="folded?.state"
    :title="folded?.state"
    :aria-controls="controls"
    :aria-valuemin="minimum"
    :aria-valuemax="maximum"
    :aria-valuenow="now"
    data-overlay-resizer
    @pointerdown="emit('pointerdown', $event)"
    @keydown="emit('keydown', $event)"
  >
    <template v-if="folded">
      <span
        class="overlay-resizer-folded"
        aria-hidden="true"
      >
        <VIcon
          name="chevron-left"
          :size="16"
        />
        <span class="overlay-resizer-name">{{ folded.name }}</span>
      </span>
      <span
        :id="descriptionId"
        hidden
        >{{ label }}</span
      >
    </template>
    <span
      v-else
      class="overlay-resizer-grip"
    />
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

  &.at-after {
    inset-inline: auto -6px;
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: -2px;
  }

  /* Folded, it fills what is left of what it sized, as a tab of its own tone. A forced
     palette takes the tone and keeps the chevron and the name, which say the same. */
  &.is-folded {
    inset: 0;
    width: auto;
    color: var(--color-text-muted);
    background: var(--color-surface-muted);
    cursor: pointer;

    &:hover {
      color: var(--color-text);
      background: var(--color-surface-active);
    }
  }
}

.overlay-resizer-folded {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: center;
  align-self: stretch;
  min-height: 0;
  padding-block: var(--space-4);
}

/* Read from the bottom up, as a spine is; cut short rather than run off the window. */
.overlay-resizer-name {
  min-height: 0;
  font: var(--font-note);
  white-space: nowrap;
  writing-mode: sideways-lr;
  overflow: hidden;
  text-overflow: ellipsis;
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
