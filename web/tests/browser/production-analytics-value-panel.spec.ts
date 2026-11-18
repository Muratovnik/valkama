/**
 * A value pressed on the Analytics page opens its side panel, in the real app at the widths it is
 * used at and in both languages. The oracle is the requirement (`DESIGN.md`, Analytics): an
 * ordinary press on a value, by pointer or by keyboard, opens its panel on the right, the shared
 * modal inspector of the drawer layer, at the window's right edge and across the whole of a
 * phone, with the focus in it; Escape and Back close it and give the focus back to what opened
 * it, and a reload opens it again with no ring. Its parts stand in one column, none over another
 * and none cut. A task's panel offers its card, which stands over the page while the panel waits
 * closed under it; a model's offers none and is not broken down by models; work with no task has
 * no card, and «Narrow the page to it» breaks the page down by where the work came from. A press
 * with a modifier on a task is the browser's. «All N» opens every value of the section, found by
 * name, each opening its own panel in its place. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import { messages } from '@/shared/i18n/index.ts'
import { DRAWER_DEFAULT_WIDTH, DRAWER_NARROW_BREAKPOINT } from '@/shared/lib/shellLayout.ts'

import { noTask, task, unknownTask, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { NARROW_FRAME, pageAt, record, serve, serveTask, shortfalls } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { globalScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

type Locale = 'en' | 'ru'

const on = (day: number) => new Date(2026, 10, day, 10)
const WORK = value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f')
const NIGHT = value('d4e8a1f0-7c2b-4e5d-8f36-a1b2c3d4e5f6')

/** The task the backend holds, whose card opens, under two models and two accounts. */
const IMPORT = task(264, workItem.title)
const IMPORT_NAME = `MAIN-264 ${workItem.title}`

/**
 * This week: the task above, thirteen more under model-b, so the section's list leaves some to
 * «All N», work with no task and work nobody can place; the task again the week before. Sixteen
 * values in all: fourteen tasks, no task and unknown work.
 */
const WORLD: TimedStretch[] = [
  {
    at: on(10),
    group: { work_item: IMPORT, model: value('model-a'), account: WORK },
    spend: { seconds: 7200, tokens: 2_000_000, cost: 20 },
  },
  {
    at: on(9),
    group: { work_item: IMPORT, model: value('model-b'), account: NIGHT },
    spend: { seconds: 3600, tokens: 800_000, cost: 8 },
  },
  ...Array.from({ length: 13 }, (_, index) => ({
    at: on(9 + (index % 3)),
    group: {
      work_item: task(index + 2, `Write the release notes, part ${index + 1}`),
      model: value('model-b'),
      account: index % 2 ? WORK : NIGHT,
    },
    spend: { seconds: 1800 + index * 60, tokens: 100_000, cost: 1 },
  })),
  {
    at: on(9),
    group: { work_item: noTask, model: value('model-a'), account: WORK },
    spend: { seconds: 5400, tokens: 300_000, cost: 3 },
  },
  {
    at: on(11),
    group: { work_item: unknownTask, model: { id: null, unknown: true } },
    spend: { seconds: 900, tokens: 10_000, cost: 1 },
  },
  {
    at: on(2),
    group: { work_item: IMPORT, model: value('model-a'), account: WORK },
    spend: { seconds: 3600, tokens: 500_000, cost: 5 },
  },
]
const VALUES = 16

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/** A window too narrow for the list beside a section shows the section the address names. */
const shownAt = (width: number, state: Record<string, string>) =>
  width < NARROW_FRAME ? { ...state, open: 'section' } : state

/** The address of a value's panel over a view. */
const withDetail = (state: Record<string, string>, by: string, id: string | null) => ({
  ...state,
  detail: JSON.stringify({ by, value: id }),
})

/** The task's card over the page, which keeps the view it was opened from. */
const cardOver = (state: Record<string, string>) =>
  serializePlatformRoute({
    module_id: 'analytics',
    scope: globalScope,
    entity: planningWorkItemEntity(workItemRef),
    state,
  })

/** Words of the app's messages with their placeholders filled. */
function fill(words: string, values: Record<string, string>) {
  let said = words
  for (const [key, one] of Object.entries(values)) said = said.replace(`{${key}}`, one)
  return said
}

async function inLocale(page: Page, locale: Locale) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
}

/** The page at a view, its section's ranked list drawn rather than its table. */
async function openList(page: Page, width: number, state: Record<string, string>) {
  await page.setViewportSize({ width, height: 900 })
  await page.goto(pageAt(shownAt(width, state)))
  const bars = page.locator('.spending-bars')
  await drawLined(bars)
  return bars
}

