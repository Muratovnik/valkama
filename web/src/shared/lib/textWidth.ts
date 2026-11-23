/**
 * The drawn width of some words in a font, read from a canvas rather than from anything drawn,
 * so a layout can be worked out before the words are on the page. One canvas serves the page.
 * Where nothing lays the page out there is no canvas, and every text is 0 wide.
 *
 * A canvas draws figures as the font proportions them and has no `font-variant-numeric`, so words
 * drawn in figures of one width (`tabular-nums`) are measured with each figure as wide as the
 * font draws one of those: read once a font from a hidden copy of one figure, since no canvas
 * gives it. Measured proportional, «35%» came out 28.5px where it is drawn 29.6px wide, and a
 * hint's side was decided by a width that did not hold its lines.
 */
let context: CanvasRenderingContext2D | null | undefined

/** How the figures of the words are drawn: as the font proportions them, or each one width. */
export type Figures = 'proportional' | 'tabular'

/** The width of one figure drawn `tabular-nums`, by font, once the font's faces have loaded. */
const figureWidths = new Map<string, number>()

/** How wide one figure of one width is in `font`, as the page draws it. */
function figureWidth(font: string): number {
  const known = figureWidths.get(font)
  if (known !== undefined) return known
  const copy = document.createElement('span')
  copy.style.position = 'absolute'
  copy.style.visibility = 'hidden'
  copy.style.whiteSpace = 'pre'
  // The shorthand resets the figures, so they are set after it.
  copy.style.font = font
  copy.style.fontVariantNumeric = 'tabular-nums'
  copy.textContent = '0'
  document.body.append(copy)
  const width = copy.getBoundingClientRect().width
  copy.remove()
  // A face still loading draws another face's figure: it is measured again next time.
  const faces = document.fonts as FontFaceSet | undefined
  if (!faces || faces.check(font)) figureWidths.set(font, width)
  return width
}

export function drawnWidth(text: string, font: string, figures: Figures = 'proportional'): number {
  if (context === undefined)
    context =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (!context || !text) return 0
  context.font = font
  const width = context.measureText(text).width
  const digits = figures === 'tabular' ? (text.match(/\d/gu) ?? []) : []
  if (!digits.length) return width
  const drawn = context
  const one = figureWidth(font)
  return digits.reduce((sum, digit) => sum + one - drawn.measureText(digit).width, width)
}
