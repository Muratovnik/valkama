/**
 * The arithmetic of a ring of shares (`DonutChart`), kept apart from what draws it so a test can
 * hold every number a reader is shown: which rows the ring draws and in what order, what folds
 * into «the rest», each sector's share and place around the ring, its outline, and whether its
 * share fits on it in words.
 *
 * The ring is drawn on a box of `RING_BOX` units a side, from 12 o'clock clockwise, largest first.
 * Nothing here formats a value or knows a word: the caller hands in the rows as `rankRows` takes
 * them, a value as the number it is and the text it reads as.
 */
import { apartInAnyPair } from '@/shared/lib/seriesColors.ts'
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import type { PlacedRow, RankedRow } from '@/shared/ui/chartGeometry.ts'
import { rankRows } from '@/shared/ui/chartGeometry.ts'

/** The most sectors a ring draws, the rest among them: past it the smaller parts fold into one. */
const RING_SECTORS = 5

/** The side of the box the ring is drawn on, its outer and inner radii, in its units. */
export const RING_BOX = 100
const OUTER = 50
const INNER = 31
/** The ground between two sectors, in the box's units: two pixels across a ring of 11rem. */
const GAP = 1.2

/** The key of the sector the smaller parts fold into; no value's key is written so. */
const REST_KEY = ' rest'

/** A part of the ring: a row of the chart, or the smaller rows folded into one. */
export interface RingSector {
  end: number
  key: string
  /** The rows folded into it, largest first, for the rest; none for a row's own sector. */
  members: PlacedRow[]
  /** The row it draws; null for the rest. */
  row: PlacedRow | null
  /** Its share of what the ring draws, from 0 to 1. */
  share: number
  slot: SeriesSlot
  /** Where it starts and ends around the ring, as turns from 12 o'clock clockwise, 0 to 1. */
  start: number
  value: number
}

/** What a ring draws: its sectors, what they add up to, and the rows it lists apart. */
export interface Ring {
  /** The rows of kind `other`, which stand apart from the whole and are never drawn in it. */
  notes: PlacedRow[]
  sectors: RingSector[]
  /** What the sectors add up to: what each share is of. */
  whole: number
}

const drawable = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0)

/**
 * The ring of `rows`: every row with a figure above zero, largest first, work with no value and
 * unknown work among them by their figures (`rankRows` with `rankAll`); past `limit` sectors, the
 * smallest fold into one rest so that the ring draws `limit` in all. A row of kind `other` is no
 * part of the whole: it is listed apart (`notes`). A row's hue is its own `slot`, the colour of its
 * value wherever its page draws it, else its rank's; the rest is `other`, the folded tail's neutral.
 *
 * Any two parts of a ring can stand side by side, so it names a part only where its hue stays
 * apart in any pair from every hue named before it (`apartInAnyPair`), and none in the rest's own
 * neutral: the first part that would not, and every smaller one, fold into the rest. A part is
 * never folded while a smaller one is named. On a page whose ranking is the ring's the first four
 * hues are named; filtered, a value of the fifth or sixth hue can stand among them, and the ring
 * then names fewer rather than two parts a reader could take for one.
 */
export function ringOf(rows: readonly RankedRow[], limit = RING_SECTORS): Ring {
  const { ranked, rest } = rankRows(rows, true)
  const drawn = ranked.filter((row) => drawable(row.value) > 0)
  const whole = drawn.reduce((sum, row) => sum + drawable(row.value), 0)
  const room = drawn.length > limit ? Math.max(0, limit - 1) : drawn.length
  const hueOf = (row: RankedRow, index: number) => row.slot ?? ((index + 1) as SeriesSlot)
  const named: RankedRow[] = []
  for (const row of drawn.slice(0, room)) {
    const hue = hueOf(row, named.length)
    const apart = named.every((one, index) => apartInAnyPair(hue, hueOf(one, index)))
    if (hue === 'other' || !apart) break
    named.push(row)
  }
  const folded = drawn.slice(named.length)
  const parts = named.map((row, index) => ({
    key: row.key,
    value: drawable(row.value),
    slot: hueOf(row, index),
    members: [] as PlacedRow[],
    row: row as PlacedRow | null,
  }))
  if (folded.length)
    parts.push({
      key: REST_KEY,
      value: folded.reduce((sum, row) => sum + drawable(row.value), 0),
      slot: 'other',
      members: folded,
      row: null,
    })
  let at = 0
  const sectors = parts.map((part) => {
    const share = whole ? part.value / whole : 0
    const sector = { ...part, share, start: at, end: at + share }
    at += share
    return sector
  })
  // The last sector closes the ring whatever the sum's rounding left.
  const last = sectors.at(-1)
  if (last) last.end = 1
  return { sectors, whole, notes: rest }
}

