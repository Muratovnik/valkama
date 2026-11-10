<script setup lang="ts">
/**
 * One measure broken down by one dimension, largest first: a row is a name, its value as the
 * reader reads it, and a bar as long as its share of the longest. The rows that are not
 * categories — the folded tail, work with no task, work nobody can place — close the chart in a
 * list of their own, in the neutral, under names that say what they are, and are never ranked
 * among the categories. `RankedBarsTable` is the same rows as a table.
 *
 * Presentational: rows and words come in, a press on a row that opens something goes out as
 * `select` with the row's key. A row's name wraps rather than being cut, and the values stand
 * in one column whatever the names do; in a narrow container the name takes a line of its own
 * over its bar.
 */
import { computed } from 'vue'

import type { PlacedRow, RankedRow, RankedWords } from '@/shared/ui/chartGeometry.ts'
import { rankRows } from '@/shared/ui/chartGeometry.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'

const props = defineProps<{
  /** What the chart shows, as its accessible name: "Time by project". */
  label: string
  rows: readonly RankedRow[]
  words: RankedWords
}>()

const emit = defineEmits<{ select: [key: string] }>()

const placed = computed(() => rankRows(props.rows))

/** The ranked categories as an ordered list, and the rows that are not ranked after them. */
const groups = computed(() =>
  [
    { tag: 'ol', rest: false, rows: placed.value.ranked },
    { tag: 'ul', rest: true, rows: placed.value.rest },
  ].filter((group) => group.rows.length),
)

/** A row that opens something is a button; one that does not is a line of the chart. */
const lineTag = (row: PlacedRow) => (row.actionable ? 'button' : 'div')
const lineAttrs = (row: PlacedRow) => (row.actionable ? { type: 'button' } : {})

/** A category in its series' hue, slot 1 by default; a row that is not one in the neutral. */
const barSlot = (row: PlacedRow) => (row.kind === 'category' ? (row.slot ?? 1) : 'other')
const barStyle = (row: PlacedRow) => ({ inlineSize: `${row.length * 100}%` })

function press(row: PlacedRow) {
  if (row.actionable) emit('select', row.key)
}
</script>

<template>
  <figure
    class="ranked-bars"
    :aria-label="label"
  >
    <DataEmptyState
      v-if="!rows.length"
      :title="words.empty"
      :description="words.emptyDescription"
      compact
    />
    <div
      v-else
      class="ranked-grid"
    >
      <component
        :is="group.tag"
        v-for="group in groups"
        :key="group.tag"
        class="ranked-list"
        :class="{ 'ranked-rest': group.rest }"
      >
        <li
          v-for="row in group.rows"
          :key="row.key"
          class="ranked-row"
          :data-kind="row.kind"
        >
          <component
            :is="lineTag(row)"
            class="ranked-line"
            :data-key="row.key"
            v-bind="lineAttrs(row)"
            @click="press(row)"
          >
            <span class="ranked-label">{{ row.label }}</span>
            <span
              class="ranked-track"
              aria-hidden="true"
            >
              <span
                class="ranked-bar series-fill"
                :data-slot="barSlot(row)"
                :style="barStyle(row)"
              />
            </span>
            <span class="ranked-value">{{ row.valueText }}</span>
          </component>
        </li>
      </component>
    </div>
  </figure>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped>
.ranked-bars {
  min-width: 0;
  margin: 0;
  container-type: inline-size;
}

/* Three columns every row shares, so a value stands under the value above it however long
   the names are: the name, the bar, and the value as wide as the widest. */
.ranked-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) auto;
  gap: var(--space-3);
}

.ranked-list {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  padding: 0;
  margin: 0;
  list-style: none;
}

.ranked-row {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
}

/* A line of the chart, not a control standing in it: a row that opens something takes the
   same box as one that does not, and the whole of it is what a pointer presses. */
.ranked-line {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: center;
  min-block-size: var(--size-control-inline);
  padding: var(--space-1) var(--space-2);
  border: 0;
  color: var(--color-text);
  font: var(--font-detail);
  text-align: start;
  background: none;
  border-radius: var(--radius-control);

  &[type='button'] {
    cursor: pointer;

    &:hover {
      background: var(--color-surface-hover);
    }
  }
}

.ranked-label {
  overflow-wrap: anywhere;
}

/* The rows that are not categories read as a note on the breakdown rather than a part of it:
   their names in the quiet ink, slanted, and their bars in the neutral. */
.ranked-rest .ranked-label {
  color: var(--color-text-tertiary);
  font-style: italic;
}

.ranked-track {
  display: flex;
  align-items: center;
  min-width: 0;
}

/* Thin, square where it grows from and rounded at its end. A bar of nothing draws nothing. */
.ranked-bar {
  display: block;
  block-size: var(--space-2);
  border-start-end-radius: 999px;
  border-end-end-radius: 999px;
}

.ranked-value {
  justify-self: end;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  text-align: end;
  white-space: nowrap;
}

/* A narrow container gives the name its own line over the bar and the value. */
@container (width < 26rem) {
  .ranked-grid {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .ranked-label {
    grid-column: 1 / -1;
  }
}
</style>
