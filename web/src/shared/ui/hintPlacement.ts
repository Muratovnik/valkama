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
 * - In a list, every other hint stands aside of it, its top level with its row's: a list of rows down
 *   (`data-hint-list="rows"`: the rail, a ranking's bars, a card's checklist, the settings sheet,
 *   the Analytics rail and the list view's table) puts it past the list's own edge, clear
 *   of every row; a list of rows across (`data-hint-list="columns"`, a chart's periods) puts it
 *   beside its row.
 *   A list declares itself once on its container, and its rows say nothing.
 * - A list of columns in a frame that keeps its hints inside (`data-hint-frame="inside"`, each
 *   chart of a small multiple) puts a column's hint inside that frame, as wide as it at most, from
 *   its start: against its top edge where the column stands in its lower half, else against its
 *   bottom edge, over part of its own chart and never over a neighbouring one; one taller than the
 *   chart, as a long name's in a narrow window, runs on into the air between the charts. It lets the pointer
 *   through to what it covers, as a chart period's does: resting on a period, it stands over the
 *   next. Below its period, as a detail stands, it stood over the charts of the next row; beside
 *   it, a chart a few columns wide had no room, and the window's side put it over the next chart.
 *
 * A hint stands on the right of a list where its lines fit there, else on the left, else on the
 * roomier side drawn narrower, down to `NARROWEST_BESIDE`, and above its element where neither
 * side has that much: left to the library, a side with no room squeezed the hint into what room
 * it had, a word a line. Everywhere the hint keeps `EDGE` from the window's edge, and the library
 * flips a hint below its element to above it where the window has no room below.
 *
 * Along a list of columns every column asks the same: whether a hint as wide as `WIDEST` fits
 * beside it inside the chart's frame (`data-hint-frame`, else the window). So every period of a
 * chart puts its hint on the right, and only the periods past where the right has no room put it
 * on the left: the side changes once along the chart. Asked by each hint's own width, the side
 * jumped from one period to the next wherever a wider hint stood beside a narrower one. A frame
 * with that room on neither side of a period, as a chart of a few wide days has, gives it the
 * roomier side of the window, as a hint outside a chart has: narrowed to the frame, a hint of
 * long names was drawn a word a line, taller than the window.
 */
import type { TooltipKind } from '@/shared/ui/tooltipAnchors.ts'

export type HintSide = 'top' | 'right' | 'bottom' | 'left'

/** Where along its side a hint stands: centred on what it is placed against, or level with its start. */
export type HintAlign = 'center' | 'start'

/** How a list's rows run, as its container declares in `data-hint-list`. */
export type HintList = 'rows' | 'columns'

/** The widest a hint is drawn, and the narrowest it is drawn beside a list, in rem. */
const WIDEST = 20
const NARROWEST_BESIDE = 12
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
   * top and bottom where it keeps them wholly inside (`inside`).
   */
  frame?: (Pick<Box, 'left' | 'right'> & { inside?: Pick<Box, 'bottom' | 'top'> }) | null
}

export interface HintPlace {
  align: HintAlign
  /** The hint stands against the aside box rather than its element. */
  aside: boolean
  side: HintSide
  /** The edge of the frame that keeps it inside (`data-hint-frame="inside"`) it stands against. */
  inside?: 'top' | 'bottom'
  /** How wide the hint is drawn at most where it stands, in px, where narrower than `WIDEST`. */
  widest?: number
}

const ABOVE: HintPlace = { align: 'center', aside: false, side: 'top' }

/** Where a hint stands, from its kind, its list and the room the window leaves beside it. */
export function placeHint(setting: HintSetting): HintPlace {
  const { asked, kind, list } = setting
  if (asked?.side === 'top' || asked?.side === 'bottom') return { ...asked, aside: false }
  if (asked) return { ...beside(setting, asked.side, asked.align), aside: false }
  const { frame } = setting
  if (list === 'columns' && frame?.inside)
    return within(setting.aside, { ...frame, ...frame.inside })
  if (list) return beside(setting, 'right', 'start')
  return { align: kind === 'name' ? 'center' : 'start', aside: false, side: 'bottom' }
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

const LISTS: readonly HintList[] = ['rows', 'columns']

/**
 * The frame a list of columns keeps its hints inside, as the nearest `data-hint-frame` says, and
 * whether it keeps them wholly inside.
 */
function frameOf(container: HTMLElement, list: HintList): HintSetting['frame'] {
  const frame = list === 'columns' ? container.closest<HTMLElement>('[data-hint-frame]') : null
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
  return list === 'rows'
    ? other.bottom <= one.top + 1 || other.top >= one.bottom - 1
    : other.right <= one.left + 1 || other.left >= one.right - 1
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

/** The box a hint aside of `element`'s list stands against: past the list's edge or beside the row. */
function asideBox(element: HTMLElement, container: HTMLElement, list: HintList): DOMRect {
  const row = hintRowOf(element, container, list).getBoundingClientRect()
  const across = list === 'rows' ? container.getBoundingClientRect() : row
  return new DOMRect(across.left, row.top, across.width, row.height)
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
  const declared = asked ? null : hintListOf(element)
  const aside = declared
    ? asideBox(element, declared.container, declared.list)
    : element.getBoundingClientRect()
  const place = placeHint({
    aside,
    asked,
    frame: declared ? frameOf(declared.container, declared.list) : null,
    kind,
    list: declared?.list ?? null,
    rem,
    width,
    window: document.documentElement.clientWidth,
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
  if (!place.aside) return { ...place, reference: element }
  return {
    ...place,
    reference: {
      contextElement: element,
      getBoundingClientRect: () => asideBox(element, container, list),
    },
  }
}
