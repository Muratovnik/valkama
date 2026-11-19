/**
 * What the Analytics page does past its charts, in the real app at the widths it is used at: the
 * table of the breakdown beside the period before, its download, and the way from any bar or day
 * to a task's card.
 *
 * The table stands whole in both languages, scrolls sideways inside its own frame with its row
 * names kept in view, and says once when the period before was not read. The download is offered
 * under a name that says the period, as UTF-8 with a byte order mark. A bar of a model opens the
 * model's side panel, whose «Add to filter» adds it to the page's filter with the section kept,
 * and a day pressed by keyboard or by mouse beside its coloured stack narrows the view to the
 * day, each as a new place
 * in the history, while a segment of the stack acts for its own model as its bar does, so Back
 * returns, as a section opened from a card or the rail does, and as a split chosen in a section's
 * heading does, while the period and the measure change the place in hand; the task's bar or row
 * then opens the task's panel, whose «Open the card» opens the card over the page, its address
 * keeping the view with the panel and naming the card, and the opening is counted once. Each run
 * prints what it measured.
 */
import { readFile } from 'node:fs/promises'

import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import {
  boxes,
  expectNamesInView,
  expectWhole,
  measure,
  NARROW_FRAME,
  openReport,
  pageAt,
  record,
  scrolledNames,
  serve,
  serveTask,
} from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { drawLined } from './drawnViews.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { globalScope, workItem, workItemRef } from './planningFixtures.ts'
import { IMPORT, WORLD } from './served/analyticsActions.ts'
import { test } from './test.ts'

const WIDTHS = [1440, 1024, 390]
/** A phone shows the section, not the list of sections, at each address of a walk. */
const shownAt = (width: number, state: Record<string, string>) =>
  width < NARROW_FRAME ? { ...state, open: 'section' } : state

/** Where the app takes a press on the task: its card over the page, which keeps its view. */
const cardOver = (state: Record<string, string>) =>
  serializePlatformRoute({
    module_id: 'analytics',
    scope: globalScope,
    entity: planningWorkItemEntity(workItemRef),
    state,
  })

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/**
 * The keys that bring the focus to `target`, as a keyboard reaches it: Tab from control to
 * control, past a chart's legend entries that act, and on a chart's columns, one stop for Tab,
 * Home to its first column and the right arrow along it.
 */
async function tabTo(page: Page, target: Locator) {
  const keys: string[] = []
  const chart = await target.evaluate((element) => element.closest('.period-columns') !== null)
  let homed = false
  for (let press = 1; press <= 120; press += 1) {
    const inChart =
      chart &&
      (await page.evaluate(() => document.activeElement?.hasAttribute('data-cell') ?? false))
    const along = homed ? 'ArrowRight' : 'Home'
    const key = inChart ? along : 'Tab'
    homed ||= inChart
    keys.push(key)
    await page.keyboard.press(key)
    if (await target.evaluate((element) => element === document.activeElement))
      return `${keys.filter((one) => one === 'Tab').length} Tab, then ${keys.filter((one) => one !== 'Tab').join(', ') || 'nothing else'}`
  }
  throw new Error(`the keys never reached the control: ${keys.join(' ')}`)
}

/**
 * The focused control: whether its ring shows, and where it and the ring stand. The one control
 * a table row holds has its ring drawn by the row, inside the row's cells (`rowStates.css`), so
 * there the ring and its box are the row's, as much of it as the table's frame shows: a table
 * wider than its frame scrolls in it, and its row's name stays at the frame's start. A row of
 * several controls, a day of the day table, rings the focused one's cell alone, and there the
 * ring and its box are that cell's.
 */
