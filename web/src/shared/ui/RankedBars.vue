<script setup lang="ts">
/**
 * One measure broken down by one dimension, largest first: a row is a name, its value as the
 * reader reads it, and a bar as long as its share of the longest. The rows that are not
 * categories — the folded tail, work with no task, work nobody can place — close the chart in a
 * list of their own, in the neutral, under names that say what they are, and are never ranked
 * among the categories. `RankedBarsTable` is the same rows as a table.
 *
 * Presentational: rows and words come in, a press on a row that opens something goes out as
 * `select` with the row's key, and a press on a row that leads somewhere (`href`) as `follow`
 * with the press, for the host to open it in place or leave it to the browser. A row that acts
 * is named by what it does (`action`) or by its label, and its value describes it. A row's name
 * wraps rather than being cut, and the values stand in one column whatever the names do; in a
 * narrow container the name takes a line of its own over its bar.
 */
import { computed, useId } from 'vue'

import type { PlacedRow, RankedRow, RankedWords } from '@/shared/ui/chartGeometry.ts'
import { rankRows } from '@/shared/ui/chartGeometry.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'

const props = defineProps<{
  /** What the chart shows, as its accessible name: "Time by project". */
  label: string
  rows: readonly RankedRow[]
  words: RankedWords
}>()

const emit = defineEmits<{ follow: [key: string, press: MouseEvent]; select: [key: string] }>()

const placed = computed(() => rankRows(props.rows))

/** The ranked categories as an ordered list, and the rows that are not ranked after them. */
const groups = computed(() =>
  [
    { tag: 'ol', rest: false, rows: placed.value.ranked },
    { tag: 'ul', rest: true, rows: placed.value.rest },
  ].filter((group) => group.rows.length),
)

const ids = useId()
/** The id of a row's value, which describes the row where the row is a control. */
const valueId = (row: PlacedRow) => `${ids}-${row.key}`

/**
 * A row that leads somewhere is a link, one that opens something a button, and one that does
 * neither a line of the chart.
 */
function lineTag(row: PlacedRow) {
  if (row.href) return 'a'
  return row.actionable ? 'button' : 'div'
}

/** A row that acts is named by what it does, or by its name, and described by its value. */
function lineAttrs(row: PlacedRow) {
  if (!row.href && !row.actionable) return {}
  return {
    'href': row.href,
    'type': row.href ? undefined : 'button',
    'aria-label': row.action ?? row.label,
    'aria-describedby': valueId(row),
  }
}

/** A category in its series' hue, slot 1 by default; a row that is not one in the neutral. */
const barSlot = (row: PlacedRow) => (row.kind === 'category' ? (row.slot ?? 1) : 'other')
const barStyle = (row: PlacedRow) => ({ inlineSize: `${row.length * 100}%` })

function press(row: PlacedRow, event: MouseEvent) {
  if (row.href) emit('follow', row.key, event)
  else if (row.actionable) emit('select', row.key)
}

/** A middle press on a link opens it elsewhere, and is a press on it all the same. */
function pressAside(row: PlacedRow, event: MouseEvent) {
  if (row.href && event.button === 1) emit('follow', row.key, event)
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
            @click="(event: MouseEvent) => press(row, event)"
            @auxclick="(event: MouseEvent) => pressAside(row, event)"
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
            <span
              :id="valueId(row)"
              class="ranked-value"
              >{{ row.valueText }}</span
            >
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

  &:is([type='button'], [href]) {
    cursor: pointer;

    &:hover {
      background: var(--color-surface-hover);
    }
  }

  /* A link reads as one by its name, underlined as a name that opens something in a table is. */
  &[href] {
    text-decoration: none;

    & .ranked-label {
      text-decoration: underline;
      text-decoration-color: var(--color-rule-strong);
      text-underline-offset: var(--space-half);
    }

    &:hover .ranked-label {
      text-decoration-color: currentcolor;
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
