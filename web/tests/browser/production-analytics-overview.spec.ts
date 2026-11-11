/**
 * The overview of the Analytics page in the real app, where the page opens. The oracle is the
 * requirement: on a desktop window of 1440 by 900 its three figures, the period's chart, what
 * changed and the four cards of first values all stand in the panel without scrolling it; a
 * figure is the control that chooses the page's measure, pressed by more than a colour and from
 * the keyboard, and the address keeps it; the chart outlines the period before on its own scale;
 * what changed names the tasks that moved most by the measure's own units; a card's heading opens
 * its section and a row narrows the view; a single day stands as its hours. Each run prints what
 * it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { noTask, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { test } from './test.ts'

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/** Ten in the morning of a day of November 2026, in the browser's own time. */
const on = (day: number, hour = 10) => new Date(2026, 10, day, hour)
const HOUR = 3600

const ACCOUNT = value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f')

/** A stretch of work on a day: its task, model, role and project, and its hours. */
function worked(
  day: number,
  workItem: TimedStretch['group']['work_item'],
  [model, role, project]: [string, string, string],
  hours: number,
): TimedStretch {
  return {
    at: on(day),
    group: {
      work_item: workItem,
      model: value(model),
      role: value(role),
      project: value(project),
      account: ACCOUNT,
    },
    spend: { seconds: hours * HOUR, tokens: hours * 100_000, cost: hours * 2 },
  }
}

const TASKS = Array.from({ length: 6 }, (_, index) =>
  task(index + 1, `Rework the import of planning documents, part ${index + 1}`),
)

/**
 * This week to Wednesday afternoon, and the same days of the week before. From the week before:
 * MAIN-1 and work on no task fall by four hours each; MAIN-2 rises from a quarter of an hour,
 * MAIN-3 by two hours, MAIN-5 from nothing.
 */
const WORLD: TimedStretch[] = [
  worked(9, TASKS[0], ['model-a', 'main', 'alpha'], 5),
  worked(9, TASKS[1], ['model-b', 'subagent', 'alpha'], 3),
  worked(10, TASKS[2], ['model-a', 'main', 'beta'], 4),
  worked(10, TASKS[3], ['model-c', 'advisor', 'beta'], 1),
  worked(10, noTask, ['model-a', 'main', 'alpha'], 2),
  worked(11, TASKS[4], ['model-b', 'main', 'gamma'], 2),
  worked(11, TASKS[5], ['model-a', 'subagent', 'gamma'], 1),
  worked(11, TASKS[0], ['model-a', 'main', 'alpha'], 1),
  worked(2, TASKS[0], ['model-a', 'main', 'alpha'], 10),
  worked(2, TASKS[2], ['model-a', 'main', 'beta'], 2),
  worked(3, noTask, ['model-a', 'main', 'alpha'], 6),
  worked(4, TASKS[1], ['model-b', 'subagent', 'alpha'], 0.25),
]

/** Opens the page at an address and waits until the overview's reads have all landed. */
async function openOverview(page: Page, width: number, height: number, address = pageAt()) {
  await page.setViewportSize({ width, height })
  await page.goto(address)
  const panel = page.locator('.analytics-panel')
  await expect(panel.locator('.overview-panel')).toBeVisible()
  await expect(panel.locator('.overview-top')).not.toHaveCount(0)
  for (const card of await panel.locator('.overview-top').all())
    await expect(card.locator('.ranked-row').first()).toBeVisible()
  await expect(panel.locator('.period-before').first()).toBeAttached()
  return panel
}

/** Where each part of the overview stands against the panel that holds it, and how it scrolls. */
async function overviewLayout(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    if (!panel) throw new Error('no panel')
    // It runs in the page, where nothing outside it is in scope.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- runs in the page
    const place = (element: Element) => {
      const { top, bottom, left, right } = element.getBoundingClientRect()
      return {
        top: Math.round(top),
        bottom: Math.round(bottom),
        left: Math.round(left),
        right: Math.round(right),
      }
    }
    const parts = ['.spending-tiles', '.spending-days', '.overview-changes', '.overview-top']
    return {
      panel: {
        ...place(panel),
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        scrollTop: panel.scrollTop,
      },
      parts: parts.flatMap((selector) =>
        [...panel.querySelectorAll(selector)].map((element) => ({ selector, ...place(element) })),
      ),
      document: {
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      },
    }
  })
}

