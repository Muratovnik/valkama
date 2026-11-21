<script setup lang="ts">
/**
 * How one whole splits among its parts, as a ring: a sector a part, as long around the ring as its
 * share of the whole, largest first from 12 o'clock clockwise (`donutGeometry`). It draws five
 * sectors at most and names a part only where its hue stays apart from every hue named before it,
 * since any two parts of a ring can meet (`ringOf`); the smaller parts past them fold into one
 * rest, in the neutral of a folded tail and named by the caller's words with how many it holds
 * (`words.rest`). A part takes the hue its value has wherever its page draws it (`slot`), so the
 * colour follows the value and not its place.
 * The rows of kind `other` are no part of the whole: they close the chart under its legend by name
 * and figure, slanted in the quiet ink, as the rows apart of a ranked chart do (`RankedBars`).
 *
 * A legend always names the parts beside the ring, in its order (`ChartLegend`), so no part is told
 * by its hue alone, and gives each its figure and its bare share in a column at its end, in the
 * text roles of the rows apart under it, under a name too long to stand beside them: the numbers
 * are read there, and no sector carries words, which no hue of the palette held well. A row's
 * figure (`valueText`) is its figure alone, since the legend says its share after it. The sectors
 * stand apart by a gap of ground.
 *
 * A sector is a mark of its chart: its one hint, under the pointer or the keyboard, gives its
 * name beside its hue, its figure and its share of the whole, and for the rest its five largest
 * parts and one line for the others (`ringHint` in `markHints.ts`). It stands at the top right of
 * the middle of the sector's band, as a chart's hint stands at its point (`data-hint-point`,
 * `hintPlacement.ts`). The sectors are one stop for Tab, walked round the ring with the arrows,
 * Home and End; a sector whose row opens something (`actionable`) is a button there, pressed with
 * Enter or Space as with the pointer, and sent out as `select` with the row's key, as its legend
 * entry is. A row that leads somewhere (`href`) is followed from its legend entry and the table.
 * A sector under the pointer or the keyboard lifts (`seriesFill.css`), and so does the sector of a
 * legend entry pointed at or focused, so the reader sees which part the line names.
 *
 * Presentational, and it moves nothing under the pointer. With no part above zero it is the
 * chart's empty state. Its table twin is `RankedBarsTable`, which the host shows instead.
 */
import { computed, nextTick, ref } from 'vue'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import type { PeriodSeries, RankedRow } from '@/shared/ui/chartGeometry.ts'
import ChartLegend from '@/shared/ui/ChartLegend.vue'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import type { RingSector } from '@/shared/ui/donutGeometry.ts'
import { bandMiddle, RING_BOX, ringOf, sectorPath } from '@/shared/ui/donutGeometry.ts'
import { ringHint, ringPart } from '@/shared/ui/markHints.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

/** The words a ring needs from its caller. */
export interface DonutWords {
  empty: string
  emptyDescription?: string
  /** The name of the sector the smaller parts fold into, by how many it holds. */
  rest: (count: number) => string
}

const props = defineProps<{
  /** What the ring shows, as its accessible name: "Agent time by effort". */
  label: string
  rows: readonly RankedRow[]
  words: DonutWords
  /**
   * What the parts are shares of, where the caller left out rows that say nothing of how much
   * (`drawnLines`); the rows' own sum by default (`ringOf`).
   */
  whole?: number
  /** A share bare, «42 %», in the legend and against each part of the rest in its hint. */
  formatPart?: (ratio: number) => string
  /** A share of the whole as the reader reads it, «42 % of the total», in hints. */
  formatShare?: (ratio: number) => string
  /** A figure as the reader reads it, for the rest, whose sum no row carries. */
  formatValue: (value: number) => string
}>()

const emit = defineEmits<{ follow: [key: string, press: MouseEvent]; select: [key: string] }>()

const ring = computed(() => ringOf(props.rows, undefined, props.whole))
/**
 * The sectors drawn, each with its outline and the point its hint stands at, the middle of its
 * band in the drawing's units; one too thin to show past its gap is in the legend.
 */
const drawn = computed(() =>
  ring.value.sectors
    .map((sector) => {
      const middle = bandMiddle(sector)
      return {
        ...sector,
        path: sectorPath(sector.start, sector.end),
        point: `${middle.x} ${middle.y}`,
      }
    })
    .filter((sector) => sector.path),
)

/** How a sector's hint and its legend entry read its figures and name the rest. */
const hintChart = computed(() => ({
  formatValue: props.formatValue,
  formatPart: props.formatPart,
  formatShare: props.formatShare,
  rest: props.words.rest,
}))
const partOf = (sector: RingSector) => ringPart(sector, ring.value.whole, hintChart.value)
const nameOf = (sector: RingSector) => partOf(sector).label
const pressable = (sector: RingSector) => Boolean(sector.row?.actionable)

/** A sector's hint (`ringHint`): its name beside its hue, its figure and share, the rest's parts. */
const hintOf = (sector: RingSector) => ringHint(sector, ring.value.whole, hintChart.value)

/** The legend's entries, in the ring's order: a row's acts as its sector does. */
const legend = computed<PeriodSeries[]>(() =>
  ring.value.sectors.map((sector) => ({
    key: sector.key,
    label: nameOf(sector),
    labelRuns: sector.row?.labelRuns,
    slot: sector.slot,
    action: sector.row?.action,
    actionable: sector.row?.actionable,
    actsOnPart: sector.row?.actsOnPart,
    href: sector.row?.href,
  })),
)
/** What each entry gives at its end: its figure and its bare share, «6 h · 47 %». */
const figures = computed(
  () =>
    new Map(
      ring.value.sectors.map((sector) => [
        sector.key,
        [partOf(sector).figure, props.formatPart?.(sector.share)].filter(Boolean).join(' · '),
      ]),
    ),
)

