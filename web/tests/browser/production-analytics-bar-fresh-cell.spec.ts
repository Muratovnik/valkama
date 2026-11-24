/**
 * The freshness in the cell the periods' short last line leaves on the narrowest phone (DESIGN.md,
 * the Analytics bar: «In that cell the freshness never reads as a period»), in Russian and in
 * English, beside a past period and a live one, at rest and after a refresh that failed.
 *
 * There it is set smaller than the periods' names, in the caption size, and stands against its
 * column's end, its right edge on the right edge of the read again under it, where a period's name
 * stands in the middle of its column. Its ink is the muted ink it had, never a lighter one. Its
 * coming, its age counting up and a failure move nothing in the bar. Set in the periods' size and
 * ink 12px short of the read again's edge, «1 мин» read as a sixth period, and at 399px in Russian
 * the six cells stood as a grid of three over two.
 *
 * Wider, under the periods, it keeps the detail type it has everywhere else.
 */
import { expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

import {
  barState,
  expectInPlace,
  failRefresh,
  frames,
  serveFailing,
} from './analyticsBarFailure.ts'
import { pageAt, record } from './analyticsPage.ts'
import { test } from './test.ts'

/** The windows whose bar stands the freshness in the periods' cell (`beside`), walked up. */
const CELL = [320, 360, 384, 390, 395, 399] as const
/** Windows over them, where it stands under the periods. */
const UNDER = [400, 430] as const

const LABEL = { en: 'Period', ru: 'Период' } as const

/** A past period and a live one. */
const PERIODS = { week: {}, today: { period: 'today' } } as const

test.use({ locale: 'ru-RU', launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

/**
 * How the freshness stands: its age's box and the read again's, its live mark's, the sizes of its
 * type and of a period's, whether its ink is the muted token's, and whether it is in the cell
 * (its age on the periods' last line).
 */
const freshState = (page: Page, label: string) =>
  page.evaluate((name) => {
    // This body is serialized and evaluated in the page, so a module-scope
    // helper would not be in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const rect = (found: Element | null | undefined) => {
      const box = found?.getBoundingClientRect()
      return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null
    }
    const fresh = document.querySelector<HTMLElement>('.analytics-bar-fresh')
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-text-muted)'
    fresh?.append(probe)
    const muted = getComputedStyle(probe).color
    probe.remove()
    const periods = [
      ...document.querySelectorAll(`[role="radiogroup"][aria-label="${name}"] [role="radio"]`),
    ]
    const last = periods.at(-1)?.getBoundingClientRect()
    const age = fresh?.querySelector('time')?.getBoundingClientRect()
    const mark = document.querySelector('.analytics-bar-fresh-mark')
    return {
      age: rect(fresh?.querySelector('time')),
      refresh: rect(document.querySelector('.analytics-refresh')),
      mark: rect(mark?.checkVisibility({ visibilityProperty: true }) ? mark : null),
      size: fresh ? Number.parseFloat(getComputedStyle(fresh).fontSize) : Number.NaN,
      periodSize: periods[0]
        ? Number.parseFloat(getComputedStyle(periods[0]).fontSize)
        : Number.NaN,
      ink: fresh !== null && getComputedStyle(fresh).color === muted,
      inCell:
        last !== undefined && age !== undefined && age.top >= last.top && age.bottom <= last.bottom,
    }
  }, label)

type FreshState = Awaited<ReturnType<typeof freshState>>

/** Holds every usage read until `release`; the double answers them then. */
async function holdReads(page: Page) {
  let holding = true
  const held: Route[] = []
  await page.route('**/api/analytics/usage?*', async (route) => {
    if (holding) held.push(route)
    else await route.fallback()
  })
  return {
    held,
    async release() {
      holding = false
      for (const route of held.splice(0)) await route.fallback()
    },
  }
}

async function at(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.evaluate(() => document.fonts.ready)
  await frames(page)
}

/** The freshness in the cell: smaller than a period, against the read again's edge, muted. */
function expectInCell(name: string, state: FreshState, live: boolean) {
  expect.soft(state.inCell, `${name}: in the cell`).toBe(true)
  expect.soft(state.size, `${name}: its type beside a period's`).toBeLessThan(state.periodSize)
  const age = state.age ?? { left: Number.NaN, right: Number.NaN }
  const refresh = state.refresh ?? { right: Number.NaN }
  expect
    .soft(Math.abs(age.right - refresh.right), `${name}: its end off the read again's`)
    .toBeLessThanOrEqual(1)
  expect.soft(state.ink, `${name}: the muted ink`).toBe(true)
  if (live && state.mark)
    expect.soft(state.mark.right, `${name}: the live mark before the age`).toBeLessThan(age.left)
}

type BarState = Awaited<ReturnType<typeof barState>>

/**
 * One state at one width: the freshness in the cell, or under the periods in the detail type;
 * a live period's mark before its age; and nothing in the bar moved since before the first
 * answer, nor the age's end since it came.
 */
function expectState(
  name: string,
  measured: {
    after: BarState | undefined
    before: BarState | undefined
    cell: boolean
    live: boolean
    now: FreshState | undefined
    rest: FreshState | undefined
  },
) {
  const { now, rest, before, after } = measured
  if (!now || !rest || !before || !after) throw new Error(`${name}: not measured`)
  if (measured.cell) expectInCell(name, now, measured.live)
  else {
    // The control: under the periods it keeps the detail type, a period's size.
    expect.soft(now.inCell, `${name}: in the cell`).toBe(false)
    expect.soft(now.size, `${name}: its type`).toBe(now.periodSize)
  }
  if (measured.live) expect.soft(now.mark, `${name}: the live mark`).not.toBeNull()
  // Nothing in the bar moves as it comes, counts up or a failure is said.
  expect.soft(after.bar, `${name}: the bar's height`).toBe(before.bar)
  expectInPlace(name, after.controls, before.controls)
  expect
    .soft(now.age?.right, `${name}: the age's end moved`)
    .toBeCloseTo(rest.age?.right ?? Number.NaN, 0)
}

for (const locale of ['ru', 'en'] as const)
  for (const [from, period] of Object.entries(PERIODS))
    test(`the freshness in the periods' cell is no period, beside ${from} in ${locale}`, async ({
      page,
    }, info) => {
      const label = LABEL[locale]
      const live = from === 'today'
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      const fail = await serveFailing(page, CELL[0])
      const reads = await holdReads(page)
      await page.goto(pageAt(period))
      await expect.poll(() => reads.held.length).toBeGreaterThan(0)

      const widths = [...CELL, ...UNDER]
      const bars: Record<string, Record<number, Awaited<ReturnType<typeof barState>>>> = {}
      const seen: Record<string, Record<number, FreshState>> = {}
      const walk = async (state: string) => {
        bars[state] = {}
        seen[state] = {}
        for (const width of widths) {
          await at(page, width)
          bars[state][width] = await barState(page)
          seen[state][width] = await freshState(page, label)
        }
      }

      // Before the first answer the freshness has no age to show.
      await walk('before')
      await reads.release()
      await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
      await walk('rest')
      // A minute on, the age counts up: «9 s» becomes a minute.
      const age = await page.locator('.analytics-bar-fresh time').textContent()
      await page.clock.runFor(60_000)
      await expect(page.locator('.analytics-bar-fresh time')).not.toHaveText(age ?? '')
      await walk('aged')
      fail(true)
      await failRefresh(page)
      await walk('failed')
      await record(info, `bar fresh cell ${locale} ${from}`, seen)

      for (const state of ['rest', 'aged', 'failed'] as const)
        for (const width of widths)
          expectState(`${state} at ${width}px`, {
            now: seen[state]?.[width],
            rest: seen.rest?.[width],
            before: bars.before?.[width],
            after: bars[state]?.[width],
            cell: (CELL as readonly number[]).includes(width),
            live: live && state !== 'failed',
          })
    })
