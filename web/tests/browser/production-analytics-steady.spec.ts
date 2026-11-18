/**
 * Nothing on the Analytics page moves under the pointer. Pointing at a day of the day chart
 * shows its hint over the page, and pointing at a bar lights the bar; neither may change the size
 * or the place of the chart, of any section of the page or of the page's height, before, while or
 * after the pointer stands there.
 *
 * The days say themselves at very different lengths — one short task, a day of six tasks with
 * long titles, a day of two — which is what once made a line of words over the plot take one line
 * on one day and three on the next and push everything under it. Accounts change from day to day,
 * so their lines up the plot are there too, and the breakdown has work on no task and unknown work
 * after every task, and its small charts a chart of «other».
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openReport, record, serve } from './analyticsPage.ts'
import { drawAllLined } from './drawnViews.ts'
import { expectNoLineOverPlot } from './plotWords.ts'
import { STEADY } from './served/analyticsSteady.ts'
import { test } from './test.ts'

const WIDTHS = [1440, 1024]

/**
 * Where the parts of the page stand, against the document rather than the window so a scroll
 * would not read as a move: the day chart and its parts, every section of the page, the page
 * itself and how tall the document is.
 */
const layout = (page: Page) =>
  page.evaluate(() => {
    const parts = [
      '.analytics-page',
      '.spending-tiles',
      '.chart-section',
      '.spending-table',
      '.period-columns',
      '.period-field',
      '.period-frame',
      '.ranked-bars',
    ]
    // This body runs in the page, so a helper at the module's own scope would not be there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const at = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return [x + window.scrollX, y + window.scrollY, width, height].map(
        (number) => Math.round(number * 100) / 100,
      )
    }
    return {
      height: document.documentElement.scrollHeight,
      boxes: Object.fromEntries(
        parts.flatMap((selector) =>
          [...document.querySelectorAll(selector)].map((element, index) => [
            `${selector}#${index}`,
            at(element),
          ]),
        ),
      ),
    }
  })

type Layout = Awaited<ReturnType<typeof layout>>

/** What stands elsewhere or another size in `now` than in `before`, or how the page grew. */
function moves(name: string, before: Layout, now: Layout): string[] {
  const height =
    now.height === before.height ? [] : [`${name}: height ${before.height} → ${now.height}`]
  const boxes = Object.entries(before.boxes)
    .filter(([part, box]) => JSON.stringify(now.boxes[part]) !== JSON.stringify(box))
    .map(
      ([part, box]) =>
        `${name}: ${part} ${JSON.stringify(box)} → ${JSON.stringify(now.boxes[part])}`,
    )
  return [...height, ...boxes]
}

for (const width of WIDTHS)
  test(`nothing moves as the pointer passes the days and the bars at ${width}px`, async ({
    page,
  }, info) => {
    await serve(page, STEADY)
    const analytics = await openReport(page, width)
    // Tall enough that nothing scrolls: a move is a move, not the window following the pointer.
    await page.setViewportSize({ width, height: 3200 })
    // Each section drawn as its chart, whichever the width of the panel opened it as.
    await drawAllLined(analytics)
    const columns = page.locator('.spending-days .period-column')
    const bars = page.locator('.spending-bars .ranked-line')
    await expect(columns).toHaveCount(3)
    await expect(page.locator('.spending-days [data-mark="change"]')).not.toHaveCount(0)
    // Work on no task, unknown work and the rest close the list of tasks, a list of names of free
    // text, unranked under it, each with its bar (`RankedBars`): none stands among the ranked.
    const apart = '[data-kind]:not([data-kind="category"])'
    await expect(page.locator(`.spending-bars ol ${apart}`)).toHaveCount(0)
    await expect(page.locator(`.spending-bars ul ${apart}`)).toHaveCount(3)
    await expect(
      page.locator(
        '.spending-bars .ranked-row:is([data-kind="none"], [data-kind="unknown"]) .ranked-bar',
      ),
    ).toHaveCount(2)

    // No line of words stands over the plot: each day says itself in its hint.
    await expectNoLineOverPlot(page, '.spending-days [data-chart="periods"]')
    await page.mouse.move(0, 0)
    const before = await layout(page)
    const hints: string[] = []
    const moved: string[] = []
    const hint = page.getByRole('tooltip')

    const hold = async (name: string) => {
      moved.push(...moves(name, before, await layout(page)))
    }

    // A day is pointed at over its stack, where no segment of it stands.
    for (let index = 0; index < 3; index += 1) {
      await page.mouse.move(0, 0)
      await expect(hint).toBeHidden()
      await columns.nth(index).hover({ position: { x: 2, y: 2 } })
      await expect(hint).toBeVisible()
      hints.push((await hint.textContent()) ?? '')
      await hold(`day ${index + 1}`)
    }
    const barCount = await bars.count()
    for (let index = 0; index < barCount; index += 1) {
      await bars.nth(index).hover()
      await hold(`bar ${index + 1}`)
    }
    // The longest day is whole in its hint, a line for each of its facts, none of it cut.
    const lengths = hints.map((text) => text.trim().length)
    await columns.nth(lengths.indexOf(Math.max(...lengths))).hover({ position: { x: 2, y: 2 } })
    await expect(hint).toBeVisible()
    expect(((await hint.textContent()) ?? '').split('\n').length).toBeGreaterThan(2)
    // The box the reader sees, which holds the text the hint names itself by.
    const shown = page.locator('.tooltip-hint')
    expect(
      await shown.evaluate(
        (element) =>
          element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
      ),
      'the longest hint cut',
    ).toBe(false)
    await hold('longest')
    await page.mouse.move(0, 0)
    await hold('after')

    await record(info, `steady-${width}`, { lengths, bars: barCount, moved })
    // The fixture does what it is for: the days read out at very different lengths.
    expect(Math.max(...lengths)).toBeGreaterThan(4 * Math.min(...lengths))
    expect(moved, 'parts that moved under the pointer').toEqual([])
  })
