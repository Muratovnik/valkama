/**
 * A quota window past its reset by the page's clock, in the built app (`QuotaWindow`, `WindowBar`),
 * held to DESIGN.md § Analytics: it leads with that it reset and has no new reading, its share
 * before the reset follows as a quieter line, and its bar is drawn in the neutral ink of marks at
 * rest, not the series' hue, so its last share is not read as the share spent now. Led by its
 * share over a bar in the series' hue, an ended window once read as 90 % spent. A window still
 * standing leads with its share as before, its bar in the series' hue: the control.
 *
 * «Work»'s five hours reset half an hour before the page's moment, last read at 45 %, and its week
 * two hours before, last read at 9 %; the unnamed account's windows stand. A forced palette keeps
 * the muted bar's fill apart from its track. At 1440 and 1024 pixels each line of an ended window
 * starts where its bar does, one under the next; each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { Quota } from '@/shared/api/analyticsApi.ts'

import { NIGHT_NAME, quotaAt, SEATED_NAME, share } from '../fixtures/quota.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { test } from './test.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The four accounts, «Work»'s five hours and week past their reset. */
function ended(): Quota {
  const quota = quotaAt(NOW)
  const moment = NOW.getTime()
  const [work] = quota.accounts
  if (!work) throw new Error('«Work» first')
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
  return quota
}

/** The colour a token resolves to, as the page computes a fill drawn in it. */
const inkOf = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.background = `var(${name})`
    document.body.append(probe)
    const colour = getComputedStyle(probe).backgroundColor
    probe.remove()
    return colour
  }, token)

/** A window's bar as drawn: its fill's colour and box, and its track's colour. */
const barOf = (window: Locator) =>
  window.locator('[data-mark="track"]').evaluate((track) => {
    const fill = track.querySelector('[data-mark="fill"]')
    const box = fill?.getBoundingClientRect()
    return {
      fill: fill ? getComputedStyle(fill).backgroundColor : null,
      track: getComputedStyle(track).backgroundColor,
      width: box?.width ?? 0,
      ticks: track.querySelectorAll('[data-mark="tick"]').length,
    }
  })

/** Where each line over a window's bar, and the bar, start and stand. */
const linesOf = (window: Locator) =>
  window.evaluate((root) =>
    [...root.querySelectorAll('[data-lead], [data-mark="track"]')].map((line) => {
      const { x, y, height } = line.getBoundingClientRect()
      return { line: (line as HTMLElement).dataset.lead ?? 'bar', x, y, height }
    }),
  )

async function open(page: Page, by: string, width: number) {
  await serve(page)
  await serveQuota(page, ended())
  await page.setViewportSize({ width, height: 1000 })
  await openPanel(page, pageAt({ by }))
  const panel = page.locator('.quota-panel')
  await panel.getByRole('radio', { name: 'Chart' }).check()
  return panel
}

const RESET = /^Reset at \d{2}:\d{2}, no new readings$/u

for (const width of [1440, 1024])
  test(`at ${width}px an ended window leads with its reset and its share before it, over a muted bar`, async ({
    page,
  }, info) => {
    const measured: Record<string, unknown> = {}
    // Each kind with the account whose window of it stands and draws a fill: the control.
    for (const [by, kind, before, control] of [
      ['quota_five_hour', 'five_hour', 'before the reset: 45%', SEATED_NAME],
      ['quota_week', 'week', 'before the reset: 9%', NIGHT_NAME],
    ] as const) {
      const panel = await open(page, by, width)
      const window = panel.locator(`[data-account="Work"] [data-window="${kind}"]`)
      const leads = window.locator('[data-lead]')
      await expect(leads).toHaveCount(2)
      await expect(leads.nth(0)).toHaveAttribute('data-lead', 'ended')
      await expect(leads.nth(0)).toHaveText(RESET)
      await expect(leads.nth(1)).toHaveAttribute('data-lead', 'before')
      await expect(leads.nth(1)).toHaveText(before)
      await expect(window.locator('[data-lead="share"]')).toHaveCount(0)

      // The bar in the neutral ink, not the series' hue, with no pace tick.
      const bar = await barOf(window)
      const [muted, series] = [
        await inkOf(page, '--color-text-tertiary'),
        await inkOf(page, '--color-series-1'),
      ]
      expect(muted, 'the two inks differ').not.toBe(series)
      expect(bar.fill, 'the ended bar’s fill').toBe(muted)
      expect(bar.width, 'the share before the reset still drawn').toBeGreaterThan(0)
      expect(bar.ticks).toBe(0)

      // The control: a window that stands leads with its share, its bar in the series' hue.
      const standing = panel.locator(`[data-account="${control}"] [data-window="${kind}"]`)
      await expect(standing.locator('[data-lead]')).toHaveCount(1)
      await expect(standing.locator('[data-lead="share"]')).toContainText('used')
      const standingBar = await barOf(standing)
      expect(standingBar.fill, 'the standing bar’s fill').toBe(series)

      // Each line starts where the bar does, one under the next.
      const lines = await linesOf(window)
      measured[kind] = { bar, standing: standingBar, lines }
      expect(lines.map((one) => one.line)).toEqual(['ended', 'before', 'bar'])
      const starts = lines.map((one) => one.x)
      expect(Math.max(...starts) - Math.min(...starts), 'one start').toBeLessThan(1)
      const tops = lines.map((one) => one.y)
      expect(tops, 'one under the next').toEqual(tops.toSorted((a, b) => a - b))
    }
    await record(info, `ended-window-${width}`, measured)
  })

test('a forced palette keeps the ended bar’s fill apart from its track', async ({ page }, info) => {
  await page.emulateMedia({ forcedColors: 'active' })
  const panel = await open(page, 'quota_five_hour', 1440)
  const bar = await barOf(panel.locator('[data-account="Work"] [data-window="five_hour"]'))
  await record(info, 'ended-window-forced', bar)
  expect(bar.width).toBeGreaterThan(0)
  expect(bar.fill).not.toBeNull()
  expect(bar.fill, 'the fill is not the track’s ground').not.toBe(bar.track)
})
