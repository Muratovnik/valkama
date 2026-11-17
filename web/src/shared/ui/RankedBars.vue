<script setup lang="ts">
/**
 * One measure broken down by one dimension, largest first: a row is a name, its value as the
 * reader reads it, and a bar as long as its share of the longest category. The rows that are not
 * categories — the folded tail, work with no task, work nobody can place — close the chart in a
 * list of their own, under names that say what they are, with their figures and no bar: they are
 * never ranked among the categories and never set their scale, except in a list of free text,
 * below, where each draws its bar.
 * `RankedBarsTable` is the same rows as a table.
 *
 * Presentational: rows and words come in, a press on a row that opens something goes out as
 * `select` with the row's key, and a press on a row that leads somewhere (`href`) as `follow`
 * with the press, for the host to open it in place or leave it to the browser. A row that acts
 * is named by what it does (`action`) or by its label, and its value describes it, after its whole
 * label where the action names a part of it, as a pair's names its first value. A row is a
 * mark of its chart: its hint, under the pointer or the keyboard, says what it does not print —
 * its share of the whole where the caller says how a share reads (`formatShare`), and what the
 * label leaves out (`detail`) — under its name beside its series' swatch (`markHints.ts`), and
 * stands at its bar, the mark it declares (`data-hint-mark`), or at the row where it draws none.
 * A row's name takes one line and ends in an ellipsis where it is cut, said whole in that hint;
 * a name of two parts keeps its end whole and cuts its first part (`labelEnd`, `PairName`).
 * The values stand in one column whatever the names do. In a narrow container the name takes a
 * line of its own over its bar, and so does a pair's at every width: its second part is a whole
 * value's name, as wide as a model's, which the one-line column of two-fifths of the row could not
 * hold beside any of the first. A `dense` chart, a few rows in a small card, keeps the name and
 * the value on one line and draws a thin bar under both; there each value is as wide as its own
 * figure, ending where the others end, and the name takes the rest of its row, so a long figure in
 * one row cuts no name in another.
 *
 * Rows named by free text (`freeText`), tasks and sessions by their titles, run to a sentence: each
 * name takes a line of its own at every width, the bar and the value under it, and wraps to two
 * lines at most before its ellipsis, so the reference a task's name starts with, «VAL-1228 …», is
 * never cut; a pair takes a line a part, each cut at its own end (`PairName`'s `stacked`). The rows
 * that are not categories close the list under a rule, unranked, each with a bar in its neutral on
 * one scale with the categories (`rankRows`'s `drawApart`), so a large «no task» still reads as
 * large. Over the list a thin strip (`MiniShareBar`) splits the whole among every row in its hue,
 * in the list's order: a picture of the figures the rows under it say, so it says nothing itself
 * to a screen reader.
 */
import { computed, useId } from 'vue'

import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import type { PlacedRow, RankedRow, RankedWords } from '@/shared/ui/chartGeometry.ts'
import { markPartId, markTag, rankRows } from '@/shared/ui/chartGeometry.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import { namedHint } from '@/shared/ui/markHints.ts'
import MiniShareBar from '@/shared/ui/MiniShareBar.vue'
import type { SharePart } from '@/shared/ui/MiniShareBar.vue'
import PairName from '@/shared/ui/PairName.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  /** What the chart shows, as its accessible name: "Time by project". */
  label: string
  rows: readonly RankedRow[]
  words: RankedWords
  /** Each row a line of name and value over a thin bar, for a few rows in a small space. */
  dense?: boolean
  /**
   * The rows are named by free text: each name on lines of its own, two at most, the rows that
   * are not categories apart with their bars, and the strip of the whole over them.
   */
  freeText?: boolean
  /** Rank work with no value and unknown work by their figures, with a bar (`rankRows`). */
  rankAll?: boolean
  /** What the shares are of, where the rows are not all of it; what the rows add up to otherwise. */
  whole?: number
  /** A share of the whole as the reader reads it, «42 % of the total», for each row's hint. */
  formatShare?: (ratio: number) => string
}>()

const emit = defineEmits<{ follow: [key: string, press: MouseEvent]; select: [key: string] }>()

