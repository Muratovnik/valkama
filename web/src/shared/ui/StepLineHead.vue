<script setup lang="ts">
/**
 * The head of a window's step line (`StepLine`): the legend that names what the plot draws by how
 * each is drawn — the readings a heavier line in the chart's hue, or the neutral ink of a window
 * past its reset (`muted`), the windows before the current one in that ink where the line holds
 * them (`earlier`), the pace a hairline in the quiet ink, and, where the plot shows one, the
 * forecast by a short dashed line, as the plot draws it, and now, while the plot marks it (`now`),
 * a hair upright as its line is drawn — so none is told by a hue alone, in grayscale too; and,
 * while a frame narrows the line, the button that takes it back to its whole span, at the row's
 * start, sent out as `whole`.
 *
 * The pace and the forecast are layers beside the readings, and their keys are toggles: a press,
 * by the pointer or by Enter or Space, turns that layer off on every chart that draws it and the
 * next turns it on again, a choice kept on this computer (`LayerKey`, `chartLayersStore`). The
 * key stays, pressed while its layer shows (`aria-pressed`), and off, its swatch faint and its
 * name in the tertiary ink struck through, so its state is more than a tone and it is there to
 * turn the layer back on. The readings' key and now's do not act: the readings are the data,
 * which always shows, and now orients the plot. Those two are left to the line's name, which says
 * what they do (`aria-hidden`), while a toggle is a button of its own; each key is 24 pixels
 * tall, the target WCAG 2.5.8 asks, and the wrapped lines of keys stand on that step with no gap
 * between them.
 *
 * One row as tall as a compact control whether the button stands there or not, so the plot never
 * moves when it comes or goes. The legend's keys wrap, each whole, rather than run past the plot.
 * The row is the line's `data-region="head"`; the button is `data-step="whole"`; the forecast's
 * key is `data-key="ahead"`, its swatch of a dashed line `data-mark="dash"`; the pace's key is
 * `data-key="even"`, now's `data-key="now"` and the earlier windows' `data-key="earlier"`, each
 * swatch the key's first child.
 */
import LayerKey from '@/shared/ui/LayerKey.vue'
import VButton from '@/shared/ui/VButton.vue'

defineProps<{
  /** Whether a frame narrows the line, so the button that takes it back stands. */
  framed: boolean
  /** The legend's names of the two lines, of the forecast and of the windows before the current. */
  legend: { line: string; ahead?: string; earlier?: string; even?: string }
  /** The button's words: «Whole span». */
  whole: string
  /** Whether the span shown has the forecast, drawn or turned off, and so names it. */
  ahead?: boolean
  /** Whether the span shown draws windows before the current one, and so names them. */
  earlier?: boolean
  /** Whether the window has a pace, drawn or turned off, and so names it. */
  even?: boolean
  /** Whether the readings are drawn in the neutral ink of a window past its reset. */
  muted?: boolean
  /** The words of now's key while the plot marks now: «Now»; none while it does not. */
  now?: string
}>()

const emit = defineEmits<{ whole: [] }>()
</script>

<template>
  <div
    class="step-head"
    data-region="head"
  >
    <VButton
      v-if="framed"
      size="compact"
      data-step="whole"
      @click="emit('whole')"
    >
      {{ whole }}
    </VButton>
    <span class="step-legend">
      <span
        class="step-key"
        aria-hidden="true"
        ><span
          class="step-swatch swatch-line"
          :class="{ 'swatch-muted': muted }"
        />{{ legend.line }}</span
      >
      <span
        v-if="earlier && legend.earlier"
        class="step-key"
        aria-hidden="true"
        data-key="earlier"
        ><span class="step-swatch swatch-line swatch-muted" />{{ legend.earlier }}</span
      >
      <LayerKey
        v-if="even && legend.even"
        class="step-key"
        layer="even"
        data-key="even"
      >
        <span
          class="step-swatch swatch-even"
          aria-hidden="true"
        />{{ legend.even }}
      </LayerKey>
      <LayerKey
        v-if="ahead && legend.ahead"
        class="step-key"
        layer="ahead"
        data-key="ahead"
      >
        <span
          class="step-swatch swatch-ahead"
          aria-hidden="true"
          data-mark="dash"
        />{{ legend.ahead }}
      </LayerKey>
      <span
        v-if="now"
        class="step-key"
        aria-hidden="true"
        data-key="now"
        ><span class="step-swatch swatch-now" />{{ now }}</span
      >
    </span>
  </div>
</template>

<style scoped>
.step-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  min-inline-size: 0;
  min-block-size: var(--size-control-height-compact);
  color: var(--color-text-muted);
}

.step-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-3);
  justify-content: flex-end;
  margin-inline-start: auto;
}

.step-key {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-block-size: var(--space-6);
  white-space: nowrap;
}

/* Each key drawn as its mark is: the readings heavier in the hue, or in the neutral ink past the
   reset, the pace a hairline, the forecast a short dashed line of the readings' width. */
.step-swatch {
  display: inline-block;
  inline-size: var(--space-3);
  border-radius: 999px;
  opacity: var(--layer-key-swatch-opacity, 1);

  &.swatch-line {
    block-size: var(--space-half);
    background: var(--color-series-1);
  }

  &.swatch-muted {
    background: var(--color-text-tertiary);

    @media (forced-colors: active) {
      background: GrayText;
    }
  }

  /* The pace's key, and now's below, in a forced palette's inactive ink, as the plot draws their
     lines: the swatch keeps its own colours there, so each says its ink. */
  &.swatch-even {
    block-size: var(--space-hair);
    background: var(--color-text-tertiary);

    @media (forced-colors: active) {
      background: GrayText;
    }
  }

  /* Now as the plot marks it: a hair upright in the quiet ink, a moment and not a course. */
  &.swatch-now {
    inline-size: var(--space-hair);
    block-size: var(--space-3);
    background: var(--color-text-tertiary);
    border-radius: 0;

    @media (forced-colors: active) {
      background: GrayText;
    }
  }

  /* Two dashes and the gap between them, as the plot dashes the forecast's line: a mask over the
     line's paint, as the hatch is one, so a forced palette's ink takes it alike. */
  &.swatch-ahead {
    inline-size: calc(var(--space-3) + var(--space-half));
    block-size: var(--space-half);
    background: var(--color-series-1);
    border-radius: 0;
    mask-image: repeating-linear-gradient(to right, black 0 5px, transparent 5px 9px);

    @media (forced-colors: active) {
      background: CanvasText;
    }
  }

  @media (forced-colors: active) {
    background: CanvasText;
    forced-color-adjust: none;
  }
}
</style>
