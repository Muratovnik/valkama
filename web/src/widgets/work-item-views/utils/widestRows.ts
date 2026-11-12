/**
 * The rows that give a table its column widths.
 *
 * A table works out its column widths from every cell it holds, so a list that
 * draws only some of its rows would move its columns as others arrive. It keeps
 * drawn, collapsed, the row with the widest value of each column instead: a
 * collapsed row gives its widths and takes no height.
 */

/** One column: what a row prints in it, and the token of the font it prints in. */
export interface WidthColumn<Row> {
  font: string
  word: (row: Row) => string
}

/** The widest of some words in one font; of equal length the canvas decides. */
function widestWord(
  words: readonly (readonly [string, number])[],
  canvas: CanvasRenderingContext2D,
  font: string,
) {
  let longest = 0
  for (const [word] of words) longest = Math.max(longest, word.length)
  canvas.font = font
  let widest = -1
  let at = -1
  const measured = new Map<string, number>()
  for (const [word, index] of words) {
    if (word.length < longest - 1) continue
    const width = measured.get(word) ?? canvas.measureText(word).width
    measured.set(word, width)
    if (width > widest) {
      widest = width
      at = index
    }
  }
  return at
}

/**
 * The row with the widest value of each column, of the rows from `from` on; the
 * rows before it are drawn anyway. Null where nothing measures text.
 */
export function widestRows<Row>(
  all: readonly Row[],
  columns: readonly WidthColumn<Row>[],
  from = 0,
): Set<Row> | null {
  const canvas = document.createElement('canvas').getContext('2d')
  if (!canvas) return null
  const style = getComputedStyle(document.documentElement)
  const held = new Set<Row>()
  for (const { font, word } of columns) {
    const at = widestWord(
      all.map((row, index) => [word(row), index] as const),
      canvas,
      style.getPropertyValue(font),
    )
    if (at >= from) held.add(all[at] as Row)
  }
  return held
}
