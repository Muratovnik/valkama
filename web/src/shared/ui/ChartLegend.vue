<script setup lang="ts">
/**
 * Which hue is which series, in words: each series' name beside a swatch of its hue, in the
 * stack's order. A chart of two series or more carries one, so a series is never told apart by
 * its hue alone; one series needs none, since the chart's title already says what it is. A chart
 * that hatches a period still running names the hatch after the series (`hatch`), beside a
 * hatched swatch, so the texture never has to be guessed; and a chart that marks a period it is
 * compared with names that mark last (`outline`), beside a short line in the ink the plot draws
 * it in at the height that period reached. Neither key acts.
 *
 * A legend given a figure for its entries (`figures`), as a ring's is, lists down, an entry a
 * line, each figure at the end of its line in the quiet ink, ending where the others end: a
 * column of numbers to read down beside the names.
 *
 * A name takes one line, as wide as the legend at most, and ends in an ellipsis where it is cut; it
 * is cut from its end, so the start that tells it apart, a task's reference, stays. The entry's
 * hint says it whole while it is cut, or, where the entry has no hint of its own, is the name
 * whole over the cut one. Broken wherever a letter fell, a task's title took two lines an entry
 * and a session's title four, «Valkama: проектирова / ние системы агентов».
 *
 * An entry is a mark of its chart: its hint says what the name does not (`hints`, by series key,
 * `outline` for the mark of the period compared with), under its name beside its swatch where the
 * caller draws it so (`markHints.ts`). It names a series rather than standing for a value, so it
 * is no plot mark: the legend declares itself (`data-hint-list="legend"`), and the hint stands
 * under the whole legend at the entry's start, clear of every entry a reader reads it against,
 * letting the pointer through to the plot (`hintPlacement.ts`). A series that acts (`MarkAction`) is
 * pressed here as on its segments: a link sent out as `follow` with the press, a button as
 * `select` with its key. The rest only show. An entry named by what it does is described by its
 * whole name where that names a part of it, as a pair's names its first value. The pointer
 * or the keyboard standing on an entry is sent out as `point` with its key, and leaving it as
 * `point` with none, so the chart can lift the entry's marks.
 */
import { useId } from 'vue'

import type { PeriodSeries } from '@/shared/ui/chartGeometry.ts'
import { markPartId, markTag, markType } from '@/shared/ui/chartGeometry.ts'
import type { TooltipValue } from '@/shared/ui/tooltipAnchors.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  series: readonly PeriodSeries[]
  /** The figure each entry gives at the end of its line, by series key; none for a legend of names. */
  figures?: ReadonlyMap<string, string>
  /** The name of the hatch, while the chart draws a period still running. */
  hatch?: string
  /** What each entry says in its hint, by series key; `outline` for the period compared with. */
  hints?: ReadonlyMap<string, TooltipValue>
  /** The name of the mark of the period compared with, when the chart draws one. */
  outline?: string
}>()

const emit = defineEmits<{
  follow: [key: string, press: MouseEvent]
  point: [key: string | null]
  select: [key: string]
}>()

function press(one: PeriodSeries, event: MouseEvent) {
  if (one.href) emit('follow', one.key, event)
  else if (one.actionable) emit('select', one.key)
}

/** A middle press on a link opens it elsewhere, and is a press on it all the same. */
function pressAside(one: PeriodSeries, event: MouseEvent) {
  if (one.href && event.button === 1) emit('follow', one.key, event)
}

const ids = useId()
/** The id of an entry's name, which describes the entry where its action says a part of it. */
const nameId = (one: PeriodSeries) => markPartId(ids, one.key, 'name')

/**
 * An entry that acts is named by what it does, where it says so, else by its name; where what it
 * does names a part of its name only (`actsOnPart`), the whole name describes it.
 */
const keyAttrs = (one: PeriodSeries) =>
  one.href || one.actionable
    ? {
        'href': one.href,
        'type': markType(one),
        'aria-label': one.action,
        'aria-describedby': one.action && one.actsOnPart ? nameId(one) : undefined,
      }
    : {}

/**
 * What an entry says that its name does not, by its series' key; with nothing to say, its name
 * whole while it is cut.
 */
