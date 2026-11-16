<script setup lang="ts">
/**
 * One small chart of the span per value, all on one scale whose top is said once over them, so
 * a short column means less in every chart alike: each a name on one line (cut with an ellipsis,
 * a name of two parts in its first part, `PairName`; whole in its hint), its figure for the whole
 * span, and a column per period. The categories come first, in the order given, then the folded
 * tail; work with nothing to file it under and work nobody can place close the chart in a list of
 * their own set apart by air, by name and figure, with no chart and no part in the scale
 * (`placeMultiples`). `SmallMultiplesTable` is the same numbers as a table.
 *
 * A column is drawn in its value's hue (`seriesFill.css`), the one the value has wherever the page
 * draws it, and a name always stands beside it: a hue never speaks alone.
 *
 * Every mark has its hint (`markHints.ts`): a chart's name says its share of the whole where the
 * caller says how a share reads (`formatShare`), and while the name is cut says it whole first; a
 * period of a chart, where the caller names the periods (`periods`), says its name and its figure.
 * Each chart keeps the hints of its periods, a list of columns, inside it (`data-hint-frame`).
 * Presentational: a name whose value acts (`MarkAction`) is pressed as its value's row is, a link
 * sent out as `follow` with the press, a button as `select` with the key; the rest only show. A
 * name named by what it does is described by its whole words where that names a part of them.
 */
import { computed, useId } from 'vue'

import { markPartId, markTag, roundAxis } from '@/shared/ui/chartGeometry.ts'
import type { ValueAxis } from '@/shared/ui/chartGeometry.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import { namedHint } from '@/shared/ui/markHints.ts'
import { placeMultiples } from '@/shared/ui/multiplesGeometry.ts'
import type {
  MultiplePeriod,
  MultiplesWords,
  PlacedMultiple,
  SmallMultiple,
} from '@/shared/ui/multiplesGeometry.ts'
import PairName from '@/shared/ui/PairName.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  /** What the charts show, as their accessible name: "Agent time per day of each, by task". */
  label: string
  multiples: readonly SmallMultiple[]
  words: MultiplesWords
  /** The periods the columns stand for, in order, for each column's hint. */
  periods?: readonly MultiplePeriod[]
  /** The scale, where its top is other than a round step said as `formatValue` says it. */
  valueAxis?: ValueAxis
  /** A share of the whole as the reader reads it, «42 % of the total», for each name's hint. */
  formatShare?: (ratio: number) => string
  /** A value as the reader reads it, for the scale's top and each period's hint. */
  formatValue: (value: number) => string
}>()

const emit = defineEmits<{ follow: [key: string, press: MouseEvent]; select: [key: string] }>()

const placed = computed(() =>
  placeMultiples(props.multiples, props.valueAxis ?? roundAxis(props.formatValue)),
)
const top = computed(() => placed.value.topText)

/** A chart's figure over the span: what its periods add up to. */
const figureOf = (one: SmallMultiple) =>
  one.values.reduce<number>(
    (sum, value) => sum + (value !== null && Number.isFinite(value) && value > 0 ? value : 0),
    0,
  )

/** What every chart adds up to, of which each name's hint says its share. */
const whole = computed(() => props.multiples.reduce((sum, one) => sum + figureOf(one), 0))

const nameHint = (one: PlacedMultiple) =>
  namedHint({ label: one.label, value: figureOf(one) }, whole.value, props.formatShare)

/** A period of a chart in its hint: its name and its figure, where the periods are named. */
function periodHint(one: PlacedMultiple, index: number) {
  const period = props.periods?.[index]
  const value = one.values[index]
  const figure =
    value === null || value === undefined ? (props.words.absent ?? '—') : props.formatValue(value)
  return period ? `${one.label}\n${period.label}: ${figure}` : undefined
}

const ids = useId()
/** The id of a chart's words, which describe its name where its action says a part of them. */
const wordsId = (one: PlacedMultiple) => markPartId(ids, one.key, 'words')

/**
 * A name that acts is named by what it does, where it says so, else by its words; where what it
 * does names a part of its words only (`actsOnPart`), the whole words describe it.
 */
const nameAttrs = (one: PlacedMultiple) =>
  one.href || one.actionable
    ? {
        'href': one.href,
        'type': one.href ? undefined : 'button',
        'aria-label': one.action,
        'aria-describedby': one.action && one.actsOnPart ? wordsId(one) : undefined,
      }
    : {}

function press(one: PlacedMultiple, event: MouseEvent) {
  if (one.href) emit('follow', one.key, event)
  else if (one.actionable) emit('select', one.key)
}

/** A middle press on a link opens it elsewhere, and is a press on it all the same. */
function pressAside(one: PlacedMultiple, event: MouseEvent) {
  if (one.href && event.button === 1) emit('follow', one.key, event)
}

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
        <!-- Each chart keeps its periods' hints inside it: a period's hint stands over part of
             its own chart, rather than below it over the charts of the next row. -->
        <li
          v-for="one in placed.shared"
          :key="one.key"
          class="multiple"
          data-hint-frame="inside"
          :data-key="one.key"
          :data-kind="one.kind"
        >
          <component
            :is="markTag(one, 'span')"
            v-tooltip.detail="nameHint(one)"
            class="multiple-name one-line"
            v-bind="nameAttrs(one)"
            @click="(event: MouseEvent) => press(one, event)"
            @auxclick="(event: MouseEvent) => pressAside(one, event)"
            ><span :id="wordsId(one)"
              ><PairName
                :name="one.label"
                :end="one.labelEnd" /></span
          ></component>
          <span class="multiple-value">{{ one.valueText }}</span>
          <span
            class="multiple-plot"
            aria-hidden="true"
            data-hint-list="columns"
          >
            <span
              v-for="(height, index) in one.heights"
              :key="index"
              v-tooltip.detail="periodHint(one, index)"
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
          <component
            :is="markTag(one, 'span')"
            v-tooltip.detail="nameHint(one)"
            class="multiple-name one-line"
            v-bind="nameAttrs(one)"
            @click="(event: MouseEvent) => press(one, event)"
            @auxclick="(event: MouseEvent) => pressAside(one, event)"
            ><span :id="wordsId(one)"
              ><PairName
                :name="one.label"
                :end="one.labelEnd" /></span
          ></component>
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

/* A name that acts is a line of the chart, not a control standing in it: the same words and box,
   with the pointer's hand and an underline as a name that opens something in a table has. A
   button takes no control's row height: «No task», which only acts as one, stood 40 pixels tall
   and its name 11 pixels under its neighbour's, a task's link. What a pointer presses reaches
   over the air above and under the line instead, to the 24 pixels WCAG 2.5.8 asks: padding the
   margin takes back, since the name's ellipsis clips anything drawn past its box. */
.multiple-name {
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: var(--color-text);
  font: var(--font-detail);
  text-align: start;
  text-decoration: none;
  background: none;

  &:is([type='button'], [href]) {
    padding-block: var(--space-1);
    margin-block: calc(-1 * var(--space-1));
    text-decoration: underline;
    text-decoration-color: var(--color-rule-strong);
    text-underline-offset: var(--space-half);
    cursor: pointer;

    &:hover {
      text-decoration-color: currentcolor;
    }
  }
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
