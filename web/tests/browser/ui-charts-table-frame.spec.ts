/**
 * The frame a chart's table scrolls in (`ChartTable`), beside the other chart primitives on their
 * harness page (`ui-charts.spec.ts`), at a wide desktop, a laptop and a phone: what its table
 * places out of the flow — the caption only a screen reader reads, and the words a cell keeps for
 * one — is placed against the frame or something inside it, so it scrolls and is clipped with the
 * table. Placed against what holds the frame, such words in a table scrolled past its frame stood
 * past the panel and scrolled it sideways. Each table holds its caption at least.
 */
import { expect } from '@playwright/test'

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
