/**
 * How a spec reads a step line's drawing as numbers: the corners its path runs through, and what
 * its parts' styles declare — where a stretch stands across the plot and how wide it is, and where
 * a mark stands — however the drawing writes them. The order of a style's declarations, how many
 * digits print a figure and which path commands draw a step are how the line is written, not
 * what it draws, so none of them is part of what these read.
 */
export const style = (element: { attributes: (name: string) => string | undefined }) =>
  element.attributes('style') ?? ''

/** A figure to the hundredth, so a check holds the number and not how many digits print it. */
const hundredths = (value: number) => Math.round(value * 100) / 100

type Point = [number, number]

/**
 * How each command a line of steps draws with moves the pen from where it stands, and how many
 * numbers one move takes: a line to a point, a run across, a run up or down.
 */
const MOVES: Record<string, { take: number; to: (at: Point, values: number[]) => Point }> = {
  M: { take: 2, to: (_, [x = Number.NaN, y = Number.NaN]) => [x, y] },
  L: { take: 2, to: (_, [x = Number.NaN, y = Number.NaN]) => [x, y] },
  H: { take: 1, to: ([, y], [x = Number.NaN]) => [x, y] },
  V: { take: 1, to: ([x], [y = Number.NaN]) => [x, y] },
}

/**
 * The corners a step line's path runs through, in the drawing's units, however its commands are
 * written: absolute or relative, a run across or up and down, or a line to a point. A curve, or
 * any command a line of steps does not draw with, throws, so it fails the check that reads it.
 */
export function corners(d = ''): Point[] {
  const found: Point[] = []
  let at: Point = [0, 0]
  for (const [, command = '', given = ''] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/gu)) {
    const move = MOVES[command.toUpperCase()]
    if (!move) throw new Error(`a step line draws with no «${command}»: ${d}`)
    const values = given
      .trim()
      .split(/[\s,]+/u)
      .filter(Boolean)
      .map(Number)
    const relative = command !== command.toUpperCase()
    for (let first = 0; first + move.take <= values.length; first += move.take) {
      const taken = values.slice(first, first + move.take)
      const [x, y] = relative ? move.to([0, 0], taken) : move.to(at, taken)
      at = relative ? [at[0] + x, at[1] + y] : [x, y]
      found.push([hundredths(at[0]), hundredths(at[1])])
    }
  }
  return found
}

/** A figure with its unit or none, as a declaration writes one: `60%`, `0.3`, `24px`. */
const FIGURE = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px)?$/u

/**
 * What an element's style declares, by name: a figure as its number to the hundredth without its
 * unit, and a keyword or an expression as it is written. The order of the declarations, and how
 * many digits print a figure, are not part of what it says.
 */
export function declared(element: {
  attributes: (name: string) => string | undefined
}): Record<string, number | string> {
  return Object.fromEntries(
    style(element)
      .split(';')
      .map((one) => one.split(':').map((part) => part.trim()))
      .filter(([name]) => name)
      .map(([name = '', value = '']) => [
        name,
        FIGURE.test(value) ? hundredths(Number.parseFloat(value)) : value,
      ]),
  )
}

/**
 * Where a stretch stands across the plot, where it ends and how wide it is, in percent where it is
 * a figure, however it is written.
 */
export function placement(element: { attributes: (name: string) => string | undefined }) {
  const found = declared(element)
  return {
    start: found['inset-inline-start'],
    end: found['inset-inline-end'],
    size: found['inline-size'],
  }
}