const focusRing = (target: Locator) =>
  target.evaluate((element) => {
    const style = getComputedStyle(element)
    const row = element.closest('.row-state.tabular')
    const cells = row ? [...row.children] : []
    const ringed = cells.filter((cell) => getComputedStyle(cell).boxShadow.includes('inset'))
    // The row when every cell draws a part of the ring, the one cell when only it does.
    const whole = ringed.length > 0 && ringed.length === cells.length
    const byRow = whole ? row : (ringed[0] ?? null)
    const rowRing = Number.parseFloat(style.getPropertyValue('--size-focus-ring'))
    const drawn = (byRow ?? element).getBoundingClientRect()
    const frame = byRow?.closest('[data-region="table-frame"]')?.getBoundingClientRect()
    const x = frame ? Math.max(drawn.left, frame.left) : drawn.left
    const width = (frame ? Math.min(drawn.right, frame.right) : drawn.right) - x
    const { y, height } = drawn
    const ownRing = style.outlineStyle === 'none' ? 0 : Number.parseFloat(style.outlineWidth)
    return {
      visible: element.matches(':focus-visible'),
      ring: byRow ? rowRing : ownRing,
      offset: byRow ? -rowRing : Number.parseFloat(style.outlineOffset),
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
      en: ['The period before was not loaded, so this table shows this period alone.'],
      ru: ['Предыдущий период не загружен, поэтому таблица показывает только этот период.'],
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
          const [frame] = await boxes(page, '.spending-table [data-region="table-frame"]')
          const label = `analytics table ${lang} ${name} ${width}`
          await record(info, label, {
            pageScroll: measured.pageScroll,
            table: measured.sections.at(-1),
            frame,
            download,
            names: names.at(-1),
            heading: await table.locator('h3').textContent(),
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
  test(`a model's bar and a day each lead to a task's card through its panel at ${width}px`, async ({
    page,
  }, info) => {
    await serve(page, WORLD)
    const uses = await serveTask(page)
    const shown = (state: Record<string, string>) => shownAt(width, state)
    const at = (state: Record<string, string>) => pageAt(shown(state))
    const byModel = at({ by: 'model' })
    const analytics = await openReport(page, width, byModel)
    const bars = analytics.locator('.spending-bars')
    await drawLined(bars)

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

    // By pointer: model-a, then its one task. A bar is named by its action, and a row of the
    // table a narrow page shows first by the value it heads.
    await bars.getByRole('button', { name: /^(Details of )?model-a$/u }).click()
    // Its panel is a place of its own, and «Add to filter» in it adds the model to the page's
    // filter with the section kept, which the address names.
    const modelPanel = at({ by: 'model', detail: '{"by":"model","value":"model-a"}' })
    await expect.poll(() => path(page)).toBe(modelPanel)
    await page
      .getByRole('dialog', { name: 'Details: model-a' })
      .getByRole('button', { name: 'Add to filter' })
      .click()
    const filtered = at({ by: 'model', filters: '{"model":["model-a"]}' })
    await expect.poll(() => path(page)).toBe(filtered)
    await page.goBack()
    await expect.poll(() => path(page)).toBe(modelPanel)
    await page.goBack()
    await expect.poll(() => path(page)).toBe(byModel)
    await page.goForward()
    await page.goForward()
    await expect.poll(() => path(page)).toBe(filtered)
    // The tasks of the model, its filter kept.
    await openReport(page, width, at({ by: 'work_item', filters: '{"model":["model-a"]}' }))
    await drawLined(bars)
    // The task's bar is named by its action, and its row in the table by the task it heads.
    const task = 'MAIN-264 Import the planning documents'
    const link = bars.getByRole('link', { name: new RegExp(`^(Details of )?${task}$`, 'u') })
    await expect(link).toHaveAttribute('href', '/open/MAIN-264')
    await link.click()
    const taskDetail = JSON.stringify({ by: 'work_item', value: IMPORT.id })
    const taskPanel = page.getByRole('dialog', { name: `Details: ${task}` })
    await taskPanel.getByRole('link', { name: 'Open the card' }).click()
    await expect
      .poll(() => path(page))
      .toBe(
        cardOver(shown({ by: 'work_item', filters: '{"model":["model-a"]}', detail: taskDetail })),
      )
    await expect(page.locator('.drawer')).toContainText(workItem.title)
    await expect.poll(() => uses.filter((kind) => kind === 'task_open')).toHaveLength(1)

    // By pointer on a day drawn as a chart at every width, Tuesday: its coloured stack acts for
    // its model, as the model's bar does, and the day itself beside the stack for the day.
    await openReport(page, width, byModel)
    const days = analytics.locator('.spending-days')
    // A narrow page shows the days as a table first; the section's own control draws them.
    await days.locator('.segmented-option', { hasText: 'Chart' }).click()
    await expect(days).toHaveAttribute('data-shown', 'chart')
    const tuesdaySlot = days.locator('.period-slot').nth(1)
    const stack = tuesdaySlot.locator('.period-segment').first()
    await stack.scrollIntoViewIfNeeded()
    const pressedAt = await stack.boundingBox()
    const point = {
      x: (pressedAt?.x ?? 0) + (pressedAt?.width ?? 0) / 2,
      y: (pressedAt?.y ?? 0) + (pressedAt?.height ?? 0) / 2,
    }
    // The press lands on the stack itself, not on the day around it.
    const landsOn = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('period-segment') ?? false,
      point,
    )
    expect(landsOn).toBe(true)
    await page.mouse.click(point.x, point.y)
    await expect.poll(() => path(page)).toBe(modelPanel)
    await page.keyboard.press('Escape')
    await expect.poll(() => path(page)).toBe(byModel)
    await expect(days).toHaveAttribute('data-shown', 'chart')
    // The focus is back on the segment, whose hint the key brings; the next Escape closes it.
    await expect(stack).toBeFocused()
    const hint = page.getByRole('tooltip')
    await expect(hint).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(hint).toHaveCount(0)
    expect(path(page)).toBe(byModel)
    // Over the stack, where no segment stands, the press is the day's own.
    const dayAt = await tuesdaySlot.locator('.period-column').boundingBox()
    const dayPoint = { x: (dayAt?.x ?? 0) + (dayAt?.width ?? 0) / 2, y: (dayAt?.y ?? 0) + 2 }
    const landsOnDay = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('period-column') ?? false,
      dayPoint,
    )
    expect(landsOnDay).toBe(true)
    await page.mouse.click(dayPoint.x, dayPoint.y)
    const tuesdayAlone = at({
      period: 'custom',
      from: '2026-11-10',
      to: '2026-11-10',
      by: 'work_item',
    })
    await expect.poll(() => path(page)).toBe(tuesdayAlone)

    // By keyboard: Tuesday, then its one task from the table. A day is named by its action in
    // the chart and by its date in the table, which a narrow page shows first.
    await openReport(page, width, byModel)
    const tuesday = analytics
      .locator('.spending-days')
      .getByRole('button', { name: /Tuesday, November 10$/u })
    const dayPresses = await tabTo(page, tuesday)
    const dayRing = await focusRing(tuesday)
    await page.keyboard.press('Enter')
    await expect.poll(() => path(page)).toBe(tuesdayAlone)
    const row = analytics.locator('.spending-table').getByRole('link', { name: task })
    const rowPresses = await tabTo(page, row)
    const rowRing = await focusRing(row)
    await page.keyboard.press('Enter')
    const tuesdayTask = shown({
      period: 'custom',
      from: '2026-11-10',
      to: '2026-11-10',
      by: 'work_item',
      detail: taskDetail,
    })
    await expect.poll(() => path(page)).toBe(pageAt(tuesdayTask))
    const card = taskPanel.getByRole('link', { name: 'Open the card' })
    const cardPresses = await tabTo(page, card)
    await page.keyboard.press('Enter')
    await expect.poll(() => path(page)).toBe(cardOver(tuesdayTask))
    await expect(page.locator('.drawer')).toContainText(workItem.title)
    await expect.poll(() => uses.filter((kind) => kind === 'task_open')).toHaveLength(2)

    await record(info, `analytics two presses ${width}`, {
      cursor,
      areas,
      pressedAt,
      dayPresses,
      dayRing,
      rowPresses,
      rowRing,
      cardPresses,
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

test('a section opened from a card or the rail, and its split, are places Back returns from; the period and measure are not', async ({
  page,
}, info) => {
  await serve(page, WORLD)
  await page.setViewportSize({ width: 1440, height: 900 })
  // A fresh tab: the page is the first place of its history.
  await page.goto(pageAt())
  const analytics = page.locator('.analytics-page')
  const models = analytics.locator('.overview-top[data-card="model"] .overview-top-open')
  await expect(models).toBeVisible()
  const length = () => page.evaluate(() => history.length)
  const opened = await length()

  // The period and the measure change the view in place.
  await analytics
    .locator('.period-bar-periods .segmented-option', { hasText: 'Past 4 weeks' })
    .click()
  const weeks = pageAt({ period: 'weeks4' })
  await expect.poll(() => path(page)).toBe(weeks)
  const tokens = analytics.locator('.spending-tiles .segmented-option', {
    has: page.locator('[data-measure="tokens"]'),
  })
  await tokens.click()
  const weeksTokens = pageAt({ period: 'weeks4', measure: 'tokens' })
  await expect.poll(() => path(page)).toBe(weeksTokens)
  expect(await length(), 'the period and the measure add no step').toBe(opened)

  // A card's heading opens its section as a new place: Back is the overview of this page.
  await models.click()
  await expect
    .poll(() => path(page))
    .toBe(pageAt({ period: 'weeks4', by: 'model', measure: 'tokens' }))
  expect(await length()).toBe(opened + 1)
  await page.goBack()
  await expect.poll(() => path(page)).toBe(weeksTokens)
  await expect(models).toBeVisible()

  // A tile of the rail does the same; a split chosen in the section's heading is a step of its
  // own, so Back takes the split away before it leaves the section.
  await analytics.locator('.analytics-rail [data-section="work_item"]').click()
  const tasks = pageAt({ period: 'weeks4', by: 'work_item', measure: 'tokens' })
  await expect.poll(() => path(page)).toBe(tasks)
  await analytics.locator('.dimension-section .dimension-split .choice-trigger').click()
  await page.getByRole('option', { name: 'Model' }).click()
  await expect
    .poll(() => path(page))
    .toBe(pageAt({ period: 'weeks4', by: 'work_item', measure: 'tokens', across: 'model' }))
  const steps = await length()
  expect(steps, 'one step for the section, one for the split').toBe(opened + 2)
  await page.goBack()
  await expect.poll(() => path(page)).toBe(tasks)
  await page.goBack()
  await expect.poll(() => path(page)).toBe(weeksTokens)
  await record(info, 'analytics history', { opened, steps })
})
