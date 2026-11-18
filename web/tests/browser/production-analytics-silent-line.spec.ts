/**
 * A quota window's step line ends where its readings end, in the real app: a source writes a
 * reading only when a value changes, so a fresh window's line holds flat from its last reading to
 * «now», while a silent window measured nothing past its last reading and its line stops there,
 * nothing drawn between it and «now», which keeps its ring. The weeks of the quota fixture hold
 * both: «Work»'s week fresh, the unnamed account's silent for days. Each window's state is the one
 * it declares (`data-state`), each line's parts the hooks `StepLine` documents.
 */
import { expect } from '@playwright/test'

import { openPanel, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

/** How far the line's end may stand from a mark's centre: the drawing's rounding, a pixel. */
const NEAR = 1

test('a silent window’s line stops at its last reading, and a fresh one’s reaches now', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openPanel(page, pageAt({ by: 'quota_week' }))
  const panel = page.locator('.quota-panel')
  await panel.getByRole('radio', { name: 'Chart' }).check()
  const lines = panel.locator('[data-window]:has([data-chart="steps"] [data-target="now"])')
  await expect(lines.first()).toBeVisible()
  const measured = await lines.evaluateAll((windows) =>
    windows.map((window) => {
      const centre = (element: Element | null | undefined) => {
        const box = element?.getBoundingClientRect()
        return box ? box.left + box.width / 2 : Number.NaN
      }
      const line = window.querySelector('[data-chart="steps"]')
      return {
        state: (window as HTMLElement).dataset.state ?? '',
        end: line?.querySelector('[data-mark="line"]')?.getBoundingClientRect().right ?? Number.NaN,
        last: centre(
          [...(line?.querySelectorAll('[data-reading]') ?? [])]
            .at(-1)
            ?.querySelector('[data-mark="reading"]'),
        ),
        now: centre(line?.querySelector('[data-target="now"] [data-mark="place"]')),
      }
    }),
  )
  await record(info, 'line-ends', measured)
  const silent = measured.filter(({ state }) => state === 'silent')
  const fresh = measured.filter(({ state }) => state === 'fresh')
  expect(silent.length, 'silent windows drawn').toBeGreaterThanOrEqual(1)
  expect(fresh.length, 'fresh windows drawn').toBeGreaterThanOrEqual(1)
  for (const one of silent) {
    // Stopped at the last reading, which stands well before now.
    expect(Math.abs(one.end - one.last), 'a silent line ends at its last reading').toBeLessThan(
      NEAR,
    )
    expect(one.now - one.last, 'a silent window’s last reading before now').toBeGreaterThan(8)
  }
  for (const one of fresh)
    expect(Math.abs(one.end - one.now), 'a fresh line reaches now').toBeLessThan(NEAR)
})