test('opens a plain address on the overview, every part in sight at 1440×900', async ({
  page,
}, info) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/analytics/usage?')) asked.push(request.url())
  })
  await serve(page, WORLD)
  const panel = await openOverview(page, 1440, 900)
  await expect(page.locator('.analytics-rail [aria-current="page"]')).toHaveText(/^Overview/u)
  expect(path(page)).toBe(pageAt())
  const layout = await overviewLayout(page)
  await record(info, 'analytics overview 1440x900', { layout, reads: asked.length })
  await page.screenshot(shot(info, 'analytics-overview-1440x900.png'))
  expect(layout.document.scrollHeight).toBe(layout.document.clientHeight)
  // Nothing of the panel lies under its edge: it has nothing to scroll, and nothing was.
  expect(layout.panel.scrollHeight).toBe(layout.panel.clientHeight)
  expect(layout.panel.scrollTop).toBe(0)
  const count = (selector: string) => layout.parts.filter((part) => part.selector === selector)
  expect(count('.spending-tiles')).toHaveLength(1)
  expect(count('.spending-days')).toHaveLength(1)
  expect(count('.overview-changes')).toHaveLength(1)
  expect(count('.overview-top')).toHaveLength(4)
  for (const part of layout.parts) {
    expect(part.top, part.selector).toBeGreaterThanOrEqual(layout.panel.top)
    expect(part.bottom, part.selector).toBeLessThanOrEqual(layout.panel.bottom)
    expect(part.right, part.selector).toBeLessThanOrEqual(layout.panel.right)
  }
  // The four cards stand in one row.
  expect(new Set(count('.overview-top').map((card) => card.top)).size).toBe(1)
  await expect(panel.locator('.overview-top h3')).toHaveText([
    'Tasks',
    'Models',
    'Roles',
    'Projects',
  ])
  // The page's read and the same days of the week before, the accounts, the steps of the week
  // before for the outline, and one read for each card the page's own read is not by.
  expect(asked).toHaveLength(7)
})

test('a figure chooses the measure, pressed by a check, from the keyboard, into the address', async ({
  page,
}) => {
  await serve(page, WORLD)
  const panel = await openOverview(page, 1440, 900)
  const figures = panel.getByRole('radiogroup', { name: 'What the charts show' })
  const radios = figures.getByRole('radio')
  await expect(radios).toHaveCount(3)
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true')
  await expect(radios.nth(0).locator('.tile-chosen')).toBeVisible()
  await expect(figures.locator('.tile-chosen')).toHaveCount(1)
  await radios.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => path(page)).toBe(pageAt({ measure: 'tokens' }))
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true')
  await expect(radios.nth(1).locator('.tile-chosen')).toBeVisible()
  await expect(figures.locator('.tile-chosen')).toHaveCount(1)
  await expect(panel.locator('.spending-days h2')).toHaveText('Tokens per day, by task')
  // The cards and what changed say the measure chosen.
  await expect(panel.locator('[data-card="model"] .ranked-value').first()).toHaveText('1.3M')
  await page.reload()
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true')
})

test('the chart outlines the period before on its own scale, in the legend, the readout and the table', async ({
  page,
}) => {
  await serve(page, WORLD)
  const panel = await openOverview(page, 1440, 900)
  const days = panel.locator('.spending-days')
  // Monday the 2nd held twelve hours, more than this Monday: the scale reaches past it.
  await expect(days.locator('.period-before')).toHaveCount(3)
  await expect(days.locator('.chart-key[data-series="outline"]')).toHaveText('period before')
  await expect(days.locator('.period-scale')).toContainText('15')
  const heights = await days.locator('.period-slot').evaluateAll((slots) =>
    slots.map((slot) => {
      const stack = slot.querySelector('.period-stack')?.getBoundingClientRect().height ?? 0
      const before = slot.querySelector('.period-before')?.getBoundingClientRect().height ?? 0
      return { stack: Math.round(stack), before: Math.round(before) }
    }),
  )
  // Monday: eight hours against twelve; Wednesday so far: four hours against a quarter of one.
  expect(heights[0]?.before).toBeGreaterThan(heights[0]?.stack ?? 0)
  expect(heights[2]?.before).toBeLessThan(heights[2]?.stack ?? 0)
  await expect(days.locator('.period-readout')).toContainText(/period before 15\smin/u)
  await days.getByRole('radio', { name: 'Table' }).click()
  await expect(days.locator('thead th').nth(-2)).toHaveText('period before')
  await expect(days.locator('tbody tr').first().locator('td').nth(-2)).toHaveText(/^12\sh$/u)
})

