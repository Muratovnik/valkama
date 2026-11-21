/**
 * The frame a chart's table scrolls in (`ChartTable`), beside the other chart primitives on their
 * harness page (`ui-charts.spec.ts`), at a wide desktop, a laptop and a phone: what its table
 * places out of the flow — the caption only a screen reader reads, and the words a cell keeps for
 * one — is placed against the frame or something inside it, so it scrolls and is clipped with the
 * table. Placed against what holds the frame, such words in a table scrolled past its frame stood
 * past the panel and scrolled it sideways. Each table holds its caption at least.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { test } from './test.ts'

const WIDTHS = [1440, 1024, 390] as const

/** The harness's tables: the ranked, the days', the windows', the readings' and the small charts'. */
const TABLES = 5

for (const width of WIDTHS)
  test(`at ${width}px what a chart's table places out of the flow stays in its frame`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/tests/browser/harness.html?lang=en&surface=charts')
    const frames = page.locator('[data-harness$="-table"] [data-region="table-frame"]')
    await expect(frames).toHaveCount(TABLES)
    const loose = await frames.evaluateAll((all) =>
      all.flatMap((frame) =>
        [...frame.querySelectorAll<HTMLElement>('*')]
          .filter((element) => /absolute|fixed/u.test(getComputedStyle(element).position))
          .map((element) => ({
            text: element.textContent?.trim() ?? '',
            held: element.offsetParent !== null && frame.contains(element.offsetParent),
          })),
      ),
    )
    await testInfo.attach(`loose-${width}`, {
      body: JSON.stringify(loose, null, 2),
      contentType: 'application/json',
    })
    expect(loose.length, 'what the tables place out of the flow').toBeGreaterThanOrEqual(TABLES)
    for (const one of loose)
      expect(one.held, `«${one.text}» placed against what holds its frame`).toBe(true)
  })

/**
 * How the days' table stands in its frame held `room` pixels away from the least its columns
 * take: how far it scrolls, and how many headings over figures stand at their floor. The least is
 * read with the frame a pixel wide, where every column takes its least.
 */
const daysAt = (page: Page, room: number) =>
  page
    .locator('[data-harness="days-table"] [data-region="table-frame"]')
    .evaluate(async (frame: HTMLElement, by) => {
      // This body is serialized and evaluated in the page, so a module-scope helper would not be in
      // scope here.
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const settle = async () => {
        for (let step = 0; step < 3; step += 1)
          await new Promise((done) => requestAnimationFrame(done))
      }
      frame.style.inlineSize = '1px'
      frame.style.maxInlineSize = 'none'
      await settle()
      const least = frame.querySelector('table')?.getBoundingClientRect().width ?? 0
      frame.style.inlineSize = `${Math.round(least) + by}px`
      await settle()
      return { least, scroll: frame.scrollWidth - frame.clientWidth }
    }, room)

// A frame a few pixels narrower than its table scrolled by those few: nothing a reader could
// reach came into view, and the last column's words stood under its edge. The table gives them
// from its headings' floors instead; a frame narrower by more than the least target, 24px,
// scrolls as one narrower than its table does, and one as wide as the table does not.
test("a chart's table a sliver wider than its frame gives it rather than scroll by it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/tests/browser/harness.html?lang=en&surface=charts')
  const sliver = await daysAt(page, -12)
  expect(sliver.least, 'the least the table takes').toBeGreaterThan(200)
  expect(sliver.scroll, 'a frame 12px narrower than its table').toBeLessThanOrEqual(1)
  const wider = await daysAt(page, -40)
  expect(wider.scroll, 'a frame 40px narrower than its table').toBeGreaterThanOrEqual(24)
  const whole = await daysAt(page, 0)
  expect(whole.scroll, 'a frame as wide as its table').toBeLessThanOrEqual(1)
})
