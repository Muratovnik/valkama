<script setup lang="ts">
/**
 * How much of a window of a limit is spent: one thin bar the width of its host, filled as far as
 * the share spent, with a tick where steady use from the window's start would stand now, and the
 * value in words beside it. A meter, not a part of a whole: the track is the window, the fill
 * what is spent of it, and nothing else shares it, so no two windows or two accounts are ever
 * drawn on one bar or added.
 *
 * The share spent is a final figure and always a solid fill, one hue on a darker step of the same
 * hue, whether its latest reading is fresh or not: a reading no longer fresh says its age in the
 * words beside the bar, never by the drawing. Past it the forecast continues the fill as a hatched
 * tail (`hatch.css`, over the fill's own hue) to where the window is forecast to stand at its reset, a surface gap
 * of the track after the fill. A forecast of a range runs to its high end, its faster pace's, and
 * the same gap splits it where its low end stands, its slower pace's: the hatch before the gap is
 * what both paces spend, the whole tail what the faster does. One hatch and one gap, the device
 * that already parts touching marks, so the bar adds no second meaning of a hatch; its host's words
 * say both ends and name the hatch. A forecast of one value, a window already at its end and one
 * with no forecast draw one tail, none and none. The tick is the text's ink and stands over and
 * under the bar, so it is told from the fill and the tail by its shape and its lightness, not by
 * a hue, and reads in grayscale. A fresh 0 % draws the empty track with its tick and any tail from
 * the track's start, and a window with no figure at all (`used` null) the track alone. A forced
 * palette draws the track's edge, the fill, the tail's stripes and the tick in its own inks, the
 * tick ringed in the ground's.
 *
 * It reads as one image whose words (`label`) say all of it: the value, the pace, the state and
 * the forecast. Over 100 % the fill stops at the track's end, no tail follows, and the words say
 * how far past it the source read. Presentational: nothing in it acts, nothing in it moves under
 * the pointer, and its box is the same whatever the figures, so new figures move nothing around
 * it.
 *
 * What a reader of the page selects it by: its marks are `data-mark` — the `track`, which is its
 * picture (`role="img"`, named by `label`, `data-used` the share spent), the `fill`, each part
 * of the tail `ahead` (`data-part`, `near` and `far`) and the `tick`; its words beside it are
 * `data-words`, `value` and `note`.
 */
import { computed } from 'vue'

import type { WindowAhead } from '@/shared/ui/windowGeometry.ts'

const props = defineProps<{
  /** All the bar says, in words, for a reader who cannot see it. */
  label: string
  /** The share of the window spent, in percent; null draws the track alone. */
  used: number | null
  /** Thinner, for a tile: the bar alone, its words said by its host. */
  compact?: boolean
  /** Where steady use from the window's start would stand now, in percent: the pace tick. */
  even?: number | null
  /** Where the forecast says the window stands at its reset: the hatched tail; none draws none. */
  forecast?: WindowAhead | null
  /** The state in words after the value, «fresh», «silent 3 h». */
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

/**
 * The tail's parts, from the share spent to the low end and from there to the high end, or one
 * part where the two ends stand together or the low end at the share spent. A part after a mark
 * starts a surface gap (`--space-half`) past it, so where the fill ends and the low end stands
 * reads at a glance.
 */
const ahead = computed(() => {
  const { used, forecast } = props
  if (used === null || !forecast || used >= 100) return []
  const start = clamp(used)
  const high = clamp(forecast.high)
  const low = Math.min(high, Math.max(start, clamp(forecast.low)))
  if (high <= start) return []
  const ends = low > start && low < high ? [start, low, high] : [start, high]
  return ends.slice(1).map((to, index) => {
    const from = ends[index] ?? start
    return {
      key: index === 0 ? 'near' : 'far',
      start: from <= 0,
      end: index === ends.length - 2,
      from,
      to,
    }
  })
})

/** Where a part of the tail stands along the track, a surface gap past a mark before it. */
const aheadStyle = ({ from, to }: { from: number; to: number }) => ({
  insetInlineStart: from > 0 ? `calc(${from}% + var(--space-half))` : '0%',
  inlineSize: from > 0 ? `calc(${to - from}% - var(--space-half))` : `${to}%`,
})
</script>

<template>
  <span
    class="window-bar"
    :class="{ 'window-compact': compact }"
  >
    <span
      class="window-track"
      role="img"
      data-mark="track"
      :aria-label="label"
      :data-used="usedMark"
    >
      <span
        v-if="fill"
        class="window-fill"
        data-mark="fill"
        :style="fill"
      />
      <span
        v-for="part in ahead"
        :key="part.key"
        class="window-ahead hatched"
        data-mark="ahead"
        :class="{ 'window-ahead-start': part.start, 'window-ahead-end': part.end }"
        :data-part="part.key"
        :style="aheadStyle(part)"
      />
      <span
        v-if="tick"
        class="window-tick"
        data-mark="tick"
        :style="tick"
      />
    </span>
    <span
      v-if="value"
      class="window-words"
      aria-hidden="true"
    >
      <span
        class="window-value"
        data-words="value"
        >{{ value }}</span
      >
      <span
        v-if="note"
        class="window-note"
        data-words="note"
        >{{ note }}</span
      >
    </span>
  </span>
</template>

<style scoped src="@/shared/ui/hatch.css"></style>

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

/* The forecast past the fill: the fill's own hue under the hatch (`hatch.css`), square where it
   follows the fill or the part before it and at the gap it leaves, rounded at the end it reaches,
   as the fill's own end is; a forced palette's ink, as the fill's. */
.window-ahead {
  position: absolute;
  inset-block: 0;
  background: var(--color-series-1);

  @media (forced-colors: active) {
    background: CanvasText;
    forced-color-adjust: none;
  }
}

/* From the track's start, where nothing is spent yet, it is rounded there as the track is. */
.window-ahead-start {
  border-start-start-radius: 999px;
  border-end-start-radius: 999px;
}

.window-ahead-end {
  border-start-end-radius: 999px;
  border-end-end-radius: 999px;
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
