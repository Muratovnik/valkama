/**
 * The overview of the Analytics page in the real app, where the page opens. The oracle is the
 * requirement: its three figures, the period's chart across the panel and, in one row under it,
 * what changed and the three cards of first values, in that order; how high the chart stands is
 * `production-analytics-overview-field`'s; a figure is the control that chooses the page's measure, pressed by more than a colour and from
 * the keyboard, and the address keeps it; the chart outlines the period before on its own scale;
 * what changed names the tasks that moved most by the measure's own units; a card's heading opens
 * its section and a row narrows the view; a single day stands as its hours. Each run prints what
 * it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { openOverview, TASKS, worked, WORLD } from './overviewPage.ts'
import { test } from './test.ts'

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

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

test('opens a plain address on the overview, its parts in order at 1440×900', async ({
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
  // The document stands still: whatever the overview lacks room for, its panel scrolls.
  expect(layout.document.scrollHeight).toBe(layout.document.clientHeight)
  expect(layout.panel.scrollTop).toBe(0)
  const count = (selector: string) => layout.parts.filter((part) => part.selector === selector)
  expect(count('.spending-tiles')).toHaveLength(1)
  expect(count('.spending-days')).toHaveLength(1)
  expect(count('.overview-changes')).toHaveLength(1)
  expect(count('.overview-top')).toHaveLength(3)
  for (const part of layout.parts) {
    expect(part.top, part.selector).toBeGreaterThanOrEqual(layout.panel.top)
    expect(part.right, part.selector).toBeLessThanOrEqual(layout.panel.right)
  }
  // The chart spans the panel as the figures do; what changed and the three cards stand in one
  // row under it, what changed first.
  const [tiles] = count('.spending-tiles')
  const [chart] = count('.spending-days')
  expect([chart?.left, chart?.right]).toEqual([tiles?.left, tiles?.right])
  const row = [...count('.overview-changes'), ...count('.overview-top')]
  expect(new Set(row.map((card) => card.top)).size).toBe(1)
  expect(row.every((card) => card.top > (chart?.bottom ?? 0))).toBe(true)
  expect(row[0]?.left).toBe(tiles?.left)
  await expect(panel.locator('.overview-cards h3')).toHaveText([
    'What changed',
    'Tasks',
    'Models',
    'Projects',
  ])
  // The page's read and the same days of the week before, the accounts, the steps of the week
  // before for the outline, and the rail's nine, one a dimension; the rail's tiles of tasks and
  // accounts are the page's own reads, and each card the page's own read is not by is the rail's
  // tile of that dimension, so neither asks again.
  expect(new Set(asked).size).toBe(asked.length)
  expect(asked).toHaveLength(11)
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
  await expect(panel.locator('.spending-days h3')).toHaveText('Tokens per day, by task')
  // The cards and what changed say the measure chosen.
  await expect(panel.locator('[data-card="model"] .ranked-value').first()).toHaveText('1.3M')
  await page.reload()
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true')
})

test('the chart outlines the period before on its own scale, in the legend, the hint and the table', async ({
  page,
}) => {
  await serve(page, WORLD)
  const panel = await openOverview(page, 1440, 900)
  const days = panel.locator('.spending-days')
  // Monday the 2nd held twelve hours, more than this Monday: the scale reaches past it.
  await expect(days.locator('.period-before')).toHaveCount(3)
  await expect(days.locator('.chart-mark[data-mark="outline"]')).toHaveText('period before')
  await expect(days.locator('.period-scale')).toContainText('15')
  const heights = await days.locator('.period-slot').evaluateAll((slots) =>
    slots.map((slot) => {
      const stack = slot.querySelector('.period-stack')?.getBoundingClientRect()
      // The period before is a short mark: its height on the plot is where its middle stands.
      const mark = slot.querySelector('.period-before')?.getBoundingClientRect()
      const floor = stack?.bottom ?? 0
      const before = mark ? floor - (mark.top + mark.bottom) / 2 : 0
      return { stack: Math.round(stack?.height ?? 0), before: Math.round(before) }
    }),
  )
  // Monday: eight hours against twelve; Wednesday so far: four hours against a quarter of one.
  expect(heights[0]?.before).toBeGreaterThan(heights[0]?.stack ?? 0)
  expect(heights[2]?.before).toBeLessThan(heights[2]?.stack ?? 0)
  // The latest day's hint says the figure of the period before in words.
  await expect(days.locator('.period-column[tabindex="0"]')).toHaveAttribute(
    'data-tooltip',
    /period before 15\smin/u,
  )
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
  // Four of the five that moved, by the most either way: MAIN-5, two hours from nothing, ties
  // with MAIN-3 and comes after it.
  await expect(up.locator('.overview-changes-name')).toHaveText([/^MAIN-2 /u, /^MAIN-3 /u])
  await expect(up.locator('.overview-changes-amount')).toHaveText([
    /^\+\s2\sh\s45\smin$/u,
    /^\+\s2\sh$/u,
  ])
  await expect(down.locator('.overview-changes-name')).toHaveText(['No task', /^MAIN-1 /u])
  await expect(down.locator('.overview-changes-amount')).toHaveText([/^−\s4\sh$/u, /^−\s4\sh$/u])
  // A task is a link to its card; work on no task leads nowhere.
  await expect(up.first()).toHaveAttribute('href', /MAIN-2/u)
  await expect(down.first()).not.toHaveAttribute('href')
  // An entry is two lines: the name across the card's width, the arrow and the amount under it;
  // the four no taller than a card's five rows.
  const entry = await up.first().evaluate((line) => {
    const box = (selector: string) => line.querySelector(selector)?.getBoundingClientRect()
    const name = box('.overview-changes-name')
    const amount = box('.overview-changes-amount')
    return {
      spare: Math.round(line.getBoundingClientRect().width - (name?.width ?? 0)),
      under: (amount?.top ?? 0) >= (name?.bottom ?? 0),
    }
  })
  expect(entry.under).toBe(true)
  expect(entry.spare).toBeLessThanOrEqual(16)
  const tallest = await panel.locator('.overview-cards > .level-body > *').evaluateAll((cards) =>
    cards.map((card) => {
      const last = card.lastElementChild?.getBoundingClientRect().bottom ?? 0
      return Math.round(last - card.getBoundingClientRect().top)
    }),
  )
  expect(tallest[0]).toBeLessThanOrEqual(Math.max(...tallest.slice(1)))
})

test('a card’s heading opens its section, and a row opens its value’s panel as a bar does', async ({
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
  await models.getByRole('button', { name: 'Details of model-b' }).click()
  await expect.poll(() => path(page)).toBe(pageAt({ detail: '{"by":"model","value":"model-b"}' }))
  const details = page.getByRole('dialog', { name: 'Details: model-b' })
  // Adding it to the filter keeps the overview.
  await details.getByRole('button', { name: 'Add to filter' }).click()
  await expect.poll(() => path(page)).toBe(pageAt({ filters: '{"model":["model-b"]}' }))
  await expect(page.locator('.analytics-rail [aria-current="page"]')).toHaveText(/^Overview/u)
  // A task's row is a link to its card, as a bar by task is.
  await page.goBack()
  await page.goBack()
  await expect(details).toBeHidden()
  await expect(panel.locator('[data-card="work_item"] a.ranked-line').first()).toHaveAttribute(
    'href',
    /MAIN-1/u,
  )
})

/** What holds focus: its tag, its name, whether its ring is drawn, and where it stands. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement
    return {
      tag: active?.tagName,
      name: active?.getAttribute('aria-label') ?? active?.textContent?.trim(),
      ringed: active?.matches(':focus-visible') ?? false,
      panel: active?.matches('.analytics-panel') ?? false,
      card: active?.closest<HTMLElement>('[data-card]')?.dataset.card ?? null,
    }
  })

/** A card's heading pressed by the pointer or by a key. */
const OPEN_BY = {
  click: (heading: Locator) => heading.click(),
  Enter: (heading: Locator) => heading.press('Enter'),
}

