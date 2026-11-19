/**
 * The subscription quota on the Analytics page in the real app, at the widths it is used at —
 * beside the rail at 1440 pixels, in place of the list at 1024 and 390 — in the light and the
 * dark theme.
 *
 * Its two tiles stand after the token kinds and before the dimensions. A tile chosen opens its
 * panel, and the choice is in the address, so a reload opens the same panel. The panel has a group
 * per account, its windows side by side where the width allows, and for each window its lead, its
 * bar, its facts and the step line of its readings, each on its window's edge; nothing
 * in it or on the tiles is cut without a sign, nothing moves while the pointer passes over the
 * tiles, the bars and the readings, and no money stands beside a share. Each run prints what it
 * measured and keeps a picture of the panel.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { NIGHT_NAME } from '../fixtures/quota.ts'
import { pageAt, record, serve } from './analyticsPage.ts'
import { routeState, shot } from './boardPage.ts'
import { drawLined } from './drawnViews.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

/** Where every part of the panel and of the rail stands, to the fraction of a pixel. */
const boxes = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector('.analytics-panel')?.scrollTop ?? 0
    const rail = document.querySelector('.analytics-page-rail')?.scrollTop ?? 0
    const parts = '.analytics-rail-entry, .quota-account, .quota-window, .window-bar, .step-line'
    return [...document.querySelectorAll<HTMLElement>(parts)].map((part) => {
      const { x, y, width, height } = part.getBoundingClientRect()
      const scrolled = part.closest('.analytics-page-rail') ? rail : panel
      return { part: part.className, x, y: y + scrolled, width, height }
    })
  })

/**
 * The parts of the panel whose left edge strays more than a pixel from where it stands: the parts
 * of a window, and the lines of what stands now in it, on the window's edge, and the windows that start a row, and what is not a window, on
 * their account's name. Windows side by side start each where the one before ends.
 */
const edges = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.quota-account')].flatMap((account) => {
      const name = account.querySelector('.quota-account-name') ?? account
      const edge = name.getBoundingClientRect().left
      const stray = (parts: Element[], at: number) =>
        parts
          .map((part) => ({ part: part.className, left: part.getBoundingClientRect().left }))
          .filter((part) => Math.abs(part.left - at) > 1)
      const windows = [...account.querySelectorAll('.quota-window')].map((window) => ({
        window,
        left: window.getBoundingClientRect().left,
      }))
      const first = Math.min(...windows.map((one) => one.left))
      return [
        ...stray([...account.querySelectorAll('.quota-account-none, .quota-account-others')], edge),
        ...stray(
          windows.filter((one) => Math.abs(one.left - first) <= 1).map((one) => one.window),
          edge,
        ),
        ...windows.flatMap((one) =>
          stray(
            [
              ...one.window.querySelectorAll(
                ':scope > .level-head, .quota-window-parts > *, .quota-window-summary > *',
              ),
            ],
            one.left,
          ),
        ),
      ]
    }),
  )

const entry = (page: Page, section: string) =>
  page.locator(`.analytics-rail-entry[data-section="${section}"]`)

/** Chooses a section on the rail, from its list where the list and a section take turns. */
async function choose(page: Page, section: string) {
  const back = page.locator('.analytics-panel-back')
  if (await back.isVisible()) await back.click()
  await entry(page, section).click()
  await expect(page.locator('.quota-panel')).toBeVisible()
}

/** Settled: no tile still waits, and the quota panel has its accounts. */
async function settled(page: Page) {
  await expect(page.locator('.analytics-rail .rail-tile-lead', { hasText: 'Loading' })).toHaveCount(
    0,
  )
  await expect(page.locator('.quota-account')).toHaveCount(4)
  await page.evaluate(() => document.fonts.ready)
}

