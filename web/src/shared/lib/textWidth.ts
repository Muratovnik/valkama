/**
 * The drawn width of some words in a font, read from a canvas rather than from anything drawn,
 * so a layout can be worked out before the words are on the page. One canvas serves the page.
 * Where nothing lays the page out there is no canvas, and every text is 0 wide.
 */
let context: CanvasRenderingContext2D | null | undefined

export function drawnWidth(text: string, font: string): number {
  if (context === undefined)
    context =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (!context || !text) return 0
  context.font = font
  return context.measureText(text).width
}