for (const key of ['click', 'Enter'] as const)
  test(`a card’s heading opened by ${key} takes focus to the section, and Back brings it to the heading`, async ({
    page,
  }, info) => {
    await serve(page, WORLD)
    const panel = await openOverview(page, 1440, 900)
    const heading = panel.locator('[data-card="model"]').getByRole('button', { name: 'Models' })
    await OPEN_BY[key](heading)
    await expect.poll(() => path(page)).toBe(pageAt({ by: 'model' }))
    await expect(panel.locator('.dimension-panel')).toBeVisible()
    const opened = await focused(page)
    await page.goBack()
    await expect(panel.locator('[data-card="model"]')).toBeVisible()
    const back = await focused(page)
    await record(info, `card-focus ${key}`, { opened, back })
    // The section's panel, named as the rail names the section, ringed only after a key.
    expect(opened).toEqual({
      tag: 'SECTION',
      name: 'Model',
      ringed: key === 'Enter',
      panel: true,
      card: null,
    })
    expect(back).toMatchObject({ tag: 'BUTTON', name: 'Models', card: 'model' })
  })

test('a section chosen on the rail keeps the focus on its tile', async ({ page }) => {
  await serve(page, WORLD)
  await openOverview(page, 1440, 900)
  const tile = page.locator('.analytics-rail [data-section="model"]')
  await tile.click()
  await expect.poll(() => path(page)).toBe(pageAt({ by: 'model' }))
  await expect(tile).toBeFocused()
})

