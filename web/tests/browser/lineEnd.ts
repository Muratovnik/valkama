import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { frames } from './frames.ts'

/**
 * Each row as drawn: how many lines its words take, the centre of the first of them (a Range
 * over the first text drawn), and for each icon at the row's end the centre of its strokes (the
 * union of what its `svg` draws) against that line, with the target it stands in.
 */
const lineEnds = (rows: Locator, words: string, icons: string) =>
  rows.evaluateAll(
    (nodes, [wordsSelector, iconsSelector]) =>
      nodes.map((row) => {
        const text = row.querySelector(wordsSelector)
        if (!text) throw new Error(`No ${wordsSelector} in the row`)
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
        let first = walker.nextNode()
        while (first && !first.textContent?.trim()) first = walker.nextNode()
        if (!first) throw new Error('The words are not drawn')
        const range = document.createRange()
        range.selectNodeContents(first)
        const line = range.getClientRects()[0]
        if (!line) throw new Error('The first line is not drawn')
        const whole = document.createRange()
        whole.selectNodeContents(text)
        const tops = new Set(
          [...whole.getClientRects()]
            .filter((rect) => rect.width > 0)
            .map((rect) => Math.round(rect.top)),
        )
        const lineCentre = (line.top + line.bottom) / 2
        const marks = [...row.querySelectorAll(iconsSelector)]
          .filter((icon) => icon.checkVisibility({ visibilityProperty: true }))
          .map((icon) => {
            const strokes = [...icon.querySelectorAll('path, circle, line, polyline, rect')].map(
              (stroke) => stroke.getBoundingClientRect(),
            )
            if (!strokes.length) throw new Error('An icon that draws nothing')
            const top = Math.min(...strokes.map((stroke) => stroke.top))
            const bottom = Math.max(...strokes.map((stroke) => stroke.bottom))
            const button = icon.closest('button')
            const target = (button ?? icon).getBoundingClientRect()
            return {
              name: button?.getAttribute('aria-label') ?? '',
              off: Math.round(((top + bottom) / 2 - lineCentre) * 10) / 10,
              target: { height: target.height, width: target.width },
            }
          })
        return { height: row.getBoundingClientRect().height, lines: tops.size, marks }
      }),
    [words, icons] as const,
  )
type Measured = Awaited<ReturnType<typeof lineEnds>>

/**
 * Every icon that ends a row's words is drawn on the centre of their first line, within a pixel,
 * read two frames after whatever changed last.
 */
export async function expectIconsOnFirstLine(
  rows: Locator,
  words: string,
  icons: string,
  what: string,
): Promise<Measured> {
  await frames(rows.first())
  const measured = await lineEnds(rows, words, icons)
  expect(measured.length, `${what}: rows`).toBeGreaterThan(0)
  for (const [index, row] of measured.entries())
    for (const mark of row.marks)
      expect(
        Math.abs(mark.off),
        `${what}: row ${index + 1} of ${row.lines} lines, «${mark.name}» on the first line`,
      ).toBeLessThanOrEqual(1)
  return measured
}

/** At least one of the rows wraps, so the first line and the block are not the same. */
export function expectWrapped(measured: Measured, what: string) {
  expect(
    measured.some((row) => row.lines > 1 && row.marks.length > 0),
    `${what}: a row of words on several lines`,
  ).toBe(true)
}
