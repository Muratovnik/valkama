/**
 * How high the overview's chart stands, and the three figures over it, in the real app. The
 * oracle is the requirement: the chart's drawing field — where its columns stand, without the
 * scale's figures and the steps' names — is never lower than 200 pixels at 1440 by 900 with
 * none, one or two changes of the accounts on the chart; where the panel lacks the room it
 * scrolls instead of the chart shrinking, a tall window's room goes to the chart, and a second
 * look at the same box changes nothing. Each of the three figures draws a small trend of its own
 * measure, said in words, and nothing moves as the pointer passes them. Each run prints what it
 * measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { noTask } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { NIGHT_GROUP, WORK_GROUP } from '../fixtures/quotaSpent.ts'
import { LEGEND_SERIES, pageAt, record, serve } from './analyticsPage.ts'
import { openOverview, TASKS, worked, WORLD } from './overviewPage.ts'
import { test } from './test.ts'

/** The chart's plot and the room the panel leaves under the cards, inside its padding. */
async function plotAndRoom(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    const plot = document.querySelector('.overview-chart .period-field')
    const cards = document.querySelector('.overview-cards')
    if (!panel || !plot || !cards) throw new Error('no overview')
    const { x, y, width, height } = plot.getBoundingClientRect()
    const padding = Number.parseFloat(getComputedStyle(panel).paddingBlockEnd)
    const room =
      panel.getBoundingClientRect().bottom - padding - cards.getBoundingClientRect().bottom
    const scrolls = panel.scrollHeight > panel.clientHeight
    return { plot: { x, y, width, height }, room: Math.round(room), scrolls, padding }
  })
}

/** The height of the chart's drawing field. */
async function fieldHeight(page: Page) {
  const measured = await plotAndRoom(page)
  return measured.plot.height
}

/**
 * Whether the field gives the panel's box what it has: the panel scrolls with the field at its
 * floor, or the field takes the room the cards leave, to the pixel. A box short of the floor by
 * no more than the air under the cards gives up that air instead of scrolling by it alone, the
 * field at its floor and the cards whole inside the panel's edge (the overview fit's spec).
 */
const fillsOrScrolls = (measured: Awaited<ReturnType<typeof plotAndRoom>>) => {
  const atFloor = Math.round(measured.plot.height) === 200
  if (measured.scrolls) return atFloor
  if (measured.room >= 0) return measured.room < 2
  return atFloor && -measured.room <= measured.padding
}

test('a tall window gives the room under the cards to the plot, and 1440 by 900 keeps 200 pixels of it', async ({
  page,
}, info) => {
  await serve(page, WORLD)
  await openOverview(page, 1440, 900)
  const usual = await plotAndRoom(page)
  await record(info, 'usual', usual)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect.poll(async () => fieldHeight(page)).toBeGreaterThanOrEqual(280)
  const tall = await plotAndRoom(page)
  await record(info, 'tall', tall)
  expect(tall.room).toBeGreaterThanOrEqual(0)
  expect(tall.room).toBeLessThan(40)
  expect(tall.scrolls).toBe(false)
  const page1920 = await page.evaluate(() => [
    document.documentElement.scrollHeight,
    document.documentElement.clientHeight,
  ])
  expect(page1920[0]).toBe(page1920[1])
  // At 1440 by 900 the plot, across the panel, keeps at least 200 pixels.
  expect(Math.round(usual.plot.height)).toBeGreaterThanOrEqual(200)
  expect(Math.round(usual.plot.width)).toBeGreaterThanOrEqual(800)
})

/**
 * A full week: five tasks, models, roles and projects in each card, no task and a sixth task
 * in the chart's legend, under the accounts `accountOf` gives each stretch by its day.
 */
const fullWeek = (accountOf: (day: number, index: number) => typeof WORK_GROUP): TimedStretch[] => [
  ...[0, 1, 2, 3, 4, 5].map((index): TimedStretch => {
    const day = [9, 10, 10, 11, 11, 9][index] ?? 9
    const stretch = worked(
      day,
      TASKS[index],
      [`model-${(index % 5) + 1}`, `role-${(index % 5) + 1}`, `project-${(index % 5) + 1}`],
      6 - index,
    )
    return { ...stretch, group: { ...stretch.group, ...accountOf(day, index) } }
  }),
  worked(10, noTask, ['model-1', 'role-1', 'project-1'], 2),
  worked(2, TASKS[0], ['model-1', 'role-1', 'project-1'], 4),
]

/**
 * The accounts of a full week changing none, one or two times: one account all week; the other
 * from Wednesday; one on Monday, both on Tuesday, the other on Wednesday.
 */
const CHANGES = [
  { changes: 0, world: fullWeek(() => WORK_GROUP) },
  { changes: 1, world: fullWeek((day) => (day === 11 ? NIGHT_GROUP : WORK_GROUP)) },
  {
    changes: 2,
    world: fullWeek((day, index) => (day === 11 || index === 2 ? NIGHT_GROUP : WORK_GROUP)),
  },
]

/** The frames a second look is given, a second of them at sixty a second. */
const LOOK_FRAMES = 60

/**
 * How many times the overview's panel rewrote its own style over `LOOK_FRAMES` frames: the
 * field's height is set there, so a second look at the same box that changed it would show here.
 * Counted in the page's frames, which a box measured again is drawn in, and not in time.
 */
const restyles = (page: Page) =>
  page.evaluate(
    (frames) =>
      new Promise<number>((resolve) => {
        const panel = document.querySelector('.overview-panel')
        if (!panel) throw new Error('no overview')
        let count = 0
        const watch = new MutationObserver((changes) => {
          count += changes.length
        })
        watch.observe(panel, { attributes: true, attributeFilter: ['style'] })
        let left = frames
        const step = () => {
          left -= 1
          if (left > 0) {
            requestAnimationFrame(step)
            return
          }
          watch.disconnect()
          resolve(count)
        }
        requestAnimationFrame(step)
      }),
    LOOK_FRAMES,
  )