/** The point at `radius` from the centre, `turn` of the way round from 12 o'clock. */
function pointAt(turn: number, radius: number) {
  const angle = turn * 2 * Math.PI - Math.PI / 2
  const round = (value: number) => Math.round(value * 1000) / 1000
  return {
    x: round(RING_BOX / 2 + radius * Math.cos(angle)),
    y: round(RING_BOX / 2 + radius * Math.sin(angle)),
  }
}

/** A circle at `radius` as a path of two half arcs, drawn the way `sweep` says. */
function circle(radius: number, sweep: 0 | 1) {
  const top = pointAt(0, radius)
  const bottom = pointAt(0.5, radius)
  return `M ${top.x} ${top.y} A ${radius} ${radius} 0 1 ${sweep} ${bottom.x} ${bottom.y} A ${radius} ${radius} 0 1 ${sweep} ${top.x} ${top.y} Z`
}

/** How far in from a sector's edge, in turns, its outline starts at `radius`: half the gap. */
const inset = (radius: number) => Math.asin(GAP / 2 / radius) / (2 * Math.PI)
/** An arc's large-arc flag: whether it runs past half the ring. */
const largeArc = (from: number, to: number) => (to - from > 0.5 ? 1 : 0)

/**
 * The outline of a sector from `start` to `end` turns: the band between the ring's two radii, its
 * two straight edges drawn in from the next sectors' by half the ground between them, so the gap
 * keeps one width from the inside to the outside. A whole ring has no edge and no gap; a sector
 * too thin to show past its gap draws nothing, and is read in the legend, its hint and the table.
 */
export function sectorPath(start: number, end: number): string {
  const span = end - start
  if (span >= 1) return `${circle(OUTER, 1)} ${circle(INNER, 0)}`
  const outerFrom = start + inset(OUTER)
  const outerTo = end - inset(OUTER)
  if (outerTo <= outerFrom) return ''
  let innerFrom = start + inset(INNER)
  let innerTo = end - inset(INNER)
  if (innerTo < innerFrom) innerFrom = innerTo = (start + end) / 2
  const [a, b] = [pointAt(outerFrom, OUTER), pointAt(outerTo, OUTER)]
  const [c, d] = [pointAt(innerTo, INNER), pointAt(innerFrom, INNER)]
  return [
    `M ${a.x} ${a.y}`,
    `A ${OUTER} ${OUTER} 0 ${largeArc(outerFrom, outerTo)} 1 ${b.x} ${b.y}`,
    `L ${c.x} ${c.y}`,
    `A ${INNER} ${INNER} 0 ${largeArc(innerFrom, innerTo)} 0 ${d.x} ${d.y}`,
    'Z',
  ].join(' ')
}

/**
 * The middle of a sector's band, in the ring's box: where its share is written and the point its
 * hint stands at (`data-hint-point`).
 */
export function bandMiddle(sector: Pick<RingSector, 'start' | 'end'>) {
  return pointAt((sector.start + sector.end) / 2, (OUTER + INNER) / 2)
}

/** Where a sector's share is written: the middle of its band, as shares of the ring's box. */
export function labelPlace(sector: Pick<RingSector, 'start' | 'end'>) {
  const middle = bandMiddle(sector)
  return { left: middle.x / RING_BOX, top: middle.y / RING_BOX }
}

/** The room a label keeps from its sector's edges on each side, in pixels. */
const LABEL_AIR = 4

/**
 * Whether words `width` by `height` pixels fit inside a sector of a ring `size` pixels across:
 * as wide as the chord across the sector through the middle of its band, and as tall as the band,
 * each less the air the label keeps on both sides. Where they do not, the share is said by the
 * sector's hint and the table and never cut by its own sector.
 */
export function labelFits(
  sector: Pick<RingSector, 'start' | 'end'>,
  size: number,
  width: number,
  height: number,
) {
  if (size <= 0 || width <= 0) return false
  const scale = size / RING_BOX
  const band = (OUTER - INNER) * scale
  const middle = ((OUTER + INNER) / 2) * scale
  const span = Math.min(sector.end - sector.start, 0.5) * 2 * Math.PI
  const chord = 2 * middle * Math.sin(span / 2) - GAP * scale
  return band >= height + 2 * LABEL_AIR && chord >= width + 2 * LABEL_AIR
}
