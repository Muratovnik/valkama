/**
 * The rules the Analytics sweep (`analyticsSweep.ts`) judges what it measured by, apart from the
 * browser so each can be checked on made-up geometry (`tests/analyticsSweepRules.test.ts`). Each
 * rule is the product's, as `DESIGN.md` and `src/shared/ui/hintReach.ts` state it, and not what
 * the code does today: a sweep that took its expectation from the code would pass whatever the
 * code does.
 *
 * Hover reach: within a mark's reach its own hint wins, the nearest of several; two marks within
 * a pixel of each other may answer either. On a step line one layer takes the pointer for every
 * mark and finds a place (a restart, a reset, «now», the forecast) before any reading within a
 * mark's reach, the nearest of several, and elsewhere the mark whose stretch holds the pointer.
 * A mark's hint stands at that mark (`data-hint-mark`, `data-hint-point`), its start `OFFSET`
 * past it, or over it where no side has room.
 *
 * Overflow: the shell owns one page scroll, each Analytics column scrolls up and down, and only a
 * row of periods or a table wider than its column scrolls sideways, in a frame of its own; a span
 * whose periods all fit never scrolls, and the record of an action's 28px scrolling four weeks by
 * a few pixels is why a scroll shorter than the least target counts as none of the design's.
 */

/** A box in the window's pixels. */
export interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

/** A point in the window's pixels. */
export interface Point {
  x: number
  y: number
}

/** How far a hint stands from its mark, as `hintPlacement.ts` names it (`OFFSET`), in px. */
const OFFSET = 6

/** Two marks this close to the pointer may either answer it, in px. */
const TWINS = 1

/** How far off a mark's centre the pointer is put on each axis, in px. */
export const NUDGE = 3

/**
 * Rounding and subpixel layout a placement is allowed past `OFFSET`, in px: the library rounds
 * the hint's place, and a box measured at a fraction may land a pixel either way.
 */
const PLACE_SLACK = 4

/**
 * How far from the pointer a point's hint may stand, in px: a point's hint has its corner
 * `OFFSET` off the point on both axes, the pointer is within `NUDGE` of it, and the least target
 * a period gets (`--period-reach`, 24px) is the room a reader aims within. Past it the hint is
 * read against another part of the chart than the one pointed at, as a sector's under the ring's
 * box once was.
 */
const POINT_REACH = 24

/** The distance from a point to a box: none inside it. */
export function boxDistance(box: Box, at: Point): number {
  const dx = Math.max(box.left - at.x, 0, at.x - box.right)
  const dy = Math.max(box.top - at.y, 0, at.y - box.bottom)
  return Math.hypot(dx, dy)
}

/**
 * The side of the square the browser takes the pointer as, in px. Chromium finds a box under the
 * pointer from a pixel before its left or top edge, and none past its right or bottom edge: on a
 * bare page a box at 100px answered a pointer at 99.05px and none at 109.95px past its 10px. Two
 * columns of a day's minutes 2.8px wide and 2px apart, each reaching over its half of the gap,
 * meet a pixel before the gap's middle, and the later takes the pointer there.
 */
const POINTER = 1

/** The distance from the pointer at `at`, taken as the browser takes it, to a box. */
function pointerDistance(box: Box, at: Point): number {
  const dx = Math.max(box.left - (at.x + POINTER), 0, at.x - box.right)
  const dy = Math.max(box.top - (at.y + POINTER), 0, at.y - box.bottom)
  return Math.hypot(dx, dy)
}

/** Ids of the nearest of `distances`, with every one within `TWINS` of it; none for none. */
function nearest(distances: readonly { distance: number; id: string }[]): string[] {
  if (!distances.length) return []
  const least = Math.min(...distances.map((one) => one.distance))
  return distances.filter((one) => one.distance - least <= TWINS).map((one) => one.id)
}

/** A hinted element as the pointer meets it: its id and the box that takes the pointer for it. */
export interface Reachable {
  box: Box
  id: string
  /** Whether the point is on the element's own drawn shape, for a shape no box describes. */
  onShape?: boolean
}

/**
 * Which elements may answer the pointer at `at`: the nearest whose box or shape the pointer is
 * within `NUDGE` of, as the browser takes it (`POINTER`), ties within `TWINS`. With none that
 * close, the one the pointer was aimed at, whose reach then fails to cover `NUDGE`, which is what
 * a miss there reports.
 */
