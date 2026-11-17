<script setup lang="ts">
/**
 * The head of a window's step line (`StepLine`): the switch of the span shown at its start, and
 * over its end the legend that names its two lines by how each is drawn — the readings heavier in
 * the chart's hue, the pace a hairline in the quiet ink — so neither is told by a hue alone, in
 * grayscale too.
 *
 * One row as tall as the switch whether it stands there or not, so the plot never moves when it
 * comes or goes. The switch stands inside the row (`fit`): in a phone's column its words wrap
 * rather than run past the window's edge. A span chosen is sent out as `choose`; the line owns
 * which span it shows (`useStepSpan`).
 */
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import type { StepScope } from '@/shared/ui/useStepSpan.ts'

defineProps<{
  /** The span the switch says is shown: none while a frame narrows the line. */
  chosen: StepScope | null
  /** The legend's names of the two lines. */
  legend: { line: string; even?: string }
  /** The spans the switch offers; no switch stands where `switched` is false. */
  options: readonly { label: string; value: StepScope }[]
  switched: boolean
  /** The switch's name. */
  views: string
  /** Whether the pace is drawn, and so named. */
  even?: boolean
}>()

const emit = defineEmits<{ choose: [scope: StepScope] }>()
</script>

<template>
  <div class="step-head">
    <SegmentedControl
      v-if="switched"
      class="step-views"
      size="compact"
      :label="views"
      :model-value="chosen"
      :options="options"
      fit
      @update:model-value="(scope: StepScope) => emit('choose', scope)"
    />
    <span
      class="step-legend"
      aria-hidden="true"
    >
      <span class="step-key"><span class="step-swatch swatch-line" />{{ legend.line }}</span>
      <span
        v-if="even && legend.even"
        class="step-key"
        ><span class="step-swatch swatch-even" />{{ legend.even }}</span
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
  flex: none;
  gap: var(--space-3);
  margin-inline-start: auto;
  white-space: nowrap;
}

.step-key {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
}

/* Each key drawn as its line is: the readings heavier in the hue, the pace a hairline. */
.step-swatch {
  display: inline-block;
  inline-size: var(--space-3);
  border-radius: 999px;

  &.swatch-line {
    block-size: var(--space-half);
    background: var(--color-series-1);
  }

  &.swatch-even {
    block-size: var(--space-hair);
    background: var(--color-text-tertiary);
  }

  @media (forced-colors: active) {
    background: CanvasText;
    forced-color-adjust: none;
  }
}
</style>