for (const colorScheme of ['light', 'dark'] as const)
  for (const width of [1440, 1024, 390])
    test(`at ${width}px in the ${colorScheme} theme the quota tiles open a panel that holds still, cuts nothing and survives a reload`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ colorScheme })
      await serve(page)
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(pageAt())
      await expect(entry(page, 'quota_week').locator('.rail-tile-lead')).toHaveText(NIGHT_NAME)

      // The quota's tiles after the token kinds, before the dimensions.
      const sections = await page
        .locator('.analytics-rail-entry')
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.section))
      expect(sections.slice(0, 5)).toEqual([
        'overview',
        'token_kind',
        'quota_five_hour',
        'quota_week',
        'seat',
      ])
      await expect(entry(page, 'quota_five_hour')).toContainText('a1b2c3d4')
      await expect(entry(page, 'quota_five_hour')).toContainText('74%')
      // The five hours run out before their reset, so the tile says when in place of its state.
      await expect(entry(page, 'quota_five_hour')).toContainText('runs out at 15:10')
      await expect(entry(page, 'quota_week')).toContainText('88%')
      await expect(entry(page, 'quota_week')).toContainText('no data for')
      await expectNoSilentClipping(page, `rail at ${width}px`, '.analytics-rail')
      // The pointer over the quota's tiles moves no tile.
      const rail = await boxes(page)
      for (const section of ['quota_five_hour', 'quota_week']) {
        await entry(page, section).hover()
        expect(await boxes(page), `pointed at the ${section} tile`).toEqual(rail)
      }

      await choose(page, 'quota_five_hour')
      await settled(page)
      await expect(page.locator('.quota-panel h2')).toHaveText('Five hours')
      // What used a window is a block of its own under the readings
      // (`production-analytics-quota-spent.spec.ts`); nothing that says a share names money.
      const shares = await page
        .locator('.quota-account > .level-head, .window-bar, .quota-window-facts, .step-line')
        .allTextContents()
      expect(shares.length).toBeGreaterThan(0)
      expect(shares.join(' '), 'no money beside a share').not.toContain('$')
      // Every part of an account starts at one edge, within a pixel: its name and the windows
      // that start a row, and each window's name, lead, bar, facts and readings at the window's.
      expect(await edges(page), 'every part at its account edge').toEqual([])
      await expectNoSilentClipping(page, `five hours at ${width}px`, '.analytics-panel')
      await page
        .locator('.analytics-panel')
        .screenshot(shot(info, `quota-five-hours-${width}-${colorScheme}.png`))

      // The pointer over every bar, across every step line and over the quota's tiles moves
      // nothing; each reading says itself in its hint, over the page.
      const still = await boxes(page)
      for (const bar of await page.locator('.quota-window .window-track').all()) {
        await bar.hover()
        expect(await boxes(page), 'pointed at a bar').toEqual(still)
      }
      for (const plot of await page.locator('.quota-window .step-plot').all()) {
        await plot.scrollIntoViewIfNeeded()
        const before = await boxes(page)
        for (const across of [0.05, 0.5, 0.95]) {
          const box = await plot.boundingBox()
          await page.mouse.move(
            (box?.x ?? 0) + (box?.width ?? 0) * across,
            (box?.y ?? 0) + (box?.height ?? 0) / 2,
          )
          expect(await boxes(page), 'pointed across the readings').toEqual(before)
        }
      }

      // The choice is in the address: a reload opens the same panel.
      expect(routeState(page).by).toBe('quota_five_hour')
      await page.reload()
      await expect(page.locator('.quota-panel h2')).toHaveText('Five hours')
      await settled(page)

      // The week, its forecasts said as ranges: drawn, after the key of their hatch; as a table,
      // as narrow pages open, in its account's table.
      await choose(page, 'quota_week')
      await settled(page)
      await expect(page.locator('.quota-panel h2')).toHaveText('Week')
      await expect(
        page
          .locator(
            '[data-window="week"] [data-fact="forecast"], [data-key="week"] [data-cell="forecast"]',
          )
          .first(),
      ).toContainText('By the reset: 57% to 61%')
      // «Work» reads two weeks, side by side where the width allows.
      expect(await edges(page), 'every part of the week at its edge').toEqual([])
      await expectNoSilentClipping(page, `week at ${width}px`, '.analytics-panel')
      await page
        .locator('.analytics-panel')
        .screenshot(shot(info, `quota-week-${width}-${colorScheme}.png`))
      await record(info, `quota ${width} ${colorScheme}`, { sections, parts: still.length })
    })

for (const width of [390, 1440])
  test(`at ${width}px every control of a drawn window stands inside the window`, async ({
    page,
  }, info) => {
    // A narrow page opens on the table; drawn, a window's switch of its line's span once ran past
    // its edge. The switch is gone; «Breakdown» and the line of the window before stand there.
    await serve(page)
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(pageAt())
    for (const section of ['quota_five_hour', 'quota_week']) {
      await choose(page, section)
      await settled(page)
      await drawLined(page.locator('.chart-section').first())
      // Each window by its hook (`QuotaWindow`), and each control in it by its role.
      const { controls, past, windows } = await page
        .locator('[data-window]')
        .evaluateAll((found) => {
          const groups = found.map((window) => [
            window,
            [...window.querySelectorAll('button, [role="radiogroup"]')],
          ])
          return {
            windows: found.length,
            controls: groups.reduce((all, [, one]) => all + (one as Element[]).length, 0),
            past: groups.flatMap(([window, one]) => {
              const edge = (window as Element).getBoundingClientRect().right
              return (one as Element[])
                .map((group) => group.getBoundingClientRect().right - edge)
                .filter((beyond) => beyond > 1)
                .map(
                  (beyond) => `${(window as HTMLElement).dataset.window}: ${Math.round(beyond)}px`,
                )
            }),
          }
        })
      expect(windows, `${section}: the windows drawn`).toBeGreaterThan(0)
      expect(controls, `${section}: the controls drawn`).toBeGreaterThan(0)
      expect(past, `${section}: controls past their window`).toEqual([])
      await page
        .locator('.analytics-panel')
        .screenshot(shot(info, `quota-drawn-${section}-${width}.png`))
    }
  })
