/**
 * Where a hint of `v-tooltip` stands: decided by what the hint is to its element, its kind, and by
 * the mark or the list its element stands for, never by the place that writes it. A side written
 * at each call site drifted: the rail's names asked for the right one by one, a name added there
 * without it stood above and covered the row over it, and two hints of one kind stood apart on
 * one screen.
 *
 * - A `detail` stands below its element, its start at the element's start, and above it only
 *   where the window has no room below.
 * - A `name` stands below its icon, centred on it.
 * - A `clipped` text is no hint beside its element: its whole words are laid over the cut ones,
 *   its first letter on theirs, and run on to `EDGE` short of the window's right edge, wrapping
 *   by words only where they do not fit there (`placeWhole`, drawn by `WholeText`). On one line
 *   it covers its own line and nothing over or under it, in a list as anywhere; over a clamp of
 *   several lines its words keep the clamp's column and run on down past it.
 * - A hint of a chart's mark stands at that mark, whatever the chart: a day's stack, a column of a
 *   small chart and the small chart's name, a ranked row's bar, a reading of a step line, a sector
 *   of a ring. The mark declares itself, and the place of its hint follows from the mark alone:
 *   `data-hint-mark` on the element whose box is the mark, the hinted element itself or one in
 *   the area it speaks for (`data-tooltip-area`), as a period's stack beside the period that takes
 *   the pointer; `data-hint-point` on a point's mark, or, on a drawn shape that holds none, the
 *   point in its own units, `x y`, as a ring's sector names the point of its band's middle where
 *   the pointer stands on it. A mark that changes while its hint shows, as that point does when
 *   the pointer moves round the ring or a reading's dot drawn larger under the pointer, asks for
 *   the hint's place again (`TooltipHost`), on the mark as it is drawn then. The hint's
 *   start stands `OFFSET` past the mark's right edge, level with the mark's top; at a point, and at
 *   a mark drawn with no height, as a period of nothing on its floor, at the top right of it, its
 *   bottom left corner `OFFSET` past it and over it. Where the chart's frame (`data-hint-frame`,
 *   else the window) has no room on the right it stands mirrored on the left; where the window
 *   has no room over a point, under it at the same side; where neither side has room, as in a
 *   phone's narrow chart, over the mark, centred. A mark asks the room of the widest hint
 *   (`WIDEST`), not of its own, so every period of a chart puts its hint on the right and only the
 *   periods past where the right has no room put it on the left: the side changes once along a
 *   chart. Asked by each hint's own width, the side jumped from one period to the next wherever a
 *   wider hint stood beside a narrower one, as a period of nothing did beside its neighbours. A
 *   point (`data-hint-point`) asks by its own hint's width. A frame with that
 *   room on neither side of a mark gives it the roomier side of the window: narrowed to the
 *   frame, a hint of long names was drawn a word a line, taller than the window. The hint lets the
 *   pointer through to what it covers, a neighbouring mark or a neighbouring small chart, and
 *   covers no part of its own mark. Each kind of mark once had a place of its own: a ranked row's
 *   hint stood past the ranking's edge, far from a short bar; a small chart's column's at the top
 *   left corner of that chart's frame, over the column pointed at; a day of two days had its hint
 *   at the plot's top some 300px from its stack; a reading's stood under the plot over the moments
 *   named there; a sector's under the ring's box, far from where the pointer was.
 * - A chart's legend (`data-hint-list="legend"`) runs its entries across in lines. An entry is no
 *   plot mark: it names a series rather than standing for a value, so its hint stands under the
 *   whole legend, its start at the entry's start, clear of every entry it is read against, and
 *   lets the pointer through to the plot it covers. Under the entry itself, a hint of a grid's
 *   lines covered the entries of the lines below and held the pointer on its way to them.
 * - In a list, every other hint stands aside of it: a list of rows down (`data-hint-list="rows"`:
 *   the rail, the Analytics rail and the list view's table) puts it past the list's own edge,
 *   clear of every row, its top level with its row's.
 * - A list of rows wide enough to hold a hint (`data-hint-list="wide-rows"`: the settings sheet, a
 *   card's checklist) puts it inside the element's own row, beside the element on the side of
 *   the row with more room, as a control at a row's end has on its left: over the row's own label
 *   and over no other row, drawn as wide as that room so a long one keeps to the row's height.
 *   Past the sheet's edge it stood 375 to 576px from its control.
 *   A list declares itself once on its container, and its rows say nothing.
 *
 * A hint stands on the right of a list or a mark where its lines fit there, else on the left,
 * else on the roomier side drawn narrower, down to `NARROWEST_BESIDE`, and above its element where
 * neither side has that much: left to the library, a side with no room squeezed the hint into what
 * room it had, a word a line. Everywhere the hint keeps `EDGE` from the window's edge, and the
 * library flips a hint below its element to above it where the window has no room below.
 */
