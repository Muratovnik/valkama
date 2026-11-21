/**
 * The Analytics periods on a phone, a row that scrolls sideways in a `ChoiceStrip`. The oracle is
 * `DESIGN.md`: the one gradient is a mask that fades the end of a strip that scrolls on past it
 * (the shell), and a row that scrolls fades the end a choice is cut at and keeps the chosen one,
 * and the one the keyboard reaches, clear of that fade (Segmented choice). Walked by the keyboard
 * through every period, the strip fades at each end a period is cut at and at no other, and the
 * chosen period's words stand clear of the fade; a press on a period cut at the end brings it
 * clear too. Wide, the periods fit and the strip draws no mask. The periods had a strip of their
 * own that faded nothing and kept the chosen by the browser's nearest edge, so a phone's row began
 * at a sliver of the first period and ended at one of the fourth.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { messages } from '@/shared/i18n/index.ts'

import { openReport, pageAt, serve } from './analyticsPage.ts'
import { expectFadeOnCut, fadedEnds, overrun, still, wordsUnderFade } from './cardTabsRow.ts'
import { test } from './test.ts'

const said = messages.en.analytics

/** The strip the periods scroll in: the one that holds the bar's group of periods. */
const periodStrip = (page: Page) =>
  page
    .locator('[data-choice-strip]')
    .filter({ has: page.getByRole('radiogroup', { name: said.period.label, exact: true }) })

/** The periods the bar offers, in its order (`PERIODS`). */
const PERIODS = ['now', 'today', 'week', 'weeks4', 'custom'] as const

test('at 390px every period the keyboard reaches is chosen clear of the fade, which falls on the cut ends alone', async ({
  page,
}) => {
  await serve(page)
  await openReport(page, 390, pageAt())
  const strip = periodStrip(page)
  await expect(strip).toHaveCount(1)
  expect(await overrun(strip), 'the periods scroll on a phone').toBeGreaterThan(0)
  const periods = strip.getByRole('radio')
  await expect(periods).toHaveCount(PERIODS.length)
  await expect(periods.nth(2), 'the week chosen at first').toBeChecked()

  // Home reaches the first period, and each ArrowRight the next.
  await periods.nth(2).focus()
  for (const [index, period] of PERIODS.entries()) {
    await page.keyboard.press(index === 0 ? 'Home' : 'ArrowRight')
    const chosen = periods.nth(index)
    await expect(chosen, `${period} chosen`).toBeChecked()
    await expect(chosen, `${period} focused`).toBeFocused()
    await still(strip)
    // A strip wider than its room cuts a period at one end at least, wherever it is scrolled.
    const { start, end } = await fadedEnds(strip)
    expect(start || end, `${period}: an end fades`).toBe(true)
    await expectFadeOnCut(strip, period)
    expect(await wordsUnderFade(strip, chosen), `${period}: its words`).toEqual([])
  }
})

test('at 390px a press on a period the fade cuts chooses it and brings it clear', async ({
  page,
}) => {
  await serve(page)
  await openReport(page, 390, pageAt())
  const strip = periodStrip(page)
  const periods = strip.getByRole('radio')
  await expect(periods).toHaveCount(PERIODS.length)
  // The last period scrolled to stand its first words just inside the strip's end, the rest past
  // it, and pressed where its words show.
  const last = PERIODS.length - 1
  const cut = await strip.evaluate((node, at) => {
    const radio = node.querySelectorAll('[role="radio"]')[at]
    const range = document.createRange()
    if (radio) range.selectNodeContents(radio)
    const row = node.getBoundingClientRect()
    node.scrollLeft += range.getBoundingClientRect().left - (row.right - 20)
    const box = range.getBoundingClientRect()
    return { at, x: row.right - 12, y: (box.top + box.bottom) / 2, left: box.left - row.right }
  }, last)
  expect(cut.left, 'the period starts inside the end').toBeLessThan(0)
  const pressed = periods.nth(cut.at)
  expect(await wordsUnderFade(strip, pressed), 'the period cut at first').toContain('out after')
  await page.mouse.click(cut.x, cut.y)
  await expect(pressed).toBeChecked()
  await still(strip)
  await expectFadeOnCut(strip, 'after the press')
  expect(await wordsUnderFade(strip, pressed), 'the period pressed').toEqual([])
})

for (const width of [1024, 1440])
  test(`at ${width}px the periods fit and their strip draws no mask`, async ({ page }) => {
    await serve(page)
    await openReport(page, width, pageAt())
    const strip = periodStrip(page)
    await expect(strip).toHaveCount(1)
    await expect(strip.getByRole('radio')).toHaveCount(PERIODS.length)
    expect(await overrun(strip), 'the strip scrolls').toBe(0)
    expect(await fadedEnds(strip)).toMatchObject({ mask: 'none', start: false, end: false })
  })
