/**
 * The branch map in pixels: the lanes of `chainBranchLayout` scaled to a width,
 * with each lane's paths, its stem from the lane it forked from, the dots and
 * reference labels that fit, and where its label line and its pointer target
 * stand.
 *
 * Every member keeps the same width, so the drawing scales by one number: a
 * unit as wide as fits, up to a comfortable maximum. Below a few pixels a lane
 * is drawn as one run per state, because three hundred one-pixel segments are
 * three hundred elements that say nothing more than one stroke does.
 */

import { laneRuns } from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'
import type {
  BranchLane,
  BranchLayout,
  LaneFork,
} from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'

/** The member under an x position on this lane, clamped to its ends. */
export function taskIndexAt(lane: BranchLane, x: number, unit: number): number {
  const index = Math.floor(x / unit - lane.start)
  return Math.min(lane.members.length - 1, Math.max(0, index))
}

/** The widest a unit is drawn, so that a short chain does not read as a long one. */
const MAX_UNIT = 26
/** Below this a unit is too narrow to read alone, and a lane is drawn as runs. */
const DENSE_UNIT = 6
/** From this width a unit has room for a dot at each junction. */
const DOT_UNIT = 10
const DOT_RADIUS = 2.5
/**
 * The label line above a lane — two lines when the label and its counts have
 * room nowhere on one — its stroke band, the reference line under it, the gap.
 */
const LANE_LABEL = 24
const LANE_LABEL_STACKED = 42
const LANE_BAND = 16
const LANE_REFERENCES = 18
const LANE_GAP = 8
/** How far a stem bends into the lane it leads to. */
const STEM_RADIUS = 6
/**
 * An estimate of a text's advance at the interface size, enough to decide where
 * a label fits; a label that is wider than estimated ends in an ellipsis rather
 * than running into anything. A reference is set heavier than running text.
 */
const CHARACTER = 7
const REFERENCE_CHARACTER = 8.5
const HEAD_GAP = 8
/** Room left over an estimate, so a label that comes out a little wider still fits. */
const SLACK_FACTOR = 1.1
const LABEL_PADDING = 8
const LABEL_GAP = 6
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

/** A box in the map's own pixels. */
export interface Box {
  /** From the map's bottom edge, for a box that grows upward from a point. */
  bottom?: number
  height?: number
  /** From the map's start edge, or — for a box that ends at a point — `right` from its end edge. */
  left?: number
  maxWidth?: number
  minWidth?: number
  right?: number
  top?: number
  width?: number
}

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
  /** The label line ends at its stem instead of starting beside it. */
  before: boolean
  /** One path of junction dots per group, empty where a unit has no room for them. */
  dots: GroupPath[]
  /** Where the lane's label line stands. */
  head: Box
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

