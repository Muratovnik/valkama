/**
 * The Analytics bar's buttons that a short bar leaves their icons name themselves, in the built
 * app. Where the bar has no room for words, «Refresh» and «Add a filter» say themselves by their
 * icons and keep their words for a reader, hidden from sight; each one's hint then names it under
 * it, and none of its words are laid over the icon. At a wide window the words stand beside the
 * icons and the buttons show no hint.
 *
 * Before, neither button had a hint at all: a person who did not know the icons had nothing to
 * read them by. The headings of a section's table, which sort it, say their whole name while
 * they cut it; their template wrote that hint without the directive that draws it, and the built
 * app drew none.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { NOW, openReport, serve } from './analyticsPage.ts'
import { test } from './test.ts'

interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

/** The bar's buttons that give their words up, with the words each holds. */
const BUTTONS = [
  { control: '.analytics-refresh', words: '.analytics-refresh-words' },
  { control: '.analytics-filter-add', words: '.analytics-filter-add-words' },
] as const

const boxOf = (locator: Locator): Promise<Box> =>
  locator.evaluate((node) => {
    const { bottom, left, right, top } = node.getBoundingClientRect()
    return { bottom, left, right, top }
  })

/** Whether two boxes share more than the pixel a border meets on. */
const overlaps = (one: Box, other: Box) =>
  Math.min(one.right, other.right) - Math.max(one.left, other.left) > 1 &&
  Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top) > 1

/** Whether `words` are hidden from sight: kept in a box no larger than a pixel. */
const hiddenWords = (words: Locator) =>
  words.evaluate((node) => {
    const { height, width } = node.getBoundingClientRect()
    return width <= 1 && height <= 1
  })

/** Rests the pointer on `on`, from a corner of the window, until a hint would have shown. */
async function rest(page: Page, on: Locator) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  await page.mouse.move(viewport.width - 2, viewport.height - 2)
  await page.clock.runFor(1000)
  await on.hover()
  await page.clock.runFor(1000)
}

async function openAt(page: Page, width: number) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
  // The hint's delay runs on this clock, so a test can say that no hint came after it.
  await page.clock.install({ time: NOW })
  await serve(page)
  await openReport(page, width)
}

test('at 390px, a button the short bar leaves its icon names itself under it', async ({ page }) => {
  await openAt(page, 390)
  for (const { control, words } of BUTTONS) {
    const button = page.locator(control)
    expect(await hiddenWords(button.locator(words)), `${control}: its words hidden`).toBe(true)
    const said = await button.locator(words).textContent()
    await rest(page, button)
    await expect(page.locator('.whole-text'), `${control}: no words laid over it`).toHaveCount(0)
    const hint = page.locator('.tooltip-hint')
    // The hint is its own tooltip and says the button's words once.
    await expect(hint, control).toHaveAttribute('role', 'tooltip')
    await expect(hint, control).toHaveText(said?.trim() ?? '')
    const [own, shown] = await Promise.all([boxOf(button), boxOf(hint)])
    expect(overlaps(own, shown), `${control}: over its own button`).toBe(false)
    expect(shown.top, `${control}: under it`).toBeGreaterThanOrEqual(own.bottom)
  }
})

test('at 1440px, where the words stand beside the icons, the buttons show no hint', async ({
  page,
}) => {
  await openAt(page, 1440)
  for (const { control, words } of BUTTONS) {
    const button = page.locator(control)
    expect(await hiddenWords(button.locator(words)), `${control}: its words shown`).toBe(false)
    await rest(page, button)
    await expect(page.locator('.whole-text'), control).toHaveCount(0)
    await expect(page.locator('.tooltip-hint'), control).toHaveCount(0)
  }
})

test('a table heading that sorts its column says its whole name while it cuts it', async ({
  page,
}) => {
  await openAt(page, 1440)
  const headings = page.locator('.spending-table .table-sort')
  await expect(headings.first()).toBeVisible()
  const named = await headings.evaluateAll((all: HTMLElement[]) =>
    all.map((heading) => ({
      kind: heading.dataset.tooltipKind,
      said: heading.dataset.tooltip,
      text: heading.textContent?.trim() ?? '',
    })),
  )
  expect(named.length).toBeGreaterThan(1)
  for (const { kind, said, text } of named) {
    expect(kind, text).toBe('clipped')
    expect(said, text).toBe(text)
  }
})
