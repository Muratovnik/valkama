/**
 * A quota window whose count restarted inside it, its reset unchanged, in the built app: the step
 * line falls at the reading the count restarted at, and the restart is a place on the line at
 * that moment (`StepLine`), its ring painted and its hint shown when the pointer rests on it —
 * «Counter zeroed» with its moment, and that the window's reset did not move — and its table
 * lists it before the reading at its moment (`StepLineTable`). The line once fell to nothing with
 * no word of why. «Work»'s five hours here read 99 %, then 0 % where the count restarted, then
 * 62 %; every other window of the fixture has no restart, so the one place found is this one.
 */
import { expect } from '@playwright/test'

import type { Quota } from '@/shared/api/analyticsApi.ts'

import { quotaAt } from '../fixtures/quota.ts'
import { present } from '../support/present.ts'
import { NOW, openPanel, pageAt, serve, serveQuota } from './analyticsPage.ts'
import { test } from './test.ts'

/** The quota fixture with «Work»'s five hours falling to 0 % where its count restarted. */
function restarted(): Quota {
  const quota = quotaAt(NOW)
  const window = quota.accounts[0]?.windows[0]
  if (!window || !('readings' in window)) throw new Error('«Work» reads its five hours first')
  const [first, middle, last] = window.readings
  if (!first || !middle || !last) throw new Error('«Work»’s five hours hold three readings')
  window.readings = [{ ...first, used_percent: 99 }, { ...middle, used_percent: 0 }, last]
  window.restarts = [middle.at]
  return quota
}

test('a restart of a window’s count is a place on its line with its hint, and a row of its table', async ({
  page,
}) => {
  await serve(page)
  await serveQuota(page, restarted())
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openPanel(page, pageAt({ by: 'quota_five_hour' }))
  const panel = page.locator('.quota-panel')
  await panel.getByRole('radio', { name: 'Chart' }).check()
  const place = panel.locator('[data-chart="steps"] [data-target="restart"]')
  await expect(place).toHaveCount(1)
  const mark = place.locator('[data-mark="place"]')
  await expect(mark).toHaveCSS('opacity', '0')

  // The pointer rests on the ring's middle, where the line falls; the line's one layer over the
  // field takes the pointer for it.
  await page.mouse.move(1, 1)
  const box = present(await mark.boundingBox(), 'the restart’s ring')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 })
  await expect(mark).toHaveCSS('opacity', '1')
  const hint = page.locator('.tooltip-hint')
  await expect(hint).toHaveCount(1)
  await expect(hint).toContainText('Counter zeroed')
  await expect(hint).toContainText('Window reset time unchanged')

  // As a table, the restart is a row before the reading it restarted at, which keeps its 0 %;
  // the forecast's row closes the table as it does every window's.
  await panel.getByRole('radio', { name: 'Table' }).check()
  const work = panel.locator('[data-window="five_hour"]:has(tr[data-key="restart-0"])')
  await expect(work).toHaveCount(1)
  const rows = work.locator('tbody tr[data-key]')
  await expect(rows).toHaveCount(5)
  const keys = await rows.evaluateAll((found) =>
    found.map((row) => (row as HTMLElement).dataset.key),
  )
  expect(keys).toEqual(['0', 'restart-0', '1', '2', 'forecast'])
  const row = work.locator('tr[data-key="restart-0"]')
  await expect(row).toContainText('Counter zeroed')
  await expect(row).toContainText('Window reset time unchanged')
  await expect(work.locator('tr[data-key="1"]')).toContainText('0%')
})