/** The two texts a lane's label line carries, as the component will set them. */
interface LaneTexts {
  counts: string
  name: string
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

function lanePaths(lane: BranchLane, unit: number, y: number, dense: boolean): GroupPath[] {
  const least = dense ? LEAST_RUN : 0
  const inset = dense ? 0 : Math.min(1, unit / 8)
  const parts = new Map<ChainGroup, string[]>()
  for (const run of laneRuns(lane, dense)) {
    const left = (lane.start + run.from) * unit + inset
    const right = (lane.start + run.to) * unit - inset
    const spread = Math.max(0, least - (right - left)) / 2
    push(parts, run.group, `M${num(left - spread)},${num(y)} H${num(right + spread)}`)
  }
  return groupPaths(parts)
}

function lanePills(lane: BranchLane, unit: number): BranchPill[] {
  const pills: BranchPill[] = []
  let edge = -Infinity
  for (const run of laneRuns(lane, true)) {
    if (!CURRENT.has(run.group)) continue
    const from = (lane.start + run.from) * unit
    const to = (lane.start + run.to) * unit
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

/** A dot at every junction, in the colour of the member that starts there. */
function laneDots(lane: BranchLane, unit: number, y: number): GroupPath[] {
  const parts = new Map<ChainGroup, string[]>()
  const arc = `a${DOT_RADIUS},${DOT_RADIUS} 0 1,0`
  for (const [index, group] of lane.groups.entries()) {
    if (!index) continue
    const left = (lane.start + index) * unit - DOT_RADIUS
    push(
      parts,
      group,
      `M${num(left)},${num(y)} ${arc} ${2 * DOT_RADIUS},0 ${arc} ${-2 * DOT_RADIUS},0`,
    )
  }
  return groupPaths(parts)
}

/**
 * Reference labels for current work, under the segments they name, where one
 * fits without touching the last or a stem leaving this lane.
 */
function laneLabels(lane: BranchLane, y: number, scale: DrawScale): BranchLabel[] {
  const { unit, width } = scale
  const avoid = scale.stems.get(lane.key) ?? []
  const labels: BranchLabel[] = []
  let edge = -Infinity
  for (const [index, member] of lane.members.entries()) {
    if (!CURRENT.has(lane.groups[index])) continue
    const labelWidth = member.reference.length * CHARACTER + LABEL_PADDING
    const centre = (lane.start + index + 0.5) * unit
    const left = Math.max(0, Math.min(width - labelWidth, centre - labelWidth / 2))
    const right = left + labelWidth
    const crossed = avoid.some((stem) => stem > left - LABEL_GAP && stem < right + LABEL_GAP)
    if (left < edge + LABEL_GAP || crossed) continue
    labels.push({
      index,
      reference: member.reference,
      box: { top: y + LANE_BAND / 2, left, width: labelWidth },
    })
    edge = right
  }
  return labels
}

/** Where the stem of a lane's fork leaves its parent's line. */
function stemX(parent: BranchLane, fork: LaneFork, unit: number): number {
  return fork.index < 0 ? parent.start * unit : (parent.start + fork.index + 0.5) * unit
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

/** Where a lane's label and counts go, around the stem `anchor` stands beside. */
interface HeadSpot {
  anchor: number
  row: number
  stem: number | null
  top: number
  x1: number
}

/**
 * Where a lane's label line stands, the first of these that fits clear of
 * every stem crossing its row: on one line beside its stem, running to the
 * lane's end so the counts stand where it stops; on one line ending at the stem;
 * on two lines beside it; on two lines ending at it. A lane with no room
 * anywhere keeps two lines as far along as the width allows.
 */
function laneHead(lane: BranchLane, spot: HeadSpot, scale: DrawScale) {
  const { width } = scale
  const texts = scale.texts(lane)
  const name = texts.name.length * REFERENCE_CHARACTER * SLACK_FACTOR
  const counts = texts.counts.length * CHARACTER * SLACK_FACTOR
  const crossing = scale.crossing[spot.row] ?? []
  const free = (left: number, right: number) =>
    left >= 0 &&
    right <= width &&
    !crossing.some((x) => x > left - LABEL_GAP && x < right + LABEL_GAP)
  const { anchor, top, x1, stem } = spot
  const end = stem === null ? -1 : stem - LABEL_GAP
  for (const stacked of [false, true]) {
    const need = stacked ? Math.max(name, counts) : name + HEAD_GAP + counts
    if (free(anchor, anchor + need)) {
      const minWidth = stacked ? undefined : Math.max(0, x1 - anchor)
      return {
        before: false,
        stacked,
        head: { top, left: anchor, minWidth, maxWidth: width - anchor },
      }
    }
    if (free(end - need, end))
      return { before: true, stacked, head: { top, right: width - end, maxWidth: end } }
  }
  const left = Math.max(0, Math.min(anchor, width - Math.max(name, counts)))
  return { before: false, stacked: true, head: { top, left, maxWidth: width - left } }
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
  const x0 = lane.start * unit
  const x1 = (lane.start + lane.members.length) * unit
  const stem = lane.fork && parent ? stemX(parent.lane, lane.fork, unit) : null
  const anchor = stem === null ? x0 : stem + LABEL_GAP
  const { before, head, stacked } = laneHead(lane, { anchor, row: spot.row, stem, top, x1 }, scale)
  const y = top + (stacked ? LANE_LABEL_STACKED : LANE_LABEL) + LANE_BAND / 2
  const pills = dense ? lanePills(lane, unit) : []
  return {
    lane,
    top,
    y,
    x0,
    x1,
    head,
    before,
    stacked,
    band: laneBand(y, x0, x1, width),
    stem: stem === null || !parent ? null : stemPath(stem, parent.y, y, x0),
    paths: lanePaths(lane, unit, y, dense),
    pills,
    raised: pillPaths(pills, y),
    dots: scale.dots ? laneDots(lane, unit, y) : [],
    labels: dense ? [] : laneLabels(lane, y, scale),
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
  const unit = layout.extent ? Math.min(MAX_UNIT, width / layout.extent) : MAX_UNIT
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
    top = drawn.y + LANE_BAND / 2 + below + LANE_GAP
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
function taskSpan(lane: LaneDrawing, index: number, unit: number) {
  const pill = lane.pills.find((entry) => index >= entry.from && index < entry.to)
  if (!pill) {
    const left = (lane.lane.start + index) * unit
    return { left, right: left + unit }
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
  if (!pill) return taskIndexAt(lane.lane, x, unit)
  const share = (pill.right - pill.left) / (pill.to - pill.from)
  return Math.min(pill.to - 1, pill.from + Math.floor((x - pill.left) / share))
}

/** The highlight over the task being looked at: where it is drawn, at least a few pixels wide. */
export function markAt(lane: LaneDrawing, index: number, unit: number) {
  const span = taskSpan(lane, index, unit)
  const width = Math.max(span.right - span.left, LEAST_MARK)
  const centre = (span.left + span.right) / 2
  return { x: centre - width / 2, y: lane.y - MARK_HEIGHT / 2, width, height: MARK_HEIGHT }
}

/**
 * The readout for the task it names, centred on the task inside the map's
 * width. It stands just above the lane's line, so the lanes below stay
 * readable, unless there is not room for it there — the first lane at the top
 * of a scrolled panel — and then just below.
 */
export function tipAt(
  lane: LaneDrawing,
  index: number,
  drawing: BranchDrawing,
  tip: { above: boolean; width: number },
): Box {
  const width = Math.min(tip.width, drawing.width)
  const span = taskSpan(lane, index, drawing.unit)
  const centre = (span.left + span.right) / 2
  const left = Math.max(0, Math.min(drawing.width - width, centre - width / 2))
  const band = lane.band.top ?? 0
  return tip.above
    ? { bottom: drawing.height - (band - TIP_GAP), left, width }
    : { top: band + LANE_BAND + TIP_GAP, left, width }
}