const placed = computed(() => rankRows(props.rows, props.rankAll, props.freeText))
/** Whether the rows are pairs, whose names take a line of their own; a dense chart keeps its. */
const pairs = computed(() => !props.dense && props.rows.some((row) => row.labelEnd))
/** Names of free text on lines of their own, two at most; a dense chart keeps its one line. */
const freeText = computed(() => !props.dense && props.freeText)
/** What each row's hint says its share of: the whole given, else what every row adds up to. */
const whole = computed(
  () =>
    props.whole ??
    props.rows.reduce(
      (sum, row) => sum + (Number.isFinite(row.value) ? Math.max(0, row.value) : 0),
      0,
    ),
)

/** The ranked categories as an ordered list, and the rows that are not ranked after them. */
const groups = computed(() =>
  [
    { tag: 'ol', rest: false, rows: placed.value.ranked },
    { tag: 'ul', rest: true, rows: placed.value.rest },
  ].filter((group) => group.rows.length),
)

const ids = useId()
/** The id of a row's value, which describes the row where the row is a control. */
const valueId = (row: PlacedRow) => markPartId(ids, row.key, 'value')
/** The id of a row's name, which describes the row too where its action says a part of it. */
const labelId = (row: PlacedRow) => markPartId(ids, row.key, 'label')

/**
 * A row that acts is named by what it does, or by its name, and described by its value; one
 * whose action names a part of its name (`actsOnPart`) by its whole name before its value.
 */
function lineAttrs(row: PlacedRow) {
  if (!row.href && !row.actionable) return {}
  const describedBy = row.action && row.actsOnPart ? [labelId(row), valueId(row)] : [valueId(row)]
  return {
    'href': row.href,
    'type': row.href ? undefined : 'button',
    'aria-label': row.action ?? row.label,
    'aria-describedby': describedBy.join(' '),
  }
}

/**
 * A category in its series' hue, slot 1 by default; a row apart in its neutral, the folded tail
 * in the lighter, work with no value and unknown work in the darker.
 */
function barSlot(row: PlacedRow): SeriesSlot {
  if (row.kind === 'category' || !freeText.value) return row.slot ?? 1
  return row.kind === 'other' ? 'other' : 'apart'
}
/** The row is its own hint's mark where it draws no bar (`data-hint-mark`). */
const lineMark = (row: PlacedRow) => (row.length === null ? '' : undefined)
/** A row as its hint names it: beside its bar's hue where it draws one. */
const rowMark = (row: PlacedRow) => ({
  ...row,
  slot: row.length === null ? undefined : barSlot(row),
})
const barStyle = (length: number) => ({ inlineSize: `${length * 100}%` })

/** The strip of the whole over a list of free text: every row with a share, in the list's order. */
const strip = computed<SharePart[]>(() =>
  freeText.value && whole.value > 0
    ? [...placed.value.ranked, ...placed.value.rest]
        .filter((row) => Number.isFinite(row.value) && row.value > 0)
        .map((row) => ({
          key: row.key,
          share: row.value / whole.value,
          slot: barSlot(row),
        }))
    : [],
)

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
    :class="{ 'ranked-dense': dense, 'ranked-pairs': pairs, 'ranked-free': freeText }"
    :aria-label="label"
  >
    <DataEmptyState
      v-if="!rows.length"
      :title="words.empty"
      :description="words.emptyDescription"
      compact
    />
    <template v-else>
      <MiniShareBar
        v-if="freeText"
        class="ranked-whole"
        aria-hidden="true"
        :label="label"
        :parts="strip"
      />
      <div class="ranked-grid">
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
              :is="markTag(row, 'div')"
              v-tooltip.detail="namedHint(rowMark(row), whole, formatShare)"
              class="ranked-line row-state"
              :data-key="row.key"
              :data-hint-mark="lineMark(row)"
              v-bind="lineAttrs(row)"
              @click="(event: MouseEvent) => press(row, event)"
              @auxclick="(event: MouseEvent) => pressAside(row, event)"
            >
              <span
                :id="labelId(row)"
                class="ranked-label"
                :class="{
                  'one-line': !freeText,
                  'ranked-clamp': freeText && !row.labelEnd,
                  'ranked-quiet': row.quiet,
                }"
                ><PairName
                  :name="row.label"
                  :end="row.labelEnd"
                  :stacked="freeText"
              /></span>
              <span
                class="ranked-track"
                aria-hidden="true"
              >
                <span
                  v-if="row.length !== null"
                  class="ranked-bar series-fill"
                  :data-slot="barSlot(row)"
                  :style="barStyle(row.length)"
                  data-hint-mark
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
    </template>
  </figure>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped src="@/shared/ui/rowStates.css"></style>

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
   same box as one that does not, and the whole of it is what a pointer presses. Its states are
   the model the page's rows share (`rowStates.css`). */
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

  &:is([type='button'], [href]) {
    cursor: pointer;
  }

  /* A link reads as one by its name, underlined as a name that opens something in a table is. */
  &[href] {
    text-decoration: none;

    & .ranked-label {
      text-decoration: underline;
      text-decoration-color: var(--row-state-underline, var(--color-rule-strong));
      text-underline-offset: var(--space-half);
    }
  }
}

