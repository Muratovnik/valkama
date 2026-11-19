/**
 * The step line of a window past its reset, in the built app (`StepLine`, `QuotaWindow`): a window
 * silent by its reset measured nothing after its last reading, so its line stops there, as a
 * running silent window's does, and the line's visible end is that reading, whose hint the pointer
 * finds there. A window still fresh at its reset holds its line to the reset, the plot's end.
 *
 * Every window here reset before the panel's moment, and `fresh_for_seconds` is 900. «Work»'s
 * week was last read six days before its reset, at 9 %, long silent by then. Of the five hours,
 * «Work»'s were last read three hours before their reset, silent by then; the account known by its
 * weekly reset alone was last read twelve minutes before its reset, fresh then though silent by
 * the panel's moment, so a rule that judged the line by the panel's moment rather than by the
 * reset would stop that line too. Twelve minutes are a twenty-fifth of five hours, far wider on
 * the plot than a pixel, which they would not be on a week.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { Quota } from '@/shared/api/analyticsApi.ts'

import { quotaAt, SEATED_NAME, share } from '../fixtures/quota.ts'
import { present } from '../support/present.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { test } from './test.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How far the line's end may stand from where it should: the drawing's rounding, a pixel. */
const NEAR = 1

/** The quota fixture with «Work»'s two windows and the seated account's five hours past their reset. */
function ended(): Quota {
  const quota = quotaAt(NOW)
  const moment = NOW.getTime()
  const work = quota.accounts[0]
  const seated = quota.accounts[3]
  if (!work || !seated) throw new Error('«Work» first, the seated account fourth')
  const window = (shape: Parameters<typeof share>[2]) => share(moment, quota.utc_offset, shape)
  work.windows[0] = window({
    kind: 'five_hour',
    left: -30 * MINUTE,
    source: 'poll',
    readings: [
      [4.5 * HOUR, 20],
      [3.5 * HOUR, 45],
    ],
    forecast: null,
  })
  work.windows[1] = window({
    kind: 'week',
    left: -2 * HOUR,
    source: 'poll',
    readings: [
      [6.5 * DAY, 5],
      [6 * DAY + 2 * HOUR, 9],
    ],
    forecast: null,
  })
  seated.windows[0] = window({
    kind: 'five_hour',
    left: -30 * MINUTE,
    source: 'mod',
    readings: [
      [4 * HOUR, 30],
      [42 * MINUTE, 55],
    ],
    forecast: null,
  })
  return quota
}

/** A window's line as drawn: its readings, its places, where its path ends and its last mark. */
const measure = (window: Locator) =>
  window.locator('[data-chart="steps"]').evaluate((line) => {
    const readings = [...line.querySelectorAll('[data-reading] [data-mark="reading"]')]
    const last = readings.at(-1)?.getBoundingClientRect()
    const path = line.querySelector('[data-mark="line"]')?.getBoundingClientRect()
    const field = line.querySelector('[data-region="field"]')?.getBoundingClientRect()
    return {
      readings: readings.length,
      places: line.querySelectorAll('[data-target]').length,
      end: path?.right ?? Number.NaN,
      y: path ? path.top + 1 : Number.NaN,
      last: last ? last.left + last.width / 2 : Number.NaN,
      right: field?.right ?? Number.NaN,
    }
  })

async function open(page: Page, by: string) {
  await serve(page)
  await serveQuota(page, ended())
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openPanel(page, pageAt({ by }))
  const panel = page.locator('.quota-panel')
  await panel.getByRole('radio', { name: 'Chart' }).check()
  return panel
}

test('a week silent by its reset ends its line at its last reading, which the pointer finds there', async ({
  page,
}, info) => {
  const panel = await open(page, 'quota_week')
  const window = panel.locator('[data-account="Work"] [data-window="week"]')
  const silent = await measure(window)
  await record(info, 'ended-week', silent)
  // Past its reset: no «now», no forecast, its two readings.
  expect([silent.readings, silent.places]).toEqual([2, 0])
  // The line's end is its last reading, well before the plot's end at the reset.
  expect(Math.abs(silent.end - silent.last), 'the line ends at its last reading').toBeLessThan(NEAR)
  expect(silent.right - silent.last, 'its last reading before the reset').toBeGreaterThan(100)

  // The pointer on the line's end finds the reading there: its mark painted, its hint 9 %.
  const mark = window.locator('[data-reading="1"] [data-mark="reading"]')
  await expect(mark).toHaveCSS('opacity', '0')
  await page.mouse.move(1, 1)
  await page.mouse.move(silent.end - 0.5, silent.y, { steps: 2 })
  await expect(mark).toHaveCSS('opacity', '1')
  const hint = page.locator('.tooltip-hint')
  await expect(hint).toHaveCount(1)
  await expect(hint).toContainText('9%')
  const box = present(await mark.boundingBox(), 'the last reading’s mark')
  expect(Math.abs(box.x + box.width / 2 - silent.end), 'its mark at the line’s end').toBeLessThan(
    NEAR,
  )
})

test('five hours silent by their reset end at the last reading; fresh then, they hold to it', async ({
  page,
}, info) => {
  const panel = await open(page, 'quota_five_hour')
  const silent = await measure(panel.locator('[data-account="Work"] [data-window="five_hour"]'))
  const fresh = await measure(
    panel.locator(`[data-account="${SEATED_NAME}"] [data-window="five_hour"]`),
  )
  await record(info, 'ended-five-hours', { silent, fresh })
  expect([silent.readings, silent.places, fresh.readings, fresh.places]).toEqual([2, 0, 2, 0])
  // Silent by the reset: the line ends at the last reading, three hours before the plot's end.
  expect(Math.abs(silent.end - silent.last), 'the silent line ends at its reading').toBeLessThan(
    NEAR,
  )
  expect(silent.right - silent.last, 'its last reading before the reset').toBeGreaterThan(100)
  // Fresh at the reset, though silent now: the line holds to the reset, past its last reading.
  expect(Math.abs(fresh.end - fresh.right), 'the fresh line holds to the reset').toBeLessThan(NEAR)
  expect(fresh.right - fresh.last, 'its last reading before the reset').toBeGreaterThan(20)
})
