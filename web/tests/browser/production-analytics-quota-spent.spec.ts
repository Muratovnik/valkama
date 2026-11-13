/**
 * What used each quota window, in the real app, at the widths it is used at — beside the rail at
 * 1440 pixels, in place of the list at 1024 and 390 — in the light and the dark theme.
 *
 * Under each window of an account that has one, its block says it is the API price estimate and
 * not quota points, over which period, and that claude.ai and the desktop app are not in it, and
 * ranks what the account's work in the window went to. The block stands under the window's bar
 * and readings, on no axis of theirs: no dollar is drawn among the quota's shares, and no quota
 * share in the block. Its parts start at the account's edge, nothing in it is cut without a sign,
 * and nothing moves while the pointer passes over it. No work, work with no account known, a wait
 * and a failed read each say so in their block. Each run prints what it measured and keeps a
 * picture of the panel.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { isSpendRead, SPENT_WORLD } from '../fixtures/quotaSpent.ts'
import { pageAt, record, serve, shortfalls } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

const FIVE_HOURS = pageAt({ by: 'quota_five_hour' })

const accountNamed = (page: Page, name: string) =>
  page.locator('.quota-account').filter({
    has: page.locator('.quota-account-name', { hasText: new RegExp(`^${name}$`, 'u') }),
  })
const blockOf = (page: Page, name: string) =>
  accountNamed(page, name).locator('.quota-window[data-window="five_hour"] .window-spend')

/**
 * Opens the five hours' panel: where the window is too narrow for the rail beside it, the address
 * opens the list of sections, and the section is chosen there, as a reader would.
 */
async function openFiveHours(page: Page) {
  await page.goto(FIVE_HOURS)
  const panel = page.locator('.quota-panel')
  await page.locator('.analytics-rail:visible, .analytics-panel:visible').first().waitFor()
  if (!(await panel.isVisible()))
    await page.locator('.analytics-rail [data-section="quota_five_hour"]').click()
  await expect(panel).toBeVisible()
}

/** Settled: the panel has its accounts and every block has its answer or its failure. */
async function settled(page: Page, blocks = 3) {
  await expect(page.locator('.quota-account')).toHaveCount(4)
  await expect(page.locator('.window-spend')).toHaveCount(blocks)
  await expect(page.locator('.window-spend[data-state="loading"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
}

/**
 * Where each block stands against its window and its account: its left edge and its parts' left
 * edges from the account's name, and its top from the bottom of the window's bar and readings.
 */
const placed = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.window-spend')].map((block) => {
      const account = block.closest('.quota-account')
      const window = block.closest('.quota-window')
      const edge = account?.querySelector('.quota-account-name')?.getBoundingClientRect().left ?? 0
      const box = block.getBoundingClientRect()
      const owner = account instanceof HTMLElement ? account.dataset.account : undefined
      const quota = [...(window?.querySelectorAll('.window-bar, .quota-window-readings') ?? [])]
      const above = Math.max(...quota.map((part) => part.getBoundingClientRect().bottom))
      const parts = [block, ...block.querySelectorAll('.window-spend > *')]
      return {
        account: owner,
        strays: parts
          .map((part) => part.getBoundingClientRect().left - edge)
          .filter((off) => Math.abs(off) > 1),
        gap: Math.round((box.top - above) * 100) / 100,
      }
    }),
  )

/** Where every part of the panel stands, to the fraction of a pixel. */
const boxes = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector('.analytics-panel')?.scrollTop ?? 0
    const parts = '.quota-account, .quota-window, .window-spend, .window-spend *'
    return [...document.querySelectorAll<HTMLElement>(parts)].map((part) => {
      const { x, y, width, height } = part.getBoundingClientRect()
      return { part: part.className, x, y: y + panel, width, height }
    })
  })

