/**
 * How tall a band a pointer can press a reference across, in whole pixels: from the middle
 * of its first line up and down, as far as a press there still lands on the reference.
 *
 * It asks the browser's own hit test rather than any one way of drawing the target, so it
 * holds whether the band is a pseudo-element, padding or the line itself. For
 * `locator.evaluate`, so it closes over nothing.
 */
export function pointerBand(reference: Element): number {
  reference.scrollIntoView({ block: 'center', behavior: 'instant' })
  const words = document.createRange()
  words.selectNodeContents(reference)
  const first = [...words.getClientRects()].find((rect) => rect.width > 0)
  if (!first) return 0
  const x = first.left + Math.min(2, first.width / 2)
  const middle = Math.round(first.top + first.height / 2)
  const hits = (y: number) =>
    document.elementFromPoint(x, y)?.closest('.rich-reference') === reference
  if (!hits(middle)) return 0
  let up = 0
  while (up < 100 && hits(middle - up - 1)) up += 1
  let down = 0
  while (down < 100 && hits(middle + down + 1)) down += 1
  return up + down + 1
}