/** The side panel standing open: the modal dialog its name names, at rest after its entrance. */
async function panelNamed(page: Page, name: string) {
  const panel = page.getByRole('dialog', { name })
  await expect(panel).toBeVisible()
  await expect(panel).toHaveCSS('transform', 'none')
  await page.evaluate(() => document.fonts.ready)
  return panel
}

const round = (amount: number) => Math.round(amount * 100) / 100

/** The element with the focus: whether it is what the panel is read with, and the ring drawn. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return { scroller: false, outline: 0, shadow: false }
    const style = getComputedStyle(active)
    return {
      scroller: active.dataset.overlayScroller !== undefined,
      outline: style.outlineStyle === 'none' ? 0 : Number.parseFloat(style.outlineWidth),
      shadow: style.boxShadow !== 'none',
    }
  })

async function edges(target: Locator) {
  const box = await target.boundingBox()
  if (!box) throw new Error('a part of the panel is not laid out')
  return {
    left: round(box.x),
    right: round(box.x + box.width),
    top: round(box.y),
    bottom: round(box.y + box.height),
  }
}

/**
 * Where the panel stands in the window and where each of its parts stands in it, its heading
 * first: what the panel names, then what it holds, in their order.
 */
async function placed(page: Page, panel: Locator, parts: Record<string, Locator>) {
  const named = { heading: panel.getByRole('heading', { level: 2 }), ...parts }
  const boxes: Record<string, Awaited<ReturnType<typeof edges>>> = {}
  for (const [part, target] of Object.entries(named)) boxes[part] = await edges(target)
  return {
    window: page.viewportSize()?.width ?? 0,
    panel: await edges(panel),
    parts: boxes,
  }
}

/**
 * The panel stands at the window's right edge, as wide as a drawer opens or as the whole of a
 * phone; its parts start at one edge, end inside it and follow each other down without meeting.
 */
function expectPlaced(measured: Awaited<ReturnType<typeof placed>>, count: number) {
  const { panel, parts, window } = measured
  expect(Math.abs(panel.right - window), 'at the right edge').toBeLessThanOrEqual(1)
  const wide = window <= DRAWER_NARROW_BREAKPOINT ? window : DRAWER_DEFAULT_WIDTH
  expect(Math.abs(panel.right - panel.left - wide), 'as wide as it opens').toBeLessThanOrEqual(1)
  const boxes = Object.values(parts)
  expect(boxes).toHaveLength(count)
  const start = Math.min(...boxes.map((box) => box.left))
  for (const [part, box] of Object.entries(parts)) {
    expect(box.left - start, `${part} at the column's start`).toBeLessThanOrEqual(1)
    expect(box.right, `${part} inside the panel`).toBeLessThanOrEqual(panel.right)
    expect(box.left, `${part} inside the panel`).toBeGreaterThanOrEqual(panel.left)
  }
  const down = [...boxes].sort((one, other) => one.top - other.top)
  for (const [index, box] of down.entries()) {
    const above = down[index - 1]
    if (above) expect(box.top, 'no part over another').toBeGreaterThanOrEqual(above.bottom - 0.5)
  }
}

