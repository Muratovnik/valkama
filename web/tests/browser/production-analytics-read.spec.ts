/**
 * What the Analytics page shows while a read is under way and after one failed, in the real app
 * over the browser double.
 *
 * A read again of the view on show that fails — the bar's refresh or a tick of «Now» — leaves the
 * figures as they stood: the summary cells say the same, no tile with figures says it could not be
 * read, and the bar says beside the data's age that the refresh failed, with the way to ask again,
 * while nothing on the page moves; the quota's read again that fails says so there too, and its
 * panel keeps its figures where they stood. In «Now» the next tick asks again by itself, and the
 * summary is on show at every moment of a minute of failing ticks. While a new period is read, the
 * last one's panel and tiles stay drawn and dimmed until the answer, with no wait mark and nothing
 * moved, the period chosen already marked; a refresh of the same view, held as long, dims nothing.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serveUsage } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { quotaAt } from '../fixtures/quota.ts'
import { openReport, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { NOW as LIVE_NOW, serveLive, settled, watchPage } from './liveDouble.ts'
import { LIVE_WORK, WORLD } from './served/analyticsRead.ts'
import { test } from './test.ts'

/** Wednesday afternoon, the moment `openReport`'s week is read at. */
const NOW = new Date(2026, 10, 11, 14, 30)

/** How the double answers: from its work, refusing every read, or holding each until let go. */
interface Switch {
  failing: boolean
  /** Holds every read from now until the returned call lets them go. */
  hold: () => () => void
}

/** A promise that settles when `open` is called. */
function closedGate() {
  let open: (() => void) | undefined
  const passed = new Promise<void>((resolve) => {
    open = resolve
  })
  return { passed, open: () => open?.() }
}

async function serveSwitched(page: Page, world: readonly TimedStretch[]) {
  let held: Promise<void> | null = null
  const answer: Switch = {
    failing: false,
    hold: () => {
      const gate = closedGate()
      held = gate.passed
      return () => {
        held = null
        gate.open()
      }
    },
  }
  await page.clock.setSystemTime(NOW)
  await installBackend(page)
  await serveQuota(page, quotaAt(NOW))
  await page.route('**/api/analytics/usage?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    if (answer.failing) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      return
    }
    if (held) await held
    await route
      .fulfill({
        contentType: 'application/json',
        body: JSON.stringify(serveUsage(world, query)),
      })
      .catch(() => {})
  })
  return answer
}

/** What a failed read could take away: the summary's figures and how each tile stands. */
const shown = (page: Page) =>
  page.evaluate(() => ({
    figures: [...document.querySelectorAll('.spending-tiles .tile-figure')].map((cell) =>
      cell.textContent?.replaceAll(/\s+/gu, ' ').trim(),
    ),
    tiles: [...document.querySelectorAll('.analytics-rail .rail-tile')].map(
      (tile) => (tile as HTMLElement).dataset.state,
    ),
    failedTiles: [...document.querySelectorAll('.analytics-rail .rail-tile')].filter((tile) =>
      tile.textContent?.includes('Could not be read'),
    ).length,
  }))

/** Where the bar, the rail and the panel stand, to the hundredth of a pixel. */
const frame = (page: Page) =>
  page.evaluate(() =>
    ['.analytics-page-bar', '.analytics-page-rail', '.analytics-panel'].map((selector) => {
      const element = document.querySelector(selector)
      if (!element || !(element as HTMLElement).offsetParent) return `${selector}: hidden`
      const { x, y, width, height } = element.getBoundingClientRect()
      const box = [x, y, width, height].map((number) => Math.round(number * 100) / 100)
      return `${selector}: ${box.join(' ')}`
    }),
  )

for (const width of [390, 1024, 1440, 1920]) {
  test(`a refresh that fails keeps the figures and says so beside their age, moving nothing, at ${width}px`, async ({
    page,
  }, info) => {
    const answer = await serveSwitched(page, WORLD)
    const analytics = await openReport(page, width, pageAt())
    await expect(analytics.locator('.analytics-rail .rail-tile[data-state="loading"]')).toHaveCount(
      0,
    )
    const before = { shown: await shown(page), frame: await frame(page) }
    expect(before.shown.failedTiles).toBe(0)

    answer.failing = true
    await analytics.locator('.analytics-refresh').click()
    const failed = analytics.locator('.refresh-failed')
    await expect(failed).toBeVisible()
    // On a phone's row, which has no room for the retry's own word, the words are the retry.
    await expect(failed).toHaveText('Could not refresh · Retry')
    await expect(analytics.locator('.analytics-rail [aria-busy="true"]')).toHaveCount(0)
    const after = { shown: await shown(page), frame: await frame(page) }
    expect(after.shown).toEqual(before.shown)
    await expect(analytics.locator('.platform-state-panel')).toHaveCount(0)
    expect(after.frame).toEqual(before.frame)

    // Its retry asks again; answered, the mark goes and the figures stand as read.
    answer.failing = false
    await failed.getByRole('button', { name: /Retry$/u }).click()
    await expect(failed).toHaveCount(0)
    const retried = await shown(page)
    expect(retried.figures).toEqual(before.shown.figures)
    expect(await frame(page)).toEqual(before.frame)
    await record(info, `read-failed-${width}`, { before, after })
  })
}

