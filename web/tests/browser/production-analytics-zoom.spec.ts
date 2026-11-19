/**
 * A span of the page's own taken from a chart, in the real app over the browser double. A frame
 * dragged over three hours of «Today» sets the page's period to those three hours, its section
 * kept, as a new place in the history: the chart holds those three and no other, and Back is
 * «Today» again. Shift and an arrow stretch the same frame from the hour the keyboard stands on.
 * An hour of «Today» pressed without a drag narrows the view to that hour, broken down by task,
 * and Back returns «Today».
 *
 * A window of the quota has a span of its own instead. A running window opens on its start to now
 * and the forecast past it, so its readings take at least 60 % of the plot's width, and a frame
 * dragged along its step line narrows that line alone: the page's address, its other lines and
 * its period stay as they were, and the switch takes the line back to its whole window.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openReport, pageAt, record } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { NOW, serveLive } from './liveDouble.ts'
import { TODAY } from './served/analyticsZoom.ts'
import { test } from './test.ts'
const TODAY_ADDRESS = pageAt({ period: 'today' })
/** The three hours from ten, as the page's own period. */
const SPAN_ADDRESS = pageAt({ period: 'custom', from: '2026-11-11T10:00', to: '2026-11-11T13:00' })
/** The hour from ten pressed: that hour alone, broken down by task. */
const HOUR_ADDRESS = pageAt({
  period: 'custom',
  from: '2026-11-11T10:00',
  to: '2026-11-11T11:00',
  by: 'work_item',
})

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/** The overview chart's periods, by the hour each starts at. */
const hours = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.spending-days .period-slot')].map((slot) =>
      new Date(slot.dataset.key ?? '').getHours(),
    ),
  )

