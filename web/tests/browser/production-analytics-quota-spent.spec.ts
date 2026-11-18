/**
 * What used each quota window, in the real app, at the widths it is used at — beside the rail at
 * 1440 pixels, in place of the list at 1024 and 390 — in the light and the dark theme.
 *
 * Under each window of an account that has one stands «Where the window went», which opens the
 * side panel on that window of that account: what the account's work in the window went to,
 * ranked, under a heading that names its period. The quota's own bar and readings carry no
 * dollar, and the spend no quota share. Its parts start at the panel's one edge, nothing in it is
 * cut without a sign, and nothing moves while the pointer passes over it. No work, work with no
 * account known, a wait and a failed read each say so in the panel. Each run prints what it
 * measured and keeps a picture of the panel.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { SEATED_NAME } from '../fixtures/quota.ts'
import { isSpendRead, SPENT_WORLD } from '../fixtures/quotaSpent.ts'
import { openPanel, pageAt, record, serve, shortfalls } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

const FIVE_HOURS = pageAt({ by: 'quota_five_hour' })

const accountNamed = (page: Page, name: string) =>
  page.locator('.quota-account').filter({
    has: page.locator('.quota-account-name', { hasText: new RegExp(`^${name}$`, 'u') }),
  })

/** The side panel of the five hours of the account named `name`, once it is open. */
const panelOf = (page: Page, name: string) =>
  page.getByRole('dialog', { name: `Details: Five hours · ${name}` })

/** The spend in that panel. */
const spendOf = (page: Page, name: string) =>
  panelOf(page, name).locator('[data-detail="window"] .window-spend')

/** Opens the five hours' panel, from the list of sections where a narrow window shows it first. */
async function openFiveHours(page: Page) {
  await openPanel(page, FIVE_HOURS)
  await expect(page.locator('.quota-panel')).toBeVisible()
  await expect(page.locator('.quota-account')).toHaveCount(4)
}

/**
 * Opens what used the five hours of the account named `name` from the window's own button, and
 * waits for its answer.
 */
async function openSpend(page: Page, name: string) {
  await accountNamed(page, name)
    .locator('.quota-window[data-window="five_hour"]')
    .getByRole('button', { name: 'Where the window went' })
    .click()
  const spend = spendOf(page, name)
  await expect(panelOf(page, name)).toHaveCSS('transform', 'none')
  await expect(spend).toBeVisible()
  await expect(spend).not.toHaveAttribute('data-state', 'loading')
  await page.evaluate(() => document.fonts.ready)
  return spend
}

/** Closes the open panel, which gives the section back. */
async function closeSpend(page: Page, name: string) {
  await page.keyboard.press('Escape')
  await expect(panelOf(page, name)).toBeHidden()
}

/** Where each part of the open spend starts, from the spend's own left edge. */
const strays = (page: Page) =>
  page.evaluate(() => {
    const block = document.querySelector('[role="dialog"] .window-spend')
    if (!block) return null
    const edge = block.getBoundingClientRect().left
    return [...block.querySelectorAll('.window-spend > *')]
      .map((part) => part.getBoundingClientRect().left - edge)
      .filter((off) => Math.abs(off) > 1)
  })

/** Where every part of the open spend stands, to the fraction of a pixel. */
const boxes = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector('[role="dialog"] [data-overlay-scroller]')
    const scrolled = scroller?.scrollTop ?? 0
    const parts = '[role="dialog"] .window-spend, [role="dialog"] .window-spend *'
    return [...document.querySelectorAll<HTMLElement>(parts)].map((part) => {
      const { x, y, width, height } = part.getBoundingClientRect()
      return { part: part.className, x, y: y + scrolled, width, height }
    })
  })

