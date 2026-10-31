/**
 * The branch map in pixels: the lanes of `chainBranchLayout` scaled to a width,
 * with each lane's paths, its stem from the lane it forked from, the dots and
 * reference labels that fit, and where its label line and its pointer target
 * stand.
 *
 * Every member keeps the same width, so the drawing scales by one number: a
 * unit as wide as fits, up to a comfortable maximum. The one exception is a
 * lane too short to read as one, which is drawn at a least length its members
 * share. Below a few pixels a lane is drawn as one run per state, because three
 * hundred one-pixel segments are three hundred elements that say nothing more
 * than one stroke does.
 */

import {
  CHARACTER,
  LABEL_GAP,
  labelHeight,
  laneHead,
} from '@/widgets/work-item-inspector/utils/chainBranchHead.ts'
import type { Box, LaneTexts } from '@/widgets/work-item-inspector/utils/chainBranchHead.ts'
import { laneRuns } from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'
import type {
  BranchLane,
  BranchLayout,
  LaneFork,
} from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'

/**
 * The member under an x position on this lane, clamped to its ends. A lane
 * drawn at its least length spreads its members over it, `step` apart.
 */
export function taskIndexAt(lane: BranchLane, x: number, unit: number, step = unit): number {
  const index = Math.floor((x - lane.start * unit) / step)
  return Math.min(lane.members.length - 1, Math.max(0, index))
}

/** The widest a unit is drawn, so that a short chain does not read as a long one. */
const MAX_UNIT = 26
/**
 * The least length a lane is drawn at. In a map of six hundred members a lane of
 * one is a pixel long and reads as a stray mark under its label rather than as a
 * lane; at this length it is plainly a lane, and still plainly the shortest. Its
 * members share the length evenly, and a dot closes it, so its end is as clear
 * as its start.
 */
const LEAST_LANE = 16
/** Below this a unit is too narrow to read alone, and a lane is drawn as runs. */
const DENSE_UNIT = 6
/** From this width a unit has room for a dot at each junction. */
const DOT_UNIT = 10
const DOT_RADIUS = 2.5
/** The stroke band, the reference line under it, the gap between lanes. */
const LANE_BAND = 16
const LANE_REFERENCES = 18
const LANE_GAP = 8
/** How far a stem bends into the lane it leads to. */
const STEM_RADIUS = 6
const LABEL_PADDING = 8
/** Between two reference labels: wide enough that three of them read as three, not as one line of text. */
const REFERENCE_GAP = 14
/** A lone member in a merged lane is drawn at least this wide, centred where it is. */
const LEAST_RUN = 4
/** A raised mark's height, which is also its least length, and the gap between two. */
const PILL = 7
const PILL_GAP = 1
/** How far past its ends a lane's pointer target reaches, and its least width. */
const SLACK = 6
const LEAST_TARGET = 24
/** The highlight over the task being looked at: at least this wide, this tall. */
const LEAST_MARK = 4
const MARK_HEIGHT = 9
const TIP_GAP = 4

/**
 * Finished and waiting work first and current work over it, so a lone review
 * drawn wider than its unit lies over its neighbours rather than under them.
 */
const PAINT_ORDER: readonly ChainGroup[] = [
  'done',
  'backlog',
  'queued',
  'active',
  'review',
  'blocked',
]

/** Work under way or stuck: what a reader names beside a segment, and what a dense lane raises. */
const CURRENT = new Set<ChainGroup>(['review', 'active', 'blocked'])

interface BranchLabel {
  box: Box
  index: number
  reference: string
}

interface GroupPath {
  d: string
  group: ChainGroup
}

/**
 * A raised mark over a stretch of work under way or stuck, in a lane whose
 * units are a pixel or two: at the line's weight it would vanish. A mark is at
 * least as long as it is tall, and marks side by side are moved apart rather
 * than drawn over each other, so each keeps its colour; the line under them
 * stays where the members are.
 */
interface BranchPill {
  from: number
  group: ChainGroup
  left: number
  right: number
  to: number
}