function hintOf(key: string): TooltipValue {
  const hint = props.hints?.get(key)
  if (hint !== undefined) return hint
  const words =
    key === 'outline' ? props.outline : props.series.find((one) => one.key === key)?.label
  return { text: null, words }
}
/** The figure an entry gives at the end of its line; none in a legend of names. */
const figureOf = (key: string) => props.figures?.get(key)
</script>

<template>
  <ul
    class="chart-legend"
    data-hint-list="legend"
    :class="{ 'chart-legend-figures': figures }"
  >
    <li
      v-for="one in series"
      :key="one.key"
      class="chart-entry"
      @pointerenter="emit('point', one.key)"
      @pointerleave="emit('point', null)"
      @focusin="emit('point', one.key)"
      @focusout="emit('point', null)"
    >
      <component
        :is="markTag(one, 'span')"
        v-tooltip.detail="hintOf(one.key)"
        class="chart-key"
        :data-series="one.key"
        v-bind="keyAttrs(one)"
        @click="(event: MouseEvent) => press(one, event)"
        @auxclick="(event: MouseEvent) => pressAside(one, event)"
      >
        <span
          class="chart-swatch series-fill"
          aria-hidden="true"
          :data-slot="one.slot"
        />
        <span
          :id="nameId(one)"
          class="chart-key-name one-line"
          >{{ one.label }}</span
        >
      </component>
      <span
        v-if="figureOf(one.key)"
        class="chart-figure"
        >{{ figureOf(one.key) }}</span
      >
    </li>
    <li
      v-if="hatch"
      class="chart-entry"
    >
      <span
        class="chart-key"
        data-series="hatch"
      >
        <span
          class="chart-hatch hatched"
          aria-hidden="true"
        />
        <span class="chart-key-name">{{ hatch }}</span>
      </span>
    </li>
    <li
      v-if="outline"
      class="chart-entry"
    >
      <span
        v-tooltip.detail="hintOf('outline')"
        class="chart-key"
        data-series="outline"
      >
        <span
          class="chart-outline"
          aria-hidden="true"
        />
        <span class="chart-key-name one-line">{{ outline }}</span>
      </span>
    </li>
  </ul>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped src="@/shared/ui/hatch.css"></style>

<style scoped>
/* The lines step 24 pixels, the target WCAG 2.5.8 asks, with no gap between them: every key fills
   its line, so one that acts is pressed across all 24 and never reaches into the next line's. The
   legend is as wide as its host gives it and asks no width of its own: a name kept to one line
   would otherwise widen the column it stands in to its whole length, past the page's edge. */
.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-4);
  padding: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  list-style: none;
  contain: inline-size;
}

.chart-entry {
  display: flex;
  min-width: 0;
  max-inline-size: 100%;
  min-block-size: var(--space-6);
}

/* Given figures, the legend reads down, an entry a line, its figure at the line's end. */
.chart-legend-figures {
  flex-flow: column nowrap;

  & .chart-entry {
    gap: var(--space-3);
    justify-content: space-between;
  }
}

.chart-figure {
  flex: none;
  align-self: center;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* An entry that acts is a line of the legend, not a control standing in it: the same box and
   words as one that does not, with the pointer's hand. A button takes no control's row height:
   «No task», which acts only as one, stood 40 pixels tall among the 17 of its neighbours' links. */
.chart-key {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: start;
  text-decoration: none;
  background: none;

  &:is([type='button'], [href]) {
    cursor: pointer;

    &:hover .chart-key-name {
      text-decoration: underline;
    }
  }
}

.chart-key-name {
  flex: 0 1 auto;
}

/* The tick of the period compared with, as the plot draws it: a short line, an edge in the
   text's main ink that a forced palette inks with the text. */
.chart-outline {
  flex: none;
  inline-size: var(--space-3);
  border-block-start: var(--space-half) solid currentcolor;
  color: var(--color-text);
}

.chart-swatch,
.chart-hatch {
  flex: none;
  inline-size: var(--space-3);
  block-size: var(--space-3);
  border-radius: calc(var(--radius-status) / 2);
}

/* The hatch a period still running is drawn with, on no hue of its own: the quiet ink, which a
   forced palette paints in its ink, keeping the mask. */
.chart-hatch {
  background: var(--color-text-muted);

  @media (forced-colors: active) {
    background: CanvasText;
    forced-color-adjust: none;
  }
}
</style>
