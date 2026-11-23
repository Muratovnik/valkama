/**
 * The readings' key in a quota window's step line legend, in the built app (`StepLineHead`). The
 * oracle is the rule (DESIGN.md, Charts): a forced palette draws the lines and their keys in its
 * inks, so the readings' key takes the ink their line is drawn in, in the page's palette and in a
 * forced one alike; past its reset both take the inactive ink. The key stayed blue in a forced
 * palette while every other key took its ink.
 *
 * The fixture (`quotaTable`) over «This week»: «Alpha»'s live week, and «Gamma»'s week past its
 * reset.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { quotaTable } from '../fixtures/quotaTable.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { test } from './test.ts'

/** A window card's step line by its account and kind. */
const lineOf = (page: Page, name: string, kind: string) =>
  page.locator(`[data-account="${name}"] [data-window="${kind}"] [data-chart="steps"]`)

/** The paint of a line's readings and of their key's swatch. */
const paintOf = (line: Locator) =>
  line.evaluate((figure) => {
    const path = figure.querySelector('[data-mark="line"]')
    const swatch = figure.querySelector(
      '[data-region="head"] [data-key="line"] [data-mark="swatch"]',
    )
    if (!path || !swatch) throw new Error('a line draws its readings and names them')
    return {
      stroke: getComputedStyle(path).stroke,
      swatch: getComputedStyle(swatch).backgroundColor,
    }
  })

for (const forcedColors of ['none', 'active'] as const)
  test(`with forced colours ${forcedColors} the readings' key takes the ink of their line`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ forcedColors })
    await serve(page)
    await serveQuota(page, quotaTable(NOW))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openPanel(page, pageAt({ by: 'quota_week', period: 'week' }))
    await drawLined(page.locator('.chart-section').first())
    const live = await paintOf(lineOf(page, 'Alpha', 'week'))
    const past = await paintOf(lineOf(page, 'Gamma', 'week'))
    await record(info, `readings key ${forcedColors}`, { live, past })
    expect(live.swatch, 'the live week').toBe(live.stroke)
    expect(past.swatch, 'the week past its reset').toBe(past.stroke)
    expect(live.stroke, 'the two inks apart').not.toBe(past.stroke)
  })
