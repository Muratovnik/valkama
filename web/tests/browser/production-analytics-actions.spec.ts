/**
 * What the Analytics page does past its charts, in the real app at the widths it is used at: the
 * table of the breakdown beside the period before, its download, and the way from any bar or day
 * to a task in two presses.
 *
 * The table stands whole in both languages, scrolls sideways inside its own frame with its row
 * names kept in view, and says once when the period before was not read. The download is offered
 * under a name that says the period, as UTF-8 with a byte order mark. A bar of a model or a day
 * narrows the view to it as a new place in the history, so Back returns; the task's bar then
 * opens the task the way the app opens any reference to it, and the opening is counted once. Each
 * run prints what it measured.
 */
import { readFile } from 'node:fs/promises'

import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { task, unknownTask, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import {
  boxes,
  expectNamesInView,
  expectWhole,
  measure,
  openReport,
  pageAt,
  record,
  scrolledNames,
  serve,
} from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectId, projectScope, spaceRef, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const WIDTHS = [1440, 1024, 390]
const on = (day: number) => new Date(2026, 10, day, 10)

/**
 * Three days of work: the task the backend holds under model-a on Monday, another task under
 * model-b on Tuesday, and work nobody can place on Wednesday; the task again a week before.
 */
const IMPORT = task(264, 'Import the planning documents')
const WORLD: TimedStretch[] = [
  {
    at: on(9),
    group: { work_item: IMPORT, model: value('model-a') },
    spend: { seconds: 7200, tokens: 2_000_000, cost: 20 },
  },
  {
    at: on(10),
    group: { work_item: task(2, 'Write the release notes'), model: value('model-b') },
    spend: { seconds: 3600, tokens: 1_000_000, cost: 10 },
  },
  {
    at: on(11),
    group: { work_item: unknownTask, model: { id: null, unknown: true } },
    spend: { seconds: 1800, tokens: 10_000, cost: 1 },
  },
  {
    at: on(2),
    group: { work_item: IMPORT, model: value('model-a') },
    spend: { seconds: 3600, tokens: 500_000, cost: 5 },
  },
]

/** Where the app takes a press on the task: its card on the board of its project. */
const TASK_ADDRESS = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** The app's search finds the task by its reference; each count of a use is kept. */
async function serveTask(page: Page) {
  await page.route('**/api/modules/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query: workItemRef.reference,
        limit: 50,
        has_more: false,
        items: [
          {
            target: { project_id: projectId, space_ref: spaceRef, reference: 'MAIN-264' },
            item: {
              work_item_id: workItem.work_item_id,
              planning_space_id: workItem.planning_space_id,
              reference: 'MAIN-264',
              title: workItem.title,
              state: { name: 'Dev' },
              claim_ref: '',
            },
          },
        ],
        coverage: [
          { project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null },
        ],
      },
    }),
  )
  const uses: string[] = []
  await page.route('**/api/analytics/uses', async (route) => {
    uses.push((route.request().postDataJSON() as { kind: string }).kind)
    await route.fulfill({ status: 204 })
  })
  return uses
}

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/** Tab until `target` holds the focus, as a keyboard reaches it; how many presses it took. */
async function tabTo(page: Page, target: Locator) {
  for (let press = 1; press <= 120; press += 1) {
    await page.keyboard.press('Tab')
    if (await target.evaluate((element) => element === document.activeElement)) return press
  }
  throw new Error('Tab never reached the control')
}

/** The focused control: whether its ring shows, and where it and the ring stand. */
const focusRing = (target: Locator) =>
  target.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      visible: element.matches(':focus-visible'),
      ring: style.outlineStyle === 'none' ? 0 : Number.parseFloat(style.outlineWidth),
      offset: Number.parseFloat(style.outlineOffset),
      box: {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      },
    }
  })

/**
 * What a pointer can press of each control a part offers: the control's box grown by the reach
 * its `::after` gives it, rounded to the pixel, and whether that stands inside the screen.
 */
