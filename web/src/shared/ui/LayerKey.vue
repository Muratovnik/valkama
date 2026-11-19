<script setup lang="ts">
/**
 * The key of a layer a chart draws beside its data, in its legend (`ChartLegend`, `StepLineHead`):
 * a toggle that turns that layer off on every chart that draws it, and on again, by a press of
 * the pointer or Enter or Space (`chartLayersStore`). Only a layer has one — the mark of the
 * period compared with, the line of a change, a step line's pace and forecast; the data and the
 * marks that say how it is drawn or orient the plot keep keys that do not act.
 *
 * The key stays while its layer is off, so the reader can turn it back on, and says its state by
 * more than a tone: pressed while its layer shows (`aria-pressed`), and off, its words in the
 * tertiary ink struck through and its swatch faint. The host puts the swatch and the name in, as
 * its other keys are drawn, and reads how faint the swatch stands from
 * `--layer-key-swatch-opacity`, which this key declares; the ink and the strike reach the words
 * as text does. It is a line of the legend, not a control standing in it: no ground, no border
 * and the host's box and words, with the pointer's hand and its words underlined under it, as a
 * key that acts is. A press changes no box.
 *
 * What a reader of the page selects it by: the host's own hook on it, and `aria-pressed`.
 */
import { useChartLayer } from '@/shared/stores/chartLayersStore.ts'
import type { ChartLayer } from '@/shared/stores/chartLayersStore.ts'

const props = defineProps<{
  /** The layer it turns off and on. */
  layer: ChartLayer
}>()

const { shown, toggle } = useChartLayer(() => props.layer)
</script>

<template>
  <button
    class="layer-key"
    type="button"
    :class="{ 'layer-key-off': !shown }"
    :aria-pressed="shown"
    @click="toggle"
  >
    <slot />
  </button>
</template>

<style scoped>
.layer-key {
  --layer-key-swatch-opacity: 1;

  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: start;
  background: none;
  cursor: pointer;

  &:hover {
    text-decoration-line: underline;
  }
}

/* Off: the words in the tertiary ink and struck through, which a forced palette keeps, and the
   swatch faint. */
.layer-key.layer-key-off {
  --layer-key-swatch-opacity: 0.35;

  color: var(--color-text-tertiary);
  text-decoration-line: line-through;

  &:hover {
    text-decoration-line: line-through underline;
  }
}
</style>