import type { TooltipKind } from '@/shared/ui/tooltipAnchors.ts'
import { tooltipReachOf } from '@/shared/ui/tooltipAnchors.ts'

export type HintSide = 'top' | 'right' | 'bottom' | 'left'

/**
 * Where along its side a hint stands: centred on what it is placed against, or level with its
 * start or its end.
 */
export type HintAlign = 'center' | 'start' | 'end'

/**
 * How a list's rows run, as its container declares in `data-hint-list`: down, down and wide
 * enough to hold a hint beside each element, or across in lines, as a chart's legend.
 */
export type HintList = 'rows' | 'wide-rows' | 'legend'

/**
 * The widest a hint is drawn, and the narrowest it is drawn beside a list or a mark, in rem; in a
 * row wide enough to hold it, as wide as the row's room up to twice `WIDEST`.
 */
const WIDEST = 20
const NARROWEST_BESIDE = 12
const WIDEST_IN_ROW = 2 * WIDEST
/** The room between a hint and what it stands against, and between a hint and the window's edge, in px. */
export const OFFSET = 6
export const EDGE = 8

/** A box in the window's coordinates, as `getBoundingClientRect` gives it. */
export interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

/**
 * How a chart's mark is drawn: a box, whose hint stands level with its top; a box drawn with no
 * height, as a period of nothing on its floor, whose hint stands over it at its corner and asks
 * the room its chart's boxes ask; a point (`data-hint-point`), whose hint stands over it at its
 * corner and asks by its own width.
 */
type MarkDrawn = 'box' | 'floor' | 'point'

/** The mark of a chart a hint speaks for, as drawn: its box, and how it is drawn. */
interface HintMark {
  box: Box
  drawn: MarkDrawn
}

/** What decides a hint's place, measured as it opens. */
export interface HintSetting {
  /** The box a hint aside of the list stands against, or the element's own box. */
  aside: Box
  kind: TooltipKind
  /** How the rows of the list the element stands in run, or null outside a list. */
  list: HintList | null
  /** The root font size, in px. */
  rem: number
  /** How wide the hint's lines are, in px. */
  width: number
  /** The window's width, without its scrollbar. */
  window: number
  /** The side a registered exception writes (`SIDED_TOOLTIPS`), placed against its element. */
  asked?: { align: HintAlign; side: HintSide } | null
  /** The chart's frame a mark's hint keeps beside it inside (`data-hint-frame`); in a list of wide rows, the row. */
  frame?: Pick<Box, 'left' | 'right'> | null
  /** The chart's mark the element's hint speaks for (`data-hint-mark`, `data-hint-point`). */
  mark?: HintMark | null
}

export interface HintPlace {
  align: HintAlign
  /** The hint stands against the aside box rather than its element. */
  aside: boolean
  side: HintSide
  /** The side of its point's mark the hint stands over, at its corner. */
  corner?: 'left' | 'right'
  /** The hint stands at a chart's mark. */
  mark?: boolean
  /** The hint lets the pointer through to what it covers: at a chart's mark, or a legend's. */
  through?: boolean
  /** How wide the hint is drawn at most where it stands, in px, where not `WIDEST`. */
  widest?: number
}

const ABOVE: HintPlace = { align: 'center', aside: false, side: 'top' }

/** Where a hint stands, from its kind, its mark, its list and the room the window leaves beside it. */
export function placeHint(setting: HintSetting): HintPlace {
  const { asked, kind, list } = setting
  if (asked?.side === 'top' || asked?.side === 'bottom') return { ...asked, aside: false }
  if (asked) return { ...beside(setting, asked.side, asked.align), aside: false }
  if (setting.mark) return atMark(setting.mark, setting)
  if (list === 'legend') return { align: 'start', aside: true, side: 'bottom', through: true }
  if (list === 'wide-rows') return inRow(setting)
  if (list) return beside(setting, 'right', 'start')
  return { align: kind === 'name' ? 'center' : 'start', aside: false, side: 'bottom' }
}

/**
 * A hint at its chart's mark: its start `OFFSET` past the mark's right edge where the frame holds
 * it there, else its end `OFFSET` short of the mark's left edge; level with the mark's top, or at
 * a point over it, at its corner; the sides and the narrowing as beside a row (`beside`), and over
 * the mark, centred, where neither side has room. A point's hint stands against the corner's edge
 * as its side `top` (`cornerEdge`), so the library that keeps a hint in the window sets it under
 * the mark where the window has no room over it.
 */