test('what changed names the tasks that moved most, in the measure’s own units', async ({
  page,
}) => {
  await serve(page, WORLD)
  const panel = await openOverview(page, 1440, 900)
  const changes = panel.locator('.overview-changes')
  const up = changes.locator('[data-way="up"]')
  const down = changes.locator('[data-way="down"]')
  await expect(up.locator('.overview-changes-name')).toHaveText([
    /^MAIN-2 /u,
    /^MAIN-3 /u,
    /^MAIN-5 /u,
  ])
  await expect(up.locator('.overview-changes-amount')).toHaveText([
    /^\+\s2\sh\s45\smin$/u,
    /^\+\s2\sh$/u,
    /^\+\s2\sh$/u,
  ])
  await expect(up.nth(2).locator('.overview-changes-note')).toHaveText('nothing before')
  await expect(down.locator('.overview-changes-name')).toHaveText(['No task', /^MAIN-1 /u])
  await expect(down.locator('.overview-changes-amount')).toHaveText([/^−\s4\sh$/u, /^−\s4\sh$/u])
  // A task is a link to its card; work on no task leads nowhere.
  await expect(up.first()).toHaveAttribute('href', /MAIN-2/u)
  await expect(down.first()).not.toHaveAttribute('href')
})

test('a card’s heading opens its section, and a row narrows the view as a bar does', async ({
  page,
}) => {
  await serve(page, WORLD)
  const panel = await openOverview(page, 1440, 900)
  const models = panel.locator('[data-card="model"]')
  await expect(models.locator('.ranked-label')).toHaveText(['model-a', 'model-b', 'model-c'])
  await models.getByRole('button', { name: 'Models' }).click()
  await expect.poll(() => path(page)).toBe(pageAt({ by: 'model' }))
  await expect(page.locator('.analytics-rail [aria-current="page"]')).toHaveText(/^Model/u)
  // In place, as a section chosen on the rail beside the panel is.
  await page.locator('.analytics-rail [data-section="overview"]').click()
  await expect(page.locator('.analytics-rail [aria-current="page"]')).toHaveText(/^Overview/u)
  await models.getByRole('button', { name: 'Show the tasks of model-b' }).click()
  await expect
    .poll(() => path(page))
    .toBe(pageAt({ by: 'work_item', filters: '{"model":["model-b"]}' }))
  // A task's row is a link to its card, as a bar by task is.
  await page.goBack()
  await expect(panel.locator('[data-card="work_item"] a.ranked-line').first()).toHaveAttribute(
    'href',
    /MAIN-1/u,
  )
})

test('a single day stands as its hours beside the day before', async ({ page }, info) => {
  await serve(page, WORLD)
  const day = pageAt({ period: 'custom', from: '2026-11-10', to: '2026-11-10' })
  const panel = await openOverview(page, 1440, 900, day)
  const days = panel.locator('.spending-days')
  await expect(days.locator('h2')).toHaveText('Agent time per hour, by task')
  await expect(days.locator('.period-slot')).toHaveCount(24)
  // An hour narrows to nothing further: no column is a control.
  await expect(days.locator('button.period-column')).toHaveCount(0)
  // The day before worked at ten, the hour this day did too.
  await expect(days.locator('.period-slot[data-key*="T10:00"] .period-before')).toHaveCount(1)
  await expect(days.locator('.period-before')).toHaveCount(1)
  await page.screenshot(shot(info, 'analytics-overview-day-1440x900.png'))
})