export interface LaneDrawing {
  /** The lane's pointer and keyboard target: its stroke band, a little wider than the lane. */
  band: Box
  /** The label line ends where the lane starts instead of starting beside it. */
  before: boolean
  /** One path of junction dots per group, empty where a unit has no room for them. */
  dots: GroupPath[]
  /** Where the lane's label line stands. */
  head: Box
  /** The label line stands beside the lane on its own line, rather than above it. */
  inline: boolean
  labels: BranchLabel[]
  lane: BranchLane
  /** Each group's stretches as one path, so a lane is a handful of elements. */
  paths: GroupPath[]
  /** The raised marks of a dense lane, and the same as one path per group. */
  pills: BranchPill[]
  raised: GroupPath[]
  /** The label and its counts on two lines, where one line fits nowhere. */
  stacked: boolean
  stem: string | null
  /** How far apart its members are drawn: the unit, or more on a lane drawn at its least length. */
  step: number
  top: number
  x0: number
  x1: number
  /** The centre of the lane's stroke. */
  y: number
}

interface BranchDrawing {
  dense: boolean
  dots: boolean
  height: number
  lanes: LaneDrawing[]
  unit: number
  width: number
}

interface DrawScale {
  /** For each row, the x of every stem crossing it. */
  crossing: number[][]
  dense: boolean
  dots: boolean
  stems: Map<string, number[]>
  unit: number
  width: number
  texts: (lane: BranchLane) => LaneTexts
}

/** How far apart a lane's members are drawn: one unit, unless that leaves the lane shorter than its least length. */
function stepOf(lane: BranchLane, unit: number): number {
  return Math.max(unit, LEAST_LANE / Math.max(1, lane.members.length))
}

/**
 * The unit: as wide as fits, up to a comfortable maximum, and narrow enough that
 * a lane stretched to its least length still ends inside the width. Narrowing
 * can shorten another lane below its least, so it repeats until nothing moves.
 */
function unitFor(layout: BranchLayout, width: number): number {
  let unit = layout.extent ? Math.min(MAX_UNIT, width / layout.extent) : MAX_UNIT
  for (let changed = true; changed;) {
    changed = false
    for (const lane of layout.lanes) {
      const end = lane.start * unit + lane.members.length * stepOf(lane, unit)
      if (lane.start > 0 && end > width + 1e-9) {
        const fits = Math.max(0, (width - LEAST_LANE) / lane.start)
        if (fits < unit) changed = true
        unit = Math.min(unit, fits)
      }
    }
  }
  return unit
}

const num = (value: number) => value.toFixed(2)

function groupPaths(parts: Map<ChainGroup, string[]>): GroupPath[] {
  return PAINT_ORDER.filter((group) => parts.has(group)).map((group) => ({
    group,
    d: (parts.get(group) ?? []).join(' '),
  }))
}

function push(parts: Map<ChainGroup, string[]>, group: ChainGroup, part: string) {
  parts.set(group, [...(parts.get(group) ?? []), part])
}

/** Where a lane is drawn along x: its start, and how far apart its members are. */
interface LaneSpan {
  step: number
  x0: number
}

function lanePaths(lane: BranchLane, at: LaneSpan, y: number, dense: boolean): GroupPath[] {
  const least = dense ? LEAST_RUN : 0
  const inset = dense ? 0 : Math.min(1, at.step / 8)
  const parts = new Map<ChainGroup, string[]>()
  for (const run of laneRuns(lane, dense)) {
    const left = at.x0 + run.from * at.step + inset
    const right = at.x0 + run.to * at.step - inset
    const spread = Math.max(0, least - (right - left)) / 2
    push(parts, run.group, `M${num(left - spread)},${num(y)} H${num(right + spread)}`)
  }
  return groupPaths(parts)
}

