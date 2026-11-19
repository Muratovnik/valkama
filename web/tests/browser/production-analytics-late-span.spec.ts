/**
 * The switch of a step line's span, in the built app (`useStepSpan`): it offers «To now and the
 * forecast» beside «Whole window» only while that span ends before the reset. A week six and a
 * half days in has passed three quarters of its length, where the span to now and a third past it
 * reaches the reset and is the whole window, so the line shows the whole window and no switch
 * stands. «Work»'s week, four days of seven in, still has both, and is the switch's present
 * control.
 */
import { expect } from '@playwright/test'

import type { Quota } from '@/shared/api/analyticsApi.ts'

import { quotaAt, SEATED_NAME, share } from '../fixtures/quota.ts'
import { NOW, openPanel, pageAt, serve, serveQuota } from './analyticsPage.ts'
import { test } from './test.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The quota fixture with the seated account's week six and a half days in. */
function late(): Quota {
  const quota = quotaAt(NOW)
  const seated = quota.accounts[3]
  if (!seated) throw new Error('the seated account is fourth')
  seated.windows[1] = share(NOW.getTime(), quota.utc_offset, {
    kind: 'week',
    left: 12 * HOUR,
    source: 'mod',
    readings: [
      [5 * DAY, 30],
      [5 * MINUTE, 70],
    ],
    forecast: { low_percent: 74, high_percent: 79 },
  })
  return quota
}

test('a week past three quarters of its length shows the whole window, with no switch', async ({
  page,
}) => {
  await serve(page)
  await serveQuota(page, late())
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openPanel(page, pageAt({ by: 'quota_week' }))
  const panel = page.locator('.quota-panel')
  await panel.getByRole('radio', { name: 'Chart' }).check()
  const head = (account: string) =>
    panel.locator(
      `[data-account="${account}"] [data-window="week"] [data-chart="steps"] [data-region="head"]`,
    )

  // Four days of seven: the switch stands with both spans, the first chosen.
  const work = head('Work').getByRole('radio')
  await expect(work).toHaveText(['To now and the forecast', 'Whole window'])
  await expect(work.first()).toBeChecked()

  // Six and a half of seven: the line and its corridor stand, and no switch does.
  const seated = panel.locator(`[data-account="${SEATED_NAME}"] [data-window="week"]`)
  await expect(seated.locator('[data-chart="steps"] [data-mark="corridor"]')).toHaveCount(1)
  await expect(head(SEATED_NAME)).toBeVisible()
  await expect(head(SEATED_NAME).getByRole('radiogroup')).toHaveCount(0)
  await expect(head(SEATED_NAME).getByRole('radio')).toHaveCount(0)
})
