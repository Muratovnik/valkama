<script setup lang="ts">
/**
 * A hint with a structure (`TooltipBody` in `tooltipAnchors.ts`), drawn as one grid inside the
 * window's one hint (`TooltipHost`): what it is about, semibold, with its figure; quiet rows in
 * the quiet ink; a main row for each part, its series' swatch before its name as the legend draws
 * it; and notes under the rows, each a line of its own across the whole hint. Figures and shares
 * stand in columns of their own, at their right edge in figures of one width, and never wrap; a
 * name wraps where the hint has no room for it.
 *
 * Every row is a subgrid of the one grid, so a row's band spans the whole hint and its cells keep
 * the grid's columns. The row of the part the pointer or the keyboard stands on (`current`) is
 * marked by a band and a semibold name, and the width of every name that can be marked is held as
 * wide as it is semibold, so marking one moves nothing and the hint is not measured again.
 *
 * The host estimates the hint's width before it is drawn from the same tokens this grid is laid
 * out by (`bodyWidth` in `TooltipHost`): the swatch, the room between columns, a row's inset.
 */
import { computed } from 'vue'

import type { TooltipBody, TooltipRow } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  body: TooltipBody
  /** The key of the main row marked as the one the pointer or the keyboard stands on. */
  current?: string | null
}>()

const swatches = computed(() => props.body.rows.some((row) => row.slot !== undefined))
const shares = computed(() => props.body.rows.some((row) => Boolean(row.share)))

/** Whether the row is the one the pointer or the keyboard stands on. */
const isCurrent = (row: TooltipRow) => Boolean(row.key) && row.key === props.current

/** The words whose semibold width a row that can be marked holds, else none. */
const heldName = (row: TooltipRow) => (row.key ? row.name : undefined)
</script>

<template>
  <div
    class="tooltip-body"
    :class="{ 'tooltip-body-swatches': swatches, 'tooltip-body-shares': shares }"
  >
    <div class="tooltip-body-row tooltip-body-head">
      <span class="tooltip-body-name">{{ body.head.name }}</span>
      <span
        v-if="body.head.figure"
        class="tooltip-body-figure"
        >{{ body.head.figure }}</span
      >
    </div>
    <div
      v-for="(line, at) in body.quiet ?? []"
      :key="`quiet-${at}`"
      class="tooltip-body-row tooltip-body-quiet"
    >
      <span class="tooltip-body-name">{{ line.name }}</span>
      <span
        v-if="line.figure"
        class="tooltip-body-figure"
        >{{ line.figure }}</span
      >
    </div>
    <div
      v-for="(row, at) in body.rows"
      :key="row.key ?? `row-${at}`"
      class="tooltip-body-row tooltip-body-main"
      :class="{ 'tooltip-body-current': isCurrent(row) }"
      :data-row="row.key"
    >
      <span
        v-if="row.slot !== undefined"
        class="tooltip-body-swatch series-fill"
        :data-slot="row.slot"
      />
      <span
        class="tooltip-body-name"
        :data-name="heldName(row)"
        >{{ row.name }}</span
      >
      <span
        v-if="row.figure"
        class="tooltip-body-figure"
        >{{ row.figure }}</span
      >
      <span
        v-if="row.share"
        class="tooltip-body-share"
        >{{ row.share }}</span
      >
    </div>
    <span
      v-for="(note, at) in body.notes ?? []"
      :key="`note-${at}`"
      class="tooltip-body-note"
      >{{ note }}</span
    >
  </div>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped>
/* The columns: a swatch where a row has one, the name, the figure, a share where a row has one.
   A line name stands at the start of each column a cell may take. */
.tooltip-body {
  display: grid;
  grid-template-columns: [swatch name] minmax(0, 1fr) [figure] auto [share end];
  column-gap: var(--space-2);
  white-space: normal;
}

.tooltip-body-swatches {
  grid-template-columns: [swatch] auto [name] minmax(0, 1fr) [figure] auto [share end];
}

.tooltip-body-shares {
  grid-template-columns: [swatch name] minmax(0, 1fr) [figure] auto [share] auto [end];
}

.tooltip-body-swatches.tooltip-body-shares {
  grid-template-columns: [swatch] auto [name] minmax(0, 1fr) [figure] auto [share] auto [end];
}

/* A row spans the hint and keeps its columns; its inset is where its band reaches past its
   words. */
.tooltip-body-row {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: swatch / end;
  align-items: baseline;
  padding: var(--space-hair) var(--space-1);
  border-radius: calc(var(--radius-status) / 2);
}

/* A head or quiet row has no swatch: its name starts where the swatch would. */
.tooltip-body-name {
  grid-column: swatch / figure;

  .tooltip-body-main & {
    grid-column: name / figure;
  }

  .tooltip-body-head & {
    font: var(--font-label);
  }

  /* As wide as it is semibold, marked or not: a hidden semibold copy of its words holds the
     width, no taller than nothing. */
  &[data-name]::after {
    content: attr(data-name);
    display: block;
    block-size: 0;
    font: var(--font-label);
    overflow: hidden;
    visibility: hidden;
  }
}

.tooltip-body-figure,
.tooltip-body-share {
  font-variant-numeric: tabular-nums;
  text-align: end;
  white-space: nowrap;
}

.tooltip-body-figure {
  grid-column: figure;
}

.tooltip-body-share {
  grid-column: share;
}

.tooltip-body-quiet {
  color: var(--color-text-muted);
}

/* The legend's swatch, at the size of the hint's words: the hue of the series the row is. */
.tooltip-body-swatch {
  grid-column: swatch;

  /* On the baseline of the name's first line, however many lines the name takes: a box with no
     words stands its foot there, which puts its middle about where the capitals have theirs. */
  align-self: baseline;
  inline-size: var(--space-2);
  block-size: var(--space-2);
  border-radius: calc(var(--radius-status) / 2);
}

/* The part the pointer or the keyboard stands on: its row on a band, its name semibold. */
.tooltip-body-current {
  background: var(--color-tooltip-current);

  .tooltip-body-name {
    font: var(--font-label);
  }
}

/* What is said of the whole besides its figures: each a line across the hint, quiet. */
.tooltip-body-note {
  grid-column: swatch / end;
  padding-inline: var(--space-1);
  color: var(--color-text-muted);

  .tooltip-body-row + & {
    margin-block-start: var(--space-1);
  }
}
</style>
