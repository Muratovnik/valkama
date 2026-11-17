/**
 * Where a hint of `v-tooltip` stands: decided by what the hint is to its element, its kind, and by
 * the list its element stands in, never by the place that writes it. A side written at each call
 * site drifted: the rail's names asked for the right one by one, a name added there without it
 * stood above and covered the row over it, and two hints of one kind stood apart on one screen.
 *
 * - A `detail` stands below its element, its start at the element's start, and above it only
 *   where the window has no room below.
 * - A `name` stands below its icon, centred on it.
 * - A `clipped` text is no hint beside its element: its whole words are laid over the cut ones,
 *   its first letter on theirs, and run on to `EDGE` short of the window's right edge, wrapping
 *   by words only where they do not fit there (`placeWhole`, drawn by `WholeText`). On one line
 *   it covers its own line and nothing over or under it, in a list as anywhere.
 * - A hint that speaks for a point of a chart, as a reading of a step line does, stands at the
 *   top right of the point's mark, as a chart's hint stands at the point pointed at: its bottom
 *   left corner `OFFSET` past the mark's right edge and over its top. Where the chart's frame
 *   (`data-hint-frame`, else the window) has no room for it on the right it stands at the top
 *   left, mirrored, and where the window has no room over the mark, under it at the same side.
 *   The element marks the point it holds, `data-hint-point`, so a point's whole area is its
 *   element's: a reading takes the pointer on the whole step it holds and on its mark. Placed as a
 *   detail is, under the step, the hint stood under the plot over the moments named there.
 * - In a list, every other hint stands aside of it: a list of rows down (`data-hint-list="rows"`:
 *   the rail, a ranking's bars, the Analytics rail and the list view's table) puts it past the
 *   list's own edge, clear of every row, its top level with its row's; a list of rows across
 *   (`data-hint-list="columns"`, a chart's periods) puts it beside the bar its row draws
 *   (`data-hint-bar`, a period's stack), `OFFSET` from the bar's edge, its top level with the bar's.
 *   A period is as wide as its share of the plot and its stack narrower, in its middle: beside
 *   the period, a day of two days had its hint at the plot's top some 300px from its stack. A row
 *   whose bar is not drawn, a period of nothing, has the hint at the row's top. Where neither side
 *   has room, as in a phone's narrow chart, it stands over the bar, centred on it.
 * - A list of rows wide enough to hold a hint (`data-hint-list="wide-rows"`: the settings sheet, a
 *   card's checklist) puts it inside the element's own row, beside the element on the side of
 *   the row with more room, as a control at a row's end has on its left: over the row's own label
 *   and over no other row, drawn as wide as that room so a long one keeps to the row's height.
 *   Past the sheet's edge it stood 375 to 576px from its control.
 *   A list declares itself once on its container, and its rows say nothing.
 * - A list of columns in a frame that keeps its hints inside (`data-hint-frame="inside"`, each
 *   chart of a small multiple) puts a column's hint inside that frame, as wide as it at most, from
 *   its start: against its top edge where the column stands in its lower half, else against its
 *   bottom edge, over part of its own chart and never over a neighbouring one; one taller than
 *   the chart, as a long name's in a narrow window, runs on into the air between the charts. It
 *   lets the pointer through to what it covers, as a chart period's does: resting on a period, it
 *   stands over the next. Below its period, as a detail stands, it stood over the charts of the
 *   next row; beside it, a chart a few columns wide had no room, and the window's side put it
 *   over the next chart.
 *
 * A hint stands on the right of a list where its lines fit there, else on the left, else on the
 * roomier side drawn narrower, down to `NARROWEST_BESIDE`, and above its element where neither
 * side has that much: left to the library, a side with no room squeezed the hint into what room
 * it had, a word a line. Everywhere the hint keeps `EDGE` from the window's edge, and the library
 * flips a hint below its element to above it where the window has no room below.
 *
 * Along a list of columns every column asks the same: whether a hint as wide as `WIDEST` fits
 * beside its bar inside the chart's frame (`data-hint-frame`, else the window). So every period of
 * a chart puts its hint on the right, and only the periods past where the right has no room put it
 * on the left: the side changes once along the chart, since every bar stands in the middle of its
 * period. A point asks by its hint's own width, as a row's hint does. Asked by each hint's own width, the side
 * jumped from one period to the next wherever a wider hint stood beside a narrower one. A frame
 * with that room on neither side of a period, as a chart of a few wide days has, gives it the
 * roomier side of the window, as a hint outside a chart has: narrowed to the frame, a hint of
 * long names was drawn a word a line, taller than the window.
 */