/** Nothing in the open panel clipped without a sign, and none of its figures or names short. */
async function expectWhole(page: Page, where: string, words: string) {
  await expectNoSilentClipping(page, where, '[role="dialog"]')
  const short = await shortfalls(page, words)
  expect(short.length, `${where}: words measured`).toBeGreaterThan(0)
  expect(
    short.filter((one) => one.short > 0.5),
    `${where}: every word whole`,
  ).toEqual([])
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1440, 1024, 390])
    test(`in ${locale} at ${width}px a task's panel, every value and a window's spend each stand at the window's right edge in one column, cutting nothing`, async ({
      page,
    }, info) => {
      const said = messages[locale].analytics
      await inLocale(page, locale)
      await serve(page, WORLD)
      await serveTask(page)
      const bars = await openList(page, width, { by: 'work_item' })

      // A task's panel, opened by pointer from its bar.
      await bars.getByRole('link', { name: fill(said.detail.open, { value: IMPORT_NAME }) }).click()
      const task = await panelNamed(page, fill(said.detail.label, { title: IMPORT_NAME }))
      const parts = ['actions', 'figures', 'days', 'model', 'account'] as const
      const taskParts = Object.fromEntries(
        parts.map((part) => [part, task.locator(`[data-part="${part}"]`)]),
      )
      for (const part of Object.values(taskParts)) await expect(part).toBeVisible()
      const taskPlaced = await placed(page, task, taskParts)
      expectPlaced(taskPlaced, parts.length + 1)
      await expectWhole(
        page,
        `a task's panel at ${width}px in ${locale}`,
        '[role="dialog"] [data-figure] :is(dt, dd), [role="dialog"] h3',
      )
      await page.keyboard.press('Escape')
      await expect(task).toBeHidden()

      // Every value of the section, from «All N» under the list.
      const all = bars.locator('[data-all]')
      await expect(all).toHaveText(fill(said.panel.bars.all.split(' | ')[0] ?? '', { count: '16' }))
      await all.click()
      const every = await panelNamed(
        page,
        fill(said.detail.label, {
          title: fill(said.detail.all.title, { dimension: said.dimensions.work_item }),
        }),
      )
      const table = every.locator('[data-detail="all"]')
      await expect(table.locator('tbody').getByRole('row')).toHaveCount(VALUES)
      const everyParts = {
        find: every.getByRole('textbox', { name: said.detail.all.find }),
        table,
      }
      const everyPlaced = await placed(page, every, everyParts)
      expectPlaced(everyPlaced, 3)
      await expectNoSilentClipping(
        page,
        `every value at ${width}px in ${locale}`,
        '[role="dialog"]',
      )
      await page.keyboard.press('Escape')
      await expect(every).toBeHidden()

      // A window's spend, from its block in the quota's section.
      await page.goto(pageAt(shownAt(width, { by: 'quota_five_hour' })))
      const opens = page.getByRole('button', { name: said.detail.window.open })
      await expect(opens).toHaveCount(3)
      await opens.first().click()
      const window = page.getByRole('dialog')
      await expect(window).toBeVisible()
      await expect(window).toHaveCSS('transform', 'none')
      const spend = window.locator('[data-detail="window"]')
      await expect(spend.locator('[data-state]').first()).toBeVisible()
      await expect(spend.locator('[data-state="loading"]')).toHaveCount(0)
      const windowParts = { shown: window.getByRole('radiogroup').first(), spend }
      const windowPlaced = await placed(page, window, windowParts)
      expectPlaced(windowPlaced, 3)
      await expectNoSilentClipping(
        page,
        `a window's spend at ${width}px in ${locale}`,
        '[role="dialog"]',
      )

      await record(info, `value panel ${locale} ${width}`, {
        task: taskPlaced,
        every: everyPlaced,
        window: windowPlaced,
      })
    })

test('a model’s bar opens its panel from the keyboard, Escape and Back close it and give the focus back, a reload opens it again with no ring, and it narrows the page', async ({
  page,
}, info) => {
  await serve(page, WORLD)
  await serveTask(page)
  const bars = await openList(page, 1440, { by: 'model' })
  const byModel = pageAt({ by: 'model' })
  const opened = pageAt(withDetail({ by: 'model' }, 'model', 'model-b'))
  const bar = bars.getByRole('button', { name: 'Details of model-b' })
  await bar.focus()
  await page.keyboard.press('Enter')
  const panel = await panelNamed(page, 'Details: model-b')
  await expect.poll(() => path(page)).toBe(opened)
  const focusIn = () => panel.evaluate((surface) => surface.contains(document.activeElement))
  await expect.poll(focusIn).toBe(true)
  const keyed = await focused(page)
  expect(keyed.outline > 0 || keyed.shadow, 'the focus a keyboard brought shows its ring').toBe(
    true,
  )
  // A model has no card, and is broken down by account alone: a task's panel has both parts.
  await expect(panel.locator('[data-part="account"]')).toBeVisible()
  await expect(panel.locator('[data-part="model"]')).toHaveCount(0)
  await expect(panel.getByRole('link', { name: 'Open the card' })).toHaveCount(0)

  // Escape closes it as a new place, and the focus goes back to the bar.
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(bar).toBeFocused()
  await expect.poll(() => path(page)).toBe(byModel)
  // Back opens it again, and Back once more closes it, the focus back on the bar.
  await page.goBack()
  await expect(panel).toBeVisible()
  await page.goBack()
  await expect(panel).toBeHidden()
  await expect.poll(() => path(page)).toBe(byModel)
  await expect(bar).toBeFocused()

  // A reload of its address opens it again, the focus in it and no ring drawn.
  await page.goForward()
  await expect(panel).toBeVisible()
  await page.reload()
  await panelNamed(page, 'Details: model-b')
  await expect.poll(focusIn).toBe(true)
  const reloaded = await focused(page)
  expect(reloaded).toEqual({ scroller: true, outline: 0, shadow: false })

  // Narrowing from it is the page's narrowing to the model, the panel closed in the same step.
  await panel.getByRole('button', { name: 'Narrow the page to it' }).click()
  await expect
    .poll(() => path(page))
    .toBe(pageAt({ by: 'work_item', filters: '{"model":["model-b"]}' }))
  await expect(panel).toBeHidden()
  await page.goBack()
  await expect(panel).toBeVisible()
  await record(info, 'value panel by keyboard', { keyed, reloaded })
})

