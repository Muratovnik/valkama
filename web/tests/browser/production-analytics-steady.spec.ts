/**
 * Nothing on the Analytics page moves under the pointer. Pointing at a day of the day chart
 * changes the line over it that reads the day out, and pointing at a bar lights the bar; neither
 * may change the size or the place of the chart, of any section of the page or of the page's
 * height, before, while or after the pointer stands there.
 *
 * The days read out at very different lengths — one short task, a day of six tasks with long
 * titles, a day of two — which is what made the readout take one line on one day and three on
 * the next and pushed everything under it. Accounts change from day to day, so the notes under
 * the chart are there too, and the breakdown has work on no task and unknown work after every
 * task, and its small charts a chart of «other».
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { noTask, task, unknownTask, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

const WIDTHS = [1440, 1024]

/** Monday, Tuesday and Wednesday of the week the double's clock stands in. */
const on = (day: number) => new Date(2026, 10, 9 + day, 10)

const FIRST = value('3f9a1b2c-5d6e-4f70-8a9b-0c1d2e3f4a5b')
const SECOND = value('77de0a1c-1111-4222-8333-444455556666')

const LONG =
  'Rework the import of very long planning documents into the board so that nothing is lost'

const STEADY: TimedStretch[] = [
  // Monday: one task with a short title, under one account.
  { at: on(0), group: { work_item: task(1, 'Fix'), account: FIRST }, spend: { seconds: 3600 } },
  // Tuesday: six tasks with long titles, under the other account, beside work on no task.
  ...Array.from({ length: 6 }, (_, index) => ({
    at: on(1),
    group: { work_item: task(index + 2, `${LONG}, part ${index + 1}`), account: SECOND },
    spend: { seconds: (7 - index) * 3600 },
  })),
  { at: on(1), group: { work_item: noTask, account: SECOND }, spend: { seconds: 5 * 3600 } },
  // Wednesday: two tasks under both accounts, unknown work, and more tasks for «other».
  { at: on(2), group: { work_item: task(1, 'Fix'), account: FIRST }, spend: { seconds: 7200 } },
  {
    at: on(2),
    group: { work_item: task(2, `${LONG}, part 1`), account: SECOND },
    spend: { seconds: 1800 },
  },
  { at: on(2), group: { work_item: unknownTask }, spend: { seconds: 4 * 3600 } },
  ...Array.from({ length: 10 }, (_, index) => ({
    at: on(2),
    group: { work_item: task(index + 20, `Small task ${index + 1}`), account: FIRST },
    spend: { seconds: 600 },
  })),
]

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
      '.period-readout',
      '.period-frame',
      '.period-notes',
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
    for (const section of await analytics.locator('.chart-section').all()) {
      await section.getByRole('radio', { name: 'Chart' }).click()
      await expect(section).toHaveAttribute('data-shown', 'chart')
    }
    const columns = page.locator('.spending-days .period-column')
    const bars = page.locator('.spending-bars .ranked-line')
    await expect(columns).toHaveCount(3)
    await expect(page.locator('.spending-days .period-note')).not.toHaveCount(0)
    // Work on no task and unknown work are ranked among the values, each with its bar.
    await expect(page.locator('.spending-bars .ranked-rest .ranked-row')).toHaveCount(0)
    await expect(
      page.locator(
        '.spending-bars .ranked-row:is([data-kind="none"], [data-kind="unknown"]) .ranked-bar',
      ),
    ).toHaveCount(2)

    await page.mouse.move(0, 0)
    const before = await layout(page)
    const readouts: string[] = []
    const moved: string[] = []

    const hold = async (name: string) => {
      moved.push(...moves(name, before, await layout(page)))
    }

    for (let index = 0; index < 3; index += 1) {
      await columns.nth(index).hover()
      readouts.push((await page.locator('.spending-days .period-readout').textContent()) ?? '')
      await hold(`day ${index + 1}`)
    }
    const barCount = await bars.count()
    for (let index = 0; index < barCount; index += 1) {
      await bars.nth(index).hover()
      await hold(`bar ${index + 1}`)
    }
    // The longest day, cut to its two lines, is whole in the readout's hint: the pointer goes
    // from that day up to the readout, which keeps saying that day.
    const readout = page.locator('.spending-days .period-readout')
    const lengths = readouts.map((text) => text.trim().length)
    await columns.nth(lengths.indexOf(Math.max(...lengths))).hover()
    const whole = (await readout.getAttribute('data-tooltip')) ?? ''
    await readout.hover()
    await expect(page.getByRole('tooltip')).toHaveText(whole)
    const series = (await readout.locator('span').nth(1).textContent()) ?? ''
    for (const part of series.split(', ')) expect(whole).toContain(part)
    expect(series.split(', ').length).toBeGreaterThan(2)
    await hold('readout')
    // Two lines of the detail type, reserved whatever the day says.
    const lines = await readout.evaluate((element) => {
      const [first] = element.children
      return element.getBoundingClientRect().height / (first?.getBoundingClientRect().height ?? 1)
    })
    expect(lines).toBeCloseTo(2, 1)
    await page.mouse.move(0, 0)
    await hold('after')

    await record(info, `steady-${width}`, { lengths, bars: barCount, moved })
    // The fixture does what it is for: the days read out at very different lengths.
    expect(Math.max(...lengths)).toBeGreaterThan(4 * Math.min(...lengths))
    expect(moved, 'parts that moved under the pointer').toEqual([])
  })