function atMark({ box, drawn }: HintMark, setting: HintSetting): HintPlace {
  const need = drawn === 'point' ? undefined : WIDEST * setting.rem
  const place = beside({ ...setting, aside: box, list: null }, 'right', 'start', need)
  if (!place.aside || drawn === 'box') return { ...place, mark: true, through: true }
  const corner = place.side === 'left' ? 'left' : 'right'
  return {
    ...place,
    align: corner === 'right' ? 'start' : 'end',
    corner,
    mark: true,
    side: 'top',
    through: true,
  }
}

/**
 * A hint inside its element's own row, beside the element on the side where the row has more
 * room, level with the row's top and as far in from its edges as from the window's. It is drawn
 * as wide as that room, up to `WIDEST_IN_ROW`, so a long hint takes as few lines as the row
 * allows: drawn 278px wide, a setting's hint of 130 letters took four lines, 85px, in a row 69px
 * high. Where the room holds neither its lines nor `NARROWEST_BESIDE`, the hint stands above its
 * element.
 */
function inRow({ aside, frame, rem, width, window }: HintSetting): HintPlace {
  // As far in from the row's edges as from the window's.
  const left = Math.max(0, frame?.left ?? 0) + EDGE
  const right = Math.min(window, frame?.right ?? window) - EDGE
  const room = { left: aside.left - OFFSET - left, right: right - aside.right - OFFSET }
  const side = room.left >= room.right ? 'left' : 'right'
  return room[side] >= Math.min(NARROWEST_BESIDE * rem, width)
    ? { align: 'start', aside: true, side, widest: Math.min(room[side], WIDEST_IN_ROW * rem) }
    : ABOVE
}

/** What decides where the whole of a cut text is laid, measured as it opens. */
export interface WholeSetting {
  /** Where the whole text's first letter stands inside its own box as drawn, in px. */
  inset: { left: number; top: number }
  /** Where the cut text's first letter stands, in the window's coordinates. */
  letter: { left: number; top: number }
  /** How much larger than its type the cut text is drawn, as on a zoomed canvas; 1 elsewhere. */
  scale: number
  /** The window's width, without its scrollbar. */
  window: number
  /** The box the cut text's lines show in where they are cut down, as a clamp's (`cutLinesOf`). */
  lines?: Box | null
  /** How tall the whole text came out as drawn and how tall the window is, in px, once drawn. */
  tall?: { drawn: number; window: number } | null
}

export interface WholePlace {
  /** Where its box stands, in the window's coordinates. */
  left: number
  top: number
  /** How wide it is drawn at most before it wraps, in px of its own type. */
  widest: number
  /** How large it is drawn at least, so that it covers every line the cut text shows, in px of its own type. */
  least?: { block: number; inline: number }
}

/**
 * Where the whole of a cut text is laid: its box placed so that its first letter stands on the
 * cut text's, and as wide as the room from there to `EDGE` short of the window's right edge.
 * Over a text cut down to its lines it is as wide as they are, standing as far past their end as
 * it stands before their start, and at least as high: its words wrap at the width the clamp cut
 * them at and take the lines they need under the clamp's, so no line and no ellipsis shows beside
 * or under it, and no empty room stands under its last line. Run on to the window's edge, a
 * board tile's title cut at its third line lay on one line 560 to 660px wide, past the next
 * columns, with 38px of empty frame under it. Drawn taller than the room under where it is laid
 * (`tall`), it stands higher, its bottom `EDGE` short of the window's and its top no higher than
 * `EDGE` under the window's top.
 */
export function placeWhole({
  inset,
  letter,
  lines,
  scale,
  tall,
  window,
}: WholeSetting): WholePlace {
  const left = letter.left - inset.left
  const laidTop = letter.top - inset.top
  const top = tall ? Math.min(laidTop, Math.max(EDGE, tall.window - EDGE - tall.drawn)) : laidTop
  const room = Math.max(0, (window - EDGE - left) / scale)
  if (!lines) return { left, top, widest: room }
  const past = (start: number, end: number, from: number) =>
    Math.max(0, end - from + Math.max(0, start - from)) / scale
  const widest = Math.min(room, past(lines.left, lines.right, left))
  const block = past(lines.top, lines.bottom, laidTop)
  return { left, top, widest, least: { block, inline: widest } }
}

/**
 * A hint beside `aside`, on the side asked where its lines fit, else where there is room: inside
 * the chart's frame and inside the window. It asks for `need`, a mark the widest hint's room, and
 * otherwise its own width.
 */
