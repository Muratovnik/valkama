/**
 * What a step line draws and points at past its readings, as the browser draws it, for a spec to
 * hold: run in the page with `page.evaluate(aheadOfLines, selector)` for every step line the
 * selector finds. For each line: the boxes of its head, plot and axis and its height, so a spec
 * can tell that nothing moved; its field; every corner of its forecast's corridor where the field
 * resolves it — a probe laid where the corridor's outline puts each — or none without one; and
 * each place past its readings («now», the forecast at the reset): its stretch, its mark and
 * whether the mark is painted.
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
    const field = figure.querySelector<HTMLElement>('.step-field')
    const outline = figure.querySelector<HTMLElement>('.step-ahead')?.style.clipPath.trim() ?? ''
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
      boxes: ['.step-head', '.step-plot', '.step-axis'].map((part) =>
        box(figure.querySelector(part)),
      ),
      height: figure.getBoundingClientRect().height,
      field: box(field),
      head: box(figure.querySelector('.step-head')),
      corners,
      places: [...figure.querySelectorAll<HTMLElement>('.step-target')].map((target) => {
        const mark = target.querySelector('.step-target-mark')
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