test('a task’s panel opens its card over the page, the panel closed under it until the card closes, and a press with Control on the task is left to the browser', async ({
  page,
}, info) => {
  await serve(page, WORLD)
  const uses = await serveTask(page)
  const bars = await openList(page, 1440, { by: 'work_item' })
  const opened = withDetail({ by: 'work_item' }, 'work_item', IMPORT.id)
  const bar = bars.getByRole('link', { name: `Details of ${IMPORT_NAME}` })
  await expect(bar).toHaveAttribute('href', '/open/MAIN-264')
  await bar.click()
  const panel = await panelNamed(page, `Details: ${IMPORT_NAME}`)
  await expect.poll(() => path(page)).toBe(pageAt(opened))
  expect(uses.filter((kind) => kind === 'task_open')).toEqual([])

  const card = panel.getByRole('link', { name: 'Open the card' })
  await expect(card).toHaveAttribute('href', '/open/MAIN-264')
  await card.click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toContainText(workItem.title)
  await expect.poll(() => path(page)).toBe(cardOver(opened))
  // The card stands alone over the page: the panel waits under it, closed.
  await expect(panel).toBeHidden()
  const over = await drawer.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return document.elementFromPoint(box.left + box.width / 2, box.top + 40)?.closest('.drawer')
      ? 'card'
      : 'other'
  })
  expect(over).toBe('card')
  await expect.poll(() => uses.filter((kind) => kind === 'task_open')).toHaveLength(1)

  await drawer.locator('.drawer-frame-close').click()
  await expect(drawer).toBeHidden()
  await expect(panel).toBeVisible()
  await expect.poll(() => path(page)).toBe(pageAt(opened))
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // A press with Control is the browser's to take elsewhere: the app opens nothing. The press is
  // stopped before the browser follows it, so no address is opened from here.
  await page.evaluate(() => {
    window.addEventListener('click', (event) => {
      if (!event.ctrlKey) return
      document.body.dataset.leftToBrowser = String(!event.defaultPrevented)
      event.preventDefault()
    })
  })
  const before = path(page)
  await bar.click({ modifiers: ['Control'] })
  await expect(page.locator('body')).toHaveAttribute('data-left-to-browser', 'true')
  expect(path(page)).toBe(before)
  await expect(panel).toBeHidden()
  await expect.poll(() => uses.filter((kind) => kind === 'task_open')).toHaveLength(2)
  await record(info, 'value panel under a card', { over, uses })
})

test('in Russian, work with no task opens a panel with no card, and «Сузить страницу до него» breaks the page down by where the work came from and closes it', async ({
  page,
}) => {
  await inLocale(page, 'ru')
  await serve(page, WORLD)
  await serveTask(page)
  const bars = await openList(page, 1440, { by: 'work_item' })
  await bars.getByRole('button', { name: 'Подробнее: Без задачи' }).click()
  const panel = await panelNamed(page, 'Подробности: Без задачи')
  await expect
    .poll(() => path(page))
    .toBe(pageAt(withDetail({ by: 'work_item' }, 'work_item', null)))
  await expect(panel.locator('[data-part="figures"]')).toBeVisible()
  // No card: the task's panel offers one where this offers none.
  await expect(panel.getByRole('link', { name: 'Открыть карточку' })).toHaveCount(0)
  const narrow = panel.getByRole('button', { name: 'Сузить страницу до него' })
  await expect(narrow).toHaveAccessibleDescription(
    'Разобрать работу без задачи по проектам и способам запуска',
  )
  await narrow.click()
  await expect
    .poll(() => path(page))
    .toBe(pageAt({ by: 'project', filters: '{"work_item":[null]}', across: 'launch_class' }))
  await expect(panel).toBeHidden()
})

test('«All N» opens every value of the section, found by its name, and a value pressed there opens its own panel in its place, which Back returns from', async ({
  page,
}) => {
  await serve(page, WORLD)
  await serveTask(page)
  const bars = await openList(page, 1440, { by: 'work_item' })
  await bars.locator('[data-all]').click()
  const every = await panelNamed(page, 'Details: Task: every value')
  const rows = every.locator('[data-detail="all"] tbody').getByRole('row')
  await expect(rows).toHaveCount(VALUES)
  await every.getByRole('textbox', { name: 'Find by name' }).fill('part 1')
  // Parts 1 and 10 to 13 of the release notes.
  await expect(rows).toHaveCount(5)
  const part = 'MAIN-2 Write the release notes, part 1'
  await every.getByRole('link', { name: part }).click()
  const one = await panelNamed(page, `Details: ${part}`)
  await expect(one.locator('[data-part="figures"]')).toBeVisible()
  await expect
    .poll(() => path(page))
    .toBe(pageAt(withDetail({ by: 'work_item' }, 'work_item', task(2, '').id)))
  await page.goBack()
  await expect(every).toBeVisible()
  await expect(rows).toHaveCount(VALUES)
})