export function expectedAmong(all: readonly Reachable[], aimed: string, at: Point): string[] {
  const distances = all
    .map((one) => ({
      id: one.id,
      distance: one.onShape === false ? Infinity : pointerDistance(one.box, at),
    }))
    .filter((one) => one.distance <= NUDGE)
  const found = nearest(distances)
  return found.length ? found : [aimed]
}

/** A mark of a step line: its id, its x and whether it is a place rather than a reading. */
export interface LineMark {
  id: string
  place: boolean
  x: number
}

/**
 * Which marks of a step line may answer the pointer at `x`, by the step line's rule: a place
 * within `reach` before any reading, the nearest of several; else the nearest reading within
 * `reach`; else the mark whose stretch holds `x`, from its moment to the next mark's.
 */
export function expectedOnLine(marks: readonly LineMark[], x: number, reach: number): string[] {
  const within = (place: boolean) =>
    nearest(
      marks
        .filter((mark) => mark.place === place && Math.abs(mark.x - x) <= reach)
        .map((mark) => ({ id: mark.id, distance: Math.abs(mark.x - x) })),
    )
  const place = within(true)
  if (place.length) return place
  const reading = within(false)
  if (reading.length) return reading
  const before = [...marks].sort((a, b) => a.x - b.x).filter((mark) => mark.x <= x)
  const holder = before.at(-1) ?? [...marks].sort((a, b) => a.x - b.x)[0]
  return holder ? [holder.id] : []
}

/**
 * What a mark declares its hint stands at: a box (`data-hint-mark`), or a point
 * (`data-hint-point`), whose box is its dot, or nothing for a point a drawn shape names. A point
 * a drawn shape names says whether it stands on that shape (`onShape`): a ring's sector names the
 * point of its band where the pointer stands, and a point off the sector is no place of its mark.
 */
export interface MarkPlace {
  box: Box
  kind: 'box' | 'point'
  onShape?: boolean
}

/**
 * Why a shown hint stands where its mark's rule does not put it; null where it stands right. A
 * box's hint stands `OFFSET` past one of its edges or over it; a point's has a corner `OFFSET` off
 * the point's dot on both axes, or stands over it, and stands within `POINT_REACH` of the pointer.
 * A point a drawn shape names off the shape is away from its mark wherever the hint stands.
 */
export function placementMiss(
  hint: Box,
  mark: MarkPlace,
  pointer: Point,
): { by: number; rule: 'away-from-mark' | 'far-from-pointer' } | null {
  const gap = boxGap(hint, mark.box)
  const allowed = (mark.kind === 'point' ? Math.SQRT2 * OFFSET : OFFSET) + PLACE_SLACK
  if (gap > allowed || mark.onShape === false)
    return { rule: 'away-from-mark', by: Math.round(gap) }
  if (mark.kind === 'box') return null
  const far = boxDistance(hint, pointer)
  return far > POINT_REACH ? { rule: 'far-from-pointer', by: Math.round(far) } : null
}

/** What the page answered where the pointer stood: the hint shown, if any, and what it says. */
export interface Answer {
  box: Box
  /** Marks drawn as pointed at, or null where the chart tells none apart. */
  painted: readonly string[] | null
  /** The marks whose words the hint says. */
  says: readonly string[]
  text: string
}

/** A point where the page answered other than the rules expect, and what it found instead. */
export interface Verdict {
  found: { ids: readonly string[] } | { text: string }
  rule: 'away-from-mark' | 'far-from-pointer' | 'no-hint' | 'other-hint' | 'painted-other'
}

/**
 * How the page answered the pointer at `at` aimed at `aimed`, against the marks that may answer
 * there (`expected`): no hint at all, another mark's hint, another mark drawn as pointed at, or
 * the mark's own hint standing where its place (`place`) does not put it.
 */