for (const colorScheme of ['light', 'dark'] as const)
  for (const width of [1440, 1024, 390])
    test(`at ${width}px in the ${colorScheme} theme each window opens where it went, apart from its share, cutting nothing`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ colorScheme })
      await serve(page, SPENT_WORLD)
      await page.setViewportSize({ width, height: 1000 })
      await openFiveHours(page)
      await page.evaluate(() => document.fonts.ready)

      // The quota's own bar, facts and readings carry no dollar, while they stand on the page.
      const quotaParts = page.locator(
        '.window-bar, .quota-window-facts, .quota-window-readings, .quota-account-table',
      )
      expect(await quotaParts.count()).toBeGreaterThan(0)
      const shares = await quotaParts.allTextContents()
      expect(shares.join(' '), 'figures read on the page').toContain('%')
      expect(shares.join(' '), 'no dollar among the shares').not.toContain('$')
      await expect(page.getByRole('button', { name: 'Where the window went' })).toHaveCount(3)

      const work = await openSpend(page, 'Work')
      // The panel's own switch, chosen by its width.
      const shown = await panelOf(page, 'Work')
        .getByRole('radiogroup')
        .first()
        .getByRole('radio', { checked: true })
        .textContent()

      // The spend's heading names its period; what it is and leaves out is the panel's «ⓘ».
      await expect(work.locator('h3')).toHaveText('Where the window went from 11:30 to 14:30')
      await expect(work).not.toContainText('quota points')
      await expect(work).toHaveAttribute('data-state', 'spent')
      // The first line of its chart, or of its table where the panel shows tables.
      const firstLine = work.locator('.ranked-row, tbody tr').first()
      await expect(firstLine).toContainText('MAIN-1 Answer a review')
      await expect(firstLine).toContainText('$6.00 · 46%')
      await expect(work.locator('[data-note="unplaced"]')).toContainText('$2.00')
      expect(await work.textContent(), 'no quota share in the spend').not.toMatch(
        /used|steady use/iu,
      )
      const where = await strays(page)
      expect(where, "every part at the spend's edge").toEqual([])

      // Nothing cut without a sign: no box clips its words, and no figure or label lacks room.
      await expectNoSilentClipping(page, `what used the window at ${width}px`, '[role="dialog"]')
      const measured = await shortfalls(
        page,
        '.window-spend .ranked-value, .window-spend-title, .window-spend [role="radio"], .window-spend .chart-cell',
      )
      expect(measured.length).toBeGreaterThan(0)
      expect(
        measured.filter((one) => one.short > 0.5),
        'every figure and label of the spend whole',
      ).toEqual([])

      // The pointer over the spend's lines and its breakdowns moves nothing.
      const still = await boxes(page)
      const targets = await work.locator('.ranked-line, tbody tr, [role="radio"]').all()
      expect(targets.length).toBeGreaterThan(0)
      for (const target of targets) {
        await target.hover()
        expect(await boxes(page), 'pointed at the spend').toEqual(still)
      }
      await panelOf(page, 'Work').screenshot(shot(info, `quota-spent-${width}-${colorScheme}.png`))

      // By project, the choice standing in that window alone.
      await work.getByRole('radio', { name: 'Projects' }).click()
      await expect(work.getByRole('radio', { name: 'Projects' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      await expect(work).toContainText('Atlas')
      await expect(work).toContainText('$9.00 · 69%')
      await closeSpend(page, 'Work')

      // No work, and work only its organization recorded with no account known, said apart, each
      // still by task; one with nothing to draw offers no drawing to draw it in.
      const none = await openSpend(page, '7e6d5c4b')
      await expect(none).toHaveAttribute('data-state', 'none')
      await expect(none).toContainText('No work was recorded on this account in this window.')
      await expect(none.getByRole('radio', { name: 'Tasks' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      await expect(none.getByRole('radio', { name: 'Ring' })).toHaveCount(0)
      await closeSpend(page, '7e6d5c4b')
      const unplaced = await openSpend(page, SEATED_NAME)
      await expect(unplaced).toHaveAttribute('data-state', 'unplaced')
      await expect(unplaced).toContainText('with the account unknown')
      await expect(unplaced.getByRole('radio', { name: 'Tasks' })).toHaveCount(1)
      await expect(unplaced.getByRole('radio', { name: 'Ring' })).toHaveCount(0)
      await closeSpend(page, SEATED_NAME)

      await record(info, `quota spent ${width} ${colorScheme}`, {
        shown,
        parts: still.length,
      })
    })

test('a spend that waits says so in its panel, and one whose read failed retries in place', async ({
  page,
}, info) => {
  await serve(page, SPENT_WORLD)
  // What used the window waits, then fails, while the quota and the page's own reads answer.
  let answer: 'fail' | 'hold' | 'serve' = 'hold'
  await page.route('**/api/analytics/usage?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    if (!isSpendRead(query) || answer === 'serve') {
      await route.fallback()
      return
    }
    if (answer === 'fail')
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(FIVE_HOURS)
  await expect(page.locator('.quota-account')).toHaveCount(4)
  await accountNamed(page, 'Work')
    .locator('.quota-window[data-window="five_hour"]')
    .getByRole('button', { name: 'Where the window went' })
    .click()
  const work = spendOf(page, 'Work')
  await expect(work).toHaveAttribute('data-state', 'loading')
  await expect(work.locator('.window-spend-body')).toHaveText('Loading')
  // The window's own figures stand meanwhile, under the panel.
  await expect(accountNamed(page, 'Work').locator('.quota-window-lead').first()).toHaveText(
    '62% used · fresh',
  )
  await panelOf(page, 'Work').screenshot(shot(info, 'quota-spent-waiting.png'))

  // A reload opens the panel again from the address, and its read fails there.
  answer = 'fail'
  await page.reload()
  await expect(page.locator('.quota-account')).toHaveCount(4)
  await expect(work).toHaveAttribute('data-state', 'failed')
  await expect(work.locator('.window-spend-failed')).toContainText(
    'What used this window could not be read.',
  )
  await expect(page.locator('.quota-panel')).toContainText('Work')
  await expect(page.locator('.quota-panel')).not.toContainText('The quota could not be read.')
  await panelOf(page, 'Work').screenshot(shot(info, 'quota-spent-failed.png'))

  answer = 'serve'
  await work.getByRole('button', { name: 'Retry' }).click()
  await expect(work).toHaveAttribute('data-state', 'spent')
  await expect(work).toContainText('MAIN-1 Answer a review')
})