function lanePills(lane: BranchLane, at: LaneSpan): BranchPill[] {
  const pills: BranchPill[] = []
  let edge = -Infinity
  for (const run of laneRuns(lane, true)) {
    if (!CURRENT.has(run.group)) continue
    const from = at.x0 + run.from * at.step
    const to = at.x0 + run.to * at.step
    const length = Math.max(PILL, to - from)
    const left = Math.max(edge + PILL_GAP, (from + to - length) / 2)
    pills.push({ group: run.group, from: run.from, to: run.to, left, right: left + length })
    edge = left + length
  }
  return pills
}

/** The marks as paths: a round-capped line, so its caps are the mark's rounded ends. */
function pillPaths(pills: BranchPill[], y: number): GroupPath[] {
  const parts = new Map<ChainGroup, string[]>()
  for (const pill of pills)
    push(
      parts,
      pill.group,
      `M${num(pill.left + PILL / 2)},${num(y)} H${num(pill.right - PILL / 2)}`,
    )
  return groupPaths(parts)
}

/** A dot centred on `x`, as one subpath. */
function dot(x: number, y: number): string {
  const arc = `a${DOT_RADIUS},${DOT_RADIUS} 0 1,0`
  return `M${num(x - DOT_RADIUS)},${num(y)} ${arc} ${2 * DOT_RADIUS},0 ${arc} ${-2 * DOT_RADIUS},0`
}

/**
 * A dot at every junction where a unit has room for one, in the colour of the
 * member that starts there; and on a lane drawn at its least length, a dot that
 * closes it, in the colour of its last member, inside its end.
 */
function laneDots(lane: BranchLane, at: LaneSpan, y: number, scale: DrawScale): GroupPath[] {
  const parts = new Map<ChainGroup, string[]>()
  if (scale.dots)
    for (const [index, group] of lane.groups.entries())
      if (index) push(parts, group, dot(at.x0 + index * at.step, y))
  const last = lane.groups.at(-1)
  if (at.step > scale.unit && last)
    push(parts, last, dot(at.x0 + lane.members.length * at.step - DOT_RADIUS, y))
  return groupPaths(parts)
}

/** A reference label's width: its text at the estimate, and the padding around it. */
function referenceWidth(text: string): number {
  return text.length * CHARACTER + LABEL_PADDING
}

/**
 * Reference labels for current work, under the segments they name, where one
 * fits without touching the last or a stem leaving this lane. When some do not
 * fit, a last label says how many were left out — «+12» — so three references
 * never read as all fifteen; it takes the place of the last reference that
 * fits when there is no room for it after that one.
 */
function laneLabels(lane: BranchLane, at: LaneSpan, y: number, scale: DrawScale): BranchLabel[] {
  const { width } = scale
  const avoid = scale.stems.get(lane.key) ?? []
  const top = y + LANE_BAND / 2
  const clear = (left: number, right: number) =>
    left >= 0 &&
    right <= width &&
    !avoid.some((stem) => stem > left - LABEL_GAP && stem < right + LABEL_GAP)
  const labels: BranchLabel[] = []
  let edge = -Infinity
  let current = 0
  let first: number | null = null
  for (const [index, member] of lane.members.entries()) {
    if (!CURRENT.has(lane.groups[index])) continue
    current += 1
    const labelWidth = referenceWidth(member.reference)
    const centre = at.x0 + (index + 0.5) * at.step
    const left = Math.max(0, Math.min(width - labelWidth, centre - labelWidth / 2))
    first ??= left
    if (left < edge + REFERENCE_GAP || !clear(left, left + labelWidth)) continue
    labels.push({ index, reference: member.reference, box: { top, left, width: labelWidth } })
    edge = left + labelWidth
  }
  // Where the count of the rest goes: after the last reference, or in its place.
  let rest = labels.length ? edge + REFERENCE_GAP : (first ?? at.x0)
  for (;;) {
    const omitted = current - labels.length
    if (omitted === 0) return labels
    const reference = `+${omitted}`
    const labelWidth = referenceWidth(reference)
    if (clear(rest, rest + labelWidth)) {
      labels.push({ index: -1, reference, box: { top, left: rest, width: labelWidth } })
      return labels
    }
    const dropped = labels.pop()
    if (!dropped) return labels
    rest = dropped.box.left ?? 0
  }
}

