<script setup lang="ts">
/**
 * One small chart of the span per value, all on one scale whose top is said once over them, so
 * a short column means less in every chart alike: each a name on one line (cut with an ellipsis,
 * whole in its hint), its figure for the whole span, and a column per period. The categories come
 * first, in the order given, then the folded tail; work with nothing to file it under and work
 * nobody can place close the chart in a list of their own set apart by air, by name and figure,
 * with no chart and no part in the scale (`placeMultiples`). `SmallMultiplesTable` is the same
 * numbers as a table.
 *
 * A column is drawn in its value's hue (`seriesFill.css`), the one the value has wherever the page
 * draws it, and a name always stands beside it: a hue never speaks alone. Presentational: nothing
 * in it acts, so it is no stop for the keyboard.
 */
import { computed } from 'vue'

import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import { placeMultiples } from '@/shared/ui/multiplesGeometry.ts'
import type { MultiplesWords, SmallMultiple } from '@/shared/ui/multiplesGeometry.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  /** What the charts show, as their accessible name: "Agent time per day of each value". */
  label: string
  multiples: readonly SmallMultiple[]
  words: MultiplesWords
  /** A value as the reader reads it, for the scale's top. */
  formatValue: (value: number) => string
}>()

const placed = computed(() => placeMultiples(props.multiples))
const top = computed(() => props.formatValue(placed.value.top))

const columnStyle = (height: number) => ({ blockSize: `${height * 100}%` })
</script>

<template>
  <figure
    class="small-multiples"
    :aria-label="label"
  >
    <DataEmptyState
      v-if="!multiples.length"
      :title="words.empty"
      :description="words.emptyDescription"
      compact
    />
    <template v-else>
      <p class="multiples-scale">{{ words.scale }} {{ top }}</p>
      <ul class="multiples-grid">
        <li
          v-for="one in placed.shared"
          :key="one.key"
          class="multiple"
          :data-key="one.key"
          :data-kind="one.kind"
        >
          <span
            v-tooltip.clipped="one.label"
            class="multiple-name one-line"
            >{{ one.label }}</span
          >
          <span class="multiple-value">{{ one.valueText }}</span>
          <span
            class="multiple-plot"
            aria-hidden="true"
          >
            <span
              v-for="(height, index) in one.heights"
              :key="index"
              class="multiple-period"
            >
              <span
                v-if="height"
                class="multiple-column series-fill"
                :data-slot="one.slot ?? 'other'"
                :style="columnStyle(height)"
              />
            </span>
          </span>
        </li>
      </ul>
      <ul
        v-if="placed.apart.length"
        class="multiples-apart"
      >
        <li
          v-for="one in placed.apart"
          :key="one.key"
          class="multiple-rest"
          :data-key="one.key"
          :data-kind="one.kind"
        >
          <span
            v-tooltip.clipped="one.label"
            class="multiple-name one-line"
            >{{ one.label }}</span
          >
          <span class="multiple-value">{{ one.valueText }}</span>
        </li>
      </ul>
    </template>
  </figure>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped>
.small-multiples {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  margin: 0;
}

.multiples-scale {
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
}

/* As many charts to a row as keep each one wide enough for a name and its days. */
.multiples-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: var(--space-4) var(--space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.multiple {
  display: grid;
  grid-template-rows: auto auto var(--space-12);
  gap: var(--space-1);
  min-width: 0;
}

.multiple-name {
  color: var(--color-text);
  font: var(--font-detail);
}

.multiple-value {
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* A column per period standing on a floor, the full height being the shared scale's top. */
.multiple-plot {
  display: flex;
  gap: var(--space-half);
  align-items: flex-end;
  min-width: 0;
  border-block-end: 1px solid var(--color-rule-strong);
}

.multiple-period {
  display: flex;
  flex: 1 1 0;
  align-items: flex-end;
  min-width: 0;
  block-size: 100%;
}

.multiple-column {
  display: block;
  inline-size: 100%;
  min-block-size: 1px;
  border-start-start-radius: calc(var(--radius-status) - var(--space-1));
  border-start-end-radius: calc(var(--radius-status) - var(--space-1));
}

/* What is no value of the dimension reads as a note on the charts, as in a ranked chart: apart
   by air, in the quiet ink, slanted, by its figure alone. */
.multiples-apart {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: var(--space-3) 0 0;
  list-style: none;
}

.multiple-rest {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3);

  & .multiple-name {
    color: var(--color-text-tertiary);
    font-style: italic;
  }
}
</style>