test('«Now» keeps its summary through a minute of failing ticks, and the next tick reads again', async ({
  page,
}, info) => {
  await page.clock.install({ time: LIVE_NOW })
  const { count } = await watchPage(page)
  const double = await serveLive(page, LIVE_WORK)
  // Registered last, so it is asked first: while failing, every read is refused and counted.
  let failing = false
  await page.route('**/api/analytics/usage?*', async (route) => {
    if (!failing) return route.fallback()
    double.asked.push(new URL(route.request().url()).searchParams)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })
  // The page's time stops before it opens, so a slow open cannot move the pause into the past.
  await page.clock.pauseAt(new Date(LIVE_NOW.getTime() + 10_000))
  const analytics = await openReport(page, 1440, pageAt({ period: 'now' }))
  await settled(count, double)
  const before = await shown(page)
  expect(before.figures).toHaveLength(3)

  // Every change of the page from here on: the fewest summary cells and the most failed tiles.
  await page.evaluate(() => {
    const look = () => ({
      cells: document.querySelectorAll('.spending-tiles .tile-figure').length,
      failed: document.querySelectorAll('.analytics-rail .rail-tile[data-state="failed"]').length,
      alerts: document.querySelectorAll('.platform-state-panel').length,
    })
    const worst = look()
    new MutationObserver(() => {
      const now = look()
      worst.cells = Math.min(worst.cells, now.cells)
      worst.failed = Math.max(worst.failed, now.failed)
      worst.alerts = Math.max(worst.alerts, now.alerts)
    }).observe(document.body, { childList: true, subtree: true, attributes: true })
    Object.assign(globalThis, { worstSeen: worst })
  })

  failing = true
  const ticks: { asked: number; figures: (string | undefined)[]; mark: boolean }[] = []
  for (let tick = 1; tick <= 2; tick += 1) {
    const asked = await count()
    await page.clock.runFor(30_000)
    await settled(count, double)
    const after = await count()
    const seen = await shown(page)
    ticks.push({
      asked: after - asked,
      figures: seen.figures,
      mark: await analytics.locator('.refresh-failed').isVisible(),
    })
  }
  const worst = await page.evaluate(
    () => (globalThis as unknown as { worstSeen: Record<string, number> }).worstSeen,
  )
  for (const seen of ticks) {
    // Each tick asked again by itself, and the figures and the mark stayed.
    expect(seen.asked).toBeGreaterThan(0)
    expect(seen.figures).toEqual(before.figures)
    expect(seen.mark).toBe(true)
  }
  expect(worst).toEqual({ cells: 3, failed: 0, alerts: 0 })

  // The next tick that is answered takes the mark away.
  failing = false
  await page.clock.runFor(30_000)
  await settled(count, double)
  await expect(analytics.locator('.refresh-failed')).toHaveCount(0)
  const answered = await shown(page)
  expect(answered.figures).toEqual(before.figures)
  await record(info, 'live-failing-ticks', { before, ticks, worst })
})

/** The opacity a part is drawn at, multiplied down from its ancestors to the page. */
const opacityOf = (page: Page, selector: string) =>
  page.evaluate((chosen) => {
    const element = document.querySelector(chosen)
    let opacity = 1
    for (let node = element; node; node = node.parentElement)
      opacity *= Number(getComputedStyle(node).opacity)
    return element ? Math.round(opacity * 100) / 100 : null
  }, selector)

