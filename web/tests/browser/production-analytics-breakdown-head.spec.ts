/**
 * «Breakdown» stands in its window's heading row, in the built app (`QuotaWindow`, `PanelLevel`):
 * a compact button at the row's end, on one line with the window's name, its right edge at the
 * window's content edge, and nothing of it under the chart. A name too long for the row is cut
 * short before the button wraps under it. Measured at 1440, 1280, 1024 and 390 pixels.
 *
 * The quota fixture, with «Work»'s model's week named for a model long enough to be cut on a phone.
 * Each window that offers what used it is measured: its heading row (`data-level-head`), its
 * heading, the button (`data-spend`) and its step line (`data-chart="steps"`), whose right edge is
 * the window's content edge.
 */
import { expect } from '@playwright/test'

import type { Quota } from '@/shared/api/analyticsApi.ts'

import { quotaAt } from '../fixtures/quota.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { test } from './test.ts'

/** How far two edges may stand apart and still be one: the layout's rounding, a pixel. */
const NEAR = 1

const LONG_MODEL = 'a-model-with-a-name-long-enough-to-be-cut-short-on-a-phone'

/** The quota fixture with «Work»'s model's week named for the long model. */
function longNamed(): Quota {
  const quota = quotaAt(NOW)
  const window = quota.accounts[0]?.windows[2]
  if (!window || window.kind !== 'week_model') throw new Error('«Work»’s third window is a model’s')
  window.model = LONG_MODEL
  return quota
}

for (const width of [1440, 1280, 1024, 390])
  test(`«Breakdown» stands at the end of its window's heading row at ${width} px`, async ({
    page,
  }, info) => {
    await serve(page)
    await serveQuota(page, longNamed())
    await page.setViewportSize({ width, height: 1000 })
    await openPanel(page, pageAt({ by: 'quota_week' }))
    const panel = page.locator('.quota-panel')
    await panel.getByRole('radio', { name: 'Chart' }).check()
    const windows = panel.locator('[data-window]:has([data-spend])')
    await expect(windows.first()).toBeVisible()
    const measured = await windows.evaluateAll((found) =>
      found.map((window) => {
        const head = window.querySelector(':scope > [data-level-head]')
        const title = head?.querySelector<HTMLElement>(':is(h1, h2, h3, h4, h5, h6)')
        const button = head?.querySelector('[data-spend]')?.getBoundingClientRect()
        const line = window.querySelector('[data-chart="steps"]')?.getBoundingClientRect()
        const words = document.createRange()
        if (title) words.selectNodeContents(title)
        const lines = new Set([...words.getClientRects()].map(({ top }) => Math.round(top)))
        const text = words.getBoundingClientRect()
        const nan = Number.NaN
        return {
          name: title?.textContent ?? '',
          spends: window.querySelectorAll('[data-spend]').length,
          lines: lines.size,
          cut: (title?.scrollWidth ?? 0) > (title?.clientWidth ?? 0),
          title: {
            top: text.top,
            bottom: text.bottom,
            right: title?.getBoundingClientRect().right ?? nan,
          },
          button: {
            top: button?.top ?? nan,
            bottom: button?.bottom ?? nan,
            left: button?.left ?? nan,
            right: button?.right ?? nan,
          },
          edge: line?.right ?? nan,
          below: (button?.top ?? nan) >= (line?.top ?? nan),
        }
      }),
    )
    await record(info, `breakdown-head-${width}`, measured)
    // «Work»'s week and model's week, and the account known by its weekly reset alone.
    expect(measured.length, 'windows that offer what used them').toBeGreaterThanOrEqual(2)
    for (const one of measured) {
      expect(one.spends, `${one.name}: one «Breakdown», in the heading row`).toBe(1)
      expect(one.below, `${one.name}: nothing under the chart`).toBe(false)
      expect(one.lines, `${one.name}: the name on one line`).toBe(1)
      // The button on the name's line: its box spans the name's line box.
      expect(one.button.top, `${one.name}: the button on the name's row`).toBeLessThan(
        one.title.bottom,
      )
      expect(one.button.bottom, `${one.name}: the button on the name's row`).toBeGreaterThan(
        one.title.top,
      )
      expect(one.title.right, `${one.name}: the name clear of the button`).toBeLessThanOrEqual(
        one.button.left + NEAR,
      )
      expect(
        Math.abs(one.button.right - one.edge),
        `${one.name}: at the content edge`,
      ).toBeLessThan(NEAR)
    }
    // The long name is cut short on a phone, the button still on its line beside it.
    const long = measured.find(({ name }) => name.includes(LONG_MODEL))
    expect(long, 'the model’s week with the long name').toBeDefined()
    expect(width !== 390 || long?.cut === true, 'on a phone the long name cut short').toBe(true)
  })