/** Where the stem of a lane's fork leaves its parent's line. */
function stemX(parent: BranchLane, fork: LaneFork, unit: number): number {
  const x0 = parent.start * unit
  return fork.index < 0 ? x0 : x0 + (fork.index + 0.5) * stepOf(parent, unit)
}

/** The x of every stem leaving each lane, which its reference labels keep clear of. */
function stemsByLane(layout: BranchLayout, unit: number): Map<string, number[]> {
  const byKey = new Map(layout.lanes.map((lane) => [lane.key, lane]))
  const stems = new Map<string, number[]>()
  for (const lane of layout.lanes) {
    const parent = lane.fork && byKey.get(lane.fork.lane)
    if (!lane.fork || !parent) continue
    stems.set(parent.key, [...(stems.get(parent.key) ?? []), stemX(parent, lane.fork, unit)])
  }
  return stems
}

/**
 * The x of every stem passing each row on its way down: a stem leaves its
 * parent's line and crosses every row between that one and its own lane's.
 */
function stemsAcross(layout: BranchLayout, unit: number): number[][] {
  const rows = layout.lanes.map(() => [] as number[])
  const rowOf = new Map(layout.lanes.map((lane, row) => [lane.key, row]))
  for (const [row, lane] of layout.lanes.entries()) {
    const parentRow = lane.fork ? rowOf.get(lane.fork.lane) : undefined
    if (!lane.fork || parentRow === undefined) continue
    const x = stemX(layout.lanes[parentRow], lane.fork, unit)
    for (let between = parentRow + 1; between < row; between += 1) rows[between].push(x)
  }
  return rows
}

/** The stem from the parent's line down to this lane's, bending into it. */
function stemPath(x: number, from: number, to: number, x0: number): string {
  const radius = Math.min(STEM_RADIUS, (to - from) / 2)
  const bend = `M${num(x)},${num(from)} V${num(to - radius)} Q${num(x)},${num(to)} ${num(x + radius)},${num(to)}`
  return x0 > x + radius ? `${bend} H${num(x0)}` : bend
}

function laneBand(y: number, x0: number, x1: number, width: number): Box {
  const left = Math.max(0, x0 - SLACK)
  const right = Math.min(width, Math.max(x1 + SLACK, x0 + LEAST_TARGET))
  return { top: y - LANE_BAND / 2, left, width: right - left, height: LANE_BAND }
}

function drawLane(
  lane: BranchLane,
  spot: { parent: LaneDrawing | undefined; row: number; top: number },
  scale: DrawScale,
): LaneDrawing {
  const { unit, width, dense } = scale
  const { parent, top } = spot
  const at = { x0: lane.start * unit, step: stepOf(lane, unit) }
  const { x0 } = at
  const x1 = x0 + lane.members.length * at.step
  const stem = lane.fork && parent ? stemX(parent.lane, lane.fork, unit) : null
  const crossing = scale.crossing[spot.row] ?? []
  const { before, head, inline, stacked } = laneHead(
    scale.texts(lane),
    { crossing, stem, top, x0, x1 },
    width,
  )
  const label = labelHeight(stacked)
  // A label beside the lane is centred on its line; one above it takes a row.
  const y = inline ? top + Math.max(label, LANE_BAND) / 2 : top + label + LANE_BAND / 2
  const pills = dense ? lanePills(lane, at) : []
  return {
    lane,
    top,
    y,
    x0,
    x1,
    step: at.step,
    head,
    before,
    inline,
    stacked,
    band: laneBand(y, x0, x1, width),
    stem: stem === null || !parent ? null : stemPath(stem, parent.y, y, x0),
    paths: lanePaths(lane, at, y, dense),
    pills,
    raised: pillPaths(pills, y),
    dots: laneDots(lane, at, y, scale),
    labels: dense ? [] : laneLabels(lane, at, y, scale),
  }
}