test('a new period read for 3 s dims the panel and the tiles until its answer, moving nothing', async ({
  page,
}, info) => {
  // The page's own clock, to move by hand: what a wait shows depends on how long it has run.
  await page.clock.install({ time: NOW })
  const answer = await serveSwitched(page, WORLD)
  // The page's time stops before it opens, so a slow open cannot move the pause into the past.
  await page.clock.pauseAt(new Date(NOW.getTime() + 10_000))
  const analytics = await openReport(page, 1440, pageAt())
  await expect(analytics.locator('.analytics-rail .rail-tile[data-state="loading"]')).toHaveCount(0)
  const panel = analytics.locator('.overview-panel')
  const tile = '.analytics-rail [data-section="model"] .rail-tile'
  const week = { shown: await shown(page), frame: await frame(page) }

  // A refresh of the same week held for three seconds: nothing dims.
  let release = answer.hold()
  await analytics.locator('.analytics-refresh').click()
  await expect(analytics.locator('.analytics-rail [aria-busy="true"]').first()).toBeAttached()
  await page.clock.runFor(3000)
  await expect(panel).not.toHaveClass(/read-pending/u)
  const refreshing = {
    panel: await opacityOf(page, '.overview-panel'),
    tile: await opacityOf(page, tile),
  }
  expect(refreshing).toEqual({ panel: 1, tile: 1 })
  release()
  await expect(analytics.locator('.analytics-rail [aria-busy="true"]')).toHaveCount(0)

  // Four weeks held for three seconds: the chosen period is marked at once, and the week's
  // figures stay drawn, dimmed, with no wait mark and nothing moved, all three seconds.
  release = answer.hold()
  const weeks4 = analytics.locator('.analytics-period').getByRole('radio', { name: 'Past 4 weeks' })
  await weeks4.click()
  await expect(weeks4).toHaveAttribute('aria-checked', 'true')
  await page.clock.runFor(1000)
  await expect.poll(() => opacityOf(page, '.overview-panel')).toBeLessThan(1)
  await expect.poll(() => opacityOf(page, tile)).toBeLessThan(1)
  const pending = {
    panel: await opacityOf(page, '.overview-panel'),
    tile: await opacityOf(page, tile),
    overviewTile: await opacityOf(page, '.analytics-rail [data-section="overview"] .rail-tile'),
    shown: await shown(page),
    frame: await frame(page),
    waits: await analytics.locator('.platform-state-panel, .work-dots').count(),
  }
  expect(pending.overviewTile).toBeLessThan(1)
  expect(pending.shown).toEqual(week.shown)
  expect(pending.frame).toEqual(week.frame)
  expect(pending.waits).toBe(0)
  await page.clock.runFor(2000)
  await expect(panel).toHaveClass(/read-pending/u)
  expect(await opacityOf(page, tile)).toBeLessThan(1)

  // The answer: drawn plainly, its own figures, in the same places.
  release()
  await expect(analytics.locator('.analytics-rail [aria-busy="true"]')).toHaveCount(0)
  await page.clock.runFor(500)
  await expect.poll(() => opacityOf(page, '.overview-panel')).toBe(1)
  await expect.poll(() => opacityOf(page, tile)).toBe(1)
  const answered = await shown(page)
  expect(answered.figures).not.toEqual(week.shown.figures)
  expect(await frame(page)).toEqual(week.frame)
  await record(info, 'read-pending', { refreshing, pending, answered: answered.figures })
})

/** Where the quota panel's heading, its accounts and its windows stand, and what each window says. */
const quotaShown = (page: Page) =>
  page.evaluate(() => {
    const scrolled = document.querySelector('.analytics-panel')?.scrollTop ?? 0
    const parts = '.quota-panel h2, .quota-account, .quota-window'
    return {
      boxes: [...document.querySelectorAll<HTMLElement>(parts)].map((part) => {
        const { x, y, width, height } = part.getBoundingClientRect()
        return [x, y + scrolled, width, height].map((number) => Math.round(number * 100) / 100)
      }),
      facts: [...document.querySelectorAll('.quota-window-facts')].map((facts) =>
        facts.textContent?.replaceAll(/\s+/gu, ' ').trim(),
      ),
    }
  })

/** The week's panel, chosen on the rail where the rail and the panel take turns. */
async function openQuotaWeek(page: Page) {
  const entry = page.locator('.analytics-rail-entry[data-section="quota_week"]')
  await page.locator('.analytics-rail:visible, .quota-panel:visible').first().waitFor()
  if (!(await page.locator('.quota-panel').isVisible())) await entry.click()
  await expect(page.locator('.quota-panel')).toBeVisible()
}

for (const [width, locale] of [
  [1024, 'en'],
  [1280, 'en'],
  [1280, 'ru'],
  [1440, 'en'],
] as const)
  test(`a quota read again that fails keeps its figures and says so in the bar, moving nothing, at ${width}px in ${locale}`, async ({
    page,
  }, info) => {
    await page.addInitScript((lang) => localStorage.setItem('valkama-locale', lang), locale)
    await serve(page)
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(pageAt({ by: 'quota_week' }))
    const analytics = page.locator('.analytics-page')
    await openQuotaWeek(page)
    await expect(analytics.locator('.quota-account')).toHaveCount(4)
    await expect(analytics.locator('.window-spend[data-state="loading"]')).toHaveCount(0)
    await page.evaluate(() => document.fonts.ready)
    const before = { shown: await quotaShown(page), frame: await frame(page) }

    // The quota alone fails its read again; the bar's refresh asks for it.
    await serveQuota(page, 'failed')
    const answered = page.waitForResponse('**/api/analytics/quota?*')
    await analytics.locator('.analytics-refresh').click()
    await answered
    const failed = analytics.locator('.refresh-failed')
    await expect.soft(failed).toBeVisible()
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const after = { shown: await quotaShown(page), frame: await frame(page) }
    await record(info, `quota-read-failed-${width}-${locale}`, { before, after })
    expect.soft(after.shown.facts, 'the figures stay').toEqual(before.shown.facts)
    expect.soft(after.shown.boxes, 'nothing in the panel moves').toEqual(before.shown.boxes)
    expect.soft(after.frame, 'the bar, the rail and the panel stay').toEqual(before.frame)
    await expect.soft(analytics.locator('.platform-state-banner')).toHaveCount(0)

    // Its retry asks again; answered, the mark goes and nothing moves back.
    await serveQuota(page, quotaAt(NOW))
    await failed.getByRole('button').click()
    await expect(failed).toHaveCount(0)
    const retried = await quotaShown(page)
    expect(retried.boxes).toEqual(before.shown.boxes)
  })