import type { TooltipKind } from '@/shared/ui/tooltipAnchors.ts'

export type HintSide = 'top' | 'right' | 'bottom' | 'left'

/**
 * Where along its side a hint stands: centred on what it is placed against, or level with its
 * start or its end.
 */
export type HintAlign = 'center' | 'start' | 'end'

/**
 * How a list's rows run, as its container declares in `data-hint-list`: down, across, or down
 * and wide enough to hold a hint beside each element.
 */
export type HintList = 'rows' | 'columns' | 'wide-rows'

/**
 * The widest a hint is drawn, and the narrowest it is drawn beside a list, in rem; in a row wide
 * enough to hold it, as wide as the row's room up to twice `WIDEST`.
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
  /**
   * The frame a list of columns keeps its hints inside (`data-hint-frame`): across, and with its
   * top and bottom where it keeps them wholly inside (`inside`); in a list of wide rows, the row.
   */
  frame?: (Pick<Box, 'left' | 'right'> & { inside?: Pick<Box, 'bottom' | 'top'> }) | null
  /** The mark of the point the element's hint speaks for (`data-hint-point`), as drawn. */
  point?: Box | null
}

export interface HintPlace {
  align: HintAlign
  /** The hint stands against the aside box rather than its element. */
  aside: boolean
  side: HintSide
  /** The side of its point's mark the hint stands over, at its corner (`data-hint-point`). */
  corner?: 'left' | 'right'
  /** The edge of the frame that keeps it inside (`data-hint-frame="inside"`) it stands against. */
  inside?: 'top' | 'bottom'
  /** How wide the hint is drawn at most where it stands, in px, where not `WIDEST`. */
  widest?: number
}

const ABOVE: HintPlace = { align: 'center', aside: false, side: 'top' }

/** Where a hint stands, from its kind, its list and the room the window leaves beside it. */
export function placeHint(setting: HintSetting): HintPlace {
  const { asked, kind, list } = setting
  if (asked?.side === 'top' || asked?.side === 'bottom') return { ...asked, aside: false }
  if (asked) return { ...beside(setting, asked.side, asked.align), aside: false }
  if (setting.point) return atPoint(setting.point, setting)
  const { frame } = setting
  if (list === 'columns' && frame?.inside)
    return within(setting.aside, { ...frame, ...frame.inside })
  if (list === 'wide-rows') return inRow(setting)
  if (list) return beside(setting, 'right', 'start')
  return { align: kind === 'name' ? 'center' : 'start', aside: false, side: 'bottom' }
}

/**
 * A hint at a corner of its point's mark: over it, its start `OFFSET` past the mark's right edge,
 * where the frame holds it there, else its end `OFFSET` short of the mark's left edge; the sides
 * and the narrowing as beside a row (`beside`), and over the mark, centred, where neither side
 * has room. It stands against the corner's edge as its side `top` (`cornerEdge`), so the library
 * that keeps a hint in the window sets it under the mark where the window has no room over it.
 */
function atPoint(point: Box, setting: HintSetting): HintPlace {
  const place = beside({ ...setting, aside: point, list: null }, 'right', 'start')
  if (!place.aside) return place
  const corner = place.side === 'left' ? 'left' : 'right'
  return {
    ...place,
    align: corner === 'right' ? 'start' : 'end',
    corner,
    side: 'top',
  }
}