/**
 * The layout at a width, in pixels. The unit is as wide as fits, up to a
 * comfortable maximum; below a few pixels a lane becomes runs, and dots and
 * reference labels appear only where a unit has room for them. `texts` names
 * what each lane's label line will say, so the line can be placed where it fits.
 */
export function drawBranches(
  layout: BranchLayout,
  width: number,
  texts: (lane: BranchLane) => LaneTexts = (lane) => ({ name: lane.reference ?? '', counts: '' }),
): BranchDrawing {
  const unit = unitFor(layout, width)
  const scale: DrawScale = {
    unit,
    width,
    texts,
    dense: unit < DENSE_UNIT,
    dots: unit >= DOT_UNIT,
    stems: stemsByLane(layout, unit),
    crossing: stemsAcross(layout, unit),
  }
  const byKey = new Map<string, LaneDrawing>()
  let top = 0
  for (const [row, lane] of layout.lanes.entries()) {
    const parent = lane.fork ? byKey.get(lane.fork.lane) : undefined
    const drawn = drawLane(lane, { parent, row, top }, scale)
    byKey.set(lane.key, drawn)
    const below = drawn.labels.length ? LANE_REFERENCES : 0
    const label = drawn.inline ? labelHeight(drawn.stacked) / 2 : 0
    top = drawn.y + Math.max(LANE_BAND / 2 + below, label) + LANE_GAP
  }
  const lanes = [...byKey.values()]
  return {
    unit,
    dense: scale.dense,
    dots: scale.dots,
    width,
    lanes,
    height: lanes.length ? top - LANE_GAP : 0,
  }
}

/**
 * Where a member is drawn: its own unit, or its share of the raised mark it
 * belongs to, which may stand a few pixels from the unit in a dense lane.
 */
function taskSpan(lane: LaneDrawing, index: number) {
  const pill = lane.pills.find((entry) => index >= entry.from && index < entry.to)
  if (!pill) {
    const left = lane.x0 + index * lane.step
    return { left, right: left + lane.step }
  }
  const share = (pill.right - pill.left) / (pill.to - pill.from)
  const left = pill.left + (index - pill.from) * share
  return { left, right: left + share }
}

/**
 * The member under an x position on a drawn lane: inside a raised mark, the
 * member whose share of the mark it is; elsewhere the unit it falls in.
 */
export function taskAt(lane: LaneDrawing, x: number, unit: number): number {
  const pill = lane.pills.find((entry) => x >= entry.left && x < entry.right)
  if (!pill) return taskIndexAt(lane.lane, x, unit, lane.step)
  const share = (pill.right - pill.left) / (pill.to - pill.from)
  return Math.min(pill.to - 1, pill.from + Math.floor((x - pill.left) / share))
}

/** The highlight over the task being looked at: where it is drawn, at least a few pixels wide. */
export function markAt(lane: LaneDrawing, index: number) {
  const span = taskSpan(lane, index)
  const width = Math.max(span.right - span.left, LEAST_MARK)
  const centre = (span.left + span.right) / 2
  return { x: centre - width / 2, y: lane.y - MARK_HEIGHT / 2, width, height: MARK_HEIGHT }
}

/**
 * The readout for the task it names, centred on the task inside the map's
 * width. It stands above the lane's label line, so the lane's own name and
 * counts stay readable while its tasks are read one by one, and so do the lanes
 * below; unless there is not room for it there — the first lane at the top of a
 * scrolled panel — and then just below the lane's line.
 */
export function tipAt(
  lane: LaneDrawing,
  index: number,
  drawing: BranchDrawing,
  tip: { above: boolean; width: number },
): Box {
  const width = Math.min(tip.width, drawing.width)
  const span = taskSpan(lane, index)
  const centre = (span.left + span.right) / 2
  const left = Math.max(0, Math.min(drawing.width - width, centre - width / 2))
  return tip.above
    ? { bottom: drawing.height - (lane.top - TIP_GAP), left, width }
    : { top: (lane.band.top ?? 0) + LANE_BAND + TIP_GAP, left, width }
}