export function judge(
  answer: Answer | null,
  expected: readonly string[],
  aimed: { id: string; place: MarkPlace | null },
  at: Point,
): Verdict[] {
  if (!answer) return [{ rule: 'no-hint', found: { ids: [] } }]
  const mine = (ids: readonly string[]) => ids.some((id) => expected.includes(id))
  if (!mine(answer.says)) {
    const found = answer.says.length ? { ids: answer.says } : { text: answer.text }
    return [{ rule: 'other-hint', found }]
  }
  const verdicts: Verdict[] = []
  if (answer.painted?.length && !mine(answer.painted))
    verdicts.push({ rule: 'painted-other', found: { ids: answer.painted } })
  const placed =
    aimed.place && answer.says.includes(aimed.id)
      ? placementMiss(answer.box, aimed.place, at)
      : null
  if (placed) verdicts.push({ rule: placed.rule, found: { text: `hint ${placed.by}px off` } })
  return verdicts
}

/**
 * What the sweep notes of a state's value panel, from how many marks of its charts act when
 * pressed (`acting`) and whether a press opened the panel: nothing where it opened; nothing where
 * no mark acts, as the token kinds' do not, a kind being a part of the tokens and no value the
 * page narrows to or a panel names (`DESIGN.md`: a value pressed opens its side panel, and marks
 * that lead nowhere show a hint and do nothing when pressed); else that no mark opened it.
 */
export function panelNote(acting: number, opened: boolean): string | null {
  return opened || acting === 0 ? null : 'no mark opened the value panel'
}

/** The gap between two boxes: none where they touch or overlap. */
function boxGap(a: Box, b: Box): number {
  const dx = Math.max(a.left - b.right, 0, b.left - a.right)
  const dy = Math.max(a.top - b.bottom, 0, b.top - a.bottom)
  return Math.hypot(dx, dy)
}

/**
 * What makes a scroller's content as wide as it is, as the page measured it: a table, a row of
 * like items (periods, a segmented strip's options) or anything else, with the narrowest unit of
 * a table or a row.
 */
export interface ScrollMaker {
  kind: 'other' | 'row' | 'table'
  unit: number
}

/**
 * The least sideways scroll that brings anything into reach, in px: the least target a period
 * gets (`--period-reach`, after WCAG 2.5.8). `DESIGN.md` records a span scrolled «by a few
 * pixels» as the defect its rule ends; a scroll shorter than this shows no part a reader could
 * point at that was not in reach already.
 */
const LEAST_SCROLL = 24

/** A box that holds more than it shows sideways, as the page measured it. */
export interface ScrollReading {
  clientWidth: number
  /** Whether out-of-flow content no frame between clips reaches past its content box. */
  escapes: boolean
  /** How far its in-flow content reaches from the content's start, in px. */
  inflow: number
  maker: ScrollMaker
  /** Whether it is the document's own scroll. */
  page: boolean
  /** Whether it scrolls sideways itself (`overflow-x` auto or scroll). */
  scrolls: boolean
  scrollWidth: number
}

/** Why a sideways scroll is none of the design's. */
export type ScrollRule = 'not-a-row' | 'out-of-flow' | 'page-scroll' | 'sliver'

/**
 * Whether a sideways scroll is the design's, and if not, by which rule: the page never scrolls
 * sideways; a box that does not scroll sideways (a cut text) is no scroll; out-of-flow content
 * (an absolutely positioned descendant no frame clips) never widens a box; a frame scrolls
 * sideways only for a table or a row of like items its content is, and only by `LEAST_SCROLL` or
 * more. Null where nothing overflows or the scroll is the design's.
 */
export function scrollMiss(reading: ScrollReading): { by: number; rule: ScrollRule } | null {
  const by = Math.round(reading.scrollWidth - reading.clientWidth)
  if (by <= 1) return null
  if (reading.page) return { rule: 'page-scroll', by }
  if (!reading.scrolls) return null
  const flowing = Math.max(reading.inflow, reading.clientWidth)
  if (reading.escapes && reading.scrollWidth > flowing + 1)
    return { rule: 'out-of-flow', by: Math.round(reading.scrollWidth - flowing) }
  if (reading.maker.kind === 'other') return { rule: 'not-a-row', by }
  return by < LEAST_SCROLL ? { rule: 'sliver', by } : null
}

/** `value` with every run of whitespace, of any width, read as one space. */
function oneSpace(value: string): string {
  return value.replaceAll(/\s+/gu, ' ')
}

/** Every place a text stands in `said`, whitespace of any width read as one space. */
export function occurrences(said: string, text: string): number {
  const needle = oneSpace(text)
  return needle ? oneSpace(said).split(needle).length - 1 : 0
}
