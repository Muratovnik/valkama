import type { Locator } from '@playwright/test'

/**
 * Where an element is drawn, not where its box stands: the ink of an icon's strokes and the
 * first and last letters of a text. A 16px chevron draws 8px of it in the middle of its box,
 * and a heading padded on one side starts its words later than its box, so the box tells a
 * test nothing about which edge a reader sees.
 */
export const drawnBox = (target: Locator) =>
  target.evaluate((node) => {
    const rects: DOMRect[] = []
    if (node instanceof SVGElement) {
      for (const part of node.querySelectorAll('path, line, polyline, circle, rect'))
        rects.push(part.getBoundingClientRect())
    } else {
      const range = document.createRange()
      range.selectNodeContents(node)
      rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0))
    }
    if (!rects.length) throw new Error('Nothing drawn')
    return {
      left: Math.min(...rects.map((rect) => rect.left)),
      right: Math.max(...rects.map((rect) => rect.right)),
      top: Math.min(...rects.map((rect) => rect.top)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
    }
  })

/** The left edge of an element's own box. */
export const startOf = (target: Locator) =>
  target.evaluate((node) => node.getBoundingClientRect().left)
