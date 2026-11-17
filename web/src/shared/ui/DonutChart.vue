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
 * by its hue alone, and a sector wide enough for it says its share in words on itself, in the ink
 * that reads on every series hue (`labelFits`); a narrower one says it in its hint alone. The
 * sectors stand apart by a gap of ground.
 *
 * A sector is a mark of its chart: its one hint, under the pointer or the keyboard, gives its
 * figure and its share of the whole, and for the rest each part it holds (`markHints.ts` draws the
 * same grid for a period). It stands at the top right of the middle of the sector's band, as a
 * chart's hint stands at its point (`data-hint-point`, `hintPlacement.ts`). The sectors are one stop for Tab, walked round the ring with the arrows,
 * Home and End; a sector whose row opens something (`actionable`) is a button there, pressed with
 * Enter or Space as with the pointer, and sent out as `select` with the row's key, as its legend
 * entry is. A row that leads somewhere (`href`) is followed from its legend entry and the table.
 *
 * Presentational, and it moves nothing under the pointer. With no part above zero it is the
 * chart's empty state. Its table twin is `RankedBarsTable`, which the host shows instead.
 */
import { computed, nextTick, ref } from 'vue'

import { useElementSize } from '@vueuse/core'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { drawnWidth } from '@/shared/lib/textWidth.ts'
import type { PeriodSeries, RankedRow } from '@/shared/ui/chartGeometry.ts'
import { shareWords } from '@/shared/ui/chartGeometry.ts'
import ChartLegend from '@/shared/ui/ChartLegend.vue'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import type { RingSector } from '@/shared/ui/donutGeometry.ts'
import {
  bandMiddle,
  labelFits,
  labelPlace,
  RING_BOX,
  ringOf,
  sectorPath,
} from '@/shared/ui/donutGeometry.ts'
import type { TooltipValue } from '@/shared/ui/tooltipAnchors.ts'
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
  /** A share bare, «42 %», on a sector and against each part of the rest in its hint. */
  formatPart?: (ratio: number) => string
  /** A share of the whole as the reader reads it, «42 % of the total», in hints. */
  formatShare?: (ratio: number) => string
  /** A figure as the reader reads it, for the rest, whose sum no row carries. */
  formatValue: (value: number) => string
}>()

const emit = defineEmits<{ follow: [key: string, press: MouseEvent]; select: [key: string] }>()

const ring = computed(() => ringOf(props.rows))
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

const nameOf = (sector: RingSector) =>
  sector.row ? sector.row.label : props.words.rest(sector.members.length)
const figureOf = (sector: RingSector) => sector.row?.valueText ?? props.formatValue(sector.value)
const shareOf = (sector: RingSector) =>
  shareWords(sector.value, ring.value.whole, props.formatShare)
const pressable = (sector: RingSector) => Boolean(sector.row?.actionable)

const lines = (...parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part)).join('\n')

/**
 * A sector's hint: its name and figure, and its share of the whole, as a grid; for the rest, each
 * part it holds with its figure and bare share. What the name leaves out (`detail`) closes it.
 */
function hintOf(sector: RingSector): TooltipValue {
  const share = shareOf(sector)
  const detail = sector.row?.detail
  const parts = sector.members.map((member) => ({
    key: member.key,
    name: member.label,
    figure: member.valueText,
    share: shareWords(member.value, ring.value.whole, props.formatPart) || undefined,
  }))
  return {
    text: lines(
      [figureOf(sector), share].filter(Boolean).join(', '),
      ...parts.map((part) => `${part.name}: ${part.figure}`),
      detail,
    ),
    body: {
      head: { name: nameOf(sector), figure: figureOf(sector) },
      rows: parts,
      notes: [share, detail].filter((note): note is string => Boolean(note)),
    },
  }
}

/** The legend's entries, in the ring's order: a row's acts as its sector does. */
const legend = computed<PeriodSeries[]>(() =>
  ring.value.sectors.map((sector) => ({
    key: sector.key,
    label: nameOf(sector),
    slot: sector.slot,
    action: sector.row?.action,
    actionable: sector.row?.actionable,
    actsOnPart: sector.row?.actsOnPart,
    href: sector.row?.href,
  })),
)
/** What each entry says in its hint: its figure and its share of the whole. */
const legendHints = computed(
  () =>
    new Map(
      ring.value.sectors.map((sector) => [
        sector.key,
        [figureOf(sector), shareOf(sector)].filter(Boolean).join(', '),
      ]),
    ),
)

/** The ring's box, whose width says how much room a sector has for its share in words. */
const box = ref<HTMLElement | null>(null)
const { width: size } = useElementSize(box)
/** How tall a share in words stands, in pixels: a line of the dense type the axes use. */
const LABEL_HEIGHT = 16
/** Each share that fits on its sector, where it is written there. */
const labels = computed(() => {
  const part = props.formatPart
  if (!part) return []
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-count').trim()
  return drawn.value.flatMap((sector) => {
    const text = part(sector.share)
    const fits = labelFits(sector, size.value, drawnWidth(text, font), LABEL_HEIGHT)
    return fits ? [{ key: sector.key, text, place: labelPlace(sector) }] : []
  })
})
/** Where a share stands over the ring, as shares of its box. */
const labelStyle = (place: { left: number; top: number }) => ({
  insetInlineStart: `${place.left * 100}%`,
  insetBlockStart: `${place.top * 100}%`,
})

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
      <div
        ref="box"
        class="donut-ring"
      >
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
            v-bind="sectorAttrs(sector, index)"
            @click="press(sector)"
            @keydown="(event: KeyboardEvent) => walk(event, index)"
            @focus="stood = index"
          />
        </svg>
        <span
          v-for="one in labels"
          :key="one.key"
          class="donut-share"
          aria-hidden="true"
          :data-key="one.key"
          :style="labelStyle(one.place)"
          >{{ one.text }}</span
        >
      </div>
      <div class="donut-keys">
        <ChartLegend
          class="donut-legend"
          :series="legend"
          :hints="legendHints"
          @follow="(key, event) => emit('follow', key, event)"
          @select="(key) => emit('select', key)"
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

/* A square of 11rem: a band wide enough for a share in words across a tenth of the ring. */
.donut-ring {
  position: relative;
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
   between sectors keeps it clear of the next. */
.donut-sector {
  outline: none;

  &.donut-acts {
    cursor: pointer;
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

/* A share on its sector, centred on the middle of its band, in the ink that reads on every hue of
   the palette. A forced palette draws the sectors in one ink, so the shares give way to the
   legend's hints and the table there. */
.donut-share {
  position: absolute;
  color: var(--color-text-on-series);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  translate: -50% -50%;
  pointer-events: none;

  @media (forced-colors: active) {
    display: none;
  }
}

.donut-keys {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

/* The legend reads down, an entry a line, in the ring's order from its top. */
.donut-legend {
  flex-flow: column nowrap;
}

/* The rows apart: a note on the whole rather than a part of it, their names slanted in the quiet
   ink and their figures at the end of their line. */
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
