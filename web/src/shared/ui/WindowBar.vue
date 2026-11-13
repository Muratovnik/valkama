<script setup lang="ts">
/**
 * How much of a window of a limit is spent: one thin bar the width of its host, filled as far as
 * the share spent, with a tick where steady use from the window's start would stand now, and the
 * value in words beside it. A meter, not a part of a whole: the track is the window, the fill
 * what is spent of it, and nothing else shares it, so no two windows or two accounts are ever
 * drawn on one bar or added.
 *
 * The fill is one hue on a darker step of the same hue; the tick is the text's ink and stands
 * over and under the bar, so it is told from the fill by its shape and its lightness, not by a
 * hue, and reads in grayscale. A window whose latest reading is no longer fresh (`held`) is
 * hatched, a mask that adds no colour, so it never reads as a live figure; a fresh 0 % draws the
 * empty track with its tick, and a window with no figure at all (`used` null) the track alone.
 * The words beside it say the value and its state, so none of the three is told by the drawing
 * alone. A forced palette draws the track's edge, the fill and the tick in its own inks, the
 * tick ringed in the ground's.
 *
 * It reads as one image whose words (`label`) say all of it: the value, the pace and the state.
 * Over 100 % the fill stops at the track's end and the words say how far past it the source
 * read. Presentational: nothing in it acts, nothing in it moves under the pointer, and its box is
 * the same whatever the figures, so new figures move nothing around it.
 */
import { computed } from 'vue'

const props = defineProps<{
  /** All the bar says, in words, for a reader who cannot see it. */
  label: string
  /** The share of the window spent, in percent; null draws the track alone. */
  used: number | null
  /** Thinner, for a tile: the bar alone, its words said by its host. */
  compact?: boolean
  /** Where steady use from the window's start would stand now, in percent: the pace tick. */
  even?: number | null
  /** Whether the latest reading is no longer fresh: the fill is hatched. */
  held?: boolean
  /** The state in words after the value, «fresh». */
  note?: string
  /** The value in words beside the bar, «62% used»; none draws the bar alone. */
  value?: string
}>()

const clamp = (percent: number) => Math.min(100, Math.max(0, percent))

/** The share as a mark for a test to read; a bar with no figure has none, not an empty one. */
const usedMark = computed(() => props.used ?? undefined)
const fill = computed(() =>
  props.used === null || props.used <= 0 ? null : { inlineSize: `${clamp(props.used)}%` },
)
const tick = computed(() =>
  props.even === null || props.even === undefined
    ? null
    : { insetInlineStart: `${clamp(props.even)}%` },
)
</script>

<template>
  <span
    class="window-bar"
    :class="{ 'window-compact': compact }"
  >
    <span
      class="window-track"
      role="img"
      :aria-label="label"
      :data-used="usedMark"
    >
      <span
        v-if="fill"
        class="window-fill"
        :class="{ 'window-held': held }"
        :style="fill"
      />
      <span
        v-if="tick"
        class="window-tick"
        :style="tick"
      />
    </span>
    <span
      v-if="value"
      class="window-words"
      aria-hidden="true"
    >
      <span class="window-value">{{ value }}</span>
      <span
        v-if="note"
        class="window-note"
        >{{ note }}</span
      >
    </span>
  </span>
</template>

<style scoped>
/* The bar takes what its words leave it; the words keep to one line beside it. */
.window-bar {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  min-inline-size: 0;
}

/* The window: a darker step of the fill's own hue, rounded at both ends, with room over and
   under it for the tick. */
.window-track {
  position: relative;
  flex: 1 1 auto;
  min-inline-size: var(--space-12);
  block-size: var(--space-2);
  margin-block: var(--space-1);
  background: color-mix(in srgb, var(--color-series-1) 30%, var(--color-canvas));
  border-radius: 999px;

  @media (forced-colors: active) {
    background: Canvas;
    outline: 1px solid CanvasText;
    forced-color-adjust: none;
  }
}

.window-fill {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  background: var(--color-series-1);
  border-radius: 999px;

  @media (forced-colors: active) {
    background: CanvasText;
    forced-color-adjust: none;
  }
}

/* Not fresh: the same hue hatched, as a period still running is, so it is told without a hue. */
.window-held {
  mask-image: repeating-linear-gradient(
    135deg,
    black 0 var(--space-half),
    rgb(0 0 0 / 35%) var(--space-half) var(--space-1)
  );
}

/* Where steady use would stand: the text's ink, taller than the bar it crosses. */
.window-tick {
  position: absolute;
  inset-block: calc(-1 * var(--space-1));
  inline-size: var(--space-half);
  margin-inline-start: calc(-1 * var(--space-hair));
  background: var(--color-text);
  border-radius: 999px;

  @media (forced-colors: active) {
    background: CanvasText;
    outline: var(--space-hair) solid Canvas;
    forced-color-adjust: none;
  }
}

.window-words {
  display: flex;
  flex: none;
  gap: var(--space-2);
  align-items: baseline;
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.window-value {
  color: var(--color-text);
}

.window-note {
  color: var(--color-text-muted);
}

/* In a tile: a thinner bar on the tile's own line, its words said by the tile. */
.window-compact {
  & .window-track {
    min-inline-size: 0;
    block-size: var(--space-1);
  }

  & .window-tick {
    inset-block: calc(-1 * var(--space-half));
  }
}
</style>
