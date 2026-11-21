/**
 * A quota window past its reset by the page's clock, in the built app (`QuotaWindow`, `WindowBar`),
 * held to DESIGN.md § Analytics: it leads with that it reset and has no new reading, the share
 * it ended at follows as a quieter line, «45% by the reset» as a past window says it — never
 * «before the reset: 45%», which read as what is left until a reset to come — and its bar is drawn
 * in the neutral ink of marks at rest, not the series' hue, so its last share is not read as the
 * share spent now. Led by its share over a bar in the series' hue, an ended window once read as
 * 90 % spent. A window still standing leads with its share as before, its bar in the series' hue:
 * the control.
 *
 * «Work»'s five hours reset half an hour before the page's moment, last read at 45 %, and its week
 * two hours before, last read at 9 %; the unnamed account's windows stand. A forced palette keeps
 * the muted bar's fill apart from its track. At 1440 and 1024 pixels each line of an ended window
 * starts where its bar does, one under the next; each run prints what it measured.
 *
 * As a table, in English and in Russian, the ended window's row says the same where its share
 * stood, the share before the reset under it, and a dash for its pace and its forecast, which
 * once said its reset again as a forecast; a standing window's row keeps its share and forecast.
 * The row's cells start on one line and its account's table fits its frame.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { Quota } from '@/shared/api/analyticsApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import { NIGHT_NAME, quotaAt, SEATED_NAME, share } from '../fixtures/quota.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
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
      ['quota_five_hour', 'five_hour', '45% by the reset', SEATED_NAME],
      ['quota_week', 'week', '9% by the reset', NIGHT_NAME],
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

/** A message as a pattern, each of its slots taking what `slot` matches. */
function shaped(message: string, slot: string) {
  const literal = message.replaceAll(/[.*+?^$()|[\]\\]/gu, String.raw`\$&`)
  return new RegExp(`^${literal.replaceAll(/\{\w+\}/gu, slot)}$`, 'u')
}

/** A row of an account's table as laid out: each cell's text and where its first line stands. */
const rowOf = (row: Locator) =>
  row.evaluate((tr) =>
    [...tr.querySelectorAll('th, td')].map((cell) => {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
      let text = walker.nextNode()
      while (text && !text.textContent?.trim()) text = walker.nextNode()
      const range = document.createRange()
      if (text) range.selectNodeContents(text)
      const [first] = range.getClientRects()
      return { text: cell.textContent?.trim() ?? '', top: first?.top ?? Number.NaN }
    }),
  )

for (const lang of ['en', 'ru'] as const)
  for (const width of [1440, 1024])
    test(`at ${width}px in ${lang} an ended window's table row leads with its reset, its share before it under that`, async ({
      page,
    }, info) => {
      const words = messages[lang].analytics.quota
      const shown = messages[lang].analytics.shown.table
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), lang)
      const measured: Record<string, unknown> = {}
      for (const [by, kind, before, control] of [
        ['quota_five_hour', 'five_hour', 45, 'a1b2c3d4'],
        ['quota_week', 'week', 9, '7e6d5c4b'],
      ] as const) {
        await serve(page)
        await serveQuota(page, ended())
        await page.setViewportSize({ width, height: 1000 })
        await openPanel(page, pageAt({ by }))
        const panel = page.locator('.quota-panel')
        await panel.getByRole('radio', { name: shown }).check()
        await page.evaluate(() => document.fonts.ready)

        const work = panel.locator('[data-account="Work"]')
        const row = work.locator(`.quota-account-table tbody tr[data-key="${kind}"]`)
        const value = row.locator('[data-cell="value"]')
        await expect(value.locator('span').first()).toHaveText(
          shaped(words.ended, String.raw`\d{2}:\d{2}`),
        )
        await expect(value.locator('.chart-detail')).toHaveText(
          shaped(words.past.lead, String.raw`${before}\s?%`),
        )
        await expect(row.locator('td').nth(1)).toHaveText('—')
        await expect(row.locator('[data-cell="forecast"]')).toHaveText('—')
        // The reset is said once, in the row, not again under it.
        await expect(work.locator(`[data-window="${kind}"] [data-fact="reset"]`)).toHaveCount(0)

        // The control: a window that stands keeps its share, alone, and a forecast of its own.
        const standing = panel.locator(
          `[data-account^="${control}"] .quota-account-table tbody tr[data-key="${kind}"]`,
        )
        await expect(standing.locator('[data-cell="value"]')).toHaveText(/^\d+\s?%$/u)
        await expect(standing.locator('.chart-detail')).toHaveCount(0)
        await expect(standing.locator('[data-cell="forecast"]')).not.toHaveText('—')

        // The row's cells start on one line, and the table fits its frame.
        const cells = await rowOf(row)
        const frame = await work.locator('.quota-account-table').evaluate((one) => ({
          scroll: one.scrollWidth,
          client: one.clientWidth,
        }))
        const valueBox = await value.boundingBox()
        measured[kind] = { cells, frame, value: valueBox }
        const tops = cells.map((one) => one.top)
        expect(Math.max(...tops) - Math.min(...tops), 'one line').toBeLessThan(1)
        expect(frame.scroll, 'the table within its frame').toBeLessThanOrEqual(frame.client)
        await expectNoSilentClipping(page, `${kind} table at ${width}px in ${lang}`, '.quota-panel')
      }
      await record(info, `ended-row-${lang}-${width}`, measured)
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
