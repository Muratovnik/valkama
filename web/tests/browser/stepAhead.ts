/**
 * What a step line draws and points at past its readings, as the browser draws it, for a spec to
 * hold: run in the page with `page.evaluate(aheadOfLines, selector)` for every step line the
 * selector finds. For each line: the boxes of its head, plot and axis and its height, so a spec
 * can tell that nothing moved; its field; every corner of its forecast's line and of the fill of
 * its range under it, where the plot's own mapping puts each on the screen, or none without one;
 * how the line and the fill are painted; and each place past its readings («now», the forecast at
 * the reset): its stretch, its mark and whether the mark is painted. It reads each part by the
 * hook `StepLine` documents for it.
 */

/** A box as the browser reports it, plain for the spec's side. */
interface Box {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

/** A path of the plot as drawn: its corners on the screen and how it is painted. */
interface DrawnPath {
  corners: { left: number; top: number }[]
  dash: string
  fill: string
  fillOpacity: number
  stroke: string
  strokeWidth: number
}

export interface LineAhead {
  boxes: (Box | null)[]
  /** Every corner of the forecast's line and of its range's fill. */
  corners: { left: number; top: number }[]
  /** The drawing inside the field, whose top is the level of the whole window. */
  drawing: Box | null
  field: Box | null
  /** The forecast's dashed line, and how many the plot draws. */
  forecast: DrawnPath | null
  forecasts: number
  head: Box | null
  height: number
  places: { kind: string; mark: Box | null; painted: boolean; reach: Box | null }[]
  /** The fill of the forecast's range under its line. */
  range: DrawnPath | null
}

/** Runs in the page: every function it uses is its own. */
export function aheadOfLines(selector: string): LineAhead[] {
  // This body runs in the page, so a helper at the module's own scope would not be there.
  // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
  const box = (element: Element | null | undefined): Box | null => {
    if (!element) return null
    const { bottom, height, left, right, top, width } = element.getBoundingClientRect()
    return { bottom, height, left, right, top, width }
  }
  /**
   * A path's corners where the plot's own mapping, stretched as it is, puts them on the screen,
   * and how it is painted. The plot draws its paths of moves and straight lines alone.
   */
  // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
  const drawn = (path: SVGPathElement | null): DrawnPath | null => {
    const matrix = path?.getScreenCTM()
    if (!path || !matrix) return null
    const numbers = (path.getAttribute('d') ?? '').match(/-?[\d.]+(?:e-?\d+)?/gu) ?? []
    const corners: { left: number; top: number }[] = []
    for (let index = 0; index + 1 < numbers.length; index += 2) {
      const { x, y } = new DOMPoint(
        Number(numbers[index]),
        Number(numbers[index + 1]),
      ).matrixTransform(matrix)
      corners.push({ left: x, top: y })
    }
    const paint = getComputedStyle(path)
    return {
      corners,
      dash: paint.strokeDasharray,
      fill: paint.fill,
      fillOpacity: Number(paint.fillOpacity),
      stroke: paint.stroke,
      strokeWidth: Number.parseFloat(paint.strokeWidth),
    }
  }
  return [...document.querySelectorAll(selector)].map((figure) => {
    const field = figure.querySelector<HTMLElement>('[data-region="field"]')
    const forecasts = figure.querySelectorAll<SVGPathElement>('[data-mark="forecast"]')
    const forecast = drawn(forecasts[0] ?? null)
    const range = drawn(figure.querySelector<SVGPathElement>('[data-mark="range"]'))
    return {
      boxes: ['head', 'plot', 'axis'].map((part) =>
        box(figure.querySelector(`[data-region="${part}"]`)),
      ),
      height: figure.getBoundingClientRect().height,
      field: box(field),
      drawing: box(figure.querySelector('[data-region="drawing"]')),
      head: box(figure.querySelector('[data-region="head"]')),
      corners: [...(forecast?.corners ?? []), ...(range?.corners ?? [])],
      forecast,
      forecasts: forecasts.length,
      range,
      places: [...figure.querySelectorAll<HTMLElement>('[data-target]')].map((target) => {
        const mark = target.querySelector('[data-mark="place"]')
        return {
          kind: target.dataset.target ?? '',
          reach: box(target),
          mark: box(mark),
          painted: mark?.checkVisibility({ opacityProperty: true }) ?? false,
        }
      }),
    }
  })
}

/** The corners of a line's forecast that stand outside its field, by more than half a pixel. */
export function cornersOutside(line: LineAhead) {
  const field = line.field
  return field
    ? line.corners.filter(
        ({ left, top }) =>
          left < field.left - 0.5 ||
          left > field.right + 0.5 ||
          top < field.top - 0.5 ||
          top > field.bottom + 0.5,
      )
    : line.corners
}

/** The room between a hint and the point it stands at (`OFFSET` in `hintPlacement.ts`). */
const OFFSET = 6

/**
 * Runs in the page: where the hint shown stands against the latest reading's dot of the `line`th
 * step line `lines` finds, both as drawn while pointed at: the side and the level of its corner
 * nearest the dot, and how far across and up or down that corner stands from the dot's
 * (`hintPlacement.ts`: a point's hint stands at its top right, its bottom left corner `OFFSET`
 * past it and over it, mirrored or under where the room asks), and whether it stands inside the
 * window. Null where no hint or no reading is drawn.
 */
export function latestHint({ lines, line }: { line: number; lines: string }) {
  const hint = document.querySelector('[data-hint-surface]')?.getBoundingClientRect()
  const one = document.querySelectorAll(lines)[line]
  const dot = [...(one?.querySelectorAll('[data-reading]') ?? [])]
    .at(-1)
    ?.querySelector('[data-mark="reading"]')
    ?.getBoundingClientRect()
  if (!hint || !dot) return null
  let side = 'neither'
  if (hint.left >= dot.right - 0.5) side = 'right'
  else if (hint.right <= dot.left + 0.5) side = 'left'
  let level = 'neither'
  if (hint.bottom <= dot.top + 0.5) level = 'over'
  else if (hint.top >= dot.bottom - 0.5) level = 'under'
  return {
    side,
    level,
    across: side === 'right' ? hint.left - dot.right : dot.left - hint.right,
    down: level === 'over' ? dot.top - hint.bottom : hint.top - dot.bottom,
    inside: hint.left >= 0 && hint.right <= window.innerWidth,
  }
}

/** Whether a hint `latestHint` read stands at its dot as a point's hint does, inside the window. */
export function hintAtDot(hint: ReturnType<typeof latestHint>) {
  return (
    hint !== null &&
    hint.side !== 'neither' &&
    hint.level !== 'neither' &&
    Math.abs(hint.across - OFFSET) < 1 &&
    Math.abs(hint.down - OFFSET) < 1 &&
    hint.inside
  )
}
