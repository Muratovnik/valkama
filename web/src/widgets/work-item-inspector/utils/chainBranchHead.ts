/**
 * Where a branch-map lane's label line stands: the lane's name and counts,
 * placed against the lane they name and clear of the stems that cross its row.
 *
 * Pure, and apart from the drawing, because it is the one decision there made
 * from estimated text widths rather than from the chain.
 */

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

/** A length of the drawing as a style value; an absent one sets nothing. */
function px(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value}px`
}

/** A box of the drawing as a style, in the logical properties the map is laid out by. */
export function boxStyle(box: Box) {
  return {
    insetBlockStart: px(box.top),
    insetBlockEnd: px(box.bottom),
    insetInlineStart: px(box.left),
    insetInlineEnd: px(box.right),
    width: px(box.width),
    height: px(box.height),
    minWidth: px(box.minWidth),
    maxWidth: px(box.maxWidth),
  }
}

/** The two texts a lane's label line carries, as the component will set them. */
export interface LaneTexts {
  counts: string
  name: string
}

/** The label line on one line, and on two where label and counts fit nowhere on one. */
const LANE_LABEL = 24
const LANE_LABEL_STACKED = 42

/** A label line's height, on one line or two. */
export function labelHeight(stacked: boolean): number {
  return stacked ? LANE_LABEL_STACKED : LANE_LABEL
}

/**
 * An estimate of a text's advance at the interface size, enough to decide where
 * a label fits; a label that is wider than estimated ends in an ellipsis rather
 * than running into anything. A reference is set heavier than running text.
 */
export const CHARACTER = 7
const REFERENCE_CHARACTER = 8.5
const HEAD_GAP = 8
/** Room left over an estimate, so a label that comes out a little wider still fits. */
const SLACK_FACTOR = 1.1
export const LABEL_GAP = 6

/** Where a lane's label and counts go: around its own line, from `x0` to `x1`, and its stem. */
interface HeadSpot {
  /** The x of every stem crossing the lane's row, which the line keeps clear of. */
  crossing: readonly number[]
  stem: number | null
  top: number
  x0: number
  x1: number
}

/** Where a lane's label line stands: its box, and how it sits against the lane. */
export interface HeadPlace {
  /** The line ends where the lane starts, instead of starting where the lane does. */
  before: boolean
  head: Box
  /** On the lane's own line, beside it, rather than above it. */
  inline: boolean
  stacked: boolean
}

/**
 * Where a lane's label line stands, the first of these that fits clear of
 * every stem crossing its row. Beside the lane on its own line wherever there
 * is room — after its end, which is where a reader's eye leaves it — so the
 * label reads as the lane's and the map spends no row on it. Above a lane that
 * fills the width, starting where the lane starts and running to its end, so
 * the counts stand where it stops. Beside the lane's start on its line, ending
 * where the lane begins. Then the same on two lines; and only where none of
 * that fits, two lines above the lane as far along as the width allows. A
 * label used to end at its stem a row above its lane, which on a long chain
 * stacked the short lanes' labels into a staircase away from what they named.
 */
export function laneHead(texts: LaneTexts, spot: HeadSpot, width: number): HeadPlace {
  const name = texts.name.length * REFERENCE_CHARACTER * SLACK_FACTOR
  const counts = texts.counts.length * CHARACTER * SLACK_FACTOR
  const free = (left: number, right: number) =>
    left >= 0 &&
    right <= width &&
    !crossing.some((x) => x > left - LABEL_GAP && x < right + LABEL_GAP)
  const { crossing, top, x0, x1, stem } = spot
  const anchor = stem === null ? x0 : stem + LABEL_GAP
  const after = x1 + HEAD_GAP
  const end = (stem ?? x0) - LABEL_GAP
  const ending = (stacked: boolean): HeadPlace => ({
    before: true,
    inline: true,
    stacked,
    head: { top, right: width - end, maxWidth: end },
  })
  for (const stacked of [false, true]) {
    const need = stacked ? Math.max(name, counts) : name + HEAD_GAP + counts
    if (free(after, after + need))
      return { before: false, inline: true, stacked, head: { top, left: after } }
    if (free(anchor, anchor + need)) {
      const minWidth = stacked ? undefined : Math.max(0, x1 - anchor)
      return {
        before: false,
        inline: false,
        stacked,
        head: { top, left: anchor, minWidth, maxWidth: width - anchor },
      }
    }
    if (free(end - need, end)) return ending(stacked)
  }
  const left = Math.max(0, Math.min(anchor, width - Math.max(name, counts)))
  return {
    before: false,
    inline: false,
    stacked: true,
    head: { top, left, maxWidth: width - left },
  }
}