function beside(
  { aside, frame, rem, width, window }: HintSetting,
  side: 'left' | 'right',
  align: HintAlign,
  need = Math.min(WIDEST * rem, width),
): HintPlace {
  const roomWithin = (bounds: Pick<Box, 'left' | 'right'>) => ({
    left: aside.left - OFFSET - bounds.left,
    right: bounds.right - aside.right - OFFSET,
  })
  const shown = { left: EDGE, right: window - EDGE }
  const room = roomWithin(
    frame
      ? { left: Math.max(shown.left, frame.left), right: Math.min(shown.right, frame.right) }
      : shown,
  )
  const other = side === 'left' ? 'right' : 'left'
  if (room[side] >= need) return { align, aside: true, side }
  if (room[other] >= need) return { align, aside: true, side: other }
  const open = roomWithin(shown)
  const roomier = open[other] > open[side] ? other : side
  if (open[roomier] >= need) return { align, aside: true, side: roomier }
  return open[roomier] >= NARROWEST_BESIDE * rem
    ? { align, aside: true, side: roomier, widest: open[roomier] }
    : ABOVE
}

const LISTS: readonly HintList[] = ['rows', 'wide-rows', 'legend']

/** The frame of the nearest `data-hint-frame` around `element`, across. */
function frameAround(element: Element): HintSetting['frame'] {
  const frame = element.closest<HTMLElement>('[data-hint-frame]')
  if (!frame) return null
  const { left, right } = frame.getBoundingClientRect()
  return { left, right }
}

/** The list `element` stands in, as the nearest container that declares one says. */
export function hintListOf(element: Element): { container: HTMLElement; list: HintList } | null {
  const container = element.closest<HTMLElement>('[data-hint-list]')
  const list = LISTS.find((each) => each === container?.dataset.hintList)
  return container && list ? { container, list } : null
}

// Wider and taller than a pixel: a word kept for a screen reader alone stands nowhere.
const shows = (box: DOMRect) => box.width > 1 && box.height > 1

/** Whether `other` stands wholly over or under `one`, as a list's rows do. */
const apart = (one: DOMRect, other: DOMRect) =>
  other.bottom <= one.top + 1 || other.top >= one.bottom - 1

/**
 * The row of a list `element` stands in, or the container's own child that holds it. A row's
 * controls and words stand beside each other, and a row of two lines stacks its lines inside the
 * box that stands beside its number: so the row is the nearest box with a neighbour over or under
 * it that holds every box standing beside another on its way up.
 */
export function hintRowOf(element: HTMLElement, container: HTMLElement): HTMLElement {
  let row: HTMLElement | null = null
  let box = element
  while (box.parentElement && box.parentElement !== container && container.contains(box)) {
    const own = box.getBoundingClientRect()
    const others = [...box.parentElement.children]
      .filter((each) => each !== box)
      .map((each) => each.getBoundingClientRect())
      .filter((other) => shows(other))
    if (others.some((other) => !apart(own, other))) row = null
    else if (!row && others.length > 0) row = box
    box = box.parentElement
  }
  return row ?? box
}

/** What a hint stands against: an element, or the box aside of its list, read again as it moves. */
export interface HintReference {
  contextElement: HTMLElement
  getBoundingClientRect: () => DOMRect
}

/**
 * The box a hint aside of `element`'s list stands against: past the list's edge, in a list of
 * wide rows beside the element inside its row, and in a legend the element's own span across
 * down to the legend's foot.
 */
function asideBox(element: HTMLElement, container: HTMLElement, list: HintList): DOMRect {
  if (list === 'legend') {
    const { left, top, width } = element.getBoundingClientRect()
    return new DOMRect(left, top, width, container.getBoundingClientRect().bottom - top)
  }
  const own = hintRowOf(element, container).getBoundingClientRect()
  const across =
    list === 'rows' ? container.getBoundingClientRect() : element.getBoundingClientRect()
  return new DOMRect(across.left, own.top, across.width, own.height)
}

/**
 * The edge a hint at a corner of a point's mark stands against as its side `top`: a line as tall
 * as the mark, `OFFSET` past its right edge or short of its left, so the hint's start or end stands
 * there and its bottom, or under the mark its top, `OFFSET` from the mark.
 */
function cornerEdge(mark: DOMRect, corner: 'left' | 'right'): DOMRect {
  const at = corner === 'right' ? mark.right + OFFSET : mark.left - OFFSET
  return new DOMRect(at, mark.top, 0, mark.height)
}

/**
 * A mark of the chart as drawn now, read again as the page moves, how it is drawn, and the element
 * that declares it, whose change while the hint shows asks for the hint's place again.
 */