test('a single day stands as its hours beside the day before', async ({ page }, info) => {
  await serve(page, WORLD)
  const day = pageAt({ period: 'custom', from: '2026-11-10', to: '2026-11-10' })
  const panel = await openOverview(page, 1440, 900, day)
  const days = panel.locator('.spending-days')
  await expect(days.locator('h3')).toHaveText('Agent time per hour, by task')
  await expect(days.locator('.period-slot')).toHaveCount(24)
  // The day is past, so each of its hours has begun and narrows the view to itself, as a day does.
  await expect(days.locator('button.period-column')).toHaveCount(24)
  // The day before worked at ten, the hour this day did too.
  await expect(days.locator('.period-slot[data-key*="T10:00"] .period-before')).toHaveCount(1)
  await expect(days.locator('.period-before')).toHaveCount(1)
  await page.screenshot(shot(info, 'analytics-overview-day-1440x900.png'))
})

/**
 * Three models this week: two of hours, named as clients name them, and one of seconds, whose
 * figure is the longest words of the card.
 */
const MODELS: TimedStretch[] = [
  worked(9, TASKS[0], ['claude-sonnet-5-5', 'main', 'alpha'], 3),
  worked(10, TASKS[1], ['claude-opus-5-5', 'main', 'alpha'], 2),
  { ...worked(11, TASKS[2], ['gpt-6.1-sol', 'main', 'alpha'], 0), spend: { seconds: 30 } },
  worked(2, TASKS[0], ['claude-sonnet-5-5', 'main', 'alpha'], 1),
]

test('a card’s figure is as wide as itself, and the name of its row takes the rest', async ({
  page,
}, info) => {
  await serve(page, MODELS)
  const panel = await openOverview(page, 1440, 900)
  const models = panel.locator('[data-card="model"]')
  await expect(models.locator('.ranked-value')).toHaveText([/^3\sh$/u, /^2\sh$/u, 'under a minute'])
  const rows = await models.locator('.ranked-line').evaluateAll((lines) =>
    lines.map((line) => {
      const label = line.querySelector('.ranked-label')
      const figure = line.querySelector('.ranked-value')?.getBoundingClientRect()
      return {
        name: label?.textContent ?? '',
        cut: !label || label.scrollWidth > label.clientWidth,
        nameWidth: Math.round(label?.getBoundingClientRect().width ?? 0),
        figureRight: Math.round(figure?.right ?? 0),
      }
    }),
  )
  await record(info, 'model rows', rows)
  // The long figure of the last row takes no room from the names above it.
  expect(rows.map((row) => [row.name, row.cut])).toEqual([
    ['claude-sonnet-5-5', false],
    ['claude-opus-5-5', false],
    ['gpt-6.1-sol', false],
  ])
  expect(rows[0]?.nameWidth).toBeGreaterThan(rows[2]?.nameWidth ?? 0)
  // The figures still end on one edge.
  expect(new Set(rows.map((row) => row.figureRight)).size).toBe(1)
})

for (const locale of ['en', 'ru'] as const)
  test(`a name cut in what changed says itself whole, and a whole one shows none, at 1440px in ${locale}`, async ({
    page,
  }, info) => {
    await page.addInitScript((lang) => localStorage.setItem('valkama-locale', lang), locale)
    await serve(page, WORLD)
    const panel = await openOverview(page, 1440, 900)
    const changes = panel.locator('.overview-changes')
    const cut = changes.locator('[data-way="up"]').first()
    const whole = changes.locator('[data-way="down"]').first()
    const name = cut.locator('.overview-changes-name')
    const measured = await name.evaluate((element) => ({
      text: element.textContent ?? '',
      shown: element.clientWidth,
      holds: element.scrollWidth,
    }))
    await record(info, `changes-cut-${locale}`, measured)
    expect(measured.holds, 'the name is cut').toBeGreaterThan(measured.shown)

    // Its words laid whole over the cut ones.
    const hint = page.locator('.whole-text')
    await page.mouse.move(0, 0)
    await name.hover()
    await expect(hint).toBeVisible()
    await expect(hint).toHaveText(measured.text)

    // A name the card holds whole has no hint: one shown already hands over at once, and goes.
    await whole.locator('.overview-changes-name').hover()
    await expect(hint).toBeHidden()

    // From the keyboard too: the task's link in focus says its name whole.
    await page.mouse.move(0, 0)
    await changes.locator('[data-way="up"]').nth(1).focus()
    await page.keyboard.press('Shift+Tab')
    await expect(cut).toBeFocused()
    await expect(hint).toBeVisible()
    await expect(hint).toHaveText(measured.text)
  })