const hitAreas = (part: Locator) =>
  part.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('a[href], button:not(.segmented-option)')]
      .filter((control) => control.checkVisibility())
      .map((control) => {
        const box = control.getBoundingClientRect()
        const after = getComputedStyle(control, '::after')
        const reach = (side: string) =>
          after.content === 'none' ? 0 : Math.max(0, -Number.parseFloat(side) || 0)
        const width = box.width + reach(after.left) + reach(after.right)
        const height = box.height + reach(after.top) + reach(after.bottom)
        return {
          name: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
          width: Math.round(width),
          height: Math.round(height),
          inside: box.left >= 0 && box.right <= document.documentElement.clientWidth,
        }
      }),
  )

/**
 * The table read beside the period before, and with that period not read: how many columns it
 * has (a name, the three measures, then the period before and the change), and what it says of
 * the period before, once.
 */
const TABLE_STATES = [
  { name: 'beside the period before', unread: false, columns: 6, notes: { en: [], ru: [] } },
  {
    name: 'with the period before not read',
    unread: true,
    columns: 4,
    notes: {
      en: ['The period before was not read, so this table shows this period alone.'],
      ru: ['Предыдущий период не прочитан, поэтому таблица показывает только этот период.'],
    },
  },
]

for (const lang of ['en', 'ru'] as const)
  test.describe(`the table of the breakdown, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })
    for (const width of WIDTHS)
      for (const { name, unread, columns, notes } of TABLE_STATES)
        test(`${name} stands whole at ${width}px`, async ({ page }, info) => {
          await serve(page, undefined, unread)
          const analytics = await openReport(page, width)
          const table = analytics.locator('.spending-table')
          // Twelve tasks, work on no task and work nobody can place, none folded.
          await expect(table.locator('tbody tr')).toHaveCount(14)
          await expect(table.locator('thead th')).toHaveCount(columns)
          await expect(table.locator('.spending-table-note')).toHaveText(notes[lang])
          const measured = await measure(page)
          const names = await scrolledNames(page)
          const [download] = await boxes(page, '.spending-download')
          const [frame] = await boxes(page, '.spending-table .chart-table-frame')
          const label = `analytics table ${lang} ${name} ${width}`
          await record(info, label, {
            pageScroll: measured.pageScroll,
            table: measured.sections.at(-1),
            frame,
            download,
            names: names.at(-1),
            heading: await table.locator('h2').textContent(),
          })
          expectWhole(measured)
          expect(frame?.x).toBeGreaterThanOrEqual(0)
          expect((frame?.x ?? -1) + (frame?.width ?? 0)).toBeLessThanOrEqual(width)
          expect(download?.x).toBeGreaterThanOrEqual(0)
          expect((download?.x ?? -1) + (download?.width ?? 0)).toBeLessThanOrEqual(width)
          expectNamesInView(names)
          await expectNoSilentClipping(page, label, '.spending-table')
          await table.screenshot(shot(info, `${label.replaceAll(' ', '-')}.png`))
        })

    test('a phone scrolls the table in its frame, its row names in view', async ({
      page,
    }, info) => {
      await serve(page)
      await openReport(page, 390)
      const scrolled = await scrolledNames(page)
      const names = scrolled.at(-1)
      await record(info, `analytics table ${lang} scrolled 390`, names)
      expect(names?.scroll).toBeGreaterThan(0)
      expect(expectNamesInView(names ? [names] : [])).toBe(1)
    })
  })

test('the view downloads as a CSV file named by its period, with a byte order mark', async ({
  page,
}) => {
  await serve(page, WORLD)
  const analytics = await openReport(page, 1440)
  const offered = page.waitForEvent('download')
  await analytics.locator('.spending-download').click()
  const download = await offered
  expect(download.suggestedFilename()).toBe('agent-usage-2026-11-09-to-2026-11-11-by-work_item.csv')
  const bytes = await readFile(await download.path())
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const lines = bytes.subarray(3).toString('utf8').split('\r\n')
  expect(lines[0]?.startsWith('breakdown,value_id,value_reference,value_name,')).toBe(true)
  expect(lines[1]).toMatch(
    /^work_item,00000000-0000-4000-8000-000000000264,MAIN-264,Import the planning documents,category,7200,2000000,20,0,3600,500000,5,0,/u,
  )
  // Every value of both periods and a line end after the last.
  expect(lines).toHaveLength(5)
  expect(lines.at(-1)).toBe('')
})

for (const width of WIDTHS)
  test(`a model's bar and a day each lead to a task in two presses at ${width}px`, async ({
    page,
  }, info) => {
    await serve(page, WORLD)
    const uses = await serveTask(page)
    const byModel = pageAt({ by: 'model' })
    const analytics = await openReport(page, width, byModel)
    const bars = analytics.locator('.spending-bars')

    // Neither the work nobody can place nor its row in the table is a control.
    const unknown = bars.locator(':is(.ranked-line, th)', { hasText: 'Unknown' })
    await expect(unknown).toHaveCount(1)
    await expect(unknown.locator('a, button')).toHaveCount(0)
    const cursor = await unknown.evaluate((element) => getComputedStyle(element).cursor)
    const tableUnknown = analytics.locator('.spending-table tbody th', { hasText: 'Unknown' })
    await expect(tableUnknown.locator('a, button')).toHaveCount(0)
    const areas = {
      bars: await hitAreas(bars),
      days: await hitAreas(analytics.locator('.spending-days')),
      table: await hitAreas(analytics.locator('.spending-table tbody')),
    }

    // By pointer: model-a, then its one task.
    await bars.getByRole('button', { name: 'Show the tasks of model-a', exact: true }).click()
    const narrowed = pageAt({ filters: '{"model":["model-a"]}' })
    await expect.poll(() => path(page)).toBe(narrowed)
    await page.goBack()
    await expect.poll(() => path(page)).toBe(byModel)
    await page.goForward()
    await expect.poll(() => path(page)).toBe(narrowed)
    const link = bars.getByRole('link', { name: 'MAIN-264 Import the planning documents' })
    await expect(link).toHaveAttribute('href', '/open/MAIN-264')
    await link.click()
    await expect.poll(() => path(page)).toBe(TASK_ADDRESS)
    await expect(page.locator('.drawer')).toContainText(workItem.title)
    await expect.poll(() => uses.filter((kind) => kind === 'task_open')).toHaveLength(1)

    // By keyboard: Tuesday, then its one task from the table.
    await openReport(page, width, byModel)
    const tuesday = analytics
      .locator('.spending-days')
      .getByRole('button', { name: /^Show the tasks of .*10/u })
    const dayPresses = await tabTo(page, tuesday)
    const dayRing = await focusRing(tuesday)
    await page.keyboard.press('Enter')
    await expect
      .poll(() => path(page))
      .toBe(pageAt({ period: 'custom', from: '2026-11-10', to: '2026-11-10' }))
    const row = analytics
      .locator('.spending-table')
      .getByRole('link', { name: 'MAIN-2 Write the release notes' })
    const rowPresses = await tabTo(page, row)
    const rowRing = await focusRing(row)
    await page.keyboard.press('Enter')
    await expect.poll(() => uses.filter((kind) => kind === 'task_open')).toHaveLength(2)

    await record(info, `analytics two presses ${width}`, {
      cursor,
      areas,
      dayPresses,
      dayRing,
      rowPresses,
      rowRing,
    })
    expect(cursor).not.toBe('pointer')
    for (const ring of [dayRing, rowRing]) {
      expect(ring.visible).toBe(true)
      expect(ring.ring).toBeGreaterThan(0)
      expect(ring.box.x - ring.ring - ring.offset).toBeGreaterThanOrEqual(0)
      expect(ring.box.x + ring.box.width + ring.ring + ring.offset).toBeLessThanOrEqual(width)
    }
    for (const area of [...areas.bars, ...areas.days, ...areas.table]) {
      expect(area.inside, area.name).toBe(true)
      expect(area.height, area.name).toBeGreaterThanOrEqual(24)
      expect(area.width, area.name).toBeGreaterThanOrEqual(24)
    }
  })