interface DrawnMark {
  drawn: MarkDrawn
  of: Element
  box: () => DOMRect
}

/** The point a drawn shape names in its own units, `x y`, as it names it now; null for none. */
function pointNamed(shape: SVGGraphicsElement): [number, number] | null {
  const named = shape.dataset.hintPoint?.split(' ').map(Number)
  if (named?.length !== 2 || !named.every((part) => Number.isFinite(part))) return null
  const [x = 0, y = 0] = named
  return [x, y]
}

/**
 * The point `element`'s hint speaks for (`data-hint-point`), as drawn now: the mark it holds, or,
 * where a drawn shape holds none, as a sector of a ring, the point the shape names in its own
 * units, `x y`, a box of no size, read again each time, since a ring names the point where the
 * pointer stands on it. None where it declares neither.
 */
function hintPointOf(element: Element): Omit<DrawnMark, 'drawn'> | null {
  const mark = element.querySelector('[data-hint-point]')
  if (mark) return { of: mark, box: () => mark.getBoundingClientRect() }
  if (!(element instanceof SVGGraphicsElement) || !pointNamed(element)) return null
  return {
    of: element,
    box: () => {
      const [x, y] = pointNamed(element) ?? [0, 0]
      const drawn = new DOMPoint(x, y).matrixTransform(element.getScreenCTM() ?? undefined)
      return new DOMRect(drawn.x, drawn.y, 0, 0)
    },
  }
}

/**
 * The chart's mark `element`'s hint speaks for: its point (`hintPointOf`), else the box declared
 * `data-hint-mark`, the element's own or one in the area it speaks for, a point where it is drawn
 * with no height, as a period of nothing on its floor. None where the element stands for no mark.
 */
function hintMarkOf(element: HTMLElement): DrawnMark | null {
  const point = hintPointOf(element)
  if (point) return { ...point, drawn: 'point' }
  const mark = element.matches('[data-hint-mark]')
    ? element
    : tooltipReachOf(element).querySelector('[data-hint-mark]')
  if (!mark) return null
  const box = () => mark.getBoundingClientRect()
  return { box, drawn: box().height < 1 ? 'floor' : 'box', of: mark }
}

/**
 * Where the hint of `element` stands that speaks for its chart's mark (`hintMarkOf`), and the
 * element that declares that mark (`markElement`).
 */
function markPlaceOf(
  element: HTMLElement,
  mark: DrawnMark,
  setting: Pick<HintSetting, 'kind' | 'rem' | 'width' | 'window'>,
): HintPlace & { markElement: Element; reference: HintReference } {
  const place = placeHint({
    ...setting,
    aside: element.getBoundingClientRect(),
    frame: frameAround(element),
    list: null,
    mark: { box: mark.box(), drawn: mark.drawn },
  })
  const { corner } = place
  return {
    ...place,
    markElement: mark.of,
    reference: {
      contextElement: element,
      getBoundingClientRect: () => (corner ? cornerEdge(mark.box(), corner) : mark.box()),
    },
  }
}

/** The frame of the hint of `element` in its list: its own row in a list of wide rows. */
function frameIn(element: HTMLElement, container: HTMLElement, list: HintList) {
  if (list !== 'wide-rows') return null
  const { left, right } = hintRowOf(element, container).getBoundingClientRect()
  return { left, right }
}

/**
 * Where the hint of `element`, `width` wide, stands, and what it stands against. A side the call
 * site asks for, as only a registered exception may, places it against the element, list or not.
 */
export function hintPlaceOf(
  element: HTMLElement,
  { asked = null, kind }: Pick<HintSetting, 'asked' | 'kind'>,
  width: number,
): HintPlace & { reference: HTMLElement | HintReference; markElement?: Element } {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const inner = document.documentElement.clientWidth
  const mark = asked ? null : hintMarkOf(element)
  if (mark) return markPlaceOf(element, mark, { kind, rem, width, window: inner })
  const declared = asked ? null : hintListOf(element)
  const aside = declared
    ? asideBox(element, declared.container, declared.list)
    : element.getBoundingClientRect()
  const place = placeHint({
    aside,
    asked,
    frame: declared ? frameIn(element, declared.container, declared.list) : null,
    kind,
    list: declared?.list ?? null,
    rem,
    width,
    window: inner,
  })
  // Over its element where neither side has room.
  if (!declared || !place.aside) return { ...place, reference: element }
  const { container, list } = declared
  return {
    ...place,
    reference: {
      contextElement: element,
      getBoundingClientRect: () => asideBox(element, container, list),
    },
  }
}
