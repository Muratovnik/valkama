/**
 * The Analytics bar over a double whose usage reads can be refused, and what the bar's states
 * are measured by: where its controls stand, its height, the top under it and a failure's words
 * (`production-analytics-bar-states.spec.ts`).
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { pageAt } from './analyticsPage.ts'
import { NOW, serveLive } from './liveDouble.ts'
import { DAYS } from './served/analyticsBarStates.ts'

export const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))),
      ),
  )

/**
 * The page over the double, the newest record 9 s old, with every usage read refused while
 * `fail` says so.
 */
export async function serveFailing(page: Page, width: number) {
  await page.clock.install({ time: NOW })
  const double = await serveLive(page, DAYS)
  double.lastEventAt = new Date(NOW.getTime() - 9000)
  let failing = false
  // Registered last, so it is asked first: while failing, every read is refused.
  await page.route('**/api/analytics/usage?*', (route) =>
    failing
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      : route.fallback(),
  )
  await page.setViewportSize({ width, height: 900 })
  return (now: boolean) => {
    failing = now
  }
}

/** Opens a period with its answer on show and lets the bar settle. */
export async function open(page: Page, state: Record<string, string>) {
  await page.goto(pageAt(state))
  await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await frames(page)
}

/** Presses the read again while reads are refused, and waits for the bar to say so. */
export async function failRefresh(page: Page) {
  await page.locator('.analytics-refresh').click()
  await expect(page.locator('.refresh-failed')).toBeVisible()
  await frames(page)
}

/**
 * Where the bar's controls stand, its height, the top of what is under it, and the failure's
 * words: how wide they are drawn, and whether they are hidden from sight.
 */
export const barState = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => {
      const found = document.querySelector(selector)?.getBoundingClientRect()
      return found ? { left: found.left, top: found.top, right: found.right } : null
    }
    const words = document.querySelector('.refresh-failed-words')
    let said = 0
    if (words) {
      const hidden =
        getComputedStyle(words).clipPath !== 'none' || words.closest('.visually-hidden') !== null
      said = hidden ? 0 : words.getBoundingClientRect().width
    }
    const mark = document.querySelector('.analytics-bar-fresh-mark')
    return {
      window: document.documentElement.clientWidth,
      bar: document.querySelector('.analytics-bar')?.getBoundingClientRect().height ?? 0,
      body: document.querySelector('.analytics-body')?.getBoundingClientRect().top ?? 0,
      line: box('.period-bar-line'),
      controls: {
        periods: box('.period-bar-periods'),
        own: box('.period-bar-own'),
        add: box('.analytics-filter-add'),
        fresh: box('.analytics-bar-fresh'),
        refresh: box('.analytics-refresh'),
      },
      failure: box('.refresh-failed'),
      retry: box('.refresh-failed-retry'),
      panel: box('.analytics-panel'),
      said,
      mark: mark !== null && getComputedStyle(mark).visibility === 'visible',
    }
  })

export type BarState = Awaited<ReturnType<typeof barState>>

/** The failure is said in its words, and its retry stands, inside the bar's line and the window. */
export function expectSaid(name: string, state: BarState) {
  expect.soft(state.said, `${name}: the failure's words`).toBeGreaterThan(40)
  const line = state.line ?? { left: Number.NaN, right: Number.NaN }
  const none = { left: Number.NaN, right: Number.NaN }
  for (const [part, box] of [
    ['failure', state.failure ?? none],
    ['retry', state.retry ?? none],
  ] as const) {
    expect
      .soft(box.left, `${name}: the ${part} before the line`)
      .toBeGreaterThanOrEqual(line.left - 0.5)
    expect
      .soft(box.right, `${name}: the ${part} past the line`)
      .toBeLessThanOrEqual(line.right + 0.5)
    expect.soft(box.right, `${name}: the ${part} past the window`).toBeLessThanOrEqual(state.window)
  }
}

/**
 * Every control of the bar stands where it stood, to the half pixel the bar counts as rounding
 * when it fits its line (`useBarRoom`). The filter's field takes the room the line leaves, so what
 * takes that room ends it sooner: its start stays, and its end comes back, never past where it
 * was (`DESIGN.md`).
 */
export function expectInPlace(
  name: string,
  after: BarState['controls'],
  before: BarState['controls'],
) {
  for (const [control, was] of Object.entries(before)) {
    const now = after[control as keyof BarState['controls']]
    expect.soft(now === null, `${name}: ${control} shown`).toBe(was === null)
    if (!was || !now) continue
    const edges =
      control === 'add' ? (['left', 'top'] as const) : (['left', 'top', 'right'] as const)
    for (const edge of edges)
      expect
        .soft(Math.abs(now[edge] - was[edge]), `${name}: ${control}'s ${edge} moved`)
        .toBeLessThanOrEqual(0.5)
    if (control === 'add')
      expect
        .soft(now.right, `${name}: the field's end past where it was`)
        .toBeLessThanOrEqual(was.right + 0.5)
  }
}