/** The middle of the overview chart's period at `index`, in the window. */
async function middleOf(page: Page, index: number) {
  const box = await page.locator('.spending-days .period-slot').nth(index).boundingBox()
  if (!box) throw new Error(`no period ${index}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Drags the mouse from one point to another in steps, as a hand does. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

async function openToday(page: Page, width: number) {
  await page.clock.install({ time: NOW })
  await serveLive(page, TODAY)
  const analytics = await openReport(page, width, TODAY_ADDRESS)
  await expect(analytics.locator('.spending-days .period-slot')).toHaveCount(24)
  await page.evaluate(() => document.fonts.ready)
  return analytics
}

/** Back from the span is «Today» again, its whole day by the hour. */
async function expectTodayBack(page: Page, analytics: Locator) {
  await page.goBack()
  await expect.poll(() => path(page)).toBe(TODAY_ADDRESS)
  await expect(analytics.locator('.spending-days .period-slot')).toHaveCount(24)
}

for (const width of [1280, 1440])
  test(`a frame dragged over three hours of «Today» shows those three, and Back is «Today» at ${width}px`, async ({
    page,
  }, info) => {
    const analytics = await openToday(page, width)
    const opened = await page.evaluate(() => history.length)
    const [from, to] = [await middleOf(page, 10), await middleOf(page, 12)]
    await drag(page, from, to)
    await expect.poll(() => path(page)).toBe(SPAN_ADDRESS)
    expect(await page.evaluate(() => history.length)).toBe(opened + 1)
    await expect(analytics.locator('.spending-days .period-slot')).toHaveCount(3)
    expect(await hours(page)).toEqual([10, 11, 12])
    // The section stayed the overview, and the frame pressed no hour on its way.
    await expect(analytics.locator('.overview-chart')).toBeVisible()
    await analytics
      .locator('.spending-days')
      .screenshot(shot(info, `analytics-zoom-frame-${width}.png`))
    await record(info, `zoom frame ${width}`, {
      from,
      to,
      path: path(page),
      hours: await hours(page),
    })
    await expectTodayBack(page, analytics)
  })

test('Shift and an arrow stretch the same three hours from the keyboard', async ({ page }) => {
  const analytics = await openToday(page, 1440)
  const ten = analytics.locator('.spending-days .period-column').nth(10)
  await ten.focus()
  await page.keyboard.down('Shift')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  // While Shift is held the frame stands over the three hours, and the view is still «Today».
  const frame = analytics.locator('.spending-days .period-spans .axis-frame')
  await expect(frame).toBeVisible()
  const covered = await page.evaluate(() => {
    const box = document.querySelector('.spending-days .axis-frame')?.getBoundingClientRect()
    const slots = [...document.querySelectorAll('.spending-days .period-slot')]
    return slots.flatMap((slot, index) => {
      const own = slot.getBoundingClientRect()
      return box && own.left >= box.left - 1 && own.right <= box.right + 1 ? [index] : []
    })
  })
  expect(covered).toEqual([10, 11, 12])
  expect(path(page)).toBe(TODAY_ADDRESS)
  await page.keyboard.up('Shift')
  await expect.poll(() => path(page)).toBe(SPAN_ADDRESS)
  await expect(analytics.locator('.spending-days .period-slot')).toHaveCount(3)
  expect(await hours(page)).toEqual([10, 11, 12])
  await expectTodayBack(page, analytics)
})

test.describe('an hour pressed, in Russian', () => {
  test.use({ locale: 'ru-RU' })

  test('an hour of «Сегодня» pressed narrows the view to that hour, and Back is «Сегодня»', async ({
    page,
  }) => {
    const analytics = await openToday(page, 1440)
    const ten = analytics.locator('.spending-days .period-column').nth(10)
    await expect(ten).toHaveAttribute('aria-label', 'Показать задачи за 10:00–11:00')
    const box = await ten.boundingBox()
    // A period that acts keeps the reach a pointer is asked to hit.
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24)
    // Above its stack, where the press is the hour's and not its task's.
    await ten.click({ position: { x: (box?.width ?? 0) / 2, y: 4 } })
    await expect.poll(() => path(page)).toBe(HOUR_ADDRESS)
    // By the minute: the hour's sixty minutes, broken down by task in the task's section.
    await expect(analytics.locator('.spending-days .period-slot')).toHaveCount(60)
    await expect(
      analytics.locator('.analytics-rail-entry[data-section="work_item"][aria-current="page"]'),
    ).toHaveCount(1)
    await page.goBack()
    await expect.poll(() => path(page)).toBe(TODAY_ADDRESS)
    await expect(
      analytics.locator('.period-bar-periods').getByRole('radio', { name: 'Сегодня' }),
    ).toBeChecked()
    await expect(analytics.locator('.spending-days .period-slot')).toHaveCount(24)
  })
})

/**
 * For every running window of the quota, what share of its plot's width its readings take: from
 * the plot's start to where the line ends, now, and from its first reading to now.
 */
const readingShares = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.quota-window')].flatMap((window) => {
      const field = window.querySelector('.step-field')?.getBoundingClientRect()
      const line = window.querySelector('.step-path')?.getBoundingClientRect()
      const running = window.querySelector('.step-views [role="radio"]') !== null
      if (!field || !line || !running) return []
      return [
        {
          window: `${window.closest('.quota-account')?.querySelector('.quota-account-name')?.textContent?.trim()} ${window.dataset.window}`,
          toNow: (line.right - field.left) / field.width,
          fromFirst: line.width / field.width,
        },
      ]
    }),
  )

async function openQuota(page: Page, width: number, height: number) {
  await page.clock.install({ time: NOW })
  await serveLive(page, TODAY)
  await page.setViewportSize({ width, height })
  await page.goto(pageAt({ by: 'quota_week' }))
  await expect(page.locator('.quota-account')).toHaveCount(4)
  await page.evaluate(() => document.fonts.ready)
}

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
] as const)
  test(`a running window's readings take at least 60 % of its plot at ${width}×${height}`, async ({
    page,
  }, info) => {
    await openQuota(page, width, height)
    const shares = await readingShares(page)
    await record(info, `zoom quota ${width}`, shares)
    // Each account's week and the seat's week: every running week of the answer.
    expect(shares.length).toBeGreaterThanOrEqual(3)
    for (const share of shares) {
      expect(share.toNow, share.window).toBeGreaterThanOrEqual(0.6)
    }
    await page
      .locator('.quota-window')
      .first()
      .screenshot(shot(info, `analytics-zoom-quota-${width}.png`))
  })

/** What the axis of each window's step line names, its two ends, in the panel's order. */
const axes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.quota-window')].map((window) =>
      [...window.querySelectorAll('.step-axis span')].map((end) => end.textContent),
    ),
  )

/** What the axis of the first window's step line names. */
const firstAxis = async (page: Page) => {
  const [first] = await axes(page)
  return first
}

/** What the axes of every window's step line but the first name. */
const otherAxes = async (page: Page) => {
  const [, ...others] = await axes(page)
  return others
}

/** The middle line of the first window's step line, from a fifth of its width to a half. */
async function alongFirstLine(page: Page) {
  const field = await page.locator('.quota-window').first().locator('.step-field').boundingBox()
  if (!field) throw new Error('no step line')
  const y = field.y + field.height / 2
  return [
    { x: field.x + field.width * 0.2, y },
    { x: field.x + field.width * 0.5, y },
  ] as const
}

test('a frame along a step line narrows that line alone, and the switch takes it back', async ({
  page,
}) => {
  await openQuota(page, 1440, 900)
  const address = path(page)
  const [first, ...others] = await axes(page)
  const [from, to] = await alongFirstLine(page)
  await drag(page, from, to)
  // The line runs between the frame's moments now; the page and every other line did not move.
  await expect.poll(() => firstAxis(page)).not.toEqual(first)
  expect(path(page)).toBe(address)
  expect(await otherAxes(page)).toEqual(others)
  const radios = page.locator('.quota-window').first().locator('.step-views [role="radio"]')
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'false')
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'false')
  await radios.nth(0).click()
  await expect.poll(() => firstAxis(page)).toEqual(first)
})
