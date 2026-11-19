<script setup lang="ts">
/**
 * The head of a window's step line (`StepLine`): the legend that names what the plot draws by how
 * each is drawn — the readings a heavier line in the chart's hue, or the neutral ink of a window
 * past its reset (`muted`), the pace a hairline in the quiet ink, and, where the plot shows one,
 * the forecast's corridor by its hatch (`hatch.css`), and now, while the plot marks it (`now`), a
 * hair upright as its line is drawn — so none is told by a hue alone, in
 * grayscale too; and, while a frame narrows the line, the button that takes it back to its whole
 * window, at the row's start, sent out as `whole`.
 *
 * One row as tall as a compact control whether the button stands there or not, so the plot never
 * moves when it comes or goes. The legend's keys wrap, each whole, rather than run past the plot.
 * The row is the line's `data-region="head"`; the button is `data-step="whole"`; the forecast's
 * key is `data-key="ahead"`, its swatch of the hatch `data-mark="hatch"`; now's key is
 * `data-key="now"`.
 */
import VButton from '@/shared/ui/VButton.vue'

defineProps<{
  /** Whether a frame narrows the line, so the button that takes it back stands. */
  framed: boolean
  /** The legend's names of the two lines and of the forecast's corridor. */
  legend: { line: string; ahead?: string; even?: string }
  /** The button's words: «Whole window». */
  whole: string
  /** Whether the forecast's corridor is drawn in the span shown, and so named. */
  ahead?: boolean
  /** Whether the pace is drawn, and so named. */
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
    <span
      class="step-legend"
      aria-hidden="true"
    >
      <span class="step-key"
        ><span
          class="step-swatch swatch-line"
          :class="{ 'swatch-muted': muted }"
        />{{ legend.line }}</span
      >
      <span
        v-if="even && legend.even"
        class="step-key"
        ><span class="step-swatch swatch-even" />{{ legend.even }}</span
      >
      <span
        v-if="ahead && legend.ahead"
        class="step-key"
        data-key="ahead"
        ><span
          class="step-swatch swatch-ahead hatched"
          data-mark="hatch"
        />{{ legend.ahead }}</span
      >
      <span
        v-if="now"
        class="step-key"
        data-key="now"
        ><span class="step-swatch swatch-now" />{{ now }}</span
      >
    </span>
  </div>
</template>

<style scoped src="@/shared/ui/hatch.css"></style>

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
  gap: var(--space-1) var(--space-3);
  justify-content: flex-end;
  margin-inline-start: auto;
}

.step-key {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  white-space: nowrap;
}

/* Each key drawn as its mark is: the readings heavier in the hue, or in the neutral ink past the
   reset, the pace a hairline, the forecast a small block of its hatch. */
.step-swatch {
  display: inline-block;
  inline-size: var(--space-3);
  border-radius: 999px;

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

  &.swatch-even {
    block-size: var(--space-hair);
    background: var(--color-text-tertiary);
  }

  /* Now as the plot marks it: a hair upright in the quiet ink, a moment and not a course. */
  &.swatch-now {
    inline-size: var(--space-hair);
    block-size: var(--space-3);
    background: var(--color-text-tertiary);
    border-radius: 0;
  }

  &.swatch-ahead {
    block-size: var(--space-2);
    background: var(--color-series-1);

    @media (forced-colors: active) {
      background: CanvasText;
      forced-color-adjust: none;
    }
  }

  @media (forced-colors: active) {
    background: CanvasText;
    forced-color-adjust: none;
  }
}
</style>
