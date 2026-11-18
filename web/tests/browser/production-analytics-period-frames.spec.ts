/**
 * No chart of periods scrolls inside itself for want of a pixel, in the real app at 1280 and 1440
 * pixels: every chart's frame on the Analytics page, and in a task's side panel, holds its plot
 * whole, its content no wider than its box. The zone of the first and the last period once ran
 * half a gap past the plot's edges, so a frame that keeps no room past its periods, as the
 * panel's charts do, scrolled by one pixel and drew a scrollbar for it. Each frame is the region
 * `PeriodColumns` documents (`data-region="frame"`); each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

/** Every chart of periods under `host`, by the frame its plot scrolls in. */
const FRAMES = '[data-chart="periods"] [data-region="frame"]'

/** Each frame's box against what it holds, and the charts it belongs to, by their names. */
const framesIn = (host: Locator) =>
  host.locator(FRAMES).evaluateAll((frames) =>
    frames.map((frame) => ({
      chart: frame.closest('[data-chart]')?.getAttribute('aria-label') ?? '',
      clientWidth: frame.clientWidth,
      scrollWidth: frame.scrollWidth,
    })),
  )

/** The task the page's week holds most of, whose panel draws its time by day. */
const TASK = task(1, 'Rework the import of very long planning documents into the board, part 1')

for (const width of [1280, 1440])
  test(`at ${width}px no chart of periods scrolls by a pixel, on the page or in a task’s panel`, async ({
    page,
  }, info) => {
    await serve(page)
    const analytics = await openReport(page, width)
    const onPage = await framesIn(analytics)
    await page.goto(
      pageAt({ by: 'work_item', detail: JSON.stringify({ by: 'work_item', value: TASK.id }) }),
    )
    const panel = page.getByRole('dialog')
    await expect(panel).toBeVisible()
    await expect(panel.locator(FRAMES).first()).toBeVisible()
    const inPanel = await framesIn(panel)
    await record(info, `period-frames-${width}`, { onPage, inPanel })
    expect(onPage.length, 'charts of periods on the page').toBeGreaterThanOrEqual(1)
    expect(inPanel.length, 'charts of periods in the panel').toBeGreaterThanOrEqual(1)
    expect(
      [...onPage, ...inPanel].filter((frame) => frame.scrollWidth > frame.clientWidth),
      'a frame wider inside than its box',
    ).toEqual([])
  })