/** A hint inside the frame `column` stands in: at the edge away from it, as wide as the frame. */
function within(column: Box, frame: Box): HintPlace {
  const lower = column.top + column.bottom > frame.top + frame.bottom
  return {
    align: 'start',
    aside: false,
    inside: lower ? 'top' : 'bottom',
    side: lower ? 'bottom' : 'top',
    widest: frame.right - frame.left,
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
 * Over a text cut down to its lines it is at least as large as they are, standing as far past
 * their end as it stands before their start, so none of them and no ellipsis shows beside or
 * under it, however few lines its own words take.
 */
export function placeWhole({ inset, letter, lines, scale, window }: WholeSetting): WholePlace {
  const left = letter.left - inset.left
  const top = letter.top - inset.top
  const widest = Math.max(0, (window - EDGE - left) / scale)
  if (!lines) return { left, top, widest }
  const past = (start: number, end: number, from: number) =>
    Math.max(0, end - from + Math.max(0, start - from)) / scale
  return {
    left,
    top,
    widest,
    least: {
      block: past(lines.top, lines.bottom, top),
      inline: Math.min(widest, past(lines.left, lines.right, left)),
    },
  }
}

/**
 * A hint beside `aside`, on the side asked where its lines fit, else where there is room: inside
 * the frame of a list of columns, where every column asks for `WIDEST`, and inside the window.
 */
function beside(
  { aside, frame, list, rem, width, window }: HintSetting,
  side: 'left' | 'right',
  align: HintAlign,
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
  const need = list === 'columns' ? WIDEST * rem : Math.min(WIDEST * rem, width)
  if (room[side] >= need) return { align, aside: true, side }
  if (room[other] >= need) return { align, aside: true, side: other }
  const open = roomWithin(shown)
  const roomier = open[other] > open[side] ? other : side
  if (open[roomier] >= need) return { align, aside: true, side: roomier }
  return open[roomier] >= NARROWEST_BESIDE * rem
    ? { align, aside: true, side: roomier, widest: open[roomier] }
    : ABOVE
}

const LISTS: readonly HintList[] = ['rows', 'columns', 'wide-rows']

/**
 * The frame a list of columns keeps its hints inside, as the nearest `data-hint-frame` says, and
 * whether it keeps them wholly inside.
 */
function frameOf(container: HTMLElement, list: HintList): HintSetting['frame'] {
  return list === 'columns' ? frameAround(container) : null
}

/** The frame of the nearest `data-hint-frame` around `element`, and whether it keeps hints inside. */
function frameAround(element: HTMLElement): HintSetting['frame'] {
  const frame = element.closest<HTMLElement>('[data-hint-frame]')
  if (!frame) return null
  const { bottom, left, right, top } = frame.getBoundingClientRect()
  return { inside: frame.dataset.hintFrame === 'inside' ? { bottom, top } : undefined, left, right }
}

/**
 * The edge of the frame of `container`'s list a hint inside it stands against, as a line
 * `OFFSET` out from it, so the hint placed against that line at `OFFSET` stands on the edge.
 */
function frameEdge(container: HTMLElement, inside: 'top' | 'bottom'): DOMRect {
  const frame = (container.closest('[data-hint-frame]') ?? container).getBoundingClientRect()
  const at = inside === 'top' ? frame.top - OFFSET : frame.bottom + OFFSET
  return new DOMRect(frame.left, at, frame.width, 0)
}

/** The list `element` stands in, as the nearest container that declares one says. */
export function hintListOf(element: Element): { container: HTMLElement; list: HintList } | null {
  const container = element.closest<HTMLElement>('[data-hint-list]')
  const list = LISTS.find((each) => each === container?.dataset.hintList)
  return container && list ? { container, list } : null
}

// Wider and taller than a pixel: a word kept for a screen reader alone stands nowhere.
const shows = (box: DOMRect) => box.width > 1 && box.height > 1

/** Whether `other` stands wholly before or after `one` along the way a list's rows run. */
function apart(one: DOMRect, other: DOMRect, list: HintList): boolean {
  return list === 'columns'
    ? other.right <= one.left + 1 || other.left >= one.right - 1
    : other.bottom <= one.top + 1 || other.top >= one.bottom - 1
}

/**
 * The row of a list `element` stands in, or the container's own child that holds it. A row's
 * controls and words stand beside each other, and a row of two lines stacks its lines inside the
 * box that stands beside its number: so the row is the nearest box with a neighbour before or
 * after it that holds every box standing beside another on its way up.
 */
export function hintRowOf(
  element: HTMLElement,
  container: HTMLElement,
  list: HintList,
): HTMLElement {
  let row: HTMLElement | null = null
  let box = element
  while (box.parentElement && box.parentElement !== container && container.contains(box)) {
    const own = box.getBoundingClientRect()
    const others = [...box.parentElement.children]
      .filter((each) => each !== box)
      .map((each) => each.getBoundingClientRect())
      .filter((other) => shows(other))
    if (others.some((other) => !apart(own, other, list))) row = null
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
 * The box a hint aside of `element`'s list stands against: past the list's edge, beside the bar
 * its row draws, or, in a list of wide rows, beside the element inside its row.
 */
function asideBox(element: HTMLElement, container: HTMLElement, list: HintList): DOMRect {
  const row = hintRowOf(element, container, list)
  if (list === 'columns') return barBox(row)
  const own = row.getBoundingClientRect()
  const across =
    list === 'rows' ? container.getBoundingClientRect() : element.getBoundingClientRect()
  return new DOMRect(across.left, own.top, across.width, own.height)
}

/**
 * The bar a row of a list of columns draws (`data-hint-bar`), as a chart's period draws its
 * stack: its edges across, and its top where it is drawn; the row's top where it is not, as a
 * period of nothing or with no data yet. A row that names no bar is its own.
 */
function barBox(row: HTMLElement): DOMRect {
  const own = row.getBoundingClientRect()
  const bar = row.querySelector('[data-hint-bar]')?.getBoundingClientRect()
  if (!bar) return own
  return bar.height >= 1 ? bar : new DOMRect(bar.left, own.top, bar.width, own.height)
}

/**
 * The edge a hint at a corner of a point's mark stands against as its side `top`: a line as tall
 * as the mark, `OFFSET` past its right edge or short of its left, so the hint's start or end stands
 * there and its bottom, or under the mark its top, `OFFSET` from the mark.
 */
function cornerEdge(point: Element, corner: 'left' | 'right'): DOMRect {
  const mark = point.getBoundingClientRect()
  const at = corner === 'right' ? mark.right + OFFSET : mark.left - OFFSET
  return new DOMRect(at, mark.top, 0, mark.height)
}

/** Where the hint of `element` stands that speaks for the point it holds (`data-hint-point`). */
function pointPlaceOf(
  element: HTMLElement,
  point: Element,
  setting: Pick<HintSetting, 'kind' | 'rem' | 'width' | 'window'>,
): HintPlace & { reference: HintReference } {
  const place = placeHint({
    ...setting,
    aside: element.getBoundingClientRect(),
    frame: frameAround(element),
    list: null,
    point: point.getBoundingClientRect(),
  })
  const { corner } = place
  return {
    ...place,
    reference: {
      contextElement: element,
      getBoundingClientRect: () =>
        corner ? cornerEdge(point, corner) : point.getBoundingClientRect(),
    },
  }
}

/** The frame of the hint of `element` in its list: its chart's, or its own row in a wide one. */
function frameIn(element: HTMLElement, container: HTMLElement, list: HintList) {
  if (list !== 'wide-rows') return frameOf(container, list)
  const { left, right } = hintRowOf(element, container, list).getBoundingClientRect()
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
): HintPlace & { reference: HTMLElement | HintReference } {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const inner = document.documentElement.clientWidth
  const point = asked ? null : element.querySelector('[data-hint-point]')
  if (point) return pointPlaceOf(element, point, { kind, rem, width, window: inner })
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
  if (!declared) return { ...place, reference: element }
  const { container, list } = declared
  const { inside } = place
  if (inside)
    return {
      ...place,
      reference: {
        contextElement: element,
        getBoundingClientRect: () => frameEdge(container, inside),
      },
    }
  // Over its element where neither side has room; a column's over the bar its row draws.
  if (!place.aside && list !== 'columns') return { ...place, reference: element }
  return {
    ...place,
    reference: {
      contextElement: element,
      getBoundingClientRect: () => asideBox(element, container, list),
    },
  }
}
