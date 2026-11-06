/**
 * A lane's heading that wraps starts its next row where its words start: under the epic's
 * number, or under the title of the lane with no epic, and never under the chevron or at
 * the heading's own edge, where the counts once stood 4px left of the chevron and 28px left
 * of the number they count for.
 */
import { expect } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, serve, shot } from './boardPage.ts'
import { test } from './test.ts'

interface Row {
  left: number
  parts: string[]
}

interface Heading {
  rows: Row[]
  words: number
}

test('a lane heading that wraps at 390px starts its next row under its words', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  await page.mouse.move(0, 0)

  const headings = await page.locator('.lane-head').evaluateAll((heads) =>
    heads.map((head) => {
      const words = head.querySelector('.lane-reference') ?? head.querySelector('.lane-title')
      // Every part the heading lays out in its rows; one it takes out of them to lie over
      // the last row, or that is only for a screen reader, starts no row. Parts of one row
      // are centred on it, so their tops differ: a part below everything before it is a row.
      const parts = [...head.children]
        .filter(
          (part) =>
            getComputedStyle(part).position !== 'absolute' &&
            part.getBoundingClientRect().width > 1,
        )
        .map((part) => ({ box: part.getBoundingClientRect(), name: String(part.className) }))
        .toSorted((one, two) => one.box.top - two.box.top)
      const rows: (Row & { bottom: number })[] = []
      for (const { box, name } of parts) {
        const last = rows.at(-1)
        if (last && box.top < last.bottom - 1) {
          last.left = Math.min(last.left, box.left)
          last.bottom = Math.max(last.bottom, box.bottom)
          last.parts.push(name)
        } else rows.push({ bottom: box.bottom, left: box.left, parts: [name] })
      }
      return {
        rows: rows.map(({ left, parts: names }) => ({ left, parts: names })),
        words: words?.getBoundingClientRect().left ?? Number.NaN,
      } satisfies Heading
    }),
  )

  const wrapped = headings.filter((heading) => heading.rows.length > 1)
  // An epic's lane, an empty one and a closed one each wrap here; a heading on one row
  // proves nothing about where a second one starts.
  expect(wrapped.length, 'lane headings that wrap').toBeGreaterThanOrEqual(3)
  for (const [index, heading] of wrapped.entries()) {
    const [first, ...below] = heading.rows
    expect(first?.parts[0], `heading ${index} leads with its toggle`).toContain('lane-toggle')
    for (const row of below)
      expect(
        Math.abs(row.left - heading.words),
        `heading ${index}: ${row.parts.join(' + ')} starts ${Math.round(row.left - heading.words)}px from its words`,
      ).toBeLessThanOrEqual(1)
  }
  await page.screenshot(shot(info, 'lane-wrap-390.png'))
})
