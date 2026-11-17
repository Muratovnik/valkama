/**
 * What a step line draws and points at past its readings, as the browser draws it, for a spec to
 * hold: run in the page with `page.evaluate(aheadOfLines, selector)` for every step line the
 * selector finds. For each line: the boxes of its head, plot and axis and its height, so a spec
 * can tell that nothing moved; its field; every corner of its forecast's corridor where the field
 * resolves it — a probe laid where the corridor's outline puts each — or none without one; and
 * each place past its readings («now», the forecast at the reset): its stretch, its mark and
 * whether the mark is painted. It reads each part by the hook `StepLine` documents for it.
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

export interface LineAhead {
  boxes: (Box | null)[]
  corners: { left: number; top: number }[]
  field: Box | null
  head: Box | null
  height: number
  places: { kind: string; mark: Box | null; painted: boolean; reach: Box | null }[]
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
  /** `text` split at `at` where no bracket is open. */
  // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
  const split = (text: string, at: string) => {
    const parts: string[] = []
    let depth = 0
    let from = 0
    // A clip path's text is ASCII, so its UTF-16 units are its characters.
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]
      if (char === '(') depth += 1
      if (char === ')') depth -= 1
      if (char === at && depth === 0) {
        parts.push(text.slice(from, index).trim())
        from = index + 1
      }
    }
    return [...parts, text.slice(from).trim()]
  }
  return [...document.querySelectorAll(selector)].map((figure) => {
    const field = figure.querySelector<HTMLElement>('[data-region="field"]')
    const outline =
      figure.querySelector<HTMLElement>('[data-mark="corridor"]')?.style.clipPath.trim() ?? ''
    const corners = outline
      ? split(outline.slice(outline.indexOf('(') + 1, outline.lastIndexOf(')')), ',').map(
          (corner) => {
            const [x = '0', ...y] = split(corner, ' ')
            const probe = document.createElement('i')
            probe.style.cssText = `position:absolute;inset-inline-start:${x};inset-block-start:${y.join(' ')};`
            field?.append(probe)
            const { left, top } = probe.getBoundingClientRect()
            probe.remove()
            return { left, top }
          },
        )
      : []
    return {
      boxes: ['head', 'plot', 'axis'].map((part) =>
        box(figure.querySelector(`[data-region="${part}"]`)),
      ),
      height: figure.getBoundingClientRect().height,
      field: box(field),
      head: box(figure.querySelector('[data-region="head"]')),
      corners,
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

/** The corners of a line's corridor that stand outside its field, by more than half a pixel. */
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