/** The part whose legend entry the pointer or the keyboard stands on, whose sector lifts. */
const pointed = ref<string | null>(null)
/** A sector lifted by its legend entry is marked; one that is not carries no mark at all. */
const liftedBy = (sector: RingSector) => (sector.key === pointed.value ? '' : undefined)

/** The one sector Tab lands on: the last stood on while it is still there, else the first. */
const stood = ref(0)
const stop = computed(() => (stood.value < drawn.value.length ? stood.value : 0))
const drawing = ref<SVGSVGElement | null>(null)
const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

/**
 * A sector is a button where it opens something, named by what it does, else a picture named by
 * its part; only the one Tab lands on is in the page's order, and the arrows reach the rest.
 */
const sectorAttrs = (sector: RingSector, index: number) => ({
  'role': pressable(sector) ? 'button' : 'img',
  'aria-label': sector.row?.action ?? nameOf(sector),
  'tabindex': index === stop.value ? 0 : -1,
})

/** A press on a sector that opens something; a sector that only shows does nothing. */
function press(sector: RingSector) {
  if (sector.row && pressable(sector)) emit('select', sector.key)
}

/**
 * A key on a sector: Enter and Space press one that opens something, the arrows walk round the
 * ring, on past its end to its start, and Home and End go to its first and last sector.
 */
async function walk(event: KeyboardEvent, index: number) {
  const sector = drawn.value[index]
  if (sector && (event.key === 'Enter' || event.key === ' ') && pressable(sector)) {
    event.preventDefault()
    press(sector)
    return
  }
  const count = drawn.value.length
  const step = STEPS[event.key]
  let to: number | null = null
  if (event.key === 'Home') to = 0
  else if (event.key === 'End') to = count - 1
  else if (step !== undefined) to = (index + step + count) % count
  if (to === null) return
  event.preventDefault()
  stood.value = to
  await nextTick()
  moveFocus(drawing.value?.querySelector<SVGElement>(`[data-sector="${to}"]`))
}
</script>

<template>
  <figure
    class="donut-chart"
    :aria-label="label"
  >
    <DataEmptyState
      v-if="!drawn.length"
      :title="words.empty"
      :description="words.emptyDescription"
      compact
    />
    <div
      v-else
      class="donut-body"
    >
      <div class="donut-ring">
        <svg
          ref="drawing"
          class="donut-drawing"
          :viewBox="`0 0 ${RING_BOX} ${RING_BOX}`"
        >
          <!-- A sector is a picture of its part, or a button where it opens one, walked with the
               arrows as one stop. -->
          <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
          <path
            v-for="(sector, index) in drawn"
            :key="sector.key"
            v-tooltip.detail="hintOf(sector)"
            class="donut-sector series-fill"
            :class="{ 'donut-acts': pressable(sector) }"
            :d="sector.path"
            :data-slot="sector.slot"
            :data-key="sector.key"
            :data-sector="index"
            :data-hint-point="sector.point"
            :data-lifted="liftedBy(sector)"
            v-bind="sectorAttrs(sector, index)"
            @click="press(sector)"
            @keydown="(event: KeyboardEvent) => walk(event, index)"
            @focus="stood = index"
          />
        </svg>
      </div>
      <div class="donut-keys">
        <ChartLegend
          :series="legend"
          :figures="figures"
          @follow="(key, event) => emit('follow', key, event)"
          @select="(key) => emit('select', key)"
          @point="(key) => (pointed = key)"
        />
        <ul
          v-if="ring.notes.length"
          class="donut-notes"
        >
          <li
            v-for="note in ring.notes"
            :key="note.key"
            class="donut-note"
            :data-key="note.key"
          >
            <span class="donut-note-name">{{ note.label }}</span>
            <span class="donut-note-value">{{ note.valueText }}</span>
          </li>
        </ul>
      </div>
    </div>
  </figure>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped>
.donut-chart {
  min-width: 0;
  margin: 0;
  container-type: inline-size;
}

/* The ring, and its legend beside it where both fit, under it where they do not. */
.donut-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  align-items: center;
}

@container (width >= 24rem) {
  .donut-body {
    grid-template-columns: auto minmax(0, 1fr);
  }
}

/* A square of 11rem, which a column of a quota card holds beside nothing and a section beside
   its legend. */
.donut-ring {
  inline-size: 11rem;
  max-inline-size: 100%;
  aspect-ratio: 1;
}

.donut-drawing {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  overflow: visible;
}

/* A sector that only shows is a picture of its part; one that opens something takes the hand. Its
   focus is drawn round its own outline rather than its box, in the ring's colour, and the band
   between sectors keeps it clear of the next. Under the pointer or the keyboard, or with its
   legend entry pointed at, it lifts as every mark does (`seriesFill.css`). */
.donut-sector {
  outline: none;

  &.donut-acts {
    cursor: pointer;
  }

  &:is(:hover, :focus-visible, [data-lifted]) {
    fill: var(--series-lifted);
  }

  &:focus-visible {
    stroke: var(--color-focus-ring);
    stroke-width: var(--size-focus-ring);
    vector-effect: non-scaling-stroke;
  }

  /* The series fill opts out of the forced palette, so its stroke would keep the theme's ring. */
  @media (forced-colors: active) {
    &:focus-visible {
      stroke: Highlight;
    }
  }
}

.donut-keys {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

/* The rows apart: a note on the whole rather than a part of it, their names slanted in the quiet
   ink and their figures at the end of their line, where the legend's figures end. */
.donut-notes {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  font: var(--font-detail);
  list-style: none;
}

.donut-note {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
}

.donut-note-name {
  color: var(--color-text-tertiary);
  font-style: italic;
}

.donut-note-value {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