for (const { changes, world } of CHANGES)
  test(`at 1440 by 900 the chart's field keeps 200 pixels with ${changes} account changes, and the panel scrolls instead`, async ({
    page,
  }, info) => {
    await serve(page, world)
    const panel = await openOverview(page, 1440, 900)
    // The tasks', the models' and the projects' cards (`OverviewPanel`), five rows each.
    const cards = panel.locator('[data-card]')
    await expect(cards).toHaveCount(3)
    for (const card of await cards.all()) await expect(card.locator('.ranked-row')).toHaveCount(5)
    // The lines up the plot; the legend keys the line once, apart from them.
    await expect(panel.locator('[data-region="field"] [data-mark="change"]')).toHaveCount(changes)
    // Across the panel the legend takes one line.
    const legendLines = await panel
      .locator(`.overview-chart ${LEGEND_SERIES}`)
      .evaluateAll(
        (keys) => new Set(keys.map((key) => Math.round(key.getBoundingClientRect().top))).size,
      )
    expect(legendLines).toBe(1)
    await expect.poll(async () => fieldHeight(page)).toBeGreaterThanOrEqual(200)
    const measured = await plotAndRoom(page)
    const box = await panel.evaluate((element) => [element.scrollHeight, element.clientHeight])
    // A second look at the same box changes nothing: the field holds still, and so does its style.
    const again = await restyles(page)
    const settled = await plotAndRoom(page)
    await record(info, `field with ${changes} account changes`, {
      ...measured,
      box,
      legendLines,
      restyles: again,
    })
    expect(Math.round(measured.plot.height)).toBeGreaterThanOrEqual(200)
    expect(settled.plot.height).toBe(measured.plot.height)
    expect(again).toBe(0)
    // What the panel lacks the room for, it scrolls, the field at its floor; the document never does.
    expect(fillsOrScrolls(measured), 'the field fills the box or the panel scrolls').toBe(true)
    const documentBox = await page.evaluate(() => [
      document.documentElement.scrollHeight,
      document.documentElement.clientHeight,
    ])
    expect(documentBox[0]).toBe(documentBox[1])
  })

/** Opens the overview of the full week at a window, its days drawn as their chart. */
async function fieldAt(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await page.goto(pageAt({ open: 'section' }))
  const days = page.locator('.analytics-panel .spending-days')
  await expect(days).toBeVisible()
  await expect(days).toHaveAttribute('data-shown', 'chart')
  await expect(days.locator('.period-field')).toBeVisible()
  await expect.poll(async () => fieldHeight(page)).toBeGreaterThanOrEqual(200)
  const measured = await plotAndRoom(page)
  const nav = await page.evaluate(() => {
    const shell = document.querySelector('.app-nav-frame')
    return Math.round(shell?.getBoundingClientRect().width ?? 0)
  })
  return { width, height, field: Math.round(measured.plot.height), scrolls: measured.scrolls, nav }
}

test('the chart’s field keeps its floor at every supported window', async ({ page }, info) => {
  await serve(page, CHANGES[2]?.world)
  const fields = []
  for (const [width, height] of [
    [390, 844],
    [1024, 768],
    [1440, 900],
    [1920, 1080],
  ] as const)
    fields.push(await fieldAt(page, width, height))
  await record(info, 'field heights', fields)
  for (const field of fields)
    expect(field.field, `${field.width}×${field.height}`).toBeGreaterThanOrEqual(200)
})

/** Where every part of the three figures and the chart's field stands, to the pixel. */
const figuresLayout = (page: Page) =>
  page.evaluate(() => {
    const parts = [
      ...document.querySelectorAll(
        '.spending-tiles .segmented-option, .spending-tiles .segmented-option *',
      ),
      ...document.querySelectorAll('.overview-chart .period-field, .overview-cards'),
    ]
    return parts.map((part) => {
      const { x, y, width, height } = part.getBoundingClientRect()
      return [x, y, width, height].map((side) => Math.round(side)).join(',')
    })
  })

test('each of the three figures draws its own trend, and nothing moves under the pointer', async ({
  page,
}, info) => {
  await serve(page, CHANGES[2]?.world)
  const panel = await openOverview(page, 1440, 900)
  const cells = panel.getByRole('radiogroup', { name: 'What the charts show' }).getByRole('radio')
  await expect(cells).toHaveCount(3)
  const trends = []
  for (const cell of await cells.all()) {
    const trend = cell.getByRole('img')
    await expect(trend).toHaveCount(1)
    // The week to Wednesday: a column's place for each of its days.
    await expect(trend.locator('.mini-trend-period')).toHaveCount(3)
    const label = (await trend.getAttribute('aria-label')) ?? ''
    expect(label).toMatch(/ per day from .+ to .+: highest .+, last .+ running$/u)
    trends.push({ label, box: await trend.boundingBox() })
  }
  await record(info, 'trends', trends)
  // Their own measures, not the one chosen: three different sentences, one height.
  expect(new Set(trends.map((trend) => trend.label)).size).toBe(3)
  expect(new Set(trends.map((trend) => Math.round(trend.box?.height ?? 0))).size).toBe(1)

  await page.mouse.move(0, 0)
  const resting = await figuresLayout(page)
  for (const cell of await cells.all()) {
    await cell.hover()
    expect(await figuresLayout(page)).toEqual(resting)
    await cell.locator('.mini-trend').hover()
    expect(await figuresLayout(page)).toEqual(resting)
  }
})