for (const colorScheme of ['light', 'dark'] as const)
  for (const width of [1440, 1024, 390])
    test(`at ${width}px in the ${colorScheme} theme each window says where it went, apart from its share, cutting nothing`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ colorScheme })
      await serve(page, SPENT_WORLD)
      await page.setViewportSize({ width, height: 1000 })
      await openFiveHours(page)
      await settled(page)
      const work = blockOf(page, 'Work')
      const shown =
        (await page.locator('.quota-panel .chart-section').getAttribute('data-shown')) ?? ''

      // The block's label, its period and what it leaves out.
      await expect(work.locator('h5')).toHaveText('Where the window went')
      await expect(work.locator('.window-spend-basis')).toHaveText(
        'By API price estimate, not quota points: the work Valkama recorded on this account from 11:30 to 14:30, without the work in claude.ai and the desktop app.',
      )
      await expect(work).toHaveAttribute('data-state', 'spent')
      // The first line of its chart, or of its table where the panel shows tables.
      const firstLine = work.locator('.ranked-row, tbody tr').first()
      await expect(firstLine).toContainText('MAIN-1 Answer a review')
      await expect(firstLine).toContainText('$6.00 · 46%')
      await expect(work.locator('[data-note="unplaced"]')).toContainText('$2.00')
      // No work, and work only its organization recorded with no account known, said apart.
      await expect(blockOf(page, '7e6d5c4b')).toHaveAttribute('data-state', 'none')
      await expect(blockOf(page, '7e6d5c4b')).toContainText(
        'No work was recorded on this account in this window.',
      )
      await expect(blockOf(page, 'a1b2c3d4')).toHaveAttribute('data-state', 'unplaced')
      await expect(blockOf(page, 'a1b2c3d4')).toContainText('with the account unknown')

      // No dollar among the quota's shares, no quota share in a block, and each block under its
      // window's bar and readings, not beside them.
      const shares = await page
        .locator(
          '.window-bar, .quota-window-facts, .quota-window-readings, .quota-account > .chart-table-frame',
        )
        .allTextContents()
      expect(shares.join(' '), 'no dollar among the shares').not.toContain('$')
      const blocks = await page.locator('.window-spend').allTextContents()
      expect(blocks.join(' '), 'no quota share in a block').not.toMatch(/used|steady use/iu)
      const where = await placed(page)
      for (const one of where) {
        expect(one.strays, `${one.account}: every part at its account's edge`).toEqual([])
        expect(
          one.gap,
          `${one.account}: under its window's bar and readings`,
        ).toBeGreaterThanOrEqual(0)
      }

      // Nothing cut without a sign: no box clips its words, and no figure or label lacks room.
      await expectNoSilentClipping(page, `what used the windows at ${width}px`, '.quota-panel')
      const measured = await shortfalls(
        page,
        '.window-spend .ranked-value, .window-spend-title, .window-spend [role="radio"], .window-spend .chart-cell',
      )
      expect(measured.length).toBeGreaterThan(0)
      expect(
        measured.filter((one) => one.short > 0.5),
        'every figure and label of a block whole',
      ).toEqual([])

      // The pointer over a block's lines and its breakdowns moves nothing.
      await work.scrollIntoViewIfNeeded()
      const still = await boxes(page)
      for (const target of await work.locator('.ranked-line, tbody tr, [role="radio"]').all()) {
        await target.hover()
        expect(await boxes(page), 'pointed at a block').toEqual(still)
      }
      await page
        .locator('.analytics-panel')
        .screenshot(shot(info, `quota-spent-${width}-${colorScheme}.png`))

      // By project, the choice standing in that block alone.
      await work.getByRole('radio', { name: 'Projects' }).click()
      await expect(work.getByRole('radio', { name: 'Projects' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      await expect(work).toContainText('Atlas')
      await expect(work).toContainText('$9.00 · 69%')
      await expect(blockOf(page, '7e6d5c4b').getByRole('radio', { name: 'Tasks' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      await record(info, `quota spent ${width} ${colorScheme}`, {
        shown,
        where,
        parts: still.length,
      })
    })

test('a block that waits says so once the wait has lasted, and one whose read failed retries in place', async ({
  page,
}, info) => {
  await serve(page, SPENT_WORLD)
  // What used the windows waits, then fails, while the quota and the page's own reads answer.
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
  const work = blockOf(page, 'Work')
  await expect(work).toHaveAttribute('data-state', 'loading')
  await expect(work.locator('.window-spend-body')).toHaveText('Loading')
  // The window's own figures stand meanwhile.
  await expect(accountNamed(page, 'Work').locator('.window-value').first()).toHaveText('62% used')
  await page.locator('.analytics-panel').screenshot(shot(info, 'quota-spent-waiting.png'))

  answer = 'fail'
  await page.reload()
  await expect(page.locator('.quota-account')).toHaveCount(4)
  await expect(work).toHaveAttribute('data-state', 'failed')
  await expect(work.locator('.window-spend-failed')).toContainText(
    'What used this window could not be read.',
  )
  await expect(page.locator('.quota-panel')).not.toContainText('The quota could not be read.')
  await page.locator('.analytics-panel').screenshot(shot(info, 'quota-spent-failed.png'))

  answer = 'serve'
  await work.getByRole('button', { name: 'Retry' }).click()
  await expect(work).toHaveAttribute('data-state', 'spent')
  await expect(work).toContainText('MAIN-1 Answer a review')
})