/* Work with no value or unknown work ranked among the categories keeps their quiet ink. */
.ranked-row:is([data-kind='none'], [data-kind='unknown']) .ranked-label {
  color: var(--color-text-tertiary);
}

/* The rows that are not categories read as a note on the breakdown rather than a part of it:
   apart by air, their names in the quiet ink, slanted, their figures with no bar. A row ranked
   among them that names no value says so in the same ink. */
.ranked-rest {
  margin-block-start: var(--space-3);
}

.ranked-rest .ranked-label,
.ranked-label.ranked-quiet {
  color: var(--color-text-tertiary);
  font-style: italic;
}

.ranked-track {
  display: flex;
  align-items: center;
  min-width: 0;
}

/* Thin, square where it grows from and rounded at its end. A bar of nothing draws nothing. The
   row is what the pointer and the keyboard stand on, so the bar of the row they stand on lifts
   (`seriesFill.css`) over the row's band. */
.ranked-bar {
  display: block;
  block-size: var(--space-2);
  border-start-end-radius: 999px;
  border-end-end-radius: 999px;

  .ranked-line:is(:hover, :focus-visible) & {
    background: var(--series-lifted);
  }
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

/* So does a chart of pairs, at every width. On one line at 1440 in English, the name's column
   held «claude-opus-5-5» with 13 pixels of the task before it, «V.», and cut the model too: the
   second part needs the room the one-line column gives the whole name. */
.ranked-pairs {
  & .ranked-grid {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  & .ranked-label {
    grid-column: 1 / -1;
  }
}

/* A list of free text, at any width: every name on lines of its own over its bar and its value,
   two lines at most, then an ellipsis. Its start is the reference a task's name begins with, so the
   cut falls in the title after it; a word wider than the line breaks rather than spill. */
.ranked-free {
  & .ranked-grid {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  & .ranked-label {
    grid-column: 1 / -1;
  }

  /* The rows apart close the list under a rule, unranked: a note on the list, not a rank of it. */
  & .ranked-rest {
    padding-block-start: var(--space-2);
    margin-block-start: 0;
    border-block-start: 1px solid var(--color-rule);
  }
}

.ranked-clamp {
  display: -webkit-box;
  overflow-wrap: break-word;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* The strip of the whole stands over the rows, from where their names start to where their
   values end. */
.ranked-whole {
  margin: 0 var(--space-2) var(--space-3);
}

/* Dense, at any width: the name and the value on one line, the bar a thin line under both. Each
   row lays out its own line, so its value is as wide as its figure and its name has the rest. */
.ranked-dense {
  & .ranked-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  & .ranked-line {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-half) var(--space-2);
    padding-block: var(--space-half);
  }

  & .ranked-label {
    grid-row: 1;
    grid-column: 1;
  }

  & .ranked-value {
    grid-row: 1;
    grid-column: 2;
  }

  & .ranked-track {
    grid-row: 2;
    grid-column: 1 / -1;
  }

  & .ranked-bar {
    block-size: var(--space-1);
  }
}
</style>
